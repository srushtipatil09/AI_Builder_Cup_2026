"""Load a labeled synthetic history into the demo household through the API.

Usage: python scripts/seed_demo.py [--api URL] [--scenario stable|changing|fasting|family|story]
"""

import argparse
import json
import urllib.request


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://127.0.0.1:8080")
    parser.add_argument("--scenario", default="family")
    args = parser.parse_args()
    body = json.dumps({"household": "demo-kamla-sharma", "scenario": args.scenario}).encode()
    req = urllib.request.Request(
        f"{args.api.rstrip('/')}/api/v1/demo/seed", data=body, method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=180) as res:
        print(res.status, res.read().decode()[:600])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
