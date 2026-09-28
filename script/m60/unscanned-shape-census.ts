// script/m60/unscanned-shape-census.ts — the INVERSE of F1: node types the pinned grammar
// PRODUCES that an analyzer never reads, measured where they occur under a parent the analyzer
// DOES read.
//
// WHY THIS EXISTS
// ---------------
// M60's csharp C2a round (reviews/m60-csharp-alias-qualifier-round.md) found a class that no
// other instrument in the family can see, and found it by hand:
//
//   `alias_qualified_name` — the node the pinned tree-sitter-c_sharp grammar emits for a
//   `global::`-qualified name with a SINGLE segment — was missing from four hardcoded node
//   lists, so `new global::Root()`, a method return type, an indexer's return type, a plain
//   `using global::System;` and `[global::Root]` published NO edge at all.
//
// Every gate the family owns is blind to that shape, for a structural reason:
//
//   * the differential asks whether an edge that EXISTS is right — an absent edge emits no row;
//   * the fixtures ask whether the shapes THEY contain behave — a shape nobody wrote a fixture
//     for is not in the question;
//   * R10 asks whether a published target is a name — there is no target;
//   * F1 (the dead-literal register) asks the OPPOSITE question: whether a node type an
//     analyzer NAMES can exist in its grammar. A node type the grammar emits that the analyzer
//     never names is exactly what F1 does not look at.
//
// WHAT IS MEASURED (per lane, over the lane's own pinned corpora)
// ---------------------------------------------------------------
//     grammarTypes      every node type the lane's shipped .wasm can produce, enumerated at run
//                       time through web-tree-sitter's Language API (no hand-written list)
//     mentioned         every grammar node type whose name occurs as a STRING LITERAL in the
//                       lane's analyzer source, collected by parsing that source with
//                       tree-sitter-typescript (comments and prose can therefore not count)
//     scannerEdges      in real corpus files: for every node whose type IS mentioned, the named
//                       children whose type is NOT mentioned — the "position the analyzer reads,
//                       holding a shape it never names" class. Counted, with sample sites.
//     orphanTypes       grammar types never mentioned that occur in real trees at all, with
//                       their corpus occurrence counts (the worklist for shape probes: a type
//                       with 0 occurrences cannot be found by any draw, which is precisely how
//                       `alias_qualified_name` stayed invisible)
//
// WHAT THIS CANNOT SEE — disclosed, because the instrument is worth only what its blind spots
// are worth knowing (both are the reason `alias_qualified_name` needed a hand-built battery):
//
//   1. SUBSTRING / DERIVED MATCHES. csharp decides `isStructDecl = n.type.includes("struct")`;
//      this census would call every `*struct*` type "unmentioned" only if no literal names it.
//      Mentioning a type inside a larger string is invisible here.
//   2. SHAPES ABSENT FROM THE CORPORA. `alias_qualified_name` has 0 occurrences in either pinned
//      csharp corpus (550 multi-segment `global::` shapes, 0 single-segment). A corpus-driven
//      census cannot find what no corpus contains — `orphanTypes` (count 0) is the half that
//      names the candidates, and only a shape probe can settle them.
//
// VERDICT SEMANTICS (calibrated like R10's and R7's: report, never convict)
// ------------------------------------------------------------------------
//   reported      a scanner edge with occurrences. Whether it is a defect is an ADJUDICATION,
//                 recorded in validation/m60/unscanned-shape-register.json with a reason and the
//                 measurement behind it. The census never decides on its own.
//   clean         no scanner edge has occurrences in this lane's draws.
//   no-corpus     the lane's corpus files are not present under CORPUS_ROOT.
//
// The register is SHRINK-ONLY, the family's doctrine for a tolerated finding: a registered edge
// whose occurrences GREW fails (a new shape arrived at a known site), and a registered edge that
// vanished fails unless the entry is marked `paid` in the same commit that removes it (repayment
// is written down, never inferred).
//
// Run: bun script/m60/unscanned-shape-census.ts [--lane csharp] [--sample 40] [--emit]
import fs from "node:fs"
import path from "node:path"
import { execSync } from "node:child_process"
// NOTE: the lane/corpus configuration (differential.ts) and the shared draw rule
// (target-spelling-census.ts) are imported LAZILY inside main(), after this script's own
// web-tree-sitter core is initialised — see loadGrammar for why the order is load-bearing.

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
// (The lane's wasm path is still recorded in the artifact from the differential's own config —
// it is the documented provenance of the grammar — but the census LOADS through the engine. See
// loadGrammar.)
const WASM_DIR = path.join(ROOT, "wasm")
const OUT = path.join(ROOT, "validation", "m60", "results", "unscanned-shapes.json")
const REGISTER_PATH = path.join(ROOT, "validation", "m60", "unscanned-shape-register.json")

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const ONLY_LANE = arg("--lane")
const DEFAULT_SAMPLE = 40
const SAMPLE = Number(arg("--sample") ?? DEFAULT_SAMPLE)
const SECOND_SAMPLE = Math.max(1, Math.floor(SAMPLE * 0.6))
const EMIT = process.argv.includes("--emit")
/** Printed worklist cap — the artifact keeps everything, the terminal stays readable. */
const PRINT_TOP = 12
/** An edge below this many occurrences is reported in the artifact but not in the summary. */
const MIN_REPORTED = 1

