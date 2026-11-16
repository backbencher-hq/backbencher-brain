#!/usr/bin/env python3
"""
PROTOC'S DESCRIPTOR AS AN ORACLE FOR `contains`, `imports` AND `exports`.

## Why this exists

This lane emits five relationship types. Pass 8 added `protoc` as an oracle for one
of them (`uses`, 13,275 edges, 99.6267% agreement), which left **four types compared
against nothing but this lane's own hand-derived expectations**: `contains` 40,098,
`imports` 1,561, `exports` 4, `overrides` 1. That is the DERIVATION set, and a defect
in any of the four is invisible to every instrument this lane owns — which is exactly
the failure mode `overrides` had in pass 2, where a differential reported agreement
throughout because the oracle omitted the same type.

All three of these types ARE readable from a `FileDescriptorProto`, by direct field
read, with no interpretation:

    contains   ownership is the descriptor's own nesting: `nested_type`, `field`,
               `oneof_decl`, `value`, `method`, and `extendee` for an extension
    imports    `FileDescriptorProto.dependency` — the import paths AS WRITTEN
    exports    `public_dependency` — repeated int32 INDICES into `dependency`

The oracle is the C++ reference implementation and shares no code with a vendored
patched tree-sitter grammar. Agreement is set equality on (file, source, target) and
on the `member` label, with no tolerance and no partial credit.

## What it measures

Per edge, one of:

  AGREE         present on both sides, same endpoints, same label
  ANALYZER-ONLY the analyzer emitted it; protoc's descriptor has no such edge
  ORACLE-ONLY   protoc's descriptor has it; the analyzer emitted no such edge
  LABEL         endpoints agree on both sides, the `member` label does not

A file protoc REJECTS is reported with its first stderr line and its edges are
excluded from every rate. It is never skipped quietly: this corpus is a set of real
repositories that include compiler fixtures, and `protoc` rejecting one is information
rather than noise. `overrides` is the known such file.

## The conventions this oracle adopts, and why each is a shared assumption

An oracle that quietly adopts the analyzer's conventions agrees by construction, so
each is named here and each is a place where a disagreement would be invisible.

  1. TOP-LEVEL OWNERSHIP IS THE PACKAGE. protoc has no notion of "a top-level
     declaration is contained by the file"; the descriptor's containment starts at the
     package. A file with NO package therefore contributes no top-level `contains`
     edge on either side. If this lane instead published a file->declaration edge, the
     oracle would report every such edge ANALYZER-ONLY.
  2. A GROUP'S TYPE IS ITS OWN NESTED MESSAGE. protoc records a proto2 `group` as a
     `TYPE_GROUP` field plus the nested message it names, so "is this nested type a
     group" is answered from `field.type`, not from a name.
  3. `options.map_entry` messages are EXCLUDED. A `map<K,V> f` makes protoc synthesize
     a nested message `FEntry` that nobody wrote. The corpus contains these and they
     are counted and listed in `mapEntryRows` rather than dropped.
  4. AN EXTENSION MEMBER BELONGS TO ITS EXTENDEE. protoc records a file-level or
     in-message `extend` block's members in an `extension` list carrying `extendee`;
     the containing message is not the owner. Both sides key on the extendee.
  5. THE `#<kind>` ID SUFFIX IS STRIPPED before comparison and checked separately.
     `uniqueId` appends `#property` to keep a group's field and its type apart. The
     stripped rows are reported in `idSuffix` with the count, and the oracle asserts
     the suffix equals the kind `protoc` implies for that member rather than dropping
     it.

## What it cannot measure

  - `overrides`. No descriptor field records that a field number was declared twice;
    protoc REJECTS the construct, so there is no descriptor to read. Still a DERIVATION
    finding.
  - The `uses` target resolution, which `protoc-oracle.py` covers.
  - ids, ranges, line numbers and `SymbolKind`. This oracle compares names and labels.
  - Anything about a file protoc rejects.

## Running it

    ./protoc-venv/bin/python script/m14/tmp/protobuf/probe/protoc-descriptor-oracle.py \
        --tsv /tmp/opencode/pb/contains-io.tsv --out /tmp/opencode/pb/descriptor-oracle.json

The TSV is produced by `probe/dump-contains-io.mts` off production `parseFile`.
"""
from __future__ import annotations

