/**
 * Consolidated VB.NET grammar measurement — the lane's parse-success baseline.
 *
 * One run, every corpus, the same numbers, so a repair wave can be compared
 * against the previous reading without re-deriving anything. Emits a JSON
 * artifact AND a table. `--compare <file.json>` diffs against a prior reading,
 * which is how a repair claims a number moved rather than asserting it.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"
// REPO-RELATIVE: every path below is env-overridable with the previous value as
// the default, so a clone runs unchanged on this machine and can be pointed
// anywhere else. (VENDORED from bb_tests/probes/ — see grammars/_vendored/VENDORED.md)
const REPO = process.env.BB_REPO ?? "/home/ishaq2321/backbencher-brain"
const { Parser, Language } = await import(`${REPO}/node_modules/web-tree-sitter/tree-sitter.js`)
import { readVbSource } from "./vb-source"

const CORE_WASM = process.env.BB_CORE_WASM ?? `${REPO}/wasm/tree-sitter.wasm`
const GRAMMAR_WASM = process.env.VB_WASM ?? `${REPO}/wasm/tree-sitter-vbnet.wasm`
const OUT = process.env.OUT ?? `${REPO}/grammars/_vendored/vbnet/grammar-candidate.json`
const COMPARE = (() => {
  const i = process.argv.indexOf("--compare")
  return i >= 0 ? process.argv[i + 1] : null
})()

const VB_CORPUS = process.env.BB_VB_CORPUS ?? "/home/ishaq2321/bb_tests/vb-corpus"
const CORPORA: Array<{ name: string; root: string; limit: number }> = [
  { name: "runtime-mvb", root: `${VB_CORPUS}/runtime`, limit: 0 },
  { name: "p3d-legacy", root: `${VB_CORPUS}/p3d`, limit: 600 },
  { name: "dismtools", root: `${VB_CORPUS}/dismt`, limit: 400 },
  { name: "tankexporter", root: `${VB_CORPUS}/tankex`, limit: 0 },
]

function collectVbFiles(root: string): string[] {
  const out: string[] = []
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let entries: string[]
    try { entries = readdirSync(dir) } catch { continue }
    for (const e of entries) {
      if (e === ".git") continue
      const p = join(dir, e)
      let st: any
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) stack.push(p)
      else if (e.toLowerCase().endsWith(".vb")) out.push(p)
    }
  }
  out.sort()
  return out
}

/** Topmost ERROR/MISSING nodes only — errors nest, so counting all of them double-counts bytes. */
function topmostBad(tree: any): { errors: number; missing: number; errBytes: number; firstLine: number; causes: Map<string, number> } {
  const causes = new Map<string, number>()
  let errors = 0, missing = 0, errBytes = 0, firstLine = 0
  const rec = (node: any): boolean => {
    const isErr = node.type === "ERROR" || node.type === "_ERROR"
    const isMiss = node.isMissing
    if (isErr || isMiss) {
      if (isErr) errors++
      if (isMiss) missing++
      errBytes += Math.max(1, node.endIndex - node.startIndex)
      if (firstLine === 0) firstLine = node.startPosition.row + 1
      return true
    }
    for (let i = 0; i < node.namedChildCount; i++) rec(node.namedChild(i))
    return false
  }
  rec(tree.rootNode)
  return { errors, missing, errBytes, firstLine, causes }
}

await Parser.init({ locateFile: () => CORE_WASM, wasmBinary: readFileSync(CORE_WASM) })
const lang = await Language.load(GRAMMAR_WASM)
const parser = new Parser()
parser.setLanguage(lang)

const result: any = {
  gate: "VB.grammar-baseline",
  title: "VB.NET grammar parse-success baseline, per corpus",
  at: new Date().toISOString(),
  grammarWasm: GRAMMAR_WASM,
  grammarWasmSha256: (await import("node:crypto")).createHash("sha256").update(readFileSync(GRAMMAR_WASM)).digest("hex"),
  method: "parse every tracked *.vb in the corpus with the committed wasm; a file is CLEAN only when its tree carries zero ERROR and zero MISSING nodes. Topmost bad nodes only, so nested errors cannot inflate the byte figure.",
  corpora: [],
}

