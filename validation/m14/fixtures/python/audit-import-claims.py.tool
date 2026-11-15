#!/usr/bin/env python3
"""INDEPENDENT AUDIT OF THE IMPORT-EVIDENCE CLAIMS — CPython's `ast` re-derives the evidence.

WHY. `certifyImportEvidenceClaims` rests on a pre-pass the analyzer wrote and the analyzer reads;
the arbiter can only verify the PROJECT key space, not the file's import. This audit re-derives the
file-level facts with the interpreter's OWN parser and asks the claims back:

  1  ROUTE/TARGET IS IMPORTED   the claimed name (the target, or the root of its written route) is
                                 bound by a MODULE-LEVEL, non-relative, non-`__future__` import of
                                 this file — read from CPython's `ast`, not from the analyzer.
  2  SPECIFIER MATCHES          the module recorded on the edge (`externalSpecifier`) is the module
                                 that import binds the name from.
  3  NOT DECLARED IN FILE       the target is not a def/class/assignment name this file declares.
  4  NOT SHADOWED AT THE LINE   the name is not bound by a def/lambda/comprehension scope that
                                 CONTAINS the edge's line (python's LEGB rule, positionally).

WHAT A VIOLATION WOULD MEAN. A claim the analyzer published where CPython says the evidence is not
there — the false-statement direction the programme treats as the one outcome a gate must catch.
The audit is GENEROUS on purpose: `declared` counts assignment targets at any depth, so a name it
still calls a violation is not a borderline case.

Usage: python3 audit-import-claims.py <claims.tsv> [--max-report N]
The TSV is `import-claim-rows.mts --out`: file:line, type, source, target, route, reason,
specifier, source-line.
"""
import ast
import collections
import os
import sys

MAX_REPORT = 10
args = sys.argv[1:]
if not args:
    sys.exit("usage: audit-import-claims.py <claims.tsv> [--max-report N]")
path = args[0]
ROOT = os.environ.get("BB_CORPUS_ROOT", "/home/ishaq2321/bb_tests/repositories")
if "--root" in args:
    ROOT = args[args.index("--root") + 1]
if "--max-report" in args:
    MAX_REPORT = int(args[args.index("--max-report") + 1])

rows = []
with open(path, encoding="utf-8") as fh:
    for line in fh:
        if not line.strip():
            continue
        parts = line.rstrip("\n").split("\t")
        if len(parts) < 7:
            continue
        loc = parts[0]
        cut = loc.rfind(":")
        rows.append({
            "file": loc[:cut], "line": int(loc[cut + 1:] or 0), "type": parts[1],
            "source": parts[2], "target": parts[3], "route": parts[4],
            "reason": parts[5], "specifier": parts[6],
        })

FUNC = (ast.FunctionDef, ast.AsyncFunctionDef)
SCOPES = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)
COMP = (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)


def module_imports(tree):
    """bound name -> module string, for MODULE-LEVEL imports only (the analyzer's rule)."""
    out = {}
    stmts = list(tree.body)
    stack = list(stmts)
    while stack:
        s = stack.pop()
        if isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            continue
        if isinstance(s, ast.Import):
            for a in s.names:
                bound = a.asname or a.name.split(".")[0]
                out.setdefault(bound, a.name)
        elif isinstance(s, ast.ImportFrom):
            if (s.level or 0) > 0 or (s.module or "") == "__future__":
                continue
            for a in s.names:
                if a.name == "*":
                    continue
                out.setdefault(a.asname or a.name, s.module or "")
        for field in ("body", "orelse", "finalbody"):
            if hasattr(s, field):
                stack.extend(getattr(s, field))
        if isinstance(s, ast.Try):
            stack.extend(s.handlers)
    return out


def target_names(t, into):
    if isinstance(t, ast.Name):
        into.add(t.id)
    elif isinstance(t, (ast.Tuple, ast.List)):
        for e in t.elts:
            target_names(e, into)
    elif isinstance(t, ast.Starred):
        target_names(t.value, into)


