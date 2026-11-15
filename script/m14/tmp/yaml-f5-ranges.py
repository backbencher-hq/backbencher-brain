#!/usr/bin/env python3
"""script/m14/tmp/yaml-f5-ranges.py — the oracle's key tree WITH byte ranges.

WHY THIS EXISTS
---------------
`yaml-f5-differential.ts` reports `unexplained: 0`, and 34% of the oracle's truth
paths (121,796 of 357,304) land in one bucket: `grammarLossProvenByOracle`. That
bucket is a CLAIM — "the loss is tree-sitter-yaml's, not the analyzer's" — and a
claim that absorbs a third of the evidence deserves to be attacked rather than
trusted. The attack is narrow and answerable:

    Is every lost path INSIDE a span the grammar itself marked as ERROR?

If yes, the attribution holds. If any lost path lies OUTSIDE every ERROR node,
then the grammar cannot explain it, the bucket is absorbing an analyzer defect,
and the lane's headline number is softer than it reads.

Answering it needs a byte offset per truth path, which the existing oracle does not
emit: it emits path NAMES. PyYAML's `start_mark.index` is a CHARACTER index into
the stream, while tree-sitter reports BYTE offsets, and the two differ in any file
containing non-ASCII — which the docker API corpus does, heavily (its descriptions
are prose). So the conversion is done here explicitly rather than assumed, and a
file whose text is not pure ASCII is reported so the conversion can be audited.

This script is a DIAGNOSTIC companion to the oracle and shares no state with it; it
re-derives the same key tree so a drift between the two is visible as a count
difference rather than hidden by a shared import.

Usage: python3 script/m14/tmp/yaml-f5-ranges.py '["/abs/path.yaml", ...]'
"""
import json
import sys

import yaml
from yaml.nodes import MappingNode, ScalarNode, SequenceNode


def walk(node, prefix, out, ranges, byte_of, ancestors=None, chain=()):
    """The oracle's key tree, plus the byte span of the node that created each path.

    A mapping contributes its KEY paths and a sequence contributes one path per
    ITEM, exactly as yaml-f5-oracle.py does — the audit is only meaningful if the
    two trees are the same tree.
    """
    if isinstance(node, MappingNode):
        for key_node, value_node in node.value:
            key = str(key_node.value)
            path = f"{prefix}.{key}" if prefix else key
            out.append(path)
            # The span of the KEY, not of the value: the analyzer's identity for a
            # mapping key is the key, so a defect in reading the key is what this
            # audit is looking for.
            ranges.setdefault(path, [byte_of(key_node.start_mark.index), byte_of(key_node.end_mark.index)])
            # The ANCESTOR CHAIN, recorded as the walk actually built it.
            #
            # This exists because the TypeScript side tried to reconstruct ancestors by
            # splitting the flat path on "." and it is wrong for this corpus: an
            # OpenAPI definition key is routinely `io.k8s.api.core.v1.Pod`, so
            # `definitions.io.k8s.api.Pod` splits into prefixes (`definitions.io`,
            # `definitions.io.k8s`) that are NOT keys, no range is found for them, and
            # every such path is reported as having a clean chain. That produced 5,294
            # false "unexplained" paths in v1.28 alone. Only the walk knows the real
            # chain, so only the walk records it.
            if ancestors is not None:
                # NOT the full chain. Emitting `list(chain)` per path is quadratic in
                # depth, and over 138 damaged files it pushed the JSON past the
                # caller's maxBuffer — execFileSync then silently returned a TRUNCATED
                # payload, whole files vanished from the audit, and two runs over the
                # same corpus audited different file sets (v1.37/v1.38 contributed 0
                # paths in one run and 8,973 in another). A missing file reads as
                # "nothing lost", which is the most dangerous way this can fail.
                # The audit only ever needs the TOP-MOST ancestor, because if that one
                # is clean the deeper chain is irrelevant to "was this path's naming
                # destroyed", so two ints per path is sufficient and linear.
                ancestors.setdefault(path, list(chain[0]) if chain else [byte_of(key_node.start_mark.index), byte_of(key_node.end_mark.index)])
            walk(value_node, path, out, ranges, byte_of, ancestors, chain + (path,))
    elif isinstance(node, SequenceNode):
        for index, item in enumerate(node.value):
            path = f"{prefix}[{index}]"
            if isinstance(item, (MappingNode, SequenceNode)):
                out.append(path)
                ranges.setdefault(path, [byte_of(item.start_mark.index), byte_of(item.end_mark.index)])
                if ancestors is not None:
                    ancestors.setdefault(path, list(chain[0]) if chain else [byte_of(item.start_mark.index), byte_of(item.end_mark.index)])
                walk(item, path, out, ranges, byte_of, ancestors, chain + (path,))


def main():
    files = json.loads(sys.argv[1])
    results = {}
    totals = {"files": 0, "documents": 0, "paths": 0, "nonAsciiFiles": 0}
    for path in files:
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as handle:
                text = handle.read()
        except OSError as exc:
            results[path] = {"error": f"read: {exc}"}
            continue
        totals["files"] += 1
        if not text.isascii():
            totals["nonAsciiFiles"] += 1
        # PyYAML marks are character indices; tree-sitter wants byte offsets. The
        # prefix-encoding conversion is O(n) per lookup, which is irrelevant at 15
        # files and is the reason the conversion is written out rather than guessed.
        encoded = text.encode("utf-8")
        ascii_only = text.isascii()
        if ascii_only:
            def byte_of(char_index, _e=encoded):
                return char_index
        else:
            def byte_of(char_index, _t=text):
                return len(_t[:char_index].encode("utf-8"))
        try:
            documents = [d for d in yaml.compose_all(text) if d is not None]
        except Exception as exc:  # noqa: BLE001 — a parse failure is data, not a crash
            results[path] = {"error": f"{type(exc).__name__}: {str(exc)[:200]}"}
            continue
        if not documents:
            results[path] = {"error": "empty-document"}
            continue
        per_document, ranges, ancestors, document_spans = [], {}, {}, []
        for doc in documents:
            paths = []
            walk(doc, "", paths, ranges, byte_of, ancestors)
            per_document.append(sorted(set(paths)))
            totals["documents"] += 1
            document_spans.append([byte_of(doc.start_mark.index), byte_of(doc.end_mark.index)])
        totals["paths"] += sum(len(d) for d in per_document)
        results[path] = {
            "documents": per_document,
            "ranges": ranges,
            "ancestors": ancestors,
            "documentSpans": document_spans,
            "byteLength": len(encoded),
        }
    json.dump({"implementation": "pyyaml-6.0.1-compose+ranges", "totals": totals, "results": results}, sys.stdout)


if __name__ == "__main__":
    main()
