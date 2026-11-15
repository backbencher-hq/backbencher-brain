/**
 * ROUND 16 — THE GATE FOR THE TWO `exports` RESIDUAL AXES: `shipped-submodule` and `stale-export`.
 *
 * The verdict's last 5 UNEXPLAINED incoming rows were all `exports`, and they are TWO mechanisms.
 * An axis that removes a row from the defect count is exactly where a future analyzer gap would
 * hide itself, so each axis states a PREDICATE and this gate re-checks it against an authority
 * outside the lane's own instrument — CPython's `ast` and the filesystem:
 *
 *   shipped-submodule   the target is a BARE name, the population ships it as a module BESIDE the
 *                       source file (`<dir>/<name>/__init__.py`, `<dir>/<name>.py`, `<name>.pyi`),
 *                       and the file's text binds the name NOWHERE. Python's import system supplies
 *                       the name — that is what a lazy `__all__ = ("mssql", "mysql", ...)` in a
 *                       package's `__init__.py` relies on — so the edge names a module the project
 *                       really ships. The name INDEX cannot hold it because a module is not a
 *                       DECLARATION, which is the whole reason the row dangles without a defect.
 *   stale-export        the name is stated by the file's OWN `__all__`, is bound nowhere in the
 *                       file, has no module shipped beside it, and NO OTHER file of the population
 *                       so much as mentions it. The file's stated public surface names something
 *                       that exists nowhere: a defect in the CORPUS. The analyzer is right to emit
 *                       the edge the file states, so the dangling row is the honest report of
 *                       someone else's stale `__all__` rather than a lane defect. (Corpus case:
 *                       `sqlalchemy/ext/declarative/__init__.py` lists `instrument_declarative`,
 *                       which occurs in exactly one file of 11,488 — the `__all__` that names it.)
 *
 * Per row, three verdicts:
 *
 *   AGREE       every clause of the row's predicate holds.
 *   DISAGREE    a clause does NOT hold — the axis is excusing something else (a real analyzer gap,
 *               a mis-ordered axis, or a stale row list) — and this gate FAILS.
 *   UNPARSEABLE CPython cannot parse the source file. Counted and NAMED, never excused: a row whose
 *               file CPython rejects cannot have its clause checked at all.
 *
 * The rows come from the verdict run that writes them beside the artefact
 * (`shipped-submodule.rows.txt`, `stale-export.rows.txt`), so the gate re-checks the SHIPPED run
 * rather than a remembered list. Three refusals, because each one would otherwise be a silent PASS:
 *
 *   - the row list is MISSING while the artefact declares rows on that axis (exit 2);
 *   - the row count and the artefact's own axis total DISAGREE — the lists and the artefact came
 *     from different runs (exit 1);
 *   - the artefact carries NEITHER axis at all (exit 2), which is also how a future run that
 *     silently stopped classifying these rows would show up here rather than pass.
 *
 * Usage: bun validation/m14/fixtures/python/export-residual-gate.mts
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ARTEFACT = path.join(HERE, "resolution-verdict.current.json")
const AXES = ["shipped-submodule", "stale-export"] as const
type Axis = (typeof AXES)[number]

/**
 * CPython's own reading of both predicates. `axis` selects which clause set applies, so the two
 * axes cannot drift into one another: a `stale-export` row that HAS a sibling module is a
 * DISAGREE (the axes are mis-ordered, and the submodule clause is the true one), and a
 * `shipped-submodule` row with no sibling path on disk is a DISAGREE outright.
 */
