/**
 * DERIV_TS — the four DERIVATION types audited against real corpus.
 *
 * `exports`, `imports`, `references` and `uses` are the labels TypeScript EMITS
 * and the differential did not COMPARE. Two of them (`references`, `uses`) had a
 * finished oracle in `oracles/` with no consumer; two (`imports`, `exports`) had
 * an oracle that was never registered. All four were therefore "stored and
 * compared against nothing", and an edge nobody compares ships a bug invisibly.
 *
 * This script is the measurement instrument for that claim. It does NOT
 * re-implement the differential: it imports the differential's own truth
 * builders and its own allowlist expression, evaluates both, and applies the
 * differential's own matching rule, so a number printed here is the number the
 * differential would print for the same file once the label is admitted. What it
 * adds over the differential is the lane report: per-label buckets, and a FAMILY
 * for every disagreement, because "351 rows" is not triageable and "108 of them
 * are the same mention under the other label" is.
 *
 * Independence is unchanged: the oracle modules under `oracles/` are the lane's,
 * `deriveTreeEdges`/`deriveTypeScriptEdges` are the harness's, and none of them
 * calls the analyzer. Reusing the differential's COMPARISON is not the same as
 * reusing its oracle — a shared comparison rule is what makes two lanes'
 * numbers comparable, and a shared GRAMMAR bug is still invisible, which is why
 * the report says so rather than claiming more.
 *
 * Usage:
 *   bun run script/m14/ts-deriv-oracle-audit.ts [--files N] [--repo NAME]
 *         [--out path.json] [--admit imports,exports] [--family-cap N]
 */

import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { deriveTreeEdges, deriveTypeScriptEdges, normTarget } from "./differential"
import { deriveTypeScriptContainsTruth } from "./oracles/typescript-contains"
import { deriveTypeScriptReferencesTruth } from "./oracles/typescript-references"
import { deriveTypeScriptUsesTruth } from "./oracles/typescript-uses"
import { deriveImportsExportsTruth } from "./oracles/typescript-imports-exports"

const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..")
const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const FILES = Number(argOf("--files") ?? "200")
const REPO = argOf("--repo") ?? "typescript"
const OUT = argOf("--out")
const ADMIT = new Set((argOf("--admit") ?? "").split(",").map((s) => s.trim()).filter(Boolean))
const FAMILY_CAP = Number(argOf("--family-cap") ?? "40")
const MAX_BYTES = Number(argOf("--max-bytes") ?? String(1024 * 1024))

const ALL_TYPES = ["calls", "contains", "exports", "extends", "implements", "imports", "instantiates", "overrides", "references", "uses"] as const

// ── the allowlist, EXTRACTED from differential.ts, never copied ───────────────
// Same extraction verify-label-coverage.ts performs, so this script cannot drift
// into believing a label is admitted when the harness drops it.
function extractAllowlistExpr(src: string): string {
  const MARK = '.filter((r: any) => ["extends", "implements", "instantiates"'
  const at = src.indexOf(MARK)
  if (at < 0) throw new Error("allowlist marker not found — differential.ts changed shape")
  const bodyStart = src.indexOf("=>", at) + 2
  let depth = 0
  let inStr: string | null = null
  let inLine = false
  let inBlock = false
  for (let i = bodyStart; i < src.length; i++) {
    const c = src[i]
    const n = src[i + 1]
    if (inLine) { if (c === "\n") inLine = false; continue }
    if (inBlock) { if (c === "*" && n === "/") { inBlock = false; i++ } continue }
    if (inStr) { if (c === "\\") { i++; continue } if (c === inStr) inStr = null; continue }
    if (c === "/" && n === "/") { inLine = true; i++; continue }
    if (c === "/" && n === "*") { inBlock = true; i++; continue }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue }
    if (c === "[" || c === "(" || c === "{") { depth++; continue }
    if (c === "]" || c === ")" || c === "}") { depth--; if (depth === 0 && c === "]") return src.slice(bodyStart, i + 1) }
  }
  throw new Error("allowlist expression end not found")
}
const ALLOWLIST_EXPR = extractAllowlistExpr(fs.readFileSync(path.join(ROOT, "script/m14/differential.ts"), "utf8"))
const allowFor = (lang: string): Set<string> => {
  const base = new Set<string>(new Function("lang", `return ${ALLOWLIST_EXPR}`)(lang) as string[])
  for (const l of ADMIT) base.add(l)
  return base
}