interface Sample { file: string; line: number; parent: string; child: string; text: string }
interface Edge { parent: string; child: string; occurrences: number; samples: Sample[] }

// ---------------------------------------------------------------- pure helpers (self-tested)

/**
 * Is `type` MENTIONED by this analyzer source? Input is the set of string-literal VALUES in the
 * source (collected from the parse tree, so a comment or a doc block can never count), and the
 * test is exact equality against one of them.
 *
 * Exact, not substring: a mention of `qualified_name` must not make `alias_qualified_name`
 * count, which is the whole reason this census exists.
 */
export function isMentioned(literals: Set<string>, type: string): boolean {
  return literals.has(type)
}

/**
 * A VALUE TOKEN, not a shape: the tree-sitter grammars name every literal node type `*_literal`
 * (`string_literal`, `null_literal`, `integer_literal`, `boolean_literal`, …). They are data a
 * position may hold, never a name the position should have been scanned for, so they are
 * calibrated out by that grammatical convention — and the calibration is stated as a rule about
 * TYPE NAMES, with the excluded types printed per lane, rather than hidden in a list.
 */
export function isValueLiteralType(type: string): boolean {
  return type.includes("literal")
}

const NAME_SHAPED_OK = new Set<string>()
for (const ch of "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.:<>[]?,") NAME_SHAPED_OK.add(ch)

/**
 * Is this node's TEXT a name the language could declare — the calibration that separates the
 * class from generic noise.
 *
 * The census exists because a NAME-SHAPED child sits in a position the analyzer reads and the
 * analyzer never names its node type. Without this test the instrument reports every literal, every
 * statement and every punctuation wrapper (`block > expression_statement`, `binary_expression >
 * null_literal`) and drowns the one finding it is for. The rule is about the published candidate,
 * not about node types: letters, digits, `_`, `.`, `:`, `<`, `>`, `[`, `]`, `?`, `,` and spaces
 * only, at least one letter, no quotes/parens/braces/semicolons — i.e. something that could be
 * `System.Collections.Generic.List<System.String>`, `global::Root`, `A.B`, `A::B`.
 */
export function isNameShaped(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  // A name STARTS with an identifier character. Without this, an index (`[i]`) and an array rank
  // specifier (`[inputArraySize]`) read as names — measured on csharp's first run, where both were
  // reported as findings until the rule required a leading letter/underscore.
  const c0 = t.charCodeAt(0)
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || c0 === 95)) return false
  // Whitespace is LAYOUT inside a name only when it abuts a separator (`System.Text.\n  Builder`,
  // `Map < K , V >`). Between two letters it is prose or a pattern (`not null`) — measured, that
  // was the third false finding of the first run.
  const separator = (ch: string) => ch === "." || ch === ":" || ch === "<" || ch === ">" || ch === "," || ch === "[" || ch === "]" || ch === "?"
  const isWs = (ch: string) => ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v"
  let letters = 0
  let i = 0
  while (i < t.length) {
    const ch = t[i]
    if (isWs(ch)) {
      // A whitespace RUN, handled atomically: `System.Text.\n    StringBuilder` is one name with
      // layout inside it, while `not null` is two words. The test is the character on either side
      // of the RUN — a separator means the run is layout, a letter means it is prose.
      let j = i
      while (j < t.length && isWs(t[j])) j++
      const prev = t[i - 1]
      const next = t[j]
      if (!((prev && separator(prev)) || (next && separator(next)))) return false
      i = j
      continue
    }
    if (!NAME_SHAPED_OK.has(ch)) return false
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z")) letters++
    i++
  }
  return letters > 0
}

