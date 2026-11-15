#!/usr/bin/env python3
"""Classify the three node types the #743 grammar waves introduced.

The inventory gate reports them as "in NO bucket", which is a real hole in the
lane's ledger: nobody had decided whether the analyzer handles them. The bucket for
each was decided by probe, not by grep (script/m14/tmp/c743-buckets.ts and
c743-header-name.ts):

  macro_prefixed_type_specifier  HANDLED in both lanes — declarations written
      `MYAPI int probe_plain(void)`, `JNIEXPORT void JNICALL Java_probe_run(...)`
      and `FMT_EXPORT void run_loud(int)` all publish their function symbols; c has
      a named path reading it (macroTruncatedReturnType) and cpp's walkType
      consults it, and the fixture c/cgd31-37-regressions.c records the wave's
      effect (a recovered phantom became a real struct, ERROR 1 -> 0).
  macro_specifier  HANDLED in c (the analyzer names the alias to strip the
      decorating macro from the return type). INTERNAL_SILENT in cpp, where the
      analyzer reads the specifier and never the leaf.
  preproc_header_name  INTERNAL_SILENT in both — a header named ONLY inside
      `__has_include` was measured to produce NO include-dependency edge (the edge
      belongs to the `#include` directive itself, which is a separate node set), so
      the token is an argument the analyzer correctly emits nothing for.

Text-level insert, validating JSON before writing, so no other byte of either spec
moves.
"""
import json
import re
import sys

JOBS = [
    (
        "script/m14/spec/c-completeness.json",
        "handled_verified",
        ["macro_prefixed_type_specifier", "macro_specifier"],
    ),
    (
        "script/m14/spec/c-completeness.json",
        "internal_silent",
        ["preproc_header_name"],
    ),
    (
        "script/m14/spec/cpp-completeness.json",
        "handled_verified",
        ["macro_prefixed_type_specifier"],
    ),
    (
        "script/m14/spec/cpp-completeness.json",
        "internal_silent",
        ["macro_specifier", "preproc_header_name"],
    ),
]

for path, section, new_types in JOBS:
    text = open(path, encoding="utf-8").read()
    present = []
    for t in new_types:
        # already classified anywhere in the file?
        if re.search(r'"%s"' % re.escape(t), text):
            present.append(t)
    if present:
        print(f"{path} [{section}]: skipping {present} (already named in the file)")
        new_types = [t for t in new_types if t not in present]
        if not new_types:
            continue

    pat = re.compile(r'("%s": \{\n\s*"types": \[)(.*?)(\n\s*\])' % re.escape(section), re.S)
    hits = list(pat.finditer(text))
    if len(hits) != 1:
        print(f"{path} [{section}]: expected exactly one types array, found {len(hits)}", file=sys.stderr)
        sys.exit(1)
    m = hits[0]
    body = m.group(2)
    lines = body.split("\n")
    last = lines[-1]
    indent = last[: len(last) - len(last.lstrip())]
    added = "".join(",\n" + indent + '"%s"' % t for t in new_types)
    new_body = body + added
    new = text[: m.start(2)] + new_body + text[m.end(2) :]
    parsed = json.loads(new)
    got = parsed[section]["types"]
    for t in new_types:
        assert t in got, f"{t} did not land in {section}"
    open(path, "w", encoding="utf-8").write(new)
    print(f"{path} [{section}]: +{len(new_types)} ({', '.join(new_types)}) -> {len(got)} types")
