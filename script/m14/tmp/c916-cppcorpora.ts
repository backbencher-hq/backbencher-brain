// The other two corpora in the family's four-corpus A/B: their c files must be
// unaffected by an analyzer-only wave.
import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const { RealCAnalyzer: Post } = await import(path.join(ROOT, "src/ast/real-c-analyzer.ts"))
const { RealCAnalyzer: Pre } = await import(path.join(ROOT, "src/ast/zz-c916-pre-analyzer.ts"))
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm")))
const FILES = ["/home/ishaq2321/bb_tests/repositories/fmt/repo/test/c-test.c",
  "/home/ishaq2321/bb_tests/repositories/nlohmann-json/repo/tests/abi/..."]
// Resolve whatever .c files exist rather than guessing paths.
import { execSync } from "node:child_process"
const found: string[] = []
for (const r of ["fmt", "nlohmann-json"]) {
  const base = `/home/ishaq2321/bb_tests/repositories/${r}`
  const out = execSync(`find ${base} -name "*.c" -not -path "*/.git/*"`, { encoding: "utf8" }).trim()
  if (out) found.push(...out.split("\n"))
}
for (const f of found) {
  const src = readFileSync(f, "utf8")
  const parser = new P()
  parser.setLanguage(lang)
  const root = parser.parse(src).rootNode
  const dump = (res: any) => JSON.stringify({
    s: (res.symbols ?? []).map((x: any) => `${x.range?.startLine}:${x.kind}:${x.name}`).sort(),
    r: (res.relationships ?? []).map((x: any) => `${x.line_number}:${x.type}:${x.source}->${x.target}`).sort(),
  })
  const a = dump(new Pre().analyze(root, src, f))
  const b = dump(new Post().analyze(root, src, f))
  console.log(`${f.replace("/home/ishaq2321/bb_tests/repositories/", "")}: ${a === b ? "IDENTICAL" : "DIFFERS"} (${JSON.parse(b).s.length} symbols, ${JSON.parse(b).r.length} rels)`)
}
