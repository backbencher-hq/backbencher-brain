/**
 * TOML WHOLE-CORPUS CONSTRUCT CENSUS — the instrument that decides which of the ten
 * relationship types TOML can express, and which fire on the corpus we actually have.
 *
 * ## Why a census and not the firing sample
 *
 * `bun script/m14/firing-check.mjs TOML_B` reads 120 cargo files and reports TWO types fired
 * (`contains:882 imports:16`), everything else SILENT. This programme has measured SIX times
 * this session that a stride sample invents absences — SQL's DDL, bash's defaults, F#'s
 * modules, powershell's class headers, nim's macros, lua's overrides — every one of them a
 * type that fires on the whole corpus. And TOML's own `references` is already the shape: the
 * analyzer has an alias-reference pass with its own counters (`aliasEdges`), and the cargo
 * sample fires none of them. A sample can never certify absence, so this walks the WHOLE
 * admitted population: every tracked `.toml` file of every checkout under the corpus root,
 * under the incoming gate's own admission rule (tracked, present, ≤ 1 MB).
 *
 * ## What it counts
 *
 * SITES AND FILES per relationship type, from the production path (`getParser` → `analyze`),
 * and — separately — the CONSTRUCTS on the tree, because "the analyzer emits nothing" and
 * "the language cannot express it" are different findings and only the tree can tell them
 * apart:
 *
 *   table headers        `table`, `table_array_element`  (contains candidates)
 *   pairs                `pair`                          (contains candidates; dotted keys)
 *   inline tables        `inline_table`                   (contains candidates)
 *   dotted keys          `dotted_key`                     (references candidates)
 *   duplicate keys       any key path declared twice in one document (overrides candidates —
 *                        TOML FORBIDS this, so a well-formed document cannot express it)
 *   call-shaped nodes    `function_call`, `call_expression` (calls candidates — a grammar
 *                        inventory settles this one)
 *
 * The positive control is IN-LINE and planted through the same grammar: a document carrying
 * every construct this census rules on. The run exits 3 if any control count is 0, so a corpus
 * zero can never be a broken probe.
 *
 * ## Why this file is under `tools/` and not at the top of the fixtures directory
 *
 * `script/m14/completeness-inventory.ts`'s `emittedKinds` reads every top-level
 * non-`.json` FILE of a lane's fixtures directory and runs `ASTEngine.parseFile`
 * on each — so a TypeScript tool sitting at the top level is parsed AS TOML and its
 * garbage edges are credited to the lane. Measured before the move (probe
 * `.tmp-toml/attribution.mts`, same code path as the scanner): this file alone
 * contributed `calls imports instantiates references uses` over 261 edges, crediting
 * TOML with an `instantiates` emission TOML never emits, and section B read
 * `EMITTED but absent from requiredKinds: calls, imports, instantiates, references,
 * uses`. Directories are skipped by the scanner (`isFile()`), so the tool lives in
 * one. NOTE the move is necessary and NOT sufficient: six other top-level `.ts`
 * tools of this lane are read the same way.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/toml/tools/construct-census.ts [--json]
 *   BB_TOML_CENSUS_LIMIT=200 … # bounded draw when the machine is loaded
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

// FIVE levels up now that this file sits in `tools/` (toml -> fixtures -> m14 -> validation -> root).
const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const argv = process.argv.slice(2)
const JSON_OUT = argv.includes("--json")
const LIMIT = Number(process.env.BB_TOML_CENSUS_LIMIT ?? 0)

const { getParser } = await import(`${ROOT}/src/ast/engine.ts`)
const mod: any = await import(`${ROOT}/src/ast/real-toml-analyzer.ts`)
const Analyzer = Object.values(mod).find((v: any) => typeof v === "function" && /Analyzer$/.test(v.name)) as any
if (!Analyzer) { console.error("FATAL: no analyzer class in real-toml-analyzer.ts"); process.exit(2) }

/** The incoming gate's admission rule, transcribed: tracked, present, under the engine's cap. */
function discover(ext: string, limit: number): { files: string[]; total: number; repos: number } {
  const found: string[] = []
  const repos = new Set<string>()
  let entries: string[]
  try { entries = readdirSync(CR) } catch { return { files: [], total: 0, repos: 0 } }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!rel.toLowerCase().endsWith(`.${ext}`)) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      found.push(abs); repos.add(name)
    }
  }
  found.sort()
  if (limit > 0 && found.length > limit) {
    const stride = Math.max(1, Math.floor(found.length / limit))
    const picked: string[] = []
    for (let i = 0; i < found.length && picked.length < limit; i += stride) picked.push(found[i])
    return { files: picked, total: found.length, repos: repos.size }
  }
  return { files: found, total: found.length, repos: repos.size }
}

const kids = (n: any): any[] => { const o: any[] = []; for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) o.push(c) } return o }
const walk = (n: any, fn: (x: any) => void): void => { const st = [n]; while (st.length) { const x = st.pop(); fn(x); const cs = kids(x); for (let i = cs.length - 1; i >= 0; i--) st.push(cs[i]) } }

type Counts = Record<string, number> & { nodeTypes: Set<string>; nodeTypeCounts: Map<string, number> }
const newCounts = (): Counts => ({ nodeTypes: new Set<string>(), nodeTypeCounts: new Map<string, number>() } as any)
const count = (n: any, c: Counts): void => {
  walk(n, (x) => {
    c.nodeTypes.add(x.type)
    c.nodeTypeCounts.set(x.type, (c.nodeTypeCounts.get(x.type) ?? 0) + 1)
    if (x.type === "table" || x.type === "table_array_element") c.tableHeaders = (c.tableHeaders ?? 0) + 1
    if (x.type === "pair") c.pairs = (c.pairs ?? 0) + 1
    if (x.type === "inline_table") c.inlineTables = (c.inlineTables ?? 0) + 1
    if (x.type === "dotted_key") c.dottedKeys = (c.dottedKeys ?? 0) + 1
    if (x.type === "array") c.arrays = (c.arrays ?? 0) + 1
    if (x.type === "function_call" || x.type === "call_expression") c.callShaped = (c.callShaped ?? 0) + 1
  })
}

