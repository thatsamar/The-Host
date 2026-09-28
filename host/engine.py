"""One conversation with The Host."""

import json
import os

import anthropic

from .memory import TasteProfile
from .reply import REPLY_SCHEMA, HostReply

MODEL = os.environ.get("HOST_MODEL", "claude-opus-5")
# Texting wants speed; raise to "high" if plan quality needs it.
EFFORT = os.environ.get("HOST_EFFORT", "medium")


class HostRefused(Exception):
    pass


class Conversation:
    def __init__(self, system_prompt: str, profile: TasteProfile, client: anthropic.Anthropic | None = None):
        self.client = client or anthropic.Anthropic()
        self.system_prompt = system_prompt
        self.profile = profile
        self.messages: list[dict] = []

    def send(self, text: str, operator_note: str = "") -> HostReply:
        """Send a user text; return The Host's draft reply.

        operator_note tells the model what actually went out when a human edited
        the previous draft. History stays append-only.
        """
        content = text
        if not self.messages:
            content = f"<user_profile>\n{self.profile.to_prompt()}\n</user_profile>\n\n{text}"
        if operator_note:
            content = f"<operator_note>{operator_note}</operator_note>\n\n{content}"
        self.messages.append({"role": "user", "content": content})

        response = self.client.beta.messages.create(
            model=MODEL,
            max_tokens=16000,
            system=[{"type": "text", "text": self.system_prompt, "cache_control": {"type": "ephemeral"}}],
            messages=self.messages,
            thinking={"type": "adaptive"},
            output_config={"effort": EFFORT, "format": {"type": "json_schema", "schema": REPLY_SCHEMA}},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
        if response.stop_reason == "refusal":
            self.messages.pop()
            raise HostRefused(getattr(response.stop_details, "explanation", None) or "request declined")
        if response.stop_reason == "max_tokens":
            self.messages.pop()
            raise RuntimeError("reply hit max_tokens")

        self.messages.append({"role": "assistant", "content": response.content})
        text_out = next(b.text for b in response.content if b.type == "text")
        return HostReply.from_dict(json.loads(text_out))
