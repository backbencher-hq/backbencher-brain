/**
 * CS3 / csharp — PAYLOAD and LATENCY, before vs after the `exports` addition.
 *
 * ## Why this is a lane file and not `script/m60/payload-matrix.ts`
 *
 * `payload-matrix.ts` is the shared budget gate and it is the master's. This lane
 * needed a BEFORE/AFTER pair on a PINNED file list, which the shared gate does not
 * provide: `script/m14/differential.ts` rotates its sample by design (the lane doc
 * records the same powershell command reporting truth 16,371 / 21,155 / 21,994 /
 * 23,285 with no code change between runs), and the only way this lane got a
 * comparable differential pair was to snapshot and restore the cold-pool state
 * file. Same reason here: a rotation makes an A/B impossible to conclude from.
 *
 * So the file list is PINNED by SHA-256 of the corpus-relative path list, printed
 * before any measurement, and both halves run over exactly that list.
 *
 * ## What is measured
 *
 *   payload   total relationships, per label, and total symbols — the numbers a
 *             bigger graph costs. `bb_graph`'s un-narrowed `relationshipTypes`
 *             default is measured at 2.5-4.8x a filtered answer (lodash 487 KiB vs
 *             101 KiB), so the per-label table matters more than the total: a new
 *             label in the default set is a cost whether or not it is large.
 *   latency   ms/file of `analyze` alone, timed SEPARATELY from `parse`, and the
 *             minimum of N runs (the lane doc records the reason: per-file cost is
 *             flat but the machine is shared, so a mean reports the neighbours).
 *
 * ## No regular expression
 *
 * MASTER-HANDOFF rule 1.
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REPO = process.env.BB_REPO || "aspnetcore"
const NFILES = Number(process.env.NFILES || 200)
const RUNS = Number(process.env.RUNS || 3)
const ROOTW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")

const { RealCSharpAnalyzer } = await import(`${ROOTW}/src/ast/real-csharp-analyzer.ts`)
const { getParser } = await import(`${ROOTW}/src/ast/engine.ts`)
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOTW, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const tsParser = new WSP()
tsParser.setLanguage(await WSL.load(readFileSync(path.join(ROOTW, "wasm", "tree-sitter-c_sharp.wasm"))))

const dir = path.join(CR, REPO)
let tracked: string[]
try {
  tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
} catch {
  console.error(`no git repo at ${dir}`)
  process.exit(2)
}
const rels = tracked.filter((r) => r.endsWith(".cs")).sort()
const drawn = rels.slice(0, NFILES)
const listHash = createHash("sha256").update(drawn.join("\n")).digest("hex").slice(0, 16)
console.log(`CS3 csharp payload / latency`)
console.log(`repo ${REPO}: ${tracked.length} tracked paths, ${rels.length} .cs, DRAWN ${drawn.length}`)
console.log(`PINNED file-list sha256 ${listHash}`)
console.log(`   first: ${drawn[0]}`)
console.log(`   last : ${drawn[drawn.length - 1]}`)
console.log()

const texts: { rel: string; text: string }[] = []
for (const r of drawn) {
  try {
    const abs = path.join(dir, r)
    if (statSync(abs).size > 512 * 1024) continue
    texts.push({ rel: r, text: readFileSync(abs, "utf8") })
  } catch { /* unreadable path is not a measurement */ }
}

const byLabel = new Map<string, number>()
let relTotal = 0, symTotal = 0, exportCount = 0
for (const f of texts) {
  const tree = tsParser.parse(f.text)
  if (!tree) continue
  const r: any = new RealCSharpAnalyzer().analyze(tree.rootNode, f.text, f.rel)
  tree.delete?.()
  symTotal += (r.symbols ?? []).length
  for (const x of r.relationships ?? []) {
    relTotal++
    const t = String(x.type ?? x.relationshipType ?? "?(none)")
    byLabel.set(t, (byLabel.get(t) ?? 0) + 1)
    if (t === "exports") exportCount++
  }
}

// parse and analyze timed separately, min over RUNS
let parseMin = Number.POSITIVE_INFINITY, analyzeMin = Number.POSITIVE_INFINITY
let parseOnlyMin = Number.POSITIVE_INFINITY
for (let run = 0; run < RUNS; run++) {
  let pMs = 0, aMs = 0
  for (const f of texts) {
    const engineParser = await getParser("csharp")
    let t0 = performance.now()
    const pr = await engineParser.parse(f.text, f.rel)
    pMs += performance.now() - t0
    t0 = performance.now()
    new RealCSharpAnalyzer().analyze(pr.rootNode, f.text, f.rel)
    aMs += performance.now() - t0
  }
  parseMin = Math.min(parseMin, pMs)
  analyzeMin = Math.min(analyzeMin, aMs)
  let qMs = 0
  for (const f of texts) {
    const t0 = performance.now()
    const tr = tsParser.parse(f.text)
    qMs += performance.now() - t0
    tr?.delete?.()
  }
  parseOnlyMin = Math.min(parseOnlyMin, qMs)
}

console.log(`payload`)
console.log(`  files                     ${texts.length}`)
console.log(`  symbols                   ${symTotal}`)
console.log(`  relationships             ${relTotal}`)
console.log(`  exports edges             ${exportCount}   (${((100 * exportCount) / Math.max(1, relTotal)).toFixed(2)}% of all relationships)`)
for (const [k, v] of [...byLabel].sort((a, b) => b[1] - a[1])) {
  const inDefault = k !== "imports" // graph-engine's unfiltered default is 10 of 10 minus the separate-channel type
  console.log(`    ${k.padEnd(14)} ${String(v).padStart(7)}${inDefault ? "" : "   (separate channel)"}`)
}
console.log()
console.log(`latency (min over ${RUNS} runs, ms/file)`)
console.log(`  parse via engine.getParser ${(parseMin / texts.length).toFixed(3)}`)
console.log(`  parse via bare wasm        ${(parseOnlyMin / texts.length).toFixed(3)}`)
console.log(`  analyze                    ${(analyzeMin / texts.length).toFixed(3)}`)
console.log(`  analyze us/symbol          ${((analyzeMin * 1000) / Math.max(1, symTotal)).toFixed(0)}`)
console.log(`  analyze per file, total ms ${analyzeMin.toFixed(1)}`)
console.log()
console.log(`Lane budget of record (docs/analyzers/csharp.md): fixtures < 2 s;`)
console.log(`400-file corpus < 60 s. At ${(analyzeMin / texts.length).toFixed(2)} ms/file analyze plus`)
console.log(`${(parseMin / texts.length).toFixed(2)} ms/file parse, 400 files is ${((analyzeMin + parseMin) / texts.length * 400 / 1000).toFixed(1)} s.`)