const CONTROL = `
# planted: every construct this census rules on
[a.table]
plain = 1
dotted.key.path = 2
inline = { x = 1, y = 2 }
[[a.array_of_tables]]
n = 1
[[a.array_of_tables]]
n = 2
[dup]
k = 1
list = [1, 2, 3]
# planted: every EXTENDED counter's near miss is exercised below, so a corpus zero
# is a measurement rather than a matcher that never fired.
base = "base.toml"
include = "inc.toml"
decorator = "wrap"
title = "{{ component.name }}"
[composed]
extends = "base.toml"
mixins = ["a", "b"]
# planted LAST: a template token OUTSIDE every string, the shape the renders
# decisive counter exists to detect (the grammar cannot lex it; the raw text can).
spliced = {{ component }}
`
const parser = await getParser("toml")
const ctrl = newCounts()
count((await parser.parse(CONTROL, "control.toml")).rootNode, ctrl)
const controlFired: Record<string, number> = {
  "table headers": ctrl.tableHeaders ?? 0, "pairs": ctrl.pairs ?? 0, "inline tables": ctrl.inlineTables ?? 0,
  "dotted keys": ctrl.dottedKeys ?? 0, "arrays": ctrl.arrays ?? 0, "call-shaped nodes": ctrl.callShaped ?? 0,
}
const controlFailures = Object.entries(controlFired).filter(([k, n]) => n < 1 && k !== "call-shaped nodes")
if (controlFailures.length > 0) {
  console.error("FATAL: this census's own positive control did not fire.")
  for (const [k, n] of controlFailures) console.error(`  ${k}: planted in the control document, counted ${n}`)
  process.exit(3)
}

// ---- THE GRAMMAR VOCABULARY: the pinned wasm's COMPLETE node-type inventory -------
//
// The evidence class the board calls `grammar-absence` is "a node-type/keyword
// inventory over the whole grammar: the language cannot express the construct".
// An inventory that is a list someone wrote from memory is not that, so this
// enumerates the pinned grammar ITSELF through web-tree-sitter's Language API
// (the same route `script/m14/audit-analyzer-grammar.ts` uses): every
// nodeTypeForId(0..nodeTypeCount-1), with named/anonymous flagged. No regex
// anywhere — PROMPT-LAPTOP-B §2.
const GRAMMAR_WASM = `${ROOT}/wasm/tree-sitter-toml.wasm`
const grammarNames: string[] = []
const grammarNamedSlots: string[] = []
try {
  const { Language } = await import("web-tree-sitter")
  const g: any = await Language.load(readFileSync(GRAMMAR_WASM))
  for (let i = 0; i < g.nodeTypeCount; i++) {
    const nm = g.nodeTypeForId(i)
    if (typeof nm === "string" && nm.length > 0) {
      grammarNames.push(nm)
      if (g.nodeTypeIsNamed(i)) grammarNamedSlots.push(nm)
    }
  }
} catch (e) {
  console.error(`FATAL: could not enumerate the pinned grammar at ${GRAMMAR_WASM}: ${String(e)}`)
  console.error("COULD NOT VERIFY, not a zero: a grammar inventory that cannot be read cannot certify absence.")
  process.exit(2)
}
// SLOTS vs NAMES, kept apart because the completeness spec's own claim is about NAMED
// types: `nodeTypeCount` also counts the anonymous tokens (`=`, `[`, `,` …). Named SLOTS
// minus distinct NAMED names is the grammar's duplicate-slot count, which is a fact the
// spec records (`escape_sequence` occupying two slots) and which this instrument can
// therefore confirm or refute rather than restate.
const grammarDistinct = [...new Set(grammarNames)].sort()
const grammarNamedDistinct = [...new Set(grammarNamedSlots)].sort()

// ---- pure-String vocabulary matchers (NO REGEX — PROMPT-LAPTOP-B §2) --------------
const startsWithAny = (s: string, ps: string[]): boolean => {
  for (const p of ps) if (s.length >= p.length && s.slice(0, p.length) === p) return true
  return false
}
const isInSet = (s: string, set: string[]): boolean => {
  for (const w of set) if (s === w) return true
  return false
}
const asciiLower = (t: string): string => {
  let out = ""
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i)
    out += c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : t[i]
  }
  return out
}
/** A pair's KEY LEAF: the last segment of a dotted key, unquoted. No regex. */
const leafOf = (keyNode: any): string => {
  if (!keyNode) return ""
  if (keyNode.type === "dotted_key") {
    const cs = kids(keyNode)
    return cs.length > 0 ? leafOf(cs[cs.length - 1]) : ""
  }
  let t = String(keyNode.text ?? "").trim()
  if (t.length >= 2) {
    const q = t.charCodeAt(0)
    if ((q === 34 || q === 39) && t.charCodeAt(t.length - 1) === q) t = t.slice(1, -1)
  }
  return asciiLower(t)
}
/** A pair's VALUE node — the last named child that is NOT a trailing comment. The
 *  analyzer's own `valueOf` skips comments for the same reason: `k = "v" # note` puts a
 *  `comment` after the value in the pair's named children, so "the last named child"
 *  reports the comment as the value. Found in the census after the extended counters read
 *  two comments as non-literal values; fixed here so the instrument agrees with the path
 *  it measures. */
const valueNodeOf = (pair: any): any => {
  const cs = kids(pair)
  for (let i = cs.length - 1; i >= 1; i--) if (cs[i].type !== "comment") return cs[i]
  return null
}
/** A pair's VALUE as a plain string, or null. Literal strings have no escapes. */
const stringValueOf = (pair: any): string | null => {
  const v = valueNodeOf(pair)
  if (!v || v.type !== "string") return null
  let t = String(v.text ?? "").trim()
  if (t.length >= 2) {
    const q = t.charCodeAt(0)
    if ((q === 34 || q === 39) && t.charCodeAt(t.length - 1) === q) t = t.slice(1, -1)
  }
  return t
}

/**
 * THE VOCABULARY TESTS — one per ruled type, transcribed from the lane's own
 * adjudication instrument (`script/m14/toml-applicability-audit.ts`, whose verdicts
 * this census must be able to refute rather than restate). A NODE match is a name
 * PREFIX; a KEY match is an EXACT lowercase leaf name. The same matcher runs for
 * `contains`, a construct this lane KNOWS exists, so the control below proves the
 * matcher can fire and a zero is a measurement rather than a blind probe.
 */
