/**
 * PY-DECORATES-ORACLE-DIFF — the pre-wiring agreement check for the `decorates` label.
 *
 * WHY THIS EXISTS. The differential can only compare a label that is BOTH derived by an
 * independent oracle AND admitted by its per-language compared-label arm. For `decorates` the
 * truth half landed as a lane-owned oracle (`script/m14/oracles/python-truth.ts`,
 * `derivePythonTruth`) and the admission half is a shared-instrument edit the Lead owns. Until
 * that one-line arm lands, NOBODY measures whether the two derivations agree — which is exactly
 * the "COMPARED WITH NO TRUTH / TRUTH WITH NO COMPARISON" gap this programme keeps paying for.
 *
 * This instrument is the measurement in the meantime, and the standing evidence after wiring:
 * it runs the analyzer's `parseFile` and the oracle on the SAME files and reports the three
 * outcomes the differential would report for this one label:
 *
 *   covered       the analyzer and the oracle derive the same (source, target) pair
 *   MISSING       the oracle derives it and the analyzer does not   (analyzer gap)
 *   UNEXPLAINED   the analyzer emits it and the oracle does not     (fabrication / oracle gap)
 *
 * SITE-AGNOSTIC BY DESIGN, like the differential: a decorator's identity for this comparison is
 * (decorated declaration, decorator name), never the line — the two derivations must agree about
 * WHAT is decorated, and the line is pinned separately by the analyzer's own fixtures
 * (`python/decorator-applied` forbids the def-line spelling).
 *
 * Usage: bun run script/m14/py-decorates-oracle-diff.ts [--max 100] [--json out.json]
 * Exit 0 iff MISSING = 0 and UNEXPLAINED = 0.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const SIZE_CAP = 1024 * 1024
const argv = process.argv.slice(2)
const argOf = (flag: string): string | undefined => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}
const MAX = Number(argOf("--max") ?? "100")
const OUT = argOf("--json")

function discover(): { files: string[]; total: number } {
  const found: string[] = []
  for (const name of readdirSync(CR).sort()) {
    const dir = path.join(CR, name)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!rel.toLowerCase().endsWith(".py")) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      found.push(abs)
    }
  }
  found.sort()
  const total = found.length
  if (MAX <= 0 || total <= MAX) return { files: found, total }
  const stride = Math.max(1, Math.floor(total / MAX))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < MAX; i += stride) picked.push(found[i])
  return { files: picked, total }
}

const { files, total } = discover()
const wts: any = await import("web-tree-sitter")
const wdir = path.join(ROOT, "node_modules", "web-tree-sitter")
await wts.Parser.init({
  locateFile: () => ["tree-sitter.wasm", "web-tree-sitter.wasm"]
    .map((f) => path.join(wdir, f))
    .find((f) => { try { statSync(f); return true } catch { return false } })!,
})
const parser = new wts.Parser()
parser.setLanguage(await wts.Language.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-python.wasm"))))
const { derivePythonTruth } = await import("./oracles/python-truth")
const { parseFile } = await import("../../src/ast/pool-worker")

const key = (from: string, target: string) => `${from}\u0000${target}`
let covered = 0
let missing = 0
let unexplained = 0
const perFile: any[] = []
const missingSamples: string[] = []
const unexplainedSamples: string[] = []
for (const f of files) {
  const repo = path.join(CR, path.relative(CR, f).split(path.sep)[0]!)
  let content = ""
  try { content = readFileSync(f, "utf8") } catch { continue }
  let oracleEdges: Set<string>
  try {
    const root = parser.parse(content).rootNode
    const base = (f.split("/").pop() ?? "module").replace(/\.py$/, "")
    oracleEdges = new Set(derivePythonTruth(root, base).filter((e: any) => e.type === "decorates").map((e: any) => key(e.from, e.to)))
  } catch { continue }
  let analyzerEdges: Set<string>
  try {
    const r: any = await parseFile(f, repo, { projectRoot: repo } as any)
    analyzerEdges = new Set((r?.relationships ?? []).filter((x: any) => String(x.type ?? x.relationshipType) === "decorates").map((x: any) => key(String(x.source ?? ""), String(x.target ?? ""))))
  } catch { continue }
  let fc = 0, fm = 0, fu = 0
  for (const k of oracleEdges) {
    if (analyzerEdges.has(k)) { covered++; fc++ }
    else { missing++; fm++; if (missingSamples.length < 12) missingSamples.push(`${path.relative(CR, f)} ${k.replace("\u0000", " -> ")}`) }
  }
  for (const k of analyzerEdges) {
    if (!oracleEdges.has(k)) { unexplained++; fu++; if (unexplainedSamples.length < 12) unexplainedSamples.push(`${path.relative(CR, f)} ${k.replace("\u0000", " -> ")}`) }
  }
  if (fc + fm + fu > 0) perFile.push({ file: path.relative(CR, f), covered: fc, missing: fm, unexplained: fu })
}
const totalTruth = covered + missing
const totalAnalyzer = covered + unexplained
console.log(`py decorates oracle diff — ${files.length} of ${total} .py files (stride sample), TRIAGE unless --max 0`)
console.log(`truth edges ${totalTruth} · analyzer edges ${totalAnalyzer} · covered ${covered}`)
console.log(`MISSING (oracle derives, analyzer silent)   ${missing}`)
console.log(`UNEXPLAINED (analyzer emits, oracle silent)  ${unexplained}`)
if (missingSamples.length) { console.log("\nMISSING samples:"); for (const s of missingSamples) console.log(`   ${s}`) }
if (unexplainedSamples.length) { console.log("\nUNEXPLAINED samples:"); for (const s of unexplainedSamples) console.log(`   ${s}`) }
if (OUT) writeFileSync(OUT, JSON.stringify({ files: files.length, total, covered, missing, unexplained, perFile, missingSamples, unexplainedSamples }, null, 2))
const ok = missing === 0 && unexplained === 0
console.log(ok ? "\nAGREEMENT — decorates derivations agree on every file in this population." : "\nDISAGREEMENT — see samples above.")
process.exit(ok ? 0 : 1)
