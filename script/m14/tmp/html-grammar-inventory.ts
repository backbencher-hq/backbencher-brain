// html grammar inventory: every node type the pinned grammar can produce vs
// every type the analyzer references, and the dead/inert branches.
import * as fs from "fs"
import * as path from "path"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-html.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
const SAMPLES: Record<string, string> = {
  doctype: `<!DOCTYPE html>`,
  element: `<div id="a" class="b">x</div>`,
  self_closing: `<img src="a.png" alt="x" />`,
  script: `<script src="a.js"></script>`,
  script_inline: `<script>var a = 1;</script>`,
  module_script: `<script type="module">import a from "b";</script>`,
  style: `<style>.a { color: red; }</style>`,
  link: `<link rel="stylesheet" href="a.css">`,
  meta: `<meta charset="utf-8">`,
  comment: `<!-- c -->`,
  text: `hello`,
  raw_text: `<title>t</title>`,
  entity: `&amp;`,
  attribute: `<a href="x" target=_blank download>t</a>`,
  err: `<div><span></div>`,
  fragment: `<li>a</li>`,
  conditional: `<!--[if IE]>x<![endif]-->`,
  doctype_quirks: `<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd">`,
  template: `<template><div id="t"></div></template>`,
  svg: `<svg viewBox="0 0 1 1"><use href="#i"/></svg>`,
  form: `<form action="/a"><input name="n" value="v"><button>go</button></form>`,
}
function collect(n: any, out: Set<string>) { out.add(n.type); for (let i = 0; i < n.namedChildCount; i++) collect(n.namedChild(i), out) }
async function main() {
  const seen = new Set<string>()
  for (const [k, s] of Object.entries(SAMPLES)) { const r = await parse(s); collect(r, seen); }
  console.log("grammar node types seen (" + seen.size + "):")
  console.log([...seen].sort().join(" "))
}
main()