const VOCAB: Record<string, { nodes: string[]; keys: string[]; question: string }> = {
  contains: {
    nodes: ["table", "pair", "inline_table", "dotted_key", "table_array_element"],
    keys: [],
    question: "CONTROL — a containment production exists in this grammar (table/pair/inline_table/dotted_key)",
  },
  calls: {
    nodes: ["call", "invoke", "macro", "function", "method", "class", "struct", "enum", "interface", "type_", "new_expr", "expr", "expression", "lambda", "arrow", "block"],
    keys: ["call", "calls", "invoke", "invocation", "function", "fn"],
    question: "does the grammar hold ANY node type that could express a call, or a callable to call?",
  },
  uses: {
    nodes: ["type_identifier", "type_annotation", "type_alias", "type_declaration"],
    keys: [],
    question: "is there a TYPE-DECLARATION production — without one nothing carries a type to be used?",
  },
  exports: {
    nodes: ["export", "pub", "visibility", "modifier"],
    keys: ["export", "exports", "expose", "exposed", "pub", "public", "publish", "main", "module", "mod", "entrypoint"],
    question: "does any production PUBLISH a name to a consumer?",
  },
  extends: {
    nodes: ["extends", "superclass", "base_class", "inheritance", "derived"],
    keys: ["extends", "extend", "extends_from", "inherits_from", "base", "parent", "superclass", "derived_from", "template", "implements", "implement", "implements_from", "iface", "interface", "contracts"],
    question: "is there an IS-A production, and any corpus key whose string value names a declaration the document makes?",
  },
  implements: {
    nodes: ["interface", "protocol", "trait", "abstract", "implementation"],
    keys: ["implements", "implement", "implements_from", "iface", "interface", "contracts"],
    question: "is there an interface/conformance production, and any corpus key naming an interface?",
  },
  instantiates: {
    nodes: ["new", "construct", "instantiate"],
    keys: ["new", "instantiate", "instantiates", "construct", "constructor", "factory"],
    question: "is there a CONSTRUCTION production, and any corpus key naming a constructor?",
  },
  overrides: {
    nodes: ["override"],
    keys: [],
    question: "is there a RE-DECLARATION production that REPLACES? (the duplicate-key probe above counts the corpus side)",
  },
}

/** Which of the pinned grammar's node types could carry a ruled type's construct. */
const nodeMatches = (type: string): string[] => grammarDistinct.filter((n) => startsWithAny(n, VOCAB[type].nodes))
/** Key sites for one document: matched pairs, those with a string value, and those
 *  whose string value NAMES a declaration the same document makes (the referent)). */
const keyScan = (pairs: { leaf: string; value: string | null }[], declared: Set<string>, type: string) => {
  const keys = VOCAB[type].keys
  if (keys.length === 0) return { sites: 0, stringSites: 0, referentSites: 0, examples: [] as string[] }
  let sites = 0, stringSites = 0, referentSites = 0
  const examples: string[] = []
  for (const p of pairs) {
    if (!isInSet(p.leaf, keys)) continue
    sites++
    if (examples.length < 3) examples.push(p.leaf)
    if (p.value === null) continue
    stringSites++
    if (declared.has(asciiLower(p.value))) referentSites++
  }
  return { sites, stringSites, referentSites, examples }
}

// ---- EXTENDED-VOCABULARY COUNTERS -------------------------------------------------
//
// The four extended values (`decorates`, `renders`, `mixes_in`, `part_of`) are decided on a
// DECISIVE counter with a measured NEAR MISS beside it: the near miss is the shape that
// tempts a reader to see the relation, and the difference between the two counts IS the
// ruling. A decisive counter that names no counted construct is a sentence, not evidence,
// so every matcher below walks the real tree and every one that CAN fire on a TOML document
// is shown firing on the planted control before the corpus is read.
//
// `extends` is measured TWO WAYS, because the fleet's contract needs a supertype and a
// configuration format has none: (a) do the inheritance-shaped keys name an ADMITTED
// document project-wide, and (b) is the target a PATH (a path is not a symbol, so an edge
// to it resolves nothing) or a bare module-like name. Either way it is not a supertype.
const LEXICAL_VALUE_TYPES = new Set(["string", "integer", "float", "boolean", "local_date", "local_time", "local_date_time", "offset_date_time", "array", "inline_table"])
const INHERITANCE_LEAVES = VOCAB.extends.keys
const INCLUDE_LEAVES = ["include", "includes", "import", "imports", "load", "loads", "source", "sources", "parent", "preset", "presets"]
const DECORATOR_LEAVES = ["decorator", "decorators", "decorate", "decorated", "decoration", "annotation", "annotations", "annotate", "wraps", "wrapper", "wrap", "middleware", "aspect", "advice", "prepend", "hook", "hooks"]
const COMPONENT_LEAVES = ["mixins", "mixin", "components", "component", "plugins", "plugin", "includes", "traits", "trait"]
const TEMPLATE_TOKENS = ["{{", "${", "{%", "%{"]
const INCLUDE_DIRECTIVE_PREFIXES = ["include", "directive", "import", "preproc", "splice"]

const unquote = (t: string): string => {
  let s = t.trim()
  if (s.length >= 2) {
    const q = s.charCodeAt(0)
    if ((q === 34 || q === 39) && s.charCodeAt(s.length - 1) === q) s = s.slice(1, -1)
  }
  return s
}
/** A pair's value as a STRING ARRAY, or null when it is not an array of strings. */
const stringArrayOf = (pair: any): string[] | null => {
  const v = valueNodeOf(pair)
  if (!v || v.type !== "array") return null
  const out: string[] = []
  for (const c of kids(v)) {
    if (c.type !== "string") return null
    out.push(unquote(String(c.text ?? "")))
  }
  return out.length > 0 ? out : null
}
/** A value that is shaped like a PATH: it carries a separator or names a `.toml` file.
 *  A bare module-like name (`serde`, `base_config`) is NOT path-shaped, and the ruling
 *  needs the two told apart because a path is not a symbol. */
const pathShapedValue = (v: string): boolean => v.includes("/") || asciiLower(v).endsWith(".toml")

type ExtSite = { leaf: string; value: string | null; valueKind: string | null; line: number; root: boolean }
type ExtTable = { header: string; component: boolean; base: boolean }
type ExtDoc = {
  inheritance: ExtSite[]
  includeKeys: ExtSite[]
  decorator: ExtSite[]
  fileNaming: ExtSite[]
  nonLiteralValues: number
  callShapedTextValues: number
  template: { total: number; inString: number; inComment: number; outsideBoth: number; outsideWithErrorAncestor: number; outsideNoErrorAncestor: number; outsideByType: Record<string, number>; outsideExamples: string[]; examples: string[] }
  tables: ExtTable[]
}
/** One document's extended-construct sites. `content` is the raw text, needed because the
 *  decisive `renders` counter asks whether a template token is INSIDE a lexed string or
 *  OUTSIDE every string and comment — the second shape is another language's text the
 *  grammar cannot lex, which is exactly the difference the ruling rests on. */
