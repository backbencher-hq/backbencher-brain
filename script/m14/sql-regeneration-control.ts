/**
 * SQL — THE REGENERATION CONTROL: does a REBUILD with nothing of its own patch in it move the
 * analyzer's labels?
 *
 * THE FLEET FINDING THIS MEASURES (typescript lane, 2026-10-22). A grammar rebuilt from the SAME
 * UNPATCHED SOURCE through the same CLI perturbed 22 of 250 files. So the perturbation is the
 * REGENERATION, not the patch: CLI 0.26.9's generator produces a different parser from the one the
 * npm package shipped in its `src/parser.c`. R2 carries parser-version drift as an unavoidable
 * cost, and every R2 lane must publish the control or say it has not run one.
 *
 * WHAT THIS INSTRUMENT MEASURES, AND WHAT IT CANNOT.
 *
 *   shipped.wasm  = @derekstride/tree-sitter-sql@0.3.11's OWN `src/parser.c`, compiled WITHOUT
 *                   `tree-sitter generate`. This is the parser the package's author shipped.
 *   regen.wasm    = the SAME package's `grammar.js`, put through `tree-sitter generate` on CLI
 *                   0.26.9 and then built. Nothing of anyone's patch is in it.
 *
 *   THE DELTA BETWEEN THOSE TWO IS THE REGENERATION COST AND NOTHING ELSE.
 *
 * ⇒ AND IT IS THE ONLY CONTROL THIS LANE CAN RUN, because the WIRED bytes are a LOCAL FORK whose
 * source is not in the repository. **NO REBUILD OF THE WIRED BYTES IS POSSIBLE, SO NO CONTROL ON
 * THEM IS POSSIBLE** — that is stated rather than hidden, and the fork stays wired.
 *
 * TWO MODES:
 *   --wasm <path> --json <out> [--stride=N]   measure one build over a controlled sample
 *   --diff <a.json> <b.json>                   the label table between two measured builds
 *
 * THE HAND-OVER IS MANDATORY: without `setGrammar` the analyzer's recovery passes are SILENTLY
 * INERT and every count is understated (260 edges, measured). It is done on the CLASS.
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

const args = process.argv.slice(2)
const argOf = (name: string): string => (args.includes(name) ? args[args.indexOf(name) + 1] ?? "" : "")
const ROOT = process.cwd()
const CORPUS = resolve(process.env.BB_CORPUS_ROOT ?? join(ROOT, ".corpus"))
const MAX_BYTES = 1_048_576
const STRIDE = Number(argOf("--stride") || "7")
const ONLY_REPOS = (argOf("--repos") || "").split(",").filter(Boolean)

/** git tracks it or the gate does not admit it. The rule travels with the count. */
function trackedFiles(repoDir: string): Set<string> {
  try {
    const raw = execFileSync("git", ["-C", repoDir, "ls-files", "-z"], {
      maxBuffer: 256 * 1024 * 1024,
      encoding: "buffer",
    }).toString("utf8")
    const set = new Set<string>()
    for (const rel of raw.split("\0")) {
      if (!rel) continue
      set.add(rel.split(/[\\/]/).join("/"))
    }
    return set
  } catch {
    return new Set()
  }
}

type WalkStats = { symlinkedDirsFollowed: number; symlinkedDirsFollowedInsideRepos: number; symlinkedTopLevelEntries: number; repos: Set<string> }

/** statSync FOLLOWS a symlink; Dirent.isDirectory() does not. 439 .sql files live behind one. */
function walk(dir: string, out: string[], tracked: Set<string>, repoDir: string, stats: WalkStats, topLevel: boolean): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  entries.sort()
  for (const name of entries) {
    if (name === ".git" || name === "node_modules") continue
    const p = join(dir, name)
    let st: any
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      let isLink = false
      try {
        isLink = (statSync(dir + "/" + name) as any) !== null && require("node:fs").lstatSync(p).isSymbolicLink()
      } catch {
        isLink = false
      }
      if (isLink) {
        stats.symlinkedDirsFollowed++
        if (topLevel) stats.symlinkedTopLevelEntries++
        else stats.symlinkedDirsFollowedInsideRepos++
      }
      walk(p, out, tracked, repoDir, stats, false)
      continue
    }
    if (!name.toLowerCase().endsWith(".sql")) continue
    if (st.size > MAX_BYTES) continue
    const rel = relative(repoDir, p).split(/[\\/]/).join("/")
    if (!tracked.has(rel)) continue
    out.push(p)
  }
}

const WASM = argOf("--wasm")
const JSON_OUT = argOf("--json")
const DIFF_A = argOf("--diff") ? args[args.indexOf("--diff") + 1] ?? "" : ""
const DIFF_B = argOf("--diff") ? args[args.indexOf("--diff") + 2] ?? "" : ""

const LABELS = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates", "decorates", "renders", "mixes_in", "part_of"] as const
type Row = { file: string; edges: number; distinct: number; labels: Record<string, number>; treeSha: string }

