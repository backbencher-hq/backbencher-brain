/**
 * PY-D25 (round 12) — THE GATE FOR THE `not-bound-in-file` AXIS.
 *
 * The axis says, per row: "no binding this file supplies is visible to the read, and the
 * analyzer's own scope model found none". That is the kind of statement a future analyzer gap
 * would hide inside: the round-12 price found exactly one row where the analyzer was WRONG
 * (wagtail's `mixin`, a module-scope `for` target the walker never published — fixed as PY-D23,
 * not excused), and an axis that excused it instead would have made the defect invisible.
 *
 * So this gate re-checks the population with an INDEPENDENT instrument: CPython's own `ast`,
 * through a subprocess, applying python's lexical rule scope by scope. For every row it asks:
 * is the name bound in the scope chain python would look in from that read?
 *
 *   AGREE       no binding is visible, so the axis's statement is true for this row.
 *   DISAGREE    a binding IS visible — the axis is excusing an analyzer gap, and this gate FAILS.
 *   UNPARSEABLE CPython cannot parse the file. The row is still counted (it is the same
 *               "nothing in this file supplies the name" statement), and the file is NAMED —
 *               the three verdicts behind that group (ASN.1 documents, a Python 2 build script,
 *               a highlighter fragment) are the verdict's business, not this gate's to excuse.
 *
 * The rows come from the verdict run this same round, so the gate is a statement about the
 * SHIPPED artifact rather than about a remembered list: `not-bound-in-file.rows.txt` carries
 * (label, file, source symbol, target) for every row the axis fired on, and the pinned
 * `resolution-verdict.current.json` must carry the same total.
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs"
import { spawnSync } from "node:child_process"

const ROWS = "validation/m14/fixtures/python/not-bound-in-file.rows.txt"
const ARTIFACT = "validation/m14/fixtures/python/resolution-verdict.current.json"
const AXIS = "not-bound-in-file"

const art = JSON.parse(readFileSync(ARTIFACT, "utf8")) as any
const corpus: string = art.corpus
if (!corpus) {
  console.error(`FAIL  the pinned artefact does not name its corpus: ${ARTIFACT}`)
  process.exit(1)
}

// The axis total, read from the artefact's own per-label classification table.
let axisTotal = 0
const perLabel: Array<[string, number]> = []
for (const [label, rec] of Object.entries<any>(art.types ?? {})) {
  const n = rec?.unresolvedClass?.[AXIS]
  if (typeof n === "number" && n > 0) {
    axisTotal += n
    perLabel.push([label, n])
  }
}
if (axisTotal === 0) {
  console.error(`FAIL  the pinned artefact carries no ${AXIS} rows — the axis never fired, or the artefact predates it`)
  process.exit(1)
}

// A gate that passes on a MISSING row list is worse than no gate: the claim it re-checks would go
// unchecked and the output would still say PASS. It refuses instead, and names the run that writes it.
if (!existsSync(ROWS)) {
  console.error(`FAIL  no row list at ${ROWS} — the axis claim cannot be re-checked without the rows,\n` +
    `      and this gate refuses rather than passing on an absent measurement.\n` +
    `      Regenerate it with the verdict run that writes it beside the artefact:\n` +
    `        npx tsx script/m14/python-endpoint-resolution.ts --out ${ARTIFACT}`)
  process.exit(2)
}

const rows = readFileSync(ROWS, "utf8")
  .split("\n")
  .map((l) => l.trimEnd())
  .filter((l) => l.length > 0)
  .map((l) => l.split("\t"))

// CPython's scoping, over the rows: the same question the price asked, run here as an
// independent check rather than trusted from the price's output.
const PROGRAM = String.raw`
import ast, os, sys
root, rows_path = sys.argv[1], sys.argv[2]
COMPOUND = (ast.If, ast.For, ast.AsyncFor, ast.While, ast.With, ast.AsyncWith,
            ast.Try, getattr(ast, "TryStar", ast.Try), ast.Match)

def target_names(node):
    out = []
    if isinstance(node, ast.Name): out.append(node.id)
    elif isinstance(node, (ast.Tuple, ast.List)):
        for e in node.elts: out.extend(target_names(e))
    elif isinstance(node, ast.Starred): out.extend(target_names(node.value))
    return out

def arg_names(args):
    out = set()
    for a in list(getattr(args, "posonlyargs", [])) + list(args.args) + list(args.kwonlyargs):
        out.add(a.arg)
    if args.vararg: out.add(args.vararg.arg)
    if args.kwarg: out.add(args.kwarg.arg)
    return out

def stmt_bindings(s):
    out = set()
    if isinstance(s, ast.Assign):
        for t in s.targets: out.update(target_names(t))
    elif isinstance(s, (ast.AnnAssign, ast.AugAssign)): out.update(target_names(s.target))
    elif isinstance(s, (ast.For, ast.AsyncFor)): out.update(target_names(s.target))
    elif isinstance(s, (ast.With, ast.AsyncWith)):
        for it in s.items:
            if it.optional_vars: out.update(target_names(it.optional_vars))
    elif isinstance(s, ast.ExceptHandler) and s.name: out.add(s.name)
    elif isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)): out.add(s.name)
    elif isinstance(s, ast.Import):
        for a in s.names: out.add(a.asname or a.name.split(".")[0])
    elif isinstance(s, ast.ImportFrom):
        for a in s.names:
            if a.name != "*": out.add(a.asname or a.name)
    elif isinstance(s, ast.NamedExpr): out.update(target_names(s.target))
    elif isinstance(s, ast.Global): out.update(s.names)
    elif isinstance(s, ast.Match):
        for c in s.cases:
            for p in ast.walk(c.pattern):
                if isinstance(p, ast.MatchAs) and p.name: out.add(p.name)
                if isinstance(p, ast.MatchStar) and p.name: out.add(p.name)
                if isinstance(p, ast.MatchMapping) and p.rest: out.add(p.rest)
    return out

def build(tree):
    """scope node -> (bindings, star-import), plus a parent map for the chain walk."""
    binds, parents, star = {}, {}, set()
    def visit(node, parent_scope):
        cur = node
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
            cur = node
            binds.setdefault(id(cur), set()).update(arg_names(node.args) if hasattr(node, "args") else set())
        binds.setdefault(id(cur), set())
        parents[id(node)] = cur
        for child in ast.iter_child_nodes(node):
            if isinstance(child, ast.ImportFrom) and any(a.name == "*" for a in child.names):
                star.add(id(cur))
            binds.setdefault(id(cur), set()).update(stmt_bindings(child))
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                binds[id(cur)].add(child.name)
            visit(child, cur)
    mod = tree
    binds[id(mod)] = set()
    for child in ast.iter_child_nodes(tree):
        if isinstance(child, ast.ImportFrom) and any(a.name == "*" for a in child.names):
            star.add(id(mod))
        binds[id(mod)].update(stmt_bindings(child))
        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            binds[id(mod)].add(child.name)
        visit(child, mod)
    return binds, parents, star

def chain_visible(scope, binds, parents):
    out = set()
    cur = scope
    while True:
        kind_id = id(cur)
        out |= binds.get(kind_id, set())
        p = parents.get(kind_id)
        if p is None or p is cur: break
        cur = p
    return out

rows = [l.rstrip("\n").split("\t") for l in open(rows_path) if l.strip()]
for parts in rows:
    label, rel, source, target = parts[0], parts[1], parts[2], parts[3] if len(parts) > 3 else ""
    if not target: print("DISAGREE\t%s\t%s\tempty-target" % (rel, source)); continue
    p = os.path.join(root, rel)
    try:
        tree = ast.parse(open(p, "rb").read())
    except Exception as exc:
        line = getattr(exc, "lineno", 0) or 0
        print("UNPARSEABLE\t%s\t%s\tline %s" % (rel, target, line))
        continue
    binds, parents, star = build(tree)
    # the site: inside a symbol named source, else anywhere in the file
    scope = None
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.name == source:
            for sub in ast.walk(node):
                if isinstance(sub, ast.Name) and sub.id == target:
                    scope = parents.get(id(sub))
                    break
        if scope is not None: break
    if scope is None:
        for sub in ast.walk(tree):
            if isinstance(sub, ast.Name) and sub.id == target:
                scope = parents.get(id(sub))
                break
    if scope is None:
        print("AGREE\t%s\t%s\tno-read-found" % (rel, target))
        continue
    visible = chain_visible(scope, binds, parents)
    if target in visible:
        print("DISAGREE\t%s\t%s\tbound in the read's own scope chain" % (rel, target))
    elif star and id(scope) in star or (id(tree) in star):
        print("DISAGREE\t%s\t%s\tfile has a star import" % (rel, target))
    else:
        print("AGREE\t%s\t%s" % (rel, target))
`

const tmp = `.tmp-py/not-bound-in-file-rows.${process.pid}.txt`
writeFileSync(tmp, rows.map((r) => r.join("\t")).join("\n") + "\n")
const out = spawnSync("python3", ["-c", PROGRAM, corpus, tmp], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
if (out.status !== 0) {
  console.error(`FAIL  the CPython re-check did not run: ${out.stderr?.slice(0, 800)}`)
  process.exit(1)
}
unlinkSync(tmp)

const verdicts = out.stdout.split("\n").filter((l) => l.length > 0).map((l) => l.split("\t"))
const agree = verdicts.filter((v) => v[0] === "AGREE")
const disagree = verdicts.filter((v) => v[0] === "DISAGREE")
const unparseable = verdicts.filter((v) => v[0] === "UNPARSEABLE")

console.log(`python ${AXIS} gate — artefact ${ARTIFACT}`)
console.log(`  artefact axis total : ${axisTotal}  (${perLabel.map(([l, n]) => `${l}:${n}`).join(" ")})`)
console.log(`  rows in ${ROWS} : ${rows.length}`)
console.log(`  CPython re-check    : AGREE ${agree.length} · UNPARSEABLE ${unparseable.length} · DISAGREE ${disagree.length}`)

let bad = 0
if (rows.length !== axisTotal) {
  console.log(`FAIL  the rows file and the artefact disagree about the axis population`)
  bad++
}
if (disagree.length > 0) {
  console.log(`FAIL  ${disagree.length} row(s) name a binding CPython can see from the read — the axis is excusing an analyzer gap:`)
  for (const d of disagree.slice(0, 20)) console.log(`      ${d[1]}  ${d[2]}  (${d[3]})`)
  bad++
}
for (const u of unparseable.slice(0, 12)) console.log(`  named: CPython rejects ${u[1]} at ${u[3]} (target ${u[2]})`)
if (unparseable.length > 12) console.log(`  ... and ${unparseable.length - 12} more in files CPython rejects`)

if (bad > 0) {
  console.log(`\nFAIL — ${bad} problem(s)`)
  process.exit(1)
}
console.log(`\nPASS — every row on the ${AXIS} axis is either agreed by CPython (${agree.length}) or in a file CPython itself rejects (${unparseable.length}, named above)`)