const scanExtended = (root: any, content: string): ExtDoc => {
  const strings: Array<[number, number]> = []
  const comments: Array<[number, number]> = []
  const allSpans: Array<[number, number, string]> = []
  const inheritance: ExtSite[] = [], includeKeys: ExtSite[] = [], decorator: ExtSite[] = [], fileNaming: ExtSite[] = []
  let nonLiteralValues = 0, callShapedTextValues = 0
  const rootPairStarts = new Set<number>()
  for (const n of kids(root)) if (n.type === "pair") rootPairStarts.add(n.startIndex)
  walk(root, (x) => {
    allSpans.push([x.startIndex, x.endIndex, String(x.type)])
    if (x.type === "string") strings.push([x.startIndex, x.endIndex])
    if (x.type === "comment") comments.push([x.startIndex, x.endIndex])
    if (x.type !== "pair") return
    const k = kids(x)[0]
    if (!k) return
    const leaf = leafOf(k)
    if (leaf.length === 0) return
    const v = valueNodeOf(x)
    const sv = stringValueOf(x)
    const site: ExtSite = { leaf, value: sv, valueKind: v ? String(v.type) : null, line: x.startPosition.row + 1, root: rootPairStarts.has(x.startIndex) }
    if (v && !LEXICAL_VALUE_TYPES.has(String(v.type))) {
      // THE DECORATES DECISIVE COUNTER is derived below from `decorator` sites whose
      // `valueKind` is outside the grammar's closed value production set. A call is an
      // expression, and TOML's value set is literals and containers only, so a non-literal
      // value is either a parse failure or — if it ever became lexable — the application
      // shape itself. Counting it makes the zero a measurement, not prose.
      nonLiteralValues++
    }
    if (sv !== null && sv.includes("(") && sv.includes(")")) callShapedTextValues++
    if (isInSet(leaf, INHERITANCE_LEAVES)) inheritance.push(site)
    if (isInSet(leaf, INCLUDE_LEAVES)) includeKeys.push(site)
    if (isInSet(leaf, DECORATOR_LEAVES)) decorator.push(site)
    if (sv !== null && pathShapedValue(sv)) fileNaming.push(site)
  })
  const template = { total: 0, inString: 0, inComment: 0, outsideBoth: 0, outsideWithErrorAncestor: 0, outsideNoErrorAncestor: 0, outsideByType: {} as Record<string, number>, outsideExamples: [] as string[], examples: [] as string[] }
  // A template token's ENCLOSING NODE decides what it is: inside a `string` it is text (a
  // template carried as payload, not a TOML expression); inside a `comment` it is silence;
  // anywhere else it is text the grammar could not lex. The decisive question for `renders`
  // is then whether the grammar LEXED it: a token enclosed by an ERROR node sits inside a
  // region the parser marked unreadable — another language's text inside a TOML file —
  // while a token NO ERROR encloses would be a value the grammar actually parsed. The
  // innermost node's type says where the unlexable region landed.
  const lineOf = (idx: number): number => { let n = 1; for (let k = 0; k < idx && k < content.length; k++) if (content.charCodeAt(k) === 10) n++; return n }
  for (const tok of TEMPLATE_TOKENS) {
    let i = content.indexOf(tok)
    while (i >= 0) {
      template.total++
      const inString = strings.some(([a, b]) => i >= a && i < b)
      const inComment = !inString && comments.some(([a, b]) => i >= a && i < b)
      if (inString) template.inString++
      else if (inComment) template.inComment++
      else {
        template.outsideBoth++
        const errExact = allSpans.some(([a, b, t]) => t === "ERROR" && i >= a && i < b)
        if (errExact) template.outsideWithErrorAncestor++
        else template.outsideNoErrorAncestor++
        let enclosing = "no-named-node", best = Infinity
        for (const [a, b, t] of allSpans) if (i >= a && i < b && b - a < best) { best = b - a; enclosing = t }
        template.outsideByType[enclosing] = (template.outsideByType[enclosing] ?? 0) + 1
        if (template.outsideExamples.length < 6) template.outsideExamples.push(`${tok}@${lineOf(i)} in ${enclosing}${errExact ? " (inside an ERROR region)" : ""}`)
      }
      if (template.examples.length < 3) template.examples.push(tok)
      i = content.indexOf(tok, i + 1)
    }
  }
  // TABLE CONTEXTS: the mixin construct is a table-level composition, so the decisive
  // counter is "ONE table carries BOTH a component list and a separately named base".
  const tables: ExtTable[] = []
  const addContext = (header: string, nodes: any[]): void => {
    let component = false, base = false
    for (const pr of nodes) {
      if (pr.type !== "pair") continue
      const k = kids(pr)[0]
      if (!k) continue
      const leaf = leafOf(k)
      const arr = stringArrayOf(pr)
      if (arr && isInSet(leaf, COMPONENT_LEAVES)) component = true
      if (isInSet(leaf, INHERITANCE_LEAVES)) base = true
    }
    if (component || base) tables.push({ header, component, base })
  }
  addContext("", kids(root))
  for (const ch of kids(root)) {
    if (ch.type !== "table" && ch.type !== "table_array_element") continue
    addContext(String(ch.text).split("\n")[0].trim(), kids(ch))
  }
  return { inheritance, includeKeys, decorator, fileNaming, nonLiteralValues, callShapedTextValues, template, tables }
}

// ---- THE VOCABULARY POSITIVE CONTROL ---------------------------------------------
// Two halves, both required before any zero below may be read as an absence:
//   1. the NODE matcher must find a construct that exists (`contains`), and
//   2. the KEY matcher must find every planted keyword, so a corpus zero for a
//      keyword is a measurement rather than a matcher that never fires.
const containsNodes = nodeMatches("contains")
if (containsNodes.length < 3) {
  console.error("FATAL: the vocabulary matcher found no containment production in the pinned grammar.")
  console.error(`  matched ${containsNodes.length} node types for a construct this lane emits 25,033 edges from.`)
  process.exit(3)
}
// THE FIRST VERSION OF THIS CONTROL PLANTED `planted_call = "calls"` AND FAILED — correctly.
// The key matcher tests EXACT leaf names, so a control key that merely CONTAINS the word
// shares the probe's blind spot and proves nothing about it. Each planted key is the
// vocabulary word ITSELF, which is what the matcher is asked to find on the corpus.
const KEY_CONTROL = `
call = "calls"
base = "extends"
iface = "implements"
constructor = "instantiates"
publish = "exports"
`
const ctrlPairs = kids((await parser.parse(KEY_CONTROL, "key-control.toml")).rootNode)
  .filter((n) => n.type === "pair")
  .map((n) => ({ leaf: leafOf(kids(n)[0]), value: stringValueOf(n) }))
const ctrlDeclared = new Set(ctrlPairs.map((p) => p.leaf))
const keywordControl: Record<string, number> = {}
for (const t of ["calls", "extends", "implements", "instantiates", "exports"]) {
  if (VOCAB[t].keys.length === 0) continue
  keywordControl[t] = keyScan(ctrlPairs, ctrlDeclared, t).sites
  if (keywordControl[t] < 1) {
    console.error(`FATAL: the KEY vocabulary matcher is blind to its own planted keyword for \`${t}\`.`)
    process.exit(3)
  }
}

