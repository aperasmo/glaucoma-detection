# backend/app/services/report_assistant_llm_service.py
# LLM intent extraction for the AI Report Assistant.
# The LLM only converts a user prompt into a structured report request.
# Database queries, patient lookup, filtering, and PDF generation remain backend-controlled.

from __future__ import annotations

import json
import time
from typing import Any

import httpx

from app.core.config import settings


SUPPORTED_REPORT_TYPES = {
    "patient_list",
    "high_risk",
    "screening_summary",
    "user_list",
    "referral_list",
    "follow_up_list",
    "patient_clinical_summary",
}

SUPPORTED_STATUSES = {"active", "inactive"}
SUPPORTED_DIAGNOSES = {"glaucoma", "normal"}
SUPPORTED_EYE_SIDES = {"left", "right"}
SUPPORTED_ROLES = {"admin", "doctor", "nurse"}

ALLOWED_FILTER_KEYS = {
    "status",
    "diagnosis",
    "eye_side",
    "role",
    "days_since_last_screening",
    "patient_id",
    "patient_code",
    "patient_name",
    "patient_query",
    "date_phrase",
    "date_from",
    "date_to",
    "date_label",
}


class ReportAssistantLLMError(Exception):
    """Raised when the report assistant LLM cannot interpret the prompt."""


class ReportAssistantLLMDisabled(ReportAssistantLLMError):
    """Raised when LLM interpretation is disabled by configuration."""


def _setting(name: str, default: Any = None) -> Any:
    return getattr(settings, name, default)


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None

    text = str(value).strip()
    return text or None


def _extract_json_object(content: str) -> dict[str, Any]:
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        start = content.find("{")
        end = content.rfind("}")

        if start == -1 or end == -1 or end <= start:
            raise ReportAssistantLLMError("The LLM response did not contain a JSON object.")

        try:
            parsed = json.loads(content[start : end + 1])
        except json.JSONDecodeError as error:
            raise ReportAssistantLLMError("The LLM response JSON could not be parsed.") from error

    if not isinstance(parsed, dict):
        raise ReportAssistantLLMError("The LLM response must be a JSON object.")

    return parsed


def _extract_llm_content(response_data: dict[str, Any]) -> str:
    choices = response_data.get("choices")

    if isinstance(choices, list) and choices:
        first_choice = choices[0] or {}
        message = first_choice.get("message") or {}
        content = message.get("content") or first_choice.get("text")

        if content:
            return str(content)

    message = response_data.get("message")

    if isinstance(message, dict) and message.get("content"):
        return str(message["content"])

    if response_data.get("response"):
        return str(response_data["response"])

    raise ReportAssistantLLMError("The LLM response content could not be read.")


def _normalise_days(value: Any) -> int | None:
    if value is None or value == "":
        return None

    try:
        days = int(value)
    except (TypeError, ValueError):
        return None

    if days < 1 or days > 365:
        return None

    return days


def _normalise_filters(raw_filters: Any, raw_intent: dict[str, Any]) -> dict[str, Any]:
    filters = raw_filters if isinstance(raw_filters, dict) else {}
    normalised: dict[str, Any] = {}

    for key in ALLOWED_FILTER_KEYS:
        value = filters.get(key)

        if value is None:
            value = raw_intent.get(key)

        if value is None or value == "":
            continue

        if key == "status":
            value = str(value).strip().lower()
            if value in SUPPORTED_STATUSES:
                normalised[key] = value
            continue

        if key == "diagnosis":
            value = str(value).strip().lower()
            if value in SUPPORTED_DIAGNOSES:
                normalised[key] = value
            continue

        if key == "eye_side":
            value = str(value).strip().lower().replace(" eye", "")
            if value in SUPPORTED_EYE_SIDES:
                normalised[key] = value
            continue

        if key == "role":
            value = str(value).strip().lower()
            if value in SUPPORTED_ROLES:
                normalised[key] = value
            continue

        if key == "days_since_last_screening":
            days = _normalise_days(value)
            if days is not None:
                normalised[key] = days
            continue

        cleaned = _clean_text(value)
        if cleaned:
            normalised[key] = cleaned

    return normalised


def _has_patient_identifier(filters: dict[str, Any]) -> bool:
    return any(
        _clean_text(filters.get(key))
        for key in ("patient_id", "patient_code", "patient_name", "patient_query")
    )


