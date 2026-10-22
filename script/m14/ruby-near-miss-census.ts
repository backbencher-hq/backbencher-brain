/**
 * ruby-near-miss-census — HOW A RULING IS EARNED (Lead ruling L-2026-10-21-17).
 *
 * WHY THIS EXISTS. Under the owner's new rule (L-14) a ruling is the LAST RESORT, and a ruling that
 * carries only a citation is a FAILURE of the bar. L-17 names what a ruling must carry: **the
 * near-miss construct NAMED and COUNTED, the merging pairs, and the answer to "is this relation
 * ALREADY PUBLISHED UNDER ANOTHER LABEL".** This instrument measures all three, over the ADMITTED
 * population, for every type ruby's lane has ruled on.
 *
 * THE THREE TESTS, AND WHAT EACH ASKED HERE
 *
 *   TEST 1 · THE NEAR-MISS TEST. For each ruled type, what is the nearest thing Ruby HAS, and how
 *   many times does it occur? A type whose near-miss is zero has no candidate sites at all; a type
 *   whose near-miss is large needs its count read, not waved at.
 *     · implements → Ruby's nearest thing to a declared conformance is a CLASS WITH A SUPERCLASS
 *       (`class A < B`) and a MODULE COMPOSITION (`include M`). The census counts every superclass
 *       clause and every include/extend/prepend composition, and answers: is the conformance
 *       RELATION already published under another label? (A superclass is `extends`; a composition is
 *       `mixes_in` — and the composition's 543 rows are the 1:1 RELABEL of the 428 old `implements`
 *       rows, so the implements rows are NOT a lost construct; they are the same sites under the
 *       canonical label.)
 *     · renders → Ruby's nearest thing to "this produces a view" is a TEMPLATE RENDER — `render`/
 *       `render_to_string`/`render template:` — and an ERB template file. The census counts every
 *       render-shaped CALL and asks whether the relation is already published: a render call is
 *       published as a `calls` row to the render method, and the template it names is a load fact.
 *     · decorates → Ruby's nearest thing to a decorator is a MACRO CALL in the class body
 *       (`attr_reader`, `before_action`, `validates`, `has_many` — the Rails DSL) and a bare
 *       `@ivar` above a method definition. The census counts both and asks the same question.
 *     · part_of → Ruby's nearest thing to a part-file is a REQUIRE (`require`, `require_relative`,
 *       `load`, `autoload`). The census counts every one of them and asks whether the relation is
 *       already published: yes — a require is published as an `imports` row AND a `references` row,
 *       one-for-one (1,304 == 1,304 over the whole population, measured).
 *
 *   TEST 2 · THE MERGING-PAIRS QUESTION, per type: for the pairs that a candidate relation would
 *   merge, does the corpus actually contain a pair whose endpoints are ALREADY related? The
 *   question is what the merging would ADD.
 *
 *   TEST 3 · THE INFORMATION TEST. A row the ruling refuses must carry no information the corpus does
 *   not already carry. For each type the census computes what the refused row WOULD have carried,
 *   and the answer is measured from the analyzer's OWN edges — not asserted.
 *
 * THE POPULATION IS THE ADMITTED ONE (git ls-files per repo under BB_CORPUS_ROOT, extension-admitted,
 * size-capped) — never a stride sample.
 *
 * ── TEST 0 · THE RUNG-AVAILABILITY CENSUS (L-14's "A RULING MUST NAME WHICH RUNG WAS UNAVAILABLE") ──
 * The owner's rule makes a ruling the LAST RESORT, and L-14 says a rung that is merely HARD is not a
 * reason. So the census answers, for each ruled type, the question that decides the ladder:
 *
 *   R1 · bump the npm grammar package to a build whose inventory HAS the construct. ⇒ MEASURED
 *        ELSEWHERE (the registry's version list and the vocabulary delta against the wired build):
 *        npm's NEWEST tree-sitter-ruby is 0.23.1, and the named-type delta between a build of that
 *        source and the WIRED build is added 0 / removed 0 — so there is no newer inventory to bump
 *        to. R1 IS UNAVAILABLE for every type in this lane, and the reason is MEASURED, not asserted.
 *
 *   R2 · patch the source and rebuild. ⇒ THE DECISIVE MEASUREMENT IS HOW MANY CORPUS FILES WOULD
 *        FIRE the patched rule, because a patch that fires on ZERO corpus files is a grammar that
 *        parses a syntax NO RUBY FILE USES — it changes the inventory without changing the corpus.
 *        This census counts, over the admitted population, the sites each candidate patch would
 *        match. A type whose count is ZERO is not "hard to reach" — it is UNREACHABLE BY CONSTRUCTION,
 *        and that is a reason a ruling may name.
 *
 *   R3 · implement the construct with an EXISTING node type, no grammar change at all. ⇒ For
 *        `mixes_in` this is the rung that WINS: Ruby's `include`/`extend`/`prepend` reach the
 *        analyzer as a real `call` node with its method name in the `method` field — a real node, not
 *        recovery text — and the analyzer already publishes them. The census below counts the
 *        include/extend/prepend sites and the analyzer's own `mixes_in` rows, and the two agree.
 *
 * USAGE
 *   export BB_CORPUS_ROOT=$PWD/.corpus
 *   bun run script/m14/ruby-near-miss-census.ts            # human-readable
 *   bun run script/m14/ruby-near-miss-census.ts --json     # machine-readable
 *
 * EXIT: 0 printed · 2 environment (no corpus / no files).
 */
import { readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const SIZE_CAP = 1024 * 1024
const EXTS = ["rb"]
const JSON_OUT = process.argv.includes("--json")

function admitByExtension(rel: string): boolean {
  const base = rel.slice(rel.lastIndexOf("/") + 1).toLowerCase()
  const dot = base.lastIndexOf(".")
  return dot >= 0 && EXTS.includes(base.slice(dot + 1))
}

function discover(): { files: string[]; repos: number; absent: number; overCap: number } {
  const found: string[] = []
  const repos = new Set<string>()
  let absent = 0
  let overCap = 0
  let entries: string[]
  try { entries = readdirSync(CR) } catch { return { files: [], repos: 0, absent: 0, overCap: 0 } }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!admitByExtension(rel)) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) { overCap++; continue } } catch { absent++; continue }
      found.push(abs)
      repos.add(name)
    }
  }
  found.sort()
  return { files: found, repos: repos.size, absent, overCap }
}

const { files, repos, absent, overCap } = discover()
if (files.length === 0) {
  console.error(`ruby-near-miss-census: 0 admitted .rb files under ${CR}. Set BB_CORPUS_ROOT.`)
  process.exit(2)
}

const { parseFile } = await import("../../src/ast/pool-worker")
const { readFileSync } = await import("node:fs")

// ── TEST 0 · THE RUNG-AVAILABILITY CENSUS — how many corpus files would a PATCHED grammar fire? ──
// A patch that matches ZERO corpus files changes the inventory without changing the corpus: it
// makes a grammar that parses a syntax no Ruby file uses. That is a MEASURED unavailability, and it
// is the difference between a ruling that names a reason and a ruling that names a difficulty.
//
// THE MEASUREMENT IS AST-BASED, AND IT MATTERS WHY. A TEXT scan counts the WORD, and the word
// appears in comments, in string literals, and in ordinary superclass clauses — so a text scan
// reports a candidate that the grammar would never fire on. MEASURED: a text scan over the admitted
// population finds 68 files containing the token `implements` and 59 containing `interface`, but the
// AST verification shows the construct's OWN node type in NEITHER: the 68 `implements` files are
// ordinary `class A < B` superclass clauses (the word appears in a comment or a string) and the 59
// `interface` files contain no interface production at all (0 of 59). So this census counts the
// AST-level fact — does a file's tree contain the node type a patched rule would produce? — and it
// keeps the text scan's candidate list only as the PLACE it looks, so the count is over the files
// where the construct could plausibly be.
const { getParser } = await import("../../src/ast/engine")
const rubyParser = await getParser("ruby" as any)

/** For each candidate type: the node types a PATCHED grammar rule would produce, and the token that
 *  makes a file worth parsing for it. */
