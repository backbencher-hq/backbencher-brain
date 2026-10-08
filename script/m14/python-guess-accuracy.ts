/**
 * FIRST-PARENT-GUESS ACCURACY — the `overrides` edge the analyzer labels uncertain,
 * asked of the INTERPRETER whether it is true.
 *
 * ## Why this file exists
 *
 * `overrides` emits a third tier at confidence 0.5 with
 * `metadata.reasonCode: "first-parent-guess"`: `Owner.method -> Base.method` where
 * `Base` is a name this file never read. That is 2,270 edges across the two corpora
 * this lane measures (41 on python-codesql, 2,229 on CPython's stdlib), and every one
 * of them is a claim the analyzer has already admitted it cannot support.
 *
 * The lane's own differential reports all 2,270 as `refuted`, and that number must
 * not be read as a 0% accuracy rate. It is not one, and the reason is structural:
 *
 *   THE ORACLE'S REFUTATION IS VACUOUS FOR AN EXTERNAL BASE. The oracle is a walker
 *   over the ONE file. A base declared in another module is, by construction, absent
 *   from that walk — so "the tree does not support this edge" is what an external
 *   base produces whether the edge is true or false. The measurement answers a
 *   question about the FILE, and the edge is about another file.
 *
 * The question that has an answer is the language's: does the base class actually
 * have that method? CPython can be asked directly, and this file asks it. For a base
 * the file imports by a path the interpreter can execute — `from enum import Enum`
 * makes `Enum` reachable — `getattr(Base, method, MISSING)` is a fact about the
 * language rather than an inference from a file, and it is the same authority the
 * lane has used for every other python question (`vars()`, `ast.walk`, `dir()`).
 *
 * Three outcomes, and the middle one is the whole point:
 *
 *   TRUE   the base HAS the method. The guess named a real method on a real class —
 *          the edge is true even though nothing in this file proved it.
 *   FALSE  the base does NOT have it. The edge is a false statement carrying a
 *          confidence label, and it is the number that must not be softened.
 *   UNKNOWN the base could not be imported here (a third-party package, a relative
 *          import, a dynamically built class, a name the file bound to something
 *          else). Not counted as true and NOT counted as false: pretending to know
 *          would make the accuracy rate a number nobody measured.
 *
 * NO REGEX. The set of (base, method) pairs is collected by walking relationships the
 * production path returned, handed to the interpreter as JSON, and read back as JSON.
 * Importing a base is a subprocess call, not a pattern over text.
 *
 * Usage: bun run script/m14/python-guess-accuracy.ts [--repo python-codesql]
 *                                                      [--stdlib] [--out p.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const OUT = argOf("--out")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO_FILTER = argOf("--repo")
const LIMIT = Number(argOf("--limit") ?? "0")
const MAX_BYTES = Number(argOf("--max-bytes") ?? String(1024 * 1024))
const STDLIB = argv.includes("--stdlib")
const STDLIB_DIR = argOf("--stdlib-dir") ?? "/usr/lib/python3.10"
const SKIP_DIR_NAMES = new Set(["test", "tests", "lib2to3", "idlelib", "site-packages", "testdata"])
const WORKERS = Number(argOf("--workers") ?? "1")
const PY = argOf("--python") ?? "python3"

const QUAL = "."

// ---------------------------------------------------------------- corpus
type CorpusFile = { repo: string; dir: string; rel: string; abs: string }
const all: CorpusFile[] = []
if (STDLIB) {
  const walk = (d: string, depth: number): void => {
    if (depth > 8 || all.length > 20000) return
    let ents: import("node:fs").Dirent[]
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (SKIP_DIR_NAMES.has(e.name)) continue
      const abs = path.join(d, e.name)
      if (e.isDirectory()) { walk(abs, depth + 1); continue }
      if (!(e.name.endsWith(".py") || e.name.endsWith(".pyi"))) continue
      try { if (statSync(abs).size > MAX_BYTES) continue } catch { continue }
      all.push({ repo: "cpython-stdlib", dir: STDLIB_DIR, rel: path.relative(STDLIB_DIR, abs), abs })
    }
  }
  walk(STDLIB_DIR, 0)
}
for (const e of readdirSync(CR)) {
  if (STDLIB) break
  const dir = path.join(CR, e)
  if (REPO_FILTER && !e.includes(REPO_FILTER)) continue
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > MAX_BYTES) continue } catch { continue }
    if (detectLanguageFromPath(abs) !== "python") continue
    all.push({ repo: e, dir, rel, abs })
  }
  if (REPO_FILTER && all.length) break
}
const admitted = LIMIT ? all.slice(0, LIMIT) : all

// ---------------------------------------------------------------- collect
/**
 * One `class` per header, so the interpreter is asked to import each base module at
 * most once however many methods hang off it. `modules` is the SET of module paths the
 * corpus imports, and `bases` maps a base leaf to every module path it could have come
 * from — `from enum import Enum` puts `Enum` under `enum`, and `import os.path` puts
 * `path` under `os.path`. A base with several candidate modules is asked against each
 * until one resolves; it stays UNKNOWN if none does, which is the honest outcome for a
 * leaf that three packages could each have exported.
 */
