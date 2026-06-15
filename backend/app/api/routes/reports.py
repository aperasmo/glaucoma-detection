# backend/app/api/routes/reports.py

from datetime import date, datetime, timedelta
from io import BytesIO
from typing import Any, Literal
from pathlib import Path
from inspect import isawaitable
from html import escape
import json
import re
import httpx

from pydantic import BaseModel, Field

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import text, select
from sqlalchemy.exc import SQLAlchemyError

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    Image as RLImage,
)

from app.db.database import get_db
from app.services.screening_service import get_analytics
from app.core.dependencies import get_current_user
from app.core.logger import get_logger
from app.core.config import settings
from app.models.user import User
from app.models.report_history import ReportHistory
from app.services.report_assistant_llm_service import (
    ReportAssistantLLMDisabled,
    ReportAssistantLLMError,
    interpret_report_assistant_prompt,
)

router = APIRouter(prefix="/reports", tags=["Reports"])
logger = get_logger(__name__)

ENSEMBLE_MODEL_USED = "ensemble"


def _get_report_service_url(path: str) -> str:
    base_url = settings.REPORT_SERVICE_BASE_URL.strip().rstrip("/")

    if not base_url:
        raise HTTPException(
            status_code=500,
            detail="REPORT_SERVICE_BASE_URL is not configured.",
        )

    return f"{base_url}/{path.lstrip('/')}"


class ReportAssistantFilters(BaseModel):
    status: Literal["active", "inactive"] | None = None
    diagnosis: Literal["glaucoma", "normal"] | None = None
    eye_side: Literal["left", "right"] | None = None
    role: Literal["admin", "doctor", "nurse"] | None = None
    days_since_last_screening: int | None = Field(default=None, ge=1, le=365)
    patient_id: str | None = None
    patient_code: str | None = None
    patient_name: str | None = None
    patient_query: str | None = None

    # Legacy support
    date_range: str | None = None

    # Flexible date support
    date_phrase: str | None = None
    date_from: date | None = None
    date_to: date | None = None
    date_label: str | None = None


class ReportAssistantPreviewRequest(BaseModel):
    report_type: Literal[
        "patient_list",
        "high_risk",
        "screening_summary",
        "user_list",
        "referral_list",
        "follow_up_list",
        "patient_clinical_summary",
    ]
    filters: ReportAssistantFilters = Field(default_factory=ReportAssistantFilters)
    format: Literal["pdf"] = "pdf"
    preview_data: dict[str, Any] | None = None


class ReportAssistantInterpretRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=1000)


def _safe_text(value: Any, fallback: str = "N/A") -> str:
    if value is None or value == "":
        return fallback
    return str(value)


def _format_percent(value: Any, digits: int = 0) -> str:
    if value is None:
        return "N/A"

    try:
        number = float(value)
    except (TypeError, ValueError):
        return "N/A"

    if number <= 1:
        number = number * 100

    return f"{number:.{digits}f}%"


def _format_number(value: Any, digits: int = 2) -> str:
    if value is None:
        return "N/A"

    try:
        return f"{float(value):.{digits}f}"
    except (TypeError, ValueError):
        return "N/A"


def _format_date(value: Any) -> str:
    if value is None:
        return "N/A"

    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")

    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")

    value_text = str(value)
    return value_text.split("T")[0]


def _format_date_display(value: Any) -> str:
    if value is None:
        return "N/A"

    if isinstance(value, datetime):
        value_date = value.date()
    elif isinstance(value, date):
        value_date = value
    else:
        value_text = str(value).split("T")[0]

        try:
            value_date = date.fromisoformat(value_text)
        except ValueError:
            return _safe_text(value)

    return f"{value_date.day} {value_date.strftime('%b %Y')}"


def _calculate_age(dob: Any) -> str:
    if dob is None:
        return "N/A"

    if isinstance(dob, str):
        try:
            dob_date = date.fromisoformat(dob.split("T")[0])
        except ValueError:
            return "N/A"
    elif isinstance(dob, datetime):
        dob_date = dob.date()
    elif isinstance(dob, date):
        dob_date = dob
    else:
        return "N/A"

    today = date.today()
    age = today.year - dob_date.year

    if (today.month, today.day) < (dob_date.month, dob_date.day):
        age -= 1

    return str(age)


def _ohts_display(row: dict) -> str:
    tier = _safe_text(row.get("ohts_tier"))
    score = row.get("ohts_score")

    if score is None:
        return tier

    return f"{tier.title()} / {_format_number(score, 1)}"


def _has_gradcam(row: dict) -> str:
    return "Yes" if row.get("gradcam_path") else "No"


def _find_logo_path() -> Path | None:
    possible_paths = [
        Path("assets/glaucoma-ai-logo-light.png"),
        Path("backend/assets/glaucoma-ai-logo-light.png"),
    ]

    for path in possible_paths:
        if path.exists():
            return path

    return None


async def _get_system_setting(
    db: Session,
    set_code: str,
    fallback: str,
) -> str:
    result = db.execute(
        text("""
            SELECT set_value
            FROM system_settings
            WHERE set_code = :set_code
              AND status = 'A'
            LIMIT 1
        """),
        {"set_code": set_code},
    )

    if isawaitable(result):
        result = await result

    row = result.first()

    if not row:
        return fallback

    return row[0] or fallback


def _risk_label(prediction: Any, ohts_tier: Any) -> str:
    prediction_text = _safe_text(prediction, "").lower()
    ohts_text = _safe_text(ohts_tier, "").lower()

    if prediction_text == "glaucoma":
        return "High"

    if ohts_text in {"possible", "critical"}:
        return "High"

    return "Low"


def _patient_status_label(is_active: Any) -> str:
    return "active" if bool(is_active) else "inactive"


def _patient_name(first_name: Any, last_name: Any) -> str:
    full_name = f"{_safe_text(first_name, '').strip()} {_safe_text(last_name, '').strip()}".strip()
    return full_name or "N/A"


def _get_patient_search_value(filters: ReportAssistantFilters) -> str | None:
    value = (
        filters.patient_query
        or filters.patient_name
        or filters.patient_code
        or filters.patient_id
    )

    if value is None:
        return None

    value = str(value).strip()

    return value or None


def _add_patient_search_filter(
    params: dict,
    where_clauses: list[str],
    filters: ReportAssistantFilters,
    columns: list[str],
) -> None:
    patient_search = _get_patient_search_value(filters)

    if not patient_search:
        return

    params["patient_query"] = f"%{patient_search.lower()}%"

    search_conditions = [
        f"LOWER(COALESCE({column}::text, '')) LIKE :patient_query" for column in columns
    ]

    where_clauses.append(f"({' OR '.join(search_conditions)})")


def _date_range_start(date_range: str | None) -> date | None:
    MONTH_LOOKUP = {
        "jan": 1,
        "january": 1,
        "feb": 2,
        "february": 2,
        "mar": 3,
        "march": 3,
        "apr": 4,
        "april": 4,
        "may": 5,
        "jun": 6,
        "june": 6,
        "jul": 7,
        "july": 7,
        "aug": 8,
        "august": 8,
        "sep": 9,
        "sept": 9,
        "september": 9,
        "oct": 10,
        "october": 10,
        "nov": 11,
        "november": 11,
        "dec": 12,
        "december": 12,
    }

    def _month_bounds(year: int, month: int) -> tuple[date, date]:
        start = date(year, month, 1)

        if month == 12:
            end = date(year, 12, 31)
        else:
            end = date(year, month + 1, 1) - timedelta(days=1)

        return start, end

    def _quarter_bounds(year: int, quarter: int) -> tuple[date, date]:
        start_month = ((quarter - 1) * 3) + 1
        start = date(year, start_month, 1)

        end_month = start_month + 2
        _, end = _month_bounds(year, end_month)

        return start, end

    def _display_date_label(start: date, end: date) -> str:
        return (
            f"{start.day} {start.strftime('%b %Y')} to "
            f"{end.day} {end.strftime('%b %Y')}"
        )

    def _parse_month_day_range(
        phrase: str, default_year: int
    ) -> tuple[date, date] | None:
        pattern = (
            r"(?:from|between)\s+"
            r"([a-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?\s+"
            r"(?:to|and)\s+"
            r"([a-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?"
        )

        match = re.search(pattern, phrase)

        if not match:
            return None

        start_month_text = match.group(1).lower()
        start_day = int(match.group(2))
        start_year = int(match.group(3)) if match.group(3) else default_year

        end_month_text = match.group(4).lower()
        end_day = int(match.group(5))
        end_year = int(match.group(6)) if match.group(6) else start_year

        start_month = MONTH_LOOKUP.get(start_month_text)
        end_month = MONTH_LOOKUP.get(end_month_text)

        if not start_month or not end_month:
            return None

        return date(start_year, start_month, start_day), date(
            end_year, end_month, end_day
        )

    def _resolve_date_filter(
        filters: ReportAssistantFilters,
    ) -> tuple[date | None, date | None, str | None]:
        today = date.today()

        if filters.date_from or filters.date_to:
            start = filters.date_from
            end = filters.date_to or today

            if start and end and start > end:
                raise HTTPException(
                    status_code=400,
                    detail="date_from must be before or equal to date_to.",
                )

            label = filters.date_label or (
                _display_date_label(start, end)
                if start and end
                else "Custom date range"
            )

            return start, end, label

        phrase = (filters.date_phrase or filters.date_range or "").strip().lower()

        if not phrase:
            return None, None, None

        if phrase == "today":
            return today, today, "Today"

        if phrase == "yesterday":
            yesterday = today - timedelta(days=1)
            return yesterday, yesterday, "Yesterday"

        # Keep this as rolling 7 days because that is how the current report workflow behaves.
        if phrase == "this week":
            start = today - timedelta(days=7)
            return start, today, "This week"

        if phrase == "last week":
            start = today - timedelta(days=14)
            end = today - timedelta(days=8)
            return start, end, "Last week"

        if phrase == "this month":
            start = date(today.year, today.month, 1)
            return start, today, "This month"

        if phrase == "last month":
            first_this_month = date(today.year, today.month, 1)
            last_month_end = first_this_month - timedelta(days=1)
            last_month_start = date(last_month_end.year, last_month_end.month, 1)

            return last_month_start, last_month_end, "Last month"

        if phrase == "this year":
            return date(today.year, 1, 1), today, "This year"

        if phrase == "last year":
            return date(today.year - 1, 1, 1), date(today.year - 1, 12, 31), "Last year"

        if phrase == "this quarter":
            quarter = ((today.month - 1) // 3) + 1
            start, _ = _quarter_bounds(today.year, quarter)
            return start, today, "This quarter"

        if phrase == "last quarter":
            quarter = ((today.month - 1) // 3) + 1

            if quarter == 1:
                return (*_quarter_bounds(today.year - 1, 4), "Last quarter")

            return (*_quarter_bounds(today.year, quarter - 1), "Last quarter")

        last_days_match = re.search(r"last\s+(\d+)\s+days?", phrase)
        if last_days_match:
            days = int(last_days_match.group(1))

            if days < 1 or days > 500:
                raise HTTPException(
                    status_code=400,
                    detail="Date range must be between 1 and 500 days.",
                )

            start = today - timedelta(days=days - 1)
            return start, today, f"Last {days} days"

        last_months_match = re.search(r"last\s+(\d+)\s+months?", phrase)
        if last_months_match:
            months = int(last_months_match.group(1))

            if months < 1 or months > 24:
                raise HTTPException(
                    status_code=400,
                    detail="Month range must be between 1 and 24 months.",
                )

            month = today.month - months
            year = today.year

            while month <= 0:
                month += 12
                year -= 1

            start = date(year, month, 1)
            return start, today, f"Last {months} months"

        quarter_match = re.search(r"q([1-4])\s+(this\s+year|\d{4})", phrase)
        if quarter_match:
            quarter = int(quarter_match.group(1))
            year_text = quarter_match.group(2)
            year = today.year if year_text == "this year" else int(year_text)

            start, end = _quarter_bounds(year, quarter)
            return start, end, f"Q{quarter} {year}"

        iso_range_match = re.search(
            r"(?:from|between)\s+(\d{4}-\d{2}-\d{2})\s+(?:to|and)\s+(\d{4}-\d{2}-\d{2})",
            phrase,
        )

        if iso_range_match:
            start = date.fromisoformat(iso_range_match.group(1))
            end = date.fromisoformat(iso_range_match.group(2))

            if start > end:
                raise HTTPException(
                    status_code=400,
                    detail="Start date must be before or equal to end date.",
                )

            return start, end, _display_date_label(start, end)

        month_day_range = _parse_month_day_range(phrase, today.year)

        if month_day_range:
            start, end = month_day_range

            if start > end:
                raise HTTPException(
                    status_code=400,
                    detail="Start date must be before or equal to end date.",
                )

            return start, end, _display_date_label(start, end)

        raise HTTPException(
            status_code=400,
            detail=(
                "I could not understand the date range. Try examples like "
                "'last month', 'last 45 days', or 'from 2026-01-01 to 2026-05-31'."
            ),
        )


def _display_date_label(start: date, end: date) -> str:
    return (
        f"{start.day} {start.strftime('%b %Y')} to "
        f"{end.day} {end.strftime('%b %Y')}"
    )


def _parse_nz_date(value: str) -> date:
    """
    User-facing date format: dd/mm/yyyy.
    Example: 01/05/2026
    """
    try:
        return datetime.strptime(value.strip(), "%d/%m/%Y").date()
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid date format. Please use NZ date format dd/mm/yyyy, "
                "for example 01/05/2026."
            ),
        )


