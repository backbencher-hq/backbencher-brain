/**
 * POWERSHELL — SECTION E, RECONCILED ROW BY ROW instead of pinned as a residual.
 *
 * ## THE QUESTION THIS ANSWERS
 *
 * Section E (`completeness-inventory.ts:verifySectionE`) passes a lane only when
 * `differential-baseline.json` carries a floor row for `powershell:powershell` with
 * `missing === 0 && unexplained === 0`. The lane-scoped F5 draw has never produced that:
 * the latest draw read **109 MISSING / 82 unexplained** over 6,012 truth edges, and
 * `mergeBaseline()` REFUSES to pin a non-zero residual by design (#871 §2). Pinning it
 * would turn a red cell green while burying a measured wall, so the alternative is the
 * one this file takes: adjudicate every row.
 *
 * ## WHY A SECOND INSTRUMENT AND NOT A BIGGER DRAW
 *
 * The harness prints at most 40 samples (`differential.ts:26309`) and keeps at most 300,
 * so 191 disagreeing rows cannot all be named from a run log. Worse, the draw ROTATES
 * (cold-pool), so two runs are two different populations and a fix cannot be confirmed
 * against the rows that motivated it.
 *
 * This instrument is deterministic: it measures every admitted file of the named
 * repositories, in sorted order, once. It imports the harness's OWN oracle and its OWN
 * normalizers (`deriveTreeEdges`, `derivePowershellEdges`, `normTarget`, `auditTarget` —
 * `differential.ts` exports all four and guards `main()` behind an argv test, so
 * importing it does not run a sweep), and it re-implements ONLY the comparison, citing
 * the harness lines it mirrors. A comparison that disagreed with the harness would be
 * measuring itself, so the totals are cross-checked against the harness's own row when
 * both are run on the same file set.
 *
 * ## WHAT IT PRINTS
 *
 * Every MISSING row (truth the analyzer did not publish) and every UNEXPLAINED row
 * (analyzer output no truth row supports), with file, label, source, target, line and
 * confidence — plus a classification that is COMPUTED, not guessed:
 *
 *   same-leaf-different-spelling : a truth row of the same label and leaf exists, so the
 *                                  disagreement is the target's SPELLING (a qualifier, a
 *                                  sigil, a range), not a missing or invented fact
 *   label-mismatch               : the same (source, leaf) exists under a DIFFERENT label
 *   no-truth-at-all              : neither side has anything like it — an oracle blind
 *                                  spot or an analyzer fabrication, to be adjudicated by hand
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/powershell/reconcile-f5.mts --repo powershell
 *   npx tsx validation/m14/fixtures/powershell/reconcile-f5.mts --all --json /tmp/ps-f5.json
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs"
import * as path from "node:path"
// PRODUCTION DECODES BY BOM; this instrument has to as well. `pool-worker.ts` reads bytes and
// hands them to `decodeSourceText`, which STRIPS a leading UTF-8 BOM; `readFileSync(p, "utf8")`
// keeps it. On this corpus that is ONE file in 553
// (`test/powershell/Language/Parser/MethodInvocation.Tests.ps1`, which opens with a BOM), and
// the grammar wraps its whole program in an ERROR node because of it — so the oracle derived
// 37 rows where the analyzer published 127, and the 90-row gap read as analyzer fabrications
// when the truth was the side that could not see the file. Found by tracing one
// unexplained `contains MethodInvocation.Tests.ps1 -> ast` back to an `ERROR!ERR@1` ancestor.
import { decodeSourceText } from "../../../../src/util/source-text"
import * as ASTEngine from "../../../../src/ast/engine"
import { RealPowershellAnalyzer } from "../../../../src/ast/real-powershell-analyzer"
import {
  derivePowershellEdges,
  deriveTreeEdges,
  normTarget,
  auditTarget,
} from "../../../../script/m14/differential"
import type { Node } from "web-tree-sitter"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const EXTS = ["ps1", "psm1", "psd1"]
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  return i < 0 ? undefined : argv[i + 1]
}
const REPO = argOf("--repo")
const ALL = argv.includes("--all")
const JSON_OUT = argOf("--json")
const QUIET = argv.includes("--quiet")
/** A path substring filter, for iterating on one disagreement class without re-walking 546 files. */
const ONLY = argOf("--only")

