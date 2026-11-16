// Probe: the pinned php grammar's parameter-list FIELD name on each callable
// kind, plus the node shapes a default value can take. The line round for
// csharp showed that guessing a field name is how a "resolver" ends up
// publishing a name as a type — here it decides whether walkParams is called
// at all.
import * as fs from "fs"
import * as path from "path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-php.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const src = `<?php
class C {
  public function m(int $a, int $b = self::SUCCESS, private Dep $d = null): self { return $this; }
}
function f($x = MY_CONST) {}
$x = new class { public function g($y = 1) {} };
$c = fn($z = 2) => $z;
$e = function ($w = 3) {};
`
  const root = p.parse(src).rootNode
  const fields = (n: any): string => {
    const out: string[] = []
    for (const f of ["name", "body", "parameters", "type", "return_type", "function", "value", "default"]) {
      const c = n.childForFieldName?.(f)
      if (c) out.push(`${f}=${c.type}`)
    }
    return out.length ? "  [" + out.join(", ") + "]" : ""
  }
  const walk = (n: any, d = 0) => {
    console.log("  ".repeat(d) + n.type + fields(n) + (n.childCount && d < 6 ? "" : ""))
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (d < 6) walk(c, d + 1) }
  }
  walk(root)
  console.log("root.hasError =", root.hasError)
}
main()
