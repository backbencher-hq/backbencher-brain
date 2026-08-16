// M12.12 Vue corpus error measurement on the pinned Element Plus sample.
// Fresh parser per file (mirrors production pool-worker) to avoid the
// single-long-lived-parser memory exhaustion that causes spurious Abort()s.
// Usage: bun script/m12/vue-corpus-errors.ts
// Reads:  validation/m12/results/vue-corpus-sample.txt (relative paths into
//         the pinned element-plus repo at $HOME/fixtures/repositories/element-plus)
import { readFileSync } from "fs"
import { ASTEngine } from "../../src/ast/engine"

const REPO = "$HOME/fixtures/repositories/element-plus"
const SAMPLE = "validation/m12/results/vue-corpus-sample.txt"

async function main() {
  const files = readFileSync(SAMPLE, "utf8").split("\n").map((l) => l.trim()).filter(Boolean)
  console.log(`sample files: ${files.length}`)

  let errFiles = 0, errNodes = 0, crashes = 0, timeouts = 0
  const errList: string[] = []
  for (const rel of files) {
    const p = `${REPO}/${rel}`
    let src: string
    try { src = readFileSync(p, "utf8") } catch { continue }
    const started = Date.now()
    try {
      const parser = await ASTEngine.getParser("vue")
      const tree = parser.parse(src)
      if (Date.now() - started > 10000) { timeouts++; console.log("TIMEOUT:", rel); continue }
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
  console.log(`errFiles=${errFiles}/${files.length} (${((errFiles / files.length) * 100).toFixed(1)}%) errNodes=${errNodes} crashes=${crashes} timeouts=${timeouts}`)
  if (errList.length) console.log("first error files:", errList.join(", "))
  console.log(errFiles === 0 && crashes === 0 && timeouts === 0 ? "CORPUS CLEAN" : "CORPUS HAS ERRORS")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