// ── corpus ───────────────────────────────────────────────────────────────────
function gitTracked(dir: string): string[] {
  try {
    return execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { return [] }
}
const repoDir = path.join(CORPUS, REPO)
const admitted: string[] = []
for (const rel of gitTracked(repoDir).sort()) {
  if (!/\.(ts|tsx|mts|cts)$/.test(rel)) continue
  if (/\.d\.ts$/.test(rel)) continue
  const abs = path.join(repoDir, rel)
  try { if (fs.statSync(abs).size > MAX_BYTES) continue } catch { continue }
  admitted.push(abs)
  if (FILES > 0 && admitted.length >= FILES) break
}
const rev = (() => { try { return execFileSync("git", ["-C", repoDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { return "unknown" } })()
if (!admitted.length) {
  console.error(`no admitted .ts files under ${repoDir}`)
  process.exit(2)
}

// ── per-label accumulators ───────────────────────────────────────────────────
type Bucket = { truth: number; covered: number; missing: number; analyzer: number; unexplained: number; heuristic: number; files: Set<string> }
const mk = (): Bucket => ({ truth: 0, covered: 0, missing: 0, analyzer: 0, unexplained: 0, heuristic: 0, files: new Set() })
const B: Record<string, Bucket> = {}
for (const t of ALL_TYPES) B[t] = mk()
const samples: Record<string, string[]> = {}
for (const t of ALL_TYPES) samples[t] = []

/** Family of a disagreement, so a bucket count is triageable. */
type Fam = { label: string; dir: "MISSING" | "UNEXPLAINED"; family: string; rows: string[]; count: number }
const families = new Map<string, Fam>()
const fam = (label: string, dir: "MISSING" | "UNEXPLAINED", family: string, row: string): void => {
  const k = `${label}|${dir}|${family}`
  const f = families.get(k) ?? { label, dir, family, rows: [], count: 0 }
  f.count++
  if (f.rows.length < FAMILY_CAP) f.rows.push(row)
  families.set(k, f)
}

let parsed = 0, failed = 0
let errorNodes = 0
const errorFiles: string[] = []

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-typescript.wasm")))
const parser = new P()
parser.setLanguage(gl)
const mod: any = await import(path.join(ROOT, "src/ast/real-typescript-analyzer.ts"))
const analyzer = new mod.RealTypeScriptAnalyzer()
const allow = allowFor("typescript")

for (const abs of admitted) {
  const rel = path.relative(repoDir, abs)
  let content: string, root: any, tree: any
  try { content = fs.readFileSync(abs, "utf8") } catch { failed++; continue }
  try { tree = parser.parse(content); root = tree?.rootNode } catch { failed++; try { tree?.delete?.() } catch {}; continue }
  if (!root) { failed++; try { tree?.delete?.() } catch {}; continue }
  let errs = 0
  { const st: any[] = [root]; while (st.length) { const n = st.pop()!; if (n.type === "ERROR" || n.isMissing) errs++; for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) } } }
  if (errs) { errorNodes += errs; errorFiles.push(`${rel} (${errs})`) }
  let result: any
  try { result = await analyzer.analyze(root, content, rel) } catch { failed++; try { tree?.delete?.() } catch {}; continue }
  parsed++

  // ── truth: exactly what differential.ts assembles for lang === "typescript",
  //    plus the proposed imports/exports registration.
  const moduleLeaf = path.basename(rel, path.extname(rel))
  let truth: any[] = []
  try {
    truth = [
      ...deriveTreeEdges(root, "typescript"),
      ...deriveTypeScriptContainsTruth(root),
      ...deriveTypeScriptReferencesTruth(root),
      ...deriveTypeScriptUsesTruth(root),
      ...deriveTypeScriptEdges(root),
      ...deriveImportsExportsTruth(root, moduleLeaf),
    ]
  } catch (e) {
    failed++
    try { tree?.delete?.() } catch {}
    continue
  }
  truth = truth.filter((t: any) => String(t.target ?? "").trim().length > 0)

  const rels = (result.relationships ?? [])
    .map((r: any) => ({
      label: String(r.type ?? r.relationshipType ?? ""),
      target: String(r.target ?? r.to ?? r.toSymbol ?? ""),
      from: String(r.source ?? r.from ?? r.fromSymbol ?? ""),
      confidence: typeof r.confidence === "number" ? r.confidence : 1,
      meta: r.metadata ?? {},
    }))
    .filter((r: any) => allow.has(r.label))
    .filter((r: any, i: number, arr: any[]) => { const k = r.label + "|" + r.target; return i === arr.findIndex((x: any) => (x.label + "|" + x.target) === k) })

  // Index both sides by label|target so the family test is a lookup, not a scan.
  const tByLabel = new Map<string, Set<string>>()
  const rByLabel = new Map<string, Set<string>>()
  for (const t of truth) { const k = String(t.label); const s = tByLabel.get(k) ?? new Set<string>(); s.add(String(t.target)); tByLabel.set(k, s) }
  for (const r of rels) { const k = r.label; const s = rByLabel.get(k) ?? new Set<string>(); s.add(r.target); rByLabel.set(k, s) }
  // Two indexes, because "the same row under another label" and "this target
  // appears somewhere else in the file" are different findings and collapsing
  // them produces a family nobody can act on. The differential matches on
  // (label, target) site-agnostically; the FAMILY test asks the sharper
  // question — same SOURCE and same TARGET, different label.
  const tPairs = new Map<string, Set<string>>()
  const rPairs = new Map<string, Set<string>>()
  for (const t of truth) { const k = `${t.from ?? ""}|${normTarget(String(t.target))}`; const s = tPairs.get(k) ?? new Set<string>(); s.add(String(t.label)); tPairs.set(k, s) }
  for (const r of rels) { const k = `${r.from}|${normTarget(r.target)}`; const s = rPairs.get(k) ?? new Set<string>(); s.add(r.label); rPairs.set(k, s) }
  const swapLabels = (pairs: Map<string, Set<string>>, label: string, from: string, target: string): string[] =>
    [...(pairs.get(`${from}|${normTarget(target)}`) ?? [])].filter((l) => l !== label)
  const otherLabelHas = (side: Map<string, Set<string>>, label: string, target: string): string[] => {
    const nt = normTarget(target)
    const out: string[] = []
    for (const [l, s] of side) {
      if (l === label) continue
      for (const t of s) if (normTarget(t) === nt || String(t).includes(nt) || nt.includes(String(t))) { out.push(l); break }
    }
    return out
  }

  for (const t of truth) {
    const label = String(t.label)
    const b = B[label] ?? (B[label] = mk())
    b.truth++
    if (!B[label]) continue
    b.files.add(rel)
    const hit = rels.some((r: any) => r.label === label && normTarget(r.target) === normTarget(String(t.target)))
    if (hit) { b.covered++; continue }
    b.missing++
    const row = `${rel} :: ${t.from ?? "?"} -> ${t.target}`
    if (samples[label].length < 400) samples[label].push(`MISSING ${row}`)
    const swap = swapLabels(rPairs, label, String(t.from ?? ""), String(t.target))
    const elsewhere = otherLabelHas(rByLabel, label, String(t.target))
    if (swap.length) fam(label, "MISSING", `LABEL_SWAP same source+target is a ${swap.join("/")} edge`, row)
    else if (t.why) fam(label, "MISSING", `ORACLE_SURFACE_${t.why}`, row)
    else if (elsewhere.length) fam(label, "MISSING", `TARGET_ELSEWHERE the target occurs as ${elsewhere.join("/")} but from a different source`, row)
    else fam(label, "MISSING", "UNCLASSIFIED", row)
  }
  for (const r of rels) {
    const label = r.label
    const b = B[label] ?? (B[label] = mk())
    b.analyzer++
    const hit = truth.some((te: any) => te.label === label && (normTarget(String(te.target)) === normTarget(r.target) || String(te.target).includes(normTarget(r.target))))
    if (hit) continue
    if (r.confidence < 0.7) { b.heuristic++; continue }
    b.unexplained++
    const row = `${rel} :: ${r.from} -> ${r.target} conf=${r.confidence} meta=${JSON.stringify(r.meta).slice(0, 80)}`
    if (samples[label].length < 400) samples[label].push(`UNEXPLAINED ${row}`)
    const swap = swapLabels(tPairs, label, r.from, r.target)
    const elsewhere = otherLabelHas(tByLabel, label, r.target)
    if (swap.length) fam(label, "UNEXPLAINED", `LABEL_SWAP same source+target truth calls it ${swap.join("/")}`, row)
    else if (elsewhere.length) fam(label, "UNEXPLAINED", `TARGET_ELSEWHERE truth has the target as ${elsewhere.join("/")} from another source`, row)
    else fam(label, "UNEXPLAINED", "UNCLASSIFIED", row)
  }
  try { tree?.delete?.() } catch {}
}

// ── report ───────────────────────────────────────────────────────────────────
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "-")
console.log(`DERIV_TS oracle audit — typescript`)
console.log(`corpus ${REPO}@${rev.slice(0, 10)}  admitted ${admitted.length}  parsed ${parsed}  failed ${failed}`)
console.log(`ERROR/MISSING nodes: ${errorNodes} across ${errorFiles.length} file(s)${errorFiles.length ? " — " + errorFiles.slice(0, 6).join(", ") : ""}`)
console.log(`allowlist: ${[...allow].sort().join(" ")}`)
console.log(`labels additionally admitted by --admit: ${ADMIT.size ? [...ADMIT].join(" ") : "(none)"}\n`)
console.log(`${w("label", 14)}${w("truth", 9)}${w("covered", 9)}${w("MISSING", 9)}${w("cov%", 8)}${w("analyzer", 10)}${w("unexpl", 8)}${w("unexp%", 8)}${w("heur", 6)}${w("files", 7)}`)
console.log("-".repeat(96))
const out: any = { at: new Date().toISOString(), corpus: REPO, revision: rev, filesAdmitted: admitted.length, filesParsed: parsed, failed, errorNodes, errorFiles, allowlist: [...allow].sort(), admittedLabels: [...ADMIT], types: {}, families: [] }
for (const t of ALL_TYPES) {
  const b = B[t]
  out.types[t] = { truth: b.truth, covered: b.covered, missing: b.missing, coveragePct: b.truth ? +(100 * b.covered / b.truth).toFixed(1) : null, analyzer: b.analyzer, unexplained: b.unexplained, unexplainedPct: b.analyzer ? +(100 * b.unexplained / b.analyzer).toFixed(1) : null, heuristic: b.heuristic, files: b.files.size, fileListSample: [...b.files].slice(0, 8), samples: samples[t] }
  console.log(`${w(t, 14)}${w(String(b.truth), 9)}${w(String(b.covered), 9)}${w(String(b.missing), 9)}${w(pct(b.covered, b.truth), 8)}${w(String(b.analyzer), 10)}${w(String(b.unexplained), 8)}${w(pct(b.unexplained, b.analyzer), 8)}${w(String(b.heuristic), 6)}${w(String(b.files.size), 7)}`)
}
console.log("\nFAMILIES")
const sorted = [...families.values()].sort((a, b) => b.count - a.count)
for (const f of sorted) {
  out.families.push({ label: f.label, dir: f.dir, family: f.family, count: f.count, rows: f.rows.slice(0, 6) })
  console.log(`  ${f.label.padEnd(13)} ${f.dir.padEnd(11)} ${String(f.count).padStart(6)}  ${f.family}`)
  for (const r of f.rows.slice(0, 3)) console.log(`        ${r}`)
}
const silent = ALL_TYPES.filter((t) => B[t].truth === 0 && B[t].analyzer === 0)
console.log(`\nSILENT (no truth row and no analyzer row): ${silent.length ? silent.join(" ") : "(none)"}`)
if (OUT) { fs.writeFileSync(OUT, JSON.stringify(out, null, 2)); console.log(`\nwrote ${OUT}`) }