def scope_info(node):
    """(start, end, bound names) for one lexical scope node."""
    start = getattr(node, "lineno", 1)
    end = getattr(node, "end_lineno", start) or start
    names = set()
    jumps = set()
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
        a = node.args
        for arg in list(getattr(a, "posonlyargs", [])) + list(a.args) + list(a.kwonlyargs):
            names.add(arg.arg)
        if a.vararg:
            names.add(a.vararg.arg)
        if a.kwarg:
            names.add(a.kwarg.arg)
        body = node.body if isinstance(node.body, list) else [node.body]
        stack = list(body)
        while stack:
            s = stack.pop()
            if isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                names.add(s.name)
                continue
            if isinstance(s, (ast.Lambda,) + COMP):
                continue
            if isinstance(s, ast.Global):
                jumps.update(s.names)
            if isinstance(s, ast.Nonlocal):
                jumps.update(s.names)
            if isinstance(s, ast.Import):
                for al in s.names:
                    names.add(al.asname or al.name.split(".")[0])
            if isinstance(s, ast.ImportFrom):
                for al in s.names:
                    if al.name != "*":
                        names.add(al.asname or al.name)
            if isinstance(s, ast.Assign):
                for t in s.targets:
                    target_names(t, names)
            if isinstance(s, (ast.AnnAssign, ast.AugAssign)):
                target_names(s.target, names)
            if isinstance(s, ast.NamedExpr):
                target_names(s.target, names)
            if isinstance(s, (ast.For, ast.AsyncFor)):
                target_names(s.target, names)
            if isinstance(s, (ast.With, ast.AsyncWith)):
                for item in s.items:
                    if item.optional_vars is not None:
                        target_names(item.optional_vars, names)
            if isinstance(s, ast.Try):
                for h in s.handlers:
                    if h.name:
                        names.add(h.name)
            for field in ("body", "orelse", "finalbody"):
                if hasattr(s, field):
                    stack.extend(getattr(s, field))
    elif isinstance(node, ast.ClassDef):
        # class body bindings do not shadow module names inside methods, but the class NAME does
        names.add(node.name)
        return start, end, names
    elif isinstance(node, COMP):
        for gen in node.generators:
            target_names(gen.target, names)
    return start, end, names - jumps


def declared_names(tree):
    """Generous: every def/class name anywhere, every assignment/for/with/except target."""
    declared = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            declared.add(node.name)
        if isinstance(node, ast.Assign):
            for t in node.targets:
                target_names(t, declared)
        if isinstance(node, (ast.AnnAssign, ast.AugAssign)):
            target_names(node.target, declared)
        if isinstance(node, (ast.For, ast.AsyncFor)):
            target_names(node.target, declared)
        if isinstance(node, (ast.With, ast.AsyncWith)):
            for item in node.items:
                if item.optional_vars is not None:
                    target_names(item.optional_vars, declared)
        if isinstance(node, ast.Try):
            for h in node.handlers:
                if h.name:
                    declared.add(h.name)
        if isinstance(node, ast.NamedExpr):
            target_names(node.target, declared)
    declared.discard("")
    return declared


violations = collections.Counter()
samples = collections.defaultdict(list)
audited = 0
files = {}
cache = {}
scopes_cache = {}
for r in rows:
    fn = r["file"]
    if fn not in cache:
        try:
            with open(os.path.join(ROOT, fn), encoding="utf-8") as fh:
                src = fh.read()
            tree = ast.parse(src)
            cache[fn] = (module_imports(tree), declared_names(tree))
            scopes = []
            for node in ast.walk(tree):
                if isinstance(node, SCOPES + COMP):
                    scopes.append(scope_info(node))
            scopes_cache[fn] = scopes
        except Exception as e:  # noqa: BLE001 - a file that cannot be parsed is reported, not skipped
            cache[fn] = None
            scopes_cache[fn] = []
    facts = cache[fn]
    if facts is None:
        violations["file-not-parseable"] += 1
        continue
    imports, declared = facts
    scopes = scopes_cache[fn]
    route = r["route"]
    name = route.split(".")[0] if "." in route else r["target"]
    audited += 1
    if name not in imports:
        violations["name-not-imported"] += 1
        if len(samples["name-not-imported"]) < MAX_REPORT:
            samples["name-not-imported"].append(f"{fn}:{r['line']} {r['type']} {r['source']} -> {r['target']} route={route}")
        continue
    if imports[name] != r["specifier"]:
        violations["specifier-mismatch"] += 1
        if len(samples["specifier-mismatch"]) < MAX_REPORT:
            samples["specifier-mismatch"].append(f"{fn}:{r['line']} name={name} claimed={r['specifier']} ast={imports[name]}")
    if r["target"] in declared:
        violations["target-declared-in-file"] += 1
        if len(samples["target-declared-in-file"]) < MAX_REPORT:
            samples["target-declared-in-file"].append(f"{fn}:{r['line']} {r['type']} -> {r['target']}")
    line = r["line"]
    if any(start <= line <= end and name in names for start, end, names in scopes):
        violations["shadowed-at-line"] += 1
        if len(samples["shadowed-at-line"]) < MAX_REPORT:
            samples["shadowed-at-line"].append(f"{fn}:{line} name={name}")

print(f"audit — {len(rows)} claimed edges across {len(cache)} files; {audited} checked against CPython's ast")
for k, v in violations.most_common():
    print(f"  VIOLATION {k}: {v}")
    for s in samples[k]:
        print(f"      {s}")
if not violations:
    print("  0 violations: every claim's name is module-imported, the specifier matches CPython's import,")
    print("  the target is not declared in the file, and the name is not a local at the edge line.")
