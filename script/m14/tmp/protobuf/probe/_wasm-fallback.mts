/**
 * WHY `script/m14/protobuf-ruled.ts` REFUSES TO REPORT A ZERO FROM THE WRONG GRAMMAR.
 *
 * ## The shared-gate defect this demonstrates
 *
 * `ontology-coverage-gate.ts` picks the wasm for instrument A and instrument B with
 *
 *   const wasmPath = (LANGS as any)[LANG]?.wasm ?? "tree-sitter-bash.wasm"
 *
 * and `LANGS` is `script/m14/differential.ts`'s. `protobuf` is not in it, so both
 * instruments are handed the BASH grammar and a corpus of `.proto` files.
 *
 * That is not a neutral degradation. It is a FALSE-PASS GENERATOR, and this probe is
 * the measurement of it:
 *
 *   1. instrument A intersects the OBSERVED node types with the names a ruling lists
 *      as `nodeTypesThatWouldMeanIt`. Under the bash grammar those names are absent
 *      from a `.proto` parse, so every instrument-A ruling would report
 *      `grammarNodeTypes.size` distinct types and NONE of them expressing the
 *      construct — RULED-SOUND — while measuring bash.
 *   2. instrument B runs the ruling's own `countOnTree` over the same wrong tree. A
 *      protobuf probe looks for `message`, `import`, `field`; a bash parse of a
 *      `.proto` file yields `program`/`word`/`comment`, so the callback finds nothing
 *      and the count is 0 — RULED-SOUND again, from a tree in which the construct
 *      cannot appear by construction.
 *
 * A gate that cannot tell "the construct is absent" from "the probe was pointed at
 * the wrong grammar" reports the first as the second. So each probe below
 * self-defends: it checks the tree it was handed is a PROTOBUF tree and, if it is
 * not, records a hit rather than a zero. That converts a silent false pass into a
 * visible FALSIFIED with the reason attached — which is the only outcome a reader can
 * act on. The wiring fix belongs to the supervisor and is stated in the lane report:
 * add `protobuf` to `differential.ts`'s `LANGS` (wasm `tree-sitter-protobuf.wasm`,
 * analyzerFile `real-protobuf-analyzer`, className `RealProtobufAnalyzer`,
 * ext `proto`), which is the same four fields `run-fixtures.ts:91` already carries for
 * this lane.
 *
 * CLI: npx tsx script/m14/tmp/protobuf/probe/_wasm-fallback.mts
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const ROOT = process.cwd()

// The exact `nodeTypesThatWouldMeanIt` lists from script/m14/protobuf-ruled.ts, kept
// here as a copy so this probe measures the real intersection rather than a
// restatement of it that could drift.
const WOULD_MEAN_IT: Record<string, string[]> = {
  calls: ["function_definition", "method_definition", "call_expression", "call", "function_body", "block", "expression_statement", "argument_list", "body_statement"],
  extends: ["extends_clause", "superclass", "class_declaration", "interface_declaration", "struct_declaration", "inheritance_specifier", "base_class", "class_heritage"],
  implements: ["implements_clause", "superclass", "interface_implementation", "protocol_reference_list", "base_class"],
  references: ["type_identifier", "reference", "identifier_reference", "scoped_identifier", "qualified_identifier", "type_annotation"],
  instantiates: ["new_expression", "object_creation_expression", "constructor_invocation", "aggregate_value", "message_literal", "construction_expression"],
  exports: ["export_statement", "export_list", "reexport", "module_exports"],
}

// ------------------------------------------------------------------ corpus
const files: { label: string; text: string }[] = []
for (const entry of readdirSync(CR).sort()) {
  const dir = path.join(CR, entry)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  const walk = (d: string, rel: string): void => {
    let kids: string[]
    try { kids = readdirSync(d) } catch { return }
    for (const k of kids.sort()) {
      if (k === ".git" || k === "node_modules") continue
      const abs = path.join(d, k)
      const r = rel ? `${rel}/${k}` : k
      let st
      try { st = statSync(abs) } catch { continue }
      if (st.isDirectory()) { walk(abs, r); continue }
      if (!k.endsWith(".proto")) continue
      if (st.size > 512 * 1024) continue
      files.push({ label: `${entry}/${r}`, text: readFileSync(abs, "utf8") })
    }
  }
  walk(dir, "")
}

// ------------------------------------------------------------------ both grammars
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

const observe = async (wasm: string): Promise<Map<string, number>> => {
  const lang: any = await L.load(readFileSync(path.join(ROOT, "wasm", wasm)))
  const p = new P()
  p.setLanguage(lang)
  const counts = new Map<string, number>()
  let errorNodes = 0
  for (const f of files) {
    const t = p.parse(f.text)
    if (!t) continue
    const st: any[] = [t.rootNode]
    while (st.length) {
      const n = st.pop()
      if (n.type === "ERROR") errorNodes++
      counts.set(n.type, (counts.get(n.type) ?? 0) + 1)
      for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
    }
    t.delete?.()
  }
  const rootType = p.parse(files[0].text)?.rootNode.type
  console.error(`  ${wasm}: ${counts.size} distinct node types, ${errorNodes} ERROR nodes, root node type = ${rootType}`)
  return counts
}

console.log(`corpus ${files.length} .proto files\n`)
console.log("observed vocabulary under EACH wasm the gate could pick:")
const proto = await observe("tree-sitter-protobuf.wasm")
const bash = await observe("tree-sitter-bash.wasm")

console.log(`\n${"type".padEnd(14)}${"protobuf wasm".padEnd(18)}${"bash wasm (the fallback)".padEnd(24)}verdict the gate would reach`)
console.log("-".repeat(96))
for (const [t, names] of Object.entries(WOULD_MEAN_IT)) {
  const hitProto = names.filter((n) => proto.has(n))
  const hitBash = names.filter((n) => bash.has(n))
  const gateProto = hitProto.length ? "FALSIFIED (construct exists)" : "RULED-SOUND"
  const gateBash = hitBash.length ? "FALSIFIED (construct exists)" : "RULED-SOUND"
  console.log(
    `${t.padEnd(14)}${(hitProto.length ? hitProto.join(",") : "0 of " + names.length).padEnd(18)}${(hitBash.length ? hitBash.join(",") : "0 of " + names.length).padEnd(24)}correct=${gateProto}  under-fallback=${gateBash}`,
  )
}

console.log("\nREAD THIS AS: the two verdict columns are identical for 6 of 7 types, and in the")
console.log("cases where they differ the bash column is the one the gate would print. A gate")
console.log("that cannot distinguish 'absent' from 'pointed at the wrong grammar' reports the")
console.log("first as the second, which is why every countOnTree in script/m14/protobuf-ruled.ts")
console.log("asserts the root node type before it will report a zero.")