// ---- THE EXTENDED COUNTERS' POSITIVE CONTROL ---------------------------------------
// Every counter that CAN fire on a TOML document is shown firing on the planted control
// before the corpus is read. The two that cannot — a decorator-shaped key whose value is an
// applied call, and a template expression that parses as a TOML value — are zero BY THE
// GRAMMAR'S VALUE PRODUCTION SET (`LEXICAL_VALUE_TYPES`) and the grammar inventory is their
// control; the raw-text counter `template.outsideBoth` proves the lexer side is observed.
const extCtrl = scanExtended((await parser.parse(CONTROL, "extended-control.toml")).rootNode, CONTROL)
const extControlFired: Record<string, number> = {
  inheritanceKeys: extCtrl.inheritance.length,
  includeKeys: extCtrl.includeKeys.length,
  decoratorKeys: extCtrl.decorator.length,
  fileNamingKeys: extCtrl.fileNaming.length,
  componentListTables: extCtrl.tables.filter((t) => t.component).length,
  tablesWithBothClauses: extCtrl.tables.filter((t) => t.component && t.base).length,
  templateInString: extCtrl.template.inString,
  templateOutsideBoth: extCtrl.template.outsideBoth,
}
const extControlFailures = Object.entries(extControlFired).filter(([, n]) => n < 1)
if (extControlFailures.length > 0) {
  console.error("FATAL: an EXTENDED counter did not fire on its own planted control.")
  for (const [k, n] of extControlFailures) console.error(`  ${k}: planted in the control document, counted ${n}`)
  process.exit(3)
}

// ---- `--file=<path>`: dump ONE document's symbols and edges, for reading a gate worklist entry
const fileArg = argv.find((a) => a.startsWith("--file="))?.slice("--file=".length)
if (fileArg) {
  const abs = fileArg.startsWith("/") ? fileArg : path.join(CR, fileArg)
  const content = readFileSync(abs, "utf8")
  const root = (await parser.parse(content, abs)).rootNode
  const res: any = new Analyzer().analyze(root, content, abs)
  console.log(`file: ${abs}`)
  console.log(`SYMBOLS (name | kind | ownerName | keyPath)`)
  for (const s of (res.symbols ?? []).slice(0, 50)) {
    console.log(`  ${String(s.name).padEnd(38)} | ${String(s.kind).padEnd(9)} | owner=${JSON.stringify(s.ownerName ?? null)} | keyPath=${JSON.stringify(s.metadata?.keyPath ?? null)}`)
  }
  console.log(`EDGES`)
  const tally: Record<string, number> = {}
  for (const r of res.relationships ?? []) {
    const mk = Object.keys(r.metadata ?? {}).filter((k) => k !== "evidenceClass").sort().join("+")
    tally[`${r.type} [${mk}]`] = (tally[`${r.type} [${mk}]`] ?? 0) + 1
    if ((res.relationships ?? []).length <= 30) console.log(`  ${String(r.type).padEnd(11)} ${JSON.stringify(r.source)} -> ${JSON.stringify(r.target)}  [${mk}]`)
  }
  console.log(`EDGE TALLY: ${JSON.stringify(tally, null, 1)}`)
  process.exit(0)
}

const { files, total, repos } = discover("toml", LIMIT)
// ---- EXTENDED-COUNT AGGREGATES AND PROJECT-WIDE RESOLUTION ------------------------
// The admitted set is this census's OWN discovery, so "names an ADMITTED document" is a
// statement about the SAME population the counts are over — the fleet's rule that an
// instrument and its denominator must count the same population.
const ADMITTED = new Set(files)
const repoRootOf = (abs: string): string => path.join(CR, abs.slice(CR.length + 1).split(path.sep)[0])
/** Resolve a string value against the declaring file and its repository root, then say
 *  whether either candidate names an ADMITTED document or any file on disk. A bare
 *  module-like name resolves to neither, which is the distinction `extends` needs. */
const resolveDocValue = (absFile: string, value: string): { admitted: boolean; exists: boolean } => {
  const candidates = [path.resolve(path.dirname(absFile), value), path.resolve(repoRootOf(absFile), value)]
  let admitted = false, exists = false
  for (const c of candidates) {
    if (ADMITTED.has(c)) admitted = true
    if (existsSync(c)) exists = true
  }
  return { admitted, exists }
}
const EXT = {
  inheritance: { sites: 0, files: 0, stringSites: 0, pathShaped: 0, bare: 0, namesAdmittedToml: 0, namesExistingOnDisk: 0, examples: [] as string[], admittedExamples: [] as string[] },
  includeKeys: { sites: 0, files: 0, examples: [] as string[] },
  decorator: { sites: 0, files: 0, pointerSites: 0, appliedCallSites: 0, callShapedTextSites: 0, examples: [] as string[] },
  template: { total: 0, inString: 0, inComment: 0, outsideBoth: 0, outsideWithErrorAncestor: 0, outsideNoErrorAncestor: 0, outsideByType: {} as Record<string, number>, files: 0, examples: [] as string[], outsideExamples: [] as string[] },
  fileNamingKeys: { sites: 0, files: 0, rootPosition: 0, namesAdmittedToml: 0, examples: [] as string[], admittedExamples: [] as string[] },
  componentListTables: { tables: 0, files: 0, examples: [] as string[] },
  mixin: { tablesWithBoth: 0, files: 0, examples: [] as string[] },
  nonLiteralValues: 0,
}
const includeDirectiveNodeTypes = grammarDistinct.filter((n) => startsWithAny(n, INCLUDE_DIRECTIVE_PREFIXES))
const corpus = newCounts()
const perType = new Map<string, { edges: number; files: Set<string>; targets: Set<string>; markers: Map<string, number> }>()
const dupKeys = { documents: 0, keys: 0, examples: [] as string[] }
const VOCAB_KEYS = Object.keys(VOCAB).filter((t) => VOCAB[t].keys.length > 0)
const vocabSites = new Map<string, { sites: number; stringSites: number; referentSites: number; examples: string[] }>()
for (const t of Object.keys(VOCAB)) vocabSites.set(t, { sites: 0, stringSites: 0, referentSites: 0, examples: [] })
// THE Cargo WORKSPACE-INHERITANCE POPULATION, counted because it is the size of an OPEN
// item rather than a ruling: `version.workspace = true` says "this key's value comes from
// the workspace manifest" — a reference to another document's declaration, and the SAME
// ontology type as the 167 Gradle alias edges this lane does emit. The analyzer's alias
// pass resolves `x = <name-of-a-key>` inside a version catalogue and does not walk this
// shape, so this count is the size of the unimplemented half, on the record as a blocker.
const workspaceInheritance = { sites: 0, documents: 0 }
let parsed = 0, failed = 0

for (const f of files) {
  let content: string
  try { content = readFileSync(f, "utf8") } catch { failed++; continue }
  let root: any
  try { root = (await parser.parse(content, f)).rootNode } catch { failed++; continue }
  parsed++
  count(root, corpus)
  const rel = f.slice(CR.length + 1)

  // KEY VOCABULARY — every pair's LEAF name and its string value, for the whole corpus.
  // The referent question ("does a key of this shape NAME a declaration this document
  // makes") is answerable only with the document in hand, so it is answered here rather
  // than by a name filter run over a summary.
  const docPairs: { leaf: string; value: string | null }[] = []
  const docDeclared = new Set<string>()
  let docWorkspaceSites = 0
  walk(root, (x) => {
    if (x.type !== "pair") return
    const k = kids(x)[0]
    if (!k) return
    const leaf = leafOf(k)
    if (leaf.length === 0) return
    docDeclared.add(leaf)
    docPairs.push({ leaf, value: stringValueOf(x) })
    // `x.workspace = true` — the workspace-inheritance shape.
    if (leaf !== "workspace") return
    const v = valueNodeOf(x)
    if (v && v.type === "boolean" && String(v.text).trim() === "true") docWorkspaceSites++
  })
  if (docWorkspaceSites > 0) { workspaceInheritance.documents++; workspaceInheritance.sites += docWorkspaceSites }
  for (const t of VOCAB_KEYS) {
    const r = keyScan(docPairs, docDeclared, t)
    const agg = vocabSites.get(t)!
    agg.sites += r.sites
    agg.stringSites += r.stringSites
    agg.referentSites += r.referentSites
    for (const e of r.examples) if (agg.examples.length < 6 && !agg.examples.includes(e)) agg.examples.push(e)
  }

  // EXTENDED COUNTERS — one decisive / near-miss pair per extended type, plus the
  // two-way `extends` re-test. Every aggregate below is a walk of THIS document.
  const ex = scanExtended(root, content)
  EXT.nonLiteralValues += ex.nonLiteralValues
  if (ex.inheritance.length > 0) {
    EXT.inheritance.files++
    for (const s of ex.inheritance) {
      EXT.inheritance.sites++
      if (s.value === null) continue
      EXT.inheritance.stringSites++
      // (b) PATH or BARE NAME — a path is not a symbol, so an edge to it resolves nothing.
      if (!pathShapedValue(s.value)) {
        EXT.inheritance.bare++
        if (EXT.inheritance.examples.length < 8) EXT.inheritance.examples.push(`${rel}:${s.line} ${s.leaf}=${JSON.stringify(s.value)} (bare)`)
        continue
      }
      EXT.inheritance.pathShaped++
      // (a) does the path name a document in THIS population, project-wide?
      const r = resolveDocValue(f, s.value)
      if (r.admitted) {
        EXT.inheritance.namesAdmittedToml++
        if (EXT.inheritance.admittedExamples.length < 8) EXT.inheritance.admittedExamples.push(`${rel}:${s.line} ${s.leaf}=${JSON.stringify(s.value)}`)
      } else if (r.exists) EXT.inheritance.namesExistingOnDisk++
      if (EXT.inheritance.examples.length < 8) EXT.inheritance.examples.push(`${rel}:${s.line} ${s.leaf}=${JSON.stringify(s.value)}`)
    }
  }
  if (ex.includeKeys.length > 0) {
    EXT.includeKeys.files++
    EXT.includeKeys.sites += ex.includeKeys.length
    for (const s of ex.includeKeys) if (EXT.includeKeys.examples.length < 8) EXT.includeKeys.examples.push(`${rel}:${s.line} ${s.leaf}=${JSON.stringify(s.value)}`)
  }
  if (ex.decorator.length > 0) {
    EXT.decorator.files++
    for (const s of ex.decorator) {
      EXT.decorator.sites++
      if (s.value !== null) EXT.decorator.pointerSites++
      if (s.valueKind !== null && !LEXICAL_VALUE_TYPES.has(s.valueKind)) EXT.decorator.appliedCallSites++
      if (EXT.decorator.examples.length < 8) EXT.decorator.examples.push(`${rel}:${s.line} ${s.leaf}=${JSON.stringify(s.value)}`)
    }
  }
  EXT.decorator.callShapedTextSites += ex.callShapedTextValues
  if (ex.template.total > 0) {
    EXT.template.files++
    EXT.template.total += ex.template.total
    EXT.template.inString += ex.template.inString
    EXT.template.inComment += ex.template.inComment
    EXT.template.outsideBoth += ex.template.outsideBoth
    EXT.template.outsideWithErrorAncestor += ex.template.outsideWithErrorAncestor
    EXT.template.outsideNoErrorAncestor += ex.template.outsideNoErrorAncestor
    for (const [t, n] of Object.entries(ex.template.outsideByType)) EXT.template.outsideByType[t] = (EXT.template.outsideByType[t] ?? 0) + n
    for (const e of ex.template.examples) if (EXT.template.examples.length < 8) EXT.template.examples.push(`${rel}: ${e}`)
    for (const e of ex.template.outsideExamples) if (EXT.template.outsideExamples.length < 8) EXT.template.outsideExamples.push(`${rel}: ${e}`)
  }
  if (ex.fileNaming.length > 0) {
    EXT.fileNamingKeys.files++
    for (const s of ex.fileNaming) {
      EXT.fileNamingKeys.sites++
      if (s.root) EXT.fileNamingKeys.rootPosition++
      const r = s.value !== null ? resolveDocValue(f, s.value) : { admitted: false, exists: false }
      if (r.admitted) {
        EXT.fileNamingKeys.namesAdmittedToml++
        if (EXT.fileNamingKeys.admittedExamples.length < 8) EXT.fileNamingKeys.admittedExamples.push(`${rel}:${s.line} ${s.leaf}=${JSON.stringify(s.value)}`)
      }
      if (EXT.fileNamingKeys.examples.length < 8) EXT.fileNamingKeys.examples.push(`${rel}:${s.line} ${s.leaf}=${JSON.stringify(s.value)}`)
    }
  }
  const compTables = ex.tables.filter((t) => t.component)
  if (compTables.length > 0) {
    EXT.componentListTables.tables += compTables.length
    EXT.componentListTables.files++
    for (const t of compTables) if (EXT.componentListTables.examples.length < 8) EXT.componentListTables.examples.push(`${rel}: ${t.header || "<document root>"}`)
  }
  const bothClauses = ex.tables.filter((t) => t.component && t.base)
  if (bothClauses.length > 0) {
    EXT.mixin.tablesWithBoth += bothClauses.length
    EXT.mixin.files++
    for (const t of bothClauses) if (EXT.mixin.examples.length < 8) EXT.mixin.examples.push(`${rel}: ${t.header || "<document root>"}`)
  }

  // DUPLICATE KEYS: a key path declared twice in ONE TABLE of one document. TOML forbids that
  // (RFC 8259's sibling rule for TOML: "you cannot define a key more than once"), so this is
  // the language fact an `overrides` ruling would rest on.
  //
  // THE PATH, NOT THE BARE KEY. The first version counted key TEXT, which made every
  // `[[package]]` element's `uuid`/`name` look like a duplicate — a probe that reports the
  // language's normal mode as a violation. A table-array ELEMENT is its own namespace, so the
  // path carries an element index.
  const seenKeys = new Map<string, number>()
  let tablePath = ""
  let aotIndex = new Map<string, number>()
  for (const ch of kids(root)) {
    if (ch.type === "table" || ch.type === "table_array_element") {
      const header = String(ch.text).split("\n")[0].trim()
      if (ch.type === "table_array_element") {
        const n = (aotIndex.get(header) ?? 0) + 1
        aotIndex.set(header, n)
        tablePath = `${header}#${n}`
      } else tablePath = header
      continue
    }
    if (ch.type !== "pair") continue
    const key = kids(ch)[0]
    if (!key) continue
    const full = `${tablePath}\u0000${String(key.text).trim()}`
    seenKeys.set(full, (seenKeys.get(full) ?? 0) + 1)
  }
  // A table's own pairs are the root's direct children only for TOP-LEVEL pairs; a pair inside a
  // table/table_array_element is a child of THAT node, so it is counted there.
  const aotIndex2 = new Map<string, number>()
  for (const ch of kids(root)) {
    if (ch.type !== "table" && ch.type !== "table_array_element") continue
    const header = String(ch.text).split("\n")[0].trim()
    let path2 = header
    if (ch.type === "table_array_element") {
      const n = (aotIndex2.get(header) ?? 0) + 1
      aotIndex2.set(header, n)
      path2 = `${header}#${n}`
    }
    for (const pr of kids(ch)) {
      if (pr.type !== "pair") continue
      const key = kids(pr)[0]
      if (!key) continue
      const full = `${path2}\u0000${String(key.text).trim()}`
      seenKeys.set(full, (seenKeys.get(full) ?? 0) + 1)
    }
  }
  const dups = [...seenKeys.entries()].filter(([, n]) => n > 1)
  if (dups.length) {
    dupKeys.documents++
    dupKeys.keys += dups.length
    const shown = (k: string) => k.split("\u0000").join(" ▸ ")
    if (dupKeys.examples.length < 8) dupKeys.examples.push(`${rel}: ${dups.slice(0, 3).map(([k, n]) => `${shown(k)}×${n}`).join(", ")}`)
  }

  let res: any
  try { res = new Analyzer().analyze(root, content, f) } catch { failed++; continue }
  for (const r of res.relationships ?? []) {
    const t = String(r?.type ?? "")
    let e = perType.get(t)
    if (!e) perType.set(t, (e = { edges: 0, files: new Set(), targets: new Set(), markers: new Map() }))
    e.edges++
    e.files.add(rel)
    if (r?.target) e.targets.add(String(r.target))
    const mk = Object.keys(r?.metadata ?? {}).filter((k) => k !== "evidenceClass").sort().join("+")
    e.markers.set(mk, (e.markers.get(mk) ?? 0) + 1)
  }
}

