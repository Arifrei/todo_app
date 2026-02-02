import json
import os
import re

from ai_embeddings import get_openai_client


def parse_json_object(response_text):
    """Parse a JSON object from model output, tolerating wrapper text."""
    if not response_text:
        return None
    try:
        return json.loads(response_text)
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{[^{}]*\}", response_text)
    if not match:
        return None
    try:
        return json.loads(match.group())
    except json.JSONDecodeError:
        return None


def call_chat_text(
    system_prompt,
    user_content,
    *,
    max_tokens=500,
    temperature=0.3,
    retry_json=False,
    logger=None,
):
    """Call OpenAI chat completion and return response content or None."""
    prompt = system_prompt
    if retry_json:
        prompt += "\n\nCRITICAL: Return ONLY valid JSON. No other text, no markdown, no explanation."

    try:
        client = get_openai_client()
        response = client.chat.completions.create(
            model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": user_content},
            ],
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return response.choices[0].message.content
    except Exception as exc:
        if logger:
            logger.warning("OpenAI API error: %s", exc)
        return None


def call_chat_json(
    system_prompt,
    user_content,
    *,
    max_tokens=500,
    temperature=0.3,
    retries=1,
    logger=None,
):
    """Call model and parse JSON response, retrying with stricter JSON-only mode."""
    response_text = call_chat_text(
        system_prompt,
        user_content,
        max_tokens=max_tokens,
        temperature=temperature,
        retry_json=False,
        logger=logger,
    )
    parsed = parse_json_object(response_text)
    if parsed is not None:
        return parsed

    attempts = max(0, int(retries))
    for _ in range(attempts):
        response_text = call_chat_text(
            system_prompt,
            user_content,
            max_tokens=max_tokens,
            temperature=temperature,
            retry_json=True,
            logger=logger,
        )
        parsed = parse_json_object(response_text)
        if parsed is not None:
            return parsed
    return None
