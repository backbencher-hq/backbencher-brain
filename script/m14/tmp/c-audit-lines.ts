import { execFileSync } from "node:child_process"
import { parseFile } from "../../../src/ast/pool-worker"
import { readFileSync } from "node:fs"
const Z = "<corpus-root>/bb_tests/repositories/zig"
const files = execFileSync("bash", ["-c", `find ${Z} -name '*.c' -size +1k | sort | head -60`], { encoding: "utf8" }).split("\n").filter(Boolean)
let rels = 0, withLine = 0, withMetaLine = 0, withLineNumber = 0
const samples: string[] = []
for (const f of files) {
  const r: any = await parseFile(f, Z)
  for (const e of (r.relationships ?? [])) {
    rels++
    if (e.line !== undefined) withLine++
    if (e.line_number !== undefined) withLineNumber++
    if (e.metadata?.line !== undefined || e.metadata?.lineNumber !== undefined) withMetaLine++
    if (samples.length < 4) samples.push(JSON.stringify({ type: e.type, source: e.source, target: e.target, line: e.line, line_number: e.line_number, meta: e.metadata }).slice(0, 200))
  }
}
console.log(`relationships ${rels}: with .line=${withLine}, with .line_number=${withLineNumber}, with metadata.line/lineNumber=${withMetaLine}`)
for (const s of samples) console.log('  ', s)
// symbols: do they carry line_start?
const r0: any = await parseFile(files[0], Z)
const s0 = (r0.symbols ?? [])[0]
console.log('symbol sample:', s0 && JSON.stringify({ name: s0.name, range: s0.range }).slice(0, 160))
void readFileSync
