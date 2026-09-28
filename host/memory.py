"""User taste memory. Learned from use, not from onboarding surveys."""

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path


@dataclass
class TasteProfile:
    user_id: str
    home_city: str = ""
    observations: list[str] = field(default_factory=list)  # "prefers counter seating", "hates stiff service"

    def remember(self, notes: list[str]) -> None:
        for note in notes:
            note = note.strip()
            if note and note.lower() not in {o.lower() for o in self.observations}:
                self.observations.append(note)

    def to_prompt(self) -> str:
        if not self.observations:
            return "New user. Nothing known yet — ask only what you need."
        return "Known about this user:\n" + "\n".join(f"- {o}" for o in self.observations)


def load_profile(directory: Path, user_id: str) -> TasteProfile:
    path = directory / f"{user_id}.json"
    if path.exists():
        return TasteProfile(**json.loads(path.read_text()))
    return TasteProfile(user_id=user_id)


def save_profile(directory: Path, profile: TasteProfile) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"{profile.user_id}.json").write_text(json.dumps(asdict(profile), indent=2) + "\n")
