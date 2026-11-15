/**
 * NIM — RE-DERIVATION OF THE NUMBER `script/m14/incoming-rule.ts` CITES FOR THIS LANE.
 *
 * The rule's doc comment says, beside zig's stale p30 citation:
 *
 *   "real-nim-analyzer.ts meta.nimStdlibModule, measured marking 66 of 485 unbindable
 *    (docs/analyzers/nim.md:435-449)"
 *
 * That sentence is a claim about the CURRENT analyzer and the CURRENT corpus, so it is
 * re-derived here rather than trusted, exactly as the zig lane's p30 citation was. Both
 * halves are reported:
 *
 *   (a) HOW MANY EDGES `nimStdlibModule` MARKS NOW, by type — the doc's own figure for
 *       this is 5,389 edges corpus-wide;
 *   (b) OF THOSE, WHAT THE ARBITER SAYS — `classifyEdge` (IMPORTED from
 *       `script/m14/incoming-rule.ts`, never copied) in production's PROJECT scope:
 *       extOK / extFAIL / ext?;
 *   (c) THE UNBINDABLE POPULATION and its split by the path AS WRITTEN
 *       (`meta.nimModulePath`), with the marked count inside each shape — the doc's
 *       "66 of 485" is the `std/`-prefixed cell of the `imports`-only table, so the
 *       `imports`-only table is printed beside the all-types one. A reader must be
 *       able to see WHICH population a number is about.
 *
 * ## Population, and why it is the gate's
 *
 * Discovery, sorting, the 1 MB cap, the even stride and `parseFile(f, repoOf(f),
 * { projectRoot: repoOf(f) })` are reproduced from `script/m14/incoming-gate.ts`, so the
 * totals this instrument decomposes are the ones the gate prints. `--sample 400` is the
 * draw size the zig lane's p30 re-derivation used; `--repo=<name>` runs one project whole,
 * which is the honest unit for any question about a module TARGET (a sampled key space
 * cannot contain the module a file imports).
 *
 * ## Definitions, stated because "unbindable" has two of them
 *
 *   unresolved(project)  `classifyEdge` against the file's OWN repository — what the
 *                        verdict's `unresolved` column means, and what this instrument
 *                        reports as the primary number.
 *   unresolved(pooled)   the same against every file in the run pooled into one key space
 *                        — printed beside it because the doc's 485 was measured by an
 *                        instrument with its own corpus-wide rule, and a number is only
 *                        comparable to one measured the same way.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/nim/external-marker-rederive.ts [--sample 400] [--out p.json]
 *   npx tsx validation/m14/fixtures/nim/external-marker-rederive.ts --repo=nim --out p.json
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../../../src/ast/pool-worker"
import { classifyEdge, externalClaimOf } from "../../../../script/m14/incoming-rule"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024

const argv = process.argv.slice(2)
const arg = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const SAMPLE = Number(arg("sample", "400"))
const REPO = arg("repo", "")
const OUT = arg("out", "")

// ───────────────────────────────────────────── population (the gate's own)
const found: string[] = []
for (const name of readdirSync(CR).sort()) {
  if (REPO && name !== REPO) continue
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".nim")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    found.push(abs)
  }
}
found.sort()
const total = found.length
let files = found
if (!REPO && SAMPLE > 0 && total > SAMPLE) {
  const stride = Math.max(1, Math.floor(total / SAMPLE))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < SAMPLE; i += stride) picked.push(found[i])
  files = picked
}
const repoOf = (f: string) => {
  const rel = f.startsWith(CR) ? f.slice(CR.length + 1) : f
  return path.join(CR, rel.split(path.sep)[0]!)
}

/**
 * The doc's four shapes, decided by the path AS WRITTEN.
 *
 * THE `std/` ARM MIRRORS THE ANALYZER'S OWN PREDICATE EXACTLY, and that is not pedantry:
 * `isStdlibModulePath` skips leading whitespace, tolerates one leading double quote and
 * allows spaces around the slash (`import std / [strutils, sets]` is real upstream Nim).
 * A first version of this function tested `startsWith("std/")`, and 8 of the 54 marked
 * edges fell into `other-path` — the INSTRUMENT was narrower than the analyzer, which is
 * the class of defect this programme keeps finding in exactly this direction. The
 * character scan below is the analyzer's, copied in spirit and named here so a reader can
 * check it rather than trust the table.
 */
