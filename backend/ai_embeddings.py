import os
from typing import List, Optional

from flask import current_app
from openai import OpenAI


def get_openai_client() -> OpenAI:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set")
    return OpenAI(api_key=api_key)


def embed_text(text: str) -> Optional[List[float]]:
    cleaned = (text or "").strip()
    if not cleaned:
        return None
    try:
        client = get_openai_client()
    except Exception as exc:
        if current_app:
            current_app.logger.warning(f"Embedding unavailable: {exc}")
        return None
    try:
        model_name = os.environ.get("OPENAI_EMBED_MODEL", "text-embedding-3-small")
        resp = client.embeddings.create(model=model_name, input=cleaned[:7000])
        return resp.data[0].embedding
    except Exception as exc:
        if current_app:
            current_app.logger.warning(f"Embedding failed: {exc}")
        return None
