// C lane audit: profile the PRODUCTION entry (parseFile → ASTEngine.parseFile)
// over the M12 C slice, so the hotspot is named rather than guessed.
// Run: bun --cpu-prof --cpu-prof-dir=/tmp/cprof script/m14/tmp/c-audit-parsefile-prof.ts
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { parseFile } from "../../../src/ast/pool-worker"

const N = Number(process.env.BB_N ?? 80)
const Z = "<corpus-root>/bb_tests/repositories/zig"
const files = execFileSync("bash", ["-c", `find ${Z} -name '*.c' -size +1k -not -path '*/.git/*' | sort | head -400`], { encoding: "utf8" }).split("\n").filter(Boolean).slice(0, N)
console.log(`profiling parseFile over ${files.length} C files`)
const t0 = performance.now()
let sym = 0
let rel = 0
for (const f of files) {
  const r: any = await parseFile(f, Z)
  sym += r?.symbols?.length ?? 0
  rel += r?.relationships?.length ?? 0
}
const ms = performance.now() - t0
console.log(`parseFile: ${(ms / 1000).toFixed(1)}s for ${files.length} files = ${(ms / files.length).toFixed(1)}ms/file, ${(files.length / (ms / 1000)).toFixed(2)} files/s`)
console.log(`symbols ${sym}, relationships ${rel}`)
void readFileSync
