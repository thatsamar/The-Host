"""The taste graph: venue facts plus the judgment that makes them useful."""

import json
from dataclasses import dataclass, field
from pathlib import Path

# Controlled vocabulary from the brief. Tags outside this set are rejected so the
# graph stays queryable; add new ones here deliberately.
TASTE_TAGS = {
    "good-solo-at-bar",
    "client-safe-not-dead",
    "better-for-second-drink",
    "worth-crossing-town",
    "not-worth-crossing-town",
    "scene-tolerable",
    "scene-intolerable",
    "food-serious-room-warm",
    "design-better-than-food",
    "service-makes-it",
    "avoid-weekends",
    "best-early",
    "best-late",
    "good-after-flight",
    "good-before-theater",
    "good-for-difficult-parents",
    "good-for-second-date",
    "need-to-feel-alive",
    "has-soul",
    "looks-good-feels-empty",
    "instagram-casualty",
    "walk-ins",
    "counter-seating",
}

NOISE_LEVELS = {"quiet", "conversational", "lively", "loud"}


@dataclass
class Venue:
    id: str
    name: str
    city: str
    neighborhood: str
    category: str
    taste_tags: list[str]
    host_note: str  # one line, in The Host's voice: why, when, where to sit
    cuisine: str = ""
    price: int = 0  # 1-4, 0 unknown
    noise: str = ""
    dress: str = ""
    hours: str = ""
    address: str = ""
    booking: str = ""  # url or "walk-in" or "call"
    last_verified: str = ""  # ISO date a human last confirmed it's open and good

    def __post_init__(self):
        unknown = set(self.taste_tags) - TASTE_TAGS
        if unknown:
            raise ValueError(f"{self.id}: unknown taste tags {sorted(unknown)}")
        if self.noise and self.noise not in NOISE_LEVELS:
            raise ValueError(f"{self.id}: noise must be one of {sorted(NOISE_LEVELS)}")
        if not 0 <= self.price <= 4:
            raise ValueError(f"{self.id}: price must be 0-4")

    def to_prompt_line(self) -> str:
        facts = [self.category, self.cuisine, "$" * self.price, self.noise, self.hours, self.booking]
        facts = " · ".join(f for f in facts if f)
        return f"- [{self.id}] {self.name} ({self.neighborhood}) — {facts}. Tags: {', '.join(self.taste_tags)}. Note: {self.host_note}"


@dataclass
class City:
    name: str
    neighborhoods_notes: str
    venues: list[Venue] = field(default_factory=list)

    def to_prompt(self) -> str:
        lines = [f"## {self.name}", self.neighborhoods_notes.strip()]
        lines += [v.to_prompt_line() for v in self.venues] or ["(No curated venues yet. Do not name places; describe the kind of place and set needs_curation.)"]
        return "\n".join(lines)


def load_city(path: Path) -> City:
    data = json.loads(path.read_text())
    venues = [Venue(**v) for v in data.get("venues", [])]
    ids = [v.id for v in venues]
    if len(ids) != len(set(ids)):
        raise ValueError(f"{path}: duplicate venue ids")
    return City(name=data["name"], neighborhoods_notes=data.get("neighborhoods_notes", ""), venues=venues)


def load_cities(directory: Path) -> list[City]:
    """Load every city file; files starting with '_' are templates and skipped."""
    return [load_city(p) for p in sorted(directory.glob("*.json")) if not p.name.startswith("_")]