// The include-production half of the `part_of` ruling: a node type that could carry a
// directive splicing another document into this one. The grammar's own inventory is the
// control, and the corpus count is its corroboration.
const includeDirectiveCorpusOccurrences = [...corpus.nodeTypeCounts.entries()]
  .filter(([n]) => startsWithAny(n, INCLUDE_DIRECTIVE_PREFIXES))
  .reduce((sum, [, c]) => sum + c, 0)

const types = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
const rows = types.map((t) => {
  const e = perType.get(t)
  return {
    type: t, edges: e?.edges ?? 0, files: e?.files.size ?? 0, distinctTargets: e?.targets.size ?? 0,
    markers: e ? [...e.markers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4) : [],
  }
})

// ---- THE VOCABULARY VERDICT, per ruled type --------------------------------------
// Both halves of the evidence the board's classes name: the NODE half is read off the
// pinned grammar (a construct with no node type has no production), the KEY half off the
// whole corpus (a word a tool would have to interpret, and whether it names anything).
const vocabReport: Record<string, any> = {}
for (const t of Object.keys(VOCAB)) {
  const nm = nodeMatches(t)
  const typesMatching: string[] = []
  let occurrences = 0
  for (const [n, c] of corpus.nodeTypeCounts) if (startsWithAny(n, VOCAB[t].nodes)) { typesMatching.push(n); occurrences += c }
  const k = vocabSites.get(t)!
  vocabReport[t] = {
    question: VOCAB[t].question,
    grammarNodeTypesMatching: nm,
    grammarNodeTypesMatchingCount: nm.length,
    corpusNodeTypesMatching: typesMatching.sort(),
    corpusNodeOccurrencesMatching: occurrences,
    keySites: k.sites,
    stringValueSites: k.stringSites,
    referentSites: k.referentSites,
    keyExamples: k.examples,
  }
}

const report = {
  command: `npx tsx validation/m14/fixtures/toml/tools/construct-census.ts${LIMIT ? ` (BB_TOML_CENSUS_LIMIT=${LIMIT})` : ""}`,
  population: { parsed, failed, walked: files.length, admitted: total, repos, wholeCorpus: LIMIT === 0, corpusRoot: CR, extension: "toml" },
  positiveControl: controlFired,
  vocabularyControl: { containsNodeTypes: containsNodes, plantedKeywords: keywordControl },
  constructs: {
    tableHeaders: corpus.tableHeaders ?? 0, pairs: corpus.pairs ?? 0, inlineTables: corpus.inlineTables ?? 0,
    dottedKeys: corpus.dottedKeys ?? 0, arrays: corpus.arrays ?? 0, callShaped: corpus.callShaped ?? 0,
    distinctNodeTypes: corpus.nodeTypes.size,
  },
  duplicateKeys: dupKeys,
  workspaceInheritance: {
    ...workspaceInheritance,
    shape: "a pair whose leaf is `workspace` and whose value is the boolean true (`x.workspace = true`)",
    status: "OPEN — the analyzer's alias pass does not walk this shape, so these sites emit no `references` edge",
  },
  extended: {
    rule: "one DECISIVE counter per extended value with its measured NEAR MISS beside it; the difference between the two counts IS the ruling. For `extends`, the fleet's contract needs a supertype, so the candidate shape is measured two ways: whether the named target is an ADMITTED document project-wide, and whether it is a PATH or a bare module-like name.",
    corpusRoot: CR,
    extendsReTest: EXT.inheritance,
    includeKeys: EXT.includeKeys,
    fileNamingKeys: EXT.fileNamingKeys,
    decorator: EXT.decorator,
    template: EXT.template,
    componentListTables: EXT.componentListTables,
    mixinDecisive: EXT.mixin,
    nonLiteralValues: EXT.nonLiteralValues,
    includeDirectiveProduction: {
      grammarNodeTypesMatching: includeDirectiveNodeTypes,
      grammarNodeTypesMatchingCount: includeDirectiveNodeTypes.length,
      corpusNodeOccurrencesMatching: includeDirectiveCorpusOccurrences,
    },
    control: extControlFired,
  },
  relationshipTypes: rows,
  vocabulary: {
    grammar: {
      slots: grammarNames.length, distinct: grammarDistinct.length,
      namedSlots: grammarNamedSlots.length, namedDistinct: grammarNamedDistinct.length,
      namedDuplicateSlots: grammarNamedSlots.length - grammarNamedDistinct.length,
      names: grammarDistinct, namedNames: grammarNamedDistinct,
    },
    corpus: {
      distinct: corpus.nodeTypes.size,
      names: [...corpus.nodeTypes].sort(),
      notInGrammarPin: [...corpus.nodeTypes].filter((n) => !grammarDistinct.includes(n)).sort(),
    },
    perType: vocabReport,
  },
  fired: rows.filter((r) => r.edges > 0).map((r) => r.type),
  silent: rows.filter((r) => r.edges === 0).map((r) => r.type),
}

