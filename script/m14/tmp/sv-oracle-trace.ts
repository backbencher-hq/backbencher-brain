// Trace: which node in the Spring class body could register "subscribe"?
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
  const root = p.parse(src).rootNode

  const findAll = (n: any, t: string, out: any[] = []): any[] => {
    if (n.type === t) out.push(n)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, t, out) }
    return out
  }
  const classes = findAll(root, "class_declaration")
  const spring = classes.find((c: any) => c.text.startsWith("class Spring"))
  if (!spring) { console.log("no Spring class_declaration found; classes: " + classes.map((c: any) => c.text.slice(0, 30)).join(" | ")); return }
  const body = spring.namedChildren.find((c: any) => c.type === "class_body")
  console.log("Spring class_body children:")
  for (let i = 0; i < body.namedChildCount; i++) {
    const m = body.namedChild(i)
    const nameChild = m?.childForFieldName?.("name")
    console.log("  [" + i + "] " + m.type + " :: text=" + JSON.stringify(m.text.slice(0, 60)) + " name=" + (nameChild ? nameChild.text : "-"))
  }

  // Also check: what does the ORACLE see for Readable — interface or declaration?
  const ifaces = findAll(root, "interface_declaration")
  const rd = ifaces.find((c: any) => c.text.includes("interface Readable"))
  if (rd) {
    const rbody = rd.namedChildren.find((c: any) => c.type === "interface_body")
    console.log("\nReadable interface_body children:")
    for (let i = 0; i < rbody.namedChildCount; i++) {
      const m = rbody.namedChild(i)
      const nameChild = m?.childForFieldName?.("name")
      console.log("  [" + i + "] " + m.type + " :: " + JSON.stringify(m.text.slice(0, 70)) + " name=" + (nameChild ? nameChild.text : "-"))
    }
  }

  // Decisive: run the REAL oracle deriveTreeEdges and find the edge's origin
  // by binary-searching the source: does a reduced file (Spring class only +
  // Readable + Tweened) still produce it?
  const mod: any = await import("../../../script/m14/differential")
  if (mod.deriveTreeEdges) {
    const reduced = `interface Readable<T> {\n  subscribe(this: void, run: Subscriber<T>): Unsubscriber;\n}\ntype Subscriber<T> = (value: T) => void\ntype Unsubscriber = () => void\ntype Start<T> = (fn: (value: T) => void) => Unsubscriber\nclass Spring<T> extends Readable<T> {\n  constructor(value: T, options?: SpringOptions);\n  static of<U>(fn: () => U): Spring<U>;\n  set(value: T): Promise<void>;\n  get current(): T;\n}\ndeclare const SpringOpts: any\n`
    const p2 = new P(); p2.setLanguage(ts)
    const e1 = mod.deriveTreeEdges(p2.parse(src).rootNode, "typescript")
    const e2 = mod.deriveTreeEdges(p2.parse(reduced).rootNode, "typescript")
    const hit1 = (e1 as any[]).filter((x: any) => x.from?.startsWith?.("Spring.subscribe") || x.target?.startsWith?.("Readable.subscribe"))
    const hit2 = (e2 as any[]).filter((x: any) => x.from?.includes?.("Spring.subscribe"))
    console.log("\nreal-file oracle Spring/Readable override edges: " + JSON.stringify(hit1))
    console.log("reduced-file oracle Spring.subscribe edges: " + JSON.stringify(hit2))
    const allOvr = (e2 as any[]).filter((x: any) => x.label === "overrides")
    console.log("reduced-file ALL overrides: " + JSON.stringify(allOvr))
  } else {
    console.log("\nno deriveTreeEdges export; exports: " + Object.keys(mod).join(", "))
  }
}
main()
