"""P1a ingestion spike, step 2: component ownership -> provisional note mask + left-to-right time-of-ink.
Throwaway spike (claude-direct), replaced by the Kiro `ingest-pipeline` spec (src/ingest/) in P1b.
Note: "till it Looks / red & smooth," = line 8 from the gap before "till" + line 9 up to the gap before "keeping"
(line indices from lines.py on recipe No. 26). Word boundaries are column gaps of OWNED ink, chosen nearest to
the eye-located x below; the crop itself is computed from ownership, never from an eye-read box.
Usage: python3 -I spike.py <p0033.jpg> <outdir>
"""
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from lines import REGION, ink_mask, line_cores

NOTE = {'id': 'looks-red-smooth', 'text': 'till it Looks red & smooth',
        'segments': [{'line': 8, 'from_x': 790, 'to_x': None}, {'line': 9, 'from_x': None, 'to_x': 515}]}
P3_SPLIT_THRESHOLD = 0.02  # frozen in specs (P3): share of a note's ink that may come from split components
FEATHER = 32  # px of transparent margin around the note (renderer feathers >= 24 px past the hull)


def own(ink, cores, valleys):
    lab, n = ndi.label(ink, structure=np.ones((3, 3)))
    owner = np.full(lab.shape, -1, int)
    splits = []
    objs = ndi.find_objects(lab)
    for c in range(1, n + 1):
        sl = objs[c - 1]; m = lab[sl] == c
        ys = np.nonzero(m)[0] + sl[0].start
        hits = [int(((ys >= a) & (ys <= b)).sum()) for a, b, _ in cores]
        touching = [i for i, h in enumerate(hits) if h > 0]
        if len(touching) >= 2:  # overlaps two core bands -> split at the valley row(s), logged
            for i in touching:
                top = valleys[i - 1] if i > 0 else 0
                bot = valleys[i] if i < len(valleys) else lab.shape[0]
                part = m & (np.arange(sl[0].start, sl[0].stop)[:, None] >= top) & (np.arange(sl[0].start, sl[0].stop)[:, None] < bot)
                owner[sl][part] = i
                splits.append({'component': c, 'line': i, 'pixels': int(part.sum())})
        else:
            # no core band touched: nearest band by bbox-to-band distance; i-dots and capital flourishes hang ABOVE their own line, so distance upward to a band below is discounted (x0.6)
            i = touching[0] if touching else int(np.argmin([(0.6 * (a - ys.max()) if ys.max() < a else max(ys.min() - b, 0)) for a, b, _ in cores]))
            owner[sl][m] = i
    return owner, lab, splits


