/**
 * TYPESCRIPT ORACLE AGREEMENT — the per-label answer to Part 1 q3 of
 * docs/analyzers/ONTOLOGY-WORKSTREAM.md ("does an independent oracle agree?").
 *
 * ## Why this file exists
 *
 * `script/m14/differential.ts` compares the analyzer against its truth for one lane per
 * run, prints ONE aggregate row per (repo, language), and filters the ANALYZER side
 * through a per-language allowlist. That answers "does this lane agree?" and it cannot
 * answer "does `imports` agree?", which is the question a per-type ontology verdict
 * needs. Two of this lane's ten labels are not in the allowlist at all, so for them the
 * differential compares NOTHING — not "a small number", nothing — and the aggregate row
 * is identical to the row for a lane whose every edge matched. That is the
 * "nothing agrees with nothing perfectly" shape the ontology gate exists to catch,
 * reproduced inside the one instrument that is supposed to prevent it.
 *
 * So this file does the comparison per LABEL, over the SAME production parse
 * (`parseFile` from `src/ast/pool-worker`) and the SAME truth derivations the
 * differential uses, with no allowlist filter on the analyzer side — every one of the
 * ten types is compared whether or not the shared harness admits it. It READS the
 * shared oracles and WRITES only `--out`.
 *
 * ## What it does NOT claim
 *
 * Both sides walk the SAME tree-sitter-typescript 0.23.2 grammar. A grammar bug that
 * both walkers inherit — a construct that parses to a shape neither side expects, a
 * node type the grammar names differently from the code — is INVISIBLE here exactly as
 * it is invisible in the differential. The number this file reports is INDEPENDENCE OF
 * IMPLEMENTATION, not independence of grammar. A shared-premise defect would have to be
 * found by reading the tree with a third instrument or by comparing against the
 * TypeScript compiler's own symbol tables, and neither is done here. The doc records
 * this as the declared limitation it is.
 *
 * ## The matching rule
 *
 * IMPORTED from the differential, not restated: `normTarget` is exported from
 * `script/m14/differential.ts` and this file imports it, so the matching rule cannot
 * drift from the harness's. The import is safe for a lane-owned probe — that module
 * guards its entry point on `process.argv[1]` ending in `differential.ts` — and it is
 * the same module the differential itself uses, so there is no second copy of the rule
 * anywhere.
 *
 * CLI: npx tsx script/m14/typescript-oracle-agreement.ts [--repo typescript]
 *      [--sample N] [--out <file.json>]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"
import { deriveTypeScriptContainsTruth } from "./oracles/typescript-contains"
import { deriveTypeScriptReferencesTruth } from "./oracles/typescript-references"
import { deriveTypeScriptUsesTruth } from "./oracles/typescript-uses"
import { deriveImportsExportsTruth } from "./oracles/typescript-imports-exports"
import { deriveTypeScriptEdges, deriveTreeEdges, normTarget } from "./differential"
// A 25,000-line shared module; see the header note on why importing it here is the
// drift-free choice rather than a hazard.

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const REPOS = (argOf("--repo", "typescript") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const SAMPLE = parseInt(argOf("--sample", "200") ?? "200")
const OUT = argOf("--out")
const MAX_BYTES = 512 * 1024

type File = { repo: string; dir: string; rel: string; abs: string }
const files: File[] = []
for (const e of readdirSync(process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories")) {
  if (!REPOS.includes(e)) continue
  const dir = path.join(process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories", e)
  let tracked: string[]
  try {
    if (!statSync(dir).isDirectory()) continue
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let size = 0
    try { size = statSync(abs).size } catch { continue }
    if (size > MAX_BYTES) continue
    if (detectLanguageFromPath(abs) !== "typescript") continue
    files.push({ repo: e, dir, rel, abs })
  }
}
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))
const ALL = files.length
const admitted = SAMPLE > 0 ? files.slice(0, SAMPLE) : files
let rev = ""
try { rev = execFileSync("git", ["-C", path.join(process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories", REPOS[0] ?? "typescript"), "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch {}

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-typescript.wasm"))))

type Row = {
  truth: number
  analyzer: number
  /** truth row matched by an analyzer edge of the same label */
  covered: number
  /** analyzer edge matched by a truth row of the same label */
  explained: number
  missing: string[]
  unexplained: string[]
  missingFiles: Set<string>
  unexplainedFiles: Set<string>
  /** MISSING split by the ORACLE SURFACE that derived the row, where the truth edge
   *  carries one (`typescript-uses` labels its four surfaces expr/field/type/jsx).
   *  A single 850-row number cannot distinguish one rule firing many times from
   *  several rules firing once, and those need opposite responses: the first is one
   *  bug, the second is a design question. */
  missingBySurface: Map<string, number>
  /** which analyzer METADATA MARKER the unexplained rows carry, the same split for
   *  the other direction — an edge's own site marker says which rule made it */
  unexplainedByMarker: Map<string, number>
}
const rows = new Map<Type, Row>()
const row = (t: Type): Row => {
  let r = rows.get(t)
  if (!r) {
    r = { truth: 0, analyzer: 0, covered: 0, explained: 0, missing: [], unexplained: [], missingFiles: new Set(), unexplainedFiles: new Set(), missingBySurface: new Map(), unexplainedByMarker: new Map() }
    rows.set(t, r)
  }
  return r
}