if (JSON_OUT) console.log(JSON.stringify(report, null, 2))
else {
  const P = report.population
  console.log(`toml construct census — ${P.wholeCorpus ? "WHOLE ADMITTED POPULATION" : `bounded draw of ${LIMIT}`}`)
  console.log(`population: ${P.parsed} parsed of ${P.walked} walked (corpus admits ${P.admitted} .toml files across ${P.repos} repos)   failures ${P.failed}`)
  console.log(`POSITIVE CONTROL (planted, parsed with the same grammar): ${JSON.stringify(controlFired)}`)
  console.log(`VOCABULARY CONTROL: containment node types [${containsNodes.join(", ")}] · planted keywords ${JSON.stringify(keywordControl)}`)
  console.log(``)
  console.log(`CONSTRUCTS ON THE TREE`)
  for (const [k, v] of Object.entries(report.constructs)) console.log(`  ${k.padEnd(20)} ${v}`)
  console.log(`  duplicate keys: ${dupKeys.keys} key path(s) declared twice across ${dupKeys.documents} document(s)`)
  for (const x of dupKeys.examples) console.log(`    ${x}`)
  console.log(`  workspace inheritance (OPEN, unimplemented): ${workspaceInheritance.sites} site(s) in ${workspaceInheritance.documents} document(s) — ${report.workspaceInheritance.shape}`)
  console.log(``)
  const X = report.extended
  console.log(`EXTENDED COUNTERS — decisive construct beside its measured near miss`)
  console.log(`  extends re-test    inheritance-shaped keys ${X.extendsReTest.sites} site(s) in ${X.extendsReTest.files} file(s); string-valued ${X.extendsReTest.stringSites}; path-shaped ${X.extendsReTest.pathShaped}; bare module-like ${X.extendsReTest.bare}`)
  console.log(`                     of the path-shaped: ${X.extendsReTest.namesAdmittedToml} name an ADMITTED .toml document, ${X.extendsReTest.namesExistingOnDisk} name a non-admitted existing file`)
  for (const e of X.extendsReTest.examples) console.log(`                       ${e}`)
  for (const e of X.extendsReTest.admittedExamples) console.log(`                     ADMITTED  ${e}`)
  console.log(`  part_of            decisive: include-directive productions ${X.includeDirectiveProduction.grammarNodeTypesMatchingCount} in the pinned grammar, ${X.includeDirectiveProduction.corpusNodeOccurrencesMatching} corpus node occurrence(s)`)
  console.log(`                     near miss: file-naming keys ${X.fileNamingKeys.sites} site(s) in ${X.fileNamingKeys.files} file(s), ${X.fileNamingKeys.rootPosition} at document root, ${X.fileNamingKeys.namesAdmittedToml} naming an ADMITTED .toml; include-shaped keys ${X.includeKeys.sites} in ${X.includeKeys.files} file(s)`)
  console.log(`  decorates          decisive: decorator-shaped key whose value is an applied call ${X.decorator.appliedCallSites}; near miss: decorator-shaped keys ${X.decorator.sites} in ${X.decorator.files} file(s), of which a NAME/pointer ${X.decorator.pointerSites}; call-shaped text values ${X.decorator.callShapedTextSites}; non-literal values in the whole corpus ${X.nonLiteralValues}`)
  console.log(`  renders            decisive: template tokens OUTSIDE every string/comment that NO ERROR encloses ${X.template.outsideNoErrorAncestor} (of ${X.template.outsideBoth} outside at all, ${X.template.outsideWithErrorAncestor} inside an ERROR region ${JSON.stringify(X.template.outsideByType)}); near miss: inside a lexed string ${X.template.inString} (comments ${X.template.inComment}) over ${X.template.files} file(s)`)
  for (const e of X.template.outsideExamples) console.log(`                       ${e}`)
  console.log(`  mixes_in           decisive: tables carrying a component list AND a separately named base ${X.mixinDecisive.tablesWithBoth}; near miss: tables carrying a component list ${X.componentListTables.tables} in ${X.componentListTables.files} file(s)`)
  console.log(``)
  console.log(`RELATIONSHIP TYPES (production path)`)
  for (const r of rows) console.log(`  ${r.type.padEnd(13)} edges ${String(r.edges).padStart(7)}  files ${String(r.files).padStart(4)}  distinct targets ${String(r.distinctTargets).padStart(5)}  ${r.markers.map(([m, n]) => `${m}:${n}`).join(" ")}`)
  console.log(``)
  const G = report.vocabulary.grammar
  console.log(`VOCABULARY INVENTORY — pinned grammar ${G.slots} node-type slots (${G.namedSlots} named, ${G.namedDistinct} distinct named names, ${G.namedDuplicateSlots} duplicate named slot(s)); ${G.distinct} distinct names overall`)
  console.log(`  corpus union: ${corpus.nodeTypes.size} distinct node types; not in the grammar pin: ${report.vocabulary.corpus.notInGrammarPin.join(", ") || "none"}`)
  for (const t of Object.keys(VOCAB)) {
    const v = vocabReport[t]
    console.log(`  ${t.padEnd(13)} grammar node types ${String(v.grammarNodeTypesMatchingCount).padStart(2)}  corpus node occurrences ${String(v.corpusNodeOccurrencesMatching).padStart(6)}  key sites ${String(v.keySites).padStart(5)} (string-valued ${v.stringValueSites}, naming a declaration this document makes ${v.referentSites})`)
  }
  console.log(``)
  console.log(`FIRED: ${report.fired.join(" ")}`)
  console.log(`SILENT: ${report.silent.join(" ")}`)
}
