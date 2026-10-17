"""Run the labeled extraction cases in eval/cases against Gemini Flash and report pass counts per group.

Usage: python scripts/eval_extraction.py [--group negation]
Calls the real model through the same extract_session the worker uses. About one Flash call per case.
Writes eval/report.json. A failing case is printed with what the model returned; nothing is retried.
"""

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api" / "src"))

from saathi.memory.extract import extract_session  # noqa: E402

NEGATED = ("nahi", "not", "no ", "didn", "unknown")


def check(expect: dict, r) -> list[str]:
    problems = []
    names = [e.person_name.lower() for e in r.family_episodes]
    for key, want in expect.items():
        if key == "no_discomfort" and r.discomfort:
            problems.append(f"discomfort recorded: {[d.area for d in r.discomfort]}")
        elif key == "discomfort" and not r.discomfort:
            problems.append("no discomfort recorded")
        elif key == "fasting" and r.fasting_stated != want:
            problems.append(f"fasting_stated={r.fasting_stated}")
        elif key == "illness" and r.illness_stated != want:
            problems.append(f"illness_stated={r.illness_stated}")
        elif key == "mood_null" and r.mood_stated:
            problems.append(f"mood_stated={r.mood_stated!r}")
        elif key == "mood_set" and not r.mood_stated:
            problems.append("mood not recorded")
        elif key == "family_person" and want.lower() not in names:
            problems.append(f"no episode for {want}: {names}")
        elif key == "no_family_episode" and want.lower() in names:
            problems.append(f"episode stored for {want}")
        elif key == "no_family_episode_any" and names:
            problems.append(f"episodes stored: {names}")
        elif key == "not_contact_today":
            for e in r.family_episodes:
                said = f"{e.reported_last_contact} {e.what_was_said}".lower()
                if e.reported_last_contact not in ("", "unknown") and not any(n in said for n in NEGATED):
                    problems.append(f"negated call may be stored as contact: {e.reported_last_contact!r}")
        elif key == "meal_not_eaten" and any(m.reported_eaten for m in r.meals):
            problems.append("skipped meal stored as eaten")
        elif key == "meal_eaten" and not any(m.reported_eaten for m in r.meals):
            problems.append("eaten meal not recorded")
        elif key == "correction" and not r.memory_corrections:
            problems.append("no memory correction")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--group", default="")
    args = parser.parse_args()
    lines = (ROOT / "eval" / "cases" / "extraction.jsonl").read_text(encoding="utf-8").splitlines()
    cases = [json.loads(line) for line in lines if line.strip()]
    if args.group:
        cases = [c for c in cases if c["group"] == args.group]
    tally: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    failures = []
    for case in cases:
        result = extract_session(case["utterances"])
        problems = check(case["expect"], result)
        tally[case["group"]][1] += 1
        if problems:
            failures.append({"id": case["id"], "problems": problems})
            print(f"FAIL {case['id']}: {'; '.join(problems)}")
        else:
            tally[case["group"]][0] += 1
            print(f"ok   {case['id']}")
    passed = sum(p for p, _ in tally.values())
    report = {
        "passed": passed,
        "total": len(cases),
        "groups": {g: {"passed": p, "total": t} for g, (p, t) in sorted(tally.items())},
        "failures": failures,
    }
    (ROOT / "eval" / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\n{passed}/{len(cases)} passed")
    for g, (p, t) in sorted(tally.items()):
        print(f"  {g:14} {p}/{t}")
    return 0 if passed == len(cases) else 1


if __name__ == "__main__":
    raise SystemExit(main())
