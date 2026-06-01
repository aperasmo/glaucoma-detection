# backend/app/api/routes/reports.py

from datetime import date, datetime
from io import BytesIO
from typing import Any, Literal
from pathlib import Path
from inspect import isawaitable
from html import escape

import httpx

from pydantic import BaseModel, Field

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import text

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
from app.models.user import User


router = APIRouter(prefix="/reports", tags=["Reports"])


class ReportAssistantFilters(BaseModel):
    status: Literal["active", "inactive"] | None = None
    diagnosis: Literal["glaucoma", "normal"] | None = None
    date_range: Literal["this_week", "this_month"] | None = None


class ReportAssistantPreviewRequest(BaseModel):
    report_type: Literal["patient_list", "high_risk", "screening_summary"]
    filters: ReportAssistantFilters = Field(default_factory=ReportAssistantFilters)
    format: Literal["pdf"] = "pdf"


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


def _date_range_start(date_range: str | None) -> date | None:
    today = date.today()

    if date_range == "this_week":
        return date.fromordinal(today.toordinal() - 7)

    if date_range == "this_month":
        return date(today.year, today.month, 1)

    return None


@router.post("/assistant/preview")
async def preview_assistant_report(
    payload: ReportAssistantPreviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if payload.report_type == "screening_summary":
        raise HTTPException(
            status_code=400,
            detail="Screening Summary Report preview will be added after Patient List Report.",
        )

    params = {
        "model_used": "ensemble",
    }

    where_clauses = ["rn = 1"]

    if payload.filters.status:
        params["is_active"] = payload.filters.status == "active"
        where_clauses.append("is_active = :is_active")

    if payload.filters.diagnosis:
        params["diagnosis"] = payload.filters.diagnosis
        where_clauses.append("prediction = :diagnosis")

    date_start = _date_range_start(payload.filters.date_range)

    if date_start:
        params["date_start"] = date_start
        where_clauses.append("last_screening >= :date_start")

    if payload.report_type == "high_risk":
        where_clauses.append(
            "(prediction = 'glaucoma' OR ohts_tier IN ('possible', 'critical'))"
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
    response_rows = []

    for row in rows:
        status = _patient_status_label(row.get("is_active"))
        diagnosis = _safe_text(row.get("prediction"), "N/A")

        response_rows.append({
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
            "ohts": _ohts_display({
                "ohts_tier": row.get("ohts_tier"),
                "ohts_score": row.get("ohts_score"),
            }),
            "cdr": _format_number(row.get("cdr"), 3),
            "gradcam": _has_gradcam({
                "gradcam_path": row.get("gradcam_path"),
            }),
            "lastScreening": _format_date(row.get("last_screening")),
            "risk": _risk_label(row.get("prediction"), row.get("ohts_tier")),
            "clinician": _safe_text(row.get("clinician")),
        })

    summary = {
        "total": len(response_rows),
        "active": sum(1 for row in response_rows if row["status"] == "active"),
        "inactive": sum(1 for row in response_rows if row["status"] == "inactive"),
        "glaucoma": sum(1 for row in response_rows if row["diagnosis"] == "glaucoma"),
        "normal": sum(1 for row in response_rows if row["diagnosis"] == "normal"),
    }

    title = (
        "High Risk Report"
        if payload.report_type == "high_risk"
        else "Patient List Report"
    )

    return {
        "report_type": payload.report_type,
        "title": title,
        "filters": payload.filters.model_dump(),
        "summary": summary,
        "rows": response_rows,
        "generated_by": f"{current_user.first_name} {current_user.last_name}",
        "generated_date": datetime.now().strftime("%Y-%m-%d %H:%M"),
    }


def _assistant_filter_labels(filters: dict) -> list[str]:
    labels = []

    status = filters.get("status")
    diagnosis = filters.get("diagnosis")
    date_range = filters.get("date_range")

    if status:
        labels.append(f"Status: {status.title()}")

    if diagnosis:
        labels.append(f"Diagnosis: {diagnosis.title()}")

    if date_range == "this_week":
        labels.append("Date range: This week")

    if date_range == "this_month":
        labels.append("Date range: This month")

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

    if report_type == "high_risk":
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

            tabular_rows.append({
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
            })

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
            {"key": "clinician", "label": "Clinician", "width": 0.14},
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
                "value": f"{average_confidence:.0f}%" if average_confidence is not None else "N/A",
            },
            {"label": "Possible OHTS", "value": str(possible_ohts)},
            {"label": "Critical OHTS", "value": str(critical_ohts)},
        ]

    else:
        tabular_rows = []

        for row in rows:
            tabular_rows.append({
                "patient_id": _safe_text(row.get("patientId")),
                "patient_name": _safe_text(row.get("name")),
                "date_of_birth": _format_date_display(row.get("dob")),
                "status": _safe_text(row.get("status")).title(),
                "diagnosis": _safe_text(row.get("diagnosis")).title(),
                "last_screening": _format_date_display(row.get("lastScreening")),
                "risk": _safe_text(row.get("risk")),
                "clinician": _safe_text(row.get("clinician")),
            })

        columns = [
            {"key": "patient_id", "label": "Patient ID", "width": 0.11},
            {"key": "patient_name", "label": "Patient Name", "width": 0.20},
            {"key": "date_of_birth", "label": "Date of Birth", "width": 0.12},
            {"key": "status", "label": "Status", "width": 0.10},
            {"key": "diagnosis", "label": "Diagnosis", "width": 0.12},
            {"key": "last_screening", "label": "Last Screening", "width": 0.13},
            {"key": "risk", "label": "Risk", "width": 0.09},
            {"key": "clinician", "label": "Clinician", "width": 0.13},
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


@router.post("/assistant/pdf-go")
async def export_assistant_report_pdf_go(
    payload: ReportAssistantPreviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    preview_data = await preview_assistant_report(
        payload=payload,
        db=db,
        current_user=current_user,
    )

    clinic_name = await _get_system_setting(
        db=db,
        set_code="CLINIC_NAME",
        fallback="Clinic Name",
    )

    generated_by = f"{current_user.first_name} {current_user.last_name}"

    go_payload = _build_assistant_tabular_payload(
        preview_data=preview_data,
        clinic_name=clinic_name,
        generated_by=generated_by,
    )

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                "http://localhost:8081/reports/tabular/pdf",
                json=go_payload,
            )
            response.raise_for_status()

    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=503,
            detail=f"Go report service tabular PDF endpoint is unavailable: {str(error)}",
        )

    filename = (
        f"{payload.report_type}_report_go_"
        f"{datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}.pdf"
    )

    return StreamingResponse(
        iter([response.content]),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
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
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (0, 0), (0, 0), "LEFT"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))

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
        1 for row in rows
        if "possible" in _safe_text(row.get("ohts_tier"), "").lower()
    )

    critical_ohts = sum(
        1 for row in rows
        if "critical" in _safe_text(row.get("ohts_tier"), "").lower()
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
    summary_table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, colors.black),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))

    story.append(summary_table)
    story.append(Spacer(1, 0.6 * cm))

    table_rows = [[
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
    ]]

    for row in rows:
        table_rows.append([
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
        ])

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
    report_table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, colors.black),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 10),
        ("FONTSIZE", (0, 1), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))

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
        1 for row in rows
        if "possible" in _safe_text(row.get("ohts_tier"), "").lower()
    )

    critical_ohts = sum(
        1 for row in rows
        if "critical" in _safe_text(row.get("ohts_tier"), "").lower()
    )

    go_rows = []

    for row in rows:
        go_rows.append({
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
        })

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
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )


@router.get("/go-health")
async def check_go_report_service_health():
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get("http://localhost:8081/health")
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
            response = await client.get("http://localhost:8081/reports/test-pdf")
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
                "http://localhost:8081/reports/high-risk/pdf",
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
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )