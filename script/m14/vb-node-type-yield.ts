/**
 * The node-type YIELD audit: does every declaration the grammar produces become
 * something the analyzer publishes?
 *
 * The census (`vb-node-type-census.ts`) asks whether every node type is
 * CLASSIFIED. This asks the harder question, and it is the one that keeps finding
 * defects: a node type can be classified, have a dedicated visitor, and still
 * publish nothing at all.
 *
 * Three of this lane's largest defects were exactly that, and the census could
 * not see any of them:
 *
 *   - CONSTRUCTORS. `constructor_declaration` was classified a declaration and had
 *     a visitor, and the index contained zero constructors across 435 files -- the
 *     empty-name guard returned before the naming contract was reached.
 *   - OPERATORS. Classified, visited by a dedicated `visitOperator`, and produced
 *     nothing, twice over: the guard above, and a `isKeyword` test that returned
 *     true for the operator's own symbol.
 *   - INTERFACE MEMBERS. Three node types in neither the declaration nor the
 *     silent set, so nothing dispatched them and every interface was an empty
 *     shell.
 *
 * The audit walks the corpus twice over the same trees -- once counting
 * declaration NODES by type, once running the analyzer and counting the symbols it
 * publishes by their own recorded `grammarNode` -- and reports any type that
 * appears as a node and yields no symbol.
 *
 * The MAPPING is stated explicitly rather than inferred, because an inferred
 * mapping is a gate that agrees with whatever the analyzer happens to do. Two
 * entries are not identity, and both are deliberate:
 *
 *   field_declaration -> variable_declarator
 *     A field's declaration unit is the DECLARATOR. `Dim X, Y, width As Integer`
 *     is one `field_declaration` with three `variable_declarator` children, so
 *     three symbols are published and each records the unit that declared it --
 *     which is more precise than recording the enclosing field, and would look
 *     like a dead visitor to a naive identity mapping.
 *
 *   imports_statement -> (no symbol; it yields IMPORTS)
 *     An import is published on the result's `imports` array, not as a symbol.
 *     Counting symbols for it is guaranteed to be zero and always was.
 *
 * Usage: `bun run script/m14/vb-node-type-yield.ts`
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join } from "node:path"
import { Parser, Language } from "web-tree-sitter"

const GRAMMAR = process.env.BB_LANG_GRAMMAR ?? "grammars/tree-sitter-vbnet/grammar.js"
const ANALYZER = process.env.BB_LANG_ANALYZER ?? "src/ast/real-vb-analyzer.ts"
const WASM = process.env.BB_VB_WASM ?? "wasm/tree-sitter-vbnet.wasm"
const CORE = process.env.BB_TS_CORE ?? "wasm/tree-sitter.wasm"
const ROOTS = (process.env.BB_VB_ROOTS ?? "$HOME/fixtures/vb-corpus").split(",").filter(Boolean)
/** Cap so a full-corpus run stays a few minutes; the sample is deterministic. */
const LIMIT = parseInt(process.env.BB_VB_YIELD_LIMIT ?? "600", 10)

/** The declaration node types the analyzer is expected to publish something for. */
const MUST_YIELD: Record<string, { satisfiedBy: string[]; why: string }> = {
  namespace_declaration: { satisfiedBy: ["namespace_declaration"], why: "a namespace symbol" },
  class_declaration: { satisfiedBy: ["class_declaration"], why: "a class symbol" },
  structure_declaration: { satisfiedBy: ["structure_declaration"], why: "a structure symbol" },
  interface_declaration: { satisfiedBy: ["interface_declaration"], why: "an interface symbol" },
  module_declaration: { satisfiedBy: ["module_declaration"], why: "a module symbol" },
  enum_declaration: { satisfiedBy: ["enum_declaration"], why: "an enum symbol" },
  delegate_declaration: { satisfiedBy: ["delegate_declaration"], why: "a delegate symbol" },
  method_declaration: { satisfiedBy: ["method_declaration"], why: "a method symbol" },
  interface_method_declaration: { satisfiedBy: ["interface_method_declaration"], why: "an interface METHOD symbol" },
  interface_property_declaration: { satisfiedBy: ["interface_property_declaration"], why: "an interface PROPERTY symbol" },
  interface_event_declaration: { satisfiedBy: ["interface_event_declaration"], why: "an interface EVENT symbol" },
  constructor_declaration: { satisfiedBy: ["constructor_declaration"], why: "a constructor symbol, named by the contract" },
  operator_declaration: { satisfiedBy: ["operator_declaration"], why: "an operator symbol, named by the contract" },
  property_declaration: { satisfiedBy: ["property_declaration"], why: "a property symbol" },
  event_declaration: { satisfiedBy: ["event_declaration"], why: "an event symbol" },
  declare_statement: { satisfiedBy: ["declare_statement"], why: "a P/Invoke method symbol" },
  field_declaration: {
    satisfiedBy: ["variable_declarator", "field_declaration"],
    why: "one symbol per DECLARATOR — `Dim X, Y, width` is three members, not one",
  },
  enum_member_declaration: { satisfiedBy: ["enum_member_declaration"], why: "an enum member symbol" },
  imports_statement: {
    satisfiedBy: [],
    why: "publishes IMPORTS on the result's `imports` array, never a symbol — counted separately below",
  },
}

