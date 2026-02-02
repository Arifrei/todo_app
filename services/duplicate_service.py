from text_helpers import (
    _containment_similarity,
    _cosine_similarity,
    _group_duplicates,
    _jaccard_similarity,
    _normalize_similarity_text,
    _sequence_similarity,
    _substring_similarity,
    _tokenize_similarity,
)


def build_list_preview_text(item):
    base = (item.text or "").strip()
    link_label = (item.link_text or "").strip()
    if base and link_label:
        if base == link_label:
            return base
        return f"{base} {link_label}".strip()
    return base or link_label


def detect_note_list_duplicates(items, section_prefix, embed_text_fn):
    section_by_id = {}
    current_section = None
    for item in items:
        text_value = (item.text or "").strip()
        if text_value.startswith(section_prefix):
            title = text_value[len(section_prefix) :].strip()
            current_section = title or "Untitled section"
            section_by_id[item.id] = current_section
            continue
        section_by_id[item.id] = current_section

    candidates = []
    for item in items:
        if (item.text or "").strip().startswith(section_prefix):
            continue
        preview = build_list_preview_text(item).strip()
        if not preview:
            continue
        candidates.append(
            {
                "id": item.id,
                "text": item.text or "",
                "note": item.note,
                "link_text": item.link_text,
                "link_url": item.link_url,
                "order_index": item.order_index or 0,
                "preview": preview,
                "section": section_by_id.get(item.id),
            }
        )

    if len(candidates) < 2:
        return {"groups": [], "method": "none", "threshold": None}

    normalized = [_normalize_similarity_text(item["preview"]) for item in candidates]
    tokens = [_tokenize_similarity(text) for text in normalized]

    embeddings = []
    for text in normalized:
        embedding = embed_text_fn(text)
        if embedding is None:
            embeddings = None
            break
        embeddings.append(embedding)

    if embeddings:
        threshold = 0.8

        def similarity_fn(i, j):
            cosine = _cosine_similarity(embeddings[i], embeddings[j])
            containment = _containment_similarity(tokens[i], tokens[j])
            substring = _substring_similarity(normalized[i], normalized[j])
            return max(cosine, containment, substring)

        grouped = _group_duplicates(candidates, similarity_fn, threshold)
        method = "embeddings"
    else:
        threshold = 0.6

        def similarity_fn(i, j):
            seq_score = _sequence_similarity(normalized[i], normalized[j])
            token_score = _jaccard_similarity(tokens[i], tokens[j])
            containment = _containment_similarity(tokens[i], tokens[j])
            substring = _substring_similarity(normalized[i], normalized[j])
            return max(seq_score, token_score, containment, substring)

        grouped = _group_duplicates(candidates, similarity_fn, threshold)
        method = "fuzzy"

    groups = []
    for group in grouped:
        sorted_group = sorted(group, key=lambda entry: entry["order_index"])
        groups.append(
            {
                "representative": sorted_group[0]["preview"],
                "items": [
                    {
                        "id": entry["id"],
                        "text": entry["text"],
                        "note": entry["note"],
                        "link_text": entry["link_text"],
                        "link_url": entry["link_url"],
                        "order_index": entry["order_index"],
                        "section": entry.get("section"),
                    }
                    for entry in sorted_group
                ],
            }
        )

    groups.sort(key=lambda entry: len(entry["items"]), reverse=True)
    return {"groups": groups, "method": method, "threshold": threshold}
