import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-svelte.wasm")))
  const p = new P(); p.setLanguage(lang)
  const dump = (n: any, d: number, out: string[]) => {
    if (!n || d > 4) return
    out.push("  ".repeat(d) + n.type + (n.isNamed ? "" : " (anon)") + " = " + JSON.stringify(String(n.text).slice(0, 40)))
    for (let i = 0; i < n.childCount && i < 10; i++) dump(n.child(i), d + 1, out)
  }
  for (const src of [
    `<Comp {value} title="x" />`,
    `<svelte:component this={Comp} />`,
    `<Comp {...props} />`,
    `<div class:active={isOn} style:color={c} />`,
  ]) {
    const out: string[] = []
    dump(p.parse(src).rootNode, 0, out)
    console.log("=== " + src + " ===\n" + out.slice(0, 30).join("\n"))
  }
}
main()
