/**
 * The grammar's tree shape for the constructs this lane's edges are derived from, printed
 * rather than described.
 *
 * `css-emitted-coverage.ts` cites this file in two places where a wrong assumption about
 * the shape produced a wrong MEASUREMENT rather than a wrong opinion, which is the failure
 * mode a reconciler cannot have:
 *
 *   1. at-rule contents live under a `block` CHILD (`media_statement -> block -> rule_set`),
 *      so counting DIRECT `rule_set` children reads 0 against 31,879 published edges;
 *   2. a `keyframe_block` is not a `rule_set`, so `currentSelector` is empty inside one and
 *      every `var()` there had no owner until the pass-11 fix.
 *
 * Run: npx tsx validation/m14/tmp/css-tree-shape.ts
 * READ-ONLY. Writes nothing. Prints a node-type tree for a fixed source string.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-css.wasm"))))
const src = `@media screen and (min-width: 100px) { .a { color: red; } .b { color: blue } }
@supports (display: grid) { .c { color: red } }
@layer base { .d { color: red } }
@theme inline { --x: var(--y); }
@font-face { font-family: "A"; src: var(--src); }
@keyframes fade { from { opacity: var(--o) } }
`
const t = parser.parse(src)
function show(n: any, d: number) {
  if (d > 4) return
  console.log("  ".repeat(d) + n.type + (n.namedChildCount === 0 ? `  = ${JSON.stringify(n.text.slice(0, 40))}` : ""))
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) show(c, d + 1) }
}
show(t.rootNode, 0)
