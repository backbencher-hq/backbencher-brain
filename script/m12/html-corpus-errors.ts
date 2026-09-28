// M12.14: HTML corpus error scan — fresh parser per file (mirrors the
// production pipeline), counting ERROR/missing nodes, crashes, timeouts.
// Corpus: svelte@26786e92 (the svelte repo's real .html files — compiler
// test expected outputs, the canonical HTML subset for this corpus target).
import { readFileSync } from "fs"
import { ASTEngine } from "../../src/ast/engine"

const REPO = "$HOME/fixtures/repositories/svelte"
const SAMPLE = "validation/m12/results/html-corpus-sample.txt"

async function main() {
  const files = readFileSync(SAMPLE, "utf8").split("\n").map((l) => l.trim()).filter(Boolean)
  console.log(`sample files: ${files.length}`)

  let errFiles = 0
  let errNodes = 0
  let crashes = 0
  let timeouts = 0
  const errList: string[] = []

  for (const rel of files) {
    const src = readFileSync(`${REPO}/${rel}`, "utf8")
    let tree: any
    try {
      tree = await Promise.race([
        ASTEngine.getParser("html").then((p) => p.parse(src)),
        new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 10000)),
      ])
    } catch (e: any) {
      if (e?.message === "timeout") timeouts++
      else crashes++
      continue
    }
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
    if (nodes > 0) {
      errFiles++
      errNodes += nodes
      if (errList.length < 12) errList.push(`${rel} (${nodes})`)
    }
  }

  console.log(`errFiles=${errFiles}/${files.length} (${((errFiles / files.length) * 100).toFixed(1)}%) errNodes=${errNodes} crashes=${crashes} timeouts=${timeouts}`)
  for (const e of errList) console.log(`  ${e}`)
  if (errFiles > 0 || crashes > 0 || timeouts > 0) {
    console.log("CORPUS HAS ERRORS")
    process.exitCode = 1
  } else {
    console.log("CORPUS CLEAN")
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
