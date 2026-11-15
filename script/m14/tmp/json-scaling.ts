import { parseFile } from "/home/ishaq2321/mcp/backbencher-brain/src/ast/pool-worker"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "path"
const d = mkdtempSync(path.join(tmpdir(), "bb-jsonperf-"))
// Synthesise documents of controlled SIZE and DEPTH so the two can be told apart.
const flat = (keys: number) => { const o: any = {}; for (let i = 0; i < keys; i++) o[`k${i}`] = `v${i}`; return JSON.stringify(o, null, 2) }
const nested = (depth: number, fan: number): any => {
  let node: any = { leaf: "v" }
  for (let d = 0; d < depth; d++) { const o: any = {}; for (let f = 0; f < fan; f++) o[`c${f}`] = f === fan - 1 ? node : `v${f}`; node = o }
  return node
}
const time = async (label: string, src: string, n = 15) => {
  const p = path.join(d, "t.json"); writeFileSync(p, src)
  // Report the MINIMUM of n runs, and the spread, because a single sample cannot
  // distinguish a complexity curve from a garbage-collection pause. The first pass
  // used n=5 and showed a 7.6x jump at 60KB that then REVERSED at 253KB, which is
  // not a shape any power law produces — so it was measured again before anything
  // was concluded from it.
  let best = Infinity, worst = 0
  for (let i = 0; i < n; i++) { const t0 = performance.now(); await parseFile(p, d); const ms = performance.now() - t0; if (ms < best) best = ms; if (ms > worst) worst = ms }
  const kb = Buffer.byteLength(src) / 1024
  console.log(`  ${label.padEnd(30)} ${kb.toFixed(1).padStart(7)} KB   min ${best.toFixed(1).padStart(8)} ms   max ${worst.toFixed(1).padStart(8)} ms   spread x${(worst/best).toFixed(1).padStart(5)}   ${(best / kb).toFixed(2).padStart(6)} ms/KB`)
  return { kb, ms: best }
}
console.log("  --- SIZE sweep, flat shape (isolates per-byte cost) ---")
const rows: any[] = []
for (const k of [200, 800, 1600, 3200, 6400, 12800]) rows.push(await time(`flat, ${k} keys`, flat(k)))
console.log("  --- ratio check: time should scale ~LINEARLY with KB if the walk is O(n) ---")
for (let i = 1; i < rows.length; i++) {
  const kbR = rows[i].kb / rows[i - 1].kb, msR = rows[i].ms / rows[i - 1].ms
  console.log(`    ${rows[i - 1].kb.toFixed(0).padStart(6)}KB -> ${rows[i].kb.toFixed(0).padStart(7)}KB : size x${kbR.toFixed(1).padStart(5)}   time x${msR.toFixed(1).padStart(5)}   ${msR > kbR * 1.25 ? "SUPERLINEAR" : "linear-ish"}`)
}
console.log("  --- DEPTH sweep, constant size (isolates depth cost) ---")
for (const [dep, fan] of [[5, 4], [10, 4], [20, 4], [40, 4], [80, 4]] as [number, number][]) {
  await time(`depth ${dep}, fan ${fan}`, JSON.stringify(nested(dep, fan), null, 2))
}
rmSync(d, { recursive: true, force: true })
