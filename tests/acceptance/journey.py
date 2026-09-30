"""Live API acceptance journey against a running MelaDx7 stack with a real trained model.

    python tests/acceptance/journey.py --base http://localhost:8000 --images data/processed/test

Needs real images (the prepared test split). Nothing is mocked: it registers a throw-away
account, uploads real lesion images, checks prediction / Grad-CAM / PDF, then deletes the
account and verifies the session and protected routes are dead. Exits non-zero on any failure.
"""
from __future__ import annotations

import argparse
import io
import json
import sys
import uuid
from pathlib import Path

import httpx

results: list[tuple[str, bool, str]] = []


def cookie_header(response: httpx.Response) -> str | None:
    """'name=value' of the refresh cookie from a Set-Cookie header.

    Production cookies are Secure, which HTTP clients refuse to send over plain http://localhost
    (browsers do send them on localhost). The journey therefore carries the cookie explicitly,
    which also lets it replay a revoked cookie on purpose.
    """
    raw = response.headers.get("set-cookie")
    return raw.split(";", 1)[0] if raw else None


def step(name: str, ok: bool, detail: str = "") -> bool:
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}{(' - ' + detail) if detail else ''}", flush=True)
    return ok


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8000")
    ap.add_argument("--images", type=Path, default=Path("data/processed/test"))
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()

    email = f"acceptance-{uuid.uuid4().hex[:8]}@example.org"
    password = "Acc3ptance-" + uuid.uuid4().hex[:12]
    c = httpx.Client(base_url=args.base, timeout=120, follow_redirects=False)

    r = c.get("/api/health")
    step("health: db, storage, model ready", r.status_code == 200 and r.json()["checks"]["model"] == "ready", r.text[:120])

    r = c.post("/api/auth/register", json={"email": email, "password": password, "full_name": "Acceptance Test"})
    step("register", r.status_code == 201, str(r.status_code))
    r = c.post("/api/auth/login", json={"email": email, "password": password})
    ok = r.status_code == 200 and "access_token" in r.json()
    step("login", ok, str(r.status_code))
    if not ok:
        return 1
    tok = r.json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    rc = cookie_header(r) or ""
    c.cookies.clear()  # only the explicit Cookie header below is used
    step("refresh cookie is httpOnly", "httponly" in r.headers.get("set-cookie", "").lower())
    step("me", c.get("/api/auth/me", headers=h).json().get("email") == email)

    info = c.get("/api/model/info", headers=h).json()
    step("model/info: trained ViT, not a placeholder", info.get("status") == "ready" and "vit" in json.dumps(info).lower(), str(info.get("status")))
    met = c.get("/api/model/metrics", headers=h)
    step("model/metrics served from the artifact", met.status_code == 200, str(met.status_code))

    # real images: a few per class from the held-out test split
    picks: list[tuple[str, Path]] = []
    for cls in ("mel", "nv", "bcc", "vasc"):
        picks += [(cls, f) for f in sorted((args.images / cls).glob("*.jpg"))[:2]]
    created = []
    for cls, f in picks:
        r = c.post("/api/analyses", headers=h, files={"file": (f.name, f.read_bytes(), "image/jpeg")})
        if r.status_code != 201:
            step(f"analyse {f.name} ({cls})", False, f"{r.status_code} {r.text[:150]}")
            continue
        created.append((cls, r.json()))
    step("upload + predict real images", len(created) == len(picks), f"{len(created)}/{len(picks)} created")
    if not created:
        return 1

    _, a0 = created[0]
    aid = a0["id"]
    blob = json.dumps(a0).lower()
    print("  analysis keys:", sorted(a0.keys()))
    step("uncertainty info present", any(k in blob for k in ("uncertain", "entropy", "margin")))
    step("model provenance stored (version + sha256)", "sha256" in blob and "version" in blob)

    g = c.get(f"/api/analyses/{aid}", headers=h)
    step("retrieve saved analysis", g.status_code == 200 and g.json()["id"] == aid)
    e = c.get(f"/api/analyses/{aid}/explanations/mel", headers=h)
    step("Grad-CAM for a chosen class", e.status_code == 200, "" if e.status_code == 200 else f"{e.status_code} {e.text[:120]}")
    hist = c.get("/api/analyses", headers=h)
    step("history lists analyses", hist.status_code == 200 and aid in hist.text)
    rep = c.get(f"/api/analyses/{aid}/report", headers=h, params={"tz": "UTC"})
    pdf_ok = rep.status_code == 200 and rep.content[:4] == b"%PDF"
    step("PDF report generated", pdf_ok, f"{len(rep.content)} bytes")
    step("PDF download filename is branded", "meladx7-report-" in rep.headers.get("content-disposition", ""))
    if pdf_ok:
        try:
            from pypdf import PdfReader

            text = " ".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(rep.content)).pages).lower()
            step("PDF is branded MelaDx7", "meladx7" in text)
            step("PDF states it is not a diagnosis", "not a medical diagnosis" in text or "not a diagnosis" in text)
            step("PDF records model version and weights hash", "sha-256" in text or "sha256" in text)
        except ImportError:
            step("PDF text checks", True, "skipped (pypdf not installed)")

    stat = c.get("/api/stats/overview", headers=h, params={"tz": "UTC"})
    step("dashboard stats", stat.status_code == 200)
    step("delete one analysis", c.delete(f"/api/analyses/{created[-1][1]['id']}", headers=h).status_code == 204)

    # session lifecycle
    rf = c.post("/api/auth/refresh", headers={"Cookie": rc})
    rotated = cookie_header(rf) or ""
    step("refresh rotates the session", rf.status_code == 200 and "access_token" in rf.json() and rotated != rc)
    step("logout", c.post("/api/auth/logout", headers={"Cookie": rotated}).status_code == 204)
    step("revoked refresh cookie is rejected after logout", c.post("/api/auth/refresh", headers={"Cookie": rotated}).status_code == 401)

    r = c.post("/api/auth/login", json={"email": email, "password": password})
    h3 = {"Authorization": f"Bearer {r.json()['access_token']}"}
    live_cookie = cookie_header(r) or ""
    c.cookies.clear()
    bad = c.request("DELETE", "/api/users/me", headers=h3, json={"password": "wrong-password-xyz"})
    step("account deletion needs the right password", bad.status_code in (400, 401, 403, 422), str(bad.status_code))
    d = c.request("DELETE", "/api/users/me", headers=h3, json={"password": password})
    step("delete account", d.status_code == 204, str(d.status_code))
    step("old access token dead after deletion", c.get("/api/auth/me", headers=h3).status_code == 401)
    step("login fails after deletion", c.post("/api/auth/login", json={"email": email, "password": password}).status_code in (400, 401))
    step("session cookie is dead after deletion", c.post("/api/auth/refresh", headers={"Cookie": live_cookie}).status_code == 401)
    for path in ("/api/analyses", "/api/model/info", "/api/stats/overview"):
        step(f"protected route {path} is 401 without a session", httpx.get(args.base + path).status_code == 401)
    step("deleted user's analysis is unreachable", c.get(f"/api/analyses/{aid}", headers=h3).status_code in (401, 404))

    failed = [n for n, ok, _ in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} steps passed")
    if args.out:
        args.out.write_text(json.dumps([{"step": n, "pass": ok, "detail": d} for n, ok, d in results], indent=2), encoding="utf-8")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