def _llm_display(value: Any) -> str:
    labels = {
        "gpt4o": "GPT-4o",
        "gpt4o_mini": "GPT-4o mini",
        "gemini": "Gemini",
        "llama": "LLaMA",
    }

    value_text = _safe_text(value, "").strip()

    return labels.get(value_text, value_text or "N/A")


def _resolve_date_filter(
    filters: ReportAssistantFilters,
) -> tuple[date | None, date | None, str | None]:
    today = date.today()
    phrase = (filters.date_phrase or filters.date_range or "").strip().lower()

    # Direct date fields from API, if supplied
    if filters.date_from or filters.date_to:
        start = filters.date_from
        end = filters.date_to or today

        if start and end and start > end:
            raise HTTPException(
                status_code=400,
                detail="date_from must be before or equal to date_to.",
            )

        label = filters.date_label or (
            _display_date_label(start, end) if start and end else "Custom date range"
        )

        return start, end, label

    if not phrase:
        return None, None, None

    if phrase == "today":
        return today, today, "Today"

    if phrase == "yesterday":
        yesterday = today - timedelta(days=1)
        return yesterday, yesterday, "Yesterday"

    if phrase == "this week":
        start = today - timedelta(days=7)
        return start, today, "This week"

    if phrase == "last week":
        start = today - timedelta(days=14)
        end = today - timedelta(days=8)
        return start, end, "Last week"

    if phrase == "this month":
        start = date(today.year, today.month, 1)
        return start, today, "This month"

    if phrase == "last month":
        first_this_month = date(today.year, today.month, 1)
        last_month_end = first_this_month - timedelta(days=1)
        last_month_start = date(last_month_end.year, last_month_end.month, 1)

        return last_month_start, last_month_end, "Last month"

    if phrase == "this year":
        return date(today.year, 1, 1), today, "This year"

    if phrase == "last year":
        return date(today.year - 1, 1, 1), date(today.year - 1, 12, 31), "Last year"

    if phrase == "this quarter":
        quarter = ((today.month - 1) // 3) + 1
        start_month = ((quarter - 1) * 3) + 1
        return date(today.year, start_month, 1), today, "This quarter"

    if phrase == "last quarter":
        quarter = ((today.month - 1) // 3) + 1

        if quarter == 1:
            year = today.year - 1
            start_month = 10
        else:
            year = today.year
            start_month = ((quarter - 2) * 3) + 1

        start = date(year, start_month, 1)
        end_month = start_month + 2

        if end_month == 12:
            end = date(year, 12, 31)
        else:
            end = date(year, end_month + 1, 1) - timedelta(days=1)

        return start, end, "Last quarter"

    last_days_match = re.search(r"last\s+(\d+)\s+days?", phrase)

    if last_days_match:
        days = int(last_days_match.group(1))

        if days < 1 or days > 500:
            raise HTTPException(
                status_code=400,
                detail="Date range must be between 1 and 500 days.",
            )

        start = today - timedelta(days=days - 1)
        return start, today, f"Last {days} days"

    last_months_match = re.search(r"last\s+(\d+)\s+months?", phrase)

    if last_months_match:
        months = int(last_months_match.group(1))

        if months < 1 or months > 24:
            raise HTTPException(
                status_code=400,
                detail="Month range must be between 1 and 24 months.",
            )

        month = today.month - months
        year = today.year

        while month <= 0:
            month += 12
            year -= 1

        start = date(year, month, 1)
        return start, today, f"Last {months} months"

    # NZ date format:
    # from 01/05/2026 to 31/05/2026
    # between 01/05/2026 and 31/05/2026
    nz_range_match = re.search(
        r"(?:from|between)\s+(\d{1,2}/\d{1,2}/\d{4})\s+(?:to|and)\s+(\d{1,2}/\d{1,2}/\d{4})",
        phrase,
    )

    if nz_range_match:
        start = _parse_nz_date(nz_range_match.group(1))
        end = _parse_nz_date(nz_range_match.group(2))

        if start > end:
            raise HTTPException(
                status_code=400,
                detail="Start date must be before or equal to end date.",
            )

        return start, end, _display_date_label(start, end)

    # ISO support for developer/API safety:
    # from 2026-05-01 to 2026-05-31
    iso_range_match = re.search(
        r"(?:from|between)\s+(\d{4}-\d{2}-\d{2})\s+(?:to|and)\s+(\d{4}-\d{2}-\d{2})",
        phrase,
    )

    if iso_range_match:
        start = date.fromisoformat(iso_range_match.group(1))
        end = date.fromisoformat(iso_range_match.group(2))

        if start > end:
            raise HTTPException(
                status_code=400,
                detail="Start date must be before or equal to end date.",
            )

        return start, end, _display_date_label(start, end)

    raise HTTPException(
        status_code=400,
        detail=(
            "I could not understand the date range. Please use examples like "
            "'last month', 'last 45 days', or 'from 01/05/2026 to 31/05/2026'."
        ),
    )


async def _preview_user_list_report(
    payload: ReportAssistantPreviewRequest,
    db: Session,
    current_user: User,
    date_start: date | None,
    date_end: date | None,
    date_label: str | None,
) -> dict:
    params = {}
    where_clauses = ["1 = 1"]

    if payload.filters.status:
        params["is_active"] = payload.filters.status == "active"
        where_clauses.append("u.is_active = :is_active")

    if payload.filters.role:
        params["role"] = payload.filters.role
        where_clauses.append("u.role = :role")

    if date_start:
        params["date_start"] = date_start
        where_clauses.append("u.created_at >= :date_start")

    if date_end:
        params["date_end_exclusive"] = date_end + timedelta(days=1)
        where_clauses.append("u.created_at < :date_end_exclusive")

    where_sql = " AND ".join(where_clauses)

    query = text(f"""
        SELECT
            u.user_id,
            u.user_code,
            u.first_name,
            u.last_name,
            u.role,
            u.email,
            u.mobile_number,
            u.is_active,
            u.created_at
        FROM users u
        WHERE {where_sql}
        ORDER BY u.last_name ASC, u.first_name ASC
        LIMIT 500
    """)

    result = db.execute(query, params)

    if isawaitable(result):
        result = await result

    rows = result.mappings().all()

    logger.info(
        "User list preview query completed | row_count=%s",
        len(rows),
    )

    response_rows = []

    for row in rows:
        status = "active" if bool(row.get("is_active")) else "inactive"

        response_rows.append(
            {
                "userId": _safe_text(row.get("user_code")),
                "name": _patient_name(row.get("first_name"), row.get("last_name")),
                "role": _safe_text(row.get("role")).title(),
                "email": _safe_text(row.get("email")),
                "mobile": _safe_text(row.get("mobile_number")),
                "status": status,
                "createdAt": _format_date(row.get("created_at")),
            }
        )

    summary = {
        "total": len(response_rows),
        "active": sum(1 for row in response_rows if row["status"] == "active"),
        "inactive": sum(1 for row in response_rows if row["status"] == "inactive"),
        "admin": sum(1 for row in response_rows if row["role"].lower() == "admin"),
        "doctor": sum(1 for row in response_rows if row["role"].lower() == "doctor"),
        "nurse": sum(1 for row in response_rows if row["role"].lower() == "nurse"),
    }

    return {
        "report_type": payload.report_type,
        "title": "User List Report",
        "filters": {
            key: value
            for key, value in {
                "status": payload.filters.status,
                "role": payload.filters.role,
                "date_from": date_start.isoformat() if date_start else None,
                "date_to": date_end.isoformat() if date_end else None,
                "date_label": date_label,
            }.items()
            if value is not None
        },
        "summary": summary,
        "rows": response_rows,
        "generated_by": f"{current_user.first_name} {current_user.last_name}",
        "generated_date": datetime.now().strftime("%Y-%m-%d %H:%M"),
    }


async def _preview_follow_up_list_report(
    payload: ReportAssistantPreviewRequest,
    db: Session,
    current_user: User,
    date_start: date | None,
    date_end: date | None,
    date_label: str | None,
) -> dict:
    days_threshold = payload.filters.days_since_last_screening or 30

    params = {
        "model_used": ENSEMBLE_MODEL_USED,
        "days_threshold": days_threshold,
    }

    where_clauses = [
        "rn = 1",
        "(prediction = 'glaucoma' OR ohts_tier IN ('possible', 'critical'))",
        "days_elapsed >= :days_threshold",
    ]

    if payload.filters.status:
        params["is_active"] = payload.filters.status == "active"
        where_clauses.append("is_active = :is_active")

    if payload.filters.diagnosis:
        params["diagnosis"] = payload.filters.diagnosis
        where_clauses.append("prediction = :diagnosis")

    if payload.filters.eye_side:
        params["eye_side"] = payload.filters.eye_side
        where_clauses.append("eye_side = :eye_side")

    _add_patient_search_filter(
        params=params,
        where_clauses=where_clauses,
        filters=payload.filters,
        columns=[
            "patient_code",
            "first_name",
            "last_name",
            "CONCAT(first_name, ' ', last_name)",
        ],
    )

    if date_start:
        params["date_start"] = date_start
        where_clauses.append("last_screening >= :date_start")

    if date_end:
        params["date_end_exclusive"] = date_end + timedelta(days=1)
        where_clauses.append("last_screening < :date_end_exclusive")

    where_sql = " AND ".join(where_clauses)

    query = text(f"""
        WITH latest_results AS (
            SELECT
                p.patient_id,
                p.patient_code,
                p.first_name,
                p.last_name,
                p.dob,
                p.gender,
                p.is_active,
                s.screening_id,
                s.eye_side,
                s.created_at AS last_screening,
                sr.prediction,
                sr.confidence_score,
                sr.ohts_score,
                sr.ohts_tier,
                sr.cdr,
                sr.referral_letter,
                COALESCE(sr.updated_at, sr.created_at) AS result_updated_at,
                COALESCE(
                    NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''),
                    'N/A'
                ) AS clinician,
                (CURRENT_DATE - CAST(s.created_at AS DATE)) AS days_elapsed,
                ROW_NUMBER() OVER (
                    PARTITION BY p.patient_id, s.eye_side
                    ORDER BY s.created_at DESC NULLS LAST, sr.created_at DESC NULLS LAST
                ) AS rn
            FROM screenings s
            JOIN patients p
                ON p.patient_id = s.patient_id
            JOIN screening_results sr
                ON sr.screening_id = s.screening_id
               AND sr.model_used = :model_used
            LEFT JOIN users u
                ON u.user_id = s.screened_by
            WHERE s.status = 'complete'
        )
        SELECT
            patient_code,
            first_name,
            last_name,
            dob,
            gender,
            is_active,
            eye_side,
            last_screening,
            prediction,
            confidence_score,
            ohts_score,
            ohts_tier,
            cdr,
            referral_letter,
            clinician,
            days_elapsed,
            CASE
                WHEN referral_letter IS NOT NULL AND TRIM(referral_letter) <> ''
                    THEN 'Generated'
                ELSE 'Not generated'
            END AS referral_status,
            CASE
                WHEN prediction = 'glaucoma' AND ohts_tier IN ('possible', 'critical')
                    THEN 'Glaucoma-positive with elevated OHTS tier'
                WHEN prediction = 'glaucoma'
                    THEN 'Glaucoma-positive screening'
                WHEN ohts_tier IN ('possible', 'critical')
                    THEN 'Elevated OHTS tier'
                ELSE 'High-risk criteria met'
            END AS follow_up_reason
        FROM latest_results
        WHERE {where_sql}
        ORDER BY days_elapsed DESC, last_name ASC, first_name ASC
        LIMIT 500
    """)

    result = db.execute(query, params)

    if isawaitable(result):
        result = await result

    rows = result.mappings().all()

    logger.info(
        "Follow-up list preview query completed | row_count=%s | days_threshold=%s",
        len(rows),
        days_threshold,
    )

    response_rows = []

    for row in rows:
        referral_status = _safe_text(row.get("referral_status"), "Not generated")

        response_rows.append(
            {
                "lastScreening": _format_date(row.get("last_screening")),
                "patientId": _safe_text(row.get("patient_code")),
                "name": _patient_name(row.get("first_name"), row.get("last_name")),
                "ageGender": (
                    f"{_calculate_age(row.get('dob'))} / "
                    f"{_safe_text(row.get('gender')).title()}"
                ),
                "status": _patient_status_label(row.get("is_active")),
                "eye": _safe_text(row.get("eye_side")).title(),
                "diagnosis": _safe_text(row.get("prediction"), "N/A"),
                "confidence": _format_percent(row.get("confidence_score")),
                "cdr": _format_number(row.get("cdr"), 3),
                "ohts": _ohts_display(
                    {
                        "ohts_tier": row.get("ohts_tier"),
                        "ohts_score": row.get("ohts_score"),
                    }
                ),
                "risk": _risk_label(row.get("prediction"), row.get("ohts_tier")),
                "daysElapsed": str(row.get("days_elapsed") or 0),
                "referralStatus": referral_status,
                "clinician": _safe_text(row.get("clinician")),
                "followUpReason": _safe_text(row.get("follow_up_reason")),
            }
        )

    days_elapsed_values = []

    for row in response_rows:
        try:
            days_elapsed_values.append(int(row["daysElapsed"]))
        except (TypeError, ValueError):
            pass

    average_days_elapsed = (
        sum(days_elapsed_values) / len(days_elapsed_values)
        if days_elapsed_values
        else None
    )

    summary = {
        "total": len(response_rows),
        "glaucoma": sum(1 for row in response_rows if row["diagnosis"] == "glaucoma"),
        "possibleOhts": sum(1 for row in response_rows if "Possible" in row["ohts"]),
        "criticalOhts": sum(1 for row in response_rows if "Critical" in row["ohts"]),
        "withReferral": sum(
            1 for row in response_rows if row["referralStatus"] == "Generated"
        ),
        "withoutReferral": sum(
            1 for row in response_rows if row["referralStatus"] != "Generated"
        ),
        "averageDaysElapsed": (
            f"{average_days_elapsed:.0f} days"
            if average_days_elapsed is not None
            else "N/A"
        ),
        "daysThreshold": days_threshold,
    }

    return {
        "report_type": payload.report_type,
        "title": "Follow-up List Report",
        "filters": {
            key: value
            for key, value in {
                "status": payload.filters.status,
                "diagnosis": payload.filters.diagnosis,
                "eye_side": payload.filters.eye_side,
                "patient_query": _get_patient_search_value(payload.filters),
                "days_since_last_screening": days_threshold,
                "date_from": date_start.isoformat() if date_start else None,
                "date_to": date_end.isoformat() if date_end else None,
                "date_label": date_label,
            }.items()
            if value is not None
        },
        "summary": summary,
        "rows": response_rows,
        "generated_by": f"{current_user.first_name} {current_user.last_name}",
        "generated_date": datetime.now().strftime("%Y-%m-%d %H:%M"),
    }


async def _preview_referral_list_report(
    payload: ReportAssistantPreviewRequest,
    db: Session,
    current_user: User,
    date_start: date | None,
    date_end: date | None,
    date_label: str | None,
) -> dict:
    params = {
        "clinical_llm_used": "gpt4o",
    }
    where_clauses = [
        "s.status = 'complete'",
    ]

    if payload.filters.status:
        params["is_active"] = payload.filters.status == "active"
        where_clauses.append("p.is_active = :is_active")

    if payload.filters.diagnosis:
        params["diagnosis"] = payload.filters.diagnosis
        where_clauses.append("sr.prediction = :diagnosis")

    if payload.filters.eye_side:
        params["eye_side"] = payload.filters.eye_side
        where_clauses.append("s.eye_side = :eye_side")

    _add_patient_search_filter(
        params=params,
        where_clauses=where_clauses,
        filters=payload.filters,
        columns=[
            "p.patient_code",
            "p.first_name",
            "p.last_name",
            "CONCAT(p.first_name, ' ', p.last_name)",
        ],
    )

    if date_start:
        params["date_start"] = date_start
        where_clauses.append("COALESCE(sr.updated_at, sr.created_at) >= :date_start")

    if date_end:
        params["date_end_exclusive"] = date_end + timedelta(days=1)
        where_clauses.append(
            "COALESCE(sr.updated_at, sr.created_at) < :date_end_exclusive"
        )

    where_sql = " AND ".join(where_clauses)

    query = text(f"""
        WITH ranked_referrals AS (
            SELECT
                sr.*,
                ROW_NUMBER() OVER (
                    PARTITION BY sr.screening_id
                    ORDER BY COALESCE(sr.updated_at, sr.created_at) DESC
                ) AS referral_rank
                FROM screening_results sr
                WHERE sr.referral_letter IS NOT NULL
                AND TRIM(sr.referral_letter) <> ''
                AND sr.llm_used = :clinical_llm_used
        )
        SELECT
            sr.screening_results_id,
            COALESCE(sr.updated_at, sr.created_at) AS referral_date,
            s.created_at AS screening_date,
            p.patient_code,
            p.first_name,
            p.last_name,
            p.dob,
            p.gender,
            p.is_active,
            s.eye_side,
            sr.model_used,
            sr.prediction,
            sr.confidence_score,
            sr.ohts_score,
            sr.ohts_tier,
            sr.cdr,
            sr.llm_used,
            sr.generation_time_ms,
            sr.signed_by,
            COALESCE(
                NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''),
                'N/A'
            ) AS clinician
        FROM ranked_referrals sr
        JOIN screenings s
            ON s.screening_id = sr.screening_id
        JOIN patients p
            ON p.patient_id = s.patient_id
        LEFT JOIN users u
            ON u.user_id = s.screened_by
        WHERE {where_sql}
        AND sr.referral_rank = 1
        ORDER BY
            p.last_name ASC,
            p.first_name ASC,
            COALESCE(sr.updated_at, sr.created_at) DESC
        LIMIT 500
    """)

    result = db.execute(query, params)

    if isawaitable(result):
        result = await result

    rows = result.mappings().all()

    logger.info(
        "Referral list preview query completed | row_count=%s",
        len(rows),
    )

    response_rows = []

    for row in rows:
        llm_used = _llm_display(row.get("llm_used"))
        signed_by = _safe_text(row.get("signed_by"), "Unsigned")

        response_rows.append(
            {
                "referralDate": _format_date(row.get("referral_date")),
                "screeningDate": _format_date(row.get("screening_date")),
                "patientId": _safe_text(row.get("patient_code")),
                "name": _patient_name(row.get("first_name"), row.get("last_name")),
                "ageGender": (
                    f"{_calculate_age(row.get('dob'))} / "
                    f"{_safe_text(row.get('gender')).title()}"
                ),
                "status": _patient_status_label(row.get("is_active")),
                "eye": _safe_text(row.get("eye_side")).title(),
                "model": _safe_text(row.get("model_used")),
                "diagnosis": _safe_text(row.get("prediction"), "N/A"),
                "confidence": _format_percent(row.get("confidence_score")),
                "cdr": _format_number(row.get("cdr"), 3),
                "ohts": _ohts_display(
                    {
                        "ohts_tier": row.get("ohts_tier"),
                        "ohts_score": row.get("ohts_score"),
                    }
                ),
                "risk": _risk_label(row.get("prediction"), row.get("ohts_tier")),
                "llm": llm_used,
                "generationTime": (
                    f"{_format_number(row.get('generation_time_ms'), 0)} ms"
                    if row.get("generation_time_ms") is not None
                    else "N/A"
                ),
                "signedBy": signed_by,
                "clinician": _safe_text(row.get("clinician")),
            }
        )

    summary = {
        "total": len(response_rows),
        "glaucoma": sum(1 for row in response_rows if row["diagnosis"] == "glaucoma"),
        "normal": sum(1 for row in response_rows if row["diagnosis"] == "normal"),
        "signed": sum(1 for row in response_rows if row["signedBy"] != "Unsigned"),
        "unsigned": sum(1 for row in response_rows if row["signedBy"] == "Unsigned"),
        "gpt4o": sum(1 for row in response_rows if row["llm"] == "gpt4o"),
        "gpt4oMini": sum(1 for row in response_rows if row["llm"] == "gpt4o_mini"),
        "llama": sum(1 for row in response_rows if row["llm"] == "llama"),
        "gemini": sum(1 for row in response_rows if row["llm"] == "gemini"),
    }

    return {
        "report_type": payload.report_type,
        "title": "Referral List Report",
        "filters": {
            key: value
            for key, value in {
                "status": payload.filters.status,
                "diagnosis": payload.filters.diagnosis,
                "eye_side": payload.filters.eye_side,
                "patient_query": _get_patient_search_value(payload.filters),
                "date_from": date_start.isoformat() if date_start else None,
                "date_to": date_end.isoformat() if date_end else None,
                "date_label": date_label,
            }.items()
            if value is not None
        },
        "summary": summary,
        "rows": response_rows,
        "generated_by": f"{current_user.first_name} {current_user.last_name}",
        "generated_date": datetime.now().strftime("%Y-%m-%d %H:%M"),
    }


async def _preview_screening_summary_report(
    payload: ReportAssistantPreviewRequest,
    db: Session,
    current_user: User,
    date_start: date | None,
    date_end: date | None,
    date_label: str | None,
) -> dict:
    params = {
        "model_used": ENSEMBLE_MODEL_USED,
    }

    where_clauses = [
        "s.status = 'complete'",
    ]

    if payload.filters.status:
        params["is_active"] = payload.filters.status == "active"
        where_clauses.append("p.is_active = :is_active")

    if payload.filters.diagnosis:
        params["diagnosis"] = payload.filters.diagnosis
        where_clauses.append("sr.prediction = :diagnosis")

    if payload.filters.eye_side:
        params["eye_side"] = payload.filters.eye_side
        where_clauses.append("s.eye_side = :eye_side")
    _add_patient_search_filter(
        params=params,
        where_clauses=where_clauses,
        filters=payload.filters,
        columns=[
            "p.patient_code",
            "p.first_name",
            "p.last_name",
            "CONCAT(p.first_name, ' ', p.last_name)",
        ],
    )

    if date_start:
        params["date_start"] = date_start
        where_clauses.append("s.created_at >= :date_start")

    if date_end:
        params["date_end_exclusive"] = date_end + timedelta(days=1)
        where_clauses.append("s.created_at < :date_end_exclusive")

    where_sql = " AND ".join(where_clauses)

    query = text(f"""
        WITH ranked_results AS (
            SELECT
                sr.*,
                ROW_NUMBER() OVER (
                    PARTITION BY sr.screening_id, sr.model_used
                    ORDER BY COALESCE(sr.updated_at, sr.created_at) DESC
                ) AS result_rank
            FROM screening_results sr
            WHERE sr.model_used = :model_used
            AND sr.llm_used IS NULL
        )
        SELECT
            s.screening_id,
            s.created_at AS screening_date,
            p.patient_code,
            p.first_name,
            p.last_name,
            p.dob,
            p.gender,
            p.is_active,
            s.eye_side,
            sr.prediction,
            sr.confidence_score,
            sr.ohts_score,
            sr.ohts_tier,
            sr.cdr,
            sr.gradcam_path,
            COALESCE(
                NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''),
                'N/A'
            ) AS clinician
        FROM screenings s
        JOIN patients p
            ON p.patient_id = s.patient_id
        JOIN ranked_results sr
            ON sr.screening_id = s.screening_id
        AND sr.result_rank = 1
        LEFT JOIN users u
            ON u.user_id = s.screened_by
        WHERE {where_sql}
        ORDER BY
        p.last_name ASC,
        p.first_name ASC,
        s.created_at DESC,
        s.eye_side ASC
        LIMIT 500
    """)

    result = db.execute(query, params)

    if isawaitable(result):
        result = await result

    rows = result.mappings().all()

    logger.info(
        "Screening summary preview query completed | row_count=%s",
        len(rows),
    )

    response_rows = []
    confidence_values = []

    for row in rows:
        confidence_score = row.get("confidence_score")

        if confidence_score is not None:
            try:
                confidence_values.append(float(confidence_score))
            except (TypeError, ValueError):
                pass

        risk = _risk_label(row.get("prediction"), row.get("ohts_tier"))

        response_rows.append(
            {
                "screeningDate": _format_date(row.get("screening_date")),
                "lastScreening": _format_date(row.get("screening_date")),
                "patientId": _safe_text(row.get("patient_code")),
                "name": _patient_name(row.get("first_name"), row.get("last_name")),
                "ageGender": (
                    f"{_calculate_age(row.get('dob'))} / "
                    f"{_safe_text(row.get('gender')).title()}"
                ),
                "status": _patient_status_label(row.get("is_active")),
                "eye": _safe_text(row.get("eye_side")).title(),
                "diagnosis": _safe_text(row.get("prediction"), "N/A"),
                "confidence": _format_percent(confidence_score),
                "cdr": _format_number(row.get("cdr"), 3),
                "ohts": _ohts_display(
                    {
                        "ohts_tier": row.get("ohts_tier"),
                        "ohts_score": row.get("ohts_score"),
                    }
                ),
                "risk": risk,
                "gradcam": _has_gradcam(
                    {
                        "gradcam_path": row.get("gradcam_path"),
                    }
                ),
                "clinician": _safe_text(row.get("clinician")),
            }
        )

    average_confidence = (
        sum(confidence_values) / len(confidence_values) if confidence_values else None
    )

    summary = {
        "total": len(response_rows),
        "glaucoma": sum(1 for row in response_rows if row["diagnosis"] == "glaucoma"),
        "normal": sum(1 for row in response_rows if row["diagnosis"] == "normal"),
        "highRisk": sum(1 for row in response_rows if row["risk"] == "High"),
        "averageConfidence": _format_percent(average_confidence),
        "gradcamGenerated": sum(1 for row in response_rows if row["gradcam"] == "Yes"),
    }

    return {
        "report_type": payload.report_type,
        "title": "Screening Summary Report",
        "filters": {
            key: value
            for key, value in {
                "status": payload.filters.status,
                "diagnosis": payload.filters.diagnosis,
                "eye_side": payload.filters.eye_side,
                "patient_query": _get_patient_search_value(payload.filters),
                "date_from": date_start.isoformat() if date_start else None,
                "date_to": date_end.isoformat() if date_end else None,
                "date_label": date_label,
            }.items()
            if value is not None
        },
        "summary": summary,
        "rows": response_rows,
        "generated_by": f"{current_user.first_name} {current_user.last_name}",
        "generated_date": datetime.now().strftime("%Y-%m-%d %H:%M"),
    }


async def _resolve_patient_for_report(
    filters: ReportAssistantFilters,
    db: Session,
) -> dict:
    patient_id = (filters.patient_id or "").strip()
    patient_query = (
        filters.patient_query or filters.patient_code or filters.patient_name or ""
    ).strip()

    if not patient_id and not patient_query:
        raise HTTPException(
            status_code=400,
            detail="Please include a patient name or patient ID for the patient clinical summary report.",
        )

    if patient_id:
        query = text("""
            SELECT
                p.patient_id,
                p.patient_code,
                p.first_name,
                p.last_name
            FROM patients p
            WHERE p.patient_id = :patient_id
            LIMIT 1
        """)
        params = {"patient_id": patient_id}
    else:
        query = text("""
            SELECT
                p.patient_id,
                p.patient_code,
                p.first_name,
                p.last_name
            FROM patients p
            WHERE p.patient_code ILIKE :patient_like
               OR CONCAT(p.first_name, ' ', p.last_name) ILIKE :patient_like
               OR p.first_name ILIKE :patient_like
               OR p.last_name ILIKE :patient_like
            ORDER BY
                CASE
                    WHEN LOWER(p.patient_code) = LOWER(:patient_exact) THEN 0
                    WHEN LOWER(CONCAT(p.first_name, ' ', p.last_name)) = LOWER(:patient_exact) THEN 1
                    ELSE 2
                END,
                p.last_name ASC,
                p.first_name ASC
            LIMIT 5
        """)
        params = {
            "patient_like": f"%{patient_query}%",
            "patient_exact": patient_query,
        }

    result = db.execute(query, params)

    if isawaitable(result):
        result = await result

    rows = list(result.mappings().all())

    if not rows:
        raise HTTPException(
            status_code=404,
            detail="No patient matched that name or patient ID.",
        )

    if patient_id or len(rows) == 1:
        return dict(rows[0])

    exact_matches = [
        row
        for row in rows
        if _safe_text(row.get("patient_code"), "").lower() == patient_query.lower()
        or _patient_name(row.get("first_name"), row.get("last_name")).lower()
        == patient_query.lower()
    ]

    if len(exact_matches) == 1:
        return dict(exact_matches[0])

    matches = [
        {
            "patient_id": str(row.get("patient_id")),
            "patient_code": _safe_text(row.get("patient_code")),
            "patient_name": _patient_name(row.get("first_name"), row.get("last_name")),
        }
        for row in rows
    ]

    raise HTTPException(
        status_code=409,
        detail={
            "needs_patient_selection": True,
            "report_type": "patient_clinical_summary",
            "message": "Multiple patients matched. Please choose one patient.",
            "matches": matches,
        },
    )


def _patient_clinical_summary_dict(summary_items: list[dict]) -> dict:
    summary_by_label = {
        _safe_text(item.get("label"), "").lower(): _safe_text(item.get("value"))
        for item in summary_items
    }

    return {
        "total": summary_by_label.get("total screenings", "0"),
        "latestResult": summary_by_label.get("latest result", "N/A"),
        "latestConfidence": summary_by_label.get("latest confidence", "N/A"),
        "highestConfidence": summary_by_label.get("highest confidence", "N/A"),
        "latestScreening": summary_by_label.get("latest screening", "N/A"),
        "eyesScreened": summary_by_label.get("eyes screened", "N/A"),
    }


async def _preview_patient_clinical_summary_report(
    payload: ReportAssistantPreviewRequest,
    db: Session,
    current_user: User,
) -> dict:
    patient_row = await _resolve_patient_for_report(payload.filters, db)
    patient_id = str(patient_row.get("patient_id"))

    generated_by = _get_user_display_name(current_user)
    clinic_name = await _get_system_setting(
        db=db,
        set_code="CLINIC_NAME",
        fallback="Clinic Name",
    )

    report_payload, _, record_count = await _build_patient_clinical_report_payload(
        patient_id=patient_id,
        db=db,
        current_user=current_user,
        clinic_name=clinic_name,
        generated_by=generated_by,
    )

    patient_name = _patient_name(
        patient_row.get("first_name"), patient_row.get("last_name")
    )
    patient_code = _safe_text(patient_row.get("patient_code"))

    return {
        "report_type": "patient_clinical_summary",
        "title": "Patient Clinical Summary Report",
        "filters": {
            "patient_id": patient_id,
            "patient_code": patient_code,
            "patient_name": patient_name,
        },
        "summary": _patient_clinical_summary_dict(report_payload.get("summary", [])),
        "rows": report_payload.get("history_rows", []),
        "patient": report_payload.get("patient", {}),
        "chart_points": report_payload.get("chart_points", []),
        "record_count": record_count,
        "generated_by": generated_by,
        "generated_date": datetime.now().strftime("%Y-%m-%d %H:%M"),
    }


@router.post("/assistant/interpret")
async def interpret_assistant_report(
    payload: ReportAssistantInterpretRequest,
    current_user: User = Depends(get_current_user),
):
    logger.info(
        "Report assistant LLM interpretation requested | user_id=%s",
        getattr(current_user, "user_id", None),
    )

    try:
        return await interpret_report_assistant_prompt(payload.prompt)

    except ReportAssistantLLMDisabled as error:
        raise HTTPException(
            status_code=503,
            detail=str(error),
        ) from error

    except httpx.HTTPError as error:
        logger.exception(
            "Report assistant LLM provider request failed | user_id=%s",
            getattr(current_user, "user_id", None),
        )

        raise HTTPException(
            status_code=502,
            detail="Report assistant LLM provider is unavailable.",
        ) from error

    except ReportAssistantLLMError as error:
        logger.exception(
            "Report assistant LLM interpretation failed | user_id=%s",
            getattr(current_user, "user_id", None),
        )

        raise HTTPException(
            status_code=422,
            detail=str(error),
        ) from error


@router.post("/assistant/preview")
async def preview_assistant_report(
    payload: ReportAssistantPreviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    logger.info(
        "Report assistant preview requested | user_id=%s | report_type=%s | filters=%s",
        getattr(current_user, "user_id", None),
        payload.report_type,
        _filters_to_dict(payload.filters),
    )

    date_start, date_end, date_label = _resolve_date_filter(payload.filters)

    if payload.report_type == "patient_clinical_summary":
        return await _preview_patient_clinical_summary_report(
            payload=payload,
            db=db,
            current_user=current_user,
        )

    if payload.report_type == "follow_up_list":
        return await _preview_follow_up_list_report(
            payload=payload,
            db=db,
            current_user=current_user,
            date_start=date_start,
            date_end=date_end,
            date_label=date_label,
        )

    if payload.report_type == "referral_list":
        return await _preview_referral_list_report(
            payload=payload,
            db=db,
            current_user=current_user,
            date_start=date_start,
            date_end=date_end,
            date_label=date_label,
        )

    if payload.report_type == "user_list":
        return await _preview_user_list_report(
            payload=payload,
            db=db,
            current_user=current_user,
            date_start=date_start,
            date_end=date_end,
            date_label=date_label,
        )

    if payload.report_type == "screening_summary":
        return await _preview_screening_summary_report(
            payload=payload,
            db=db,
            current_user=current_user,
            date_start=date_start,
            date_end=date_end,
            date_label=date_label,
        )

    params = {
        "model_used": ENSEMBLE_MODEL_USED,
    }

    where_clauses = ["rn = 1"]

    if payload.filters.status:
        params["is_active"] = payload.filters.status == "active"
        where_clauses.append("is_active = :is_active")

    if payload.filters.diagnosis:
        params["diagnosis"] = payload.filters.diagnosis
        where_clauses.append("prediction = :diagnosis")

    if payload.filters.eye_side:
        params["eye_side"] = payload.filters.eye_side
        where_clauses.append("eye_side = :eye_side")

    if date_start:
        params["date_start"] = date_start
        where_clauses.append("last_screening >= :date_start")

    if date_end:
        params["date_end_exclusive"] = date_end + timedelta(days=1)
        where_clauses.append("last_screening < :date_end_exclusive")

    if payload.report_type == "high_risk":
        where_clauses.append(
            "(prediction = 'glaucoma' OR ohts_tier IN ('possible', 'critical'))"
        )

    _add_patient_search_filter(
        params=params,
        where_clauses=where_clauses,
        filters=payload.filters,
        columns=[
            "patient_code",
            "first_name",
            "last_name",
            "CONCAT(first_name, ' ', last_name)",
        ],
    )

    where_sql = " AND ".join(where_clauses)

    query = text(f"""
        WITH latest_results AS (
            SELECT
                p.patient_id,
                p.patient_code,
                p.first_name,
                p.last_name,
                p.dob,
                p.gender,
                p.is_active,
                s.eye_side,
                s.created_at AS last_screening,
                sr.prediction,
                sr.confidence_score,
                sr.ohts_score,
                sr.ohts_tier,
                sr.cdr,
                sr.gradcam_path,
                COALESCE(
                    NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''),
                    'N/A'
                ) AS clinician,
                ROW_NUMBER() OVER (
                    PARTITION BY p.patient_id
                    ORDER BY s.created_at DESC NULLS LAST, sr.created_at DESC NULLS LAST
                ) AS rn
            FROM patients p
            LEFT JOIN screenings s
                ON s.patient_id = p.patient_id
               AND s.status = 'complete'
            LEFT JOIN screening_results sr
                ON sr.screening_id = s.screening_id
               AND sr.model_used = :model_used
            LEFT JOIN users u
                ON u.user_id = s.screened_by
        )
        SELECT
            patient_code,
            first_name,
            last_name,
            dob,
            gender,
            is_active,
            eye_side,
            last_screening,
            prediction,
            confidence_score,
            ohts_score,
            ohts_tier,
            cdr,
            gradcam_path,
            clinician
        FROM latest_results
        WHERE {where_sql}
        ORDER BY last_name ASC, first_name ASC
        LIMIT 500
    """)

    result = db.execute(query, params)

    if isawaitable(result):
        result = await result

    rows = result.mappings().all()

    logger.info(
        "Report assistant preview query completed | report_type=%s | row_count=%s",
        payload.report_type,
        len(rows),
    )

    response_rows = []

    for row in rows:
        status = _patient_status_label(row.get("is_active"))
        diagnosis = _safe_text(row.get("prediction"), "N/A")

        response_rows.append(
            {
                "patientId": _safe_text(row.get("patient_code")),
                "name": _patient_name(row.get("first_name"), row.get("last_name")),
                "dob": _format_date(row.get("dob")),
                "ageGender": (
                    f"{_calculate_age(row.get('dob'))} / "
                    f"{_safe_text(row.get('gender')).title()}"
                ),
                "status": status,
                "eye": _safe_text(row.get("eye_side")).title(),
                "diagnosis": diagnosis,
                "confidence": _format_percent(row.get("confidence_score")),
                "ohts": _ohts_display(
                    {
                        "ohts_tier": row.get("ohts_tier"),
                        "ohts_score": row.get("ohts_score"),
                    }
                ),
                "cdr": _format_number(row.get("cdr"), 3),
                "gradcam": _has_gradcam(
                    {
                        "gradcam_path": row.get("gradcam_path"),
                    }
                ),
                "lastScreening": _format_date(row.get("last_screening")),
                "risk": _risk_label(row.get("prediction"), row.get("ohts_tier")),
                "clinician": _safe_text(row.get("clinician")),
            }
        )

    summary = {
        "total": len(response_rows),
        "active": sum(1 for row in response_rows if row["status"] == "active"),
        "inactive": sum(1 for row in response_rows if row["status"] == "inactive"),
        "glaucoma": sum(1 for row in response_rows if row["diagnosis"] == "glaucoma"),
        "normal": sum(1 for row in response_rows if row["diagnosis"] == "normal"),
    }

    if payload.report_type == "high_risk":
        title = "High Risk Report"
    else:
        title = "Patient List Report"

    return {
        "report_type": payload.report_type,
        "title": title,
        "filters": {
            key: value
            for key, value in {
                "status": payload.filters.status,
                "diagnosis": payload.filters.diagnosis,
                "eye_side": payload.filters.eye_side,
                "patient_query": _get_patient_search_value(payload.filters),
                "date_from": date_start.isoformat() if date_start else None,
                "date_to": date_end.isoformat() if date_end else None,
                "date_label": date_label,
            }.items()
            if value is not None
        },
        "summary": summary,
        "rows": response_rows,
        "generated_by": f"{current_user.first_name} {current_user.last_name}",
        "generated_date": datetime.now().strftime("%Y-%m-%d %H:%M"),
    }


def _assistant_filter_labels(filters: dict) -> list[str]:
    labels = []

    status = filters.get("status")
    diagnosis = filters.get("diagnosis")
    eye_side = filters.get("eye_side")
    role = filters.get("role")
    patient_name = filters.get("patient_name")
    patient_code = filters.get("patient_code")
    patient_query = filters.get("patient_query")
    date_label = filters.get("date_label")
    date_from = filters.get("date_from")
    date_to = filters.get("date_to")
    days_since_last_screening = filters.get("days_since_last_screening")

    if patient_name:
        patient_label = (
            f"{patient_name} ({patient_code})" if patient_code else patient_name
        )
        labels.append(f"Patient: {patient_label}")
    elif patient_query:
        labels.append(f"Patient: {patient_query}")

    if status:
        labels.append(f"Status: {status.title()}")

    if diagnosis:
        labels.append(f"Diagnosis: {diagnosis.title()}")

    if eye_side:
        labels.append(f"Eye: {eye_side.title()}")

    if role:
        labels.append(f"Role: {role.title()}")

    if days_since_last_screening:
        day_label = "day" if int(days_since_last_screening) == 1 else "days"
        labels.append(f"No follow-up within: {days_since_last_screening} {day_label}")

    if date_label:
        labels.append(f"Date range: {date_label}")
    elif date_from and date_to:
        labels.append(f"Date range: {date_from} to {date_to}")

    return labels


def _build_assistant_tabular_payload(
    preview_data: dict,
    clinic_name: str,
    generated_by: str,
) -> dict:
    report_type = preview_data.get("report_type", "assistant_report")
    summary = preview_data.get("summary", {})
    filters = preview_data.get("filters", {})
    rows = preview_data.get("rows", [])

    if report_type == "follow_up_list":
        tabular_rows = []

        for row in rows:
            tabular_rows.append(
                {
                    "last_screening": _format_date_display(row.get("lastScreening")),
                    "patient_id": _safe_text(row.get("patientId")),
                    "patient_name": _safe_text(row.get("name")),
                    "age_gender": _safe_text(row.get("ageGender")),
                    "eye": _safe_text(row.get("eye")),
                    "prediction": _safe_text(row.get("diagnosis")).title(),
                    "confidence": _safe_text(row.get("confidence")),
                    "ohts": _safe_text(row.get("ohts")),
                    "cdr": _safe_text(row.get("cdr")),
                    "days_elapsed": _safe_text(row.get("daysElapsed")),
                    "referral_status": _safe_text(row.get("referralStatus")),
                    "clinician": _safe_text(row.get("clinician")),
                    "follow_up_reason": _safe_text(row.get("followUpReason")),
                }
            )

        columns = [
            {"key": "last_screening", "label": "Last Screening", "width": 0.10},
            {"key": "patient_id", "label": "Patient ID", "width": 0.08},
            {"key": "patient_name", "label": "Patient Name", "width": 0.13},
            {"key": "age_gender", "label": "Age / Gender", "width": 0.08},
            {"key": "eye", "label": "Eye", "width": 0.05},
            {"key": "prediction", "label": "Prediction", "width": 0.08},
            {"key": "confidence", "label": "Confidence", "width": 0.07},
            {"key": "ohts", "label": "OHTS", "width": 0.08},
            {"key": "cdr", "label": "CDR", "width": 0.05},
            {"key": "days_elapsed", "label": "Days", "width": 0.05},
            {"key": "referral_status", "label": "Referral", "width": 0.08},
            {"key": "clinician", "label": "Screened By", "width": 0.10},
            {"key": "follow_up_reason", "label": "Follow-up Reason", "width": 0.15},
        ]

        caption = "Follow-up list report generated from high-risk screening records without recent follow-up."
        footer_note = (
            "Clinical note: This report flags high-risk screening records that may need follow-up review. "
            "It does not replace professional clinical judgement or local recall protocols."
        )

        summary_items = [
            {"label": "Follow-up needed", "value": str(summary.get("total", 0))},
            {"label": "Glaucoma", "value": str(summary.get("glaucoma", 0))},
            {"label": "Possible OHTS", "value": str(summary.get("possibleOhts", 0))},
            {"label": "Critical OHTS", "value": str(summary.get("criticalOhts", 0))},
            {"label": "With referral", "value": str(summary.get("withReferral", 0))},
            {
                "label": "Without referral",
                "value": str(summary.get("withoutReferral", 0)),
            },
            {
                "label": "Average days elapsed",
                "value": str(summary.get("averageDaysElapsed", "N/A")),
            },
        ]

    elif report_type == "referral_list":
        tabular_rows = []

        for row in rows:
            tabular_rows.append(
                {
                    "referral_date": _format_date_display(row.get("referralDate")),
                    "patient_id": _safe_text(row.get("patientId")),
                    "patient_name": _safe_text(row.get("name")),
                    "age_gender": _safe_text(row.get("ageGender")),
                    "eye": _safe_text(row.get("eye")),
                    "prediction": _safe_text(row.get("diagnosis")).title(),
                    "confidence": _safe_text(row.get("confidence")),
                    "cdr": _safe_text(row.get("cdr")),
                    "ohts": _safe_text(row.get("ohts")),
                    "llm": _safe_text(row.get("llm")),
                    "signed_by": _safe_text(row.get("signedBy")),
                    "clinician": _safe_text(row.get("clinician")),
                }
            )

        columns = [
            {"key": "referral_date", "label": "Referral Date", "width": 0.10},
            {"key": "patient_id", "label": "Patient ID", "width": 0.09},
            {"key": "patient_name", "label": "Patient Name", "width": 0.14},
            {"key": "age_gender", "label": "Age / Gender", "width": 0.09},
            {"key": "eye", "label": "Eye", "width": 0.05},
            {"key": "prediction", "label": "Prediction", "width": 0.08},
            {"key": "confidence", "label": "Confidence", "width": 0.08},
            {"key": "cdr", "label": "CDR", "width": 0.06},
            {"key": "ohts", "label": "OHTS", "width": 0.08},
            {"key": "llm", "label": "LLM", "width": 0.08},
            {"key": "signed_by", "label": "Signed By", "width": 0.10},
            {"key": "clinician", "label": "Screened By", "width": 0.15},
        ]

        caption = (
            "Referral list report generated from validated AI Report Assistant filters."
        )
        footer_note = (
            "Clinical note: This report lists generated referral letters for clinical review and follow-up. "
            "It does not replace professional judgement or referral pathway requirements."
        )

        summary_items = [
            {"label": "Total referrals", "value": str(summary.get("total", 0))},
            {"label": "Glaucoma", "value": str(summary.get("glaucoma", 0))},
            {"label": "Normal", "value": str(summary.get("normal", 0))},
            {"label": "Signed", "value": str(summary.get("signed", 0))},
            {"label": "Unsigned", "value": str(summary.get("unsigned", 0))},
            {"label": "Clinical LLM", "value": "GPT-4o"},
        ]

    elif report_type == "user_list":
        tabular_rows = []

        for row in rows:
            tabular_rows.append(
                {
                    "user_id": _safe_text(row.get("userId")),
                    "user_name": _safe_text(row.get("name")),
                    "role": _safe_text(row.get("role")),
                    "email": _safe_text(row.get("email")),
                    "mobile": _safe_text(row.get("mobile")),
                    "status": _safe_text(row.get("status")).title(),
                    "created_date": _format_date_display(row.get("createdAt")),
                }
            )

        columns = [
            {"key": "user_id", "label": "User ID", "width": 0.11},
            {"key": "user_name", "label": "User Name", "width": 0.20},
            {"key": "role", "label": "Role", "width": 0.10},
            {"key": "email", "label": "Email", "width": 0.24},
            {"key": "mobile", "label": "Mobile", "width": 0.13},
            {"key": "status", "label": "Status", "width": 0.10},
            {"key": "created_date", "label": "Created Date", "width": 0.12},
        ]

        caption = (
            "User list report generated from validated AI Report Assistant filters."
        )
        footer_note = (
            "System note: This report supports user account review and access monitoring only. "
            "Passwords and security hashes are never included."
        )

        summary_items = [
            {"label": "Total users", "value": str(summary.get("total", 0))},
            {"label": "Active", "value": str(summary.get("active", 0))},
            {"label": "Inactive", "value": str(summary.get("inactive", 0))},
            {"label": "Admin", "value": str(summary.get("admin", 0))},
            {"label": "Doctor", "value": str(summary.get("doctor", 0))},
            {"label": "Nurse", "value": str(summary.get("nurse", 0))},
        ]

    elif report_type == "screening_summary":
        tabular_rows = []

        for row in rows:
            tabular_rows.append(
                {
                    "screening_date": _format_date_display(row.get("screeningDate")),
                    "patient_id": _safe_text(row.get("patientId")),
                    "patient_name": _safe_text(row.get("name")),
                    "age_gender": _safe_text(row.get("ageGender")),
                    "eye": _safe_text(row.get("eye")),
                    "prediction": _safe_text(row.get("diagnosis")).title(),
                    "confidence": _safe_text(row.get("confidence")),
                    "cdr": _safe_text(row.get("cdr")),
                    "ohts": _safe_text(row.get("ohts")),
                    "risk": _safe_text(row.get("risk")),
                    "gradcam": _safe_text(row.get("gradcam")),
                    "clinician": _safe_text(row.get("clinician")),
                }
            )

        columns = [
            {"key": "screening_date", "label": "Screening Date", "width": 0.10},
            {"key": "patient_id", "label": "Patient ID", "width": 0.09},
            {"key": "patient_name", "label": "Patient Name", "width": 0.14},
            {"key": "age_gender", "label": "Age / Gender", "width": 0.09},
            {"key": "eye", "label": "Eye", "width": 0.05},
            {"key": "prediction", "label": "Prediction", "width": 0.09},
            {"key": "confidence", "label": "Confidence", "width": 0.08},
            {"key": "cdr", "label": "CDR", "width": 0.06},
            {"key": "ohts", "label": "OHTS", "width": 0.09},
            {"key": "risk", "label": "Risk", "width": 0.06},
            {"key": "gradcam", "label": "Grad-CAM", "width": 0.07},
            {"key": "clinician", "label": "Screened By", "width": 0.08},
        ]

        caption = "Screening summary report generated from validated AI Report Assistant filters."
        footer_note = (
            "Clinical note: This report summarises glaucoma screening activity. "
            "It supports review and follow-up planning only."
        )

        summary_items = [
            {"label": "Total screenings", "value": str(summary.get("total", 0))},
            {"label": "Glaucoma", "value": str(summary.get("glaucoma", 0))},
            {"label": "Normal", "value": str(summary.get("normal", 0))},
            {"label": "High risk", "value": str(summary.get("highRisk", 0))},
            {
                "label": "Average confidence",
                "value": _safe_text(summary.get("averageConfidence")),
            },
            {
                "label": "Grad-CAM generated",
                "value": str(summary.get("gradcamGenerated", 0)),
            },
        ]

    elif report_type == "high_risk":
        tabular_rows = []
        confidence_values = []
        possible_ohts = 0
        critical_ohts = 0

        for row in rows:
            confidence_text = _safe_text(row.get("confidence"), "")

            if confidence_text.endswith("%"):
                try:
                    confidence_values.append(float(confidence_text.replace("%", "")))
                except ValueError:
                    pass

            ohts_text = _safe_text(row.get("ohts"), "").lower()

            if "possible" in ohts_text:
                possible_ohts += 1

            if "critical" in ohts_text:
                critical_ohts += 1

            tabular_rows.append(
                {
                    "patient_id": _safe_text(row.get("patientId")),
                    "patient_name": _safe_text(row.get("name")),
                    "age_gender": _safe_text(row.get("ageGender")),
                    "eye": _safe_text(row.get("eye")),
                    "prediction": _safe_text(row.get("diagnosis")).title(),
                    "confidence": _safe_text(row.get("confidence")),
                    "ohts": _safe_text(row.get("ohts")),
                    "cdr": _safe_text(row.get("cdr")),
                    "screening_date": _format_date_display(row.get("lastScreening")),
                    "gradcam": _safe_text(row.get("gradcam")),
                    "clinician": _safe_text(row.get("clinician")),
                }
            )

        columns = [
            {"key": "patient_id", "label": "Patient ID", "width": 0.10},
            {"key": "patient_name", "label": "Patient Name", "width": 0.15},
            {"key": "age_gender", "label": "Age / Gender", "width": 0.10},
            {"key": "eye", "label": "Eye", "width": 0.06},
            {"key": "prediction", "label": "Prediction", "width": 0.10},
            {"key": "confidence", "label": "Confidence", "width": 0.09},
            {"key": "ohts", "label": "OHTS", "width": 0.10},
            {"key": "cdr", "label": "CDR", "width": 0.07},
            {"key": "screening_date", "label": "Screening Date", "width": 0.11},
            {"key": "gradcam", "label": "Grad-CAM", "width": 0.08},
            {"key": "clinician", "label": "Screened By", "width": 0.14},
        ]

        caption = "High-risk screening report generated from validated AI Report Assistant filters."
        footer_note = (
            "Clinical note: This report supports glaucoma screening review only. "
            "It is not a standalone diagnostic decision."
        )

        average_confidence = (
            sum(confidence_values) / len(confidence_values)
            if confidence_values
            else None
        )

        summary_items = [
            {"label": "High risk cases", "value": str(len(rows))},
            {
                "label": "Average confidence",
                "value": (
                    f"{average_confidence:.0f}%"
                    if average_confidence is not None
                    else "N/A"
                ),
            },
            {"label": "Possible OHTS", "value": str(possible_ohts)},
            {"label": "Critical OHTS", "value": str(critical_ohts)},
        ]

    else:
        tabular_rows = []

        for row in rows:
            tabular_rows.append(
                {
                    "patient_id": _safe_text(row.get("patientId")),
                    "patient_name": _safe_text(row.get("name")),
                    "date_of_birth": _format_date_display(row.get("dob")),
                    "status": _safe_text(row.get("status")).title(),
                    "diagnosis": _safe_text(row.get("diagnosis")).title(),
                    "last_screening": _format_date_display(row.get("lastScreening")),
                    "risk": _safe_text(row.get("risk")),
                    "clinician": _safe_text(row.get("clinician")),
                }
            )

        columns = [
            {"key": "patient_id", "label": "Patient ID", "width": 0.11},
            {"key": "patient_name", "label": "Patient Name", "width": 0.20},
            {"key": "date_of_birth", "label": "Date of Birth", "width": 0.12},
            {"key": "status", "label": "Status", "width": 0.10},
            {"key": "diagnosis", "label": "Diagnosis", "width": 0.12},
            {"key": "last_screening", "label": "Last Screening", "width": 0.13},
            {"key": "risk", "label": "Risk", "width": 0.09},
            {"key": "clinician", "label": "Screened By", "width": 0.13},
        ]

        caption = "Patient list generated from validated AI Report Assistant filters."
        footer_note = (
            "Clinical note: This report supports review and screening follow-up only. "
            "The system does not replace professional clinical assessment."
        )

        summary_items = [
            {"label": "Total records", "value": str(summary.get("total", 0))},
            {"label": "Active", "value": str(summary.get("active", 0))},
            {"label": "Inactive", "value": str(summary.get("inactive", 0))},
            {"label": "Glaucoma", "value": str(summary.get("glaucoma", 0))},
            {"label": "Normal", "value": str(summary.get("normal", 0))},
        ]

    return {
        "report_code": report_type,
        "title": preview_data.get("title", "Report"),
        "caption": caption,
        "clinic_name": _safe_text(clinic_name, "Clinic Name"),
        "generated_date": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "generated_by": _safe_text(generated_by, "System User"),
        "summary": summary_items,
        "filters": _assistant_filter_labels(filters),
        "columns": columns,
        "rows": tabular_rows,
        "footer_note": footer_note,
        "orientation": "L",
    }


def _filters_to_dict(filters: ReportAssistantFilters) -> dict:
    if hasattr(filters, "model_dump"):
        return filters.model_dump(exclude_none=True)

    return filters.dict(exclude_none=True)


def _get_user_display_name(current_user: User) -> str:
    full_name = (
        f"{_safe_text(getattr(current_user, 'first_name', ''), '').strip()} "
        f"{_safe_text(getattr(current_user, 'last_name', ''), '').strip()}"
    ).strip()

    return full_name or "System User"


async def _save_report_history(
    db: Session,
    report_type: str,
    report_title: str,
    generated_by_user_id: Any,
    generated_by_name: str,
    filters: dict,
    record_count: int,
    status: Literal["success", "failed"],
    file_name: str | None = None,
    error_message: str | None = None,
) -> None:
    try:
        history = ReportHistory(
            report_type=report_type,
            report_title=report_title,
            generated_by_user_id=generated_by_user_id,
            generated_by_name=generated_by_name,
            filters_json=filters or {},
            record_count=record_count,
            status=status,
            file_name=file_name,
            error_message=error_message,
        )

        db.add(history)

        commit_result = db.commit()

        if isawaitable(commit_result):
            await commit_result

        logger.info(
            "Report history saved | history_id=%s | report_type=%s | status=%s | record_count=%s",
            history.report_history_id,
            report_type,
            status,
            record_count,
        )

    except SQLAlchemyError:
        rollback_result = db.rollback()

        if isawaitable(rollback_result):
            await rollback_result

        logger.exception(
            "Failed to save report history | report_type=%s | status=%s | file_name=%s",
            report_type,
            status,
            file_name,
        )


def _format_report_history_row(row: ReportHistory) -> dict:
    filters = row.filters_json or {}

    if isinstance(filters, str):
        try:
            filters = json.loads(filters)
        except json.JSONDecodeError:
            filters = {}

    return {
        "reportHistoryId": str(row.report_history_id),
        "reportType": row.report_type,
        "reportTitle": row.report_title,
        "generatedByUserId": (
            str(row.generated_by_user_id) if row.generated_by_user_id else None
        ),
        "generatedByName": row.generated_by_name,
        "filters": filters,
        "recordCount": row.record_count,
        "status": row.status,
        "fileName": row.file_name,
        "errorMessage": row.error_message,
        "createdAt": row.created_at.isoformat() if row.created_at else None,
    }


@router.post("/assistant/pdf-go")
async def export_assistant_report_pdf_go(
    payload: ReportAssistantPreviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    generated_by = _get_user_display_name(current_user)
    generated_by_user_id = getattr(current_user, "user_id", None)

    logger.info(
        "Assistant PDF export requested | user_id=%s | report_type=%s | filters=%s",
        generated_by_user_id,
        payload.report_type,
        _filters_to_dict(payload.filters),
    )

    if payload.report_type == "patient_clinical_summary":
        patient_row = await _resolve_patient_for_report(payload.filters, db)
        return await export_patient_clinical_pdf_go(
            patient_id=str(patient_row.get("patient_id")),
            db=db,
            current_user=current_user,
        )

    preview_data = payload.preview_data

    if preview_data:
        preview_data = dict(preview_data)
    else:
        preview_data = await preview_assistant_report(
            payload=payload,
            db=db,
            current_user=current_user,
        )

    preview_data["filters"] = {
        **_filters_to_dict(payload.filters),
        **(preview_data.get("filters") or {}),
    }

    clinic_name = await _get_system_setting(
        db=db,
        set_code="CLINIC_NAME",
        fallback="Clinic Name",
    )

    go_payload = _build_assistant_tabular_payload(
        preview_data=preview_data,
        clinic_name=clinic_name,
        generated_by=generated_by,
    )

    filename = (
        f"{payload.report_type}_report_go_"
        f"{datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}.pdf"
    )

    report_title = _safe_text(preview_data.get("title"), "Report")
    filters = preview_data.get("filters", {})
    record_count = len(preview_data.get("rows", []))

    try:
        logger.info(
            "Calling Go tabular PDF service | report_type=%s | record_count=%s",
            payload.report_type,
            record_count,
        )

        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                _get_report_service_url("/reports/tabular/pdf"),
                json=go_payload,
            )
            response.raise_for_status()

        await _save_report_history(
            db=db,
            report_type=payload.report_type,
            report_title=report_title,
            generated_by_user_id=generated_by_user_id,
            generated_by_name=generated_by,
            filters=filters,
            record_count=record_count,
            status="success",
            file_name=filename,
            error_message=None,
        )

        logger.info(
            "Assistant PDF export completed | report_type=%s | file_name=%s | record_count=%s",
            payload.report_type,
            filename,
            record_count,
        )

    except httpx.HTTPError as error:
        error_message = (
            "Go report service tabular PDF endpoint is unavailable: " f"{str(error)}"
        )

        await _save_report_history(
            db=db,
            report_type=payload.report_type,
            report_title=report_title,
            generated_by_user_id=generated_by_user_id,
            generated_by_name=generated_by,
            filters=filters,
            record_count=record_count,
            status="failed",
            file_name=filename,
            error_message=error_message,
        )

        logger.exception(
            "Assistant PDF export failed | report_type=%s | file_name=%s",
            payload.report_type,
            filename,
        )

        raise HTTPException(
            status_code=503,
            detail=error_message,
        )

    return StreamingResponse(
        iter([response.content]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _format_datetime_display(value: Any) -> str:
    if value is None:
        return "N/A"

    if isinstance(value, datetime):
        value_datetime = value
    else:
        try:
            value_datetime = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return _safe_text(value)

    return (
        value_datetime.strftime("%d %b %Y, %I:%M %p")
        .replace("AM", "am")
        .replace("PM", "pm")
    )


def _format_axis_label(value: Any, same_day_only: bool) -> str:
    if value is None:
        return "N/A"

    if isinstance(value, datetime):
        value_datetime = value
    else:
        try:
            value_datetime = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return _format_date_display(value)

    if same_day_only:
        return (
            value_datetime.strftime("%I:%M %p")
            .lstrip("0")
            .replace("AM", "am")
            .replace("PM", "pm")
        )

    return value_datetime.strftime("%d %b %Y")


def _result_label(prediction: Any) -> str:
    prediction_text = _safe_text(prediction, "").lower()

    if prediction_text == "glaucoma":
        return "Possible glaucoma signs"

    if prediction_text == "normal":
        return "No glaucoma signs"

    return "Result pending"


def _format_clinical_measurement(value: Any, unit: str) -> str:
    if value is None:
        return "N/A"

    number_text = _format_number(value, 1)

    if number_text == "N/A":
        return "N/A"

    return f"{number_text} {unit}"


def _safe_filename(value: str, fallback: str = "report") -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "_", value or fallback).strip("_")
    return cleaned or fallback


async def _build_patient_clinical_report_payload(
    patient_id: str,
    db: Session,
    current_user: User,
    clinic_name: str,
    generated_by: str,
) -> tuple[dict, str, int]:
    patient_result = db.execute(
        text("""
            SELECT
                p.patient_id,
                p.patient_code,
                p.first_name,
                p.last_name,
                p.dob,
                p.gender,
                p.mobile_number,
                p.email,
                p.iop,
                p.cct,
                p.is_active
            FROM patients p
            WHERE p.patient_id = :patient_id
            LIMIT 1
        """),
        {"patient_id": patient_id},
    )

    if isawaitable(patient_result):
        patient_result = await patient_result

    patient_row = patient_result.mappings().first()

    if not patient_row:
        raise HTTPException(status_code=404, detail="Patient not found.")

    screenings_result = db.execute(
        text("""
            SELECT
                s.screening_id,
                s.created_at AS screening_date,
                s.eye_side,
                s.status,
                sr.prediction,
                sr.confidence_score,
                sr.ohts_score,
                sr.ohts_tier,
                sr.cdr,
                sr.model_used,
                COALESCE(
                    NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''),
                    'N/A'
                ) AS clinician
            FROM screenings s
            LEFT JOIN screening_results sr
                ON sr.screening_id = s.screening_id
               AND sr.model_used = :model_used
               AND sr.llm_used IS NULL
            LEFT JOIN users u
                ON u.user_id = s.screened_by
            WHERE s.patient_id = :patient_id
              AND s.status = 'complete'
            ORDER BY s.created_at ASC, s.eye_side ASC
        """),
        {"patient_id": patient_id, "model_used": ENSEMBLE_MODEL_USED},
    )

    if isawaitable(screenings_result):
        screenings_result = await screenings_result

    screening_rows = list(screenings_result.mappings().all())

    patient_name = _patient_name(
        patient_row.get("first_name"), patient_row.get("last_name")
    )
    patient_code = _safe_text(patient_row.get("patient_code"))

    confidence_values: list[float] = []

    for row in screening_rows:
        confidence_score = row.get("confidence_score")

        if confidence_score is None:
            continue

        try:
            confidence = float(confidence_score)
        except (TypeError, ValueError):
            continue

        if confidence <= 1:
            confidence = confidence * 100

        confidence_values.append(confidence)

    latest_row = screening_rows[-1] if screening_rows else None
    latest_confidence = None
    highest_confidence = max(confidence_values) if confidence_values else None

    if latest_row and latest_row.get("confidence_score") is not None:
        try:
            latest_confidence = float(latest_row.get("confidence_score"))
            if latest_confidence <= 1:
                latest_confidence = latest_confidence * 100
        except (TypeError, ValueError):
            latest_confidence = None

    same_day_only = False

    if screening_rows:
        date_keys = {
            (
                row.get("screening_date").date().isoformat()
                if isinstance(row.get("screening_date"), datetime)
                else str(row.get("screening_date")).split("T")[0].split(" ")[0]
            )
            for row in screening_rows
            if row.get("screening_date") is not None
        }
        same_day_only = len(date_keys) == 1

    chart_points = []
    history_rows = []

    for row in screening_rows:
        confidence_score = row.get("confidence_score")
        confidence_percent = None

        if confidence_score is not None:
            try:
                confidence_percent = float(confidence_score)
                if confidence_percent <= 1:
                    confidence_percent = confidence_percent * 100
            except (TypeError, ValueError):
                confidence_percent = None

        if confidence_percent is not None:
            chart_points.append(
                {
                    "date_time": (
                        row.get("screening_date").isoformat()
                        if row.get("screening_date")
                        else None
                    ),
                    "axis_label": _format_axis_label(
                        row.get("screening_date"), same_day_only
                    ),
                    "eye": _safe_text(row.get("eye_side")).title(),
                    "result": _safe_text(row.get("prediction"), "pending"),
                    "confidence": round(confidence_percent, 1),
                }
            )

        history_rows.append(
            {
                "screening_date": _format_datetime_display(row.get("screening_date")),
                "eye": _safe_text(row.get("eye_side")).title(),
                "result": _result_label(row.get("prediction")),
                "confidence": _format_percent(row.get("confidence_score"), 1),
                "ohts": _ohts_display(
                    {
                        "ohts_tier": row.get("ohts_tier"),
                        "ohts_score": row.get("ohts_score"),
                    }
                ),
                "cdr": _format_number(row.get("cdr"), 3),
                "clinician": _safe_text(row.get("clinician")),
            }
        )

    summary_items = [
        {"label": "Total screenings", "value": str(len(screening_rows))},
        {
            "label": "Latest result",
            "value": (
                _result_label(latest_row.get("prediction")) if latest_row else "N/A"
            ),
        },
        {
            "label": "Latest confidence",
            "value": (
                f"{latest_confidence:.1f}%" if latest_confidence is not None else "N/A"
            ),
        },
        {
            "label": "Highest confidence",
            "value": (
                f"{highest_confidence:.1f}%"
                if highest_confidence is not None
                else "N/A"
            ),
        },
        {
            "label": "Latest screening",
            "value": (
                _format_datetime_display(latest_row.get("screening_date"))
                if latest_row
                else "N/A"
            ),
        },
        {
            "label": "Eyes screened",
            "value": ", ".join(
                sorted(
                    {
                        _safe_text(row.get("eye_side")).title()
                        for row in screening_rows
                        if row.get("eye_side")
                    }
                )
            )
            or "N/A",
        },
    ]

    payload = {
        "report_code": "patient_clinical_summary",
        "title": "Patient Clinical Summary Report",
        "caption": "Patient-level screening summary with longitudinal risk tracking. This is a clinical support report, not a standalone diagnosis.",
        "clinic_name": _safe_text(clinic_name, "Clinic Name"),
        "generated_date": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "generated_by": generated_by,
        "patient": {
            "patient_id": patient_code,
            "patient_name": patient_name,
            "dob": _format_date_display(patient_row.get("dob")),
            "age": f"{_calculate_age(patient_row.get('dob'))} years",
            "gender": _safe_text(patient_row.get("gender")).title(),
            "contact": _safe_text(patient_row.get("mobile_number")),
            "email": _safe_text(patient_row.get("email")),
            "iop": _format_clinical_measurement(patient_row.get("iop"), "mmHg"),
            "cct": _format_clinical_measurement(patient_row.get("cct"), "um"),
            "status": _patient_status_label(patient_row.get("is_active")).title(),
        },
        "summary": summary_items,
        "chart_points": chart_points,
        "history_rows": history_rows,
        "footer_note": "Clinical note: This report supports glaucoma screening review only. It is not a standalone diagnostic decision.",
    }

    filename_base = _safe_filename(
        f"patient_clinical_summary_{patient_code}_{patient_name}_{datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}",
        "patient_clinical_summary",
    )

    return payload, filename_base, len(history_rows)


@router.get("/patient-clinical/pdf")
async def export_patient_clinical_pdf_go(
    patient_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    generated_by = _get_user_display_name(current_user)
    generated_by_user_id = getattr(current_user, "user_id", None)

    clinic_name = await _get_system_setting(
        db=db,
        set_code="CLINIC_NAME",
        fallback="Clinic Name",
    )

    go_payload, filename_base, record_count = (
        await _build_patient_clinical_report_payload(
            patient_id=patient_id,
            db=db,
            current_user=current_user,
            clinic_name=clinic_name,
            generated_by=generated_by,
        )
    )

    filename = f"{filename_base}.pdf"
    filters = {
        "patient_id": go_payload["patient"].get("patient_id"),
        "patient_name": go_payload["patient"].get("patient_name"),
    }

    try:
        logger.info(
            "Calling Go patient clinical PDF service | patient_id=%s | record_count=%s",
            patient_id,
            record_count,
        )

        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                _get_report_service_url("/reports/patient-clinical/pdf"),
                json=go_payload,
            )
            response.raise_for_status()

        await _save_report_history(
            db=db,
            report_type="patient_clinical_summary",
            report_title="Patient Clinical Summary Report",
            generated_by_user_id=generated_by_user_id,
            generated_by_name=generated_by,
            filters=filters,
            record_count=record_count,
            status="success",
            file_name=filename,
            error_message=None,
        )

    except httpx.HTTPError as error:
        error_message = (
            "Go report service patient clinical PDF endpoint is unavailable: "
            f"{str(error)}"
        )

        await _save_report_history(
            db=db,
            report_type="patient_clinical_summary",
            report_title="Patient Clinical Summary Report",
            generated_by_user_id=generated_by_user_id,
            generated_by_name=generated_by,
            filters=filters,
            record_count=record_count,
            status="failed",
            file_name=filename,
            error_message=error_message,
        )

        logger.exception(
            "Patient clinical PDF export failed | patient_id=%s | file_name=%s",
            patient_id,
            filename,
        )

        raise HTTPException(status_code=503, detail=error_message)

    return StreamingResponse(
        iter([response.content]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/history")
async def get_report_history(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    logger.info(
        "Report history requested | user_id=%s | limit=%s | offset=%s",
        getattr(current_user, "user_id", None),
        limit,
        offset,
    )

    try:
        stmt = (
            select(ReportHistory)
            .order_by(ReportHistory.created_at.desc())
            .offset(offset)
            .limit(limit)
        )

        result = db.execute(stmt)

        if isawaitable(result):
            result = await result

        rows = result.scalars().all()

        logger.info(
            "Report history returned | user_id=%s | count=%s",
            getattr(current_user, "user_id", None),
            len(rows),
        )

        return {
            "items": [_format_report_history_row(row) for row in rows],
            "limit": limit,
            "offset": offset,
        }

    except SQLAlchemyError:
        logger.exception(
            "Failed to fetch report history | user_id=%s",
            getattr(current_user, "user_id", None),
        )

        raise HTTPException(
            status_code=500,
            detail="Unable to fetch report history.",
        )


def _build_high_risk_pdf(
    rows: list[dict],
    start_date: date,
    end_date: date,
    clinic_name: str,
    generated_by: str,
) -> BytesIO:
    buffer = BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        rightMargin=0.7 * cm,
        leftMargin=0.7 * cm,
        topMargin=0.6 * cm,
        bottomMargin=1.2 * cm,
    )

    page_width, _ = landscape(A4)
    content_width = page_width - doc.leftMargin - doc.rightMargin
    styles = getSampleStyleSheet()

    normal_style = ParagraphStyle(
        "ReportNormal",
        parent=styles["Normal"],
        fontSize=10,
        leading=12,
    )

    small_style = ParagraphStyle(
        "ReportSmall",
        parent=styles["Normal"],
        fontSize=8,
        leading=9,
    )

    right_header_style = ParagraphStyle(
        "RightHeader",
        parent=styles["Normal"],
        fontSize=10,
        leading=12,
        alignment=TA_RIGHT,
    )

    story = []
    logo_path = _find_logo_path()

    if logo_path:
        logo_cell = RLImage(str(logo_path), width=5.5 * cm, height=1.4 * cm)
    else:
        logo_cell = Paragraph("Glaucoma AI", styles["Title"])

    generated_by_text = escape(_safe_text(generated_by, "System User"))

    report_title = Paragraph(
        "<b>High Risk Report</b><br/>"
        f"Report period: {start_date} to {end_date}<br/>"
        f"Generated date: {datetime.now().strftime('%Y-%m-%d %H:%M')}<br/>"
        f"Generated by: {generated_by_text}",
        right_header_style,
    )

    header_table = Table(
        [[logo_cell, report_title]],
        colWidths=[content_width * 0.50, content_width * 0.50],
    )

    header_table.hAlign = "LEFT"
    header_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ALIGN", (0, 0), (0, 0), "LEFT"),
                ("ALIGN", (1, 0), (1, 0), "RIGHT"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )

    story.append(header_table)
    story.append(Paragraph(_safe_text(clinic_name, "Clinic Name"), normal_style))
    story.append(Spacer(1, 1.0 * cm))

    confidences = []

    for row in rows:
        value = row.get("confidence_score")
        if value is not None:
            try:
                confidences.append(float(value))
            except (TypeError, ValueError):
                pass

    average_confidence = sum(confidences) / len(confidences) if confidences else None

    possible_ohts = sum(
        1 for row in rows if "possible" in _safe_text(row.get("ohts_tier"), "").lower()
    )

    critical_ohts = sum(
        1 for row in rows if "critical" in _safe_text(row.get("ohts_tier"), "").lower()
    )

    summary_data = [
        ["High risk cases", str(len(rows))],
        ["Average confidence", _format_percent(average_confidence)],
        ["Possible OHTS", str(possible_ohts)],
        ["Critical OHTS", str(critical_ohts)],
    ]

    summary_table = Table(
        summary_data,
        colWidths=[4.0 * cm, 2.6 * cm],
    )

    summary_table.hAlign = "LEFT"
    summary_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.4, colors.black),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )

    story.append(summary_table)
    story.append(Spacer(1, 0.6 * cm))

    table_rows = [
        [
            "Code",
            "Patient",
            "Age / Gender",
            "Eye",
            "Prediction",
            "Confidence",
            "OHTS",
            "CDR",
            "Screening Date",
            "Grad Cam",
        ]
    ]

    for row in rows:
        table_rows.append(
            [
                Paragraph(_safe_text(row.get("patient_code")), small_style),
                Paragraph(_safe_text(row.get("patient_name")), small_style),
                Paragraph(
                    f"{_calculate_age(row.get('dob'))} / {_safe_text(row.get('gender')).title()}",
                    small_style,
                ),
                Paragraph(_safe_text(row.get("eye_side")).title(), small_style),
                Paragraph(_safe_text(row.get("prediction")), small_style),
                Paragraph(_format_percent(row.get("confidence_score")), small_style),
                Paragraph(_ohts_display(row), small_style),
                Paragraph(_format_number(row.get("cdr"), 3), small_style),
                Paragraph(_format_date(row.get("created_at")), small_style),
                Paragraph(_has_gradcam(row), small_style),
            ]
        )

    while len(table_rows) < 9:
        table_rows.append(["", "", "", "", "", "", "", "", "", ""])

    report_col_widths = [
        content_width * 0.13,
        content_width * 0.14,
        content_width * 0.11,
        content_width * 0.08,
        content_width * 0.10,
        content_width * 0.09,
        content_width * 0.09,
        content_width * 0.07,
        content_width * 0.12,
        content_width * 0.07,
    ]

    report_table = Table(
        table_rows,
        repeatRows=1,
        colWidths=report_col_widths,
    )

    report_table.hAlign = "LEFT"
    report_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.4, colors.black),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, 0), 10),
                ("FONTSIZE", (0, 1), (-1, -1), 8),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )

    story.append(report_table)

    def _draw_footer(canvas, document):
        canvas.saveState()
        canvas.setFont("Helvetica", 9)

        canvas.drawString(
            document.leftMargin,
            0.55 * cm,
            "Clinical note: This report supports glaucoma screening review only. "
            "It is not a standalone diagnostic decision.",
        )

        canvas.drawRightString(
            page_width - document.rightMargin,
            0.55 * cm,
            f"Page {document.page}",
        )

        canvas.restoreState()

    doc.build(
        story,
        onFirstPage=_draw_footer,
        onLaterPages=_draw_footer,
    )

    buffer.seek(0)
    return buffer


