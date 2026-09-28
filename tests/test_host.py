import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from host.engine import Conversation, HostRefused
from host.memory import TasteProfile, load_profile, save_profile
from host.prompt import build_system_prompt
from host.reply import REPLY_SCHEMA, HostReply
from host.venues import City, Venue, load_cities
from host.voice import lint

ROOT = Path(__file__).resolve().parent.parent

# Fictional venue for tests only.
VENUE = dict(id="test-counter", name="Test Counter", city="Testville", neighborhood="Old Town",
             category="restaurant", taste_tags=["good-solo-at-bar", "has-soul"],
             host_note="Sit at the counter.", price=2, noise="lively")

PLAN = {"kind": "plan", "questions": [], "lead": "", "do_this": "Drink first, dinner at the counter.",
        "backup": "Walk-in bar seating nearby.", "avoid": "Don't cross town.",
        "action": "Want me to try for 8:30?", "venue_ids": ["test-counter"],
        "needs_curation": False, "learned": ["prefers counter seating"]}


def test_lint_catches_dead_language():
    assert lint("A true Hidden Gem on a culinary journey") == ["hidden gem", "culinary journey"]
    assert lint("Sit at the bar. Book the earlier time.") == []


def test_venue_rejects_unknown_tags():
    with pytest.raises(ValueError, match="unknown taste tags"):
        Venue(**{**VENUE, "taste_tags": ["vibes"]})


def test_shipped_city_files_load():
    cities = load_cities(ROOT / "data" / "cities")
    assert "Mexico City" in [c.name for c in cities]
    assert all(c.name != "City Name" for c in cities), "template must be skipped"


def test_template_is_valid():
    from host.venues import load_city
    assert load_city(ROOT / "data" / "cities" / "_template.json").venues


def test_plan_renders_as_text():
    sms = HostReply.from_dict(PLAN).to_sms()
    assert sms.startswith("Do this: Drink first")
    assert "Backup: " in sms and "Avoid: " in sms and sms.endswith("8:30?")


def test_ask_renders_choices():
    reply = HostReply.from_dict({**PLAN, "kind": "ask", "do_this": "", "questions": [
        {"prompt": "Solo, date, friends, or work?", "choices": ["Solo", "Date", "Friends", "Work"]}]})
    assert reply.to_sms() == "Solo, date, friends, or work? (Solo / Date / Friends / Work)"


def test_problems_flag_invented_venues_and_dead_language():
    reply = HostReply.from_dict({**PLAN, "do_this": "A hidden gem.", "venue_ids": ["made-up"]})
    problems = reply.problems({"test-counter"})
    assert any("dead language" in p for p in problems)
    assert any("made-up" in p for p in problems)
    assert HostReply.from_dict(PLAN).problems({"test-counter"}) == []


def test_schema_requires_every_field():
    assert set(REPLY_SCHEMA["required"]) == set(REPLY_SCHEMA["properties"]) == set(PLAN)


def test_system_prompt_includes_doctrine_and_venues():
    prompt = build_system_prompt([City("Testville", "Stay in Old Town.", [Venue(**VENUE)])])
    assert "<taste_doctrine>" in prompt and "A place should have a pulse." in prompt
    assert "[test-counter] Test Counter (Old Town)" in prompt
    assert '"hidden gem"' in prompt
    assert "needs_curation" in build_system_prompt([City("Empty", "")])


def test_profile_round_trip_dedupes(tmp_path):
    p = TasteProfile("u1")
    p.remember(["Prefers counter seating", "prefers counter seating", " "])
    save_profile(tmp_path, p)
    assert load_profile(tmp_path, "u1").observations == ["Prefers counter seating"]
    assert load_profile(tmp_path, "nobody").observations == []


class FakeMessages:
    def __init__(self, response):
        self.response, self.calls = response, []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.response


def fake_client(response):
    return SimpleNamespace(beta=SimpleNamespace(messages=FakeMessages(response)))


def test_conversation_sends_profile_first_and_parses_reply():
    response = SimpleNamespace(stop_reason="end_turn", content=[
        SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text=json.dumps(PLAN))])
    client = fake_client(response)
    convo = Conversation("SYSTEM", TasteProfile("u1", observations=["hates stiff service"]), client)

    reply = convo.send("Mexico City tonight.")
    assert reply.do_this == PLAN["do_this"]
    call = client.beta.messages.calls[0]
    assert "hates stiff service" in call["messages"][0]["content"]
    assert call["output_config"]["format"]["schema"] is REPLY_SCHEMA
    assert call["fallbacks"] == "default"

    convo.send("Food-first.", operator_note="edited")
    assert convo.messages[1]["role"] == "assistant"
    assert convo.messages[2]["content"].startswith("<operator_note>edited</operator_note>")
    assert "user_profile" not in convo.messages[2]["content"]


def test_conversation_refusal_leaves_history_clean():
    response = SimpleNamespace(stop_reason="refusal", content=[], stop_details=SimpleNamespace(explanation="no"))
    convo = Conversation("SYSTEM", TasteProfile("u1"), fake_client(response))
    with pytest.raises(HostRefused):
        convo.send("hi")
    assert convo.messages == []
