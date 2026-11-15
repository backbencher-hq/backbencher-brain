/**
 * SHARED `imports` CLAIM PRICING — five lanes, one question: how many import edges name a file the
 * lane's ADMITTED population actually carries?
 *
 * That number is the CEILING for a file claim, and it must be counted BEFORE any claim is emitted,
 * because a claim that misses is REFUTED and `extFAIL` must stay 0.
 *
 * The admitted list is taken from the ROUTER (`src/ast/language-detection.ts`), not from a guessed
 * extension list — ten lanes this session measured a fraction of their own language by assuming one.
 * Every candidate is checked against the gate's facts (repo-relative paths of the lane's admitted
 * files) AND the filesystem, so the two arms of the cross-tab are:
 *
 *   verify        the admitted list carries the candidate  -> a claim here is CONFIRMED
 *   would-refute  the candidate exists on disk but is NOT admitted -> a claim here would be REFUTED
 *   residue       no computable candidate, or nothing on disk -> a ruled class with a count
 *
 * Per-lane candidate arithmetic, because the five lanes do not spell an import the same way:
 *   protobuf / graphql  a path as written, folded against the file's own directory or the root
 *   scss                a Sass specifier: extension-less and partial-prefixed spellings tried
 *   clean               `Module:item` / `Module:*` — the MODULE, with the item suffix removed
 *   zig                 `@import("...")`: a path when it has one, a module name otherwise
 *
 *   npx tsx validation/m14/fixtures/toml/tools/imports-claim-pricing.mts [--lane=protobuf]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const ONLY = (process.argv.find((a) => a.startsWith("--lane=")) ?? "").split("=")[1] ?? null
// A BOUNDED STRIDE SAMPLE, honestly labelled. The ratio this probe reports is "what fraction of a
// lane's `imports` edges name an admitted file", which a stride sample estimates at a fraction of
// the cost of a whole population — and a sample that finishes is a result where a whole-population
// run that never completes is not.
const SAMPLE = Number((process.argv.find((a) => a.startsWith("--files=")) ?? "--files=0").split("=")[1])
// THE PRODUCTION PATH, not `analyzer.analyze` directly: pool-worker derives `qualifiedName` from
// `metadata.fqn`, so a probe on the direct path measures a key space production does not have.
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
// THE LANDED MODULE, not the probe's own arithmetic: the probe and the module are two instruments,
// and this session has produced five cases of a number being about the instrument rather than the
// corpus. `--compare-guard` calls BOTH on every unresolved edge and reports where they disagree.
const { fileClaimForTarget } = await import(path.join(ROOT, "src/ast/file-claim.ts"))
const COMPARE = process.argv.includes("--compare-guard")

const REFUSE_CHARS = [" ", "\t", "*", "?", "<", ">", "|", "{", "}", "$"]

/** Fold a relative path against a base directory; null when it escapes or is not a plain path. */
function fold(base: string, written: string): string | null {
  const w = written.trim()
  if (w.length === 0 || w.length > 300) return null
  if (w.includes("://") || w.startsWith("/") || w.startsWith("~") || w.startsWith("\\")) return null
  for (const ch of REFUSE_CHARS) if (w.includes(ch)) return null
  const out: string[] = []
  for (const seg of (base + w).split("/")) {
    if (seg.length === 0 || seg === ".") continue
    if (seg === "..") { if (out.length === 0) return null; out.pop(); continue }
    out.push(seg)
  }
  return out.length > 0 ? out.join("/") : null
}
const dirOf = (rel: string): string => { const i = rel.lastIndexOf("/"); return i < 0 ? "" : rel.slice(0, i + 1) }
const withBoth = (written: string, selfRel: string): string[] => {
  const a = fold(dirOf(selfRel), written)
  const b = fold("", written)
  return [...new Set([a, b].filter((x): x is string => x !== null))]
}

/** A plain path (`protobuf`, `graphql`, zig's file-shaped imports). */
const pathCandidates = (t: string, selfRel: string): string[] => withBoth(t, selfRel)