// ── the diff mode: the table the Lead asked for ───────────────────────────────────────────
if (DIFF_A && DIFF_B) {
  const a = JSON.parse(readFileSync(DIFF_A, "utf8"))
  const b = JSON.parse(readFileSync(DIFF_B, "utf8"))
  const byFile = new Map<string, Row>(a.files.map((r: Row) => [r.file, r]))
  const table: { label: string; a: number; b: number; delta: number; filesMoved: number; filesIn: number; filesOut: number }[] = []
  for (const label of LABELS) {
    let diffs = 0
    let inMore = 0
    let inLess = 0
    for (const rb of b.files as Row[]) {
      const ra = byFile.get(rb.file)
      if (!ra) continue
      const x = ra.labels[label] ?? 0
      const y = rb.labels[label] ?? 0
      if (x !== y) {
        diffs++
        if (y > x) inMore++
        else inLess++
      }
    }
    table.push({ label, a: a.totals[label] ?? 0, b: b.totals[label] ?? 0, delta: (b.totals[label] ?? 0) - (a.totals[label] ?? 0), filesMoved: diffs, filesIn: inMore, filesOut: inLess })
  }
  const moved = b.files.filter((rb: Row) => {
    const ra = byFile.get(rb.file)
    return ra && JSON.stringify(ra.labels) !== JSON.stringify(rb.labels)
  }).length
  const treeMoved = b.files.filter((rb: Row) => {
    const ra = byFile.get(rb.file)
    return ra && ra.treeSha && rb.treeSha && ra.treeSha !== rb.treeSha
  }).length
  const out = {
    a: { wasm: a.wasm, sha256: a.sha256, sample: a.files.length },
    b: { wasm: b.wasm, sha256: b.sha256, sample: b.files.length },
    filesCompared: Math.min(a.files.length, b.files.length),
    filesWithAnyLabelChange: moved,
    filesWithAnyTreeChange: treeMoved,
    percentMoved: a.files.length ? Math.round((moved / a.files.length) * 1000) / 10 : 0,
    table,
  }
  console.log("PATH A: " + JSON.stringify(out.a))
  console.log("PATH B: " + JSON.stringify(out.b))
  console.log(`files compared: ${out.filesCompared}`)
  console.log(`FILES WITH ANY LABEL CHANGE: ${moved} of ${out.filesCompared} (${out.percentMoved}%)`)
  console.log(`FILES WHOSE PARSE TREE CHANGED: ${treeMoved} of ${out.filesCompared}`)
  console.log("")
  console.log("label            A          B     delta   filesMoved   +in   -out")
  for (const r of table) {
    console.log(
      `  ${r.label.padEnd(13)} ${String(r.a).padStart(7)} ${String(r.b).padStart(10)} ${String(r.delta).padStart(9)} ${String(r.filesMoved).padStart(12)} ${String(r.filesIn).padStart(6)} ${String(r.filesOut).padStart(6)}`,
    )
  }
  const movedLabels = table.filter((r) => r.delta !== 0 || r.filesMoved > 0)
  console.log("")
  console.log(
    movedLabels.length === 0
      ? "⇒ THE CONTROL IS CLEAN: no label moved on any file of the sample."
      : `⇒ LABELS THAT MOVED: ${movedLabels.map((r) => `${r.label} (${r.delta >= 0 ? "+" : ""}${r.delta} over ${r.filesMoved} files)`).join(" · ")}`,
  )
  const outPath = argOf("--json")
  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n")
    console.log(`JSON written: ${outPath}`)
  }
  process.exit(0)
}

// ── the measure mode ──────────────────────────────────────────────────────────────────────
if (!WASM) {
  console.error("usage: --wasm <path> --json <out> [--stride=N]   |   --diff <a.json> <b.json> [--json <out>]")
  process.exit(2)
}
const { createHash } = await import("node:crypto")
const wasmSha = createHash("sha256").update(readFileSync(WASM)).digest("hex")
const { loadWebTreeSitter, resolveWasmAsset } = await import("../../src/util/wasm.ts")
const { RealSqlAnalyzer } = await import("../../src/ast/real-sql-analyzer.ts")
const W: any = await loadWebTreeSitter()
const Language = W.Language ?? W.default?.Language
const initFn = W.init ?? W.Parser?.init ?? W.default?.init
if (initFn) await initFn({ locateFile: () => resolveWasmAsset("tree-sitter.wasm") })
const lang: any = await Language.load(readFileSync(resolve(WASM)))
const parser: any = new (W.Parser ?? W.default?.Parser)()
parser.setLanguage(lang)
// ⇒⇒⇒ THE HAND-OVER. Without it the recovery passes are SILENTLY INERT. On the CLASS.
;(RealSqlAnalyzer as any).setGrammar(lang, (RealSqlAnalyzer as any).constructor)