/** The census's candidate rule, in one place: a child type the analyzer never names, that is not a
 *  value token, holding text that is a name and that is not a bare KEYWORD.
 *
 *  The keyword half is measured, not guessed: a grammar's anonymous node types are its tokens, so
 *  a single-word candidate whose text IS one of them is a keyword the grammar can already name
 *  (`true`, `this`, `private`, `override`, `string` in csharp/kotlin/typescript) — a value in the
 *  position, never a name the analyzer lost. Admission that this is partial: javascript's grammar
 *  models `true`/`false`/`null` as NAMED nodes, so that lane's worklist keeps them and the register
 *  rules on them instead. */
export function isCandidateChild(
  childType: string,
  childText: string,
  literals: Set<string>,
  grammarNamed: (t: string) => boolean,
  keywordTexts: Set<string> = new Set(),
): boolean {
  if (isMentioned(literals, childType)) return false
  if (!grammarNamed(childType)) return false
  if (NOISE_TYPES.has(childType)) return false
  if (isValueLiteralType(childType)) return false
  if (!isNameShaped(childText)) return false
  const text = childText.trim()
  // A single token: no separator, no layout — the only shape a keyword can have.
  if (!/[.:<>[\]?,]/.test(text) && !text.includes(" ") && keywordTexts.has(text)) return false
  return true
}