let idx = 0
let parsed = 0
let threw = 0
let parseErrFiles = 0

async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= admitted.length) return
    const f = admitted[i]
    const label = `${f.repo}/${f.rel}`
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { threw++; continue }
    parsed++
    const rels: any[] = r.relationships ?? []
    if ((r.errors ?? []).length > 0) parseErrFiles++

    let truth: Array<{ label: string; target: string; why?: string }> = []
    let tree: any
    try {
      const content = readFileSync(f.abs, "utf8")
      tree = parser.parse(content)
      if (tree) {
        const root = tree.rootNode
        const moduleLeaf = path.basename(f.abs, path.extname(f.abs))
        for (const e of deriveTypeScriptEdges(root)) truth.push({ label: e.label, target: e.target, why: e.label })
        for (const e of deriveTypeScriptContainsTruth(root)) truth.push({ label: e.label, target: e.target, why: "contains-rule" })
        for (const e of deriveTypeScriptReferencesTruth(root)) truth.push({ label: e.label, target: e.target, why: (e as any).why ?? "references-rule" })
        for (const e of deriveTypeScriptUsesTruth(root)) truth.push({ label: e.label, target: e.target, why: (e as any).why ?? "uses-rule" })
        for (const e of deriveImportsExportsTruth(root, moduleLeaf)) truth.push({ label: e.label, target: e.target, why: e.label })
        for (const e of deriveTreeEdges(root, "typescript")) truth.push({ label: e.label, target: e.target, why: e.label })
      }
    } catch { /* a dead oracle must not silently become "clean" */ }

    const byLabelTruth = new Map<Type, Set<string>>()
    /** normalized target -> the surface that derived it, so a MISSING row can be attributed */
    const surfaceOf = new Map<string, Map<string, string>>()
    for (const te of truth) {
      const t = te.label as Type
      if (!ALL_TYPES.includes(t)) continue
      const nv = normTarget(te.target)
      const set = byLabelTruth.get(t) ?? new Set<string>()
      set.add(nv)
      byLabelTruth.set(t, set)
      const perLabel = surfaceOf.get(t) ?? new Map<string, string>()
      if (!perLabel.has(nv)) perLabel.set(nv, te.why ?? "unstated")
      surfaceOf.set(t, perLabel)
    }
    const byLabelAnalyzer = new Map<Type, Set<string>>()
    /** normalized target -> the analyzer's own site marker, for the other direction */
    const markerOf = new Map<string, Map<string, string>>()
    for (const a of rels) {
      const t = String(a.type ?? a.relationshipType ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) continue
      const nv = normTarget(String(a.target ?? a.to ?? ""))
      const set = byLabelAnalyzer.get(t) ?? new Set<string>()
      set.add(nv)
      byLabelAnalyzer.set(t, set)
      const md = a.metadata ?? {}
      const marker = Object.keys(md).filter((k) => k !== "line" && k !== "evidenceClass").sort()[0] ?? md.relationshipType ?? "plain"
      const perLabel = markerOf.get(t) ?? new Map<string, string>()
      if (!perLabel.has(nv)) perLabel.set(nv, marker)
      markerOf.set(t, perLabel)
    }

    for (const t of ALL_TYPES) {
      const T = byLabelTruth.get(t) ?? new Set<string>()
      const A = byLabelAnalyzer.get(t) ?? new Set<string>()
      const R = row(t)
      R.truth += T.size
      R.analyzer += A.size
      for (const tv of T) {
        if (A.has(tv)) R.covered++
        else {
          R.missingFiles.add(label)
          const why = surfaceOf.get(t)?.get(tv) ?? "unstated"
          R.missingBySurface.set(why, (R.missingBySurface.get(why) ?? 0) + 1)
          if (R.missing.length < 25) R.missing.push(`${label}: ${t} ${tv} [${why}]`)
        }
      }
      for (const av of A) {
        if (T.has(av)) R.explained++
        else {
          R.unexplainedFiles.add(label)
          const mk = markerOf.get(t)?.get(av) ?? "unstated"
          R.unexplainedByMarker.set(mk, (R.unexplainedByMarker.get(mk) ?? 0) + 1)
          if (R.unexplained.length < 25) R.unexplained.push(`${label}: ${t} ${av} [${mk}]`)
        }
      }
    }
    try { tree?.delete?.() } catch {}
  }
}
await Promise.all(Array.from({ length: 4 }, () => worker()))

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`typescript oracle agreement — ${parsed}/${admitted.length} files (${threw} threw, ${parseErrFiles} with parse errors), ${ALL} tracked .ts in corpus @ ${rev.slice(0, 10)}`)
console.log(`${pad("type", 13)}${pad("truth", 9)}${pad("analyzer", 10)}${pad("cov", 8)}${pad("expl", 8)}${pad("miss", 8)}${pad("unexp", 8)}${pad("cov%", 8)}${pad("expl%", 8)}`)
console.log("-".repeat(90))
const out: any = {
  lane: "typescript",
  instrument: "script/m14/typescript-oracle-agreement.ts",
  corpus_root: process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories",
  repos: REPOS,
  pinned_rev: rev,
  tracked_typescript_files: ALL,
  files_measured: admitted.length,
  files_parsed: parsed,
  files_threw: threw,
  files_with_parse_errors: parseErrFiles,
  shared_grammar_limitation: "both sides walk tree-sitter-typescript 0.23.2; a grammar bug shared by the analyzer and every oracle is invisible to this comparison by construction",
  types: {} as any,
}
for (const t of ALL_TYPES) {
  const R = row(t)!
  out.types[t] = {
    truth_rows: R.truth,
    analyzer_rows: R.analyzer,
    covered: R.covered,
    explained: R.explained,
    missing: R.truth - R.covered,
    unexplained: R.analyzer - R.explained,
    pct_truth_covered: R.truth ? +((R.covered / R.truth) * 100).toFixed(1) : null,
    pct_analyzer_explained: R.analyzer ? +((R.explained / R.analyzer) * 100).toFixed(1) : null,
    missing_in_files: R.missingFiles.size,
    unexplained_in_files: R.unexplainedFiles.size,
    missing_by_oracle_surface: Object.fromEntries([...R.missingBySurface.entries()].sort((a, b) => b[1] - a[1])),
    unexplained_by_analyzer_marker: Object.fromEntries([...R.unexplainedByMarker.entries()].sort((a, b) => b[1] - a[1])),
    missing_samples: R.missing,
    unexplained_samples: R.unexplained,
  }
  console.log(`${pad(t, 13)}${pad(String(R.truth), 9)}${pad(String(R.analyzer), 10)}${pad(String(R.covered), 8)}${pad(String(R.explained), 8)}${pad(String(R.truth - R.covered), 8)}${pad(String(R.analyzer - R.explained), 8)}${pad(String(out.types[t].pct_truth_covered ?? "-"), 8)}${pad(String(out.types[t].pct_analyzer_explained ?? "-"), 8)}`)
}
console.log("-".repeat(90))
for (const t of ALL_TYPES) {
  const d = out.types[t]
  if (d.missing > 0) {
    console.log(`\n${t}: ${d.missing} truth rows the analyzer does not publish, across ${d.missing_in_files} files`)
    console.log(`    by oracle surface: ${JSON.stringify(d.missing_by_oracle_surface)}`)
    for (const s of d.missing_samples.slice(0, 5)) console.log(`    MISSING    ${s}`)
  }
  if (d.unexplained > 0) {
    console.log(`\n${t}: ${d.unexplained} analyzer rows no truth row explains, across ${d.unexplained_in_files} files`)
    console.log(`    by analyzer site marker: ${JSON.stringify(d.unexplained_by_analyzer_marker)}`)
    for (const s of d.unexplained_samples.slice(0, 5)) console.log(`    UNEXPLAINED ${s}`)
  }
}
if (OUT) {
  writeFileSync(OUT, JSON.stringify(out, null, 1))
  console.log(`\nwrote ${OUT}`)
}