/** A Sass specifier: extension-less and partial-prefixed spellings, both bases. */
function sassCandidates(t: string, selfRel: string): string[] {
  const w = t.trim()
  if (w.length === 0 || w.includes("://") || w.startsWith("sass:") || w.startsWith("http")) return []
  const out = new Set<string>()
  const stems = [w]
  // `partials/base` also names `partials/_base.scss`, and `base` may carry its own extension.
  const cut = w.lastIndexOf("/")
  const dir = cut < 0 ? "" : w.slice(0, cut + 1)
  const leaf = cut < 0 ? w : w.slice(cut + 1)
  if (leaf.length > 0 && !leaf.startsWith("_")) stems.push(`${dir}_${leaf}`)
  for (const stem of stems) {
    for (const ext of ["", ".scss", ".sass", ".css"]) {
      if (ext === "" && !/\.(scss|sass|css)$/i.test(stem)) continue
      for (const c of withBoth(stem + ext, selfRel)) out.add(c)
    }
    // `partials/base` may also be a directory index: `partials/base/_index.scss`
    for (const idx of ["_index.scss", "index.scss"]) for (const c of withBoth(`${stem}/${idx}`, selfRel)) out.add(c)
  }
  return [...out]
}

/** A Clean module: `Module:item` or `Module:*` — the module part, with the item suffix removed. */
function cleanCandidates(t: string, _selfRel: string): string[] {
  const w = t.trim()
  if (w.length === 0) return []
  const mod = (w.includes(":") ? w.slice(0, w.indexOf(":")) : w).split(".").join("/")
  if (mod.length === 0 || mod.includes("://")) return []
  const out: string[] = []
  for (const ext of [".icl", ".dcl"]) out.push(mod + ext)
  out.push(mod)
  return out
}

/** zig `@import("...")`: a path when it has one, a module name otherwise. */
function zigCandidates(t: string, selfRel: string): string[] {
  const w = t.trim()
  if (w.length === 0 || w.includes("://")) return []
  const looksPath = w.includes("/") || w.includes(".zig") || w.startsWith(".")
  return looksPath ? withBoth(w, selfRel) : []
}

type LaneSpec = { lane: string; exts: string[]; types: string[]; candidates: (t: string, selfRel: string) => string[]; note: string }
/** What the GUARD cannot compute itself: the lane's extra spellings. The guard folds the written
 *  path against the file's directory and the root on its own, so those two are not repeated here. */
function extraFor(spec: LaneSpec, written: string, selfRel: string): string[] {
  const all = spec.candidates(written, selfRel)
  const lit = new Set<string>()
  const a = fold(dirOf(selfRel), written.trim())
  const b = fold("", written.trim())
  if (a !== null) lit.add(a)
  if (b !== null) lit.add(b)
  return all.filter((c) => !lit.has(c))
}
const LANES: LaneSpec[] = [
  { lane: "protobuf", exts: ["proto"], types: ["imports"], candidates: pathCandidates, note: "`import \"...\"` is a path" },
  { lane: "graphql", exts: ["graphql", "gql"], types: ["imports"], candidates: pathCandidates, note: "`#import` names a document path" },
  { lane: "clean", exts: ["icl", "dcl"], types: ["imports"], candidates: cleanCandidates, note: "`Module:item` — the MODULE, not a path" },
  { lane: "scss", exts: ["scss"], types: ["imports"], candidates: sassCandidates, note: "`@use`/`@import` specifier; `.sass` routes to language `sass`, so it is NOT this population" },
  { lane: "zig", exts: ["zig"], types: ["imports", "references"], candidates: zigCandidates, note: "`@import` — path-shaped or a module name" },
]

function discover(exts: string[]): Map<string, { files: string[]; admitted: Set<string>; population: number }> {
  const out = new Map<string, { files: string[]; admitted: Set<string>; population: number }>()
  for (const name of readdirSync(CR).sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    const files: string[] = []
    const admitted = new Set<string>()
    for (const rel of tracked) {
      const ext = rel.slice(rel.lastIndexOf(".") + 1).toLowerCase()
      if (!exts.includes(ext)) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      files.push(abs)
      admitted.add(rel.split("/").join("/"))
    }
    files.sort()
    const population = files.length
    if (SAMPLE > 0 && files.length > SAMPLE) {
      // EVEN STRIDE, not the first N: a corpus is usually ordered by directory, so a prefix would
      // sample one subtree and call it the language.
      const stride = files.length / SAMPLE
      const picked: string[] = []
      for (let i = 0; i < SAMPLE; i++) picked.push(files[Math.floor(i * stride)])
      files.length = 0
      files.push(...[...new Set(picked)].sort())
    }
    if (files.length > 0) out.set(dir, { files, admitted, population })
  }
  return out
}

