# backend/app/ml_inference/llm_referral.py
#
# Multi-LLM referral letter generation.
# Generates structured clinical referral letters from screening results.
# Currently active: GPT-4o Vision, GPT-4o-mini.
# Placeholders ready: LLaMa Vision, Gemini Vision.
# Letters are only generated when prediction is glaucoma.
# Each model generates independently - results saved separately for comparison.

import base64
from typing import Optional

from openai import OpenAI

from app.core.config import settings
from app.core.logger import get_logger
import re

logger = get_logger(__name__)


def encode_image_to_base64(image_path: str) -> str:
    # Convert image file to base64 string for Vision API transmission.
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode("utf-8")


def build_clinical_prompt(
    patient_name: str,
    eye_side: str,
    confidence_score: float,
    ohts_score: Optional[int],
    ohts_tier: Optional[str],
) -> str:
    # Build a structured clinical prompt for referral letter generation.
    # Instructs the LLM to act as a clinical assistant, not a diagnostician.
    # The system is a screening tool - letter reflects that framing.
    #
    # PROMPT VERSION 2 - updated to explicitly require a screening disclaimer
    # sentence (D3 in the LLM evaluation rubric). Version 1 only said "do NOT
    # make a definitive diagnosis" as a negative instruction, which most LLMs
    # interpreted as "omit a diagnosis" rather than "explicitly state this is
    # screening only." Version 2 adds a positive requirement to include a
    # specific disclaimer sentence, directly addressing the D3 weakness
    # identified across all 4 LLMs in the  evaluation (GPT-4o: 0.057,
    # GPT-4o-mini: 0.086, LLaMa: 0.029, Gemini: 0.343).

    ohts_info = ""
    if ohts_score is not None and ohts_tier is not None:
        ohts_info = f"OHTS 5-year risk score: {ohts_score} ({ohts_tier.upper()} tier)."
        if ohts_tier.lower() == "low":
            ohts_info += (
                " Note: The OHTS score reflects future risk based on IOP and corneal thickness. "
                "A low OHTS score does not exclude current structural glaucomatous damage "
                "which has been flagged by the AI screening system."
            )

    return f"""
You are a clinical assistant helping a general ophthalmologist prepare a referral letter 
for a patient who has been flagged as glaucoma-suspicious by an glaucoma AI screening system.

Patient: {patient_name}
Eye screened: {eye_side.capitalize()} eye
AI confidence score: {confidence_score:.1%}
{ohts_info}

Write a concise, professional referral letter (maximum 150 words), do not hallucinate and fabricate, we only base it on the provided information from a general 
ophthalmologist to a glaucoma specialist. The letter should:
1. State that the patient was flagged by an AI screening system
2. Mention the confidence score and eye side
3. Include OHTS risk score if available
4. Request specialist review and further evaluation
5. Use standard clinical terminology
6. NOT make a definitive diagnosis - this is a screening referral only
7. Include an explicit sentence stating that this referral is based on an AI screening result and does not constitute a definitive clinical diagnosis - this sentence is mandatory

Write only the body of the letter starting with "Dear Colleague,".
Do not include any closing phrase, signature, clinician name, title, contact information, or placeholders such as [Your Name].
"""
def clean_referral_letter_body(letter: str) -> str:
    if not letter:
        return ""

    cleaned = letter.strip()

    # Remove common LLM-generated closing/signature blocks.
    cleaned = re.sub(
        r"(?is)\n\s*(sincerely|kind regards|regards|yours sincerely|yours faithfully),?\s*\n.*$",
        "",
        cleaned,
    )

    # Extra safety for placeholder-only signatures.
    cleaned = re.sub(
        r"(?is)\n\s*\[your name\].*$",
        "",
        cleaned,
    )

    return cleaned.strip()

def generate_gpt4o_vision(
    image_path: str,
    patient_name: str,
    eye_side: str,
    confidence_score: float,
    ohts_score: Optional[int] = None,
    ohts_tier: Optional[str] = None,
) -> str:
    # Generate referral letter using GPT-4o Vision.
    # Sends the fundus image along with clinical data.
    # Returns the generated letter text.
    # Returns dict with letter text and token usage.

    client = OpenAI(api_key=settings.OPENAI_API_KEY)

    image_base64 = encode_image_to_base64(image_path)
    prompt = build_clinical_prompt(
        patient_name, eye_side, confidence_score, ohts_score, ohts_tier
    )

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{image_base64}",
                            "detail": "high",
                        },
                    },
                    {
                        "type": "text",
                        "text": prompt,
                    },
                ],
            }
        ],
        max_tokens=300,
    )

    return {
        "letter": response.choices[0].message.content,
        "prompt_tokens": response.usage.prompt_tokens,
        "completion_tokens": response.usage.completion_tokens,
        "total_tokens": response.usage.total_tokens,
    }


