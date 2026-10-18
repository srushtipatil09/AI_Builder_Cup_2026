"""Check the deployed services from outside: public site and API, private worker, optional authorized tick.

Usage:
  python scripts/smoke_cloud.py
  python scripts/smoke_cloud.py --invoke   # also calls /internal/tick with an ID token for the invoker account

--invoke needs permission to impersonate the invoker service account (roles/iam.serviceAccountTokenCreator).
"""

import argparse
import json
import shutil
import subprocess
import urllib.error
import urllib.request

SITE = "https://saathi-511717.web.app"
API = "https://saathi-api-ikr6m7lina-uc.a.run.app"
WORKER = "https://saathi-worker-ikr6m7lina-uc.a.run.app"
INVOKER = "backend-dev@saathi-511717.iam.gserviceaccount.com"


def call(url: str, method: str = "GET", token: str = "", body: bytes | None = None, origin: str = ""):
    req = urllib.request.Request(url, method=method, data=body)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if origin:
        req.add_header("Origin", origin)
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return res.status, res.read().decode("utf-8", "replace"), {k.lower(): v for k, v in res.headers.items()}
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode("utf-8", "replace"), {k.lower(): v for k, v in err.headers.items()}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--invoke", action="store_true")
    args = parser.parse_args()
    results: list[bool] = []

    def expect(name: str, ok: bool, detail: str) -> None:
        results.append(ok)
        print(f"{'ok  ' if ok else 'FAIL'} {name}: {detail}")

    status, body, _ = call(f"{SITE}/")
    expect("site", status == 200 and "<html" in body.lower(), str(status))
    _, _, headers = call(f"{SITE}/manifest.webmanifest")
    expect("manifest type", "manifest+json" in headers.get("content-type", ""), headers.get("content-type", ""))
    status, body, headers = call(f"{API}/health", origin=SITE)
    expect("api health", status == 200 and json.loads(body).get("status") == "ok", body[:120])
    expect("api cors for site", headers.get("access-control-allow-origin") == SITE, headers.get("access-control-allow-origin", "none"))
    _, _, headers = call(f"{API}/health", origin="https://example.com")
    expect("api cors refuses others", "access-control-allow-origin" not in headers, headers.get("access-control-allow-origin", "none"))
    status, _, _ = call(f"{API}/api/v1/demo/status")
    expect("demo status", status == 200, str(status))
    status, _, _ = call(f"{WORKER}/health")
    expect("worker private", status in (401, 403), str(status))
    status, _, _ = call(f"{WORKER}/internal/tick", "POST", body=b"{}")
    expect("worker rejects anonymous tick", status in (401, 403), str(status))

    if args.invoke:
        gcloud = shutil.which("gcloud") or shutil.which("gcloud.cmd") or "gcloud"
        token = subprocess.run(
            [gcloud, "auth", "print-identity-token", f"--impersonate-service-account={INVOKER}", f"--audiences={WORKER}", "--include-email"],
            capture_output=True, text=True,
        ).stdout.strip()
        status, body, _ = call(f"{WORKER}/internal/tick", "POST", token=token, body=b"{}")
        expect("worker accepts invoker tick", status == 200, f"{status} {body[:160]}")

    print(f"\n{sum(results)}/{len(results)} checks passed")
    return 0 if all(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
