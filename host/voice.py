"""Voice rules. Dead language never reaches a user."""

import re

# From the brief: "linguistic food poisoning". Extend freely; never shrink without a reason.
BANNED_PHRASES = [
    "unforgettable experience",
    "hidden gem",
    "culinary journey",
    "vibrant neighborhood",
    "vibrant neighbourhood",
    "perfect for foodies",
    "elevated yet approachable",
    "here are some great options",
    "here are some options",
    "something for everyone",
    "authentic local discovery",
    "must-visit",
    "must-try",
    "foodie",
    "curated experience",
    "nestled",
    "bustling",
    "tucked away",
]

_PATTERNS = [(p, re.compile(r"\b" + re.escape(p) + r"s?\b", re.IGNORECASE)) for p in BANNED_PHRASES]


def lint(text: str) -> list[str]:
    """Return the banned phrases found in text, in list order."""
    return [phrase for phrase, pattern in _PATTERNS if pattern.search(text)]