const PROGRAM = String.raw`
import ast, os, re, sys

root, rows_path, axis = sys.argv[1], sys.argv[2], sys.argv[3]

def read_text(p):
    try:
        with open(p, "rb") as fh:
            return fh.read().decode("utf8", "replace")
    except OSError:
        return None

def parse(p):
    try:
        with open(p, "rb") as fh:
            return ast.parse(fh.read())
    except SyntaxError as exc:
        return ("SYNTAX", getattr(exc, "lineno", 0) or 0)
    except OSError as exc:
        return ("IO", 0)

def bound_names(tree):
    """EVERY name bound anywhere in the file, by any binding form CPython models. Deliberately the
    broadest reading: the clause is "the file binds this name NOWHERE", so a narrower scan could
    only weaken the claim."""
    out = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            out.add(node.name)
        elif isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            out.add(node.id)
        elif isinstance(node, ast.arg):
            out.add(node.arg)
        elif isinstance(node, ast.alias):
            out.add(node.asname or node.name.split(".")[0])
        elif isinstance(node, (ast.Global, ast.Nonlocal)):
            out.update(node.names)
        elif isinstance(node, ast.ExceptHandler) and node.name:
            out.add(node.name)
        elif isinstance(node, ast.MatchAs) and node.name:
            out.add(node.name)
        elif isinstance(node, ast.MatchStar) and node.name:
            out.add(node.name)
        elif isinstance(node, ast.MatchMapping) and node.rest:
            out.add(node.rest)
    return out

def dunder_all(tree):
    """Module-level __all__ = <literal>: (names, first_line, last_line). Only the bare-assignment
    literal shape, because that is the shape the analyzer's exports rule reads."""
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        if not any(isinstance(t, ast.Name) and t.id == "__all__" for t in node.targets):
            continue
        names = [e.value for e in ast.walk(node.value)
                 if isinstance(e, ast.Constant) and isinstance(e.value, str)]
        return names, node.lineno, node.end_lineno
    return None, 0, 0

def sibling_module(p, name):
    d = os.path.dirname(p)
    for cand in (os.path.join(d, name, "__init__.py"), os.path.join(d, name, "__init__.pyi"),
                 os.path.join(d, name + ".py"), os.path.join(d, name + ".pyi")):
        if os.path.isfile(cand):
            return cand
    return None

rows = [l.rstrip("\n").split("\t") for l in open(rows_path, encoding="utf8") if l.strip()]
targets = sorted({r[3] for r in rows if len(r) > 3})
word = {n: re.compile(r"(?<![\w.])" + re.escape(n) + r"(?![\w])") for n in targets}

# ONE population pass, and only for the axis whose predicate is about the WHOLE population: the
# other axis's claim is about one directory. Word boundaries, so a name that is merely a SUBSTRING
# of a longer identifier in another file does not count as a mention.
mentions = {n: [] for n in targets}
scanned = 0
if axis == "stale-export":
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in (".git", "__pycache__", "node_modules")]
        for fn in filenames:
            if not (fn.endswith(".py") or fn.endswith(".pyi")):
                continue
            scanned += 1
            p = os.path.join(dirpath, fn)
            text = read_text(p)
            if text is None:
                continue
            for n in targets:
                if word[n].search(text):
                    mentions[n].append(os.path.realpath(p))
    print("NOTE\tpopulation files scanned\t%s" % scanned)

agree = disagree = unparseable = 0
for parts in rows:
    rel = parts[1] if len(parts) > 1 else ""
    target = parts[3] if len(parts) > 3 else ""
    if not target:
        print("DISAGREE\t%s\t%s\tempty target" % (rel, target)); disagree += 1; continue
    p = os.path.join(root, rel)
    tree = parse(p)
    if isinstance(tree, tuple):
        print("UNPARSEABLE\t%s\t%s\tCPython %s" % (rel, target, tree[0])); unparseable += 1; continue
    bound = target in bound_names(tree)
    names, lo, hi = dunder_all(tree)
    in_all = names is not None and target in names
    sib = sibling_module(p, target)
    problems = []
    if bound:
        problems.append("the file BINDS the name, so the edge should have resolved by declaration")
    if not in_all:
        problems.append("the file's own __all__ does not state the name (L%s-%s)" % (lo, hi))
    if axis == "shipped-submodule":
        if sib is None:
            problems.append("no module of that name is shipped beside the file")
    else:
        if sib is not None:
            problems.append("a module IS shipped beside the file (%s), so the row belongs on the "
                            "shipped-submodule axis" % os.path.relpath(sib, root))
        others = [q for q in mentions.get(target, []) if q != os.path.realpath(p)]
        if others:
            problems.append("%d other file(s) of the population mention the name: %s"
                            % (len(others), [os.path.relpath(q, root) for q in others][:3]))
    if problems:
        print("DISAGREE\t%s\t%s\t%s" % (rel, target, "; ".join(problems))); disagree += 1
    else:
        note = ("sibling module %s" % os.path.relpath(sib, root)) if sib else "mentioned in no other file of the population"
        print("AGREE\t%s\t%s\t%s" % (rel, target, note)); agree += 1

print("TOTAL\tAGREE\t%d\tDISAGREE\t%d\tUNPARSEABLE\t%d" % (agree, disagree, unparseable))
`