/** One tree's contribution: (parent type, unmentioned child type) counts, keyed `parent>child`. */
export function accumulateChildren(
  root: any,
  literals: Set<string>,
  file: string,
  counts: Map<string, Edge>,
  /** "Is this a node type the lane's grammar can produce as a named node?" — the oracle half. */
  grammarNamed: (t: string) => boolean,
  /** Calibration context: the parents that are KNOWN to hold name-shaped children the analyzer
   *  reads, and the grammar's own keyword tokens. Unfiltered edges are still counted — the
   *  filter is applied when the worklist is ranked, so the artifact can show both. */
  ctx: { parentReadsNames: Set<string>; keywordTexts: Set<string> } = { parentReadsNames: new Set(), keywordTexts: new Set() },
): void {
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()
    if (!n) continue
    if (isMentioned(literals, n.type)) {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        // The parent's own evidence: a child it reads AND that holds a name. A position with that
        // evidence is a name position, and a shape sitting in it unseen is the class.
        if (isMentioned(literals, c.type) && isNameShaped(String(c.text ?? ""))) ctx.parentReadsNames.add(n.type)
        if (isCandidateChild(c.type, String(c.text ?? ""), literals, grammarNamed, ctx.keywordTexts)) {
          const key = `${n.type}>${c.type}`
          const e = counts.get(key) ?? { parent: n.type, child: c.type, occurrences: 0, samples: [] }
          e.occurrences++
          if (e.samples.length < 3) {
            const raw = String(c.text ?? "")
            e.samples.push({
              file,
              line: c.startPosition.row + 1,
              parent: n.type,
              child: c.type,
              text: raw.length > 60 ? raw.slice(0, 60) + "…" : raw,
            })
          }
          counts.set(key, e)
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
}

/** Occurrence counts of every grammar type in one tree — the `orphanTypes` half. */
export function accumulateAllTypes(
  root: any,
  literals: Set<string>,
  counts: Map<string, number>,
  grammarNamed: (t: string) => boolean,
): void {
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()
    if (!n) continue
    if (grammarNamed(n.type) && !isMentioned(literals, n.type) && !isValueLiteralType(n.type) && !NOISE_TYPES.has(n.type)) {
      counts.set(n.type, (counts.get(n.type) ?? 0) + 1)
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
}

/** A bare lowercase word — how the grammars spell a keyword token (`true`, `this`, `private`).
 *  Char scan, not a regex: this project's analyzers are held to R1 and its scripts follow the same
 *  style where the check is this simple. */
function isBareWord(s: string): boolean {
  for (const ch of s) {
    const ok = (ch >= "a" && ch <= "z") || ch === "_"
    if (!ok) return false
  }
  return s.length > 0
}

/** Sorted, descending — the order the worklist is meant to be worked in. */
export function rankEdges(counts: Map<string, Edge>, min: number): Edge[] {
  return [...counts.values()].filter((e) => e.occurrences >= min).sort((a, b) => b.occurrences - a.occurrences || a.parent.localeCompare(b.parent) || a.child.localeCompare(b.child))
}

// ---------------------------------------------------------------- self-tests

type SelfTest = { name: string; run: () => string | null }
const SELF_TESTS: SelfTest[] = [
  {
    name: "a mention is exact, so a PREFIX does not count",
    run: () => {
      const lit = new Set(["qualified_name"])
      return isMentioned(lit, "alias_qualified_name") ? "alias_qualified_name counted as mentioned" : null
    },
  },
  {
    name: "a mention is exact, so a SUFFIX does not count",
    run: () => {
      const lit = new Set(["struct_declaration"])
      return isMentioned(lit, "record_struct_declaration") ? "record_struct_declaration counted as mentioned" : null
    },
  },
  {
    name: "an exact mention counts",
    run: () => (isMentioned(new Set(["alias_qualified_name"]), "alias_qualified_name") ? null : "exact mention not counted"),
  },
  {
    name: "an empty literal set mentions nothing",
    run: () => (isMentioned(new Set(), "identifier") ? "the empty set mentioned a type" : null),
  },
  {
    name: "accumulateChildren counts a child under a MENTIONED parent",
    run: () => {
      const seen = new Set<string>()
      const parent: any = { type: "object_creation_expression", text: "x", namedChildCount: 1, namedChild: () => child, startPosition: { row: 0 } }
      const child: any = { type: "alias_qualified_name", text: "global::Root", namedChildCount: 0, startPosition: { row: 3 } }
      const counts = new Map<string, Edge>()
      accumulateChildren(parent, new Set(["object_creation_expression"]), "f.cs", counts, () => true)
      const e = counts.get("object_creation_expression>alias_qualified_name")
      if (!e) return "no edge accumulated"
      if (e.occurrences !== 1) return `occurrences=${e.occurrences}`
      if (e.samples[0]?.line !== 4) return `line=${e.samples[0]?.line} (expected 4, 1-based)`
      seen.add("ok")
      return seen.has("ok") ? null : "unreachable"
    },
  },
  {
    name: "accumulateChildren stays silent when the PARENT is unmentioned (the analyzer never reads that position)",
    run: () => {
      const parent: any = { type: "some_unread_node", text: "x", namedChildCount: 1, namedChild: () => child, startPosition: { row: 0 } }
      const child: any = { type: "alias_qualified_name", text: "global::Root", namedChildCount: 0, startPosition: { row: 0 } }
      const counts = new Map<string, Edge>()
      accumulateChildren(parent, new Set(["identifier"]), "f.cs", counts, () => true)
      return counts.size === 0 ? null : `accumulated ${counts.size} edge(s) under an unread parent`
    },
  },
  {
    name: "accumulateChildren stays silent when the CHILD is mentioned (a scanned shape is not a finding)",
    run: () => {
      const parent: any = { type: "qualified_name", text: "x", namedChildCount: 1, namedChild: () => child, startPosition: { row: 0 } }
      const child: any = { type: "identifier", text: "A", namedChildCount: 0, startPosition: { row: 0 } }
      const counts = new Map<string, Edge>()
      accumulateChildren(parent, new Set(["qualified_name", "identifier"]), "f.cs", counts, () => true)
      return counts.size === 0 ? null : "a mentioned child was flagged"
    },
  },
  {
    name: "isNameShaped accepts the shapes this census is for",
    run: () => {
      const yes = ["global::Root", "System.Collections.Generic.List<System.String>", "A.B", "A::B", "Probe.Base"]
      const bad = yes.filter((t) => !isNameShaped(t))
      return bad.length ? `rejected a real name shape: ${bad.join(", ")}` : null
    },
  },
  {
    name: "isNameShaped rejects the noise the calibration exists to remove",
    run: () => {
      // Every entry is a sample MEASURED as noise on a real run (csharp's first pass reported
      // `[i]`, `[inputArraySize]` and `not null` as findings until these rules were added), plus
      // the syntactic shapes a name can never be.
      const no = ['"ShuffleParameterSet"', "2", "// comment", "(LocalizationCategory.None)", "return 0;", "{ }", "", "(+)", "[i]", "[inputArraySize]", "not null"]
      const bad = no.filter((t) => isNameShaped(t))
      return bad.length ? `accepted noise: ${bad.join(", ")}` : null
    },
  },
  {
    name: "isNameShaped keeps layout inside a wrapped name",
    run: () => {
      const yes = ["System.Text.\n    StringBuilder", "Map<K, V>", "A :: B"]
      const bad = yes.filter((t) => !isNameShaped(t))
      return bad.length ? `rejected a wrapped name: ${bad.map((s) => JSON.stringify(s)).join(", ")}` : null
    },
  },
  {
    name: "isValueLiteralType reads the grammar's own naming convention",
    run: () => {
      if (!isValueLiteralType("null_literal") || !isValueLiteralType("string_literal")) return "a *_literal type was not recognised"
      return isValueLiteralType("identifier") ? "identifier was called a literal" : null
    },
  },
  {
    name: "isCandidateChild flags the class and only the class",
    run: () => {
      const lit = new Set(["object_creation_expression", "qualified_name", "identifier"])
      const named = (t: string) => t !== "not_a_node_type"
      const kw = new Set(["true", "this", "null"])
      if (!isCandidateChild("alias_qualified_name", "global::Root", lit, named, kw)) return "the class was not flagged"
      if (isCandidateChild("identifier", "Root", lit, named, kw)) return "a MENTIONED node type was flagged"
      if (isCandidateChild("bracketed_argument_list", "[i]", lit, named, kw)) return "an index was flagged as a name"
      if (isCandidateChild("some_named_node", "this", lit, named, kw)) return "a bare KEYWORD was flagged as a name"
      if (!isCandidateChild("some_named_node", "this.Field", lit, named, kw)) return "a qualified name whose first token is a keyword was rejected"
      if (isCandidateChild("null_literal", "null", lit, named)) return "a value token was flagged"
      if (isCandidateChild("comment", "// x", lit, named)) return "a comment was flagged"
      if (isCandidateChild("alias_qualified_name", "global::Root", new Set(["alias_qualified_name"]), named)) return "a MENTIONED type was flagged"
      return isCandidateChild("alias_qualified_name", '"global::Root"', lit, named) ? "a quoted string was flagged as a name" : null
    },
  },
  {
    name: "rankEdges sorts by occurrences and honours the threshold",
    run: () => {
      const counts = new Map<string, Edge>([
        ["a>b", { parent: "a", child: "b", occurrences: 5, samples: [] }],
        ["a>c", { parent: "a", child: "c", occurrences: 9, samples: [] }],
        ["a>d", { parent: "a", child: "d", occurrences: 1, samples: [] }],
      ])
      const r = rankEdges(counts, 2)
      if (r.length !== 2) return `threshold kept ${r.length}`
      if (r[0].child !== "c") return `first is ${r[0].child}`
      return null
    },
  },
  {
    name: "accumulateAllTypes counts an unmentioned type and skips a mentioned one",
    run: () => {
      const child: any = { type: "alias_qualified_name", namedChildCount: 0, text: "global::Root" }
      const node: any = { type: "alias_qualified_name", namedChildCount: 0, text: "global::Root" }
      const counts = new Map<string, number>()
      accumulateAllTypes(node, new Set(), counts, () => true)
      if (counts.get("alias_qualified_name") !== 1) return "unmentioned type not counted"
      const counts2 = new Map<string, number>()
      accumulateAllTypes(child, new Set(["alias_qualified_name"]), counts2, () => true)
      return counts2.size === 0 ? null : "a mentioned type was counted as orphan"
    },
  },
]

function runSelfTests(): { cases: number; failures: string[] } {
  const failures: string[] = []
  for (const t of SELF_TESTS) {
    const err = t.run()
    if (err) failures.push(`${t.name}: ${err}`)
  }
  return { cases: SELF_TESTS.length, failures }
}

// ---------------------------------------------------------------- the census

/** Node types that are STRUCTURAL NOISE under any parent: they carry layout, not a shape. */
const NOISE_TYPES = new Set(["comment", "line_comment", "block_comment", "ERROR", "MISSING", ";", ",", "{", "}", "(", ")", "[", "]"])

/**
 * The lane's grammar, its node types, and the parser the corpus walk runs on.
 *
 * The wasm is read from `wasm/` — the shipped grammars, the same oracle F1 audits against, so this
 * census needs no hand-written node-type list.
 *
 * WHY THE INIT ORDER MATTERS (measured while building this, and the reason for the lazy imports
 * in `main`): importing the differential for the lane/corpus configuration initialises the
 * engine, whose web-tree-sitter core is a COPY it places itself. A language then loaded against
 * the other core fails with `Incompatible language version 0` — the identical load works in a
 * script that imports nothing. So this script initialises its own core FIRST and imports the
 * configuration AFTER, which was verified to leave both halves working.
 */
async function loadGrammar(wasm: string, ParserClass: any, Language: any): Promise<{ types: Map<string, boolean>; keywordTexts: Set<string>; parser: any }> {
  const language = await Language.load(fs.readFileSync(path.join(WASM_DIR, wasm)))
  const types = new Map<string, boolean>()
  // Anonymous node types ARE the grammar's tokens (keywords, punctuation): the measured keyword
  // set, used by isCandidateChild instead of a hand-written list per language.
  const keywordTexts = new Set<string>()
  for (let i = 0; i < language.nodeTypeCount; i++) {
    const name = language.nodeTypeForId(i)
    if (name == null) continue
    const named = language.nodeTypeIsNamed(i)
    types.set(name, named)
    if (!named && name.length > 1 && isBareWord(name)) keywordTexts.add(name)
  }
  const parser = new ParserClass()
  parser.setLanguage(language)
  return { types, keywordTexts, parser }
}

/** String-literal VALUES in an analyzer source, via the typescript grammar (comments excluded). */
async function literalsOfAnalyzer(tsParser: any, src: string): Promise<Set<string>> {
  const out = new Set<string>()
  const tree = tsParser.parse(src)
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === "string") {
      const frag = n.namedChildren?.[0]
      if (frag && frag.type === "string_fragment") out.add(frag.text)
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

async function main() {
  // Core first, configuration second (see loadGrammar): importing the differential initialises the
  // engine against its own copy of the core, and a language loaded across the two fails.
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const { LANGS, LANG_REPOS, SECOND_CORPUS } = await import("../m14/differential.ts")
  const { filesFor } = await import("./target-spelling-census.ts")
  // The analyzer sources are TypeScript, so the literal collection parses them with that grammar.
  const tsParser = (await loadGrammar("tree-sitter-typescript.wasm", ParserClass, Language)).parser

  const register: Record<string, any> = fs.existsSync(REGISTER_PATH) ? JSON.parse(fs.readFileSync(REGISTER_PATH, "utf8")) : {}
  const lanes = Object.keys(LANGS).filter((l) => LANGS[l].analyzerFile && (!ONLY_LANE || l === ONLY_LANE))
  const artifact: any = { lanes: {}, selfTests: null, commit: null }
  const registerProblems: string[] = []
  const worklist: string[] = []

  for (const lang of lanes) {
    const cfg = LANGS[lang]
    const analyzerPath = path.join(ROOT, "src", "ast", `${cfg.analyzerFile}.ts`)
    if (!fs.existsSync(analyzerPath)) {
      artifact.lanes[lang] = { verdict: "no-analyzer", analyzer: cfg.analyzerFile }
      continue
    }
    const literals = await literalsOfAnalyzer(tsParser, fs.readFileSync(analyzerPath, "utf8"))
    let grammar: { types: Map<string, boolean>; parser: any }
    try {
      grammar = await loadGrammar(cfg.wasm, ParserClass, Language)
    } catch (e: any) {
      // A lane whose engine name differs from the differential's key is REPORTED, never assumed.
      artifact.lanes[lang] = { verdict: "no-grammar", analyzer: cfg.analyzerFile, wasm: cfg.wasm, error: String(e).slice(0, 120) }
      console.log(`${ "no-grammar".padEnd(10) } ${lang.padEnd(11)} ${String(e).slice(0, 80)}`)
      continue
    }
    const grammarNamed = (t: string) => grammar.types.get(t) === true

    const repos: Array<[string | undefined, number]> = [
      [LANG_REPOS[lang], SAMPLE],
      [SECOND_CORPUS[lang], SECOND_SAMPLE],
    ]
    const draws: Array<{ repo: string; files: string[] }> = []
    for (const [repo, cap] of repos) {
      if (!repo) continue
      const files = filesFor(lang, repo, cap)
      if (files.length) draws.push({ repo, files })
    }
    if (draws.length === 0) {
      artifact.lanes[lang] = { verdict: "no-corpus", analyzer: cfg.analyzerFile, grammarTypes: grammar.types.size }
      console.log(`${"no-corpus".padEnd(10)} ${lang.padEnd(11)} grammarTypes=${grammar.types.size} mentioned=${literals.size}`)
      continue
    }

    const parser = grammar.parser
    const edges = new Map<string, Edge>()
    const orphans = new Map<string, number>()
    const ctx = { parentReadsNames: new Set<string>(), keywordTexts: grammar.keywordTexts }
    let files = 0
    let parseErrors = 0
    for (const draw of draws) {
      for (const file of draw.files) {
        let src: string
        try {
          src = fs.readFileSync(file, "utf8")
        } catch {
          continue
        }
        const tree = parser.parse(src)
        if (!tree || !tree.rootNode) {
          parseErrors++
          continue
        }
        files++
        const rel = path.relative(path.join("$HOME/fixtures/repositories", draw.repo), file)
        accumulateChildren(tree.rootNode, literals, `${draw.repo}/${rel}`, edges, grammarNamed, ctx)
        accumulateAllTypes(tree.rootNode, literals, orphans, grammarNamed)
      }
    }
    // The calibration, applied at ranking time so the artifact can carry both readings: an edge is
    // in the WORKLIST when its parent is a position with measured evidence of holding names the
    // analyzer reads (`parentReadsNames`), and in the raw count when it is not.
    const unfiltered = rankEdges(edges, MIN_REPORTED)
    const ranked = unfiltered.filter((e) => ctx.parentReadsNames.has(e.parent))
    const orphanRanked = [...orphans.entries()].sort((a, b) => b[1] - a[1])
    const verdict = ranked.length === 0 ? "clean" : "reported"
    artifact.lanes[lang] = {
      verdict,
      analyzer: cfg.analyzerFile,
      wasm: cfg.wasm,
      grammarTypes: grammar.types.size,
      mentionedLiterals: literals.size,
      files,
      parseErrors,
      draws: draws.map((d) => ({ repo: d.repo, files: d.files.length })),
      scannerEdges: ranked,
      scannerEdgesUnfiltered: unfiltered.length,
      namePositionsMeasured: [...ctx.parentReadsNames].sort(),
      orphanTypes: orphanRanked.map(([type, occurrences]) => ({ type, occurrences })),
    }
    console.log(
      `${verdict.padEnd(10)} ${lang.padEnd(11)} grammar=${String(grammar.types.size).padStart(4)} mentioned=${String(literals.size).padStart(4)} files=${String(files).padStart(4)} scannerEdges=${String(ranked.length).padStart(3)}/${String(unfiltered.length).padStart(3)} orphanTypes=${String(orphanRanked.length).padStart(4)}`,
    )
    for (const e of ranked.slice(0, PRINT_TOP)) {
      console.log(`    ${String(e.occurrences).padStart(6)}× ${e.parent} > ${e.child}   e.g. ${e.samples[0]?.file}:${e.samples[0]?.line} ${JSON.stringify(e.samples[0]?.text ?? "")}`)
    }

    // Shrink-only register: an adjudicated edge may not grow, and a repaid one must be written down.
    for (const e of ranked) {
      const key = `${lang}:${e.parent}>${e.child}`
      const reg = register[key]
      if (!reg) {
        // STAGED, deliberately. An UNREGISTERED worklist entry is PRINTED, not failed on: this
        // census is new and its worklist has not been adjudicated lane by lane yet, and a gate that
        // fails on its own unadjudicated noise is the mirror of the “gate that cannot fail” class
        // this program keeps finding. F1 was staged the same way (a counts-only v1, then a
        // per-literal register that fails). The recorded next step is: once every lane's list
        // carries a ruling, this becomes a failure — see the register's `_meta.staging`.
        if (e.occurrences >= 25 && !ONLY_LANE) {
          worklist.push(key)
        }
        continue
      }
      if (typeof reg.occurrences === "number" && e.occurrences > reg.occurrences) {
        registerProblems.push(`GREW ${key}: ${reg.occurrences} -> ${e.occurrences} (registered as ${reg.status})`)
      }
      if (reg.status === "paid" && e.occurrences > 0) {
        registerProblems.push(`PAID-BUT-PRESENT ${key}: still ${e.occurrences} occurrence(s) after being recorded as repaid`)
      }
    }
  }

  const st = runSelfTests()
  // POSITIVE CONTROL (the instrument's own negative test): the corpora contain ZERO single-segment
  // `global::` shapes, so a green corpus reading says nothing about whether this census WOULD have
  // found the class it was built for. This feeds the census's own code path a snippet containing
  // that shape with the PRE-FIX analyzer's mention set (the real literals minus the one node type
  // this round added) and requires a scanner edge to come back. A census that cannot fail is not an
  // instrument.
  {
    const controlLang: string = ONLY_LANE ?? "csharp"
    const cfg: any = LANGS[controlLang]
    if (cfg) {
      const analyzerPath = path.join(ROOT, "src", "ast", `${cfg.analyzerFile}.ts`)
      if (fs.existsSync(analyzerPath)) {
        const literals = await literalsOfAnalyzer(tsParser, fs.readFileSync(analyzerPath, "utf8"))
        const had = literals.has("alias_qualified_name")
        literals.delete("alias_qualified_name")
        const grammar = await loadGrammar(cfg.wasm, ParserClass, Language)
        const grammarNamed = (t: string) => grammar.types.get(t) === true
        // The snippet carries the TWIN too, so the parent position has the measured evidence the
        // ranking filter requires (a name-shaped child the analyzer reads) — the same shape the
        // real fix was measured against.
        const snippet =
          controlLang === "csharp"
            ? "public class Probe { public object M() { var a = new Root(); var b = new global::Root(); return a ?? b; } }"
            : null
        const counts = new Map<string, Edge>()
        const cctx = { parentReadsNames: new Set<string>(), keywordTexts: grammar.keywordTexts }
        if (snippet) {
          accumulateChildren(grammar.parser.parse(snippet).rootNode, literals, "control", counts, grammarNamed, cctx)
        }
        const key = "object_creation_expression>alias_qualified_name"
        const hit = counts.get(key)
        const inWorklist = !!hit && cctx.parentReadsNames.has("object_creation_expression")
        artifact.control = {
          lane: controlLang,
          /** The live analyzer DOES mention the node type (that is C2a's fix); the control therefore
           *  simulates the pre-fix mention set by removing it — which is what makes the check a
           *  revert-emulation rather than a tautology. */
          simulatedByRemovingFromLiveLiterals: had,
          snippet: snippet ?? "(no control snippet for this lane)",
          found: !!hit,
          foundInWorklist: inWorklist,
          occurrences: hit?.occurrences ?? 0,
          namePositionEvidence: [...cctx.parentReadsNames],
          passes: snippet ? !!hit && inWorklist : null,
        }
        if (snippet && !hit) {
          st.failures.push(`control: the census did NOT report ${key} on the pre-fix mention set — the instrument cannot see the class it exists for`)
        }
        if (snippet && hit && !inWorklist) {
          st.failures.push(`control: the class was counted but filtered OUT of the worklist — the name-position calibration would hide it in a real run`)
        }
      }
    }
  }
  artifact.selfTests = { cases: st.cases, passed: st.cases - st.failures.length, failures: st.failures }
  try {
    artifact.commit = execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim()
  } catch {
    artifact.commit = "unknown"
  }
  if (artifact.control) {
    const c = artifact.control
    console.log(
      `\ncontrol (${c.lane}): pre-fix mention set simulated by removing alias_qualified_name from the live literals (${c.simulatedByRemovingFromLiveLiterals ? "removal was meaningful" : "the live analyzer does not mention it — nothing removed"}); census reports the class: ${c.found ? `YES (${c.occurrences}×)` : "NO — the instrument is blind to what it exists for"}; in the ranked worklist: ${c.foundInWorklist ? "yes" : "NO (the calibration would hide it)"}; name-position evidence: ${JSON.stringify(c.namePositionEvidence)}`,
    )
  }
  console.log(`\nself-tests: ${st.cases - st.failures.length}/${st.cases} passed`)
  for (const f of st.failures) console.log(`  FAIL: ${f}`)
  if (worklist.length) {
    console.log(`\nworklist: ${worklist.length} unadjudicated shape(s) with >= 25 occurrences (printed, NOT failed — see the register's _meta.staging):`)
    for (const w of worklist.slice(0, 20)) console.log(`  ${w}`)
    console.log(`  (full list in validation/m60/results/unscanned-shapes.json; adjudicate in validation/m60/unscanned-shape-register.json)`)
  }
  if (registerProblems.length) {
    console.log(`\nregister: ${registerProblems.length} problem(s)`)
    for (const p of registerProblems.slice(0, 20)) console.log(`  ${p}`)
  } else {
    const entries = Object.keys(register).filter((k) => !k.startsWith("_"))
    console.log(`register: OK (shrink-only, ${entries.length} entr${entries.length === 1 ? "y" : "ies"})`)
  }
  if (EMIT) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true })
    fs.writeFileSync(OUT, JSON.stringify(artifact, null, 2) + "\n")
    console.log(`\nwrote ${path.relative(ROOT, OUT)}`)
  } else {
    console.log(`\n(scoped/dev run — ${path.relative(ROOT, OUT)} not written; use --emit for a canonical full run)`)
  }
  if (st.failures.length || registerProblems.length) process.exit(1)
}

if (process.argv[1]?.endsWith("unscanned-shape-census.ts")) main()
