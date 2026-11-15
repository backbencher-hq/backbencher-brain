// Harness validation: did the transforms actually change the parsed text?
import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const FILE = "/home/ishaq2321/bb_tests/repositories/svelte/packages/svelte/types/index.d.ts"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const ts = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-typescript.wasm")))
  const src = fs.readFileSync(FILE, "utf8")
  const p = new P(); p.setLanguage(ts)

  const renamed = src.replace("export class Spring<T> {", "export class Zzz<T> {")
  console.log("rename changed string:", renamed !== src, "| Zzz present:", renamed.includes("Zzz"), "| Spring class decl gone:", !renamed.includes("export class Spring<T> {"))
  const r1 = p.parse(renamed).rootNode
  console.log("renamed tree still has 'class Spring':", r1.text.includes("export class Spring"))

  const emptied = src.replace(/export class Spring<T> \{[\s\S]*?\n\t\}/, "export class Spring<T> {\n}")
  console.log("empty changed string:", emptied !== src, "| len delta:", src.length - emptied.length)
  const r2 = p.parse(emptied).rootNode
  console.log("emptied tree Spring body len:", JSON.stringify(r2.text.slice(r2.text.indexOf("export class Spring"), r2.text.indexOf("export class Spring") + 60)))

  // maybe deriveTreeEdges caches module-level state — call TWICE on same root
  const mod: any = await import("../../../script/m14/differential")
  const e_a = mod.deriveTreeEdges(p.parse(renamed).rootNode, "typescript")
  const e_b = mod.deriveTreeEdges(p.parse(renamed).rootNode, "typescript")
  const fa = (e_a as any[]).filter((x: any) => x.label === "overrides" && String(x.from).includes("Spring"))
  const fb = (e_b as any[]).filter((x: any) => x.label === "overrides" && String(x.from).includes("Spring"))
  console.log("renamed: call1 = " + JSON.stringify(fa) + " | call2 = " + JSON.stringify(fb))
}
main()
