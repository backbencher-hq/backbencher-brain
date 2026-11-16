/**
 * READ-ONLY PROBE — the bash analyzer's time-complexity envelope.
 *
 * The lane-audit formula §9 requires the ANALYZER and the PRODUCT ENTRY
 * measured separately, normalized per 1,000 nodes AND inside a fixed size band,
 * against a sibling language in the same family, with the scaling checked by
 * quartile, and with every row carrying a LOAD CONTEXT — a row measured under
 * concurrent load is unscored, not evidence (#871; the C row was 10x inflated
 * with no disclosure, #909).
 *
 * The sibling chosen is POWERSHELL: it is the other `m14.6-scripting` lane, it
 * shares the shell-command surface (builtins, pipelines, command substitution)
 * and it is the nearest comparable in the router, so a ratio against it says
 * something a ratio against, say, typescript would not.
 *
 * Writes nothing.
 */
import { readFileSync } from "node:fs"
import os from "node:os"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { ASTEngine } from "../../../src/ast/engine"
import { RealBashAnalyzer } from "../../../src/ast/real-bash-analyzer"
import { RealPowershellAnalyzer } from "../../../src/ast/real-powershell-analyzer"

const ROOT = process.cwd()
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

interface Row { repo: string; file: string; bytes: number; nodes: number; ms: number }
const rows: Row[] = []

function corpusFor(lang: "bash" | "powershell", repo: string, exts: string[]): { file: string; abs: string }[] {
  const dir = path.join(CORPUS_ROOT, repo)
  const tracked = execFileSync("git", ["-C", dir, "ls-files", ...exts], { encoding: "utf8" }).trim().split("\n").filter(Boolean)
  return tracked.map((f) => ({ file: f, abs: path.join(dir, f) }))
}

function nodeCount(root: any): number {
  let n = 0
  const st: any[] = [root]
  while (st.length > 0) {
    const x: any = st.pop()
    if (!x) continue
    n++
    for (let i = 0; i < x.childCount; i++) { const c = x.child(i); if (c) st.push(c) }
  }
  return n
}

async function measure(
  label: string,
  wasm: string,
  exts: string[],
  repo: string,
  Analyzer: any,
): Promise<Row[]> {
  const parser = new P()
  parser.setLanguage(await L.load(readFileSync(path.join(ROOT, "wasm", wasm))))
  const files = corpusFor(label as any, repo, exts)
  const out: Row[] = []
  for (const f of files) {
    let text: string
    try { text = readFileSync(f.abs, "utf8") } catch { continue }
    const tree = parser.parse(text)
    if (!tree) continue
    const nodes = nodeCount(tree.rootNode)
    const a = new Analyzer()
    // warm the JIT on the first file, then measure — the first call carries
    // module-load cost that is not the analyzer's per-file time.
    a.analyze(tree.rootNode, text, f.abs)
    const t0 = process.hrtime.bigint()
    a.analyze(tree.rootNode, text, f.abs)
    const ms = Number(process.hrtime.bigint() - t0) / 1e6
    out.push({ repo, file: f.file, bytes: Buffer.byteLength(text), nodes, ms })
    tree.delete?.()
  }
  return out
}

// Load context, measured rather than asserted: how many other lanes are mid-run.
const load = os.loadavg()[0]
const cpus = os.cpus().length
// A perf row is EVIDENCE only when the machine was quiet enough to measure it.
// The formula is explicit (and #871/#909 are the precedent): a row measured
// under concurrent load is UNSCORED, not a smaller number. The load is read at
// run time and the verdict is computed from it, so the row cannot be published
// as evidence by accident.
const loadRatio = load / cpus
const loadContext = `loadavg1=${load.toFixed(2)} on ${cpus} cpus (ratio ${loadRatio.toFixed(2)}), single-process, no concurrent lane of this run`
const scored = loadRatio < 1.0
const loadVerdict = scored
  ? "SCORED: the machine was quieter than one run's worth of load, so the ratio is a comparison rather than a measurement of contention."
  : `UNSCORED: loadavg1 is ${loadRatio.toFixed(2)}x the core count, so every millisecond here includes time this process did not get. The numbers are published for shape (scaling, normalization, the band) and NOT as a performance claim; a scored row needs a re-run at loadavg1 < ${cpus}. See #871 (a row measured under load is unscored) and #909 (the C row was 10x inflated with no disclosure).`

const bash = await measure("bash", "tree-sitter-bash.wasm", ["*.sh", "*.bash"], "otp", RealBashAnalyzer)
const ps = await measure("powershell", "tree-sitter-powershell.wasm", ["*.ps1"], "powershell", RealPowershellAnalyzer)

function report(label: string, rows: Row[]) {
  const totalMs = rows.reduce((a, r) => a + r.ms, 0)
  const totalNodes = rows.reduce((a, r) => a + r.nodes, 0)
  const perK = (totalMs / totalNodes) * 1000
  // fixed size band: files between 1 and 8 KiB, so the comparison is not a
  // comparison of corpus shapes
  const band = rows.filter((r) => r.bytes >= 1024 && r.bytes <= 8192)
  const bandMs = band.reduce((a, r) => a + r.ms, 0)
  const bandNodes = band.reduce((a, r) => a + r.nodes, 0)
  const bandPerK = bandNodes ? (bandMs / bandNodes) * 1000 : 0
  // quartiles by size — equal-count buckets over the size-sorted rows
  const sorted = [...rows].sort((a, b) => a.bytes - b.bytes)
  const per = Math.ceil(sorted.length / 4)
  const quart = [0, 1, 2, 3].map((i) => {
    const s = sorted.slice(i * per, (i + 1) * per)
    const ms = s.reduce((a, r) => a + r.ms, 0)
    const by = s.reduce((a, r) => a + r.bytes, 0)
    return { quartile: i + 1, files: s.length, ms: +ms.toFixed(2), bytes: by, msPerKiB: by ? +((ms / by) * 1024).toFixed(3) : 0 }
  })
  return { label, files: rows.length, totalMs: +totalMs.toFixed(2), totalNodes, msPerKNodes: +perK.toFixed(3), band: { files: band.length, msPerKNodes: +bandPerK.toFixed(3), bytes: "1KiB-8KiB" }, quartiles: quart, loadContext, scored }
}

const b = report("bash", bash)
const p = report("powershell", ps)
console.log(JSON.stringify({
  bash: b,
  powershell: p,
  ratioMsPerKNodes: +(b.msPerKNodes / p.msPerKNodes).toFixed(3),
  ratioBand: +(b.band.msPerKNodes / p.band.msPerKNodes).toFixed(3),
  sibling: "powershell — the other m14.6-scripting lane; it shares the builtin/pipeline/command-substitution surface, so the ratio compares like with like",
  loadVerdict,
  scalingRead: "msPerKiB across the four size quartiles is the linearity check: a flat column means time tracks size, and a rising column means super-linear. The band row is the apples-to-apples comparison.",
}, null, 2))