const isPathSpace = (c: number) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0b || c === 0x0c
const DOUBLE_QUOTE = 0x22
const slash = 0x2f
const isStdlibSpelling = (writtenPath: string): boolean => {
  const s = String(writtenPath ?? "")
  let i = 0
  const skipSpace = () => { while (i < s.length && isPathSpace(s.charCodeAt(i))) i++ }
  skipSpace()
  if (i < s.length && s.charCodeAt(i) === DOUBLE_QUOTE) i++
  skipSpace()
  if (i + 3 > s.length) return false
  if (s.slice(i, i + 3).toLowerCase() !== "std") return false
  i += 3
  skipSpace()
  return i < s.length && s.charCodeAt(i) === slash
}
const shapeOf = (p: string): string => {
  if (isStdlibSpelling(p)) return "std/"
  const t = p.trim().replace(/^"+/, "")
  if (t.startsWith("../") || t.startsWith("./")) return "../"
  if (t.includes("/")) return "other-path"
  return "bare"
}

// ───────────────────────────────────────────── walk + classify
type Rec = {
  repo: string; file: string; type: string; target: string; writtenPath: string
  shape: string; marked: boolean; outcome: string
  /** declarations of the whole target in the file's OWN project — 0 is what the doc's
   *  "declared nowhere in the corpus" means, and it is the population its 485 is about */
  decls: number
}
const recs: Rec[] = []
const projectDecl = new Map<string, Map<string, number>>()
const projectKinds = new Map<string, Map<string, Set<string>>>()
const pooledDecl = new Map<string, number>()
const pooledKinds = new Map<string, Set<string>>()
const pending: { r: Rec; claim: any; modPath: string }[] = []
let parsed = 0

for (const f of files) {
  const repo = repoOf(f)
  let res: any
  try { res = await parseFile(f, repo, { projectRoot: repo } as any) } catch { continue }
  if (!res) continue
  parsed++
  let pDecl = projectDecl.get(repo)
  if (!pDecl) projectDecl.set(repo, (pDecl = new Map()))
  let pKinds = projectKinds.get(repo)
  if (!pKinds) projectKinds.set(repo, (pKinds = new Map()))
  const count = (key: string, kind: string) => {
    pDecl!.set(key, (pDecl!.get(key) ?? 0) + 1)
    let ps = pKinds!.get(key)
    if (!ps) pKinds!.set(key, (ps = new Set()))
    ps.add(kind)
    pooledDecl.set(key, (pooledDecl.get(key) ?? 0) + 1)
    let qs = pooledKinds.get(key)
    if (!qs) pooledKinds.set(key, (qs = new Set()))
    qs.add(kind)
  }
  for (const s of Array.isArray(res.symbols) ? res.symbols : []) {
    const nm = String(s?.name ?? "")
    if (nm.length === 0) continue
    const kind = String(s?.kind ?? "")
    count(nm, kind)
    const q = String(s?.qualifiedName ?? "")
    if (q.length > 0 && q !== nm) count(q, kind)
  }
  const rel = path.relative(CR, f)
  for (const r of Array.isArray(res.relationships) ? res.relationships : []) {
    const md = r?.metadata ?? {}
    const modPath = String(md.nimModulePath ?? "")
    const target = String(r?.target ?? r?.to ?? "")
    pending.push({
      modPath,
      claim: externalClaimOf(r),
      r: {
        repo, file: rel, type: String(r?.type ?? ""), target, writtenPath: modPath,
        shape: shapeOf(modPath || target), marked: md.nimStdlibModule === true,
        outcome: "", decls: 0,
      },
    })
  }
}

for (const p of pending) {
  const pd = projectDecl.get(p.r.repo)!
  const pk = projectKinds.get(p.r.repo)!
  const c = classifyEdge(pd, pk, p.r.target, p.claim)
  const pooled = classifyEdge(pooledDecl, pooledKinds, p.r.target, p.claim)
  p.r.outcome = c.outcome
  p.r.decls = pd.get(p.r.target) ?? 0
  ;(p.r as any).pooledOutcome = pooled.outcome
  recs.push(p.r)
}

// ───────────────────────────────────────────── report
const cnt = <T,>(xs: T[], k: (x: T) => string) => {
  const m = new Map<string, number>()
  for (const x of xs) m.set(k(x), (m.get(k(x)) ?? 0) + 1)
  return m
}
const marked = recs.filter((r) => r.marked)
const unresolved = recs.filter((r) => r.outcome === "unresolved")
const unbImport = unresolved.filter((r) => r.type === "imports")
const unbAll = unresolved
const extOf = (rs: Rec[], o: string) => rs.filter((r) => r.outcome === o).length

const shapeTable = (label: string, rs: Rec[]) => {
  console.log(`  ${label}`)
  for (const sh of ["std/", "bare", "other-path", "../"]) {
    const sel = rs.filter((r) => r.shape === sh)
    const m = sel.filter((r) => r.marked).length
    console.log(`    ${sh.padEnd(11)} ${String(sel.length).padStart(5)} edges, ${String(m).padStart(4)} marked`)
  }
}
const report = {
  population: {
    mode: REPO ? `repo=${REPO} (whole project)` : `gate stride ${SAMPLE}`,
    files: files.length, corpusTotal: total, parsed,
  },
  a_marked: {
    edges: marked.length,
    byType: Object.fromEntries(cnt(marked, (r) => r.type)),
    distinctTargets: new Set(marked.map((r) => r.target)).size,
    byShape: Object.fromEntries(cnt(marked, (r) => r.shape)),
  },
  b_outcome: {
    extOK: extOf(marked, "externalVerified"),
    extFAIL: extOf(marked, "externalRefuted"),
    extUnverified: extOf(marked, "externalUnverified"),
    refutedTargets: [...new Set(marked.filter((r) => r.outcome === "externalRefuted").map((r) => r.target))],
  },
  c_unbindable: {
    // THE DOC-COMPARABLE POPULATION: every edge whose target names NOTHING in its own
    // project, whether or not it carries a claim. A claimed edge is still unbindable — the
    // claim only says why — so a table that counted `outcome === "unresolved"` alone would
    // EXCLUDE the very edges the marker exists for and answer a different question.
    importsDeclaredNowhere: recs.filter((r) => r.type === "imports" && r.decls === 0).length,
    importsDeclaredNowhereByShape: Object.fromEntries(cnt(recs.filter((r) => r.type === "imports" && r.decls === 0), (r) => r.shape)),
    importsDeclaredNowhereMarkedByShape: Object.fromEntries(cnt(recs.filter((r) => r.type === "imports" && r.decls === 0 && r.marked), (r) => r.shape)),
    importsDeclaredNowhereOutcome: Object.fromEntries(cnt(recs.filter((r) => r.type === "imports" && r.decls === 0), (r) => r.outcome)),
    allTypesDeclaredNowhere: recs.filter((r) => r.decls === 0).length,
    // the gate's own `unresolved` column (no claim at all), for contrast
    importsUnclaimedUnresolved: unbImport.length,
    importsPooledScope: unbImport.filter((r) => (r as any).pooledOutcome === "unresolved").length,
    importsByShape: Object.fromEntries(cnt(unbImport, (r) => r.shape)),
    importsMarkedByShape: Object.fromEntries(cnt(unbImport.filter((r) => r.marked), (r) => r.shape)),
    allTypesProjectScope: unbAll.length,
    allTypesByType: Object.fromEntries(cnt(unbAll, (r) => r.type)),
  },
}
if (OUT) writeFileSync(OUT, JSON.stringify({ ...report, recs }, null, 2))

console.log(`nim external-marker re-derivation — ${report.population.mode}; ${parsed} parsed of ${files.length} (corpus ${total} .nim)`)
console.log(`\n(a) EDGES MARKED nimStdlibModule === true NOW: ${marked.length}  by type ${JSON.stringify(report.a_marked.byType)}`)
console.log(`    distinct marked targets: ${report.a_marked.distinctTargets}   by written-path shape ${JSON.stringify(report.a_marked.byShape)}`)
console.log(`\n(b) OF THOSE: extOK ${report.b_outcome.extOK} · extFAIL ${report.b_outcome.extFAIL} · ext? ${report.b_outcome.extUnverified}`)
console.log(`\n(c) DECLARED NOWHERE — the population the rule's "of 485" is about (decls === 0)`)
console.log(`    imports declared nowhere: ${report.c_unbindable.importsDeclaredNowhere}` +
  `   by shape ${JSON.stringify(report.c_unbindable.importsDeclaredNowhereByShape)}` +
  `   marked by shape ${JSON.stringify(report.c_unbindable.importsDeclaredNowhereMarkedByShape)}`)
console.log(`    their outcomes: ${JSON.stringify(report.c_unbindable.importsDeclaredNowhereOutcome)}`)
console.log(`    ALL TYPES declared nowhere: ${report.c_unbindable.allTypesDeclaredNowhere}`)
console.log(`    (the gate's own \`unresolved\` column, no claim at all: imports ${report.c_unbindable.importsUnclaimedUnresolved}, pooled ${unbImport.filter((r) => (r as any).pooledOutcome === "unresolved").length})`)
const dn = recs.filter((r) => r.type === "imports" && r.decls === 0)
shapeTable("imports declared-nowhere by written path, marked count:", dn)
console.log(`    marked-but-unverifiable targets: ${JSON.stringify([...new Set(marked.filter((r) => r.outcome === "externalUnverified").map((r) => r.target))].slice(0, 20))}`)
