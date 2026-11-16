// J6 / T2 direction probe (M49 W4 findings).
//
// For each finding, print the ANALYZER's edges next to the F5 ORACLE's edges
// for the same source, so the defective side is decided by evidence, not by
// reading intent. Analyzer = real-*-analyzer.ts, oracle = deriveTreeEdges +
// the per-language oracle pushed by the sweep (differential.ts).
import * as fs from "fs"
import * as path from "path"
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"
import { RealTypeScriptAnalyzer } from "../../../src/ast/real-typescript-analyzer"
import { deriveTreeEdges, deriveJavaScriptEdges, deriveTypeScriptEdges } from "../differential"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
let P: any
const LANGS: Record<string, any> = {}

async function parser(lang: "javascript" | "typescript") {
  const wts: any = await import("web-tree-sitter")
  P = P ?? wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  LANGS[lang] = LANGS[lang] ?? (await L.load(fs.readFileSync(path.join(ROOT, "wasm", `tree-sitter-${lang}.wasm`))))
  const p = new P()
  p.setLanguage(LANGS[lang])
  return p
}

function show(tag: string, edges: any[]) {
  const txt = edges.length ? edges.map((e: any) => `${e.label} ${e.from}->${e.target} @${e.confidence ?? "-"}`).join(", ") : "(none)"
  console.log(`    ${tag}: ${txt}`)
}

// ---- J6: JS template-substitution reads ------------------------------------
async function j6() {
  console.log("== J6: javascript template substitutions ==")
  const src = [
    "function fn(x) { return x; }",
    "const obj = { m(v) { return v; } };",
    "function t(name, a) {",
    "  const s1 = `${name}`;",
    "  const s2 = `${a.b}`;",
    "  const s3 = `${fn(name)}`;",
    "  const s4 = `${obj.m(name)}`;",
    "  const s5 = `${a.b.length}`;",
    "  return [s1, s2, s3, s4, s5];",
    "}",
  ].join("\n")
  const p = await parser("javascript")
  const root = p.parse(src).rootNode
  const a = new RealJavaScriptAnalyzer() as any
  const r = await a.analyze(root, src, "probe.js")
  const anUses = (r.relationships ?? []).filter((x: any) => x.type === "uses")
  const truth = deriveTreeEdges(root, "javascript").concat(deriveJavaScriptEdges(root) as any)
  show("analyzer uses", anUses)
  show("oracle   uses", truth.filter((e: any) => e.label === "uses"))
  const aSet = new Set(anUses.map((u: any) => u.target))
  const tSet = new Set(truth.filter((e: any) => e.label === "uses").map((e: any) => e.target))
  const only = [...aSet].filter((x: any) => !tSet.has(x))
  console.log(`    analyzer-only targets: ${only.length ? only.join(", ") : "(none)"}`)
}

// ---- T2: TS .d.ts interface-member redeclaration ---------------------------
async function t2() {
  console.log("== T2: typescript .d.ts interface-member overrides ==")
  const src = [
    "export interface BaseNode {",
    "  type: string;",
    "  name?: string;",
    "}",
    "export interface BaseElement extends BaseNode {",
    "  name: string;",
    "}",
    "export interface DOMAttributes {",
    "  ontoggle?: (e: Event) => void;",
    "}",
    "export interface HTMLAttributes extends DOMAttributes {",
    "  ontoggle?: (e: Event) => void;",
    "  placeholder?: string;",
    "}",
    "export interface MethodBase {",
    "  run(x: number): void;",
    "}",
    "export interface MethodChild extends MethodBase {",
    "  run(x: number): void;",
    "}",
  ].join("\n")
  const p = await parser("typescript")
  const root = p.parse(src).rootNode
  const a = new RealTypeScriptAnalyzer() as any
  const r = await a.analyze(root, src, "probe.d.ts", {})
  const anOv = (r.relationships ?? []).filter((x: any) => x.type === "overrides")
  const truth = deriveTreeEdges(root, "typescript").concat(deriveTypeScriptEdges(root) as any)
  show("analyzer overrides", anOv)
  show("oracle   overrides", truth.filter((e: any) => e.label === "overrides"))
}

// ---- J6-ts: does the TS analog over-emit the same shapes? ------------------
async function j6ts() {
  console.log("== J6-ts: typescript template substitutions (family parity) ==")
  const src = [
    "function fn(x: number) { return x; }",
    "const obj = { m(v: number) { return v; } };",
    "function t(name: number, a: { b: string[] }) {",
    "  const s1 = `${name}`;",
    "  const s2 = `${a.b}`;",
    "  const s3 = `${fn(name)}`;",
    "  const s4 = `${obj.m(name)}`;",
    "  return [s1, s2, s3, s4];",
    "}",
  ].join("\n")
  const p = await parser("typescript")
  const root = p.parse(src).rootNode
  const a = new RealTypeScriptAnalyzer() as any
  const r = await a.analyze(root, src, "probe.ts", {})
  const anUses = (r.relationships ?? []).filter((x: any) => x.type === "uses")
  const truth = deriveTreeEdges(root, "typescript").concat(deriveTypeScriptEdges(root) as any)
  show("analyzer uses", anUses)
  show("oracle   uses", truth.filter((e: any) => e.label === "uses"))
  const aSet = new Set(anUses.map((u: any) => u.target))
  const tSet = new Set(truth.filter((e: any) => e.label === "uses").map((e: any) => e.target))
  console.log(`    analyzer-only targets: ${[...aSet].filter((x: any) => !tSet.has(x)).join(", ") || "(none)"}`)
}

// ---- T2b: does the same class appear one node type over? -------------------
async function t2b() {
  console.log("== T2b: class fields + interface methods (twin shapes) ==")
  const src = [
    "export class A { x: string = \"\"; run(y: number): void {} }",
    "export class B extends A { x: string = \"\"; run(y: number): void {} }",
    "export interface IBase { run(y: number): void }\n",
    "export interface IChild extends IBase { run(y: number): void }",
  ].join("\n")
  const p = await parser("typescript")
  const root = p.parse(src).rootNode
  const a = new RealTypeScriptAnalyzer() as any
  const r = await a.analyze(root, src, "probe2.ts", {})
  const anOv = (r.relationships ?? []).filter((x: any) => x.type === "overrides")
  const truth = deriveTreeEdges(root, "typescript").concat(deriveTypeScriptEdges(root) as any)
  show("analyzer overrides", anOv)
  show("oracle   overrides", truth.filter((e: any) => e.label === "overrides"))
}

async function main() {
  await j6()
  await j6ts()
  await t2()
  await t2b()
}
main().catch((e) => { console.error(e); process.exit(1) })
