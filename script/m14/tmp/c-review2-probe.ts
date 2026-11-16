import * as fs from "fs"
import * as path from "path"
import { RealCAnalyzer } from "../../../src/ast/real-c-analyzer"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
function findAll(n: any, pred: (x: any) => boolean, out: any[] = []): any[] {
  if (pred(n)) out.push(n)
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) }
  return out
}
async function main() {
  const run = async (name: string, src: string, checks: (r: any, root: any) => void) => {
    const root = await parse(src)
    const r: any = await new RealCAnalyzer().analyze(root, src, "T.c")
    try { checks(r, root); console.log("ok   " + name) } catch (e: any) { console.log("FAIL " + name + " :: " + e.message) }
  }
  await run("C6-static-prototype", `static int hidden(int x);\nint shown(int x);\nint main(void) { return hidden(1) + shown(2); }\n`, (r) => {
    const syms = (r.symbols ?? []).map((s: any) => `${s.name}:${s.kind}:vis=${s.visibility}`)
    const exps = (r.exports ?? []).map((e: any) => e.name)
    console.log("   syms=" + JSON.stringify(syms) + " exports=" + JSON.stringify(exps))
    const h = (r.symbols ?? []).find((s: any) => s.name === "hidden")
    if (h && h.visibility !== "private") throw new Error("static prototype not private (claim TRUE)")
    if (exps.includes("hidden")) throw new Error("static prototype exported (claim TRUE)")
  })
  await run("C13-macro-value", `#define MAXN 100\n#define SQUARE(x) ((x)*(x))\nint buf[MAXN];\nint k = MAXN;\nint cmp(const void *a, const void *b);\nvoid sortem(void) { qsort(buf, MAXN, sizeof(int), cmp); }\nint use_sq = SQUARE(3);\n`, (r) => {
    const rels = (r.relationships ?? []).map((x: any) => `${x.type}:${x.source}->${x.target}`)
    console.log("   rels=" + JSON.stringify(rels))
    if (!rels.some((s: string) => s.includes("uses:") && s.includes("MAXN"))) throw new Error("macro value read lost")
    if (!rels.some((s: string) => s.includes("calls:") && s.includes("SQUARE"))) throw new Error("function-like macro call lost")
  })
  await run("C19-default-goto", `void f(int y) { switch (y) { case 1: break; } }\n`, (r) => {
    console.log("   perf=" + (r.metadata ?? {}).performanceScore + " cyc=" + (r.metadata ?? {}).cyclomaticComplexity)
    ;(globalThis as any).__c19a = (r.metadata ?? {}).performanceScore
  })
  await run("C19-default-goto-b", `void f(int y) { switch (y) { case 1: break; default: break; } }\n`, (r, root) => {
    const perf = (r.metadata ?? {}).performanceScore
    console.log("   perf=" + perf + " cyc=" + (r.metadata ?? {}).cyclomaticComplexity)
    const lbl = findAll(root, (n) => n.type === "labeled_statement").map((n: any) => n.text.slice(0, 20) + " parent=" + n.parent?.type)
    console.log("   labeled=" + JSON.stringify(lbl))
    if (perf !== (globalThis as any).__c19a) throw new Error(`default: changes performance ${ (globalThis as any).__c19a } -> ${perf} (claim TRUE)`)
  })
}
main()
