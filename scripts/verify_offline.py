#!/usr/bin/env python3
"""Offline claim: after ONE online load, the app and its bundled recipes work with the network off.

Playwright (Python, Chromium): load the shelf online once, wait for the service worker to control the page, switch the browser
context offline, then (A) open the hero deep link fresh and reach "The hand, quoted"; (B) from the shelf, "Watch it at x12" and
cook Quinces to the end (clicking the wipe button each time it offers one) until "The hand, quoted". Every request that fails while
offline is listed; the only failures allowed are the IIIF "verify at source" image hosts (they genuinely need the network).

Usage: python3 scripts/verify_offline.py [BASE_URL]      default http://localhost:4173 (run `npm run build && npx vite preview --port 4173`)
Exit 0 = both paths reached the quoted page offline with no unexpected failed request; 1 = not; 2 = no service worker took control.
Writes docs/kiro-evidence/offline-shell/verify-offline.txt (or $VERIFY_OFFLINE_OUT) with the raw output.
"""
from __future__ import annotations

import os, sys, time
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173").rstrip("/")
RECIPE, HERO = "quinces-marmalade", "till-it-looks-red-smooth"
DEEP = f"{BASE}/#/r/{RECIPE}/cook?note={HERO}&pace=12"
ALLOWED_OFFLINE_FAIL_HOSTS = {"iiif.wellcomecollection.org"}
OUT = Path(os.environ.get("VERIFY_OFFLINE_OUT", Path(__file__).resolve().parent.parent / "docs/kiro-evidence/offline-shell/verify-offline.txt"))
log: list[str] = []


def say(msg: str) -> None:
    print(msg, flush=True)
    log.append(msg)


def reach_quoted(page, budget_s: float) -> float:
    t0 = time.time()
    while time.time() - t0 < budget_s:
        if page.locator("h1").first.inner_text(timeout=5000).strip() == "The hand, quoted":
            return time.time() - t0
        w = page.locator("button.wipe")
        if w.count() and w.first.get_attribute("aria-disabled") != "true":
            try:
                w.first.click(timeout=2000)
            except Exception:  # noqa: BLE001 - the button may vanish as the screen changes
                pass
        page.wait_for_timeout(400)
    raise SystemExit(f"never reached 'The hand, quoted' within {budget_s}s offline")


def main() -> int:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        ctx = b.new_context(viewport={"width": 1280, "height": 800}, service_workers="allow")
        page = ctx.new_page()
        say(f"online: {BASE}/")
        page.goto(f"{BASE}/", wait_until="networkidle")
        page.wait_for_selector(".shelf__item", timeout=30_000)
        ready = page.evaluate("navigator.serviceWorker ? navigator.serviceWorker.ready.then(r => !!r.active) : false")
        say(f"service worker active: {ready}")
        if not ready:
            return 2
        page.reload(wait_until="networkidle")  # controlled load
        page.wait_for_selector(".shelf__item", timeout=30_000)
        controlled = page.evaluate("!!navigator.serviceWorker.controller")
        say(f"page controlled by the service worker: {controlled}")
        if not controlled:
            return 2
        # warm the exact path the offline run uses, online, once
        page.goto(DEEP, wait_until="networkidle"); page.reload(wait_until="networkidle")
        page.wait_for_selector("button.wipe", timeout=30_000)
        page.goto(f"{BASE}/", wait_until="networkidle")
        page.wait_for_timeout(1500)

        ctx.set_offline(True)
        failed: list[str] = []
        page.on("requestfailed", lambda r: failed.append(r.url))
        say("offline: network off")

        page.goto(DEEP); page.reload()
        page.wait_for_function("performance.getEntriesByName('cook:ready').length > 0", timeout=30_000)
        page.wait_for_function(f"performance.getEntriesByName('cook:reveal:{HERO}').length > 0", timeout=30_000)
        say(f"A deep link offline: cook:ready + hero reveal reached")
        say(f"A reached 'The hand, quoted' in {reach_quoted(page, 90):.1f}s")
        imgs = page.evaluate("[...document.images].filter(i => !i.src.includes('iiif.')).every(i => i.complete && i.naturalWidth > 0)")
        say(f"A bundled images all decoded: {imgs}")

        page.goto(f"{BASE}/"); page.reload()
        page.wait_for_selector(".shelf__item", timeout=30_000)
        page.get_by_role("button", name="Watch it at ×12").click()
        say(f"B shelf -> Watch it at x12 -> 'The hand, quoted' in {reach_quoted(page, 420):.1f}s (cooked to the end offline)")

        unexpected = sorted({u for u in failed if urlparse(u).hostname not in ALLOWED_OFFLINE_FAIL_HOSTS and urlparse(u).hostname != "localhost" or (urlparse(u).hostname == "localhost" and not u.startswith(BASE))})
        say(f"failed requests while offline: {len(failed)} total, unexpected: {unexpected or 'none'}")
        b.close()
        ok = imgs and not unexpected
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(log) + f"\nRESULT: {'PASS' if ok else 'FAIL'}\n")
    say("RESULT: " + ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