const cmp: Record<string, number> = { total: 0 }
const cmpEx: string[] = []
const isFile = (p: string): boolean => { try { return statSync(p).isFile() } catch { return false } }

type Row = { edges: number; resolved: number; ambiguous: number; unresolved: number; verify: number; wouldRefute: number; residue: number; files: number; population: number }
const results: { lane: string; row: Row; residueTop: Map<string, number>; verifyExamples: string[]; refuteExamples: string[]; note: string }[] = []

for (const spec of LANES) {
  if (ONLY !== null && ONLY !== spec.lane) continue
  const repos = discover(spec.exts)
  const row: Row = { edges: 0, resolved: 0, ambiguous: 0, unresolved: 0, verify: 0, wouldRefute: 0, residue: 0, files: 0, population: 0 }
  const residueTop = new Map<string, number>()
  const verifyExamples: string[] = []
  const refuteExamples: string[] = []
  for (const [repo, { files, admitted, population }] of repos) {
    row.population += population
    const keyCount = new Map<string, number>()
    const parsed: { file: string; rel: string; rels: any[] }[] = []
    for (const abs of files) {
      let res: any
      try { res = await parseFile(abs, repo, { projectRoot: repo } as any) } catch { continue }
      parsed.push({ file: abs, rel: path.relative(repo, abs).split(path.sep).join("/"), rels: res.relationships ?? [] })
      row.files++
      for (const s of res.symbols ?? []) {
        const n = String(s.name ?? "")
        if (n.length === 0) continue
        keyCount.set(n, (keyCount.get(n) ?? 0) + 1)
        const q = String(s.qualifiedName ?? "")
        if (q.length > 0 && q !== n) keyCount.set(q, (keyCount.get(q) ?? 0) + 1)
      }
    }
    for (const { file, rel, rels } of parsed) {
      for (const r of rels) {
        const t = String(r.type ?? r.relationshipType ?? "")
        if (!spec.types.includes(t)) continue
        row.edges++
        const tgt = String(r.target ?? "")
        if (tgt.length === 0) { row.unresolved++; row.residue++; continue }
        const decls = keyCount.get(tgt) ?? 0
        if (decls === 1) { row.resolved++; continue }
        if (decls > 1) { row.ambiguous++; continue }
        row.unresolved++
        // THE ARBITER'S KEY SPACE HOLDS THE LANE'S ADMITTED EXTENSIONS AND NOTHING ELSE, so a
        // candidate of any other shape can never verify while a miss still REFUTES. Filtering here
        // is required rather than convenient — it is what removes `build.zig.zon` from zig and
        // `_all.sass` from scss, both of which exist on disk and are NOT in this lane's population
        // (`.sass` routes to language `sass`; `.zon` is not a zig source).
        const cands = spec.candidates(tgt, rel).filter((c) => spec.exts.includes(c.slice(c.lastIndexOf(".") + 1).toLowerCase()))
        const hit = cands.find((c) => admitted.has(c)) ?? null
        if (COMPARE) {
          const guard = fileClaimForTarget({
            projectRoot: repo, filePath: file, written: tgt,
            admittedExtensions: spec.exts, extraCandidates: extraFor(spec, tgt, rel),
          })
          const probeVerdict = hit !== null ? "verify" : (cands.some((c) => isFile(path.join(repo, c))) ? "refute" : "residue")
          const guardVerdict = guard !== null ? "verify" : "residue"
          cmp.total++
          cmp[`${probeVerdict}->${guardVerdict}`] = (cmp[`${probeVerdict}->${guardVerdict}`] ?? 0) + 1
          if (probeVerdict !== guardVerdict && cmpEx.length < 10) cmpEx.push(`${spec.lane}: ${tgt}  probe=${probeVerdict} guard=${guardVerdict}  (${rel})`)
        }
        if (hit !== null) {
          row.verify++
          if (verifyExamples.length < 6) verifyExamples.push(`${tgt.padEnd(46)} -> ${hit}   (${rel})`)
          continue
        }
        const fsHit = cands.find((c) => isFile(path.join(repo, c))) ?? null
        if (fsHit !== null) {
          row.wouldRefute++
          if (refuteExamples.length < 6) refuteExamples.push(`${tgt.padEnd(46)} -> ${fsHit} (on disk, NOT admitted)   (${rel})`)
          continue
        }
        row.residue++
        residueTop.set(tgt, (residueTop.get(tgt) ?? 0) + 1)
      }
    }
  }
  results.push({ lane: spec.lane, row, residueTop, verifyExamples, refuteExamples, note: spec.note })
}

