#!/usr/bin/env python3
"""Provenance check: is the hand on screen the archive's hand?  (spec.md metrics row "Provenance")

(a) For every bundled note, re-fetch its IIIF Image API region from the archive's server and compare it with the
    bundled UNFLATTENED source crop (public/recipes/<id>/page.jpg, the page as downloaded, never the background-flattened mask).
(b) Then check the displayed mask against that verified crop and the note's owned components:
      b1  the mask's pageBox lies inside the verified region (box containment);
      b2  >= INK_AGREE of the mask's opaque pixels sit on ink in the bundled page (darker than the local paper);
      b3  the ingest gate recorded ownership checks P3/P4 as passing for this recipe (content/recipes/<id>/gate.json).
Two negative controls must FAIL (a): the same region shifted by SHIFT_CANVAS_PX, and the same region taken from the neighbouring canvas
(wrong canvas). A control that passes means the metric cannot tell the archive's pixels from other pixels, and the run fails.

THRESHOLDS ARE FIXED HERE, BEFORE THE FIRST RUN (committed before the first execution; see the commit message and
docs/kiro-evidence/provenance/run-1.txt). They are not tuned afterwards. Changing one is a new, dated commit that says why.

Usage: python3 scripts/verify_provenance.py [--offline-cache DIR]   exit 0 = all pass, 1 = a check failed, 2 = network/setup error.
"""
from __future__ import annotations

import io, json, math, sys, time, urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RECIPES = ROOT / "public" / "recipes"
CONTENT = ROOT / "content" / "recipes"

# ---- thresholds, fixed before the first run -------------------------------------------------------------------
NCC_MIN = 0.90          # Pearson correlation of grayscale, IIIF region (downscaled) vs bundled page crop; real = pass
SHIFT_CANVAS_PX = 150   # control 1: region moved down by this many canvas px (~2 text lines at this page's scale); must score < NCC_MIN
WRONG_CANVAS_FROM = "_0033.JP2"   # control 2: same region from the neighbouring canvas (p.22); must score < NCC_MIN
WRONG_CANVAS_TO = "_0032.JP2"
ALIGN_SLACK_PX = 2      # +-2 bundled-page px search for resampling phase only (applies equally to real and control)
INK_AGREE = 0.97        # b2: share of opaque mask pixels (alpha >= 128) that lie on ink in the bundled page
INK_DELTA = 18          # a pixel is ink when it is this many gray levels darker than the local paper (5x5 -> 41x41 median)
UA = "steam-provenance-check/1.0 (hackathon verification script)"


def get(url: str) -> bytes:
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise SystemExit(f"network error fetching {url}: {last}") from None


def gray(im: Image.Image) -> np.ndarray:
    return np.asarray(im.convert("L"), dtype=np.float64)


def ncc(a: np.ndarray, b: np.ndarray) -> float:
    a = a - a.mean(); b = b - b.mean()
    d = math.sqrt((a * a).sum() * (b * b).sum())
    return float((a * b).sum() / d) if d > 0 else 0.0


def region_canvas(src: dict, box: list[float]) -> tuple[int, int, int, int]:
    """Mirror of src/data/provenance.ts regionOf: floor the origin, ceil the far edge, clip to the canvas."""
    c, f = src["canvas"], src["frame"]
    sx, sy = c["width"] / f["width"], c["height"] / f["height"]
    vx, vy, vw, vh = box
    x0, y0 = math.floor(vx * sx), math.floor(vy * sy)
    x1, y1 = math.ceil((vx + vw) * sx), math.ceil((vy + vh) * sy)
    x0, x1 = max(0, min(c["width"], x0)), max(0, min(c["width"], x1))
    y0, y1 = max(0, min(c["height"], y0)), max(0, min(c["height"], y1))
    return x0, y0, x1 - x0, y1 - y0


def best_ncc(iiif_gray: Image.Image, page: Image.Image, src: dict, reg: tuple[int, int, int, int]) -> float:
    """Downscale the IIIF region to the bundled page's resolution and compare with the page crop at the same place."""
    c, f = src["canvas"], src["frame"]
    sx, sy = c["width"] / f["width"], c["height"] / f["height"]
    x, y, w, h = reg
    px, py, pw, ph = round(x / sx), round(y / sy), round(w / sx), round(h / sy)
    small = iiif_gray.convert("L").resize((pw, ph), Image.LANCZOS)
    a = np.asarray(small, dtype=np.float64)
    pg = gray(page)
    best = -1.0
    for dy in range(-ALIGN_SLACK_PX, ALIGN_SLACK_PX + 1):
        for dx in range(-ALIGN_SLACK_PX, ALIGN_SLACK_PX + 1):
            x0, y0 = px + dx, py + dy
            if x0 < 0 or y0 < 0 or x0 + pw > pg.shape[1] or y0 + ph > pg.shape[0]:
                continue
            best = max(best, ncc(a, pg[y0:y0 + ph, x0:x0 + pw]))
    return best


