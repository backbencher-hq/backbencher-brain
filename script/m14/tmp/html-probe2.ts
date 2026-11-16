// html hostile probe #2: verify the suspects with correct shapes.
import * as fs from "fs"
import * as path from "path"
import { RealHtmlAnalyzer } from "../../../src/ast/real-html-analyzer"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-html.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
const CASES: Record<string, string> = {
  // suspects
  S1_source_inside_video: `<video id="v" src="v.mp4"><source src="v.webm" type="video/webm"></video>`,
  S2_source_in_picture: `<picture id="p"><source srcset="a.webp"><img src="a.png"></picture>`,
  S3_svg_use_href: `<svg id="s"><use href="#icon"/></svg><div id="icon"></div>`,
  S4_anchor_resolves_to_class_named: `<a href="#box"></a><div class="box"></div>`,
  S5_multiclass_symbol_variants: `<div class="a b"></div><div class="a"></div>`,
  S6_id_preferred_over_class: `<div id="the-id" class="the-class"></div>`,
  S7_owner_of_class_symbol: `<div id="parent"><p class="kid"></p></div>`,
  S8_sibling_same_class: `<div class="dup"></div><div class="dup"></div>`,
  S9_script_inline_no_src: `<script>alert(1)</script>`,
  S10_style_inline: `<style>body{}</style>`,
  S11_link_no_href: `<link rel="stylesheet">`,
  S12_form_no_action: `<form id="f"></form>`,
  S13_a_mailto: `<a href="mailto:a@b.c">m</a>`,
  S14_a_tel: `<a href="tel:+1">t</a>`,
  S15_a_js_void: `<a href="javascript:void(0)">v</a>`,
  S16_base_href: `<base href="/app/">`,
  S17_object_data: `<object data="f.pdf"></object>`,
  S18_embed_src: `<embed src="f.swf">`,
  S19_iframe_src: `<iframe id="ifr" src="/page"></iframe>`,
  S20_use_with_xlink: `<svg id="s"><use xlink:href="#i"></use></svg><div id="i"></div>`,
  S21_aria_labelledby: `<div id="x" aria-labelledby="lab"></div><span id="lab"></span>`,
  S22_script_async_src: `<script async src="a.js"></script>`,
  S23_link_modulepreload: `<link rel="modulepreload" href="m.js">`,
  S24_dup_id_resolution: `<a href="#dup"></a><div id="dup"></div><div id="dup"></div>`,
}
async function main() {
  for (const [name, src] of Object.entries(CASES)) {
    const root = await parse(src)
    const r: any = await new RealHtmlAnalyzer().analyze(root, src, "doc.html")
    const syms = (r.symbols ?? []).map((s: any) => `${s.name}${s.ownerName ? "@" + s.ownerName : ""}`)
    const rels = (r.relationships ?? []).map((x: any) => `${x.type}:${x.source}->${x.target}`)
    console.log(`=== ${name} err=${root.hasError}`)
    console.log(`    syms: ${syms.join(", ")}`)
    console.log(`    rels: ${rels.join(" | ")}`)
  }
}
main()
