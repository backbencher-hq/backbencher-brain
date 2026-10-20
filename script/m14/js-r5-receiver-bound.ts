/**
 * js-r5-receiver-bound — R5's BOUND FOR THE RECEIVER WALLS, MEASURED INDEPENDENTLY OF ANY CAUSE
 * CLASSIFICATION.
 *
 * R5 (charter §21.41): "A RECEIVER-TYPING EVIDENCE CLASS IS BOUNDED BY THE DECLARED-POPULATION
 * SHARE; THE UNDECLARED SHARE IS A VOCABULARY PROBLEM." The dart lane's measurement (proxicall's
 * 16,395 unresolved `uses` rows): W1 the file binds it 2,316 (14.1%) · W2 the PROJECT declares it
 * 155 (0.9%) · W3 the project declares it NOWHERE 13,924 (84.9%). "So a receiver-typing evidence
 * class could move at most 155 rows, not 16,395 — for the other 84.9% there is no declaration for
 * ANY evidence class to point at."
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS INSTRUMENT EXISTS, AND WHY THE CENSUS'S OWN BUCKETS CANNOT ANSWER THE QUESTION.
 *
 * The lane's cause census (`js-resolution-classify.ts`) ALREADY classifies every non-resolved edge
 * into a cause bucket, and its buckets look like R5's three classes. **They are not R5's classes,
 * and reading them as R5's would be a wrong number dressed as a right one.** The census
 * classifies by CAUSE, and it classifies by PRIORITY: a `calls` row whose receiver is an untyped
 * local is put in `UNTYPED-LOCAL-RECEIVER` **before** the census ever asks whether the project
 * declares the member. So a row in that bucket may name a member the project DOES declare — and
 * the census never says. Reading "the untyped-receiver bucket is 143,370" as "143,370 of them are
 * declared nowhere" would be inventing a measurement.
 *
 * So this instrument asks the THREE QUESTIONS DIRECTLY, per row, in this order:
 *
 *   W1 · THE FILE BINDS THE NAME. The analyzer published a local-binding row for that name in that
 *        file (`<callable>\u0000<name>`), so the name is a LOCAL of the file and the row is a SHAPE
 *        question, not a receiver wall at all.
 *   W2 · THE PROJECT DECLARES IT. The project's own key space declares the name (as a symbol or as
 *        a member of a class). **This is the CEILING for a receiver-typing evidence class**: there
 *        is a declaration to point at, and only the site does not say which one.
 *   W3 · THE PROJECT DECLARES IT NOWHERE. There is no declaration for ANY evidence class to point
 *        at. A typing heuristic cannot settle it; a CLAIM can (a name that belongs to a dependency
 *        the project declares — the `packageScope` instrument, charter §21.42).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT IT READS, AND WHY THE POPULATION IS STATED.
 *
 *   · THE GATE'S OWN `--dump` ROWS (the population, the rule and the outcome are the gate's by
 *     construction) — the same instrument the dart lane's R5 probe reads.
 *   · EACH DUMPED FILE'S OWN ANALYZER OUTPUT (re-parsed through the same `parseFile` call the gate
 *     makes) — the only evidence that can say "is this name bound HERE" and "what is this row's
 *     receiver".
 *   · EACH REPO'S OWN DECLARATION KEY SPACE (the same project-index builder, over the repo's
 *     admitted file list) — the W2 test.
 *
 * The population is a NAMED SET OF REPOS and the file count is printed with the result: a
 * repository is a complete population of ITSELF (the dart lane's R5 measurement was one repo,
 * proxicall), and this probe never calls a stride a population.
 *
 * USAGE
 *   export BB_CORPUS_ROOT=$PWD/.corpus
 *   bun run script/m14/incoming-gate.ts javascript js,mjs,cjs,jsx 0 --repo=<repo> --dump > dump.txt
 *   bun run script/m14/js-r5-receiver-bound.ts --dump=dump.txt
 *
 * It is a MEASUREMENT: prints counts with the population, writes nothing, exits 0.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"
import { buildProjectIndexStreaming, JAVASCRIPT_DECLARATION_SPEC } from "../../src/ast/project-index"
import { resolveWasmAsset } from "../../src/util/wasm"
import { BINDING_SEP } from "../../src/ast/types"

const CR = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const argv = process.argv.slice(2)
const argOf = (name: string): string | undefined => {
  const withEq = argv.find((a) => a.startsWith(`${name}=`))
  if (withEq) return withEq.slice(name.length + 1)
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const DUMP = argOf("--dump") ?? ""
if (!DUMP) {
  console.error("usage: bun run script/m14/js-r5-receiver-bound.ts --dump=<dump.txt>")
  process.exit(2)
}
const SIZE_CAP = 1024 * 1024
const EXTENSIONS = ["js", "mjs", "cjs", "jsx"] // the gate's own list for this lane

type DumpRow = { label: string; outcome: string; target: string; srcFile: string; line: number }
const rows: DumpRow[] = []
for (const line of readFileSync(DUMP, "utf8").split("\n")) {
  if (!line.startsWith("DUMP\t")) continue
  const p = line.split("\t")
  if (p.length < 6) continue
  const loc = p[4]
  const colon = loc.lastIndexOf(":")
  rows.push({
    label: p[1],
    outcome: p[2],
    target: p[3],
    srcFile: colon > 1 ? loc.slice(0, colon) : loc,
    line: colon > 1 ? Number(loc.slice(colon + 1)) || 0 : 0,
  })
}

const repoOf = (f: string): string => {
  const rel = f.startsWith(CR) ? f.slice(CR.length + 1) : f
  return rel.split(path.sep)[0]
}
const repos = [...new Set(rows.map((r) => repoOf(r.srcFile)))].sort()

// ── THE PROJECT'S KEY SPACE, per repo ────────────────────────────────────────────────────────────
const WASM = resolveWasmAsset("tree-sitter-javascript/tree-sitter-javascript.wasm")
const projectNames = new Map<string, Set<string>>()
const projectMembers = new Map<string, Set<string>>()
for (const repo of repos) {
  const repoRoot = path.join(CR, repo)
  let tracked: string[] = []
  try {
    tracked = execFileSync("git", ["-C", repoRoot, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  const files = tracked
    .filter((f) => EXTENSIONS.includes((f.slice(f.lastIndexOf(".") + 1) || "").toLowerCase()))
    .map((f) => path.join(repoRoot, f))
    .filter((abs) => {
      try { return statSync(abs).size <= SIZE_CAP } catch { return false }
    })
  const index = await buildProjectIndexStreaming(WASM, files, JAVASCRIPT_DECLARATION_SPEC)
  projectNames.set(repo, new Set(index.symbolNames))
  const members = new Set<string>()
  for (const [, ms] of index.typeMembers) for (const m of ms) members.add(m)
  projectMembers.set(repo, members)
  console.log(
    `  project key space · ${repo}: ${index.symbolNames?.size ?? 0} symbol name(s), ${members.size} member name(s), ${files.length} admitted file(s)`,
  )
}

// ── EACH FILE'S OWN ANALYZER OUTPUT ──────────────────────────────────────────────────────────────
type FileInfo = {
  /** the names the file binds LOCALLY (the local-binding claim's own spellings) */
  locals: Set<string>
  /** the rows themselves, keyed by label + target + line, for the receiver metadata */
  byKey: Map<string, any>
}
const fileCache = new Map<string, FileInfo>()
async function infoFor(file: string): Promise<FileInfo> {
  const hit = fileCache.get(file)
  if (hit) return hit
  const repoRoot = path.join(CR, repoOf(file))
  let r: any = null
  try { r = await parseFile(file, repoRoot, { projectRoot: repoRoot } as any) } catch { r = null }
  const info: FileInfo = { locals: new Set(), byKey: new Map() }
  for (const rel of Array.isArray(r?.relationships) ? r.relationships : []) {
    const t = String(rel?.target ?? "")
    const at = t.lastIndexOf(BINDING_SEP)
    if (at >= 0) info.locals.add(t.slice(at + 1))
    const key = `${rel?.type}|${t}|${rel?.line_number ?? 0}`
    if (!info.byKey.has(key)) info.byKey.set(key, rel)
  }
  fileCache.set(file, info)
  return info
}

