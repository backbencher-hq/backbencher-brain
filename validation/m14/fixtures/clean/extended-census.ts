/**
 * CLEAN — the four EXTENDED vocabulary values, measured before they are ruled.
 *
 * `decorates`, `part_of`, `renders` and `mixes_in` publish zero rows in this lane. A zero has
 * three possible causes and this instrument separates them, because only one of the three is a
 * ruling:
 *
 *   (a) the CONSTRUCT does not exist in the language       → ruleable (grammar absence)
 *   (b) the construct exists and the GRAMMAR cannot read it → grammar work, not a ruling
 *   (c) the construct exists, the grammar reads it, and the ANALYZER misses it → a bug
 *
 * The instrument is three parts, in this order:
 *
 *   PART A — the served build's own vocabulary. The grammar artifact's declared node-type names
 *            are scanned for each construct's stems, with CONTROLS (names the language certainly
 *            has: class_declaration, instance_declaration, import_declaration, macro_definition,
 *            with_block). A zero from a vocabulary scan that cannot see `class_declaration` is a
 *            zero about the scanner.
 *   PART B — SYNTHETIC shapes parsed with the served wasm, dumped, and run through the SAME
 *            detector functions the arbiter runs (`script/m14/clean-ruled.ts`). This is what
 *            separates (a) from (b): if Clean HAD the syntax and the grammar misparsed it, the
 *            probe would show an ERROR or a shape the detector catches.
 *   PART C — the whole admitted corpus (312 files), counting the nearest construct for each type
 *            and calling the same detectors. Every count is printed with its denominator, and the
 *            controls are counts of node types the corpus definitely produces.
 *
 * DETERMINISTIC over the sorted admitted population. Reads only; writes the JSON artifact when
 * `--json <path>` is passed.
 *
 *   npx tsx validation/m14/fixtures/clean/extended-census.ts [--json <path>]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join, relative } from "node:path"
import { getParser } from "../../../../src/ast/engine.ts"
import {
  countCleanDecoratesConstruct,
  countCleanMixesInConstruct,
  countCleanPartOfConstruct,
  countCleanRendersConstruct,
} from "../../../../script/m14/clean-ruled.ts"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const argv = process.argv.slice(2)
const jsonOut = argv.includes("--json") ? argv[argv.indexOf("--json") + 1] : null

const parser = await getParser("clean")

/** Iterative pre-order walk — a 3M-node file overflows recursion. */
function walk(root: any, visit: (n: any) => void): void {
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()
    visit(n)
    for (let i = n.childCount - 1; i >= 0; i--) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
}

// ── PART A — the served build's declared vocabulary ─────────────────────────────────────────
const grammarArtifact = JSON.parse(readFileSync(join(ROOT, "validation/m14/measurements/clean-grammar-nodes.json"), "utf8"))
const NAMES: string[] = grammarArtifact.namedTypeNames ?? []
const ALL: string[] = grammarArtifact.allTypeNames ?? NAMES

const STEMS: Record<string, string[]> = {
  decorates: ["decorat", "annotat", "macro_apply", "macro_call", "pragma", "attribute"],
  part_of: ["include", "incbin", "part_of", "partof", "inline_file", "paste"],
  renders: ["render", "component", "element", "jsx", "vnode", "fragment", "slot", "template"],
  mixes_in: ["mixin", "trait", "embed", "compose", "with_clause", "member_set"],
}
const CONTROLS = ["class_declaration", "instance_declaration", "import_declaration", "macro_definition", "with_block", "index_access"]

const vocabulary: Record<string, { stems: Record<string, string[]>; hits: number }> = {}
for (const [label, stems] of Object.entries(STEMS)) {
  const out: Record<string, string[]> = {}
  let hits = 0
  for (const s of stems) {
    const found = ALL.filter((n) => n.toLowerCase().includes(s))
    out[s] = found
    hits += found.length
  }
  vocabulary[label] = { stems: out, hits }
}
const controlsFound = CONTROLS.filter((c) => NAMES.includes(c))

// ── PART A2 — the ATTRIBUTE-KEYS space: the grammar's declared FIELD names, and the corpus's
// own key positions. The gate asks a vocabulary-based ruling to declare which spaces it probed;
// this is the field space measured, not asserted. The 29 declared field names are read from the
// served Language object, so a build that grew a `decorator` or `mixin` slot field would be seen.
const lang: any = (parser as any).getLanguage?.() ?? (parser as any).language
const fieldCount = Number(lang?.fieldCount ?? lang?.fieldNameCount ?? 0)
const DECLARED_FIELDS: string[] = []
for (let i = 1; i <= fieldCount; i++) {
  const n = lang?.fieldNameForId?.(i)
  if (n) DECLARED_FIELDS.push(String(n))
}
const fieldVocabulary: Record<string, string[]> = {}
for (const label of Object.keys(STEMS)) {
  fieldVocabulary[label] = DECLARED_FIELDS.filter((f) => STEMS[label]!.some((stem) => f.toLowerCase().includes(stem)))
}

/** The corpus's KEY positions: names that could hide a construct in an attribute slot. */
const KEY_NODE_TYPES = ["record_field", "record_binding", "class_method_name", "class_member", "instance_member", "field_access"] as const
/**
 * A KEY IS A NAME, NOT A SYNTAX. The only way a construct could hide in the key space is if the
 * grammar MAPPED a key to it; this grammar maps keys to nothing (0 of its 29 declared field names
 * carries a construct stem, measured above). So the census reports both readings:
 *
 *   - `constructNameHits` — a key whose NAME IS a construct spelling (`decorator`, `include`,
 *     `mixin`, `component`, …). This is the reading the gate asks for, and it must be 0.
 *   - `stemMatches` — substring matches, reported and INSPECTED rather than counted as evidence.
 *     Measured: 27, every one a DATA key — `include_builtins`/`c_include_core` (cloogle's
 *     configuration flags saying which builtins to include in a search), `slot` (a Pm window
 *     record field), `…AnnotationS` (a function name). A field named `include_builtins` is a
 *     boolean about a search index, not a pasted file; counting it as a `part_of` site would be
 *     the lexical-probe defect this repository has recorded twice.
 */
const CONSTRUCT_WORDS = [
  "decorator",
  "decorates",
  "annotation",
  "include",
  "part_of",
  "mixin",
  "trait",
  "component",
  "jsx",
  "vnode",
  "render",
]
const keyCensus = {
  keysWalked: 0,
  byNodeType: {} as Record<string, number>,
  constructNameHits: [] as string[],
  stemMatches: [] as string[],
}

// ── PART B — synthetic shapes, parsed and dumped ─────────────────────────────────────────────
const SHAPES: [string, string][] = [
  ["constant/macro definition `:==`", "NSViewCloseButton\t:== 0\n"],
  ["constant whose body is an expression", "sizeOfInt :== 4 + 4\n"],
  ["macro definition whose body is a function", "apply :== \\f x -> f x\n"],
  // `with` is a SCOPE, not an inclusion: a guarded/defining block after the result expression.
  // The first draft wrote `start = with x = 1 in x + 1` — ML's spelling — and produced an ERROR
  // node, which would have been read as "the grammar cannot read with". The corpus's own shape is
  // `f x = y with y = x + 1` (StdList.icl:166's `with (ys,zs) = span p xs`), and it parses clean.
  ["with-block (defining scope)", "f x = y with y = x + 1\n"],
  ["class with a context `|`", "class Ord a | Eq a where (<) infix 4 :: a a -> Bool\n"],
  ["instance composing a context `with`", "instance Ord Int with Eq Int where (<) x y = True\n"],
  ["import (module, not file)", "import StdEnv\n"],
  ["from-import (selective)", "from StdEnv import length\n"],
  ["array index access", "f xs = xs.[0]\n"],
  ["constructor applied to an element string", "f = Tag \"<div>\"\n"],
  ["function application (a real call)", "f x = g x\n"],
]

const shapes: { name: string; source: string; errorNodes: number; shapes: string[]; hits: Record<string, string[]> }[] = []
for (const [name, source] of SHAPES) {
  const tree: any = await parser.parse(source, "probe.icl")
  const nodeTypes: string[] = []
  let errors = 0
  walk(tree.rootNode, (n) => {
    if (n.type === "ERROR" || n.isMissing) errors++
    if (nodeTypes.length < 8) nodeTypes.push(n.type)
  })
  const hits: Record<string, string[]> = { decorates: [], part_of: [], renders: [], mixes_in: [] }
  countCleanDecoratesConstruct(tree.rootNode, "probe.icl", hits.decorates!)
  countCleanPartOfConstruct(tree.rootNode, "probe.icl", hits.part_of!)
  countCleanRendersConstruct(tree.rootNode, "probe.icl", hits.renders!)
  countCleanMixesInConstruct(tree.rootNode, "probe.icl", hits.mixes_in!)
  shapes.push({ name, source: source.trim(), errorNodes: errors, shapes: nodeTypes, hits })
  tree.delete?.()
}

// ── PART C — the whole admitted corpus ─────────────────────────────────────────────────────
const all: string[] = []
const repos = new Map<string, number>()
for (const e of readdirSync(CR)) {
  const dir = join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[] = []
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\n")
      .filter((f) => /\.(icl|dcl)$/i.test(f))
  } catch {
    continue
  }
  let n = 0
  for (const f of tracked) {
    const abs = join(dir, f)
    try {
      if (statSync(abs).size > 1024 * 1024) continue
    } catch {
      continue
    }
    all.push(abs)
    n++
  }
  if (n) repos.set(e, n)
}
all.sort()

const nodeTypes = new Map<string, number>()
const nearest = {
  macroDefinition: 0,
  macroDefinitionWithDeclarationChild: 0,
  withBlock: 0,
  withBlockWithDeclarationChild: 0,
  classContext: 0,
  classContextWithDeclarationChild: 0,
  importDeclaration: 0,
  modulePathEndingInFile: 0,
  indexAccess: 0,
  indexAccessReceiverNamed: 0,
  renderishCalls: 0,
  htmlStringLiterals: 0,
  constructorElementString: 0,
}
const hits: Record<string, string[]> = { decorates: [], part_of: [], renders: [], mixes_in: [] }
let parsed = 0
let failed = 0

for (const abs of all) {
  let text: string
  try {
    text = readFileSync(abs, "utf8")
  } catch {
    continue
  }
  let tree: any
  try {
    tree = await parser.parse(text, abs)
    if (!tree) {
      failed++
      continue
    }
  } catch {
    failed++
    continue
  }
  parsed++
  const label = relative(CR, abs)
  walk(tree.rootNode, (n: any) => {
    nodeTypes.set(n.type, (nodeTypes.get(n.type) ?? 0) + 1)
    const hasDeclChild = (): boolean => {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && /^(function_declaration|operator_definition|type_signature|type_definition|record_definition|class_declaration|instance_declaration|generic_declaration|derive_declaration|macro_definition|foreign_export|module_declaration)$/.test(c.type)) return true
      }
      return false
    }
    if ((KEY_NODE_TYPES as readonly string[]).includes(n.type)) {
      keyCensus.keysWalked++
      keyCensus.byNodeType[n.type] = (keyCensus.byNodeType[n.type] ?? 0) + 1
      const keyName = String(n.childForFieldName?.("name")?.text ?? n.text ?? "").trim().toLowerCase()
      if (CONSTRUCT_WORDS.includes(keyName)) {
        keyCensus.constructNameHits.push(`${label}:${n.startPosition.row + 1} ${n.type} \`${keyName.slice(0, 40)}\``)
      } else if (CONSTRUCT_WORDS.some((w) => keyName.includes(w))) {
        keyCensus.stemMatches.push(`${label}:${n.startPosition.row + 1} ${n.type} \`${keyName.slice(0, 40)}\``)
      }
    }
    switch (n.type) {
      case "macro_definition":
        nearest.macroDefinition++
        if (hasDeclChild()) nearest.macroDefinitionWithDeclarationChild++
        break
      case "with_block":
        nearest.withBlock++
        if (hasDeclChild()) nearest.withBlockWithDeclarationChild++
        break
      case "class_context":
        nearest.classContext++
        if (hasDeclChild()) nearest.classContextWithDeclarationChild++
        break
      case "import_declaration":
        nearest.importDeclaration++
        break
      case "module_identifier":
      case "qualified_identifier":
        if (/\.(icl|dcl)$/i.test(String(n.text ?? "").trim())) nearest.modulePathEndingInFile++
        break
      case "index_access": {
        nearest.indexAccess++
        const recv = n.namedChild(0)
        if (recv && (recv.type === "identifier" || recv.type === "qualified_identifier")) nearest.indexAccessReceiverNamed++
        break
      }
      case "application": {
        const callee = n.namedChild(0)
        const name = String(callee?.text ?? "").trim()
        if (/^(toHtml|render|html|toHTML|HTML)$/.test(name)) nearest.renderishCalls++
        for (let i = 1; i < n.namedChildCount; i++) {
          const a = n.namedChild(i)
          if (a?.type === "string" && String(a.text ?? "").trim().replace(/^"|"$/g, "").startsWith("<")) nearest.constructorElementString++
        }
        break
      }
      case "string":
        if (/<\s*[A-Za-z][^>]*>/.test(String(n.text ?? ""))) nearest.htmlStringLiterals++
        break
    }
  })
  countCleanDecoratesConstruct(tree.rootNode, label, hits.decorates!)
  countCleanPartOfConstruct(tree.rootNode, label, hits.part_of!)
  countCleanRendersConstruct(tree.rootNode, label, hits.renders!)
  countCleanMixesInConstruct(tree.rootNode, label, hits.mixes_in!)
  tree.delete?.()
}

const top = [...nodeTypes].sort((a, b) => b[1] - a[1]).slice(0, 15)