/**
 * THE COMPARED-LABEL ALLOWLIST, MIRRORED FROM `differential.ts`.
 *
 * The harness filters the ANALYZER side before comparing (differential.ts:25377's
 * `.filter(...)`). For powershell the filter admits the four head labels
 * (`extends`, `implements`, `instantiates`, `overrides`), then `calls`/`uses` from the
 * powershell list at 25448, then `exports`/`references` at 25778-25779,
 * `extends`/`implements`/`overrides` again at 25791, `imports`/`part_of` at 25799 and
 * `uses`/`contains` at 25727. The union is what this set holds. A label outside it is
 * outside the comparison on BOTH sides — mirroring that is what makes the totals
 * comparable, and the set is printed in the report so a reader can check it.
 */
const COMPARED = new Set([
  "extends", "implements", "instantiates", "overrides",
  "calls", "uses", "exports", "references", "imports", "part_of", "contains",
])

/** `differential.ts:25976` — a path-like import is compared EXACTLY, not leaf-collapsed. */
const PATH_EXT = new Set(["ps1", "psm1", "psd1", "sol", "h", "hpp", "hxx", "c", "cc", "cpp", "cxx", "cu",
  "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts", "py", "pyi", "pyw", "dart", "rb", "java", "go",
  "rs", "json", "yaml", "yml", "toml", "md", "css", "scss", "sass", "html", "proto", "hrl", "erl"])
const isPathLikeImport = (t: string): boolean => {
  if (t.length === 0) return false
  if (t.startsWith(".") || t.includes("/") || t.includes("\\")) return true
  const dot = t.lastIndexOf(".")
  if (dot > 0 && dot < t.length - 1) return PATH_EXT.has(t.slice(dot + 1).toLowerCase())
  return false
}
/** `differential.ts:26001` — the harness's own match key. */
const matchKey = (label: string, target: unknown): string => {
  const t = String(target ?? "")
  return (label === "imports" || label === "part_of") && isPathLikeImport(t)
    ? `EXACT:${t}`
    : normTarget(auditTarget(t))
}
/**
 * `differential.ts:26014` — the harness's coverage test, both directions:
 *   truth  matches when some rel shares the label and the match key;
 *   rel    matches when a truth row shares the label and either the match key OR
 *          (`label !== "imports"`) CONTAINS the rel's normalized target.
 * The containment fallback is the harness's, not this file's invention: it is why a
 * truth row for `Foo.Bar.Baz` explains an analyzer row for `Baz`.
 */
const truthMatchesRel = (t: { label: string; target: string }, r: { label: string; target: string }): boolean =>
  t.label === r.label && matchKey(t.label, t.target) === matchKey(r.label, r.target)
const relMatchesTruth = (r: { label: string; target: string }, t: { label: string; target: string }): boolean =>
  t.label === r.label &&
  (matchKey(t.label, t.target) === matchKey(r.label, r.target) ||
    (r.label !== "imports" && t.target.includes(normTarget(auditTarget(r.target)))))

interface TruthRow { label: string; from: string; target: string }
interface AnalyzerRow { label: string; from: string; target: string; line: number; confidence: number }

function reposCarryingPowershell(): string[] {
  if (REPO) return [REPO]
  const out: string[] = []
  for (const name of readdirSync(CR).sort()) {
    if (!ALL && !existsSync(path.join(CR, name))) continue
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    let tracked: string
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
    } catch { continue }
    const any = tracked.split("\0").some((rel) => EXTS.some((e) => rel.toLowerCase().endsWith(`.${e}`)))
    if (any) out.push(name)
  }
  return out
}

/**
 * THE HARNESS'S OWN DISCOVERY, mirrored (`differential.ts:23461-23486`): a filesystem
 * walk that skips dot/node_modules/build/target directories and admits by extension.
 * No size cap — the harness has none — so a 1 MB file the arbiter excludes is still
 * measured here, which is the honest mirror of the instrument Section E reads.
 */
