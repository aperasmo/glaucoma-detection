# backend/app/api/routes/reports.py

from datetime import date, datetime
from io import BytesIO
from typing import Any
from pathlib import Path

from inspect import isawaitable
from html import escape
from reportlab.lib.enums import TA_RIGHT

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import text

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

from app.db.database import get_db
from app.services.screening_service import get_analytics

from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage

from app.core.dependencies import get_current_user
from app.models.user import User

router = APIRouter(prefix="/reports", tags=["Reports"])


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

    return f"{tier} / {_format_number(score, 1)}"


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

    page_width, page_height = landscape(A4)
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

    header_style = ParagraphStyle(
        "ReportHeader",
        parent=styles["Normal"],
        fontSize=11,
        leading=13,
        fontName="Helvetica-Bold",
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
        logo = RLImage(str(logo_path), width=5.5 * cm, height=1.4 * cm)
        logo_cell = logo
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

    minimum_data_rows = 8

    while len(table_rows) < minimum_data_rows + 1:
        table_rows.append(["", "", "", "", "", "", "", "", "", ""])

    report_col_widths = [
        content_width * 0.13,  # Code
        content_width * 0.14,  # Patient
        content_width * 0.11,  # Age / Gender
        content_width * 0.08,  # Eye
        content_width * 0.10,  # Prediction
        content_width * 0.09,  # Confidence
        content_width * 0.09,  # OHTS
        content_width * 0.07,  # CDR
        content_width * 0.12,  # Screening Date
        content_width * 0.07,  # Grad Cam
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

    filename = f"high_risk_report_{start_date}_to_{end_date}_{datetime.now().strftime('%H-%M-%S')}.pdf"

    return StreamingResponse(
        pdf_buffer,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )