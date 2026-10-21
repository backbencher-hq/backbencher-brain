/**
 * CSHARP PINNED-GRAMMAR NODE-TYPE INVENTORY — the POSITIVE EVIDENCE OF ABSENCE the
 * all-out-of-all bar requires for a RULED cell.
 *
 * WHY THIS FILE IS LANE-OWNED. The census instrument `.tmp-census/grammar.mts` enumerates
 * `["typescript","tsx","javascript","python","java","dart"]` and writes ONE
 * `.tmp-census/grammar-nodes.json` — running it for csharp would OVERWRITE the fleet's
 * grammar artifact with a one-language file, which is a shared-file collision. This instrument
 * is the csharp lane's own and writes only into `validation/m14/measurements/`.
 *
 * WHAT IT READS. `ASTEngine.getParser("csharp")` — the SAME pinned grammar the production
 * analyzer uses (`wasm/tree-sitter-c_sharp.wasm`) — and then the parser's own `Language` object.
 * The node-type list is therefore the pinned grammar's list, not a guess from a sampled tree,
 * and not a name list typed by hand.
 *
 * THE RULE THIS FILE SERVES (LANGUAGE-MATRIX-EXTENDED §1): a RULED cell is a decision with a
 * POSITIVE grammar-inventory basis — "the pinned grammar has no node type that could produce
 * the construct, so no corpus count can exist". A cell that cannot be ruled on the grammar
 * inventory stays in the denominator.
 *
 * THE FOUR EXTENDED VALUES AND THE CANDIDATE NODE FAMILIES THEY WOULD NEED:
 *   renders   — a component-render site (jsx_element / jsx_self_closing_element /
 *               template_literal-as-jsx / razor_element / html_element)
 *   decorates — a decorator-application site (decorator / decorated_definition /
 *               attribute / attribute_list / annotation / marker_annotation)
 *   mixes_in  — a mixin application (mixins / mixin_application / mixin_declaration /
 *               with_clause)
 *   part_of   — a part-of declaration (part_directive / part_of_directive / part_file /
 *               partial_declaration / partial_modifier)
 *
 * Usage: bun run script/m14/csharp-grammar-inventory.ts [--json]
 */
import { writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"

import { getParser } from "../../src/ast/engine"
import { createHash } from "node:crypto"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
const OUT_DIR = path.join(ROOT, "validation", "m14", "measurements")
const WASM = path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")

/** The candidate node families each extended value would require the grammar to produce. */
const CANDIDATES: Record<string, string[]> = {
  renders: [
    "jsx_element", "jsx_self_closing_element", "jsx_opening_element", "jsx_fragment",
    "template_element", "razor_element", "html_element", "html_start_tag", "render_element",
    "component_element", "view_element",
  ],
  decorates: [
    "decorator", "decorated_definition", "attribute", "attribute_list", "attribute_argument",
    "annotation", "marker_annotation", "annotation_argument",
  ],
  mixes_in: [
    "mixins", "mixin_application", "mixin_application_class", "mixin_declaration", "with_clause",
    "mixin_body",
  ],
  part_of: [
    "part_directive", "part_of_directive", "part_file", "partial_declaration",
    "partial_modifier", "partial_type_declaration", "partial_method_declaration",
    "partial_property_declaration",
  ],
}

const parser = await getParser("csharp" as any)
const language = (parser as any).language
if (!language) {
  console.error("NO LANGUAGE for csharp — the pinned grammar did not load")
  process.exit(2)
}

const named: string[] = []
const anon: string[] = []
const total = language.nodeTypeCount
for (let id = 1; id < total; id++) {
  const t = language.nodeTypeForId(id)
  if (t == null) continue
  if (language.nodeTypeIsNamed(id)) named.push(t)
  else anon.push(t)
}
named.sort()

const wasmBytes = await Bun.file(WASM).arrayBuffer()
const wasmSha = createHash("sha256").update(Buffer.from(wasmBytes)).digest("hex")

const namedSet = new Set(named)
const presence: Record<string, { present: string[]; absent: string[] }> = {}
for (const [value, cands] of Object.entries(CANDIDATES)) {
  presence[value] = {
    present: cands.filter((c) => namedSet.has(c)),
    absent: cands.filter((c) => !namedSet.has(c)),
  }
}

const report = {
  lane: "csharp",
  grammar: "wasm/tree-sitter-c_sharp.wasm",
  grammarSha256: wasmSha,
  nodeTypeCount: total,
  namedCount: named.length,
  named,
  anonymousSample: anon.slice(0, 40),
  candidatePresence: presence,
}

mkdirSync(OUT_DIR, { recursive: true })
const outPath = path.join(OUT_DIR, "csharp-grammar-inventory.json")
writeFileSync(outPath, JSON.stringify(report, null, 1))

console.log(`CSHARP PINNED-GRAMMAR INVENTORY`)
console.log(`  wasm                 ${WASM}`)
console.log(`  sha256               ${wasmSha}`)
console.log(`  node type ids        ${total}`)
console.log(`  NAMED node types     ${named.length}`)
console.log(`  written              ${path.relative(ROOT, outPath)}`)
console.log("")
console.log("  CANDIDATE NODE PRESENCE (the RULED-cell basis)")
for (const [value, p] of Object.entries(presence)) {
  console.log(`  ${value}:`)
  for (const c of CANDIDATES[value]) {
    console.log(`    ${namedSet.has(c) ? "PRESENT" : "ABSENT "}  ${c}`)
  }
}
console.log("")
console.log("  EVERY named node type containing a candidate stem (the positive inventory):")
const stems = ["jsx", "decorat", "attribut", "annotation", "mixin", "part", "partial", "razor", "html", "template"]
for (const s of stems) {
  const hits = named.filter((n) => n.includes(s))
  console.log(`    ${s.padEnd(10)} -> ${hits.length ? hits.join(", ") : "(none)"}`)
}
