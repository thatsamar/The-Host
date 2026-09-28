"""Text The Host from a terminal. The SMS prototype, minus the SMS.

    host-cli --user amar            # talk to The Host directly
    host-cli --user amar --review   # operator sees each draft first
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from .engine import Conversation, HostRefused
from .memory import load_profile, save_profile
from .prompt import ROOT, build_system_prompt
from .venues import load_cities

DATA = ROOT / "data"
CHECKLIST = [
    "Plan makes sense", "Geography sane", "Venue open", "Bookable", "Matches taste",
    "Not too obvious", "Not too obscure", "Paced well", "We'd send someone we like",
]


def log(event: dict) -> None:
    path = DATA / "log" / f"{datetime.now(timezone.utc):%Y-%m-%d}.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as f:
        f.write(json.dumps({"at": datetime.now(timezone.utc).isoformat(), **event}) + "\n")


def review(draft: str, problems: list[str]) -> tuple[str, str]:
    """Operator gate. Returns (verdict, text_to_send)."""
    print("\n--- DRAFT ---\n" + draft + "\n-------------")
    for p in problems:
        print(f"  ! {p}")
    print("  Check: " + " · ".join(CHECKLIST))
    while True:
        choice = input("[s]end / [e]dit / [r]edo > ").strip().lower()
        if choice == "s":
            return "sent", draft
        if choice == "e":
            print("Type the replacement, end with a line containing only '.':")
            lines = []
            while (line := input()) != ".":
                lines.append(line)
            return "edited", "\n".join(lines)
        if choice == "r":
            return "redo", ""


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--user", required=True, help="user id; taste memory lives in data/users/<id>.json")
    parser.add_argument("--review", action="store_true", help="operator reviews every draft before it's sent")
    args = parser.parse_args(argv)

    cities = load_cities(DATA / "cities")
    known_ids = {v.id for c in cities for v in c.venues}
    profile = load_profile(DATA / "users", args.user)
    convo = Conversation(build_system_prompt(cities), profile)

    print("The Host. Text anything. Ctrl-D to leave.")
    operator_note = ""
    while True:
        try:
            text = input("\nyou > ").strip()
        except EOFError:
            print()
            return 0
        if not text:
            continue
        while True:
            try:
                reply = convo.send(text, operator_note)
            except HostRefused as e:
                print(f"(declined: {e})", file=sys.stderr)
                break
            operator_note = ""
            draft = reply.to_sms()
            problems = reply.problems(known_ids)
            verdict, sent = review(draft, problems) if args.review else ("sent", draft)
            log({"user": args.user, "in": text, "draft": draft, "problems": problems,
                 "verdict": verdict, "sent": sent, "venue_ids": reply.venue_ids})
            if verdict == "redo":
                text, operator_note = "(operator) Try again: that draft wasn't good enough.", ""
                continue
            if verdict == "edited":
                operator_note = f"A human edited your last reply. The user actually received: {sent!r}"
            print(f"\nhost > {sent}")
            if reply.learned:
                profile.remember(reply.learned)
                save_profile(DATA / "users", profile)
            break


if __name__ == "__main__":
    sys.exit(main())
