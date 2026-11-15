#!/usr/bin/env python3
"""Strip authoring-process narration from campaign file comments (charter §9).

Only comment bodies are rewritten; code, string literals and evidence identifiers
are untouched. Full milestone tokens and issue numbers are removed first, then a
small set of process-narrative phrases is reworded, then leftover tag prefixes
(".H1: ", "M21.I3: ") are cleaned.
"""
import re, sys

MILESTONE = re.compile(r"\bM\d{1,3}(?:\.(?:[A-Z]\d+[a-z]?|\d+))+\b(?:\s*\(#\d+\))?\s*[:—-]?\s*|\bM\d{1,3}\b(?:\s*\(#\d+\))?\s*[:—-]?\s*")
ISSUE = re.compile(r"\((?:issue )?#\d+\)")
PHRASES = [
    ("This is the case the probe found — a forced wipe", "This is the case where a forced wipe"),
    ("the probe found the worse half of this defect:", "the worse half of this behaviour:"),
    ("The probe this came from, run against a 20-file fixture:", "Measured against a 20-file fixture:"),
    ("The probe found", "Measurement showed"),
    ("no gate in this lane noticed", "no gate noticed"),
    ("no gate in the suite would say so", "no gate would say so"),
    ("this lane has already fixed twice", "the report already had to fix"),
    ("the M52 latency work budgets", "the latency budget"),
    ("M52 DEFINES the tie order", "The tie order is defined here"),
    ("defect fixed", "fixed"),
    ("shipped as one undifferentiated number", "was published as one undifferentiated number"),
    ("shipped", "published"),
    ("Round 1 made this battery run", "The first version made this battery run"),
    ("Round 1 and did not notice", "and did not notice"),
    ("Round 2 added the field for exactly the purpose", "The field was added for exactly the purpose"),
    ("M64.I1 comment above records", "comment above records"),
    ("this whole review has been about", "the whole point of this breakdown"),
    ("M64 review", "health review"),
    ("the fleet", "the checkout"),
    ("standing rule", "rule"),
]
TAG_PREFIX = re.compile(r"^(?:\.[A-Z]{1,2}\d{1,2}[a-z]?|[A-Z]{1,2}\d{1,2}[a-z]?|M\d+(?:\.\w+)*)\s*[:—]\s*")
COMMENT = re.compile(r"^(\s*(?://|/\*+|\*+)\s?)(.*)$")

def clean_body(body: str) -> str:
    body = MILESTONE.sub("", body)
    body = ISSUE.sub("", body)
    for old, new in PHRASES:
        body = body.replace(old, new)
    body = TAG_PREFIX.sub("", body)
    body = re.sub(r"^\s*:\s*", "", body)
    body = re.sub(r"[ \t]{2,}", " ", body).rstrip()
    return body

def process(path: str) -> int:
    src = open(path).read().split("\n")
    out, changed = [], 0
    for line in src:
        m = COMMENT.match(line)
        if not m:
            out.append(line); continue
        prefix, body = m.group(1), m.group(2)
        new_body = clean_body(body)
        if new_body != body:
            changed += 1
        out.append(prefix + new_body)
    open(path, "w").write("\n".join(out))
    return changed

if __name__ == "__main__":
    for path in sys.argv[1:]:
        print(f"{path}: {process(path)} comment lines rewritten")