def _normalise_intent(raw_intent: dict[str, Any], duration_ms: int, model_used: str) -> dict[str, Any]:
    report_type = _clean_text(raw_intent.get("report_type"))

    if report_type:
        report_type = report_type.lower()

    filters = _normalise_filters(raw_intent.get("filters"), raw_intent)
    needs_clarification = bool(raw_intent.get("needs_clarification"))
    clarification_question = _clean_text(raw_intent.get("clarification_question"))

    if report_type not in SUPPORTED_REPORT_TYPES:
        return {
            "report_type": None,
            "filters": {},
            "needs_clarification": True,
            "clarification_question": "Please specify a supported report type.",
            "llm_used": True,
            "model_used": model_used,
            "duration_ms": duration_ms,
            "token_usage": raw_intent.get("token_usage"),
        }

    if report_type == "patient_clinical_summary" and not _has_patient_identifier(filters):
        needs_clarification = True
        clarification_question = "Please provide the patient name or patient ID for the patient clinical summary report."

    if needs_clarification and not clarification_question:
        clarification_question = "Please provide more detail so I can prepare the correct report."

    return {
        "report_type": report_type,
        "filters": filters,
        "needs_clarification": needs_clarification,
        "clarification_question": clarification_question,
        "llm_used": True,
        "model_used": model_used,
        "duration_ms": duration_ms,
        "token_usage": raw_intent.get("token_usage"),
    }


def _build_system_prompt() -> str:
    return """
You are an intent parser for a glaucoma screening report assistant.
Your only job is to convert the user's natural-language request into strict JSON.
Do not generate SQL. Do not invent patients. Do not invent clinical data. Do not decide report contents.

Return only one JSON object with this shape:
{
  "report_type": "patient_list | high_risk | screening_summary | user_list | referral_list | follow_up_list | patient_clinical_summary",
  "filters": {
    "status": "active | inactive | null",
    "diagnosis": "glaucoma | normal | null",
    "eye_side": "left | right | null",
    "role": "admin | doctor | nurse | null",
    "days_since_last_screening": null,
    "patient_id": null,
    "patient_code": null,
    "patient_name": null,
    "patient_query": null,
    "date_phrase": null,
    "date_from": null,
    "date_to": null,
    "date_label": null
  },
  "needs_clarification": false,
  "clarification_question": null
}

Rules:
- Use patient_clinical_summary for patient-specific clinical summaries, patient reports, longitudinal risk reports, or screening history for one patient.
- For a patient-specific report, copy the patient name or patient ID/code into patient_query unless the prompt clearly gives a UUID-like patient_id or code-like patient_code.
- If the user asks for a patient-specific report but gives no patient name or patient ID, set needs_clarification to true.
- Use high_risk for high-risk reports.
- Use screening_summary for screening activity summaries.
- Use referral_list for referral letter lists.
- Use follow_up_list for follow-up or overdue review lists.
- Use user_list for user, staff, doctor, nurse, or admin reports.
- Use patient_list for general patient list reports.
- Use only the supported enum values. If unsure, set needs_clarification to true.
- Preserve date phrases such as today, yesterday, this week, last week, this month, last month, this quarter, last quarter, this year, last year, last N days, or last N months in date_phrase.
- Return JSON only. No markdown. No explanation.
""".strip()


async def interpret_report_assistant_prompt(prompt: str) -> dict[str, Any]:
    user_prompt = _clean_text(prompt)

    if not user_prompt:
        raise ReportAssistantLLMError("Prompt is required.")

    enabled = bool(_setting("REPORT_ASSISTANT_LLM_ENABLED", False))

    if not enabled:
        raise ReportAssistantLLMDisabled("Report assistant LLM interpretation is disabled.")

    api_url = _clean_text(_setting("REPORT_ASSISTANT_LLM_API_URL"))
    model = _clean_text(_setting("REPORT_ASSISTANT_LLM_MODEL"))
    api_key = _clean_text(_setting("REPORT_ASSISTANT_LLM_API_KEY"))
    timeout_seconds = int(_setting("REPORT_ASSISTANT_LLM_TIMEOUT_SECONDS", 20) or 20)

    if not api_url:
        raise ReportAssistantLLMError("REPORT_ASSISTANT_LLM_API_URL is not configured.")

    if not model:
        raise ReportAssistantLLMError("REPORT_ASSISTANT_LLM_MODEL is not configured.")

    headers = {
        "Content-Type": "application/json",
    }

    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": _build_system_prompt(),
            },
            {
                "role": "user",
                "content": user_prompt,
            },
        ],
        "temperature": 0,
    }

    started_at = time.perf_counter()

    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        response = await client.post(api_url, json=payload, headers=headers)
        response.raise_for_status()

    duration_ms = int((time.perf_counter() - started_at) * 1000)
    response_data = response.json()
    content = _extract_llm_content(response_data)
    raw_intent = _extract_json_object(content)
    raw_intent["token_usage"] = response_data.get("usage")

    return _normalise_intent(
        raw_intent=raw_intent,
        duration_ms=duration_ms,
        model_used=model,
    )