// the sample
const found: string[] = []
const stats: WalkStats = { symlinkedDirsFollowed: 0, symlinkedDirsFollowedInsideRepos: 0, symlinkedTopLevelEntries: 0, repos: new Set() }
let rootEntries: string[] = []
try {
  rootEntries = readdirSync(CORPUS).sort()
} catch {
  rootEntries = []
}
for (const name of rootEntries) {
  if (ONLY_REPOS.length && !ONLY_REPOS.includes(name)) continue
  const dir = join(CORPUS, name)
  let st: any
  try {
    st = statSync(dir)
  } catch {
    continue
  }
  if (!st.isDirectory()) continue
  let isLink = false
  try {
    isLink = require("node:fs").lstatSync(dir).isSymbolicLink()
  } catch {
    isLink = false
  }
  if (isLink) {
    stats.symlinkedDirsFollowed++
    stats.symlinkedTopLevelEntries++
  }
  const tracked = trackedFiles(dir)
  const before = found.length
  walk(dir, found, tracked, dir, stats, false)
  if (found.length > before) stats.repos.add(name)
}
found.sort()

// THE CONTROLLED SAMPLE: every file carrying the construct of interest (INHERIT / PARTITION OF —
// this lane's two near misses), plus a deterministic STRIDE over the rest.
const carriers: string[] = []
const rest: string[] = []
for (const f of found) {
  let text = ""
  try {
    text = readFileSync(f, "utf8")
  } catch {
    continue
  }
  if (/\bINHERIT|PARTITION\s+OF\b/i.test(text)) carriers.push(f)
  else rest.push(f)
}
const stride: string[] = []
for (let i = 0; i < rest.length; i += STRIDE) stride.push(rest[i])
const sample = [...new Set([...carriers, ...stride])].sort()

const rows: Row[] = []
const totals: Record<string, number> = {}
let parseFailures = 0
let analyzeFailures = 0
for (const abs of sample) {
  let content = ""
  try {
    content = readFileSync(abs, "utf8")
  } catch {
    continue
  }
  let tree: any
  try {
    tree = parser.parse(content)
  } catch {
    parseFailures++
    continue
  }
  let res: any = null
  try {
    res = new (RealSqlAnalyzer as any)().analyze(tree.rootNode, content, abs)
  } catch {
    analyzeFailures++
  }
  const rels: any[] = res?.relationships ?? []
  const labels: Record<string, number> = {}
  const seen = new Set<string>()
  for (const r of rels) {
    const t = String(r.relationshipType ?? r.type)
    labels[t] = (labels[t] ?? 0) + 1
    seen.add(`${t}\t${String(r.source ?? r.from)}\t${String(r.target ?? r.to)}`)
  }
  for (const k of Object.keys(labels)) totals[k] = (totals[k] ?? 0) + labels[k]
  // THE TREE ITSELF, hashed. A label comparison can miss a shift that moves nothing the analyzer
  // reads; the tree hash cannot. This is the strongest form of the control.
  const treeSha = createHash("sha256").update(tree.rootNode.toString()).digest("hex")
  rows.push({ file: relative(CORPUS, abs), edges: rels.length, distinct: seen.size, labels, treeSha })
}

const out = {
  wasm: WASM,
  sha256: wasmSha,
  builtAt: new Date().toISOString(),
  sampleRule: `every file carrying INHERIT or PARTITION OF (${carriers.length}) plus every ${STRIDE}th of the remaining ${rest.length} (${stride.length}) = ${sample.length} files`,
  population: { admitted: found.length, reposCarryingAdmittedFiles: stats.repos.size, symlinkedDirsFollowed: stats.symlinkedDirsFollowed, symlinkedTopLevelEntries: stats.symlinkedTopLevelEntries, symlinkedDirsFollowedInsideRepos: stats.symlinkedDirsFollowedInsideRepos },
  sample: sample.length,
  carriers: carriers.length,
  parseFailures,
  analyzeFailures,
  totals,
  files: rows,
}
if (JSON_OUT) {
  mkdirSync(dirname(JSON_OUT), { recursive: true })
  writeFileSync(JSON_OUT, JSON.stringify(out, null, 2) + "\n")
}
console.log(`wasm ${WASM} sha ${wasmSha.slice(0, 12)}`)
console.log(`population admitted ${found.length} · ${stats.repos.size} repos · symlinked dirs FOLLOWED ${stats.symlinkedDirsFollowed} (${stats.symlinkedTopLevelEntries} top + ${stats.symlinkedDirsFollowedInsideRepos} inside)`)
console.log(`sample ${sample.length} files (${carriers.length} construct carriers + ${stride.length} stride/${STRIDE}) · parse failures ${parseFailures} · analyze failures ${analyzeFailures}`)
console.log(`labels: ${JSON.stringify(totals)}`)
if (JSON_OUT) console.log(`JSON written: ${JSON_OUT}`)
