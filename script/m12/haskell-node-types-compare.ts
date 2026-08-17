// M12.25 Haskell: shape-safety — every node.type reference in the Haskell
// analyzer must be a type the pinned grammar actually emits. Ground truth =
// the distinct node types observed across the full corpus + fixtures.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { ASTEngine } from "../../src/ast/engine"

const ROOT = "$HOME/mcp/backbencher-brain"
const CORPUS = "$HOME/fixtures/repositories/cabal"
const ANALYZER = readFileSync(`${ROOT}/src/ast/real-haskell-analyzer.ts`, "utf8")

const refs = new Set<string>()
for (const m of ANALYZER.matchAll(/\.type\s*===\s*"([^"]+)"/g)) refs.add(m[1])
for (const m of ANALYZER.matchAll(/\.type\s*===\s*'([^']+)'/g)) refs.add(m[1])

function collect(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git" || e.name === "_build" || e.name === "dist-newstyle") continue
        walk(p)
      } else if (e.name.endsWith(".hs")) out.push(p)
    }
  }
  walk(root)
  return out
}

async function main() {
  const files = collect(CORPUS)
  const parser = await ASTEngine.getParser("haskell")
  const emitted = new Set<string>()
  for (const f of files) {
    const tree = parser.parse(readFileSync(f, "utf8"))
    const visit = (n: any) => {
      emitted.add(n.type)
      for (let i = 0; i < n.childCount; i++) visit(n.child(i))
    }
    visit(tree.rootNode)
  }
  for (const f of [
    "validation/m12/fixtures/haskell/Service.hs",
    "validation/m12/fixtures/haskell/Negative.hs",
    "validation/m11/fixtures/fp/Streaming.hs",
  ]) {
    const tree = parser.parse(readFileSync(`${ROOT}/${f}`, "utf8"))
    const visit = (n: any) => {
      emitted.add(n.type)
      for (let i = 0; i < n.childCount; i++) visit(n.child(i))
    }
    visit(tree.rootNode)
  }
  console.log(`corpus files parsed: ${files.length} | distinct emitted types: ${emitted.size} | analyzer refs: ${refs.size}`)
  const missing = [...refs].filter((r) => !emitted.has(r)).sort()
  console.log(`missing (referenced but never emitted): ${missing.length}`)
  for (const m of missing) console.log(`  MISSING ${m}`)
  const live = [...refs].filter((r) => emitted.has(r)).sort()
  console.log(`live: ${live.length}`)
  writeFileSync("/tmp/haskell-emitted-types.txt", [...emitted].sort().join("\n"))
}

import { writeFileSync } from "node:fs"
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
