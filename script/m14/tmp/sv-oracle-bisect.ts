// Minimal-trigger bisect: transform the real file in controlled ways and see
// when the fabricated edge appears/disappears.
import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const FILE = "<corpus-root>/bb_tests/repositories/svelte/packages/svelte/types/index.d.ts"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const ts = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-typescript.wasm")))
  const mod: any = await import("../../../script/m14/differential")
  const src = fs.readFileSync(FILE, "utf8")
  const p = new P(); p.setLanguage(ts)

  const hits = (code: string) => {
    const e = mod.deriveTreeEdges(p.parse(code).rootNode, "typescript")
    return (e as any[]).filter((x: any) => x.label === "overrides" && String(x.from).includes("Spring"))
  }

  const cases: [string, string][] = [
    ["full real file", src],
    // 1. Spring renamed -> does the phantom follow the NAME?
    ["Spring renamed to Zzz", src.replace("export class Spring<T> {", "export class Zzz<T> {")],
    // 2. Spring body emptied (keep class) -> method-side or heritage-side?
    ["Spring body emptied", src.replace(/export class Spring<T> \{[\s\S]*?\n\t\}/, "export class Spring<T> {\n}")],
    // 3. Readable interface removed -> target vanishes?
    ["Readable removed", src.replace(/interface Readable<T> \{[\s\S]*?\n\t\}/, "")],
    // 4. Tweened removed (it extends Readable)
    ["Tweened removed", src.replace(/export interface Tweened<T> extends Readable<T> \{[\s\S]*?\n\t\}/, "")],
    // 5. ALL class decls except Spring removed
    ["only Spring+Readable kept", (() => {
      const lines = src.split("\n")
      // crude: keep only lines defining Readable/Spring regions — instead slice the declare module block containing Spring
      const start = lines.findIndex((l) => l.includes("declare module 'svelte/motion'"))
      const end = lines.findIndex((l, i) => i > start && l === "}")
      const block = lines.slice(start, end + 1).join("\n")
      return block
    })()],
  ]
  for (const [name, code] of cases) {
    const h = hits(code)
    console.log(name.padEnd(30) + " -> " + JSON.stringify(h))
  }
}
main()