def gaps(cols, min_gap=8):
    xs = np.nonzero(cols)[0]
    out = []
    for a, b in zip(xs[:-1], xs[1:]):
        if b - a > min_gap: out.append((int(a), int(b), int((a + b) // 2)))
    return xs, out


if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    x0, y0, x1, y1 = REGION
    rgb = np.asarray(Image.open(src).convert('RGB'))[y0:y1, x0:x1].astype(float)
    gray = rgb.mean(2)
    ink = ink_mask(gray)
    cores, valleys, _ = line_cores(ink)
    owner, lab, splits = own(ink, cores, valleys)

    note = np.zeros(ink.shape, bool); seg_meta = []; t_bounds = []; seg_masks = []
    for s in NOTE['segments']:
        li = s['line']; owned = owner == li
        xs, gp = gaps(owned.any(0))
        def cut(x):  # snap to a column gap within 20 px; slanted joined words have none, so the centroid rule decides
            g = min(gp, key=lambda g: abs(g[2] - x)) if gp else None
            return g[2] if g and abs(g[2] - x) <= 20 else x
        lo = xs.min() if s['from_x'] is None else cut(s['from_x'])
        hi = xs.max() + 1 if s['to_x'] is None else cut(s['to_x'])
        # whole components: a component belongs to the segment if its owned centroid x lies in [lo, hi)
        seg = np.zeros_like(note)
        for c in np.unique(lab[owned]):
            m = owned & (lab == c)
            if np.nonzero(m)[1].max() >= ink.shape[1] - 20: continue  # page-edge shadow, not ink
            if lo <= np.nonzero(m)[1].mean() < hi: seg |= m
        note |= seg
        seg_masks.append(seg)
        yy, xx = np.nonzero(seg)
        seg_meta.append({'line': li, 'x': [int(xx.min()), int(xx.max()) + 1], 'y': [int(yy.min()), int(yy.max()) + 1],
                         'core': [cores[li][0], cores[li][1]], 'gapLo': int(lo), 'gapHi': int(hi), 'inkPx': int(seg.sum())})

    note_split_comp = {sp['component'] for sp in splits} & set(np.unique(lab[note]).tolist())
    split_share = float(sum(((lab == c) & note).sum() for c in note_split_comp)) / float(note.sum())

    # alternative rule (measured only, not applied): split a two-band component only when its smaller core-band
    # overlap is >= 25% of its larger one; otherwise it stays whole on the majority line
    def minority_ratio(c):
        ys = np.nonzero(lab == c)[0]
        h = sorted((int(((ys >= a) & (ys <= b)).sum()) for a, b, _ in cores), reverse=True)
        return h[1] / max(h[0], 1)
    alt = [c for c in note_split_comp if minority_ratio(c) >= 0.25]
    split_share_alt = float(sum(((lab == c) & note).sum() for c in alt)) / float(note.sum())
    split_detail = [{'component': int(c), 'notePx': int(((lab == c) & note).sum()), 'minorityRatio': round(minority_ratio(c), 3)} for c in sorted(note_split_comp)]

    # bbox in region coords + feather
    yy, xx = np.nonzero(note)
    bx0, by0 = max(0, xx.min() - FEATHER), max(0, yy.min() - FEATHER)
    bx1, by1 = min(ink.shape[1], xx.max() + 1 + FEATHER), min(ink.shape[0], yy.max() + 1 + FEATHER)
    sub = (slice(by0, by1), slice(bx0, bx1))

    # soft ink alpha from darkness, restricted to the owned note mask (dilated 1 px for antialiased edges)
    paper = ndi.median_filter(gray, 31)
    dark = np.clip((paper - gray) / 90.0, 0, 1)
    allowed = ndi.binary_dilation(note, iterations=1)
    alpha = np.where(allowed, dark, 0)[sub]

    # time of ink: segment order, left->right along a slant-corrected x, word gaps add a pen-lift pause
    H, W = alpha.shape
    Y, X = np.mgrid[0:H, 0:W]
    toi = np.ones((H, W))
    total_w = sum(m['x'][1] - m['x'][0] for m in seg_meta); t0 = 0.0
    for m, sm in zip(seg_meta, seg_masks):
        li = m['line']; segmask = ndi.binary_dilation(sm, iterations=1)[sub] & allowed[sub]  # this segment's own ink (+1 px), never another line's
        mid = (m['core'][0] + m['core'][1]) / 2 - by0
        xs_ = X + 0.35 * (mid - Y) - (m['x'][0] - bx0)  # writing slants right as it rises
        span = (m['x'][1] - m['x'][0]) / total_w
        tt = t0 + np.clip(xs_ / (m['x'][1] - m['x'][0]), 0, 1) * span
        toi[segmask] = tt[segmask]
        t_bounds.append([round(t0, 4), round(t0 + span, 4)]); t0 += span
    pressure = ndi.gaussian_filter(alpha, 2.0); pressure = pressure / max(pressure.max(), 1e-6)

    a8 = (alpha * 255).round().astype(np.uint8)
    rgba = np.dstack([rgb[sub].round().astype(np.uint8), a8])
    Image.fromarray(rgba, 'RGBA').save(f'{out}/note-{NOTE["id"]}.png', optimize=True)
    toi_img = np.dstack([a8, (np.clip(toi, 0, 1) * 255).round().astype(np.uint8), (pressure * 255).round().astype(np.uint8)])
    Image.fromarray(toi_img, 'RGB').save(f'{out}/note-{NOTE["id"]}.toi.png', optimize=True)

    meta = {'noteId': NOTE['id'], 'text': NOTE['text'], 'source': 'Wellcome Collection MS.1810, p.23 (p0033.jpg), Public Domain Mark',
            'provisional': 'P1a spike (claude-direct); replaced by the Kiro-built src/ingest pipeline in P1b',
            'pageBox': [int(x0 + bx0), int(y0 + by0), int(x0 + bx1), int(y0 + by1)], 'size': [W, H],
            'groups': [{'line': m['line'], 'rect': [m['x'][0] - bx0, m['y'][0] - by0, m['x'][1] - bx0, m['y'][1] - by0],
                        'coreBand': [m['core'][0] - by0, m['core'][1] - by0], 't': tb, 'inkPx': m['inkPx']}
                       for m, tb in zip(seg_meta, t_bounds)],
            'lineCount': len(cores), 'splitComponentsInNote': len(note_split_comp),
            'splitShare': round(split_share, 4), 'p3Threshold': P3_SPLIT_THRESHOLD,
            'p3': 'pass' if split_share <= P3_SPLIT_THRESHOLD else 'fail',
            'splitsAllLines': len(splits), 'splitDetail': split_detail,
            'splitShareMajorityRule25': round(split_share_alt, 4)}
    json.dump(meta, open(f'{out}/note-{NOTE["id"]}.json', 'w'), indent=1, default=int)
    print(json.dumps(meta, indent=1, default=int))
    # QA overlay: owned note ink in red over the region, other lines' ink grey
    ov = (rgb * 0.5 + 127).astype(np.uint8); ov[note] = [200, 30, 30]
    Image.fromarray(ov[max(0, by0 - 80):by1 + 40]).save(f'{out}/overlay.png')
