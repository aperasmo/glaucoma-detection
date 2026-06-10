# backend/app/api/routes/screening_result.py
#
# Screening result endpoints - returns ML inference results to the frontend.
# All routes are protected - valid JWT token required.
# All authenticated roles can view results.

from uuid import UUID
from datetime import datetime, date
from io import BytesIO
from pathlib import Path
from html import escape
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER,TA_JUSTIFY
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
    KeepInFrame,
)

from app.core.dependencies import get_current_user
from app.core.logger import get_logger
from app.db.database import get_db
from app.models.user import User
from app.models.screening_result import ScreeningResult
from app.schemas.screening_result import ScreeningResultResponse, ScreeningWithResults
from app.services.screening_result_service import (
    get_results_by_screening,
    get_ensemble_result,
    get_screening_with_results,
)


logger = get_logger(__name__)

router = APIRouter(prefix="/results", tags=["Screening Results"])


def _safe_text(value: Any, fallback: str = "N/A") -> str:
    if value is None or value == "":
        return fallback
    return str(value)


def _format_percent(value: Any, digits: int = 1) -> str:
    if value is None:
        return "N/A"

    try:
        number = float(value)
    except (TypeError, ValueError):
        return "N/A"

    if number <= 1:
        number *= 100

    return f"{number:.{digits}f}%"


def _format_number(value: Any, digits: int = 2) -> str:
    if value is None:
        return "N/A"

    try:
        return f"{float(value):.{digits}f}"
    except (TypeError, ValueError):
        return "N/A"


def _format_date_display(value: Any, include_time: bool = False) -> str:
    if value is None:
        return "N/A"

    if isinstance(value, datetime):
        if include_time:
            return value.strftime("%d %b %Y, %I:%M %p").lstrip("0")
        return value.strftime("%d %b %Y").lstrip("0")

    if isinstance(value, date):
        return value.strftime("%d %b %Y").lstrip("0")

    value_text = str(value)

    try:
        parsed_datetime = datetime.fromisoformat(value_text.replace("Z", "+00:00"))
        if include_time:
            return parsed_datetime.strftime("%d %b %Y, %I:%M %p").lstrip("0")
        return parsed_datetime.strftime("%d %b %Y").lstrip("0")
    except ValueError:
        return _safe_text(value)


def _prediction_label(value: Any) -> str:
    # Screening-safe wording:
    # - Avoids presenting the AI output as a final diagnosis.
    # - Used by the clinical referral PDF and the research LLM comparison PDF.
    # - Edit the labels below if you want to adjust the wording globally later.
    prediction = _safe_text(value, "").lower()

    if prediction == "glaucoma":
        return "Possible glaucoma signs detected"

    if prediction == "normal":
        return "No glaucoma signs detected"

    return "N/A"


def _cdr_label(value: Any) -> str:
    if value is None:
        return "N/A"

    try:
        cdr = float(value)
    except (TypeError, ValueError):
        return "N/A"

    if cdr >= 0.60:
        category = "Suspicious"
    elif cdr >= 0.50:
        category = "Borderline"
    else:
        category = "Within expected range"

    return f"{cdr:.2f} ({category})"


def _ohts_label(score: Any, tier: Any) -> str:
    if score is None and tier is None:
        return "N/A"

    score_text = _format_number(score, 0) if score is not None else "N/A"
    tier_text = _safe_text(tier, "N/A").title()

    if tier_text.lower() == "low":
        tier_display = "Low Risk"
    elif tier_text.lower() == "possible":
        tier_display = "Possible Risk"
    elif tier_text.lower() == "critical":
        tier_display = "Critical Risk"
    else:
        tier_display = tier_text

    return f"{score_text} / 16 pts ({tier_display})"


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
    db: AsyncSession,
    set_code: str,
    fallback: str,
) -> str:
    result = await db.execute(
        text("""
            SELECT set_value
            FROM system_settings
            WHERE set_code = :set_code
              AND status = 'A'
            LIMIT 1
        """),
        {"set_code": set_code},
    )

    row = result.first()

    if not row:
        return fallback

    return row[0] or fallback


async def _get_clinic_profile(db: AsyncSession) -> dict:
    clinic_name = await _get_system_setting(
        db=db,
        set_code="CLINIC_NAME",
        fallback="GlaucomaAI Clinical System",
    )

    clinic_address = await _get_system_setting(
        db=db,
        set_code="CLINIC_ADDRESS",
        fallback="123 Queen Street, Auckland",
    )

    clinic_contact = await _get_system_setting(
        db=db,
        set_code="CLINIC_CONTACT",
        fallback="+64 9 555 0000",
    )

    clinic_email = await _get_system_setting(
        db=db,
        set_code="CLINIC_EMAIL",
        fallback="clinic@example.com",
    )

    return {
        "name": clinic_name,
        "address": clinic_address,
        "contact": clinic_contact,
        "email": clinic_email,
    }