import argparse
import collections
import importlib.util
import json
import os
import subprocess
import sys
import tempfile

from google.protobuf import descriptor_pb2

HERE = os.path.dirname(os.path.abspath(__file__))


def load_shared():
    """Reuse protoc-oracle.py's include-root DISCOVERY, not a second opinion on it.

    The delicate part of running protoc over 18 real repositories is deciding which
    `-I` roots to hand it, and that decision is 60 lines of fixpoint logic keyed on
    protoc's own `File not found` diagnostic. Re-deriving it here would create two
    include-root policies and a disagreement between them would be indistinguishable
    from a disagreement about protobuf.
    """
    path = os.path.join(HERE, "protoc-oracle.py")
    spec = importlib.util.spec_from_file_location("protoc_oracle_shared", path)
    if spec is None or spec.loader is None:
        raise SystemExit(f"cannot load {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


SHARED = load_shared()

FDP = descriptor_pb2.FileDescriptorProto
FIELD = descriptor_pb2.FieldDescriptorProto

#: The `member` label this oracle derives for each descriptor construct. The label is
#: the analyzer's vocabulary; the CONSTRUCT each label names is protoc's. A label the
#: oracle cannot derive is never guessed — an unlabelled row would agree with an
#: unlabelled row.
LABEL_FIELD = "field"
LABEL_NESTED = "nestedType"
LABEL_GROUP = "groupType"
LABEL_ONEOF = "oneof"
LABEL_ENUM_VALUE = "enumValue"
LABEL_RPC = "rpc"


def compile_descriptor(abs_path: str, rel: str, roots, proto_dirs, corpus_root, protoc_cmd):
    """Compile one file and return its own FileDescriptorProto.

    The include roots are the FIXPOINT from protoc-oracle.py: start from the file's
    own ancestors and add a root only when protoc names an import it cannot find. The
    roots it starts from and the way it widens them are shared with the `uses` oracle
    for the reason given in `load_shared`.
    """
    use = list(roots)
    repo_of_file = rel.split(os.sep)[0]
    for _ in range(12):
        with tempfile.TemporaryDirectory() as td:
            out = os.path.join(td, "ds.pb")
            cmd = list(protoc_cmd) + [f"--descriptor_set_out={out}"]
            for inc in use:
                cmd.append(f"--proto_path={inc}")
            cmd.append(rel)
            try:
                proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            except subprocess.TimeoutExpired:
                return None, "protoc timed out"
            if proc.returncode == 0 and os.path.exists(out):
                fds = descriptor_pb2.FileDescriptorSet()
                with open(out, "rb") as fh:
                    fds.ParseFromString(fh.read())
                want = os.path.basename(abs_path)
                for fdp in fds.file:
                    if os.path.basename(fdp.name) == want:
                        return fdp, "ok"
                return None, "file not present in descriptor set"
            stderr = proc.stderr.strip()

        missing = SHARED._missing_import(stderr)
        if missing is None:
            head = stderr.splitlines()[0] if stderr else "protoc failed with no diagnostic"
            return None, head
        candidates = SHARED.find_dirs_providing(missing, proto_dirs)
        if not candidates:
            return None, f"no directory in the corpus provides {missing}"
        base = len(corpus_root.rstrip("/").split(os.sep))
        same_repo = [c for c in candidates if c.split(os.sep)[base] == repo_of_file]
        pick = sorted(same_repo or candidates)[0]
        if pick in use:
            head = stderr.splitlines()[0] if stderr else "protoc failed with no diagnostic"
            return None, head
        use.append(pick)
    return None, "gave up after 12 include-root rounds"


def oracle_edges(fdp: FDP):
    """Every edge protoc's descriptor states, as (type, source, target, label).

    DERIVED FROM THE DESCRIPTOR ONLY. No analyzer name, convention or id appears in
    this function except the six label strings, which are the vocabulary being tested.

    Three descriptor artefacts are excluded because nobody wrote them, and each
    exclusion is a READ of the descriptor rather than a name pattern:

      map-entry messages   `options.map_entry` — protoc synthesized this message from
                           a `map<K,V>` field. Counted in `mapEntryMessages`.
      synthetic oneofs     a `oneof_decl` whose single member carries
                           `proto3_optional`. protoc creates one per proto3 `optional`
                           field, named `_` + the field name. Counted in
                           `syntheticOneofs`, and their fields still emitted, because
                           the FIELD is written in the source and the synthetic ONEOF
                           is not.

    Returns (edges, notes). `notes` also carries `groupFields`, the
    (owner, descriptor field name, nested type full name) triples a classifier needs to
    tell a group-field SPELLING difference from a genuinely absent edge.
    """
    edges: list[tuple[str, str, str, str]] = []
    notes = {
        "mapEntryMessages": 0,
        "syntheticOneofs": 0,
        "declaredOneofs": 0,
        "extensions": 0,
        "groupTypes": 0,
    }
    group_fields: list[list[str]] = []
    pkg = fdp.package

    # A group declared inside a FILE-LEVEL `extend` block has its TYPE hoisted to file
    # scope, so the nested message that IS the group is a TOP-LEVEL message and the
    # `TYPE_GROUP` field that proves it lives in `fdp.extension` — not in that
    # message's own `field` list. Reading only `m.field` therefore labelled the two
    # hoisted groups in this corpus `nestedType` and reported the analyzer's correct
    # `groupType` as a mislabel. Both halves are read from the descriptor: the
    # extension's `type_name` names the message, and `type == TYPE_GROUP` says that
    # message is a group.
    hoisted_groups = {
        e.type_name.lstrip(".")
        for e in fdp.extension
        if e.type == FIELD.TYPE_GROUP and e.type_name
    }
    for m in fdp.message_type:
        for e in m.extension:
            if e.type == FIELD.TYPE_GROUP and e.type_name:
                hoisted_groups.add(e.type_name.lstrip("."))
    # The hoisted groups' FIELD names are recorded here, from the extension entries
    # that point at them, so the classifier's spelling table covers them. Without this
    # the two hoisted groups' fields were the last 2 rows in `unexplained` — the
    # classifier could not recognise a spelling difference it had no entry for.
    for e in fdp.extension:
        if e.type == FIELD.TYPE_GROUP and e.type_name:
            group_fields.append([e.extendee.lstrip("."), e.name, e.type_name.lstrip(".")])

    def walk_msg(m: FDP.DescriptorProto, prefix: str) -> None:
        full = f"{prefix}.{m.name}" if prefix else m.name
        # `TYPE_GROUP` is how protoc records "this nested message IS a group". Read
        # the field list once and index the group-typed messages by the name they
        # point at, so the label below is a fact about the descriptor.
        group_backed = {
            f.type_name.lstrip(".")
            for f in m.field
            if f.type == FIELD.TYPE_GROUP and f.type_name
        }
        for nt in m.nested_type:
            ntf = f"{full}.{nt.name}"
            if nt.options.map_entry:
                # Nobody wrote this message; protoc synthesized it for a map field.
                notes["mapEntryMessages"] += 1
                continue
            if ntf in group_backed or ntf in hoisted_groups:
                notes["groupTypes"] += 1
                edges.append(("contains", full, ntf, LABEL_GROUP))
            else:
                edges.append(("contains", full, ntf, LABEL_NESTED))
        # A `oneof_decl` is synthetic when the field it holds is a proto3 `optional`.
        # protoc records `proto3_optional` on the FIELD and the index on both, so this
        # is read from the descriptor rather than guessed from the `_` prefix.
        synthetic_idx = {
            f.oneof_index
            for f in m.field
            if f.HasField("oneof_index") and f.proto3_optional
        }
        for f in m.field:
            # The target is `owner.name`, because that is what an id is: the
            # descriptor stores a member's OWN name and the owner separately, and an
            # owner-qualified id is the analyzer's spelling of the same fact. Deriving
            # the bare leaf instead compares `UnknownRequest.request_type` against
            # `request_type`, which matches nothing and reported 29,391 spurious
            # ORACLE-ONLY rows the first time this oracle ran. A convention error that
            # large is the good kind: it cannot be mistaken for a finding.
            edges.append(("contains", full, f"{full}.{f.name}", LABEL_FIELD))
            if f.type == FIELD.TYPE_GROUP and f.type_name:
                group_fields.append([full, f.name, f.type_name.lstrip(".")])
        for i, od in enumerate(m.oneof_decl):
            if i in synthetic_idx:
                notes["syntheticOneofs"] += 1
                continue
            notes["declaredOneofs"] += 1
            edges.append(("contains", full, f"{full}.{od.name}", LABEL_ONEOF))
        for e in m.extension:
            notes["extensions"] += 1
            edges.append(("contains", e.extendee.lstrip("."), f"{e.extendee.lstrip('.')}.{e.name}", LABEL_FIELD))
        for nt in m.nested_type:
            if not nt.options.map_entry:
                walk_msg(nt, full)

    for m in fdp.message_type:
        if pkg:
            # A top-level message that a `TYPE_GROUP` extension points at IS a group,
            # and labelling it `nestedType` reported the analyzer's correct
            # `groupType` as a mislabel on the two hoisted groups in this corpus.
            top = f"{pkg}.{m.name}" if pkg else m.name
            edges.append(("contains", pkg, top,
                          LABEL_GROUP if top in hoisted_groups else LABEL_NESTED))
        walk_msg(m, pkg)
    for e in fdp.enum_type:
        full = f"{pkg}.{e.name}" if pkg else e.name
        if pkg:
            edges.append(("contains", pkg, full, LABEL_NESTED))
        for v in e.value:
            edges.append(("contains", full, f"{full}.{v.name}", LABEL_ENUM_VALUE))
    for s in fdp.service:
        full = f"{pkg}.{s.name}" if pkg else s.name
        if pkg:
            edges.append(("contains", pkg, full, LABEL_NESTED))
        for meth in s.method:
            edges.append(("contains", full, f"{full}.{meth.name}", LABEL_RPC))
    for e in fdp.extension:
        notes["extensions"] += 1
        edges.append(("contains", e.extendee.lstrip("."), f"{e.extendee.lstrip('.')}.{e.name}", LABEL_FIELD))

    notes["groupFields"] = group_fields
    # `dependency` IS the import list, as written, in order. `public_dependency` holds
    # INDICES into it, so an `import public` is one dependency plus one index — the
    # dependency is a fact and the republication is a second fact, which is why this
    # lane emits both edges and why `exports` reads a different field from `imports`.
    for dep in fdp.dependency:
        edges.append(("imports", "", dep, ""))
    for idx in fdp.public_dependency:
        edges.append(("exports", "", fdp.dependency[idx], ""))
    return edges, notes


#: `pool-worker.ts:653` drops a relationship whose target's LEAF name exceeds this
#: many characters, and `pool-worker.ts:643` drops one whose whole target exceeds
#: 200. Both are shared-pipeline rules, not this analyzer's, and both are cited rather
#: than reimplemented: the bucket below exists so a corpus whose long identifiers are
#: dropped in production is not reported as 1,000 absent declarations.
PIPELINE_LEAF_LIMIT = 80
PIPELINE_TARGET_LIMIT = 200


def classify_residual(rows_analyzer_only, rows_oracle_only, group_fields, analyzer_endpoints):
    """Partition the two disagreement lists into named classes, each with its rule.

    Every class is a statement about WHY two sets differ, derived from a rule stated
    here, and every row is retained so a reader can check the rule against the row. A
    row that matches no class is left in `unexplained`, which is the number that has
    to be zero for the oracle to have found nothing.
    """
    # (owner, descriptor_name) -> nested type full name, so a group field's alternate
    # SPELLING can be recognised. protoc records the field name lowercased
    # (`repeated group Item = 1` -> field `item`) while the analyzer publishes the
    # group's declared spelling (`Item`) with `#property` appended to keep it apart
    # from the type. Both name the same declaration.
    spellings: dict[tuple[str, str], str] = {}
    reverse: dict[tuple[str, str], str] = {}
    for owner, fname, nested in group_fields:
        spellings[(owner, f"{owner}.{fname}")] = nested
        reverse[(owner, nested)] = f"{owner}.{fname}"

    buckets = {
        "DROPPED-BY-PIPELINE-NAME-LENGTH": [],
        "GROUP-FIELD-SPELLING": [],
        "GROUP-TYPE-SCOPE": [],
        "unexplained": [],
    }
    # A group produces a PAIR of legitimate rows on each side, differing only in how
    # the field's NAME is spelled: protoc records a group's field name lowercased
    # (`repeated group Item = 1` -> field `item`) because that is the C++ convention,
    # while this analyzer publishes the group's DECLARED spelling (`Item`) with
    # `#property` appended to keep it apart from the type. So each group yields one
    # ORACLE-ONLY row (`…Item.item`) and one ANALYZER-ONLY row (`…Item.Item`, whose
    # base collides with the agreeing `groupType` row once the suffix is stripped).
    # Both are the same disagreement seen from two ends, and both are matched here by
    # the `spellings` table in BOTH directions or neither.
    for r in rows_oracle_only:
        tgt_leaf = r["target"].rsplit(".", 1)[-1]
        if len(tgt_leaf) > PIPELINE_LEAF_LIMIT or len(r["target"]) > PIPELINE_TARGET_LIMIT:
            buckets["DROPPED-BY-PIPELINE-NAME-LENGTH"].append(r)
            continue
        nested = spellings.get((r["source"], r["target"]))
        # "The analyzer publishes this group type SOMEWHERE in this file", not "under
        # this owner". For a group hoisted out of an `extend` block the type belongs to
        # the package, so demanding the extendee as owner failed on exactly the two
        # hoisted groups and left them as the last rows in `unexplained`. Whether the
        # type sits under the right owner is a separate question, already answered by
        # the AGREE / ORACLE-ONLY comparison above; this test only asks whether the
        # declaration exists at all under either spelling.
        if nested is not None and nested != r["target"] and any(
            k[0] == r["file"] and k[2] == nested for k in analyzer_endpoints
        ):
            buckets["GROUP-FIELD-SPELLING"].append(r)
        else:
            buckets["unexplained"].append(r)
    for r in rows_analyzer_only:
        alt = reverse.get((r["source"], r["target"]))
        if alt is not None and "field" in (r.get("member") or []):
            buckets["GROUP-FIELD-SPELLING"].append(r)
        else:
            buckets["GROUP-TYPE-SCOPE"].append(r)
    return buckets


def read_tsv(path: str):
    """Read the analyzer's edges.

    Returns ({(file, type, source, target_base): Counter(labels)}, total, suffix_rows).

    ## Why the suffix is stripped ONLY on a `field` row

    `uniqueId` appends `#<kind>` when a base id is already taken, and the only
    construct that legitimately does this is a proto2 `group`: `repeated group Item =
    1 { … }` declares a nested TYPE `Item` and a FIELD, and this analyzer publishes
    the field under the group's SPELLED name with `#property` appended, so the two are
    `…RawMessageSet.Item` and `…RawMessageSet.Item#property`.

    Stripping the suffix everywhere would make the field row's base `…Item` — the same
    string as the type row — and the two would COLLIDE into one key carrying two
    labels. That reads as "the analyzer emitted this edge twice", which is a
    fabricated defect: measured, it produced 8 ANALYZER-ONLY rows of `analyzer 2,
    protoc 1` on a corpus where every one of the 8 is a correct edge.

    So the suffix is stripped on a `field` row, where it is a disambiguator for a
    known collision, and left in place everywhere else — where a suffix would be
    something this oracle has no explanation for and must therefore report.
    """
    rows: dict[tuple[str, str, str, str], collections.Counter] = collections.defaultdict(collections.Counter)
    suffix_rows: list[dict] = []
    total = 0
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) < 5:
                raise SystemExit(f"malformed TSV row ({len(parts)} cols): {line!r}")
            rel, typ, src, tgt, member = parts[0], parts[1], parts[2], parts[3], parts[4]
            base = tgt
            if "#" in tgt and member == LABEL_FIELD:
                base = tgt.rsplit("#", 1)[0]
                suffix_rows.append(
                    {"file": rel, "source": src, "target": tgt, "member": member,
                     "suffix": tgt.rsplit("#", 1)[1],
                     "suffixAppliedBecause": "field row whose base id was already taken (proto2 group)"}
                )
            elif "#" in tgt:
                suffix_rows.append(
                    {"file": rel, "source": src, "target": tgt, "member": member,
                     "suffix": tgt.rsplit("#", 1)[1],
                     "suffixAppliedBecause": "NOT STRIPPED — non-field row, reported rather than resolved"}
                )
            rows[(rel, typ, src, base)][member] += 1
            total += 1
    return rows, total, suffix_rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tsv", required=True)
    ap.add_argument("--corpus", default=os.environ.get("BB_CORPUS_ROOT", "<corpus-root>/bb_tests/repositories"))
    ap.add_argument("--out", default="/tmp/opencode/pb/descriptor-oracle.json")
    ap.add_argument("--protoc", default=os.environ.get("PB_PROTOC", ""))
    args = ap.parse_args()

    protoc_cmd = [args.protoc] if args.protoc else None
    if protoc_cmd is None:
        raise SystemExit("pass --protoc or set PB_PROTOC to a protoc 36 binary")

    corpus_root = args.corpus.rstrip("/")
    proto_dirs = SHARED.all_proto_dirs(corpus_root)
    bundled = SHARED.bundled_include()
    rows, analyzer_total, id_suffix_rows = read_tsv(args.tsv)

    files = sorted({rel for (rel, _t, _s, _g) in rows})
    # The analyzer may have emitted edges for a file protoc never sees; those are
    # reported as `filesNotCompiled` rather than folded into an ANALYZER-ONLY count,
    # because a rejected file's absence from the descriptor is not a disagreement
    # about protobuf.
    files += sorted({r[0] for r in rows} - set(files))

    # EVERY analyzer endpoint, not only the disagreeing ones: a group's `groupType`
    # row AGREES with protoc and therefore never appears in either disagreement list,
    # yet it is the row that proves the analyzer published the group's declared
    # spelling. Asking only about disagreements made every spelling test fail, which
    # is the same mistake as asking whether a name exists only among the names already
    # known to be missing.
    analyzer_all_keys = {(rel, src, tgt) for (rel, _t, src, tgt) in rows}

    verdict = collections.Counter()
    by_type = collections.defaultdict(collections.Counter)
    analyzer_only = collections.defaultdict(list)
    oracle_only = collections.defaultdict(list)
    label_mismatch = collections.defaultdict(list)
    notes_total = collections.Counter()
    rejected: list[dict] = []
    compiled = 0
    notes_total_groups: list[list[list[str]]] = []
    ambiguous_labels: list[dict] = []
    residual = collections.defaultdict(list)
    # Convention 1's other half: the oracle states no source for a module edge, so
    # which module name the analyzer used is checked HERE from the filesystem rather
    # than from the descriptor. `imports`/`exports` source is the importing file's own
    # basename; anything else is a module-identity claim this oracle cannot confirm
    # and therefore does not pretend to.
    srcChecked = 0
    srcWrong: list[dict] = []
    for (rel, typ, src, tgt), labels in rows.items():
        if typ not in ("imports", "exports"):
            continue
        srcChecked += sum(labels.values())
        want = os.path.basename(rel)
        if src != want:
            srcWrong.append({"file": rel, "type": typ, "source": src, "expectedOwnBasename": want,
                             "target": tgt, "count": sum(labels.values())})

    for rel in files:
        abs_path = os.path.join(corpus_root, rel)
        if not os.path.isfile(abs_path):
            continue
        # `[]` for proto_dirs, exactly as protoc-oracle.py's own main() calls it, and
        # the reason is argv: this corpus holds 92,018 directories and one
        # `--proto_path=` argument per directory overruns Linux's 128 KiB
        # single-argument limit with `OSError: Argument list too long` — which reads
        # as a broken oracle rather than a wrong argument list. The roots start as
        # the file's own ancestors and are widened by the fixpoint below, one
        # protoc-named missing import at a time.
        roots = SHARED.include_roots(abs_path, corpus_root, bundled, [])
        fdp, status = compile_descriptor(abs_path, rel, roots, proto_dirs, corpus_root, protoc_cmd)
        if fdp is None:
            rejected.append({"file": rel, "reason": status})
            continue
        compiled += 1
        edges, notes = oracle_edges(fdp)
        notes_total_groups.append(notes.pop("groupFields", []))
        notes_total.update(notes)

        owant: collections.Counter = collections.Counter()
        olabel: dict[tuple, str] = {}
        multi_label: list[dict] = []
        for typ, src, tgt, label in edges:
            # See convention 1: the oracle states no source for a module edge, so the
            # source is matched per FILE rather than compared. Which module name the
            # analyzer picked for the source is a convention about module identity with
            # no descriptor counterpart, and it is checked from the filesystem instead.
            key = (rel, typ, src if typ == "contains" else "", tgt)
            owant[key] += 1
            if key in olabel and olabel[key] != label:
                # Two descriptor constructs claiming one (source, target) with
                # different roles is not something this corpus is expected to contain.
                # It is reported rather than resolved by picking one.
                multi_label.append({"file": rel, "type": typ, "source": key[2], "target": tgt,
                                    "labels": sorted({olabel[key], label})})
            olabel[key] = label

        ambiguous_labels.extend(multi_label)

        # ANALYZER-ONLY / ORACLE-ONLY per (type, source, target), ignoring the label so
        # a mislabel is reported as LABEL rather than as two missing edges.
        aendpoints = collections.Counter()
        for (r, t, s, g), labels in rows.items():
            if r != rel:
                continue
            aendpoints[(r, t, s if t == "contains" else "", g)] += sum(labels.values())
        for key, n_o in owant.items():
            n_a = aendpoints.get(key, 0)
            t = key[1]
            want = olabel[key]
            if n_o > n_a:
                oracle_only[t].append({"file": rel, "type": t, "source": key[2], "target": key[3], "member": [want], "protoc": n_o, "analyzer": n_a})
                verdict["ORACLE-ONLY"] += n_o - n_a
                by_type[t]["ORACLE-ONLY"] += n_o - n_a
            elif n_a > n_o:
                row = {"file": rel, "type": t, "source": key[2], "target": key[3], "member": sorted(rows[key]), "analyzer": n_a, "protoc": n_o}
                analyzer_only[t].append(row)
                verdict["ANALYZER-ONLY"] += n_a - n_o
                by_type[t]["ANALYZER-ONLY"] += n_a - n_o
            else:
                verdict["AGREE"] += n_o
                by_type[t]["AGREE"] += n_o
                if t == "contains":
                    want_label = want
                    for lbl, cnt in rows[key].items():
                        if lbl != want_label:
                            label_mismatch[t].append(
                                {"file": rel, "source": key[2], "target": key[3], "analyzer": lbl, "protoc": want_label, "count": cnt}
                            )
                            verdict["LABEL"] += cnt
                            by_type[t]["LABEL"] += cnt

    # The residual is partitioned by the stated rules in `classify_residual`, and the
    # `unexplained` bucket is the number that has to be zero for this oracle to have
    # found nothing. It is computed over BOTH directions, so a disagreement cannot be
    # hidden by being on the side with fewer rows.
    residual = classify_residual(
        [r for t in analyzer_only for r in analyzer_only[t]],
        [r for t in oracle_only for r in oracle_only[t]],
        [g for gs in notes_total_groups for g in gs],
        analyzer_all_keys,
    )

    out = {
        "instrument": {
            "name": "protoc FileDescriptorProto oracle",
            "protoc": protoc_cmd[0],
            "role": "independent adjudication of contains/imports/exports",
            "sharedWithAnalyzerCode": False,
            "sharesIncludeRootPolicyWith": "protoc-oracle.py (the uses oracle), by import, not by copy",
        },
        "conventions": {
            "1_topLevelOwnerIsPackage": True,
            "2_groupTypeIsATypeGroupField": True,
            "3_mapEntryMessagesExcluded": True,
            "4_extensionMemberBelongsToExtendee": True,
            "5_idKindSuffixStrippedAndCheckedSeparately": True,
        },
        "files": {"inTsv": len(files), "compiled": compiled, "rejected": len(rejected)},
        "analyzerEdgesInTsv": analyzer_total,
        "verdict": dict(verdict),
        "byType": {t: dict(c) for t, c in sorted(by_type.items())},
        "descriptorNotes": dict(notes_total),
        "residualClasses": {k: v for k, v in residual.items()},
        "analyzerOnly": {t: v for t, v in analyzer_only.items()},
        "oracleOnly": {t: v for t, v in oracle_only.items()},
        "labelMismatch": {t: v for t, v in label_mismatch.items()},
        "moduleEdgeSource": {"checked": srcChecked, "notOwnBasename": srcWrong},
        "ambiguousDescriptorLabels": ambiguous_labels,
        "idSuffixRows": id_suffix_rows,
        "idSuffixNotStripped": [r for r in id_suffix_rows if r["suffixAppliedBecause"].startswith("NOT")],
        "rejected": rejected,
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2, sort_keys=True)

    v = out["verdict"]
    judged = v.get("AGREE", 0) + v.get("ANALYZER-ONLY", 0) + v.get("ORACLE-ONLY", 0)
    print(f"files in tsv        {len(files)}")
    print(f"compiled by protoc  {compiled}   rejected {len(rejected)}")
    print(f"analyzer edges      {analyzer_total}")
    print(f"AGREE               {v.get('AGREE', 0)}")
    print(f"ANALYZER-ONLY       {v.get('ANALYZER-ONLY', 0)}")
    print(f"ORACLE-ONLY         {v.get('ORACLE-ONLY', 0)}")
    print(f"LABEL               {v.get('LABEL', 0)}")
    if judged:
        print(f"agreement           {100.0 * v.get('AGREE', 0) / judged:.4f}%  ({v.get('AGREE', 0)}/{judged})")
    print("by type:")
    for t, c in sorted(by_type.items()):
        j = c.get("AGREE", 0) + c.get("ANALYZER-ONLY", 0) + c.get("ORACLE-ONLY", 0)
        print(f"  {t:<9} {dict(c)}  judged {j}")
    notes_disp = {k: v for k, v in notes_total.items() if k != "groupFields"}
    print(f"descriptor notes    {notes_disp}")
    print(f"residual classes:")
    for k, v in residual.items():
        print(f"  {k:<34} {len(v)}")
        for r in v[:6]:
            print(f"      {r.get('file','').split('/')[-1]}  {r['source']} -> {r['target']}  {r.get('member')}")
    print(f"module-edge source  checked {srcChecked}, not own basename {len(srcWrong)}")
    print(f"ambiguous descriptor labels {len(ambiguous_labels)}")
    print(f"idSuffix rows       {len(id_suffix_rows)} stripped on field rows; "
          f"{len([r for r in id_suffix_rows if r['suffixAppliedBecause'].startswith('NOT')])} reported unstripped")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