for (const c of CORPORA) {
  if (!existsSync(c.root)) { result.corpora.push({ name: c.name, root: c.root, missing: true }); continue }
  const all = collectVbFiles(c.root)
  const files = c.limit > 0 ? all.slice(0, c.limit) : all
  let clean = 0, crash = 0, totalBytes = 0, errBytes = 0, errors = 0, missing = 0
  let maxMs = 0
  const t0 = Date.now()
  for (const f of files) {
    let src: string
    try { src = readVbSource(f).text } catch { continue }
    totalBytes += Buffer.byteLength(src)
    const s0 = Date.now()
    let tree: any
    try { tree = parser.parse(src) } catch { crash++; continue }
    const dt = Date.now() - s0
    if (dt > maxMs) maxMs = dt
    const r = topmostBad(tree)
    errors += r.errors
    missing += r.missing
    errBytes += r.errBytes
    if (r.errors + r.missing === 0) clean++
    tree.delete()
  }
  const ms = Date.now() - t0
  const total = files.length || 1
  result.corpora.push({
    name: c.name, root: c.root,
    files: files.length, available: all.length,
    clean, cleanPct: Number(((clean / total) * 100).toFixed(2)),
    badFiles: total - clean, badPct: Number((((total - clean) / total) * 100).toFixed(2)),
    crashFiles: crash,
    errorNodes: errors, missingNodes: missing,
    errBytesPct: Number(((errBytes / Math.max(1, totalBytes)) * 100).toFixed(3)),
    wallMs: ms, msPerFile: Number((ms / total).toFixed(2)),
    slowestFileMs: maxMs,
  })
}
parser.delete()

// Aggregate
const live = result.corpora.filter((c: any) => !c.missing)
const agg = live.reduce((a: any, c: any) => ({
  files: a.files + c.files, clean: a.clean + c.clean, bad: a.bad + c.badFiles,
  crash: a.crash + c.crashFiles, errors: a.errors + c.errorNodes, missing: a.missing + c.missingNodes,
}), { files: 0, clean: 0, bad: 0, crash: 0, errors: 0, missing: 0 })
result.aggregate = {
  ...agg,
  cleanPct: Number(((agg.clean / Math.max(1, agg.files)) * 100).toFixed(2)),
  badPct: Number(((agg.bad / Math.max(1, agg.files)) * 100).toFixed(2)),
}

// Read the PREVIOUS reading BEFORE writing this one. Doing it after the write
// compares the artifact against itself and reports a delta of 0 for every row,
// which is exactly the kind of green that is not evidence.
const PREV = COMPARE && existsSync(COMPARE) ? JSON.parse(readFileSync(COMPARE, "utf8")) : null

writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n")

console.log(`grammar wasm  ${GRAMMAR_WASM.split("/").pop()}  sha256 ${result.grammarWasmSha256.slice(0, 16)}`)
console.log("")
console.log("corpus            files   clean    clean%    bad   bad%   crash  ERROR  MISSING  ms/file")
for (const c of live) {
  console.log(
    `${c.name.padEnd(16)}${String(c.files).padStart(6)}${String(c.clean).padStart(8)}${String(c.cleanPct).padStart(9)}` +
    `${String(c.badFiles).padStart(7)}${String(c.badPct).padStart(7)}${String(c.crashFiles).padStart(8)}` +
    `${String(c.errorNodes).padStart(8)}${String(c.missingNodes).padStart(9)}${String(c.msPerFile).padStart(9)}`
  )
}
console.log("")
console.log(`AGGREGATE       ${String(agg.files).padStart(6)}${String(agg.clean).padStart(8)}${String(result.aggregate.cleanPct).padStart(9)}` +
  `${String(agg.bad).padStart(7)}${String(result.aggregate.badPct).padStart(7)}${String(agg.crash).padStart(8)}` +
  `${String(agg.errors).padStart(8)}${String(agg.missing).padStart(9)}`)
console.log("")
console.log(`written ${OUT}`)

if (PREV) {
  const prev = PREV
  console.log("")
  console.log(`COMPARED WITH ${COMPARE}`)
  console.log("corpus            prev clean%   now clean%   delta")
  for (const c of live) {
    const p = prev.corpora?.find((x: any) => x.name === c.name)
    if (!p) { console.log(`${c.name.padEnd(16)}${"(new)".padStart(11)}${String(c.cleanPct).padStart(13)}`); continue }
    const d = Number((c.cleanPct - p.cleanPct).toFixed(2))
    console.log(`${c.name.padEnd(16)}${String(p.cleanPct).padStart(11)}${String(c.cleanPct).padStart(13)}${(d > 0 ? "+" : "") + d}`)
  }
  if (prev.aggregate) {
    const d = Number((result.aggregate.cleanPct - prev.aggregate.cleanPct).toFixed(2))
    console.log(`${"AGGREGATE".padEnd(16)}${String(prev.aggregate.cleanPct).padStart(11)}${String(result.aggregate.cleanPct).padStart(13)}${(d > 0 ? "+" : "") + d}`)
  }
}
