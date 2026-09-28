// M12.23 Elixir: shape-safety — every node.type reference in the Elixir
// analyzer must be a type the pinned grammar actually emits. Ground truth =
// the distinct node types observed across the full corpus + fixtures.
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { ASTEngine } from "../../src/ast/engine"

const ROOT = "$HOME/mcp/backbencher-brain"
const CORPUS = "$HOME/fixtures/repositories/elixir"
const ANALYZER = readFileSync(`${ROOT}/src/ast/real-elixir-analyzer.ts`, "utf8")

// Extract every string literal compared against .type — `c?.type === "..."`,
// `node.type === "..."`, `child.type === "..."`, etc.
const refs = new Set<string>()
for (const m of ANALYZER.matchAll(/\.type\s*===\s*"([^"]+)"/g)) refs.add(m[1])
for (const m of ANALYZER.matchAll(/\.type\s*===\s*'([^']+)'/g)) refs.add(m[1])

function collect(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git") continue
        walk(p)
      } else if (e.name.endsWith(".ex")) out.push(p)
    }
  }
  walk(root)
  return out
}

async function main() {
  const files = collect(CORPUS)
  // Deterministic sample: all corpus files + the fixtures (the 243-file scan
  // already proved 0 errors, so these trees are well-formed).
  const parser = await ASTEngine.getParser("elixir")
  const emitted = new Set<string>()
  for (const f of files) {
    const tree = parser.parse(readFileSync(f, "utf8"))
    const visit = (n: any) => {
      emitted.add(n.type)
      for (let i = 0; i < n.childCount; i++) visit(n.child(i))
    }
    visit(tree.rootNode)
  }
  // Also parse the M11 fixture
  for (const f of ["validation/m11/fixtures/fp/order_book.ex"]) {
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
  writeFileSync("/tmp/elixir-emitted-types.txt", [...emitted].sort().join("\n"))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
