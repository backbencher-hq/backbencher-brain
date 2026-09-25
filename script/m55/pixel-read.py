#!/usr/bin/env python3
"""script/m55/pixel-read.py — the pixel reader M55.V1's frame gate reads
through (promoted from the filing rig's crop.py/click_action.py).

Why a separate tool: the gate's frame claims are PIXEL claims ("the card
rendered", "the panel shows rows", "the editor column survived"), and PIL is
the pragmatic pixel tool on this machine. The gate preflights it and records a
declared blocked state when it is absent — never a silent pass.

Subcommands (all print one JSON object):

  stats SRC X Y W H
      mean brightness, the fraction of "text" pixels (dark-on-light or
      light-on-dark strokes), and the number of distinct text ROWS in the
      region — the "does this region show content" read.

  diff A B X Y W H
      changed-pixel count and the bounding box of the change — the "did the
      UI change when we asked it to" read.

  uniform SRC X Y W H
      whether the region is a single colour (an unstyled/blank render).

  rows SRC X Y W H
      the y-intervals (region-relative) of the text ROWS in the region, with the
      x of each row's first stroke. The M55.V1 click leg reads this to FIND the
      row it clicks: a captured tree row moves between runs (the tab strip and
      tree layout shift by a few dozen pixels), so frozen coordinates click the
      wrong row — found ones do not.

Exit codes: 0 read, 2 unreadable input (the caller records blocked).
"""
import json
import sys

try:
    from PIL import Image
except Exception:  # pragma: no cover - the caller preflights this
    print(json.dumps({"ok": False, "reason": "PIL (python3-pil) is not available"}))
    sys.exit(2)


def load(path):
    return Image.open(path).convert("RGB")


def is_text_pixel(r, g, b, bg):
    # A stroke: close to black on a light background, or close to white on a
    # dark one. Both themes are accepted; the threshold is what the filing rig
    # used and it separates strokes from panel backgrounds reliably.
    if bg >= 128:
        return r < 110 and g < 110 and b < 110
    return r > 160 and g > 160 and b > 160


def stats(src, x, y, w, h):
    im = load(src).crop((x, y, x + w, y + h))
    px = im.load()
    total = im.width * im.height
    if total == 0:
        return {"ok": False, "reason": "empty region"}
    # The background is the most common colour sample (a coarse histogram on a
    # 4x4 grid is enough and keeps the read fast on a 1920x1080 frame).
    counts = {}
    for j in range(0, im.height, 4):
        for i in range(0, im.width, 4):
            counts[px[i, j]] = counts.get(px[i, j], 0) + 1
    bg_rgb = max(counts.items(), key=lambda kv: kv[1])[0]
    bg = max(bg_rgb)
    text = 0
    rows = set()
    for j in range(im.height):
        row_hit = False
        for i in range(im.width):
            if is_text_pixel(*px[i, j], bg):
                text += 1
                row_hit = True
        if row_hit:
            rows.add(j)
    # Distinct text rows: consecutive hits merge into one row.
    ordered = sorted(rows)
    groups = 0
    prev = None
    for j in ordered:
        if prev is None or j - prev > 2:
            groups += 1
        prev = j
    return {
        "ok": True,
        "width": im.width,
        "height": im.height,
        "background": list(bg_rgb),
        "textPixels": text,
        "textFraction": round(text / total, 4),
        "textRows": groups,
    }


def rows(src, x, y, w, h):
    """Text rows in a region: consecutive stroke rows merge into one band."""
    im = load(src).crop((x, y, x + w, y + h))
    px = im.load()
    counts = {}
    for j in range(0, im.height, 4):
        for i in range(0, im.width, 4):
            counts[px[i, j]] = counts.get(px[i, j], 0) + 1
    bg = max(max(counts.items(), key=lambda kv: kv[1])[0])
    bands = []
    current = None
    for j in range(im.height):
        first_x = None
        for i in range(im.width):
            if is_text_pixel(*px[i, j], bg):
                first_x = i
                break
        if first_x is None:
            if current is not None:
                bands.append(current)
                current = None
            continue
        if current is None:
            current = {"y0": j, "y1": j, "x0": first_x}
        else:
            current["y1"] = j
            current["x0"] = min(current["x0"], first_x)
    if current is not None:
        bands.append(current)
    # Merge bands separated by a single pixel row (anti-aliasing gaps).
    merged = []
    for b in bands:
        if merged and b["y0"] - merged[-1]["y1"] <= 2:
            merged[-1]["y1"] = b["y1"]
            merged[-1]["x0"] = min(merged[-1]["x0"], b["x0"])
        else:
            merged.append(b)
    return {"ok": True, "count": len(merged), "rows": merged}


def diff(a, b, x, y, w, h, threshold=12):
    ia, ib = load(a).crop((x, y, x + w, y + h)), load(b).crop((x, y, x + w, y + h))
    if ia.size != ib.size:
        return {"ok": False, "reason": f"size mismatch {ia.size} vs {ib.size}"}
    pa, pb = ia.load(), ib.load()
    changed = 0
    minx = miny = 10**9
    maxx = maxy = -1
    for j in range(ia.height):
        for i in range(ia.width):
            r0, g0, b0 = pa[i, j]
            r1, g1, b1 = pb[i, j]
            if abs(r0 - r1) + abs(g0 - g1) + abs(b0 - b1) > threshold:
                changed += 1
                minx, miny = min(minx, i), min(miny, j)
                maxx, maxy = max(maxx, i), max(maxy, j)
    box = None if changed == 0 else [minx, miny, maxx - minx + 1, maxy - miny + 1]
    return {"ok": True, "changedPixels": changed, "changedFraction": round(changed / (ia.width * ia.height), 4), "box": box}


def uniform(src, x, y, w, h):
    im = load(src).crop((x, y, x + w, y + h))
    px = im.load()
    first = px[0, 0]
    for j in range(0, im.height, 3):
        for i in range(0, im.width, 3):
            if px[i, j] != first:
                return {"ok": True, "uniform": False, "sample": list(first)}
    return {"ok": True, "uniform": True, "sample": list(first)}


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "reason": "usage: pixel-read.py <stats|diff|uniform|rows> ..."}))
        sys.exit(2)
    cmd = sys.argv[1]
    try:
        if cmd == "stats":
            src, x, y, w, h = sys.argv[2], *(int(v) for v in sys.argv[3:7])
            out = stats(src, x, y, w, h)
        elif cmd == "diff":
            a, b, x, y, w, h = sys.argv[2], sys.argv[3], *(int(v) for v in sys.argv[4:8])
            out = diff(a, b, x, y, w, h)
        elif cmd == "uniform":
            src, x, y, w, h = sys.argv[2], *(int(v) for v in sys.argv[3:7])
            out = uniform(src, x, y, w, h)
        elif cmd == "rows":
            src, x, y, w, h = sys.argv[2], *(int(v) for v in sys.argv[3:7])
            out = rows(src, x, y, w, h)
        else:
            out = {"ok": False, "reason": f"unknown subcommand {cmd}"}
    except Exception as exc:  # unreadable frame: the caller declares it
        print(json.dumps({"ok": False, "reason": str(exc)}))
        sys.exit(2)
    print(json.dumps(out))
    sys.exit(0 if out.get("ok") else 2)


if __name__ == "__main__":
    main()