console.log(`imports-claim pricing — ${SAMPLE > 0 ? `STRIDE SAMPLE of ${SAMPLE} files per repo` : "WHOLE admitted population"} per lane, PRODUCTION path`)
console.log(`  POPULATION LABEL: ${SAMPLE > 0 ? "each lane's per-repo stride sample; ratios are estimates with the sample size printed beside them" : "every admitted file"}`)
console.log(`  PATH LABEL: every edge below comes from \`parseFile\` (src/ast/pool-worker.ts) — the module the incoming gate itself imports — NOT from the regex fallback the coverage gate separates out as DEGRADED. A fallback edge would be evidence about a different instrument.`)
console.log(`${"lane".padEnd(10)} ${"files".padStart(7)} ${"pop".padStart(7)} ${"edges".padStart(8)} ${"resolved".padStart(9)} ${"ambig".padStart(7)} ${"unres".padStart(8)} ${"VERIFY".padStart(8)} ${"refute-if-fs".padStart(12)} ${"residue".padStart(9)}`)
let tFiles = 0, tEdges = 0, tRes = 0, tAmb = 0, tUnres = 0, tVerify = 0, tRefute = 0, tResidue = 0
for (const r of results) {
  const x = r.row
  console.log(`${r.lane.padEnd(10)} ${String(x.files).padStart(7)} ${String(x.population).padStart(7)} ${String(x.edges).padStart(8)} ${String(x.resolved).padStart(9)} ${String(x.ambiguous).padStart(7)} ${String(x.unresolved).padStart(8)} ${String(x.verify).padStart(8)} ${String(x.wouldRefute).padStart(12)} ${String(x.residue).padStart(9)}`)
  tFiles += x.files; tEdges += x.edges; tRes += x.resolved; tAmb += x.ambiguous; tUnres += x.unresolved; tVerify += x.verify; tRefute += x.wouldRefute; tResidue += x.residue
}
const tPop = results.reduce((n, r) => n + r.row.population, 0)
console.log(`${"TOTAL".padEnd(10)} ${String(tFiles).padStart(7)} ${String(tPop).padStart(7)} ${String(tEdges).padStart(8)} ${String(tRes).padStart(9)} ${String(tAmb).padStart(7)} ${String(tUnres).padStart(8)} ${String(tVerify).padStart(8)} ${String(tRefute).padStart(12)} ${String(tResidue).padStart(9)}`)
for (const r of results) {
  console.log(`\n== ${r.lane}  sample ${r.row.files} of ${r.row.population} admitted files  (${r.note})`)
  console.log(`   VERIFY examples:`)
  for (const e of r.verifyExamples) console.log(`     ${e}`)
  if (r.verifyExamples.length === 0) console.log(`     none`)
  console.log(`   would-REFUTE examples (fs true, not admitted):`)
  for (const e of r.refuteExamples) console.log(`     ${e}`)
  if (r.refuteExamples.length === 0) console.log(`     none`)
  console.log(`   top residue targets:`)
  console.log("     " + [...r.residueTop].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n, c]) => `${n}×${c}`).join("  "))
}

if (COMPARE) {
  console.log(`\nGUARD-vs-PROBE comparison on every unresolved edge — the LANDED module (src/ast/file-claim.ts) against the probe's own arithmetic:`)
  console.log(`  edges compared: ${cmp.total}`)
  for (const [k, v] of Object.entries(cmp).filter(([k]) => k !== "total").sort()) console.log(`    ${k.padEnd(22)} ${v}`)
  console.log(`  disagreements${cmpEx.length === 0 ? ": none" : ":"}`)
  for (const e of cmpEx) console.log(`    ${e}`)
}
