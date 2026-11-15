#!/usr/bin/env python3
"""M14.0.F5 — the yaml lane's INDEPENDENT SECOND OPINION.

WHY THIS ORACLE. The analyzer reads a concrete-syntax tree from tree-sitter-yaml
0.7.1 (an incremental LR parser, written in JavaScript, implementing the YAML 1.2
CORE schema). This oracle reads a DOCUMENT-MODEL node graph from PyYAML 6.0.1 (a
hand-written port of the specification's own reference parser, written in Python,
implementing YAML 1.1). The two share no code, no algorithm and no data model, and
they disagree by design on scalar resolution — which is precisely why agreement
between them is evidence and a self-comparison would be a tautology.

WHAT IS COMPARED, AND WHY NOT MORE. Only the KEY TREE: the set of mapping keys and
the shape of the sequence nesting. That is the most both implementations can
independently see. Scalar TYPE resolution is deliberately NOT compared, because a
1.1 and a 1.2 schema disagree about `yes`, `on`, `0777` and `1:30`, and that
disagreement is a known fact about YAML rather than a defect in either
(script/m14/spec/yaml-completeness.json, design_decision YAML-D6).

MERGE KEYS ARE NOT APPLIED ON EITHER SIDE. PyYAML's flatten_mapping() rewrites `<<`
into explicit keys, but it runs in the CONSTRUCTOR and `compose_all` never
constructs — so the oracle sees the raw `<<`, exactly as the analyzer does when it
emits an inheritance edge instead of inlining the target's keys.

ONE ANALYZER POLICY IS MIRRORED, DELIBERATELY. An anonymous scalar sequence item is
a value, not a declaration (YAML-D7), so the analyzer emits no symbol for it and the
oracle skips it too. Mirroring a DECLARED policy is not copying an implementation:
the policy is written down, and a different implementation would reach the same call
about a data language.

OUTPUT. JSON on stdout: a path list PER DOCUMENT plus a summary. Per document, not
merged — a stream is a sequence of documents and the analyzer names them `<stem>`,
`<stem>#2`, ..., so a merged list would mis-attribute every path in documents 2..N to
document 1 and manufacture disagreement out of agreement.
"""
import json
import sys

import yaml
from yaml.nodes import MappingNode, SequenceNode

# The tags a plain scalar legitimately resolves to under either schema. Anything else
# is a real tag, and the count is what makes "the corpus contains almost no type
# annotations" a measurement rather than an impression.
CORE_TAGS = frozenset({
    "tag:yaml.org,2002:str", "tag:yaml.org,2002:int", "tag:yaml.org,2002:float",
    "tag:yaml.org,2002:bool", "tag:yaml.org,2002:null", "tag:yaml.org,2002:map",
    "tag:yaml.org,2002:seq", "tag:yaml.org,2002:merge",
})


def walk(node, prefix, out, stats):
    """The key tree of one document, plus the counts that make a disagreement diagnosable.

    A mapping contributes its KEY paths; a sequence contributes a path per
    object/array ITEM; a scalar contributes nothing.
    """
    if isinstance(node, MappingNode):
        seen = set()
        for key_node, value_node in node.value:
            key = str(key_node.value)
            if key in seen:
                stats["duplicateKeys"] += 1
            seen.add(key)
            path = f"{prefix}.{key}" if prefix else key
            out.append(path)
            walk(value_node, path, out, stats)
    elif isinstance(node, SequenceNode):
        for index, item in enumerate(node.value):
            path = f"{prefix}[{index}]"
            if isinstance(item, (MappingNode, SequenceNode)):
                out.append(path)
                walk(item, path, out, stats)
            else:
                stats["scalarItems"] += 1
    else:
        tag = getattr(node, "tag", None)
        if tag and tag not in CORE_TAGS:
            stats["tags"] += 1


def extract(text):
    """-> (per_document_paths, stats, error)"""
    stats = {"duplicateKeys": 0, "scalarItems": 0, "documents": 0, "tags": 0, "nodes": 0}
    try:
        documents = [d for d in yaml.compose_all(text) if d is not None]
    except Exception as exc:  # noqa: BLE001 — the oracle's parse failure is data
        return None, stats, f"{type(exc).__name__}: {str(exc)[:200]}"
    if not documents:
        return None, stats, "empty-document"
    per_document = []
    for doc in documents:
        stats["documents"] += 1
        stats["nodes"] += 1
        paths = []
        walk(doc, "", paths, stats)
        per_document.append(sorted(set(paths)))
    return per_document, stats, None


def main():
    files = json.loads(sys.argv[1])
    results = {}
    totals = {
        "files": 0, "parsed": 0, "unparsed": 0, "paths": 0, "documents": 0,
        "duplicateKeys": 0, "scalarItems": 0, "tags": 0,
    }
    reasons = {}
    for path in files:
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as handle:
                text = handle.read()
        except OSError as exc:
            results[path] = {"error": f"read: {exc}"}
            totals["unparsed"] += 1
            continue
        totals["files"] += 1
        per_document, stats, err = extract(text)
        if err is not None:
            results[path] = {"error": err}
            totals["unparsed"] += 1
            key = err.split(":")[0]
            reasons[key] = reasons.get(key, 0) + 1
            continue
        totals["parsed"] += 1
        totals["documents"] += stats["documents"]
        totals["paths"] += sum(len(doc) for doc in per_document)
        totals["duplicateKeys"] += stats["duplicateKeys"]
        totals["scalarItems"] += stats["scalarItems"]
        totals["tags"] += stats["tags"]
        results[path] = {"documents": per_document, "stats": stats}
    json.dump({
        "oracle": "pyyaml-6.0.1-compose",
        "mergeKeysApplied": False,
        "totals": totals,
        "unparsedReasons": reasons,
        "files": results,
    }, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