def _select_ensemble_result(results: list[ScreeningResult]) -> ScreeningResult | None:
    for result in results:
        if result.model_used == "ensemble" and result.llm_used is None:
            return result

    for result in results:
        if result.model_used == "ensemble":
            return result

    return results[0] if results else None


def _select_referral_result(results: list[ScreeningResult]) -> ScreeningResult | None:
    for result in results:
        if result.referral_letter and result.llm_used == "gpt4o":
            return result

    for result in results:
        if result.referral_letter and result.llm_used is not None:
            return result

    for result in results:
        if result.referral_letter:
            return result

    return None


def _get_referral_results_by_llm(results: list[ScreeningResult]) -> dict[str, ScreeningResult]:
    referral_map = {}

    for result in results:
        if result.referral_letter and result.llm_used:
            referral_map[str(result.llm_used)] = result

    return referral_map


def _clean_referral_letter_body(referral_text: str) -> str:
    # The LLM-generated referral letter may already include a sign-off.
    # The PDF adds the signatory separately, so remove any existing sign-off block.
    lines = referral_text.splitlines()
    stop_markers = {
        "sincerely",
        "sincerely,",
        "yours sincerely",
        "yours sincerely,",
        "kind regards",
        "kind regards,",
        "regards",
        "regards,",
    }

    cleaned_lines = []

    for line in lines:
        clean_line = line.strip()
        lower_line = clean_line.lower()

        if lower_line in stop_markers or lower_line.startswith("sincerely,"):
            break

        if clean_line in {"[Your Name]", "[Your name]", "Your Name"}:
            break

        cleaned_lines.append(line.rstrip())

    while cleaned_lines and not cleaned_lines[-1].strip():
        cleaned_lines.pop()

    return "\n".join(cleaned_lines).strip()


def _format_signatory_for_pdf(signed_by: str) -> str:
    # signed_by is stored as one text field, but may contain either:
    # "Dr. Name\nTitle" or legacy "Dr. Name, Title".
    # Render both formats as two visual lines in the PDF.
    signatory_text = _safe_text(signed_by, "Referring Clinician").strip()

    if "\n" not in signatory_text and "," in signatory_text:
        name_part, title_part = signatory_text.split(",", 1)
        signatory_text = f"{name_part.strip()}\n{title_part.strip()}"

    return (
        escape(signatory_text)
        .replace("\r\n", "\n")
        .replace("\r", "\n")
        .replace("\n", "<br/>")
    )


def _normalise_signatory_for_storage(signed_by: str) -> str:
    # Store name and clinician title as multiline text in the existing signed_by field.
    # This avoids a database migration while allowing a clean two-line signature.
    signatory_text = signed_by.strip()

    if "\n" not in signatory_text and "," in signatory_text:
        name_part, title_part = signatory_text.split(",", 1)
        signatory_text = f"{name_part.strip()}\n{title_part.strip()}"

    return signatory_text