console.log("CLEAN EXTENDED-TYPES CENSUS — decorates · part_of · renders · mixes_in\n")
console.log(`A. SERVED BUILD — ${NAMES.length} named types of ${ALL.length} symbol ids, digest ${grammarArtifact.servedDigest}`)
console.log(`   controls present: ${controlsFound.join(", ")}  (${controlsFound.length}/${CONTROLS.length})`)
for (const [label, v] of Object.entries(vocabulary)) {
  const detail = Object.entries(v.stems).map(([s, f]) => `${s}: ${f.length ? f.join(",") : "0"}`).join(" · ")
  console.log(`   ${label.padEnd(10)} vocabulary hits ${v.hits} — ${detail}`)
}

console.log(`   declared FIELD names: ${DECLARED_FIELDS.length} — ${DECLARED_FIELDS.join(", ")}`)
for (const [label, hits] of Object.entries(fieldVocabulary)) {
  console.log(`   ${label.padEnd(10)} field-space hits ${hits.length}${hits.length ? ` — ${hits.join(",")}` : ""}`)
}

console.log(`\nB. SYNTHETIC SHAPES — parsed with the served wasm, detectors = the arbiter's own`)
for (const s of shapes) {
  const fired = Object.entries(s.hits).filter(([, v]) => v.length).map(([k]) => k)
  console.log(`   ${s.name.padEnd(44)} errors ${String(s.errorNodes).padStart(2)}  shapes ${s.shapes.slice(0, 6).join(">")}`)
  if (fired.length) console.log(`      DETECTOR FIRED: ${fired.join(", ")} — ${Object.values(s.hits).flat().slice(0, 2).join(" | ")}`)
}

console.log(`\nC. CORPUS — ${all.length} admitted files in ${repos.size} repositories, ${parsed} parsed, ${failed} failed`)
console.log(`   controls: class_declaration ${nodeTypes.get("class_declaration") ?? 0} · instance_declaration ${nodeTypes.get("instance_declaration") ?? 0} · import_declaration ${nearest.importDeclaration} · macro_definition ${nearest.macroDefinition} · with_block ${nearest.withBlock}`)
console.log(`   decorates  nearest: macro_definition ${nearest.macroDefinition}, of which carrying a DECLARATION ${nearest.macroDefinitionWithDeclarationChild}`)
console.log(`   part_of    nearest: import_declaration ${nearest.importDeclaration}, module paths naming a FILE ${nearest.modulePathEndingInFile}`)
console.log(`   renders    nearest: render-ish calls ${nearest.renderishCalls}, HTML string literals ${nearest.htmlStringLiterals}, constructor+elements ${nearest.constructorElementString}`)
console.log(`   mixes_in   nearest: with_block ${nearest.withBlock} (declaration child ${nearest.withBlockWithDeclarationChild}), class_context ${nearest.classContext} (declaration child ${nearest.classContextWithDeclarationChild})`)
console.log(`   CL-G1      index_access ${nearest.indexAccess}, receiver an identifier/qualified name ${nearest.indexAccessReceiverNamed}`)
console.log(`   KEY SPACE   ${keyCensus.keysWalked} key positions walked (${Object.entries(keyCensus.byNodeType).map(([t, n]) => `${t}:${n}`).join(", ") || "none"})`)
console.log(`               construct-NAME keys ${keyCensus.constructNameHits.length}${keyCensus.constructNameHits.length ? ` — ${keyCensus.constructNameHits.slice(0, 3).join(" | ")}` : ""}; substring matches ${keyCensus.stemMatches.length} (data keys, inspected — ${keyCensus.stemMatches.slice(0, 3).join(" | ")})`)
for (const [label, h] of Object.entries(hits)) {
  console.log(`   DETECTOR ${label}: ${h.length ? `${h.length} HIT(S) — ${h.slice(0, 3).join(" | ")}` : "0 hits"}`)
}
console.log(`\n   top node types: ${top.map(([t, n]) => `${t}:${n}`).join("  ")}`)

const artifact = {
  language: "clean",
  measuredAt: new Date().toISOString(),
  population: { admitted: all.length, parsed, failed, repositories: Object.fromEntries([...repos].sort()) },
  servedBuild: { namedTypes: NAMES.length, totalIds: ALL.length, digest: grammarArtifact.servedDigest },
  vocabulary,
  declaredFields: DECLARED_FIELDS,
  fieldVocabulary,
  keyCensus,
  controls: { probed: CONTROLS, present: controlsFound },
  shapes,
  corpus: { nearest, detectorHits: Object.fromEntries(Object.entries(hits).map(([k, v]) => [k, v.length])), detectorSamples: hits, topNodeTypes: Object.fromEntries(top) },
  note:
    "The four extended values are ruled on the conjunction of the three parts: 0 vocabulary hits per construct, 0 detector hits over the whole admitted population, and the nearest construct counted rather than dismissed. Falsifiers are per type in script/m14/spec/clean-completeness.json and script/m14/clean-ruled.ts.",
}
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(artifact, null, 2) + "\n")
  console.log(`\nwrote ${jsonOut}`)
}