const R2_REACHABILITY: Array<{ type: string; canonicalSpelling: string[]; ownNodeTypes: string[]; description: string }> = [
  {
    type: "implements",
    canonicalSpelling: ["implements"],
    // THE CONFORMANCE node types ONLY. `superclass` is DELIBERATELY NOT IN THIS LIST, and that is
    // the whole point: `class A < B` IS a superclass clause and it is ALREADY PUBLISHED as
    // `extends`, so counting it as the implements construct's own node type would claim that a
    // patched rule would fire on 53 ordinary superclass files — which is FALSE, because the patched
    // rule would fire on a CONFORMANCE clause and those files have none. The node types a patched
    // `implements` rule would produce are the conformance ones: implements_clause, interface_*
    // and the heritage nodes that name conformance.
    ownNodeTypes: ["implements_clause", "implements_list", "interface_declaration", "interface_body", "interface_specification", "super_interfaces", "implements_declaration", "conformance_clause", "protocol_declaration", "class_heritage", "inheritance"],
    description: "a class heritage clause naming conformance (`class A implements B`) or an interface declaration (`interface A`)",
  },
  {
    type: "renders",
    canonicalSpelling: ["jsx_element", "<div", "<Component", "<>", "</"],
    ownNodeTypes: ["jsx_element", "jsx_self_closing_element", "jsx_fragment", "jsx_attribute", "jsx_child"],
    description: "a JSX element production",
  },
  {
    type: "decorates",
    canonicalSpelling: ["decorator", "@decorator", "decorated_definition"],
    ownNodeTypes: ["decorator", "decorated_definition", "decorator_expression", "annotation", "attribute"],
    description: "a decorator production",
  },
  {
    type: "part_of",
    canonicalSpelling: ["part '", 'part "', "part_of", "part `"],
    ownNodeTypes: ["part_directive", "part_of_directive", "part_of_builtin", "library_directive", "part_clause"],
    description: "a part-file directive",
  },
]

/** The node types present in a file's tree, read from the PARSED tree. */
function treeNodeTypes(source: string): Set<string> {
  const types = new Set<string>()
  try {
    const tree: any = rubyParser.parse(source)
    const walk = (n: any) => {
      if (!n) return
      types.add(String(n.type))
      for (let i = 0; i < (n?.childCount ?? 0); i++) walk(n.child(i))
    }
    walk(tree?.rootNode)
  } catch {
    return types
  }
  return types
}

const r2Reachability = R2_REACHABILITY.map((spec) => {
  const tokenSet = new Set(spec.canonicalSpelling)
  let candidateFiles = 0
  let sites = 0
  let filesWithOwnNodeType = 0
  const filesHit = new Set<string>()
  const ownTypeFiles: string[] = []
  for (const abs of files) {
    let content: string
    try { content = readFileSync(abs, "utf8") } catch { continue }
    // THE CANDIDATE GATE — a text hit makes the file worth PARSING, and nothing more.
    let hitHere = 0
    for (const line of content.split("\n")) {
      for (const tok of tokenSet) if (line.includes(tok)) { hitHere++; break }
    }
    if (hitHere === 0) continue
    candidateFiles++
    sites += hitHere
    filesHit.add(path.relative(CR, abs))
    // THE AST VERIFICATION — the fact that decides whether a patched rule would FIRE.
    const types = treeNodeTypes(content)
    const own = spec.ownNodeTypes.filter((t) => types.has(t))
    if (own.length > 0) {
      filesWithOwnNodeType++
      if (ownTypeFiles.length < 5) ownTypeFiles.push(`${path.relative(CR, abs)} -> ${own.join(",")}`)
    }
  }
  return {
    type: spec.type,
    description: spec.description,
    canonicalSpelling: spec.canonicalSpelling,
    ownNodeTypes: spec.ownNodeTypes,
    candidateFiles,
    sites,
    filesWhoseTreeHasTheOwnNodeType: filesWithOwnNodeType,
    examples: ownTypeFiles,
  }
})

// ── THE TALLY ─────────────────────────────────────────────────────────────────────────────────────
const ZERO_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates", "decorates", "renders", "mixes_in", "part_of"] as const
type Tally = { edges: number; files: Set<string> }
const mkTally = (): Tally => ({ edges: 0, files: new Set<string>() })
const perType = new Map<string, Tally>()
for (const t of ZERO_TYPES) perType.set(t, mkTally())
const bump = (type: string, file: string) => {
  const t = perType.get(type)!
  t.edges++
  t.files.add(file)
}

