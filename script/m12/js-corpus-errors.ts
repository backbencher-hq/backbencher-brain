// M12.10 JavaScript corpus error measurement on the pinned sample list.
// Fresh parser per file (mirrors production pool-worker) to avoid the
// single-long-lived-parser memory exhaustion that causes spurious Abort()s.
// Usage: bun script/m12/js-corpus-errors.ts
// Reads:  validation/m12/results/javascript-corpus-sample.txt (relative paths
//         into the pinned svelte repo at $HOME/fixtures/repositories/svelte)
// Prints: per-file error stats + aggregate (errFiles / errNodes / crashes)
import { readFileSync } from "fs"
import { ASTEngine } from "../../src/ast/engine"

const REPO = "$HOME/fixtures/repositories/svelte"
const SAMPLE = "validation/m12/results/javascript-corpus-sample.txt"

async function main() {
  const files = readFileSync(SAMPLE, "utf8").split("\n").map((l) => l.trim()).filter(Boolean)
  console.log(`sample files: ${files.length}`)

  let errFiles = 0, errNodes = 0, crashes = 0
  const errList: string[] = []
  for (const rel of files) {
    const p = `${REPO}/${rel}`
    let src: string
    try { src = readFileSync(p, "utf8") } catch { continue }
    try {
      const parser = await ASTEngine.getParser("javascript")
      const tree = parser.parse(src)
      let nodes = 0
      const stack = [tree.rootNode]
      while (stack.length) {
        const n = stack.pop()!
        if (n.type === "ERROR" || n.isMissing) nodes++
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) stack.push(c)
        }
      }
      if (nodes > 0) { errFiles++; errNodes += nodes; if (errList.length < 15) errList.push(`${rel} (${nodes})`) }
    } catch {
      crashes++
      if (crashes <= 10) console.log("CRASH:", rel)
    }
  }
  console.log(`errFiles=${errFiles}/${files.length} (${((errFiles / files.length) * 100).toFixed(1)}%) errNodes=${errNodes} crashes=${crashes}`)
  if (errList.length) console.log("first error files:", errList.join(", "))
}
main().catch((e) => { console.error(e); process.exit(1) })