const art = JSON.parse(readFileSync(ARTEFACT, "utf8")) as any
const corpus: string = art.corpus
if (!corpus) {
  console.error(`FAIL  the pinned artefact does not name its corpus: ${ARTEFACT}`)
  process.exit(1)
}
if (!existsSync(corpus)) {
  console.error(`FAIL  the artefact names a corpus that is not on this machine: ${corpus}\n` +
    `      Both predicates are about REAL files, so this gate cannot run here.`)
  process.exit(2)
}

/** the artefact's own per-label totals for one axis (the number the claim is worth). */
const axisTotal = (axis: Axis): { total: number; perLabel: Array<[string, number]> } => {
  let total = 0
  const perLabel: Array<[string, number]> = []
  for (const [label, rec] of Object.entries<any>(art.types ?? {})) {
    const n = rec?.unresolvedClass?.[axis]
    if (typeof n === "number" && n > 0) {
      total += n
      perLabel.push([label, n])
    }
  }
  return { total, perLabel }
}

const present = AXES.filter((a) => axisTotal(a).total > 0)
if (present.length === 0) {
  console.error(`FAIL  the artefact carries NEITHER axis — the two mechanisms the exports residual\n` +
    `      was split into never fired, or the artefact predates them: ${ARTEFACT}`)
  process.exit(2)
}

console.log(`python export-residual gate — artefact ${ARTEFACT}`)
let bad = 0
for (const axis of present) {
  const { total, perLabel } = axisTotal(axis)
  const rowsFile = path.join(HERE, `${axis}.rows.txt`)
  if (!existsSync(rowsFile)) {
    console.error(`FAIL  no row list at ${rowsFile} — the axis claims ${total} row(s) ` +
      `(${perLabel.map(([l, n]) => `${l}:${n}`).join(" ")}), and a claim with no rows behind it cannot\n` +
      `      be re-checked. Regenerate it with the verdict run that writes it:\n` +
      `        npx tsx script/m14/python-endpoint-resolution.ts --out ${ARTEFACT}`)
    process.exit(2)
  }
  const rows = readFileSync(rowsFile, "utf8").split("\n").filter((l) => l.trim().length > 0)
  if (rows.length !== total) {
    console.error(`FAIL  ${axis}: the row list carries ${rows.length} row(s) but the artefact declares ` +
      `${total} — they came from different runs, so neither can be trusted`)
    bad++
  }
  const out = spawnSync("python3", ["-c", PROGRAM, corpus, rowsFile, axis], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  const stdout = out.stdout ?? ""
  if (stdout.trim() === "") {
    console.error(`FAIL  the CPython checker produced no output for the ${axis} axis ` +
      `(exit ${out.status}): ${(out.stderr ?? "").slice(0, 400)}`)
    process.exit(2)
  }
  const lines = stdout.split("\n").filter((l) => l.length > 0).map((l) => l.split("\t"))
  const agree = lines.filter((v) => v[0] === "AGREE")
  const disagree = lines.filter((v) => v[0] === "DISAGREE")
  const unparseable = lines.filter((v) => v[0] === "UNPARSEABLE")
  const notes = lines.filter((v) => v[0] === "NOTE")
  console.log(`\n  ${axis}  —  artefact total ${total} (${perLabel.map(([l, n]) => `${l}:${n}`).join(" ")})  ·  rows ${rows.length}`)
  for (const n of notes) console.log(`      ${n[1]}: ${n[2]}`)
  console.log(`      CPython re-check: AGREE ${agree.length} · UNPARSEABLE ${unparseable.length} · DISAGREE ${disagree.length}`)
  for (const a of agree.slice(0, 8)) console.log(`        AGREE  ${a[1]} -> ${a[2]}  (${a[3]})`)
  for (const d of disagree) console.log(`        DISAGREE  ${d[1]} -> ${d[2]}  (${d[3]})`)
  for (const u of unparseable) console.log(`        UNPARSEABLE  ${u[1]} -> ${u[2]}  (${u[3]})`)
  if (disagree.length > 0) {
    console.log(`      FAIL  ${disagree.length} row(s) do not satisfy the ${axis} predicate — the axis is excusing something else`)
    bad++
  }
  if (unparseable.length > 0) {
    console.log(`      FAIL  ${unparseable.length} row(s) sit in a file CPython cannot parse (named above)`)
    bad++
  }
}

if (bad > 0) {
  console.log(`\nFAIL — ${bad} problem(s)`)
  process.exit(1)
}
console.log(`\nPASS — ${present.join(" + ")}: every row satisfies its predicate, re-checked against CPython's ` +
  `ast and the filesystem`)