/** the RECEIVER ROOT of a row, from the analyzer's own metadata. */
function receiverRootOf(rel: any, label: string): string {
  if (!rel) return ""
  const md = rel.metadata ?? {}
  if (label === "calls") {
    const callee = typeof md.calleeExpression === "string" ? md.calleeExpression : ""
    if (!callee.includes(".")) return ""
    const head = callee.split(".")[0]!.trim()
    return /^[A-Za-z_$][\w$]*$/.test(head) ? head : ""
  }
  // a `uses` row: a SEGMENT is a field access whose target is the leaf; the receiver is the root
  const rr = typeof md.receiverRoot === "string" ? md.receiverRoot : ""
  if (rr) return rr
  return ""
}

type Class = "W1" | "W2" | "W3" | "RESOLVED-BY-OWNER" | "not-a-receiver-wall"
const classes: Record<Class, number> = {
  W1: 0,
  W2: 0,
  W3: 0,
  "RESOLVED-BY-OWNER": 0,
  "not-a-receiver-wall": 0,
}
const wallClasses: Record<string, Record<string, number>> = {}
const byName = new Map<string, { cls: Class; rows: number }>()

for (const r of rows) {
  // THE ARBITER'S OWN NON-RESOLVED OUTCOMES (incoming-rule.ts:787): `unresolved` (no declaration
  // answers the name), `ambDeclOnly` (a declaration answers it but 2+ declarations carry the name),
  // `ambBoth` (the same by kind). A row with a CLAIM (`bindingVerified`, `externalVerified`, …) is
  // NOT a wall and is skipped.
  if (r.outcome !== "unresolved" && r.outcome !== "ambDeclOnly" && r.outcome !== "ambBoth") continue
  if (r.label !== "uses" && r.label !== "calls") continue
  const repo = repoOf(r.srcFile)
  const info = await infoFor(r.srcFile)
  const rel = info.byKey.get(`${r.label}|${r.target}|${r.line}`)
  const md = rel?.metadata ?? {}
  const root = receiverRootOf(rel, r.label)

  // IS THIS ROW A RECEIVER WALL? A receiver wall is a row whose RECEIVER's type is not stated at
  // the site: the receiver root is a LOCAL of the file (a local, a parameter, a catch binding), or
  // a CALL RESULT, or `this` outside a class (dynamic). A receiver that is an IMPORT, a
  // REQUIRE, a NAMESPACE, a `new` type, a program-scope class, or a `this` inside a class is NOT
  // a receiver wall — the analyzer states those types, and the rows they carry are already bound.
  let wall = ""
  if (r.label === "calls" && root) {
    const isLocal = info.locals.has(root)
    const isThis = root === "this"
    const isThisTyped = md.ownerEvidence === "this"
    if (isThis && !isThisTyped) wall = "dynamic this (untyped)"
    else if (isLocal && !isThis) wall = "untyped receiver (local/param/catch)"
    else if (md.owner) wall = "" // the receiver's type IS stated — the owner channel's business
  } else if (r.label === "uses" && md.isFieldAccess === true && md.bareRead !== true && md.chainRoot !== true) {
    if (root === "this" && md.ownerEvidence !== "this") wall = "dynamic this (untyped)"
    else if (root && info.locals.has(root)) wall = "untyped receiver (local/param/catch) — field segment"
    else if (!md.owner) wall = "field segment (receiver type not stated)"
  }
  if (!wall) {
    classes["not-a-receiver-wall"]++
    continue
  }
  if (md.owner) {
    classes["RESOLVED-BY-OWNER"]++
    const w = (wallClasses[wall] ??= { W1: 0, W2: 0, W3: 0, RESOLVED: 0 })
    w.RESOLVED++
    continue
  }
  // THE THREE QUESTIONS, asked directly, in R5's order.
  let cls: Class
  if (info.locals.has(r.target)) cls = "W1"
  else if ((projectMembers.get(repo)?.has(r.target) ?? false) || (projectNames.get(repo)?.has(r.target) ?? false)) cls = "W2"
  else cls = "W3"
  classes[cls]++
  const w = (wallClasses[wall] ??= { W1: 0, W2: 0, W3: 0, RESOLVED: 0 })
  w[cls]++
  const cur = byName.get(r.target)
  if (cur) cur.rows++
  else byName.set(r.target, { cls, rows: 1 })
}

