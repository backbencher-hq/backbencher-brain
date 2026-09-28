// Definitive full-corpus error measurement: git-tracked .fs/.fsi/.fsx files.
// Fresh parser per file (like the production pool-worker) avoids the
// single-long-lived-parser memory exhaustion that causes spurious Abort()s.
// Usage: bun script/scratch-fs-full-errors.ts <chunkFile> [resultsFile]
//   chunkFile:  one relative path per line (git-tracked F# file)
//   resultsFile: append a single summary line (default /tmp/fs-full-errors-results.txt)
import { readFileSync, appendFileSync } from "fs"
import { ASTEngine } from "../src/ast/engine"

async function main() {
  const repo = "$HOME/fixtures/repositories/fsharp"
  const chunkFile = process.argv[2]
  const resultsFile = process.argv[3] || "/tmp/fs-full-errors-results.txt"
  const files = readFileSync(chunkFile, "utf8").split("\n").map((l) => l.trim()).filter(Boolean)

  let errFiles = 0, errNodes = 0, crashes = 0
  for (const rel of files) {
    const p = `${repo}/${rel}`
    let src: string
    try { src = readFileSync(p, "utf8") } catch { continue }
    try {
      // Fresh parser per file — mirrors the production pipeline.
      const parser = await ASTEngine.getParser("fsharp")
      const tree = parser.parse(src)
      let nodes = 0
      const stack = [tree.rootNode]
      while (stack.length) {
        const n = stack.pop()!
        if (n.type === "ERROR" || n.isMissing) nodes++
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
      }
      if (nodes > 0) { errFiles++; errNodes += nodes }
    } catch {
      crashes++
      if (crashes <= 10) console.log("CRASH:", rel)
    }
  }
  const line = `${chunkFile} files=${files.length} errFiles=${errFiles} errNodes=${errNodes} crashes=${crashes}`
  console.log(line)
  appendFileSync(resultsFile, line + "\n")
}
main().catch((e) => { console.error(e); process.exit(1) })