type BaseRow = { leaf: string; modules: string[] }
const guessRows = new Map<string, { count: number; files: Set<string>; bases: BaseRow[]; methods: Set<string> }>()
let parsed = 0, failed = 0, totalRels = 0
let verifiedRels = 0
const index = new Map<string, BaseRow>()

const noteLeaf = (leaf: string, modulePath: string) => {
  const row = index.get(leaf) ?? { leaf, modules: [] }
  if (modulePath && !row.modules.includes(modulePath)) row.modules.push(modulePath)
  index.set(leaf, row)
}

let idx = 0
const worker = async (): Promise<void> => {
  while (true) {
    const i = idx++
    if (i >= admitted.length) return
    const f = admitted[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { failed++; continue }
    parsed++
    const label = `${f.repo}/${f.rel}`
    const rels: any[] = r?.relationships ?? []
    totalRels += rels.length
    // What this file binds by import, read off the PRODUCTION parse result.
    for (const im of r?.imports ?? []) {
      const mod = String(im?.path ?? "")
      const nm = String(im?.name ?? "")
      if (!mod || !nm || nm === "*") continue
      // `import a.b.c` imports the package; `from a.b import c` binds `c` in `a.b`.
      noteLeaf(nm, mod)
    }
    for (const rel of rels) {
      const reason = (rel.metadata as any)?.reasonCode
      if (reason !== "first-parent-guess") { verifiedRels++; continue }
      const tgt = String(rel.target ?? "")
      const dot = tgt.lastIndexOf(QUAL)
      if (dot <= 0) continue
      const base = tgt.slice(0, dot)
      const method = tgt.slice(dot + 1)
      if (!base || !method) continue
      const key = `${base}${QUAL}${method}`
      const row = guessRows.get(key) ?? { count: 0, files: new Set(), bases: [], methods: new Set() }
      row.count++
      if (row.files.size < 20) row.files.add(label)
      const known = row.bases.find((b) => b.leaf === base)
      if (known) known.modules = index.get(base)?.modules ?? known.modules
      else row.bases.push({ leaf: base, modules: index.get(base)?.modules ?? [] })
      row.methods.add(method)
      guessRows.set(key, row)
    }
  }
}
await Promise.all(Array.from({ length: WORKERS }, () => worker()))

// ---------------------------------------------------------------- ask CPython
const payload = [...guessRows.values()].map((r) => ({
  base: r.bases[0]?.leaf ?? "",
  modules: r.bases[0]?.modules ?? [],
  method: [...r.methods][0] ?? "",
  weight: r.count,
}))
const PY_SRC = `
import json, importlib, sys
data = json.load(sys.stdin)
out = []
for row in data:
    base = row["base"]; method = row["method"]; mods = list(row["modules"])
    # A builtin class needs no import, and a great many of the bases a python file
    # inherits from are builtins: object, dict, type, Exception, BaseException. Without
    # this the probe would call every one of them UNKNOWN and report a decidability
    # far worse than the question actually is.
    if "builtins" not in mods:
        mods.append("builtins")
    verdict = "UNKNOWN"; why = "no-module"
    obj = None
    for m in mods:
        try:
            mod = importlib.import_module(m)
        except BaseException:
            continue
        cand = getattr(mod, base, None)
        if cand is not None:
            obj = cand; break
    if obj is None:
        verdict = "UNKNOWN"; why = "base-not-importable"
    else:
        found = hasattr(obj, method)
        verdict = "TRUE" if found else "FALSE"
        why = "getattr" if found else "getattr"
    out.append({"base": base, "method": method, "verdict": verdict, "why": why,
                "weight": row["weight"], "modules": mods})
json.dump(out, sys.stdout)
`
let verdicts: any[] = []
let interpreterError = ""
try {
  const stdout = execFileSync(PY, ["-c", PY_SRC], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 300000,
  })
  verdicts = JSON.parse(stdout)
} catch (e: any) {
  interpreterError = String(e?.message ?? e).slice(0, 300)
}

