#!/usr/bin/env python3
"""Is the objc header blind spot a one-off, or a class?

The objc lane's `LANGS.objc.ext` is "m", while the PRODUCT's router
(`src/ast/language-detection.ts` EXTENSION_LANGUAGE + the `.h` content sniff)
hands the objective-c analyzer `m`, `mm`, and every `.h` carrying
@interface/@protocol/@implementation. The lane therefore grades a subset of what
production feeds it.

This compares the two registries directly — the router's map, and the F5 sweep's
per-language `ext` in script/m14/differential.ts — and then counts, over the
pinned corpus root, how many real files carry an extension the router routes to a
language but that language's lane never samples. Those files are in nobody's
measured universe.

Run: python3 script/m14/tmp/oc-sampling-universe-audit.py
"""
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
CORPUS = "<corpus-root>/bb_tests/repositories"

# LANGS keys -> the router's DetectedLanguage spelling.
ALIAS = {
    "objc": "objective-c",
    "makefile": "make",
    "make": "make",
    "typescript": "typescript",
    "javascript": "javascript",
    "clean": "clean",
}

# The router gives `.h` to c/cpp/objective-c by CONTENT, not by the table. The
# table's `h: "c"` is only the pre-sniff default, so `.h` is treated separately.
SNIFFED = {"h"}


def read(path):
    with open(os.path.join(REPO, path), encoding="utf8") as f:
        return f.read()


def router_map():
    src = read("src/ast/language-detection.ts")
    block = src.split("const EXTENSION_LANGUAGE", 1)[1].split("const BASENAME_LANGUAGE", 1)[0]
    out = {}
    for m in re.finditer(r'(?:"([^"]+)"|([A-Za-z][\w]*))\s*:\s*"([a-z\-]+)"', block):
        ext = m.group(1) or m.group(2)
        out[ext.lower()] = m.group(3)
    return out


def lane_map():
    src = read("script/m14/differential.ts")
    out = {}
    for m in re.finditer(r'^\s*([a-z0-9_]+):\s*\{[^}]*?ext:\s*"([^"]*)"', src, re.M):
        out[m.group(1)] = [e.strip() for e in m.group(2).split(",") if e.strip()]
    return out


def main():
    router = router_map()
    lanes = lane_map()
    if not router or not lanes:
        print("FATAL: could not parse one of the two registries")
        sys.exit(1)

    by_lang = {}
    for ext, lang in router.items():
        by_lang.setdefault(lang, set()).add(ext)

    print(f"router: {len(router)} extensions -> {len(by_lang)} languages   |   lanes with ext: {len(lanes)}")
    print()
    missing_total = {}
    rows = []
    for lane, exts in sorted(lanes.items()):
        lang = ALIAS.get(lane, lane)
        offered = by_lang.get(lang, set())
        if not offered:
            rows.append((lane, exts, None, set()))
            continue
        covered = set(exts) & offered
        gap = offered - set(exts)
        # `.h` is content-sniffed; a lane that cannot receive it by name is not
        # necessarily blind, so it is reported but not counted as a plain gap.
        gap_plain = gap - SNIFFED
        rows.append((lane, exts, sorted(covered), sorted(gap_plain)))
        for e in gap_plain:
            missing_total.setdefault(e, []).append(lane)

    print(f"{'lane':<12} {'lane ext':<26} {'router ext NOT sampled':<30}")
    for lane, exts, covered, gap in rows:
        if covered is None:
            print(f"{lane:<12} {','.join(exts):<26} (no router entry under this spelling)")
            continue
        flag = "  <-- GAP" if gap else ""
        print(f"{lane:<12} {','.join(exts):<26} {','.join(gap) if gap else '-':<30}{flag}")

    if not missing_total:
        print("\nno extension-level gaps")
        return

    print("\n=== files sitting in the gap, over the pinned corpus root ===")
    counts = {}
    for dp, dn, fn in os.walk(CORPUS):
        dn[:] = [d for d in dn if d != ".git"]
        for f in fn:
            e = os.path.splitext(f)[1].lstrip(".").lower()
            if e in missing_total:
                counts[e] = counts.get(e, 0) + 1
    for e in sorted(counts, key=lambda k: -counts[k]):
        print(f"  .{e:<8} {counts[e]:>6} files   routed to {router[e]:<12} but not in {','.join(missing_total[e])}'s universe")
    print(f"\n  total files in the gap: {sum(counts.values())}")


if __name__ == "__main__":
    main()