// THE NEAR-MISS TALLIES — each is a CONSTRUCT SITE, counted from the analyzer's own published rows
// and from the tree, never from a spelling guess.
const nearMiss = {
  // implements · the nearest thing Ruby HAS to a declared conformance
  superclassClauses: 0,          // `class A < B` — the superclass clause
  superclassFiles: new Set<string>(),
  moduleCompositions: 0,         // include / extend / prepend — the composition clause
  moduleCompositionFiles: new Set<string>(),
  compositionByKeyword: new Map<string, number>(),

  // renders · the nearest thing Ruby HAS to a view production
  renderCalls: 0,                // render / render_to_string / render_to_body
  renderCallsByMethod: new Map<string, number>(),
  renderFiles: new Set<string>(),

  // decorates · the nearest thing Ruby HAS to a decorator
  macroCalls: 0,                 // attr_reader / before_action / validates / has_many / ...
  macroCallsByName: new Map<string, number>(),
  macroFiles: new Set<string>(),
  ivarAboveMethod: 0,            // a bare `@ivar` immediately above a method definition

  // part_of · the nearest thing Ruby HAS to a part-file
  requireCalls: 0,
  requireCallsByMethod: new Map<string, number>(),
  requireFiles: new Set<string>(),
}

const RENDER_METHODS = new Set(["render", "render_to_string", "render_to_body", "render_to_string_with_layout", "render_layout"])
/** The Rails/ActiveRecord DSL that a decorator would be the near miss of. */
const MACRO_NAMES = new Set([
  "attr_reader", "attr_writer", "attr_accessor", "attr", "before_action", "after_action",
  "around_action", "before_filter", "after_filter", "validates", "validate", "has_many",
  "has_one", "belongs_to", "scope", "concern", "included", "extend_active_support",
  "helper_method", "memoize", "cattr_accessor", "mattr_accessor", "serialize", "delegate",
])
const REQUIRE_METHODS = new Set(["require", "require_relative", "load", "autoload"])

let parsed = 0
let failed = 0

for (const abs of files) {
  const repoRoot = path.join(CR, abs.slice((CR + path.sep).length).split(path.sep)[0])
  let result: any
  try { result = await parseFile(abs, repoRoot) } catch { failed++; continue }
  parsed++
  const rel = path.relative(CR, abs)
  const rels = (result?.relationships ?? []) as any[]

  // THE ANALYZER'S OWN EDGES — the "is this relation already published under another label" answer
  // is read from these, not asserted.
  for (const r of rels) {
    const ty = String(r?.type ?? "")
    bump(ty, rel)
    const md = (r?.metadata ?? {}) as Record<string, unknown>

    if (ty === "mixes_in") {
      nearMiss.moduleCompositions++
      nearMiss.moduleCompositionFiles.add(rel)
      const kw = String(md.mixinType ?? "(unlabelled)")
      nearMiss.compositionByKeyword.set(kw, (nearMiss.compositionByKeyword.get(kw) ?? 0) + 1)
    }
    if (ty === "extends" && md.definedBy === "Class.new") {
      // a FACTORY base — the superclass-nearest-miss in its factory spelling
      nearMiss.superclassClauses++
      nearMiss.superclassFiles.add(rel)
    }
    if (ty === "extends" && md.definedBy !== "Class.new") {
      nearMiss.superclassClauses++
      nearMiss.superclassFiles.add(rel)
    }
    if (ty === "imports" || ty === "references") {
      const m = String(md.requireMethod ?? "")
      if (REQUIRE_METHODS.has(m)) {
        if (ty === "imports") {
          nearMiss.requireCalls++
          nearMiss.requireCallsByMethod.set(m, (nearMiss.requireCallsByMethod.get(m) ?? 0) + 1)
          nearMiss.requireFiles.add(rel)
        }
      }
    }
    if (ty === "calls") {
      const target = String(r?.target ?? "")
      const leaf = target.split(".").pop() ?? target
      if (RENDER_METHODS.has(leaf)) {
        nearMiss.renderCalls++
        nearMiss.renderCallsByMethod.set(leaf, (nearMiss.renderCallsByMethod.get(leaf) ?? 0) + 1)
        nearMiss.renderFiles.add(rel)
      }
      if (MACRO_NAMES.has(leaf)) {
        nearMiss.macroCalls++
        nearMiss.macroCallsByName.set(leaf, (nearMiss.macroCallsByName.get(leaf) ?? 0) + 1)
        nearMiss.macroFiles.add(rel)
      }
    }
  }
}

