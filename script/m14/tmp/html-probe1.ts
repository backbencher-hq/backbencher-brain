// html hostile probe #1: identity, ownership, deferral and resource surfaces.
import * as fs from "fs"
import * as path from "path"
import { RealHtmlAnalyzer } from "../../../src/ast/real-html-analyzer"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-html.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
const CASES: Record<string, string> = {
  P1_duplicate_id: `<div id="a"></div><div id="a"></div>`,
  P2_id_and_class: `<div id="wrap" class="box"></div><p class="box"></p>`,
  P3_multiclass_value_symbol: `<div class="a b c"></div>`,
  P4_classId_alias: `<div className="legacy"></div>`,
  P5_nested_anon_chain: `<div id="outer"><div><span id="inner"></span></div></div>`,
  P6_anchor_forward: `<a href="#later">go</a><div id="later"></div>`,
  P7_anchor_backward: `<div id="top"></div><a href="#top">up</a>`,
  P8_anchor_missing: `<a href="#nope">x</a>`,
  P9_label_for_resolves: `<label for="inp">L</label><input id="inp">`,
  P10_label_missing: `<label for="gone">L</label>`,
  P11_script_module: `<script type="module" src="m.js"></script>`,
  P12_style_link_variants: `<link rel="preload" href="f.woff2"><link rel="icon" href="i.png"><link rel="stylesheet" href="s.css">`,
  P13_srcset: `<img src="a.png" srcset="a-480.png 480w, a-1080.png 1080w" sizes="100vw">`,
  P14_form_action: `<form id="f" action="/submit"></form>`,
  P15_media: `<video id="v" src="v.mp4"></video><source src="v.webm"><audio src="a.mp3"></audio>`,
  P16_self_closing_custom: `<my-widget id="w" />`,
  P17_template: `<template><div id="tpl"></div></template>`,
  P18_svg_use: `<svg id="s"><use href="#icon"/></svg><div id="icon"></div>`,
  P19_dup_attr_names: `<div id="x" data-x="1" DATA-X="2"></div>`,
  P20_empty_attr: `<input id="i" value="" required>`,
  P21_unquoted_attr: `<div id=u class=box></div>`,
  P22_malformed: `<div id="a"><span></div>`,
  P23_anchor_self_loop: `<a id="a" href="#a">self</a>`,
  P24_script_body_text: `<script>document.querySelector("#a")</script>`,
}
async function main() {
  for (const [name, src] of Object.entries(CASES)) {
    const root = await parse(src)
    const r: any = await new RealHtmlAnalyzer().analyze(root, src, name + ".html")
    const syms = (r.symbols ?? []).map((s: any) => `${s.name}${s.ownerName ? "@" + s.ownerName : ""}`)
    const rels = (r.relationships ?? []).map((x: any) => `${x.type}:${x.source}->${x.target}`)
    console.log(`=== ${name} err=${root.hasError} symbols=[${syms.join(", ")}]`)
    console.log(`    rels: ${rels.join(" | ")}`)
  }
}
main()
