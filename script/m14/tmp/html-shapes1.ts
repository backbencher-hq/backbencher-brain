import * as fs from "fs"
import * as path from "path"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-html.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
function dump(n: any, d = 0) {
  console.log("  ".repeat(d) + n.type + (n.isNamed ? "" : " (anon)") + `  "${n.text.slice(0, 40).replace(/\n/g, "\\n")}"`)
  for (let i = 0; i < n.namedChildCount; i++) dump(n.namedChild(i), d + 1)
}
async function main() {
  for (const [k, s] of Object.entries({
    media_source: `<video id="v" src="v.mp4"><source src="v.webm"></video>`,
    svg_use: `<svg id="s"><use href="#icon"/></svg>`,
    anchor: `<a href="#top">x</a>`,
  })) { console.log(`=== ${k}`); dump(await parse(s)) }
}
main()