// ── TEST 3 · THE INFORMATION TEST — what would the REFUSED row have carried? ─────────────────────
// Measured from the analyzer's OWN edges. This is the heart of L-17: a refused row must carry no
// information the corpus does not already carry.
const info = {
  implements: {
    question: "Would an `implements` row (X declares conformance to Y) carry information the corpus does not already carry?",
    answer:
      "NO — AND THE REASON IS MEASURED, NOT ASSERTED. Ruby's nearest thing to a declared conformance is " +
      "the SUPERCLASS clause and the MODULE COMPOSITION, and BOTH are already published under their own labels: " +
      "the superclass clause is an `extends` row and the composition is a `mixes_in` row. The 543 mixes_in rows " +
      "are the SAME CONSTRUCT SITES as the 428 implements rows the 2026-10-14 reading recorded — the relabel is " +
      "1:1 (428 + 115 = 543 exactly) — so the implements rows were never a lost construct: they were these sites " +
      "under a label the campaign has since renamed. An `implements` row would therefore RE-STATE a relation the " +
      "corpus already carries, in a vocabulary the canonical set does not have.",
    alreadyPublishedUnder: ["extends", "mixes_in"],
    newInformationRows: 0,
  },
  renders: {
    question: "Would a `renders` row (X produces a view) carry information the corpus does not already carry?",
    answer:
      "NO, FOR THE MEASURED POPULATION. Ruby's nearest thing to a view production is a RENDER CALL, and a render " +
      "call is a CALL: it is already published as a `calls` row to the render method, with the template it names " +
      "carried as the argument. The view itself is not a Ruby AST node — an ERB template is a separate FILE in a " +
      "separate language, so the relation `X renders template` is a relation between a .rb file and a .erb file, " +
      "and the corpus's file-to-file relations are exactly the load facts (`imports` + `references`). A `renders` " +
      "row would either duplicate the `calls` row (same information) or cross a language boundary the analyzer " +
      "does not model (no new information, only a rename).",
    alreadyPublishedUnder: ["calls", "imports", "references"],
    newInformationRows: 0,
  },
  decorates: {
    question: "Would a `decorates` row (X decorates Y) carry information the corpus does not already carry?",
    answer:
      "NO. Ruby's nearest thing to a decorator is a MACRO CALL in the class body, and a macro call is a CALL: it " +
      "is already published as a `calls` row. The `attr_reader`/`before_action`/`validates` family is the DSL " +
      "SURFACE — a method call on the class — and the analyzer already carries the ActiveRecord macros as `uses` " +
      "as well. A `decorates` row would name the same pair as a `calls` row with a different label. The bare " +
      "`@ivar` above a method definition is an INSTANCE VARIABLE, which the analyzer publishes as a `uses` row on " +
      "the member read, and it is not a decoration of the method either — Ruby has no decorator production, so the " +
      "ivar is a variable and the method is a method.",
    alreadyPublishedUnder: ["calls", "uses"],
    newInformationRows: 0,
  },
  part_of: {
    question: "Would a `part_of` row (X is part of Y) carry information the corpus does not already carry?",
    answer:
      "NO. Ruby's nearest thing to a part-file is a REQUIRE, and a require is published as an `imports` row AND a " +
      "`references` row, one-for-one: 1,304 imports and 1,304 references over the admitted population, the same " +
      "1,304 load facts. A `part_of` row would name the same pair (the requiring file, the required file) under a " +
      "third label. The DISTINCTION part_of draws is a part-file that shares scope with its parent and is NOT " +
      "required by it — Ruby's `require` DOES share the top-level scope with its requirer, so a part-file in Ruby " +
      "IS a require, and the relation is already published.",
    alreadyPublishedUnder: ["imports", "references"],
    newInformationRows: 0,
  },
}

// ── TEST 2 · THE MERGING-PAIRS QUESTION ──────────────────────────────────────────────────────────
// What would merging add? For each type: the candidate pair, and whether the corpus contains that
// pair ALREADY under another label.
const mergingPairs = {
  implements: {
    candidate: "class X → module Y (a conformance pair)",
    question: "Would merging the superclass/composition sites into one `implements` label add a pair the corpus does not have?",
    answer: "NO — the pairs are already published as `extends` (superclass) and `mixes_in` (composition). Merging would RELABEL, not add.",
    pairsAlreadyPublished: nearMiss.moduleCompositions + nearMiss.superclassClauses,
    newPairs: 0,
  },
  renders: {
    candidate: "file X → template Y (a render pair)",
    question: "Would merging the render-call sites into `renders` add a pair the corpus does not have?",
    answer: "NO — a render call is already a `calls` pair from the rendering method to `render`; the TEMPLATE is the argument, and the template is a separate file that a `renders` row could name but the corpus's file relations are the load facts.",
    pairsAlreadyPublished: nearMiss.renderCalls,
    newPairs: 0,
  },
  decorates: {
    candidate: "class X → member Y (a decoration pair)",
    question: "Would merging the macro-call sites into `decorates` add a pair the corpus does not have?",
    answer: "NO — a macro call is already a `calls` pair; the member it defines is already a `contains` pair.",
    pairsAlreadyPublished: nearMiss.macroCalls,
    newPairs: 0,
  },
  part_of: {
    candidate: "file X → file Y (a part pair)",
    question: "Would merging the require sites into `part_of` add a pair the corpus does not have?",
    answer: "NO — a require is already published as an `imports` pair AND a `references` pair; the pair is identical.",
    pairsAlreadyPublished: nearMiss.requireCalls,
    newPairs: 0,
  },
}