def _build_referral_pdf(
    screening_data: dict,
    clinic_profile: dict,
    ensemble_result: ScreeningResult | None,
    referral_result: ScreeningResult | None,
    signed_by: str,
) -> BytesIO:
    buffer = BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=1.2 * cm,
        leftMargin=1.2 * cm,
        topMargin=0.9 * cm,
        bottomMargin=1.0 * cm,
    )

    content_width = A4[0] - doc.leftMargin - doc.rightMargin
    styles = getSampleStyleSheet()

    normal_style = ParagraphStyle(
        "ReferralNormal",
        parent=styles["Normal"],
        fontSize=9.2,
        leading=11.1,
        alignment=TA_JUSTIFY,
    )

    small_style = ParagraphStyle(
        "ReferralSmall",
        parent=styles["Normal"],
        fontSize=8.2,
        leading=9.5,
        alignment=TA_LEFT,
    )

    section_header_style = ParagraphStyle(
        "ReferralSectionHeader",
        parent=styles["Normal"],
        fontSize=9.2,
        leading=10.5,
        fontName="Helvetica-Bold",
        textColor=colors.HexColor("#1f2937"),
        spaceAfter=2,
    )

    title_style = ParagraphStyle(
        "ReferralTitle",
        parent=styles["Normal"],
        fontSize=12,
        leading=14,
        fontName="Helvetica-Bold",
        textColor=colors.HexColor("#111827"),
        alignment=TA_LEFT,
    )

    disclaimer_style = ParagraphStyle(
        "ReferralDisclaimer",
        parent=styles["Normal"],
        fontSize=8.5,
        leading=10,
        textColor=colors.HexColor("#7c2d12"),
        alignment=TA_CENTER,
    )

    story = []
    logo_path = _find_logo_path()

    if logo_path:
        logo_cell = RLImage(str(logo_path), width=4.5 * cm, height=1.05 * cm)
    else:
        logo_cell = Paragraph("<b>GlaucomaAI</b>", title_style)

    clinic_lines = [
        f"<b>{escape(_safe_text(clinic_profile.get('name'), 'GlaucomaAI Clinical System'))}</b>",
        escape(_safe_text(clinic_profile.get("address"), "")),
        f"{escape(_safe_text(clinic_profile.get('contact'), ''))} | {escape(_safe_text(clinic_profile.get('email'), ''))}",
        f"Date: {_format_date_display(datetime.now())}",
    ]

    clinic_text = "<br/>".join(line for line in clinic_lines if line)

    header_table = Table(
        [[logo_cell, Paragraph(clinic_text, normal_style)]],
        colWidths=[content_width * 0.30, content_width * 0.70],
    )

    header_table.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#d1d5db")),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))

    story.append(header_table)
    story.append(Spacer(1, 0.18 * cm))

    patient_rows = [
        [Paragraph("PATIENT DETAILS", section_header_style), ""],
        ["Name:", _safe_text(screening_data.get("patient_name"))],
        ["DOB:", _format_date_display(screening_data.get("patient_dob"))],
        ["Gender:", _safe_text(screening_data.get("patient_gender")).title()],
        ["Eye:", _safe_text(screening_data.get("eye_side")).title()],
    ]

    patient_table = Table(
        patient_rows,
        colWidths=[2.4 * cm, (content_width * 0.50) - 2.8 * cm],
    )

    patient_table.setStyle(TableStyle([
        ("SPAN", (0, 0), (-1, 0)),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eef2ff")),
        ("FONTNAME", (0, 1), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 1), (-1, -1), 8.8),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))

    summary_rows = [
        [Paragraph("AI SCREENING SUMMARY", section_header_style), ""],
        ["Result:", _prediction_label(getattr(ensemble_result, "prediction", None))],
        ["Confidence:", _format_percent(getattr(ensemble_result, "confidence_score", None))],
        [
            "OHTS Score:",
            _ohts_label(
                getattr(ensemble_result, "ohts_score", None),
                getattr(ensemble_result, "ohts_tier", None),
            ),
        ],
        ["CDR:", _cdr_label(getattr(ensemble_result, "cdr", None))],
        ["Date:", _format_date_display(screening_data.get("created_at"), include_time=True)],
    ]

    summary_table = Table(
        summary_rows,
        colWidths=[2.8 * cm, (content_width * 0.50) - 3.2 * cm],
    )

    summary_table.setStyle(TableStyle([
        ("SPAN", (0, 0), (-1, 0)),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#ecfdf5")),
        ("FONTNAME", (0, 1), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 1), (-1, -1), 8.8),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))

    details_table = Table(
        [[patient_table, summary_table]],
        colWidths=[content_width * 0.50, content_width * 0.50],
    )

    details_table.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#d1d5db")),
        ("LINEBEFORE", (1, 0), (1, 0), 0.6, colors.HexColor("#d1d5db")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))

    story.append(details_table)
    story.append(Spacer(1, 0.18 * cm))

    raw_referral_text = _safe_text(
        getattr(referral_result, "referral_letter", None),
        "No referral letter has been generated for this screening.",
    )

    referral_text = _clean_referral_letter_body(raw_referral_text)

    if not referral_text:
        referral_text = "No referral letter has been generated for this screening."

    referral_paragraphs = []
    for block in referral_text.splitlines():
        clean_block = block.strip()
        if clean_block:
            referral_paragraphs.append(Paragraph(escape(clean_block), normal_style))
        else:
            referral_paragraphs.append(Spacer(1, 0.08 * cm))

    signatory_html = _format_signatory_for_pdf(signed_by)

    letter_story = [
        [Paragraph("REFERRAL LETTER", section_header_style)],
    ]

    for paragraph in referral_paragraphs:
        letter_story.append([paragraph])

    letter_story.extend([
        [Spacer(1, 0.16 * cm)],
        [Paragraph("Sincerely,", normal_style)],
        [Spacer(1, 0.10 * cm)],
        [Paragraph(signatory_html, normal_style)],
    ])

    letter_table = Table(
        letter_story,
        colWidths=[content_width],
    )

    letter_table.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#d1d5db")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#fefce8")),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))

    story.append(letter_table)
    story.append(Spacer(1, 0.16 * cm))

    disclaimer_table = Table(
        [[Paragraph(
            "AI-assisted screening tool only. Not a diagnostic instrument.",
            disclaimer_style,
        )]],
        colWidths=[content_width],
    )

    disclaimer_table.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#fed7aa")),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#fff7ed")),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))

    story.append(disclaimer_table)

    def _draw_page_number(canvas, document):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#6b7280"))
        canvas.drawRightString(
            A4[0] - document.rightMargin,
            0.55 * cm,
            f"Page {document.page}",
        )
        canvas.restoreState()

    doc.build(
        story,
        onFirstPage=_draw_page_number,
        onLaterPages=_draw_page_number,
    )

    buffer.seek(0)
    return buffer



