/**
 * The GRAMMAR HALF of the three extended-type rulings for markdown
 * (`decorates`, `renders`, `mixes_in`), measured from the two pinned grammars'
 * DECLARED inventories — with a planted control on every vocabulary.
 *
 * WHY THIS IS A SEPARATE INSTRUMENT FROM THE SPEC'S BLOCK-GRAMMAR INVENTORY.
 * `script/m14/grammar-node-inventory.ts` writes the block grammar's inventory
 * (`validation/m14/measurements/markdown-grammar-nodes.json`, 64 named slots / 207
 * ids). A ruling's denominator is the UNION of both pinned grammars, and the inline
 * companion's declared types are reachable only through the same accessor the
 * inventory uses (`Language.nodeTypeForId` / `nodeTypeIsNamed`). So this script
 * loads BOTH wasms, enumerates every named type each declares, unions them, and
 * then tests each ruling's vocabulary against that union.
 *
 * THE CONTROL. A vocabulary miss on a 70-name union could be a fact about the
 * vocabulary rather than about the grammar (rule-book §7). So every row plants one
 * node type the union is KNOWN to contain into its own vocabulary and re-runs the
 * SAME membership test: the control FIRES when the planted name is found and the
 * unplanted vocabulary found nothing. A row whose control cannot see its own
 * planted member is reported as NOT CONTROL-VERIFIED rather than counted as a zero.
 *
 * OUTPUT: validation/m14/fixtures/markdown/measurements/extended-grammar-half.json
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, "../../../..")
const OUT = path.join(HERE, "measurements/extended-grammar-half.json")
const BLOCK_INVENTORY = path.join(REPO, "validation/m14/measurements/markdown-grammar-nodes.json")

// ── both grammars' DECLARED named types (the same accessor the fleet inventory uses)
async function declaredNamedTypes(wasmRel: string): Promise<{ totalIds: number; namedSlots: number; distinct: string[] }> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const Lang = wts.Language ?? wts.default?.Language
  if (!P.initDone) await P.init({ locateFile: () => path.join(REPO, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await Lang.load(fs.readFileSync(path.join(REPO, wasmRel)))
  const distinct: string[] = []
  let namedSlots = 0, totalIds = 0
  for (let id = 0; id < 4000; id++) {
    const n = lang.nodeTypeForId(id)
    if (n === undefined || n === null) break
    totalIds++
    if (lang.nodeTypeIsNamed(id)) { namedSlots++; if (!distinct.includes(n)) distinct.push(n) }
  }
  return { totalIds, namedSlots, distinct: distinct.sort() }
}

const block = await declaredNamedTypes("wasm/tree-sitter-markdown.wasm")
const inline = await declaredNamedTypes("wasm/tree-sitter-markdown_inline.wasm")
const union = [...new Set([...block.distinct, ...inline.distinct])].sort()
const shared = block.distinct.filter(n => inline.distinct.includes(n))

/** One ruling's grammar half: the vocabulary that WOULD express the type. */
type Vocabulary = { type: string; wouldMeanIt: string[]; rationale: string }
const VOCABULARIES: Vocabulary[] = [
  {
    type: "decorates",
    rationale: "a decorator/annotation/attribute production: a name applied TO a declaration. Markdown declares no functions, classes or methods, so there is no decorated declaration to name.",
    wouldMeanIt: [
      "decorator", "decorator_expression", "decorator_list", "decorated_definition",
      "annotation", "annotation_clause", "marker_annotation", "attribute_item", "attribute",
      "modifier", "meta", "pragma", "directive_annotation",
    ],
  },
  {
    type: "renders",
    rationale: "a component/render production: a rendering symbol and the component it renders. Markdown is a document grammar; JSX/Vue/Svelte component productions belong to the lanes that own those grammars.",
    wouldMeanIt: [
      "jsx_element", "jsx_self_closing_element", "component_element", "component",
      "render", "render_method", "render_expression", "returns", "template_element",
      "vue_component", "svelte_component", "element", "custom_element",
    ],
  },
  {
    type: "mixes_in",
    rationale: "a mixin/with-clause/composition production: a class composing an implementation into its supertype chain. Markdown has no classes and no supertype chain.",
    wouldMeanIt: [
      "mixin", "mixin_application", "mixin_application_class", "with_clause",
      "trait_declaration", "trait_definition", "trait_usage", "include_mixin",
      "class_declaration", "class", "class_specifier", "composition",
    ],
  },
]

const rows = VOCABULARIES.map(v => {
  const present = v.wouldMeanIt.filter(n => union.includes(n))
  // THE CONTROL: plant a member the union is KNOWN to contain and re-run the same test.
  const plantedName = union.includes("document") ? "document" : union.includes("inline") ? "inline" : union[0]
  const plantedPresent = [...v.wouldMeanIt, plantedName].filter(n => union.includes(n))
  const controlFires = plantedPresent.includes(plantedName) && present.length === 0
  return {
    type: v.type,
    vocabularySize: v.wouldMeanIt.length,
    wouldMeanIt: v.wouldMeanIt,
    presentInUnion: present,
    control: { planted: plantedName, presentAfterPlanting: plantedPresent, fires: controlFires },
    rationale: v.rationale,
  }
})

const artifact = {
  whatThisIs: "The grammar half of markdown's three extended-type rulings. Both pinned grammars' DECLARED named node types are enumerated with the fleet inventory's own accessor, unioned, and each ruling's vocabulary is tested against the union with a planted control.",
  measuredOn: new Date().toISOString(),
  grammars: {
    block: { wasm: "wasm/tree-sitter-markdown.wasm", totalIds: block.totalIds, namedSlots: block.namedSlots, distinctNamed: block.distinct.length },
    inline: { wasm: "wasm/tree-sitter-markdown_inline.wasm", totalIds: inline.totalIds, namedSlots: inline.namedSlots, distinctNamed: inline.distinct.length },
    unionDistinct: union.length,
    sharedDistinct: shared.length,
    shared,
    blockOnly: block.distinct.filter(n => !inline.distinct.includes(n)),
    inlineOnly: inline.distinct.filter(n => !block.distinct.includes(n)),
  },
  rows,
  allControlsFire: rows.every(r => r.control.fires),
}
fs.writeFileSync(OUT, JSON.stringify(artifact, null, 1) + "\n")
console.log(`block: ${block.namedSlots} named slots / ${block.distinct.length} distinct · inline: ${inline.namedSlots} named slots / ${inline.distinct.length} distinct · union: ${union.length}`)
for (const r of rows) console.log(`${r.type.padEnd(10)} vocabulary ${String(r.vocabularySize).padStart(2)} · present ${JSON.stringify(r.presentInUnion)} · control ${r.control.fires ? "FIRES" : "DID NOT FIRE"}`)
console.log(`all controls fire: ${artifact.allControlsFire}`)
console.log(`wrote ${OUT}`)
if (!artifact.allControlsFire) process.exit(5)
