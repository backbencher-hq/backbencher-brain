/** F3 PROBE — what does the php analyzer do with a deliberately broken region? */
import { readFileSync } from "node:fs"
import * as path from "node:path"
const ROOT = "$HOME/backbencher-brain"
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const g: any = await (wts as any).Language.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-php.wasm")))
const parser = new P(); parser.setLanguage(g)

const CANDIDATES: Record<string, string> = {
  "empty assignment": `<?php
class Before {}
class Broken { public function m() { $b = ; } }
class After {}
`,
  "unclosed brace in method": `<?php
class Before {}
class Broken { public function m() { if (true) {
class After {}
`,
  "stray paren": `<?php
class Before {}
$b = );
class After {}
`,
  "unterminated string": `<?php
class Before {}
$b = "unterminated;
class After {}
`,
  "keyword salad": `<?php
class Before {}
class class class
class After {}
`,
}
for (const [label, src] of Object.entries(CANDIDATES)) {
  const root = parser.parse(src).rootNode
  let errNodes = 0, missNodes = 0
  const st: any[] = [root]
  while (st.length) { const n = st.pop()!; if (n.type === "ERROR") errNodes++; if (n.isMissing) missNodes++; for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) st.push(c) } }
  const res: any = await ASTEngine.parseFile("/tmp/probe.php", src)
  const syms = (res.symbols ?? []).map((s: any) => `${s.kind}:${s.name}${s.ownerName ? ` (owner ${s.ownerName})` : ""}`)
  const rels = (res.relationships ?? []).map((r: any) => `${r.type}:${r.source}->${r.target}@L${r.line_number}`)
  console.log(`\n### ${label}  [ERROR nodes=${errNodes} missing=${missNodes} hasError=${root.hasError}]`)
  console.log(`  analyzer errors: ${(res.errors ?? []).length}  ${JSON.stringify((res.errors ?? []).map((e: any) => `${e.message}@${e.range?.startLine}:${e.range?.startColumn}`))}`)
  console.log(`  symbols: ${JSON.stringify(syms)}`)
  console.log(`  relationships: ${JSON.stringify(rels)}`)
}
process.exit(0)