def generate_gpt4o_mini(
    image_path: str,
    patient_name: str,
    eye_side: str,
    confidence_score: float,
    ohts_score: Optional[int] = None,
    ohts_tier: Optional[str] = None,
) -> str:
    # Generate referral letter using GPT-4o-mini.
    # Same prompt as GPT-4o for fair comparison.
    # Lower cost, faster response - good for comparison baseline.
    # Returns dict with letter text and token usage.

    client = OpenAI(api_key=settings.OPENAI_API_KEY)

    image_base64 = encode_image_to_base64(image_path)
    prompt = build_clinical_prompt(
        patient_name, eye_side, confidence_score, ohts_score, ohts_tier
    )

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{image_base64}",
                            "detail": "high",
                        },
                    },
                    {
                        "type": "text",
                        "text": prompt,
                    },
                ],
            }
        ],
        max_tokens=300,
    )

    return {
        "letter": response.choices[0].message.content,
        "prompt_tokens": response.usage.prompt_tokens,
        "completion_tokens": response.usage.completion_tokens,
        "total_tokens": response.usage.total_tokens,
    }


def generate_llama_vision(
    image_path: str,
    patient_name: str,
    eye_side: str,
    confidence_score: float,
    ohts_score: Optional[int] = None,
    ohts_tier: Optional[str] = None,
) -> dict:
    # Generate referral letter using openai/gpt-oss-120b via Groq API.
    #
    # NOTE: This function previously used meta-llama/llama-4-scout-17b-16e-instruct
    # (a vision model). Switched away from it for two confirmed reasons:
    #   1. Groq deprecated llama-4-scout-17b-16e-instruct on 17 June 2026,
    #      recommending migration to openai/gpt-oss-120b.
    #   2. During Paper 2 LLM comparison testing, llama-4-scout produced
    #      incoherent/garbled output on 2 of 6 real test cases (Scenario 3) -
    #      consistent with documented Groq-side reliability incidents for
    #      that specific model around the same period.
    #
    # gpt-oss-120b is TEXT-ONLY (no vision support) - confirmed via Groq's
    # and OpenAI's own model documentation. This is fine for this use case:
    # reviewing real generated referral letters from the other 3 LLMs shows
    # none of them actually describe visual features of the fundus image
    # itself (no mention of optic disc appearance, cupping, vessel patterns,
    # etc.) - every letter just restates the clinical figures already
    # present in the text prompt (confidence score, OHTS score, eye side).
    # The image is therefore dropped from this specific call; all clinical
    # context is still passed via the same text prompt used by the other
    # 3 LLMs so the comparison remains fair on content.
    #
    # image_path is kept as a parameter for interface consistency with the
    # other 3 generator functions (and so call sites don't need special-
    # casing), but is intentionally unused here.
    # Returns dict with letter text and token usage.

    from groq import Groq

    client = Groq(api_key=settings.GROQ_API_KEY)

    prompt = build_clinical_prompt(
        patient_name, eye_side, confidence_score, ohts_score, ohts_tier
    )

    response = client.chat.completions.create(
        model="openai/gpt-oss-120b",
        messages=[
            {
                "role": "user",
                "content": prompt,
            }
        ],
        max_tokens=700,
        reasoning_effort="low",
    )

    return {
        "letter": response.choices[0].message.content,
        "prompt_tokens": response.usage.prompt_tokens,
        "completion_tokens": response.usage.completion_tokens,
        "total_tokens": response.usage.total_tokens,
    }