def _build_llm_comparison_pdf(
    screening_data: dict,
    clinic_profile: dict,
    ensemble_result: ScreeningResult | None,
    referral_results_by_llm: dict[str, ScreeningResult],
) -> BytesIO:
    """
    Research Mode LLM comparison PDF.

    Layout target:
    - Landscape A4.
    - Compact readable header.
    - Separate patient/screening metadata line to avoid overlap.
    - 2x2 quadrant layout:
        GPT-4o       | GPT-4o Mini
        LLaMA        | Gemini
    - Each quadrant dedicates most of its space to the full referral letter.
    - Footer disclaimer remains readable.

    Adjustment guide:
    - Change the constants in the "PDF LAYOUT TUNING" section below.
    - Most spacing, font size, and line spacing values are grouped there.
    """

    buffer = BytesIO()
    page_size = landscape(A4)

    # ---------------------------------------------------------------------
    # PDF LAYOUT TUNING
    # ---------------------------------------------------------------------
    # Page margins:
    # - Smaller margins give more space to the four quadrants.
    # - Increase these if the PDF feels too close to the paper edge.
    PAGE_MARGIN_LEFT = 0.30 * cm
    PAGE_MARGIN_RIGHT = 0.30 * cm
    PAGE_MARGIN_TOP = 0.28 * cm
    PAGE_MARGIN_BOTTOM = 0.70 * cm

    # Header sizing:
    # - HEADER_ROW_HEIGHT controls the vertical space for logo + clinic info.
    # - Increase if the logo or clinic lines overlap.
    # - Decrease slightly if you need more quadrant/body space.
    HEADER_ROW_HEIGHT = 1.05 * cm

    # Logo sizing:
    # - LOGO_WIDTH and LOGO_HEIGHT control the printed logo size.
    # - If the logo looks too dominant, reduce LOGO_WIDTH first.
    LOGO_WIDTH = 3.65 * cm
    LOGO_HEIGHT = 0.85 * cm

    # Header column widths:
    # - LOGO_COL_RATIO controls distance/space allocated to the logo.
    # - CLINIC_COL_RATIO controls space for clinic name/address/contact.
    # - GENERATED_COL_RATIO controls right-side generated date/time space.
    # - These must add up to 1.00.
    #
    # To increase distance between logo and clinic header:
    # - Increase LOGO_COL_RATIO a little, e.g. 0.24.
    # - Decrease CLINIC_COL_RATIO accordingly.
    LOGO_COL_RATIO = 0.18
    CLINIC_COL_RATIO = 0.57
    GENERATED_COL_RATIO = 0.25

    # Header internal spacing:
    # - These control padding inside the header table cells.
    # - Increase HEADER_RIGHT_PADDING if text is too close between columns.
    HEADER_LEFT_PADDING = 0
    HEADER_RIGHT_PADDING = 0
    HEADER_TOP_PADDING = 0
    HEADER_BOTTOM_PADDING = 3

    # Distance between header and report/patient metadata:
    # - Increase HEADER_TO_META_SPACER if logo/header feels too close to the report name.
    # - Decrease to give more room to the quadrants.
    HEADER_TO_META_SPACER = 0.1 * cm

    # Report title and patient metadata row heights:
    # - Increase if patient details overlap or wrap badly.
    # - Decrease to give more space to the quadrant table.
    REPORT_TITLE_ROW_HEIGHT = 0.36 * cm
    PATIENT_META_ROW_HEIGHT = 0.40 * cm

    # Distance between patient metadata and quadrant table:
    # - Increase for more breathing room.
    # - Decrease if you need more quadrant height.
    META_TO_QUADRANT_SPACER = 0.10 * cm

    # Quadrant table padding:
    # - Padding controls the space between the quadrant border and its content.
    # - Increase for cleaner visual spacing.
    # - Decrease to fit more text.
    QUADRANT_LEFT_PADDING = 8
    QUADRANT_RIGHT_PADDING = 8
    QUADRANT_TOP_PADDING = 7
    QUADRANT_BOTTOM_PADDING = 7

    # Letter body area:
    # - LETTER_FRAME_HEIGHT_RATIO controls how much of each quadrant height is used
    #   for the letter body after the LLM name and generation time.
    # - 0.85 means around 85% of each quadrant is reserved for the letter.
    # - Increase to 0.88 or 0.90 if the letter still has too much blank space.
    # - Decrease if text overlaps with the quadrant header.
    LETTER_FRAME_HEIGHT_RATIO = 0.75

    # Letter frame width adjustment:
    # - This is subtracted from each quadrant width before placing letter text.
    # - Increase if text is too close to borders.
    # - Decrease if you want wider lines.
    LETTER_FRAME_WIDTH_REDUCTION = 0.55 * cm

    # Footer:
    # - FOOTER_RESERVED_HEIGHT affects how much page space is reserved for the footer.
    # - FOOTER_FONT_SIZE controls readability of the disclaimer.
    FOOTER_RESERVED_HEIGHT = 0.48 * cm
    FOOTER_BAR_Y = 0.28 * cm
    FOOTER_BAR_HEIGHT = 0.32 * cm
    FOOTER_FONT_SIZE = 7.2

    # ---------------------------------------------------------------------
    # DOCUMENT SETUP
    # ---------------------------------------------------------------------
    doc = SimpleDocTemplate(
        buffer,
        pagesize=page_size,
        rightMargin=PAGE_MARGIN_RIGHT,
        leftMargin=PAGE_MARGIN_LEFT,
        topMargin=PAGE_MARGIN_TOP,
        bottomMargin=PAGE_MARGIN_BOTTOM,
    )

    page_width, page_height = page_size
    content_width = page_width - doc.leftMargin - doc.rightMargin
    styles = getSampleStyleSheet()

    # ---------------------------------------------------------------------
    # FONT AND LINE-SPACING TUNING
    # ---------------------------------------------------------------------
    # Header fonts:
    # - Clinic/header text should be readable but compact.
    # - If header overlaps, reduce fontSize or increase HEADER_ROW_HEIGHT.
    header_clinic_style = ParagraphStyle(
        "LlmHeaderClinic",
        parent=styles["Normal"],
        fontSize=10.0,
        leading=10.2,
        fontName="Helvetica-Bold",
        textColor=colors.HexColor("#111827"),
        alignment=TA_LEFT,
    )

    header_detail_style = ParagraphStyle(
        "LlmHeaderDetail",
        parent=styles["Normal"],
        fontSize=7.6,
        leading=8.6,
        textColor=colors.HexColor("#374151"),
        alignment=TA_LEFT,
    )

    # Report title:
    # - Controls the "LLM Referral Letter Comparison" line.
    report_title_style = ParagraphStyle(
        "LlmReportTitle",
        parent=styles["Normal"],
        fontSize=8.5,
        leading=9.5,
        fontName="Helvetica-Bold",
        textColor=colors.HexColor("#111827"),
        alignment=TA_LEFT,
    )

    # Patient metadata:
    # - Increase leading if the patient details line wraps.
    # - If it overlaps with the quadrant table, increase PATIENT_META_ROW_HEIGHT.
    patient_meta_style = ParagraphStyle(
        "LlmPatientMeta",
        parent=styles["Normal"],
        fontSize=7.6,
        leading=8.8,
        textColor=colors.HexColor("#1f2937"),
        alignment=TA_LEFT,
    )

    # Quadrant title:
    # - Controls GPT-4o, GPT-4o Mini, LLaMA, Gemini heading size.
    quadrant_title_style = ParagraphStyle(
        "LlmQuadrantTitle",
        parent=styles["Normal"],
        fontSize=13.4,
        leading=14.5,
        fontName="Helvetica-Bold",
        textColor=colors.HexColor("#111827"),
        alignment=TA_CENTER,
        spaceAfter=2,
    )

    # Generation time:
    # - Controls the line under the LLM name, e.g. "Generated in 2732 ms".
    generation_style = ParagraphStyle(
        "LlmGenerationTime",
        parent=styles["Normal"],
        fontSize=8.3,
        leading=9.4,
        fontName="Helvetica-Bold",
        textColor=colors.HexColor("#374151"),
        alignment=TA_CENTER,
        spaceAfter=4,
    )

    # Referral letter body:
    # - fontSize controls the visible size of the body text.
    # - leading controls line spacing.
    # - Increase leading for more readable spacing.
    # - KeepInFrame(mode="shrink") can shrink long letters slightly if needed.
    letter_style = ParagraphStyle(
        "LlmQuadrantLetter",
        parent=styles["Normal"],
        fontSize=10.8,
        leading=12.8,
        textColor=colors.HexColor("#111827"),
        alignment=TA_JUSTIFY,
        spaceAfter=5,
    )

    empty_style = ParagraphStyle(
        "LlmEmptyLetter",
        parent=styles["Normal"],
        fontSize=9.2,
        leading=10.5,
        textColor=colors.HexColor("#6b7280"),
        alignment=TA_CENTER,
    )

    story = []

    # ---------------------------------------------------------------------
    # HEADER: LOGO + CLINIC DETAILS + GENERATED DATE
    # ---------------------------------------------------------------------
    logo_path = _find_logo_path()

    if logo_path:
        logo_cell = RLImage(str(logo_path), width=LOGO_WIDTH, height=LOGO_HEIGHT)
    else:
        logo_cell = Paragraph("<b>GlaucomaAI</b>", header_clinic_style)

    generated_header = (
            ""
    )

    clinic_header = (
        #f"<b>Generated:</b> {datetime.now().strftime('%d %b %Y, %I:%M %p')}"
        f"<b>{escape(_safe_text(clinic_profile.get('name'), 'Clinic Name'))}</b><br/>"
        f"{escape(_safe_text(clinic_profile.get('address'), 'Clinic Address'))}<br/>"
        f"{escape(_safe_text(clinic_profile.get('contact'), 'Clinic Contact'))} | "
        f"{escape(_safe_text(clinic_profile.get('email'), 'Clinic Email'))}"
    )

    header_table = Table(
        [[
            logo_cell,
            Paragraph(generated_header, header_detail_style),
            Paragraph(clinic_header, header_detail_style),
            
        ]],
        colWidths=[
            content_width * LOGO_COL_RATIO,
            content_width * CLINIC_COL_RATIO,
            content_width * GENERATED_COL_RATIO,
        ],
        rowHeights=[HEADER_ROW_HEIGHT],
    )

    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), HEADER_LEFT_PADDING),
        ("RIGHTPADDING", (0, 0), (-1, -1), HEADER_RIGHT_PADDING),
        ("TOPPADDING", (0, 0), (-1, -1), HEADER_TOP_PADDING),
        ("BOTTOMPADDING", (0, 0), (-1, -1), HEADER_BOTTOM_PADDING),
    ]))

    story.append(header_table)
    story.append(Spacer(1, HEADER_TO_META_SPACER))

    # ---------------------------------------------------------------------
    # REPORT NAME + PATIENT DETAILS
    # ---------------------------------------------------------------------
    # Patient metadata is separated from the clinic header so it does not overlap.
    report_title = Paragraph("<b>LLM Referral Letter Comparison</b>", report_title_style)

    patient_meta = Paragraph(
        (
            f"Patient: {escape(_safe_text(screening_data.get('patient_name')))} "
            f"({escape(_safe_text(screening_data.get('patient_code')))}); "
            f"DOB: {escape(_format_date_display(screening_data.get('patient_dob')))}; "
            f"Gender: {escape(_safe_text(screening_data.get('patient_gender')).title())}; "
            f"Eye: {escape(_safe_text(screening_data.get('eye_side')).title())}; "
            f"Clinical reference: {escape(_prediction_label(getattr(ensemble_result, 'prediction', None)))} "
            f"({_format_percent(getattr(ensemble_result, 'confidence_score', None))})"
        ),
        patient_meta_style,
    )

    meta_table = Table(
        [[report_title], [patient_meta]],
        colWidths=[content_width],
        rowHeights=[REPORT_TITLE_ROW_HEIGHT, PATIENT_META_ROW_HEIGHT],
    )

    meta_table.setStyle(TableStyle([
        ("LINEABOVE", (0, 0), (-1, 0), 0.4, colors.HexColor("#d1d5db")),
        ("LINEBELOW", (0, 1), (-1, 1), 0.4, colors.HexColor("#d1d5db")),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))

    story.append(meta_table)
    story.append(Spacer(1, META_TO_QUADRANT_SPACER))

    # ---------------------------------------------------------------------
    # FOUR-QUADRANT LLM LETTER BODY
    # ---------------------------------------------------------------------
    llm_quadrants = [
        ("gpt4o", "GPT-4o"),
        ("gpt4o_mini", "GPT-4o Mini"),
        ("llama", "LLaMA"),
        ("gemini", "Gemini"),
    ]

    # Height calculation:
    # - We subtract header, metadata, spacers, and footer from total page height.
    # - The remaining space becomes the 2x2 quadrant table.
    # - If quadrants become too short, reduce header heights or footer height.
    header_used = (
        HEADER_ROW_HEIGHT
        + HEADER_TO_META_SPACER
        + REPORT_TITLE_ROW_HEIGHT
        + PATIENT_META_ROW_HEIGHT
        + META_TO_QUADRANT_SPACER
    )

    quadrant_table_height = (
        page_height
        - doc.topMargin
        - doc.bottomMargin
        - header_used
        - FOOTER_RESERVED_HEIGHT
    )

    quadrant_width = content_width / 2
    quadrant_height = quadrant_table_height / 2

    frame_width = quadrant_width - LETTER_FRAME_WIDTH_REDUCTION
    frame_height = quadrant_height * LETTER_FRAME_HEIGHT_RATIO

    quadrant_cells = []

    for key, label in llm_quadrants:
        result = referral_results_by_llm.get(key)

        cell_flowables = [
            Paragraph(escape(label), quadrant_title_style),
        ]

        if result and getattr(result, "generation_time_ms", None) is not None:
            cell_flowables.append(
                Paragraph(
                    f"Generated in {float(result.generation_time_ms/1000):.2f} secs.",
                    generation_style,
                )
            )
        else:
            cell_flowables.append(
                Paragraph("Generation time not recorded", generation_style)
            )

        # Distance between "Generated in..." and the letter body.
        # Increase this for a clearer gap; decrease to fit more text.
        cell_flowables.append(Spacer(1, 0.08 * cm))

        if result:
            raw_text = _safe_text(result.referral_letter, "No referral letter generated.")
            clean_text = _clean_referral_letter_body(raw_text) or "No referral letter generated."

            letter_blocks = []

            # Each non-empty line becomes its own paragraph.
            # Blank lines create paragraph spacing.
            for line in clean_text.splitlines():
                clean_line = line.strip()

                if clean_line:
                    letter_blocks.append(Paragraph(escape(clean_line), letter_style))
                else:
                    # Paragraph gap inside referral letter.
                    # Increase this if paragraphs look too tight.
                    letter_blocks.append(Spacer(1, 0.10 * cm))

            cell_flowables.append(
                KeepInFrame(
                    frame_width,
                    frame_height,
                    letter_blocks,
                    mode="shrink",
                    hAlign="LEFT",
                    vAlign="TOP",
                )
            )
        else:
            cell_flowables.append(
                KeepInFrame(
                    frame_width,
                    frame_height,
                    [Paragraph("No referral letter generated for this LLM.", empty_style)],
                    mode="shrink",
                    hAlign="CENTER",
                    vAlign="MIDDLE",
                )
            )

        quadrant_cells.append(cell_flowables)

    quadrant_table = Table(
        [
            [quadrant_cells[0], quadrant_cells[1]],
            [quadrant_cells[2], quadrant_cells[3]],
        ],
        colWidths=[quadrant_width, quadrant_width],
        rowHeights=[quadrant_height, quadrant_height],
    )

    quadrant_table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.55, colors.HexColor("#9ca3af")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#ffffff")),
        ("LEFTPADDING", (0, 0), (-1, -1), QUADRANT_LEFT_PADDING),
        ("RIGHTPADDING", (0, 0), (-1, -1), QUADRANT_RIGHT_PADDING),
        ("TOPPADDING", (0, 0), (-1, -1), QUADRANT_TOP_PADDING),
        ("BOTTOMPADDING", (0, 0), (-1, -1), QUADRANT_BOTTOM_PADDING),
    ]))

    story.append(quadrant_table)

    # ---------------------------------------------------------------------
    # FOOTER DISCLAIMER
    # ---------------------------------------------------------------------
    def _draw_footer(canvas, document):
        canvas.saveState()

        canvas.setFillColor(colors.HexColor("#fff7ed"))
        canvas.rect(
            document.leftMargin,
            FOOTER_BAR_Y,
            page_width - document.leftMargin - document.rightMargin,
            FOOTER_BAR_HEIGHT,
            stroke=0,
            fill=1,
        )

        canvas.setFillColor(colors.HexColor("#6b7280"))
        canvas.setFont("Helvetica", FOOTER_FONT_SIZE)
        canvas.drawString(
            document.leftMargin + 0.10 * cm,
            FOOTER_BAR_Y + 0.10 * cm,
            "AI-assisted screening tool only. Referral letters are generated for research comparison and clinician review. Not a diagnostic instrument." \
            f"                                                         Generated: {datetime.now().strftime('%d %b %Y, %I:%M %p')}",
        )

        canvas.drawRightString(
            page_width - document.rightMargin,
            FOOTER_BAR_Y + 0.10 * cm,
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


@router.get("/{screening_id}", response_model=list[ScreeningResultResponse], status_code=status.HTTP_200_OK)
async def get_all_results(
    screening_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Return all model results for a screening.
    # Research Mode uses this to show side-by-side comparison.
    results = await get_results_by_screening(db, screening_id)
    if not results:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No results found for this screening."
        )
    return results


@router.get("/{screening_id}/ensemble", response_model=ScreeningResultResponse, status_code=status.HTTP_200_OK)
async def get_clinical_result(
    screening_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Return only the ensemble result for a screening.
    # Clinical Mode uses this as the authoritative output.
    result = await get_ensemble_result(db, screening_id)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ensemble result not found for this screening."
        )
    return result


@router.get("/{screening_id}/full", response_model=ScreeningWithResults, status_code=status.HTTP_200_OK)
async def get_full_screening_results(
    screening_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Return screening record with all results combined.
    # Used for the full clinical results page in the frontend.
    data = await get_screening_with_results(db, screening_id)
    if not data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Screening not found."
        )
    return data


@router.put("/{screening_id}/sign", status_code=status.HTTP_200_OK)
async def update_signed_by(
    screening_id: UUID,
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Update the signed_by field for all referral letter records
    # linked to this screening.
    # Called before printing/downloading the referral letter.

    signed_by = data.get("signed_by")
    if not signed_by:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="signed_by is required."
        )

    signed_by = _normalise_signatory_for_storage(signed_by)

    result = await db.execute(
        select(ScreeningResult).where(
            ScreeningResult.screening_id == screening_id,
            ScreeningResult.llm_used.isnot(None),
        )
    )
    records = result.scalars().all()

    if not records:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No referral letters found for this screening."
        )

    for record in records:
        record.signed_by = signed_by
        record.updated_by = current_user.user_id
        record.updated_at = datetime.utcnow()

    await db.commit()

    logger.info(
        "Signed by updated | screening_id=%s | user_id=%s | signed_by=%s",
        screening_id,
        current_user.user_id,
        signed_by,
    )

    return {"message": f"Referral letters updated. Signed by: {signed_by}"}


