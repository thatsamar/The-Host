"""The shape of every answer: ask, or plan / backup / avoid / action."""

from dataclasses import dataclass

from .voice import lint

# JSON schema passed to output_config.format. Every field is always present;
# unused ones are empty so the schema stays strict.
REPLY_SCHEMA = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["ask", "plan"]},
        "questions": {
            "type": "array",
            "description": "Only when kind=ask. At most three, each with short tappable choices.",
            "items": {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string"},
                    "choices": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["prompt", "choices"],
                "additionalProperties": False,
            },
        },
        "lead": {"type": "string", "description": "Optional one-line read of the situation or push-back. Empty if not needed."},
        "do_this": {"type": "string"},
        "backup": {"type": "string"},
        "avoid": {"type": "string"},
        "action": {"type": "string", "description": "One question offering the next step, e.g. 'Want me to try for 8:30?'"},
        "venue_ids": {"type": "array", "items": {"type": "string"}, "description": "Curated venue ids used in the plan."},
        "needs_curation": {"type": "boolean", "description": "True if the curated set doesn't cover this request well."},
        "learned": {"type": "array", "items": {"type": "string"}, "description": "New durable taste observations about this user, if any."},
    },
    "required": ["kind", "questions", "lead", "do_this", "backup", "avoid", "action", "venue_ids", "needs_curation", "learned"],
    "additionalProperties": False,
}


@dataclass
class Question:
    prompt: str
    choices: list[str]


@dataclass
class HostReply:
    kind: str
    questions: list[Question]
    lead: str
    do_this: str
    backup: str
    avoid: str
    action: str
    venue_ids: list[str]
    needs_curation: bool
    learned: list[str]

    @classmethod
    def from_dict(cls, d: dict) -> "HostReply":
        return cls(**{**d, "questions": [Question(**q) for q in d["questions"]]})

    def to_sms(self) -> str:
        parts = [self.lead] if self.lead else []
        if self.kind == "ask":
            for q in self.questions:
                parts.append(q.prompt if not q.choices else f"{q.prompt} ({' / '.join(q.choices)})")
            return "\n".join(parts)
        parts.append(f"Do this: {self.do_this}")
        if self.backup:
            parts.append(f"Backup: {self.backup}")
        if self.avoid:
            parts.append(f"Avoid: {self.avoid}")
        if self.action:
            parts.append(self.action)
        return "\n\n".join(parts)

    def problems(self, known_venue_ids: set[str]) -> list[str]:
        """Things an operator must look at before this goes out."""
        issues = [f"dead language: {p!r}" for p in lint(self.to_sms())]
        if self.kind == "ask" and len(self.questions) > 3:
            issues.append(f"asks {len(self.questions)} questions; max is 3")
        if self.kind == "plan" and not self.do_this:
            issues.append("plan has no 'do this'")
        unknown = set(self.venue_ids) - known_venue_ids
        if unknown:
            issues.append(f"references venues not in the curated set: {sorted(unknown)}")
        if self.needs_curation:
            issues.append("model flagged: curated set doesn't cover this well")
        return issues
