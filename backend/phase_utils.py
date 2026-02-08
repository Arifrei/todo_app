from typing import Iterable


def is_phase_header(item) -> bool:
    """Canonical check for phase headers (supports legacy status='phase')."""
    return getattr(item, "is_phase", False) or getattr(item, "status", None) == "phase"


def _iter_phase_items(container) -> Iterable:
    items = getattr(container, "items", container)
    if items is None:
        return []
    return items


def canonicalize_phase_flags(container, commit_callback=None) -> bool:
    """
    Normalize legacy phase flags in-place.

    Accepts either an iterable of items or an object with an `.items` attribute.
    Returns True when any item was changed.
    """
    changed = False
    for item in _iter_phase_items(container):
        if getattr(item, "status", None) == "phase" and not getattr(item, "is_phase", False):
            item.is_phase = True
            item.status = "not_started"
            changed = True
    if changed and commit_callback:
        commit_callback()
    return changed
