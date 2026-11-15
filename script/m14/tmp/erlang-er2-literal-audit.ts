// ER2 restoration / F6 enrolment: EVERY node-type literal in the erlang
// analyzer, checked against the pinned grammar's own type table.
//
// Why this exists as its own probe: the F1 auditor's extractor recognises
// `x.type === "lit"` (a MEMBER expression) and the F6 coverage audit recognises
// the same plus `findChildByType`/`hasChildType`. The restored analyzer branches
// on a LOCAL variable (`const type = node.type; ... type === "lit"`), so both
// gates are blind to this class — measured 2026-09-25: the branch list carried
// `include_attribute` / `include_lib_attribute`, and the pinned grammar emits
// `pp_include` / `pp_include_lib` (there are no `*_attribute` include types).
// Two dead branches, invisible to both registers, found by this probe.
//
// Run: bun script/m14/tmp/erlang-er2-literal-audit.ts [analyzer.ts] [wasm]
import { readFileSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const ts = (WTS as any).default ?? WTS
const P = ts.Parser ?? ts
const L = ts.Language ?? ts.default?.Language

const analyzerPath = process.argv[2] ?? path.join(ROOT, "src/ast/real-erlang-analyzer.ts")
const wasmPath = process.argv[3] ?? path.join(ROOT, "wasm/tree-sitter-erlang.wasm")

async function main() {
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar: any = await L.load(readFileSync(wasmPath))
  const types = new Set<string>()
  for (let i = 0; i < grammar.nodeTypeCount; i++) {
    const name = grammar.nodeTypeForId(i)
    if (name != null) types.add(name)
  }

  const src = readFileSync(analyzerPath, "utf8")
  // Comment-stripped, so an audit note that quotes a removed literal is not
  // itself counted as a live comparison (the F6 W9 lesson).
  const masked = src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, (m) => m.replace(/[^\n]/g, " "))
  // Every position a node type can hide in, including the LOCAL-variable form
  // both existing gates miss.
  const patterns: RegExp[] = [
    /\btype\s*===\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
    /\btype\s*!==\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
    /\.type\s*===\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
    /\.type\s*!==\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
    /getChildByType\([^,]+,\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
    /childByType\([^,]+,\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
    /findChildByType\([^,]+,\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
    /collectChildrenByType\([^,]+,\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
    /\?\?\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
  ]
  const found = new Map<string, number>()
  for (const re of patterns) {
    for (const m of masked.matchAll(re)) {
      if (!found.has(m[1])) found.set(m[1], masked.slice(0, m.index ?? 0).split("\n").length)
    }
  }
  // Type names inside the type-syntax / spelling sets are node types too.
  for (const setBlock of masked.matchAll(/new Set\(\[([\s\S]*?)\]\)/g)) {
    for (const s of setBlock[1].matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)) {
      if (!found.has(s[1])) found.set(s[1], masked.slice(0, (s.index ?? 0) + (setBlock.index ?? 0)).split("\n").length)
    }
  }

  const nonTypes = new Set([
    // relationship kinds, metadata values and language keywords that are
    // deliberately NOT node types
    "calls", "uses", "references", "implements", "instantiates", "contains", "extends",
    "record member read", "record field update", "local function call", "remote function call",
    "fun value reference", "macro use", "type reference", "OTP behaviour callback implementation",
    "nifs", "on_load", "define", "MODULE",
    // OTP behaviour names and BIF names compared against ATOM TEXT, never node
    // types (`OTP_BEHAVIOURS.has(atom.text)`, `SPAWN_BIFS.has(callee.text)`).
    "gen_server", "gen_statem", "gen_event", "supervisor", "application",
    "spawn", "spawn_link", "spawn_monitor",
  ])

  const unknown: string[] = []
  const known: string[] = []
  for (const [lit, line] of [...found].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (types.has(lit)) known.push(lit)
    else if (nonTypes.has(lit)) continue
    else unknown.push(`${lit}:${line}`)
  }
  console.log(`grammar node types: ${types.size}`)
  console.log(`literals checked:   ${known.length + unknown.length} (${known.length} live, ${unknown.length} unknown)`)
  if (unknown.length) console.log(`DEAD/UNKNOWN: ${unknown.join(", ")}`)
  else console.log("every checked literal is a type the pinned grammar can emit")

  // ---- second half: is a grammar type ever a PARENT node? ----
  // A literal can name a real grammar type and still be dead code: several
  // erlang types are UNNAMED TOKENS (the `define` keyword, the `include`
  // keyword), which the analyzer can only ever meet as CHILDREN. A branch that
  // steps on a token that never occurs as a parent can never fire, and the
  // grammar-table check above cannot see it. So: measure the parent-node types
  // that actually occur, and report any literal that is a grammar type but
  // never appears as a parent in the scanned sources.
  const dirs = process.argv.slice(4)
  const scanDirs = dirs.length ? dirs : [path.join(ROOT, "validation/m14/fixtures/erlang")]
  const { readdirSync, statSync } = await import("node:fs")
  const parser = new P()
  parser.setLanguage(grammar)
  const parents = new Set<string>()
  let files = 0
  const walkDir = (d: string): string[] => {
    const out: string[] = []
    for (const e of readdirSync(d)) {
      if (e.startsWith(".") || e === "node_modules") continue
      const p = path.join(d, e)
      let st: any
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) out.push(...walkDir(p))
      else if (e.endsWith(".erl") || e.endsWith(".hrl")) out.push(p)
    }
    return out
  }
  for (const dir of scanDirs) {
    let list: string[] = []
    try { list = walkDir(dir) } catch { continue }
    for (const f of list) {
      files++
      const tree = parser.parse(readFileSync(f, "utf8"))
      const stack = [tree.rootNode]
      while (stack.length) {
        const n: any = stack.pop()!
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) { parents.add(c.type); stack.push(c) } }
      }
      tree.delete?.()
    }
  }
  // `source_file` is the ROOT: it can only ever be reached by walking parents,
  // never as a child, so the child-occurrence measure cannot see it. Documented
  // exception, not a silence: the checker is about branches that can never fire,
  // and a root check can.
  const parentReachableRoot = new Set(["source_file"])
  const neverParent = known.filter((l) => !parents.has(l) && !parentReachableRoot.has(l))
  console.log(`\nsources scanned: ${files} file(s) over ${scanDirs.length} dir(s); distinct parent types: ${parents.size}`)
  if (neverParent.length) {
    console.log(`GRAMMAR TYPE, NEVER A PARENT: ${neverParent.join(", ")}`)
    console.log("  (a token type — a branch testing it as a node type can never fire)")
  } else {
    console.log("every live literal occurs as a PARENT node in the scanned sources")
  }
  process.exitCode = unknown.length || neverParent.length ? 1 : 0
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