// ---------------------------------------------------------------- report
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`python first-parent-guess accuracy — ${admitted.length} admitted, ${parsed} parsed, ${failed} failed`)
console.log(`corpus ${STDLIB ? STDLIB_DIR : REPO_FILTER ?? CR}   workers ${WORKERS}`)
console.log(`relationships ${totalRels.toLocaleString()}   distinct guessed (base, method) pairs ${payload.length}\n`)

if (interpreterError) {
  console.log(`THE INTERPRETER REFUSED: ${interpreterError}`)
  console.log("No accuracy rate is reported. A guess with no measurement is the thing this lane exists to remove.")
} else {
  const byVerdict = new Map<string, number>()
  const byBase = new Map<string, { TRUE: number; FALSE: number; UNKNOWN: number }>()
  let totalWeight = 0
  for (const v of verdicts) {
    totalWeight += v.weight
    byVerdict.set(v.verdict, (byVerdict.get(v.verdict) ?? 0) + v.weight)
    const row = byBase.get(v.base) ?? { TRUE: 0, FALSE: 0, UNKNOWN: 0 }
    row[v.verdict as "TRUE" | "FALSE" | "UNKNOWN"] += v.weight
    byBase.set(v.base, row)
  }
  const decided = (byVerdict.get("TRUE") ?? 0) + (byVerdict.get("FALSE") ?? 0)
  const t = byVerdict.get("TRUE") ?? 0
  const fa = byVerdict.get("FALSE") ?? 0
  const un = byVerdict.get("UNKNOWN") ?? 0
  console.log("== EDGE-WEIGHTED (one row per emitted edge) ==")
  console.log(`  TRUE    ${String(t).padStart(6)}   the base HAS the method - the edge is true`)
  console.log(`  FALSE   ${String(fa).padStart(6)}   the base does NOT have it - a false statement at 0.5`)
  console.log(`  UNKNOWN ${String(un).padStart(6)}   the base could not be imported here - not counted either way`)
  console.log(`  total guessed edges ${totalWeight}`)
  console.log(`  accuracy over DECIDED edges: ${decided ? ((100 * t) / decided).toFixed(1) : "n/a"}% (${t}/${decided}); ${decided ? ((100 * un) / totalWeight).toFixed(1) : "n/a"}% of guesses are undecidable here`)
  console.log("\n== PER BASE (edge-weighted, top 25 by volume) ==")
  for (const [base, row] of [...byBase.entries()].sort((a, b) => (b[1].TRUE + b[1].FALSE + b[1].UNKNOWN) - (a[1].TRUE + a[1].FALSE + a[1].UNKNOWN)).slice(0, 25)) {
    console.log(`  ${w(base, 28)} TRUE:${row.TRUE}  FALSE:${row.FALSE}  UNKNOWN:${row.UNKNOWN}`)
  }
  console.log("\n== NAMED FALSE examples ==")
  let shown = 0
  for (const v of verdicts) {
    if (v.verdict !== "FALSE") continue
    console.log(`  ${v.base}${QUAL}${v.method}  (${v.weight} edges, modules tried: ${(v.modules ?? []).join(", ") || "none"})`)
    if (++shown >= 12) break
  }
  if (!shown) console.log("  (none)")
  console.log("\n== NAMED TRUE examples ==")
  shown = 0
  for (const v of verdicts) {
    if (v.verdict !== "TRUE") continue
    console.log(`  ${v.base}${QUAL}${v.method}  (${v.weight} edges, modules tried: ${(v.modules ?? []).join(", ") || "none"})`)
    if (++shown >= 8) break
  }
  if (!shown) console.log("  (none)")
}

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    at: new Date().toISOString(), corpus: STDLIB ? STDLIB_DIR : REPO_FILTER ?? CR,
    filesParsed: parsed, filesFailed: failed, totalRelationships: totalRels,
    interpreterError, guessedPairs: verdicts.length, verdicts,
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}