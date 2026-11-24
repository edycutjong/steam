"""P1a ingestion spike, step 1: Sauvola threshold + row-projection line cores on recipe No. 26 of p0033.jpg.
Throwaway spike (claude-direct). The real pipeline is the Kiro `ingest-pipeline` spec in src/ingest/.
Usage: python3 -I lines.py <p0033.jpg> <outdir>
"""
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

REGION = (280, 1100, 1545, 1950)  # x0, y0, x1, y1 of recipe No. 26 (P0b MEASURE.md)


def sauvola(g, w=41, k=0.2, R=128.0):
    m = ndi.uniform_filter(g, w)
    s = np.sqrt(np.maximum(ndi.uniform_filter(g * g, w) - m * m, 0))
    return m * (1 + k * (s / R - 1))


def ink_mask(gray):
    t = sauvola(gray)
    med = np.median(gray)
    ink = (gray < t) & (gray < med - 25)
    lab, n = ndi.label(ink, structure=np.ones((3, 3)))
    sizes = ndi.sum(ink, lab, index=np.arange(1, n + 1))
    keep = np.zeros(n + 1, bool); keep[1:] = sizes >= 30
    return keep[lab]


def line_cores(ink, min_gap=40):
    prof = ndi.gaussian_filter1d(ink.sum(1).astype(float), 6)
    peaks = [y for y in range(1, len(prof) - 1) if prof[y] >= prof[y - 1] and prof[y] > prof[y + 1] and prof[y] > 0.25 * prof.max()]
    merged = []  # keep the higher peak when two are closer than min_gap
    for y in peaks:
        if merged and y - merged[-1] < min_gap:
            if prof[y] > prof[merged[-1]]: merged[-1] = y
        else:
            merged.append(y)
    cores = []
    for p in merged:
        thr = 0.6 * prof[p]; a = p; b = p
        while a > 0 and prof[a - 1] >= thr: a -= 1
        while b < len(prof) - 1 and prof[b + 1] >= thr: b += 1
        cores.append((a, b, p))
    valleys = [int(np.argmin(prof[cores[i][2]:cores[i + 1][2]]) + cores[i][2]) for i in range(len(cores) - 1)]
    return cores, valleys, prof


if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    x0, y0, x1, y1 = REGION
    rgb = np.asarray(Image.open(src).convert('RGB'))[y0:y1, x0:x1]
    gray = rgb.astype(float).mean(2)
    ink = ink_mask(gray)
    cores, valleys, _ = line_cores(ink)
    print(json.dumps({'lines': len(cores), 'cores': cores, 'valleys': valleys}))
    for i, (a, b, p) in enumerate(cores):
        top = valleys[i - 1] if i else max(0, a - 40); bot = valleys[i] if i < len(valleys) else min(len(gray), b + 40)
        Image.fromarray(rgb[top:bot]).save(f'{out}/line-{i:02d}.png')