def _build_go_high_risk_payload(
    rows: list[dict],
    start_date: str,
    end_date: str,
    clinic_name: str,
    generated_by: str,
) -> dict:
    confidences = []

    for row in rows:
        value = row.get("confidence_score")
        if value is not None:
            try:
                confidences.append(float(value))
            except (TypeError, ValueError):
                pass

    average_confidence = sum(confidences) / len(confidences) if confidences else None

    possible_ohts = sum(
        1 for row in rows if "possible" in _safe_text(row.get("ohts_tier"), "").lower()
    )

    critical_ohts = sum(
        1 for row in rows if "critical" in _safe_text(row.get("ohts_tier"), "").lower()
    )

    go_rows = []

    for row in rows:
        go_rows.append(
            {
                "code": _safe_text(row.get("patient_code")),
                "patient": _safe_text(row.get("patient_name")),
                "age_gender": f"{_calculate_age(row.get('dob'))} / {_safe_text(row.get('gender')).title()}",
                "eye": _safe_text(row.get("eye_side")).title(),
                "prediction": _safe_text(row.get("prediction")),
                "confidence": _format_percent(row.get("confidence_score")),
                "ohts": _ohts_display(row),
                "cdr": _format_number(row.get("cdr"), 3),
                "screening_date": _format_date(row.get("created_at")),
                "grad_cam": _has_gradcam(row),
            }
        )

    return {
        "clinic_name": _safe_text(clinic_name, "Clinic Name"),
        "report_period": f"{start_date} to {end_date}",
        "generated_date": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "generated_by": _safe_text(generated_by, "System User"),
        "summary": {
            "high_risk_cases": len(rows),
            "average_confidence": _format_percent(average_confidence),
            "possible_ohts": possible_ohts,
            "critical_ohts": critical_ohts,
        },
        "rows": go_rows,
    }