function discover(repoDir: string): string[] {
  const files: string[] = []
  const scan = (d: string) => {
    let entries
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (!/^(\.|node_modules|build|target)/.test(e.name)) scan(p) }
      else if (EXTS.some((x) => e.name.endsWith("." + x))) files.push(p)
    }
  }
  scan(repoDir)
  return files.sort()
}

interface FileResult {
  repo: string
  file: string
  truth: number
  analyzer: number
  missing: Array<TruthRow & { kind: string; sameLeaf?: string; nearLabel?: string }>
  unexplained: Array<AnalyzerRow & { kind: string; nearTruth?: string; nearLabel?: string }>
}

/**
 * The classification is computed against the WHOLE file's rows, so a spelling near-miss is
 * visible. `nearLabel` is the label of the near row, because "the same fact under another
 * label" is a sentence that means nothing until the other label is named.
 */
function classifyMissing(t: TruthRow, rels: AnalyzerRow[]): { kind: string; sameLeaf?: string; nearLabel?: string } {
  const leaf = normTarget(auditTarget(t.target)).toLowerCase()
  const sameLabel = rels.filter((r) => r.label === t.label && normTarget(auditTarget(r.target)).toLowerCase() === leaf)
  if (sameLabel.length > 0) return { kind: "same-leaf-different-spelling", sameLeaf: sameLabel[0].target }
  const sameFact = rels.filter((r) => r.from === t.from && normTarget(auditTarget(r.target)).toLowerCase() === leaf)
  if (sameFact.length > 0) return { kind: "label-mismatch", sameLeaf: sameFact[0].target, nearLabel: sameFact[0].label }
  return { kind: "no-analyzer-edge" }
}
function classifyUnexplained(r: AnalyzerRow, truth: TruthRow[]): { kind: string; nearTruth?: string; nearLabel?: string } {
  const leaf = normTarget(auditTarget(r.target)).toLowerCase()
  const sameLabel = truth.filter((t) => t.label === r.label && normTarget(auditTarget(t.target)).toLowerCase() === leaf)
  if (sameLabel.length > 0) return { kind: "same-leaf-different-spelling", nearTruth: sameLabel[0].target }
  const sameFact = truth.filter((t) => t.from === r.from && normTarget(auditTarget(t.target)).toLowerCase() === leaf)
  if (sameFact.length > 0) return { kind: "label-mismatch", nearTruth: sameFact[0].target, nearLabel: sameFact[0].label }
  return { kind: "no-truth-row" }
}

const parser = await ASTEngine.getParser("powershell" as ASTEngine.SupportedLanguage)
const analyzer = new RealPowershellAnalyzer()
const results: FileResult[] = []
let filesParsed = 0
let filesFailed = 0
const repos = reposCarryingPowershell()
const started = Date.now()

for (const repo of repos) {
  const repoDir = path.join(CR, repo)
  for (const abs of discover(repoDir)) {
    const rel = path.relative(repoDir, abs)
    if (ONLY && !rel.includes(ONLY)) continue
    let content: string
    try { content = decodeSourceText(readFileSync(abs)).text } catch { filesFailed++; continue }
    let tree: any
    try { tree = parser.parse(content) } catch { filesFailed++; continue }
    const root: Node | undefined = tree?.rootNode
    if (!root) { filesFailed++; continue }
    filesParsed++
    const moduleName = rel.split("/").pop() ?? "script.ps1"
    let truth: TruthRow[]
    let rels: AnalyzerRow[]
    try {
      truth = [
        ...deriveTreeEdges(root, "powershell"),
        ...derivePowershellEdges(root, moduleName),
      ].filter((t: any) => COMPARED.has(String(t.label)) && String(t.target ?? "").trim().length > 0)
      const res: any = analyzer.analyze(root, content, rel)
      rels = (res.relationships ?? [])
        .map((x: any) => ({
          label: String(x.type ?? x.relationshipType ?? ""),
          from: String(x.source ?? x.from ?? ""),
          target: String(x.target ?? x.to ?? ""),
          line: x.line_number ?? 0,
          confidence: typeof x.confidence === "number" ? x.confidence : 1,
        }))
        .filter((r: AnalyzerRow) => COMPARED.has(r.label))
    } catch (e) {
      filesFailed++
      if (!QUIET) console.log(`  [throw] ${repo}/${rel}: ${String((e as Error)?.message ?? e).slice(0, 160)}`)
      continue
    }
    const missing: FileResult["missing"] = []
    for (const t of truth) {
      if (!rels.some((r) => truthMatchesRel(t, r))) missing.push({ ...t, ...classifyMissing(t, rels) })
    }
    const unexplained: FileResult["unexplained"] = []
    for (const r of rels) {
      if (truth.some((t) => relMatchesTruth(r, t))) continue
      if (r.confidence < 0.7) continue // DECLARED HEURISTIC, not fabrication (harness rule)
      unexplained.push({ ...r, ...classifyUnexplained(r, truth) })
    }
    if (missing.length || unexplained.length) {
      results.push({ repo, file: rel, truth: truth.length, analyzer: rels.length, missing, unexplained })
    }
    try { tree?.delete?.() } catch { /* freed by the parser */ }
  }
}