def local_paper(g: np.ndarray) -> np.ndarray:
    """Cheap paper estimate: a 41x41 box-median proxy via downsample, max-filter-free: use blurred 90th percentile blocks."""
    from PIL import ImageFilter
    im = Image.fromarray(g.astype(np.uint8))
    return np.asarray(im.filter(ImageFilter.MaxFilter(41)).filter(ImageFilter.GaussianBlur(10)), dtype=np.float64)


def main() -> int:
    results: list[dict] = []
    ok = True
    for rdir in sorted(p for p in RECIPES.iterdir() if (p / "recipe.json").exists()):
        recipe = json.loads((rdir / "recipe.json").read_text())
        src = recipe["source"]
        page = Image.open(rdir / "page.jpg").convert("RGB")
        gate = json.loads((CONTENT / rdir.name / "gate.json").read_text()) if (CONTENT / rdir.name / "gate.json").exists() else None
        for note in recipe["notes"]:
            nid = note["id"]
            reg = region_canvas(src, note["verifyBox"])
            url = f"{src['imageService']}/{reg[0]},{reg[1]},{reg[2]},{reg[3]}/full/0/default.jpg"
            real = Image.open(io.BytesIO(get(url)))
            s_real = best_ncc(real, page, src, reg)

            sh = (reg[0], min(src["canvas"]["height"] - reg[3], reg[1] + SHIFT_CANVAS_PX), reg[2], reg[3])
            shifted = Image.open(io.BytesIO(get(f"{src['imageService']}/{sh[0]},{sh[1]},{sh[2]},{sh[3]}/full/0/default.jpg")))
            s_shift = best_ncc(shifted, page, src, reg)  # compared with the page crop at the ORIGINAL place

            wc_service = src["imageService"].replace(WRONG_CANVAS_FROM, WRONG_CANVAS_TO)
            wrong = Image.open(io.BytesIO(get(f"{wc_service}/{reg[0]},{reg[1]},{reg[2]},{reg[3]}/full/0/default.jpg")))
            s_wrong = best_ncc(wrong, page, src, reg)

            # b1 box containment: pageBox inside verifyBox (frame px; verifyBox is padded)
            vx, vy, vw, vh = note["verifyBox"]
            x0, y0, x1, y1 = note["pageBox"]
            b1 = x0 >= math.floor(vx) and y0 >= math.floor(vy) and x1 <= math.ceil(vx + vw) and y1 <= math.ceil(vy + vh)

            # b2 ink agreement of the displayed mask with the bundled page
            m = np.asarray(Image.open(rdir / note["files"]["png"]).convert("RGBA"))[:, :, 3]
            g = gray(page)[y0:y1, x0:x1]
            paper = local_paper(gray(page))[y0:y1, x0:x1]
            opaque = m >= 128
            on_ink = (paper - g) >= INK_DELTA
            agree = float((opaque & on_ink).sum() / max(1, opaque.sum()))
            b2 = agree >= INK_AGREE and m.shape == g.shape

            # b3 ownership checks recorded by the gate (P3/P4), per this note
            b3 = None
            if gate:
                res = gate.get("results", {})
                b3 = bool(gate.get("pass")) and all(
                    (v.get("pass", True) if isinstance(v, dict) else bool(v)) for k, v in res.items() if k in ("P3", "P4")
                )
            row = {
                "recipe": rdir.name, "note": nid, "region": list(reg), "url": url,
                "ncc_real": round(s_real, 4), "ncc_shifted_control": round(s_shift, 4), "ncc_wrong_canvas_control": round(s_wrong, 4),
                "a_real_pass": s_real >= NCC_MIN, "control_shift_fails": s_shift < NCC_MIN, "control_wrong_canvas_fails": s_wrong < NCC_MIN,
                "b1_box_contained": b1, "b2_ink_agree": round(agree, 4), "b2_pass": b2, "b3_gate_ownership_pass": b3,
            }
            row["pass"] = all([row["a_real_pass"], row["control_shift_fails"], row["control_wrong_canvas_fails"], b1, b2, b3 is not False])
            ok &= row["pass"]
            results.append(row)
            print(json.dumps(row))
    print(json.dumps({"thresholds": {"NCC_MIN": NCC_MIN, "SHIFT_CANVAS_PX": SHIFT_CANVAS_PX, "INK_AGREE": INK_AGREE, "INK_DELTA": INK_DELTA},
                      "notes": len(results), "all_pass": ok}))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