@router.get("/high-risk/pdf")
async def export_high_risk_pdf(
    start_date: str = Query(...),
    end_date: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        start_date_obj = date.fromisoformat(start_date)
        end_date_obj = date.fromisoformat(end_date)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Dates must use YYYY-MM-DD format.",
        )

    if start_date_obj > end_date_obj:
        raise HTTPException(
            status_code=400,
            detail="start_date must be before or equal to end_date.",
        )

    analytics = await get_analytics(
        db=db,
        start_date=start_date,
        end_date=end_date,
    )

    rows = analytics.get("high_risk_screenings", [])

    clinic_name = await _get_system_setting(
        db=db,
        set_code="CLINIC_NAME",
        fallback="Clinic Name",
    )

    generated_by = f"{current_user.first_name} {current_user.last_name}"

    pdf_buffer = _build_high_risk_pdf(
        rows=rows,
        start_date=start_date_obj,
        end_date=end_date_obj,
        clinic_name=clinic_name,
        generated_by=generated_by,
    )

    filename = (
        f"high_risk_report_{start_date}_to_{end_date}_"
        f"{datetime.now().strftime('%H-%M-%S')}.pdf"
    )

    return StreamingResponse(
        pdf_buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/go-health")
async def check_go_report_service_health():
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(_get_report_service_url("/health"))
            response.raise_for_status()

        return {
            "status": "ok",
            "go_service": response.json(),
        }

    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=503,
            detail=f"Go report service is unavailable: {str(error)}",
        )


