// Vue master review (2026-09-30) — shared harness.
//
// Goes through the PRODUCTION path (ASTEngine.parseFile), not a hand-built
// context: the SFC seam (script-block extraction, three-way lang dispatch,
// byte-index base) is part of what is under review, so re-implementing it here
// would make every probe blind to the very defect class under test.
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const WASM = path.join(ROOT, "wasm")

let P: any, L: any
let ready: Promise<void> | null = null

export async function init() {
  if (ready) return ready
  ready = (async () => {
    const wts: any = await import("web-tree-sitter")
    P = wts.Parser ?? wts.default ?? wts
    L = wts.Language ?? wts.default?.Language
    await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  })()
  return ready
}

export async function loadLang(name: string) {
  await init()
  const file = {
    vue: "tree-sitter-vue.wasm",
    js: "tree-sitter-javascript.wasm",
    ts: "tree-sitter-typescript.wasm",
    tsx: "tree-sitter-tsx.wasm",
  }[name]!
  return L.load(fs.readFileSync(path.join(WASM, file)))
}

export async function parseVue(src: string) {
  const vue = await loadLang("vue")
  const p = new P()
  p.setLanguage(vue)
  return p.parse(src).rootNode
}

/** Run the real analyzer over a .vue source, production path. */
export async function vue(src: string, file = "/tmp/probe/Widget.vue") {
  await init()
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  return (await ASTEngine.parseFile(file, src)) as any
}

/** Run the real analyzer over a .ts/.js source, production path. */
export async function plain(src: string, file = "/tmp/probe/mod.ts") {
  await init()
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  return (await ASTEngine.parseFile(file, src)) as any
}

export const rels = (r: any, type?: string) =>
  (r.relationships ?? []).filter((x: any) => !type || String(x.type ?? x.relationshipType).toLowerCase() === type)

export const syms = (r: any, name?: string) =>
  (r.symbols ?? []).filter((s: any) => !name || s.name === name)

export const names = (r: any) => (r.symbols ?? []).map((s: any) => `${s.name}:${s.kind}`)

export function assertEq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) throw new Error(`${msg}\n     got: ${a}\n  wanted: ${b}`)
}

export function assertTrue(cond: any, msg: string) {
  if (!cond) throw new Error(msg)
}

let pass = 0
let fail = 0
const failures: string[] = []

export async function probe(name: string, body: () => Promise<void> | void) {
  try {
    await body()
    pass++
    console.log(`  ok   ${name}`)
  } catch (e: any) {
    fail++
    failures.push(name)
    console.log(`  FAIL ${name} :: ${e?.message}`)
  }
}

export function report() {
  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) { console.log("failed: " + failures.join(", ")); process.exitCode = 1 }
  return { pass, fail }
}
