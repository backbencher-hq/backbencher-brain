#!/usr/bin/env python3
"""
PROTOC AS AN ORACLE FOR REFERENCE RESOLUTION — every `uses` target, adjudicated.

## Why this exists

This lane emits 13,275 `uses` edges whose target is a TYPE REFERENCE, and until now
nothing outside the analyzer itself had ever adjudicated a single one of them: the
five emitted types carried five DERIVATION findings, and the document says so. Every
resolution number the lane reports — 72.87% per-file, 99.58% corpus-wide, 88.57% to
exactly one declaration — was computed by resolving an emitted name against the
analyzer's own id set. A grammar bug shared by the analyzer and the checker is
invisible to both.

`protoc` is the reference implementation, and it is not that. Given a file it emits a
`FileDescriptorProto` in which **every message-typed field's `type_name` is an
ABSOLUTE, FULLY QUALIFIED, RESOLVED name** — `protoc` has already run the C++ name
lookup. So the oracle is a single field read, and it is the same field protoc itself
reads when it links a descriptor:

    analyzer   Account.scope -> controller.api.resources.scopes.v1.ScopeInfo
    protoc     type_name    = .controller.api.resources.scopes.v1.ScopeInfo

Agreement is exact string equality after the leading dot. There is no tolerance, no
partial credit, and no shared code with the analyzer: the two sides come from a
vendored patched tree-sitter grammar and from the C++ compiler respectively.

## What this measures, and what it cannot

Per message-typed field, whether the analyzer's emitted target equals protoc's
`type_name`. Reported three ways, because they answer different questions:

  AGREE          emitted == protoc's resolved name
  WRONG-NAME     protoc RESOLVED it and the analyzer emitted a different name.
                 This is the number that matters: the construct exists, protoc found
                 it, and this lane named something else.
  NOT-A-TYPE     protoc recorded no `type_name` for the field (scalar, enum written
                 as a number, group, or a field this walk does not pair 1:1). Excluded
                 from the rate and counted, never dropped silently.
  UNRESOLVED     protoc recorded `type_name` but the file did not COMPILE, so the
                 value cannot be trusted. Only possible for a file protoc rejects.

This oracle covers REFERENCE RESOLUTION only. It says nothing about `contains`
membership, `imports`, `exports`, `overrides`, kinds, ranges or ids — those stay
DERIVATION findings and are still reported as such.

## Running it

    ./protoc-venv/bin/python script/m14/tmp/protobuf/probe/protoc-oracle.py \
        --tsv /tmp/opencode/pb/uses-targets.tsv --out /tmp/opencode/pb/protoc-oracle.json

The TSV is produced by `probe/dump-uses-targets.mts`, one line per `uses` edge:

    <file>\t<source id>\t<target>\t<flags>

Files that do not compile are reported, not skipped quietly: a corpus is expected to
contain fixtures that no compiler accepts, and `protoc` rejecting one is information.
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import subprocess
import sys
import tempfile

from google.protobuf import descriptor_pb2

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", ".."))


def bundled_include() -> str | None:
    """grpc_tools ships the well-known types; they are what most corpus files import."""
    try:
        import grpc_tools
    except ImportError:
        return None
    p = os.path.join(os.path.dirname(grpc_tools.__file__), "_proto")
    return p if os.path.isdir(p) else None


#: A field's declared type is a reference this lane emits as `uses` when protoc says
#: the field holds a MESSAGE or a GROUP. A group is a message written inline, and
#: protoc gives it its own `type` while still resolving a full `type_name` for it.
GROUPED_OR_MESSAGE = frozenset({
    descriptor_pb2.FieldDescriptorProto.TYPE_MESSAGE,
    descriptor_pb2.FieldDescriptorProto.TYPE_GROUP,
})


def row_name(f) -> str:
    """The member name this oracle keys a row on.

    For an ordinary field that is protoc's own `name`. For a proto2 GROUP it is the
    group's DECLARED name, which `protoc` puts in the leaf of `type_name` and does
    NOT put in `name` — `optional group Item = 1` yields `name = "item"` and
    `type_name = ".….Item"`.

    Reading `name` for a group is a silent miss rather than a loud one: the row is
    keyed `….item`, no analyzer row carries that spelling, and the edge lands in
    NOT-A-TYPE — the class this oracle excludes from its rate. Measured, that is all
    10 group `uses` edges in the corpus, including the 2 whose target this lane's
    group-scope fix corrected. The declared name is read from the descriptor, not
    copied from the analyzer: `type_name`'s last dotted segment IS the group's name
    as written, and protoc needed it to resolve the type.
    """
    if f.type == descriptor_pb2.FieldDescriptorProto.TYPE_GROUP and f.type_name:
        return f.type_name.rsplit(".", 1)[-1]
    return f.name


def field_entries(fdp: descriptor_pb2.FileDescriptorProto):
    """
    Yield one record per field that carries a resolved message type.

        (owner_full_name, field_name, type_name, map_value_type_name)

    `type_name` for a message-typed field is absolute and fully qualified — protoc
    resolved it. For a scalar there is no `type_name` at all, for TYPE_ENUM there
    is one but it names an enum, and for TYPE_GROUP there is one naming the group's
    message. `TYPE_GROUP` is ALSO a type reference this lane emits as `uses` — a
    proto2 `group` declares a nested type and a field of it, and this analyzer emits
    `field -> type` with `role: "groupType"`. Excluding TYPE_GROUP put every group in
    the corpus in NOT-A-TYPE, which is the class this oracle excludes from its rate,
    so the two corpus `uses` targets that named a group type protoc does not define
    were never adjudicated by the oracle meant to adjudicate them. Both the extension
    loop and the field loop below accept either type.

    THE MAP CASE IS WHY THIS RETURNS FOUR VALUES. For `map<string, ListValue> foo
    = 1;` protoc reports `foo`'s `type_name` as the SYNTHESIZED map-entry message
    `Owner.FooEntry` — a type nobody wrote and this analyzer does not publish.
    Comparing the analyzer's emitted target against that would report every map
    field in the corpus as a wrong name, and it would be wrong about which: the
    analyzer deliberately emits the map's VALUE type, because `map<string,
    ListValue>` means the field holds ListValues and a graph edge to `ListValue` is
    the one a consumer can walk, while `FooEntry` is an artifact of the
    representation.

    So a map field is compared against the map entry's OWN `value` field
    `type_name`. That tests the analyzer's convention against protoc's instead of
    testing it against a type neither of them chose, and it keeps the difference
    visible as a difference rather than hiding it.
    """
    out = []

    def walk(msg, prefix: str):
        full = f"{prefix}.{msg.name}" if prefix else msg.name
        # A NESTED `extend` block is recorded on the ENCLOSING MESSAGE, not on the
        # file. `extend Foo { … }` written inside a message puts the extension in
        # that message's own `extension` list, and reading only `fdp.extension`
        # misses every one of them. This is not hypothetical: it hid the case the
        # scope fix exists for. `protoc` reports, for
        # `message ComplexOptionType2 { message ComplexOptionType4 { extend
        # google.protobuf.MessageOptions { optional ComplexOptionType4
        # complex_opt4 = 7633546; } } }`,
        #
        #   proto2_unittest.ComplexOptionType2.ComplexOptionType4:
        #       extension complex_opt4 -> .proto2_unittest.ComplexOptionType2.ComplexOptionType4
        #
        # and the pre-fix analyzer emitted `proto2_unittest.ComplexOptionType4`,
        # which protoc does not define anywhere. So the oracle could not see the
        # disagreement it existed to find.
        for ext in msg.extension:
            if ext.type in GROUPED_OR_MESSAGE and ext.type_name:
                out.append((ext.extendee.lstrip("."), row_name(ext), ("field", ext.type_name), None))
        # map entries first: a map field's declared type is its entry message
        entries: dict[str, str] = {}
        for nested in msg.nested_type:
            if nested.options.map_entry:
                value_type = ""
                for f in nested.field:
                    if f.name == "value" and f.type_name:
                        value_type = f.type_name
                entries[f"{full}.{nested.name}"] = value_type
        for f in msg.field:
            if f.type in GROUPED_OR_MESSAGE and f.type_name:
                # `type_name` carries a LEADING DOT (`.pkg.Msg.Entry`); the entry
                # table is keyed without one. Comparing them directly matches
                # nothing and every map field reads as a plain message field.
                is_map = f.type_name.lstrip(".") in entries
                out.append(
                    (full, row_name(f), ("field", f.type_name), entries.get(f.type_name.lstrip(".")) if is_map else None)
                )
        for nested in msg.nested_type:
            walk(nested, full)

    for msg in fdp.message_type:
        walk(msg, fdp.package)

    # AN RPC'S REQUEST AND RESPONSE ARE NOT FIELDS, and leaving them out put 3,635
    # of the corpus's `uses` edges in NOT-A-TYPE — the single largest unjudged
    # class, and one this analyzer really does emit (`metadata.role` of
    # `rpcRequest` / `rpcResponse`). protoc stores them on the METHOD, as
    # `input_type` and `output_type`, so walking fields alone cannot see them.
    #
    # They are emitted as a PAIR under one source id, which is why they are
    # compared as a SET rather than pairwise: the analyzer writes request before
    # response and protoc stores input before output, but keying on that order
    # would make the oracle agree with the analyzer by construction rather than by
    # evidence. Two edges against two rows, compared without regard to order,
    # cannot be satisfied by a coincidence of ordering.
    for svc in fdp.service:
        sfull = f"{fdp.package}.{svc.name}" if fdp.package else svc.name
        for meth in svc.method:
            out.append((sfull, meth.name, ("method", meth.input_type, meth.output_type), None))

    # EXTENSIONS LIVE SOMEWHERE ELSE, and missing them made this oracle blind to
    # the exact case it was built for. protoc does not put an `extend` block's
    # members in the extended message's `field` list — they go in the FILE's
    # top-level `extension` list, each carrying an `extendee` naming the type it
    # extends. Walking only `message_type[].field` therefore skipped every
    # extension field in the corpus (3,766 edges landing in NOT-A-TYPE), and since
    # a nested `extend` reference can only occur inside an `extend` block, the
    # oracle reported the pre-fix and post-fix analyzers as IDENTICALLY correct
    # when they differ on 6 edges. Verified by hand against
    # `unittest_delimited.proto`: `TestDelimited` reports one `lengthprefixed`
    # field, the in-message one, and the `extend TestDelimited { … = 1004; }`
    # member is absent from it entirely.
    #
    # The key is `<extendee without leading dot>.<name>`, which is the id the
    # analyzer publishes for an extension member: the block's members belong to
    # the EXTENDED TYPE, and `ownerName` is set to it.
    for ext in fdp.extension:
        if ext.type in GROUPED_OR_MESSAGE and ext.type_name:
            out.append((ext.extendee.lstrip("."), row_name(ext), ("field", ext.type_name), None))
    return out


def all_proto_dirs(corpus_root: str) -> list[str]:
    """Every directory in the corpus, for use as a candidate include root.

    NOT "every directory that directly holds a .proto" — that filter was tried and
    it drops precisely the directories that matter. A vendored dependency is
    normally reached through a subdirectory:
    `docker/vendor/github.com/gogo/protobuf/` holds no `.proto` of its own, but
    `gogoproto/gogo.proto` inside it is what a file imports as
    `gogoproto/gogo.proto`, so that directory IS an include root. Filtering on
    "holds a .proto directly" reported 48 files as importing a
    `google/api/field_behavior.proto` that is sitting right there in `pb-googleapis`.

    So every directory is a candidate and membership is decided by the import path
    itself, in `find_dirs_providing`. Walking the tree is a DISCOVERY step, not a
    parse; the task forbids regex over source text, not a filesystem walk.

    Sorted so the list is reproducible run to run.
    """
    found: list[str] = []
    stack = [corpus_root]
    while stack:
        d = stack.pop()
        try:
            entries = sorted(os.listdir(d))
        except OSError:
            continue
        found.append(d)
        for e in entries:
            if e == ".git":
                continue
            p = os.path.join(d, e)
            if os.path.isdir(p) and not os.path.islink(p):
                stack.append(p)
    return sorted(found)


def include_roots(abs_path: str, corpus_root: str, bundled: str | None, proto_dirs: list[str]) -> list[str]:
    """
    The file's own ancestor directories, nearest first; then every directory in
    the corpus that holds a schema; then the bundled well-known types, last.

    protobuf resolves an `import "..."` against the `-I` roots it is given, and
    this corpus is a set of real repositories that do not share one layout:
    `pb-grpc` keeps its schemas under `src/proto/`, `boundary` under
    `internal/proto/`, and a `boundary` file imports
    `protoc-gen-openapiv2/options/annotations.proto` from a path vendored three
    directories deep inside docker. A `boundary` file also imports
    `google/api/field_behavior.proto`, which only `pb-googleapis` publishes.

    ORDER IS THE POINT and it is deliberate. A file's own ancestors come first, so
    a repository's own copy of a vendored file wins over another repository's:
    `descriptor.proto` is vendored into four of these repositories, and if the
    oracle silently preferred another repository's copy it would be adjudicating
    against a schema the file never read. The bundled well-known types come last
    so they only supply what no repository in the corpus provides.

    This is also the precise reason a per-file analyzer cannot close the
    resolution gap the lane reports: include roots are a project-level fact, and
    `protoc` is handed them on the command line.
    """
    roots: list[str] = []
    cur = os.path.dirname(abs_path)
    stop = os.path.dirname(corpus_root.rstrip("/"))
    while True:
        if cur not in roots:
            roots.append(cur)
        if cur == stop or cur == "/" or len(cur) <= len(stop):
            break
        nxt = os.path.dirname(cur)
        if nxt == cur:
            break
        cur = nxt
    for d in proto_dirs:
        if d not in roots:
            roots.append(d)
    if bundled:
        roots.append(bundled)
    return roots


def _holds_protos(d: str, depth: int = 0) -> bool:
    """True if `d` contains a .proto file within a few levels. Bounded so a deep
    repository tree cannot make the include-root scan itself expensive."""
    if depth > 3:
        return False
    try:
        entries = os.listdir(d)
    except OSError:
        return False
    for e in entries:
        if e == ".git":
            continue
        p = os.path.join(d, e)
        if os.path.isfile(p) and e.endswith(".proto"):
            return True
        if os.path.isdir(p) and _holds_protos(p, depth + 1):
            return True
    return False


def find_dirs_providing(import_path: str, proto_dirs: list[str]) -> list[str]:
    """Every corpus directory from which `import_path` resolves.

    `proto_dirs` is every directory in the corpus, so this is a `stat` per
    candidate against a path protoc itself named.
    """
    out = []
    for d in proto_dirs:
        if os.path.isfile(os.path.join(d, import_path)):
            out.append(d)
    return out


def resolve(path: str, rel: str, roots: list[str], proto_dirs: list[str], corpus_root: str, protoc_cmd: list[str]):
    """
    Compile one file and return {field full name -> protoc's resolved type_name}.

    INCLUDE ROOTS ARE DISCOVERED, NOT GUESSED. protoc resolves an import against
    the `-I` list it is handed, and this corpus has no layout a fixed list
    covers: a `boundary` file imports `google/api/field_behavior.proto` (only
    `pb-googleapis` publishes it) and `protoc-gen-openapiv2/options/annotations.proto`
    (vendored three directories deep inside docker). Handing protoc all 611
    directories that hold a schema was tried and made the result WORSE — 542 files
    compiled against 570 with repository roots alone — because protoc takes the
    FIRST root that provides a path, and `descriptor.proto` is vendored into four
    repositories here, so a broad list silently adjudicates some files against a
    schema they never read.

    So the roots are a FIXPOINT. Start from the file's own ancestors, run protoc,
    and when protoc says `<import>: File not found`, resolve that import to the
    directory that provides it and retry. The missing import is named by the tool
    being adjudicated, which is the only source here that knows what it needs.

    When more than one directory provides the import, the one inside the SAME
    top-level repository as the importing file wins — that is the copy the file
    actually reads, and picking another repository's is the failure mode above.
    If the same repository provides it twice the choice is arbitrary and is
    recorded, not hidden.

    Returns (mapping, status, roots_used, ambiguous_choices). `status` is `ok` or a reason string.
    """
    use = list(roots)
    repo_of_file = rel.split(os.sep)[0]
    ambiguous: list[str] = []
    for _attempt in range(12):
        with tempfile.TemporaryDirectory() as td:
            out = os.path.join(td, "ds.pb")
            cmd = list(protoc_cmd) + [f"--descriptor_set_out={out}"]
            for inc in use:
                cmd.append(f"--proto_path={inc}")
            cmd.append(rel)
            try:
                proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            except subprocess.TimeoutExpired:
                return {}, "protoc timed out", use, ambiguous
            if proc.returncode == 0 and os.path.exists(out):
                fds = descriptor_pb2.FileDescriptorSet()
                with open(out, "rb") as fh:
                    fds.ParseFromString(fh.read())
                want = os.path.basename(path)
                for fdp in fds.file:
                    if os.path.basename(fdp.name) == want:
                        # key by "<message full name>.<field name>"; the analyzer's
                        # source id is the FIELD's owner-qualified id, so the key is
                        # built the same way from the descriptor rather than parsed
                        # out of the id.
                        grouped: dict[str, list] = collections.defaultdict(list)
                        for owner, name, t, mv in field_entries(fdp):
                            # Normalise to (kind, type_name, map_value) so every row
                            # unpacks the same way. An rpc's row carries BOTH its
                            # request and response in `type_name`, tagged "method".
                            if t[0] == "method":
                                grouped[f"{owner}.{name}"].append(("method", (t[1], t[2]), None))
                            else:
                                grouped[f"{owner}.{name}"].append(("field", t[1], mv))
                        return dict(grouped), "ok", use, ambiguous
                return {}, "file not present in descriptor set", use, ambiguous
            stderr = proc.stderr.strip()

        missing = _missing_import(stderr)
        if missing is None:
            return {}, stderr, use, ambiguous
        candidates = find_dirs_providing(missing, proto_dirs)
        if not candidates:
            return {}, f"no directory in the corpus provides {missing}", use, ambiguous
        same_repo = [c for c in candidates if c.split(os.sep)[len(corpus_root.split(os.sep))] == repo_of_file]
        pool = same_repo or candidates
        if len(pool) > 1:
            ambiguous.append(f"{missing} -> {len(pool)} candidates")
        pick = sorted(pool)[0]
        if pick in use:
            return {}, stderr, use, ambiguous
        use.append(pick)
    return {}, "gave up after 12 include-root rounds", use, ambiguous


def _missing_import(stderr: str) -> str | None:
    """The import path protoc could not find, or None.

    protoc's line is `<import path>: File not found.` — the import path is the
    thing before the colon, so this is a read of protoc's own diagnostic rather
    than a pattern matched against schema source.
    """
    for line in stderr.splitlines():
        line = line.strip()
        if line.endswith(": File not found."):
            candidate = line[: -len(": File not found.")].strip()
            if candidate.endswith(".proto"):
                return candidate
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tsv", required=True, help="dump-uses-targets.mts output")
    ap.add_argument("--corpus", default=os.environ.get("BB_CORPUS_ROOT", "/home/ishaq2321/bb_tests/repositories"))
    ap.add_argument("--out", default="/tmp/opencode/pb/protoc-oracle.json")
    ap.add_argument(
        "--protoc",
        default=os.environ.get("PB_PROTOC", ""),
        help="path to a protoc binary. Defaults to the one bundled with grpc_tools. "
        "The bundled build is libprotoc 35.1, which REJECTS edition 2026 files "
        "('Edition 2026 is later than the maximum supported edition 2024'); 16 corpus "
        "files declare that edition, including every file carrying a nested-extend "
        "reference, so a 35.1 oracle silently cannot adjudicate them.",
    )
    args = ap.parse_args()

    if args.protoc:
        protoc_cmd = [args.protoc]
        version = subprocess.run([args.protoc, "--version"], capture_output=True, text=True).stdout.strip()
        if not version:
            raise SystemExit(f"--protoc {args.protoc} did not report a version")
    else:
        protoc_cmd = [sys.executable, "-m", "grpc_tools.protoc"]
        version = "libprotoc (grpc_tools bundled build)"
    print(f"oracle: {version}")
    inc = bundled_include()
    proto_dirs = all_proto_dirs(args.corpus)
    print(f"candidate include roots: {len(proto_dirs)} directories in the corpus")
    bundled_wkt = inc or "(none)"

    by_file: dict[str, list[tuple[str, str, str, str]]] = collections.defaultdict(list)
    with open(args.tsv) as fh:
        for line in fh:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 4:
                continue
            rel, src, tgt, flags = parts[0], parts[1], parts[2], parts[3]
            # The occurrence marker `#n` is DROPPED here and the disambiguating
            # `#property` suffix is stripped, because both name the same field and
            # protoc's descriptor has no idea this analyzer invented a suffix.
            # Stripping is safe: `#` cannot occur in a protobuf identifier
            # ([A-Za-z_][A-Za-z0-9_]*), so no real field name can be affected.
            src = src.split("#")[0]
            by_file[rel].append((rel, src, tgt, flags))

    totals = collections.Counter()
    ambiguous_choices: list[str] = []
    disagreements: list[dict] = []
    failed_files: dict[str, str] = {}
    files_ok = 0

    for rel in sorted(by_file):
        abs_path = os.path.join(args.corpus, rel)
        if not os.path.exists(abs_path):
            totals["file-missing-on-disk"] += 1
            continue
        mapping, status, _used, amb = resolve(
            abs_path, rel, include_roots(abs_path, args.corpus, inc, []), proto_dirs, args.corpus, protoc_cmd
        )
        if status != "ok":
            failed_files[rel] = status.splitlines()[0] if status else "unknown"
            for _, src, tgt, _f in by_file[rel]:
                totals["UNRESOLVED-file-did-not-compile"] += 1
                disagreements.append({"file": rel, "source": src, "emitted": tgt, "verdict": "UNRESOLVED-file-did-not-compile"})
            continue
        files_ok += 1
        ambiguous_choices.extend(amb)

        # AN EDGE IS JUDGED ONLY WHEN THE PAIRING IS 1:1, AND THAT GUARD IS THE
        # POINT. Two declarations can share one owner-qualified name on BOTH
        # sides, and then a verdict would be a guess:
        #
        #   message TestDelimited { LengthPrefixed lengthprefixed = 1; }
        #   extend TestDelimited  { LengthPrefixed lengthprefixed = 1004; }
        #
        # protoc reports the first in `TestDelimited.field` and the second in the
        # FILE's `extension` list, so the oracle's own key `<owner>.<name>` holds
        # two entries — and the analyzer publishes two ids differing only by a
        # `#property` suffix. Comparing them pairwise by dict order produced a
        # WRONG-NAME verdict against whichever row happened to land last, and it
        # did so identically for the pre-fix and post-fix analyzer, which is how a
        # real disagreement stayed invisible.
        #
        # So: when either side holds more than one row for a key, every edge on
        # that key is reported INDISTINCTUISHABLE and excluded from the rate. An
        # unjudged edge is reported; a wrongly judged one is a lie.
        edges_by_key: dict[str, list[str]] = collections.defaultdict(list)
        for _, src, tgt, _f in by_file[rel]:
            edges_by_key[src].append(tgt)

        for key, tgts in edges_by_key.items():
            rows_for_key = mapping.get(key)
            if rows_for_key is None:
                for tgt in tgts:
                    totals["NOT-A-TYPE"] += 1
                    disagreements.append({
                        "file": rel, "source": key, "emitted": tgt,
                        "verdict": "NOT-A-TYPE-protoc-published-no-message-type-for-this-field",
                    })
                continue
            kinds = {r[0] for r in rows_for_key}
            # One method RECORD holds both types, and the analyzer emits two edges
            # under one source id, so the counts are 1 row against 2 edges — the
            # condition is the shape (a method key, a request/response pair), not
            # equal counts.
            if kinds == {"method"} and len(tgts) == 2:
                # an rpc's request/response pair: compare as sets, order-free
                want_set = {x.lstrip(".") for r in rows_for_key for x in r[1]}
                got_set = set(tgts)
                totals["RPC-PAIR"] += len(tgts)
                if want_set == got_set:
                    totals["AGREE"] += len(tgts)
                else:
                    totals["WRONG-NAME"] += len(tgts)
                    for tgt in tgts:
                        disagreements.append({
                            "file": rel, "source": key, "emitted": tgt,
                            "protocRequestOrResponse": sorted(want_set),
                            "shape": "rpc-request-response-set", "verdict": "WRONG-NAME",
                        })
                continue
            if len(rows_for_key) > 1 or len(tgts) > 1:
                totals["INDISTINCTUISHABLE"] += len(tgts)
                for tgt in tgts:
                    disagreements.append({
                        "file": rel, "source": key, "emitted": tgt,
                        "protocRows": len(rows_for_key), "analyzerEdges": len(tgts),
                        "verdict": "INDISTINCTUISHABLE-more-than-one-declaration-on-one-key",
                    })
                continue
            _kind, declared, map_value = rows_for_key[0]
            tgt = tgts[0]
            if map_value is not None:
                totals["MAP-FIELD"] += 1
                want = map_value.lstrip(".")
                declared_name = declared.lstrip(".")
            else:
                want = declared.lstrip(".")
            if want == tgt:
                totals["AGREE"] += 1
            else:
                totals["WRONG-NAME"] += 1
                shape = "unknown"
                if tgt.endswith("." + want) or want.endswith("." + tgt):
                    shape = "one-is-suffix-of-other"
                elif tgt.split(".")[-1] == want.split(".")[-1]:
                    shape = "same-leaf-different-package"
                disagreements.append({
                    "file": rel, "source": key, "emitted": tgt, "protoc": want,
                    "shape": shape, "verdict": "WRONG-NAME",
                })

    judged = totals["AGREE"] + totals["WRONG-NAME"]
    rate = (totals["AGREE"] / judged * 100) if judged else 0.0

    print(f"corpus files with uses edges : {len(by_file)}")
    print(f"  compiled by protoc        : {files_ok}")
    print(f"  protoc REJECTED            : {len(failed_files)}")
    print(f"  absent from disk           : {totals['file-missing-on-disk']}")
    print(f"\njudged edges                : {judged}")
    print(f"  AGREE                     : {totals['AGREE']}")
    print(f"  WRONG-NAME                : {totals['WRONG-NAME']}")
    print(f"  of which MAP fields       : {totals['MAP-FIELD']} (compared on the entry's VALUE type)")
    print(f"  of which rpc req/resp     : {totals['RPC-PAIR']} (compared as an unordered pair)")
    print(f"  NOT-A-TYPE (excluded)     : {totals['NOT-A-TYPE']}")
    print(f"  INDISTINCTUISHABLE (excl.) : {totals['INDISTINCTUISHABLE']}")
    print(f"  UNRESOLVED (no compile)    : {totals['UNRESOLVED-file-did-not-compile']}")
    print(f"\nAGREE rate over judged edges: {rate:.3f}%")

    print(f"\ninclude-root choices that were ambiguous (first candidate taken, recorded not hidden): {len(ambiguous_choices)}")
    for amb in ambiguous_choices[:15]:
        print(f"  {amb}")

    if failed_files:
        # A histogram, because "protoc rejected 136 files" is a number a reader
        # cannot act on and "54 of them are one missing include root" is. Each
        # bucket is the FIRST line of protoc's own message, which is the line that
        # names the cause.
        buckets = collections.Counter()
        for _rel, err in failed_files.items():
            head = err.splitlines()[0] if err else "unknown"
            # strip the file:line:col prefix protoc prepends, keep the reason
            if ": " in head:
                head = head.split(": ", 1)[1]
            buckets[head.strip()] += 1
        print(f"\nwhy protoc rejected them, by first line of its own message:")
        for reason, n in buckets.most_common(20):
            print(f"  {str(n).rjust(4)}  {reason[:150]}")
        print(f"\nfiles protoc rejected ({len(failed_files)}), first 15:")
        for rel, err in sorted(failed_files.items())[:15]:
            print(f"  {rel}\n      {err}")

    if disagreements:
        print(f"\n--- every disagreement ({len(disagreements)}) ---")
        for d in disagreements[:200]:
            if d["verdict"] == "WRONG-NAME":
                print(f"  {d['file']}\n      {d['source']}\n      emitted {d['emitted']}\n      protoc  {d['protoc']}")
            else:
                print(f"  {d['file']} :: {d['source']}  emitted {d['emitted']}  ({d['verdict']})")

    with open(args.out, "w") as fh:
        json.dump(
            {
                "protocVersion": version,
                "bundledWellKnownTypes": bundled_wkt,
                "corpusFilesWithUsesEdges": len(by_file),
                "filesCompiledByProtoc": files_ok,
                "filesRejectedByProtoc": len(failed_files),
                "rejectedExamples": dict(list(sorted(failed_files.items()))[:60]),
                "judged": judged,
                "agree": totals["AGREE"],
                "wrongName": totals["WRONG-NAME"],
                "mapFields": totals["MAP-FIELD"],
                "rpcRequestResponsePairs": totals["RPC-PAIR"],
                "notAType": totals["NOT-A-TYPE"],
                "indistinguishable": totals["INDISTINCTUISHABLE"],
                "unresolvedNoCompile": totals["UNRESOLVED-file-did-not-compile"],
                "agreeRateOverJudged": rate,
                "ambiguousRootChoices": ambiguous_choices,
                "disagreements": disagreements,
            },
            fh,
            indent=2,
        )
    print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