async function main() {
  const analyzerSrc = readFileSync(ANALYZER, "utf8")
  for (const [node, spec] of Object.entries(MUST_YIELD)) {
    for (const sat of spec.satisfiedBy) {
      if (!analyzerSrc.includes(`"${node}"`)) {
        console.error(`the analyzer source does not even mention "${node}" — is the mapping stale?`)
        process.exit(3)
      }
    }
  }

  await Parser.init({ locateFile: () => CORE, wasmBinary: readFileSync(CORE) })
  const lang = await Language.load(WASM)
  const parser = new Parser()
  parser.setLanguage(lang as any)
  const mod: any = await import(`../../${ANALYZER.replace(/\.ts$/, "")}`)
  const Cls = mod.RealVbAnalyzer ?? Object.values(mod).find((v: any) => typeof v === "function")

  const files: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else if (p.endsWith(".vb")) files.push(p)
    }
  }
  for (const r of ROOTS) if (existsSync(r)) walk(r)
  files.sort()
  if (files.length === 0) {
    console.error("0 files read: nothing was measured, so nothing can be concluded.")
    process.exit(3)
  }

  const declTypes = Object.keys(MUST_YIELD)

  // A SAMPLE THAT MISSES A TYPE IS NOT EVIDENCE FOR IT. The first run of this
  // audit drew the first 600 files and reported `interface_property_declaration`
  // and `interface_event_declaration` as "not exercised by this sample" -- which
  // is the audit admitting it knows nothing about two of the nineteen kinds it
  // exists to check, including the two that were the whole point of the
  // interface-member fix.
  //
  // So the sample is COVERING, not arbitrary: a cheap parse-only pass over every
  // file finds which files contain which declaration types, and a greedy set
  // cover picks a small set of files that together exercise all nineteen. The
  // analyzer -- the expensive half -- then runs only on that set. Coverage becomes
  // total and the cost stays bounded, which is the only way an audit of rare
  // constructs can be trusted.
  const typeInFile = new Map<string, string[]>()
  for (const f of files) {
    const tree = parser.parse(readFileSync(f, "utf8"))
    const stack: any[] = [tree.rootNode]
    const seen = new Set<any>()
    const found: string[] = []
    while (stack.length) {
      const n = stack.pop()
      if (!n || seen.has(n)) continue
      seen.add(n)
      if (n.isNamed && declTypes.includes(n.type)) found.push(n.type)
      for (let i = n.childCount - 1; i >= 0; i--) {
        const c = n.child(i)
        if (c) stack.push(c)
      }
    }
    if (found.length) typeInFile.set(f, found)
    tree.delete?.()
  }

  const uncovered = new Set(declTypes.filter((t) => !files.some((f) => (typeInFile.get(f) ?? []).includes(t))))
  const chosen: string[] = []
  const covered = new Set<string>()
  // rarest type first: it is the one a naive draw would miss
  const byRarity = [...declTypes].sort(
    (a, b) => files.filter((f) => (typeInFile.get(f) ?? []).includes(a)).length - files.filter((f) => (typeInFile.get(f) ?? []).includes(b)).length,
  )
  for (let pass = 0; pass < LIMIT; pass++) {
    let best: string | null = null
    let bestGain = 0
    for (const f of files) {
      if (chosen.includes(f)) continue
      const gain = (typeInFile.get(f) ?? []).filter((t) => !covered.has(t)).length
      if (gain > bestGain) { bestGain = gain; best = f }
    }
    if (!best || bestGain === 0) break
    chosen.push(best)
    for (const t of typeInFile.get(best) ?? []) covered.add(t)
  }

  console.log(`node-type YIELD audit`)
  console.log(`  corpus files                  ${files.length}`)
  console.log(`  files carrying a declaration  ${typeInFile.size}`)
  console.log(`  files analysed                ${chosen.length}  (greedy set cover, not a draw)`)
  console.log(`  types covered                 ${covered.size} of ${declTypes.length}`)

  const nodes = new Map<string, number>()
  const syms = new Map<string, number>()
  let importCount = 0

  for (const f of chosen) {
    const src = readFileSync(f, "utf8")
    const tree = parser.parse(src)
    const stack: any[] = [tree.rootNode]
    const seen = new Set<any>()
    while (stack.length) {
      const n = stack.pop()
      if (!n || seen.has(n)) continue
      seen.add(n)
      if (n.isNamed && declTypes.includes(n.type)) nodes.set(n.type, (nodes.get(n.type) ?? 0) + 1)
      for (let i = n.childCount - 1; i >= 0; i--) {
        const c = n.child(i)
        if (c) stack.push(c)
      }
    }
    const a: any = new Cls()
    const r: any = await a.analyze(tree.rootNode as any, src, f)
    for (const s of r?.symbols ?? []) {
      const g = s?.metadata?.grammarNode
      if (typeof g === "string") syms.set(g, (syms.get(g) ?? 0) + 1)
    }
    importCount += (r?.imports?.length ?? 0)
    tree.delete?.()
  }

  const dead: string[] = []
  const absent: string[] = []
  console.log(`  declaration node types audited     ${declTypes.length}`)
  console.log(`  import entries published           ${importCount}`)
  console.log("")
  console.log(`  ${"node type".padEnd(32)} ${"nodes".padStart(8)} ${"symbols".padStart(9)}   verdict`)
  for (const t of declTypes) {
    const n = nodes.get(t) ?? 0
    const s = spec(t)
    const verdict = n === 0 ? "not exercised by this sample" : s > 0 ? "ok" : "DEAD VISITOR"
    console.log(
      `  ${t.padEnd(32)} ${String(n).padStart(8)} ${String(s).padStart(9)}   ${verdict}`,
    )
    if (n === 0) absent.push(t)
    else if (s === 0) dead.push(`${t}  (${n} nodes, 0 symbols — satisfied by: ${MUST_YIELD[t].satisfiedBy.join("/") || "imports"})`)
  }
  function spec(t: string): number {
    const by = MUST_YIELD[t].satisfiedBy
    if (by.length === 0) return importCount
    return by.reduce((a, b) => a + (syms.get(b) ?? 0), 0)
  }

  console.log("")
  if (dead.length) {
    console.log(`DEAD VISITORS (${dead.length}) — a declaration the grammar produces and the analyzer publishes nothing for:`)
    for (const d of dead) console.log("  " + d)
    console.error(`\n${dead.length} declaration kind(s) produce nodes and no symbols.`)
    process.exit(2)
  }
  console.log(`ok — every declaration node type in the sample yields something published`)
  if (absent.length) {
    console.error(`     NOT EXERCISED anywhere in the corpus: ${absent.join(", ")}`)
    process.exit(2)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