const total = classes.W1 + classes.W2 + classes.W3
console.log("")
console.log(`JAVASCRIPT — R5's RECEIVER BOUND · ${repos.join(", ")}`)
console.log(`  dump file        : ${DUMP}`)
console.log(`  corpus root      : ${CR}`)
console.log(`  dump rows read   : ${rows.length} (${repos.length} repo(s))`)
console.log(`  receiver-wall rows: ${total + classes["RESOLVED-BY-OWNER"]} (of which ${classes["RESOLVED-BY-OWNER"]} already carry an owner — the RESOLVED share)`)
console.log("")
console.log(`  W1 · the file binds the name   ${String(classes.W1).padStart(8)}  ${total === 0 ? "n/a" : `${((100 * classes.W1) / total).toFixed(1)}%`}`)
console.log(`  W2 · the project declares it   ${String(classes.W2).padStart(8)}  ${total === 0 ? "n/a" : `${((100 * classes.W2) / total).toFixed(1)}%`}   ← the CEILING for a receiver-typing evidence class`)
console.log(`  W3 · declared NOWHERE          ${String(classes.W3).padStart(8)}  ${total === 0 ? "n/a" : `${((100 * classes.W3) / total).toFixed(1)}%`}   ← a vocabulary problem`)
console.log("")
for (const [wall, w] of Object.entries(wallClasses)) {
  const t = w.W1 + w.W2 + w.W3
  console.log(`  ${wall}: ${t} row(s) · W1 ${w.W1} · W2 ${w.W2} · W3 ${w.W3} · owner-resolved ${w.RESOLVED}`)
}
console.log("")
const top = [...byName.entries()].sort((a, b) => b[1].rows - a[1].rows).slice(0, 25)
console.log("  the most frequent receiver-wall names, with their class:")
for (const [n, v] of top) console.log(`    ${v.cls}  ${String(v.rows).padStart(6)}  ${n}`)