def generate_gemini_vision(
    image_path: str,
    patient_name: str,
    eye_side: str,
    confidence_score: float,
    ohts_score: Optional[int] = None,
    ohts_tier: Optional[str] = None,
) -> dict:
    # Generate referral letter using Google Gemini Vision API.
    #
    # Switched from gemini-2.5-flash to gemini-3.5-flash on 21 June 2026.
    # Reason: gemini-2.5-flash's free tier hit a confirmed hard daily quota
    # ceiling (real API error showed limit=20 requests/day for this
    # project+model combination, despite general published docs suggesting
    # 250/day - the live error from our own account is the ground truth
    # here). This made it impossible to complete the 35-case Paper 2 LLM
    # comparison study in a single day on the free tier.
    # gemini-3.5-flash confirmed working on a separate, non-exhausted quota
    # pool via direct API testing - successful vision + text calls, clean
    # FINISH REASON: STOP, no quota errors.
    #
    # Same prompt structure as GPT-4o/GPT-4o-mini for fair multi-LLM
    # comparison. usage_metadata field names confirmed unchanged from
    # gemini-2.5-flash's response shape (prompt_token_count,
    # candidates_token_count, total_token_count) - no normalisation logic
    # changes needed below.
    #
    # NOTE: gemini-3.5-flash is also a reasoning model - usage_metadata
    # includes a separate thoughts_token_count field (confirmed via direct
    # testing, e.g. 907 reasoning tokens vs 158 visible answer tokens on
    # one real test case). Unlike gpt-oss-120b, reasoning and visible
    # answer tokens did NOT compete for the same budget in testing -
    # finish_reason was STOP (completed naturally) with default settings,
    # no empty-content issue observed. No special reasoning_effort or
    # max_tokens adjustment was needed for Gemini, unlike the fix required
    # for the LLaMa/gpt-oss-120b function.
    #
    # Returns dict with letter text and token usage (prompt + completion
    # only - thoughts_token_count is not currently captured/saved, since
    # screening_results only has prompt_tokens/completion_tokens/
    # total_tokens columns, matching the other 3 LLMs' shape).

    from google import genai
    from google.genai import types

    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    prompt = build_clinical_prompt(
        patient_name, eye_side, confidence_score, ohts_score, ohts_tier
    )

    with open(image_path, "rb") as f:
        image_bytes = f.read()

    response = client.models.generate_content(
        model="gemini-3.5-flash",
        contents=[
            types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
            types.Part.from_text(text=prompt),
        ],
    )

    usage = response.usage_metadata

    return {
        "letter": response.text,
        "prompt_tokens": usage.prompt_token_count,
        "completion_tokens": usage.candidates_token_count,
        "total_tokens": usage.total_token_count,
    }


# Registry mapping LLM name to generator function
LLM_GENERATORS = {
    "gpt4o": generate_gpt4o_vision,
    "gpt4o_mini": generate_gpt4o_mini,
    "llama": generate_llama_vision,
    "gemini": generate_gemini_vision,
}


def generate_referral_letters(
    image_path: str,
    patient_name: str,
    eye_side: str,
    confidence_score: float,
    ohts_score: Optional[int] = None,
    ohts_tier: Optional[str] = None,
    active_llms: list[str] = None,
    clinician_name: str = "Dr. [Clinician Name]",
    clinician_title: str = "General Ophthalmologist",
) -> dict:
    # Generate referral letters from all active LLMs.
    # Returns dict of {llm_name: {"letter": text, "generation_time_ms": float,
    #                              "prompt_tokens": int, "completion_tokens": int,
    #                              "total_tokens": int}}
    # Skips LLMs that are not configured - logs warning but does not fail.

    import time

    if active_llms is None:
        active_llms = ["gpt4o", "gpt4o_mini", "llama", "gemini"]

    results = {}  # Store results for each LLM - letter text, timing, and token usage

    for llm_name in active_llms:
        generator = LLM_GENERATORS.get(llm_name)
        if not generator:
            logger.warning(f"Unknown LLM: {llm_name}. Skipping.")
            continue

        try:
            logger.info(f"Generating referral letter with {llm_name}...")
            start_time = time.time()

            generator_result = generator(
                image_path=image_path,
                patient_name=patient_name,
                eye_side=eye_side,
                confidence_score=confidence_score,
                ohts_score=ohts_score,
                ohts_tier=ohts_tier,
            )
            # generator_result is now a dict: {"letter": ..., "prompt_tokens": ...,
            # "completion_tokens": ..., "total_tokens": ...} - all 4 generator
            # functions return this same shape now, including Gemini whose
            # native field names are already normalised inside its own function.

            letter = clean_referral_letter_body(generator_result["letter"])
            # Keep the LLM output as letter body only.
            # Final signatory is handled by ScreeningResult.signed_by and PDF rendering.
            letter = letter.replace("[Your Name]", clinician_name)
            letter = letter.replace("[Your Title]", clinician_title)
            letter = letter.replace(
                "[Your Name/General Ophthalmologist]",
                f"{clinician_name}\n{clinician_title}",
            )

            generation_time_ms = round((time.time() - start_time) * 1000, 2)
            results[llm_name] = {
                "letter": letter,
                "generation_time_ms": generation_time_ms,
                "prompt_tokens": generator_result["prompt_tokens"],
                "completion_tokens": generator_result["completion_tokens"],
                "total_tokens": generator_result["total_tokens"],
            }
            logger.info(
                f"{llm_name} letter generated successfully in {generation_time_ms}ms. "
                f"Tokens: prompt={generator_result['prompt_tokens']} "
                f"completion={generator_result['completion_tokens']} "
                f"total={generator_result['total_tokens']}"
            )

        except NotImplementedError as e:
            logger.warning(f"{llm_name} not configured: {e}")
        except Exception as e:
            logger.error(f"{llm_name} referral letter generation failed: {e}", exc_info=True)

    return results