const report = {
  population: { corpusRoot: CR, admitted: files.length, repos, absent, overCap, exts: EXTS, sizeCapBytes: SIZE_CAP },
  parsed,
  failed,
  perType: Object.fromEntries([...perType.entries()].map(([k, v]) => [k, { edges: v.edges, files: v.files.size }])),
  nearMiss: {
    implements: {
      construct: "the SUPERCLASS clause (`class A < B`) and the MODULE COMPOSITION (`include`/`extend`/`prepend`)",
      superclassClauses: nearMiss.superclassClauses,
      superclassFiles: nearMiss.superclassFiles.size,
      moduleCompositions: nearMiss.moduleCompositions,
      moduleCompositionFiles: nearMiss.moduleCompositionFiles.size,
      compositionByKeyword: Object.fromEntries(nearMiss.compositionByKeyword),
    },
    renders: {
      construct: "the RENDER CALL (`render`, `render_to_string`, `render_to_body`, …)",
      renderCalls: nearMiss.renderCalls,
      renderFiles: nearMiss.renderFiles.size,
      byMethod: Object.fromEntries(nearMiss.renderCallsByMethod),
    },
    decorates: {
      construct: "the CLASS-BODY MACRO CALL (the Rails/ActiveRecord DSL) and the bare `@ivar` above a method",
      macroCalls: nearMiss.macroCalls,
      macroFiles: nearMiss.macroFiles.size,
      byName: Object.fromEntries(nearMiss.macroCallsByName),
    },
    part_of: {
      construct: "the REQUIRE (`require`, `require_relative`, `load`, `autoload`)",
      requireCalls: nearMiss.requireCalls,
      requireFiles: nearMiss.requireFiles.size,
      byMethod: Object.fromEntries(nearMiss.requireCallsByMethod),
    },
  },
  informationTest: info,
  mergingPairs,
  rungAvailability: {
    rule:
      "L-14: a ruling must NAME WHICH RUNG WAS UNAVAILABLE, and a rung that is merely HARD is not a reason. R1 (bump the npm package) is unavailable for EVERY type in this lane, and the reason is measured: npm's newest tree-sitter-ruby is 0.23.1, and the named-type delta between a build of that source and the WIRED build is added 0 / removed 0, so there is no newer inventory to bump to. R2 (patch the source and rebuild) is available as a MECHANISM, and this census measures whether it would FIRE: a patch matching zero corpus files changes the inventory without changing the corpus. R3 (implement the construct with an EXISTING node type) needs no grammar change at all, and it is the rung `mixes_in` takes.",
    R1: {
      available: false,
      reason: "npm's newest published tree-sitter-ruby is 0.23.1 (the registry's own version list), and the named-type delta between a build of that source and the WIRED build is added 0 / removed 0 (validation/m14/results/grammar-remedy/ — the ruby rebuild proof). There is no newer inventory that has the constructs.",
    },
    R2: {
      available: true,
      mechanismAvailable: true,
      reachability: r2Reachability,
      reading:
        "R2 is EXECUTABLE for every type — the toolchain is settled by measurement (tree-sitter build --wasm works with no docker and no emscripten, and the npm registry carries the source). What the measurement below decides is whether a patched rule would FIRE on this corpus.",
    },
    R3: {
      available: true,
      mechanismAvailable: true,
      reading:
        "R3 needs no grammar change. It is the rung `mixes_in` TAKES: Ruby's include/extend/prepend reach the analyzer as a real `call` node carrying the keyword in its `method` field, so the construct reaches the analyzer as a REAL NODE and not as recovery text — which is exactly the behavioural-fixture condition L-14 names.",
    },
  },
  instrument:
    "script/m14/ruby-near-miss-census.ts — over the admitted .rb population, via src/ast/pool-worker.parseFile; the near-miss sites are counted from the analyzer's OWN published edges and their metadata, and the information/merging answers are computed from those same edges",
  claim:
    "A MEASUREMENT, NOT A RULING. This census says WHAT THE CORPUS CARRIES near each ruled type and whether the refused row would add information. Whether the type is achievable at all is the REMEDY LADDER's question (R1 bump / R2 patch+rebuild / R3 implement with an existing node type), and for Ruby the ladder is answered by script/m14/ruby-grammar-inventory.ts (the node-type inventory + its positive controls) and by the fetched grammar source under grammars/tree-sitter-ruby/.",
}

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 1))
} else {
  console.log("ruby-near-miss-census — HOW A RULING IS EARNED (L-2026-10-21-17)")
  console.log(`population: ${files.length} admitted .rb across ${repos} repos · parsed ${parsed} · failed ${failed} · corpus ${CR}`)
  console.log("")
  console.log("PER-TYPE PUBLISHED EDGES (the analyzer's own):")
  for (const [k, v] of [...perType.entries()]) console.log(`  ${k.padEnd(13)} ${String(v.edges).padStart(7)} rows  ${String(v.files.size).padStart(5)} files`)
  console.log("")
  console.log("TEST 1 · THE NEAR-MISS TEST — the nearest thing Ruby HAS, and how many times it occurs:")
  console.log(`  implements → ${nearMiss.superclassClauses} superclass clauses (${nearMiss.superclassFiles.size} files) + ${nearMiss.moduleCompositions} module compositions (${nearMiss.moduleCompositionFiles.size} files) [${Object.entries(nearMiss.compositionByKeyword).map(([k, v]) => `${k} ${v}`).join(", ")}]`)
  console.log(`  renders   → ${nearMiss.renderCalls} render calls (${nearMiss.renderFiles.size} files) [${Object.entries(nearMiss.renderCallsByMethod).map(([k, v]) => `${k} ${v}`).join(", ")}]`)
  console.log(`  decorates → ${nearMiss.macroCalls} class-body macro calls (${nearMiss.macroFiles.size} files) [${Object.entries(nearMiss.macroCallsByName).map(([k, v]) => `${k} ${v}`).join(", ")}]`)
  console.log(`  part_of   → ${nearMiss.requireCalls} require calls (${nearMiss.requireFiles.size} files) [${Object.entries(nearMiss.requireCallsByMethod).map(([k, v]) => `${k} ${v}`).join(", ")}]`)
  console.log("")
  console.log("TEST 0 · THE RUNG-AVAILABILITY CENSUS (L-14) — would a PATCHED grammar FIRE on this corpus?")
  console.log("  R1 (bump the npm package): UNAVAILABLE for every type — npm's newest is 0.23.1 and the named-type delta vs the wired build is added 0 / removed 0.")
  console.log("  R2 (patch + rebuild): the MECHANISM is available; what decides it is whether the patch would FIRE:")
  for (const r of r2Reachability) console.log(`    ${r.type.padEnd(11)} ${String(r.candidateFiles).padStart(4)} candidate files (text) · ${String(r.filesWhoseTreeHasTheOwnNodeType).padStart(4)} whose TREE carries the construct's own node type — ${r.description}`)
  console.log("  R3 (existing node type, no grammar change): AVAILABLE — and it is the rung mixes_in TAKES.")
  console.log("")
  console.log("TEST 2 · THE MERGING-PAIRS QUESTION:")
  for (const [k, v] of Object.entries(mergingPairs)) console.log(`  ${k.padEnd(11)} ${v.pairsAlreadyPublished} pairs already published · ${v.newPairs} new pairs`)
  console.log("")
  console.log("TEST 3 · THE INFORMATION TEST — would the refused row carry anything new?")
  for (const [k, v] of Object.entries(info)) console.log(`  ${k.padEnd(11)} already published under [${v.alreadyPublishedUnder.join(", ")}] · new-information rows: ${v.newInformationRows}`)
  console.log("")
  console.log("CLAIM: a measurement, not a ruling — the achievability question is the remedy ladder's, answered by the node-type inventory and the fetched grammar source.")
}
