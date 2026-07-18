# generates referral letters from screening results using multiple LLMs.
# GPT-4o and GPT-4o-mini are the main ones, LLaMa and Gemini are wired up too.
# only runs when the prediction is glaucoma, and each model runs independently
# so we can compare their outputs.

import base64
from typing import Optional

from openai import OpenAI

from app.core.config import settings
from app.core.logger import get_logger
import re

logger = get_logger(__name__)


def encode_image_to_base64(image_path: str) -> str:
    # vision APIs want the image as base64
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode("utf-8")


def build_clinical_prompt(
    patient_name: str,
    eye_side: str,
    confidence_score: float,
    ohts_score: Optional[int],
    ohts_tier: Optional[str],
) -> str:
    # builds the prompt that tells the LLM to act as a clinical assistant
    # (not a diagnostician) and frame the letter around this being a
    # screening tool, not a diagnosis.
    #
    # this is prompt v2 - v1 only told the model "do NOT make a definitive
    # diagnosis" as a negative instruction, and most LLMs read that as "just
    # omit the diagnosis" rather than "say out loud this is screening only."
    # that showed up as a weak D3 score across all 4 LLMs in evaluation
    # (GPT-4o: 0.057, GPT-4o-mini: 0.086, LLaMa: 0.029, Gemini: 0.343), so v2
    # adds a positive requirement to include an explicit disclaimer sentence.

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

    # strip whatever closing/signature block the LLM tacked on
    cleaned = re.sub(
        r"(?is)\n\s*(sincerely|kind regards|regards|yours sincerely|yours faithfully),?\s*\n.*$",
        "",
        cleaned,
    )

    # catches the case where it's just a placeholder signature left behind
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
    # sends the fundus image + clinical data to GPT-4o, returns letter + token usage

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
    # same prompt as GPT-4o so the comparison is fair - mini is cheaper and
    # faster, works well as a baseline

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
    # this runs on openai/gpt-oss-120b via Groq, not llama-4-scout anymore.
    #
    # we switched off llama-4-scout-17b-16e-instruct for two reasons: Groq
    # deprecated it on 17 June 2026 (pointing people at gpt-oss-120b instead),
    # and during Paper 2 testing it was giving garbled output on 2 of 6 real
    # test cases (Scenario 3) - matches other reports of that model being
    # flaky around the same time.
    #
    # gpt-oss-120b is text-only, no vision support (checked Groq's and
    # OpenAI's docs). that's actually fine here - looking back at real
    # letters from the other 3 LLMs, none of them describe anything visual
    # from the fundus image (no mention of disc appearance, cupping, vessels)
    # - they just restate the clinical numbers already in the text prompt.
    # so we drop the image for this call and rely on the same text prompt as
    # the other three, keeping the comparison fair on content.
    #
    # image_path stays as a param even though it's unused, just so the
    # signature matches the other 3 generators and callers don't need to
    # special-case this one.

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
    # moved from gemini-2.5-flash to gemini-3.5-flash on 21 June 2026 because
    # the 2.5-flash free tier kept hitting a hard daily quota wall - our own
    # account's error showed limit=20 requests/day for this project+model,
    # way below the ~250/day the docs advertise. couldn't get through the
    # 35-case Paper 2 comparison study in a day on that tier. 3.5-flash tested
    # fine on a separate quota pool - clean vision + text calls, FINISH
    # REASON: STOP, no quota errors.
    #
    # same prompt structure as GPT-4o/GPT-4o-mini for a fair comparison.
    # usage_metadata field names are unchanged from 2.5-flash's shape
    # (prompt_token_count, candidates_token_count, total_token_count) so no
    # normalisation changes needed here.
    #
    # 3.5-flash is a reasoning model, so usage_metadata also has a
    # thoughts_token_count we don't use (saw 907 reasoning tokens vs 158
    # visible tokens on one test case). unlike gpt-oss-120b though, reasoning
    # and visible tokens didn't compete for the same budget - finish_reason
    # came back STOP with default settings every time, so no reasoning_effort
    # or max_tokens tweak was needed here like it was for the LLaMa function.
    #
    # only prompt/completion tokens get returned below - thoughts_token_count
    # isn't saved since screening_results doesn't have a column for it and
    # we want the same shape as the other 3 LLMs.

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


# maps LLM name -> its generator function
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
    # runs every active LLM and collects letter + timing + token usage into
    # one dict keyed by llm_name. if one isn't configured we just log a
    # warning and skip it rather than failing the whole batch.

    import time

    if active_llms is None:
        active_llms = ["gpt4o", "gpt4o_mini", "llama", "gemini"]

    results = {}

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
            # all 4 generators return the same shape now (letter/prompt_tokens/
            # completion_tokens/total_tokens) - Gemini's native field names get
            # normalised to this inside its own function

            letter = clean_referral_letter_body(generator_result["letter"])
            # just the letter body here - the signature is handled separately
            # by ScreeningResult.signed_by and the PDF rendering
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