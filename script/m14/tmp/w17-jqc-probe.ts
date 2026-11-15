// M49 W17 — jq:c residual classification probe. The F5 jq:c lane reports 23
// unexplained uses; the samples point at (a) flex/yacc-generated machinery
// (yy_*, YY_*) in lexer.c/parser.c and (b) file-scope anonymous enums
// (ITER_FINISHED, enum { ... } in jv.c). Classify ALL 23 against the tree.
import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"
import { RealCAnalyzer } from "../../../src/ast/real-c-analyzer"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const JQ = "/home/ishaq2321/bb_tests/repositories/jq"
const FILES = [
  "src/lexer.c", "src/parser.c", "src/jv.c", "src/main.c", "src/execute.c",
  "src/builtin.c", "src/jq_test.c", "src/linker.c", "src/srcversion.c",
]

async function parseFile(abs: string) {
  const P: any = (WTS as any).Parser ?? (WTS as any).default ?? WTS
  const L: any = (WTS as any).Language ?? (WTS as any).default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const src = fs.readFileSync(abs, "utf8")
  return { root: p.parse(src).rootNode, src }
}

async function main() {
  const analyzer = new RealCAnalyzer()
  const counts: Record<string, number> = {}
  const samples: { target: string; file: string; kind: string }[] = []
  for (const rel of FILES) {
    const abs = path.join(JQ, rel)
    if (!fs.existsSync(abs)) continue
    const { root, src } = await parseFile(abs)
    const out: any = await analyzer.analyze(root, src, rel)
    const rels: any[] = out.relationships ?? out.relationshipsList ?? []
    for (const r of rels) {
      if (r.target === undefined) continue
      const label = r.type ?? r.kind
      const key = `${label}:${(r.metadata as any)?.resolvesVia ?? "plain"}`
      counts[key] = (counts[key] ?? 0) + 1
      if (label === "Uses" || label === "uses") {
        const t = String(r.target)
        if (/^(yy_|YY_|ITER_FINISHED)/.test(t)) {
          samples.push({ target: t, file: rel, kind: (r.metadata as any)?.resolvesVia ?? "plain" })
        }
      }
    }
  }
  console.log("relationship label:resolvesVia counts:")
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${k} = ${v}`)
  console.log("\nyy/YY/ITER samples (should NOT exist if generated+enum machinery is excluded):", samples.length)
  for (const s of samples.slice(0, 12)) console.log("  ", s.target, "@", s.file)
}
main().catch(e => { console.error(e); process.exit(1) })