const sum = (n: number[]) => n.reduce((a, b) => a + b, 0)
const truthTotal = sum(results.map((r) => r.truth))
const analyzerTotal = sum(results.map((r) => r.analyzer))
const missingTotal = sum(results.map((r) => r.missing.length))
const unexplainedTotal = sum(results.map((r) => r.unexplained.length))
const byLabel = (rows: Array<{ label: string }>) => {
  const m = new Map<string, number>()
  for (const r of rows) m.set(r.label, (m.get(r.label) ?? 0) + 1)
  return [...m].sort((a, b) => b[1] - a[1])
}

console.log("powershell F5 reconciliation — the harness's own oracle and matchers, every admitted file, once")
console.log(`corpus root     ${CR}`)
console.log(`repos measured  ${repos.length}: ${repos.join(", ")}`)
console.log(`compared labels ${[...COMPARED].sort().join(", ")}`)
console.log(`files parsed    ${filesParsed}   failed ${filesFailed}   seconds ${((Date.now() - started) / 1000).toFixed(1)}`)
console.log(`files carrying at least one disagreement: ${results.length}`)
console.log("")
console.log(`truth rows ${truthTotal} | analyzer rows ${analyzerTotal}`)
console.log(`MISSING ${missingTotal}   UNEXPLAINED ${unexplainedTotal}`)
console.log(`missing-by-label:     ${byLabel(results.flatMap((r) => r.missing)).map(([k, v]) => `${k}=${v}`).join(", ") || "(none)"}`)
console.log(`unexplained-by-label: ${byLabel(results.flatMap((r) => r.unexplained)).map(([k, v]) => `${k}=${v}`).join(", ") || "(none)"}`)
const kindTally = (rows: Array<{ kind: string }>) => {
  const m = new Map<string, number>()
  for (const r of rows) m.set(r.kind, (m.get(r.kind) ?? 0) + 1)
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(", ") || "(none)"
}
console.log(`missing classes:     ${kindTally(results.flatMap((r) => r.missing))}`)
console.log(`unexplained classes: ${kindTally(results.flatMap((r) => r.unexplained))}`)

if (!QUIET) {
  for (const r of results) {
    console.log("")
    console.log(`${r.repo}/${r.file}  truth=${r.truth} analyzer=${r.analyzer}  MISSING=${r.missing.length} UNEXPLAINED=${r.unexplained.length}`)
    for (const m of r.missing) console.log(`  MISSING      ${m.label} ${m.from} -> ${m.target}  [${m.kind}${m.sameLeaf ? ` as ${m.sameLeaf}` : ""}${m.nearLabel ? ` under ${m.nearLabel}` : ""}]`)
    for (const u of r.unexplained) console.log(`  UNEXPLAINED  ${u.label} ${u.from} -> ${u.target} (line ${u.line}, conf ${u.confidence})  [${u.kind}${u.nearTruth ? ` vs ${u.nearTruth}` : ""}${u.nearLabel ? ` under ${u.nearLabel}` : ""}]`)
  }
}

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({ totals: { truthTotal, analyzerTotal, missingTotal, unexplainedTotal }, results }, null, 2) + "\n")
  console.log(`\nwrote ${JSON_OUT}`)
}
process.exit(missingTotal === 0 && unexplainedTotal === 0 ? 0 : 1)