@router.get("/go-test-pdf")
async def get_go_test_pdf():
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(_get_report_service_url("/reports/test-pdf"))
            response.raise_for_status()

        return StreamingResponse(
            iter([response.content]),
            media_type="application/pdf",
            headers={
                "Content-Disposition": 'attachment; filename="go_test_report_from_fastapi.pdf"'
            },
        )

    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=503,
            detail=f"Go report service PDF endpoint is unavailable: {str(error)}",
        )


@router.get("/high-risk/pdf-go")
async def export_high_risk_pdf_go(
    start_date: str = Query(...),
    end_date: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        start_date_obj = date.fromisoformat(start_date)
        end_date_obj = date.fromisoformat(end_date)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Dates must use YYYY-MM-DD format.",
        )

    if start_date_obj > end_date_obj:
        raise HTTPException(
            status_code=400,
            detail="start_date must be before or equal to end_date.",
        )

    analytics = await get_analytics(
        db=db,
        start_date=start_date,
        end_date=end_date,
    )

    rows = analytics.get("high_risk_screenings", [])

    clinic_name = await _get_system_setting(
        db=db,
        set_code="CLINIC_NAME",
        fallback="Clinic Name",
    )

    generated_by = f"{current_user.first_name} {current_user.last_name}"

    payload = _build_go_high_risk_payload(
        rows=rows,
        start_date=start_date,
        end_date=end_date,
        clinic_name=clinic_name,
        generated_by=generated_by,
    )

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                _get_report_service_url("/reports/high-risk/pdf"),
                json=payload,
            )
            response.raise_for_status()

    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=503,
            detail=f"Go report service High Risk PDF endpoint is unavailable: {str(error)}",
        )

    filename = (
        f"high_risk_report_go_{start_date}_to_{end_date}_"
        f"{datetime.now().strftime('%H-%M-%S')}.pdf"
    )

    return StreamingResponse(
        iter([response.content]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
