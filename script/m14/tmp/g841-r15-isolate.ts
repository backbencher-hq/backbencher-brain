// #841 round 15 recon: isolate each failing sub-construct.
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const parser = await ASTEngine.getParser("groovy" as any)

function errs(src: string): number {
  const t = parser.parse(src)
  let n = 0
  const walk = (x: any) => { if (x.type === "ERROR" || x.isMissing) n++; for (let i = 0; i < x.childCount; i++) walk(x.child(i)) }
  walk(t.rootNode)
  return n
}
const body = (l: string) => `class C {\n    void m() {\n        ${l}\n    }\n}\n`

const CASES: Record<string, string> = {
  "if a < b": "if (a < b) { }",
  "if a <= b": "if (a <= b) { }",
  "if !c": "if (!c) { }",
  "if !d('x')": "if (!d('x')) { }",
  "if a && b": "if (a && b) { }",
  "if a < b && c": "if (a < b && c) { }",
  "if a < b && !c": "if (a < b && !c) { }",
  "if !c && a": "if (!c && a) { }",
  "if a < b && !d('x')": "if (a < b && !d('x')) { }",
  "if a && !d('x')": "if (a && !d('x')) { }",
  "if !d('x') && a < b": "if (!d('x') && a < b) { }",
  "assertTrue a < b": "assertTrue a < b",
  "assertTrue a": "assertTrue a",
  "assertTrue (a < b)": "assertTrue (a < b)",
  "assertTrue a < b && c": "assertTrue a < b && c",
  "call a < b": "log a < b",
  "call a < b, c": "log a < b, c",
  "assign a < b": "def x = a < b",
  "assign a < b && c": "def x = a < b && c",
  "if (a < b) noBrace": "if (a < b) return",
  "tern a < b": "def x = a < b ? c : d",
}

for (const [name, line] of Object.entries(CASES)) {
  console.log(`${errs(body(line)) > 0 ? "FAIL" : "ok  "}  ${name}    ${JSON.stringify(line)}`)
}
