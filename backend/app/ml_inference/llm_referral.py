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
for a patient who has been flagged as glaucoma-suspicious by an AI screening system.

Patient: {patient_name}
Eye screened: {eye_side.capitalize()} eye
AI confidence score: {confidence_score:.1%}
{ohts_info}

Write a concise, professional referral letter (maximum 150 words), do not hallucinate we only base it on the provided information from a general 
ophthalmologist to a glaucoma specialist. The letter should:
1. State that the patient was flagged by an AI screening system
2. Mention the confidence score and eye side
3. Include OHTS risk score if available
4. Request specialist review and further evaluation
5. Use standard clinical terminology
6. NOT make a definitive diagnosis - this is a screening referral only

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

    return response.choices[0].message.content


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

    return response.choices[0].message.content


def generate_llama_vision(
    image_path: str,
    patient_name: str,
    eye_side: str,
    confidence_score: float,
    ohts_score: Optional[int] = None,
    ohts_tier: Optional[str] = None,
) -> str:
    # Generate referral letter using LLaMa Vision via Groq API.
    # Uses same prompt structure as GPT-4o for fair comparison.
    # Groq provides fast inference for LLaMa models.

    from groq import Groq

    client = Groq(api_key=settings.GROQ_API_KEY)

    image_base64 = encode_image_to_base64(image_path)
    prompt = build_clinical_prompt(
        patient_name, eye_side, confidence_score, ohts_score, ohts_tier
    )

    response = client.chat.completions.create(
        model="meta-llama/llama-4-scout-17b-16e-instruct",
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{image_base64}",
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

    return response.choices[0].message.content


def generate_gemini_vision(
    image_path: str,
    patient_name: str,
    eye_side: str,
    confidence_score: float,
    ohts_score: Optional[int] = None,
    ohts_tier: Optional[str] = None,
) -> str:
    # Generate referral letter using Google Gemini Vision API.
    # Uses gemini-2.0-flash - current stable vision model.
    # Same prompt structure as GPT-4o for fair multi-LLM comparison.

    from google import genai
    from google.genai import types

    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    prompt = build_clinical_prompt(
        patient_name, eye_side, confidence_score, ohts_score, ohts_tier
    )

    # Load image as bytes for Gemini
    with open(image_path, "rb") as f:
        image_bytes = f.read()

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=[
            types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
            types.Part.from_text(text=prompt),
        ],
    )

    return response.text


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
    # Returns dict of {llm_name: {"letter": text, "generation_time_ms": float}}
    # Skips LLMs that are not configured - logs warning but does not fail.

    import time

    if active_llms is None:
        active_llms = ["gpt4o", "gpt4o_mini", "llama", "gemini"]

    results = {} # Store results for each LLM - letter text and generation time

    for llm_name in active_llms:
        generator = LLM_GENERATORS.get(llm_name)
        if not generator:
            logger.warning(f"Unknown LLM: {llm_name}. Skipping.")
            continue

        try:
            logger.info(f"Generating referral letter with {llm_name}...")
            start_time = time.time()

            letter = generator(
                image_path=image_path,
                patient_name=patient_name,
                eye_side=eye_side,
                confidence_score=confidence_score,
                ohts_score=ohts_score,
                ohts_tier=ohts_tier,
            )
            letter = clean_referral_letter_body(letter) # Ensure only the letter body is kept, remove any LLM-generated signatures or closings.
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
            }
            logger.info(f"{llm_name} letter generated successfully in {generation_time_ms}ms.")

        except NotImplementedError as e:
            logger.warning(f"{llm_name} not configured: {e}")
        except Exception as e:
            logger.error(f"{llm_name} referral letter generation failed: {e}", exc_info=True)

    return results