@router.post("/{screening_id}/pdf", status_code=status.HTTP_200_OK)
async def export_screening_result_pdf(
    screening_id: UUID,
    data: dict | None = Body(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Generate a printable/downloadable referral letter PDF for a screening result.
    # Used by the Screening Result page Print and Download actions.

    payload = data or {}
    pdf_type = payload.get("pdf_type", "clinical_referral")

    logger.info(
        "Screening result PDF requested | screening_id=%s | user_id=%s | pdf_type=%s",
        screening_id,
        current_user.user_id,
        pdf_type,
    )

    screening_data = await get_screening_with_results(db, screening_id)

    if not screening_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Screening not found.",
        )

    results = screening_data.get("results", [])
    ensemble_result = _select_ensemble_result(results)
    referral_result = _select_referral_result(results)

    if not ensemble_result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No screening result found for this screening.",
        )

    clinic_profile = await _get_clinic_profile(db)

    if pdf_type == "llm_comparison":
        referral_results_by_llm = _get_referral_results_by_llm(results)

        if not referral_results_by_llm:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No referral letters found for this screening.",
            )

        pdf_buffer = _build_llm_comparison_pdf(
            screening_data=screening_data,
            clinic_profile=clinic_profile,
            ensemble_result=ensemble_result,
            referral_results_by_llm=referral_results_by_llm,
        )

        filename = (
            f"llm_referral_comparison_{screening_data.get('patient_code')}_"
            f"{datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}.pdf"
        )

        logger.info(
            "LLM comparison PDF generated | screening_id=%s | file_name=%s",
            screening_id,
            filename,
        )

        return StreamingResponse(
            pdf_buffer,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"'
            },
        )

    signed_by = (
        _safe_text(getattr(referral_result, "signed_by", None), "")
        if referral_result
        else ""
    )

    if not signed_by:
        clinician_name = await _get_system_setting(
            db=db,
            set_code="REFERRING_CLINICIAN_NAME",
            fallback="Referring Clinician",
        )
        clinician_title = await _get_system_setting(
            db=db,
            set_code="REFERRING_CLINICIAN_TITLE",
            fallback="",
        )
        signed_by = (
            f"{clinician_name}\n{clinician_title}"
            if clinician_title
            else clinician_name
        )

    pdf_buffer = _build_referral_pdf(
        screening_data=screening_data,
        clinic_profile=clinic_profile,
        ensemble_result=ensemble_result,
        referral_result=referral_result,
        signed_by=signed_by,
    )

    filename = (
        f"screening_result_{screening_data.get('patient_code')}_"
        f"{datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}.pdf"
    )

    logger.info(
        "Screening result PDF generated | screening_id=%s | file_name=%s",
        screening_id,
        filename,
    )

    return StreamingResponse(
        pdf_buffer,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )
