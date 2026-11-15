// Build instrument: GENERATE script/m14/spec/css-completeness.json from the
// measurements, so every count in the spec is computed rather than typed.
//
//   bun script/m14/tmp/css-spec-generate.ts
//
// Inputs (all produced by sibling instruments, none of them hand-maintained):
//   /tmp/opencode/css-spec-raw.json  css-spec-classify.ts    80 reproductions
//   /tmp/opencode/css-census.json    css-spec-corpus-census.ts  185 real files
//   /tmp/opencode/css-reach.json     css-spec-reach-probe.ts     10 rare types
//
// Classification rule, stated so it can be argued with:
//   internal_silent  — the type cannot be a symbol or carry one: tree-sitter's
//                      id-0 EOF symbol, a hidden `_`-prefixed rule, a
//                      `_repeatN`/`_tokenN` wrapper, a punctuation or keyword
//                      token, or a comment/string payload.
//   handled_verified — the type is reachable, the analyzer resolves it (naming
//                      the type, reading its field, or resolving it through its
//                      parent construct) and it was observed emitting a symbol,
//                      an edge, or a pattern — in the corpus, or in a
//                      reproduction when the corpus never contains it.
//   gap              — parses CLEAN and still produces nothing a CSS author
//                      would expect. Left empty only after the search recorded
//                      below; an empty list here is a claim with a method, not a
//                      default.

import { readFileSync, writeFileSync } from "fs"

const spec = JSON.parse(readFileSync("/tmp/opencode/css-spec-raw.json", "utf8"))
const cen = JSON.parse(readFileSync("/tmp/opencode/css-census.json", "utf8"))
let reach: Record<string, { reached: boolean; src: string | null; clean: boolean }> = {}
try { reach = JSON.parse(readFileSync("/tmp/opencode/css-reach.json", "utf8")) } catch { /* optional */ }

const analyzer = readFileSync("src/ast/real-css-analyzer.ts", "utf8")
const fields = new Set(
  [...analyzer.matchAll(/childForFieldName\(\s*"([a-z_]+)"/g)].map((m) => m[1]),
)
const seen = new Set<string>()
const ids: string[] = []
for (const r of cen.rows) { ids.push(r.type); if (!seen.has(r.type)) seen.add(r.type) }
const ALL = [...seen]
const corpus = new Map(cen.rows.map((r) => [r.type, r]))
const namedFlag = new Map(cen.rows.map((r) => [r.type, r.nodeTypeIsNamed]))
/**
 * Section A's vocabulary, and it is NOT the same as this spec's. F3's
 * completeness-inventory asks the grammar for `nodeTypeIsNamed(i)` and drops every
 * name starting with `_`, then adds tree-sitter's universal `ERROR`/`MISSING`
 * pair. So a spec whose `internal_silent` lists punctuation, keywords and hidden
 * `_rules` is read as 65 rows of grammar drift — three instruments (the pin gate's
 * ids/namedUnique/anonUnique, F1's literal register, and F3's section A) each with
 * its own vocabulary, and a spec that does not declare which one it is speaking
 * gets called wrong by the other two.
 *
 * So `handled_verified.types` and `internal_silent.types` carry ONLY what section A
 * asks about, and everything else moves to `internal_silent.not_structural` with its
 * reasons intact. Nothing is dropped; it is filed under the vocabulary it is in.
 */
const isStructuralName = (t: string): boolean => namedFlag.get(t) === true && !t.startsWith("_")
/** tree-sitter's universal recovery symbols — in every parser, declared by none. */
const UNIVERSAL = ["ERROR", "MISSING"]
const rep = new Map(spec.rows.map((r) => [r.type, r]))

const inCorpus = (t: string) => (corpus.get(t)?.files ?? 0) > 0
const emits = (t: string) => {
  const r = rep.get(t)
  if (r) return r.emits.symbols + r.emits.relationships + r.emits.patterns > 0
  const rc = reach[t]
  return rc?.reached ? true : null
}
const clean = (t: string) => rep.get(t)?.grammarClean ?? reach[t]?.clean ?? null
const analyzerFlat = analyzer.replace(/_/g, "")
const namedOrField = (t: string) =>
  analyzer.includes(t) || analyzerFlat.includes(t.replace(/_/g, "")) || fields.has(t)

const isInternal = (t: string) =>
  t === "end" ||
  t.startsWith("_") ||
  /_(repeat\d+|token\d+)$/.test(t) ||
  !/^[a-z_][a-z0-9_]*$/.test(t) ||
  ["not", "and", "or", "only", "of", "comment", "js_comment", "string_content"].includes(t)

// Observed parent links, from the reproductions. A type the analyzer never names can
// still be HANDLED if the construct that contains it is handled — `unit` under
// `integer_value` under `declaration` is resolved by the declaration the analyzer
// already resolves. That is a claim about the tree, so it is CHECKED here: the
// parent chain must actually reach a type the analyzer names, and the chain is
// recorded as the reason. A type whose parents are all themselves unhandled is
// NOT quietly filed as handled.
const parentOf = new Map<string, string[]>()
for (const r of spec.rows) if (r.parents?.length) parentOf.set(r.type, r.parents)
const namedSet = new Set(ALL.filter((t) => namedOrField(t)))

/** Walk parents until a type the analyzer names; return the chain, or null. */
function handledVia(t: string): string[] | null {
  const seen = new Set<string>()
  const walk = (cur: string, chain: string[]): string[] | null => {
    if (namedSet.has(cur)) return chain.length ? chain : [cur]
    if (seen.has(cur) || chain.length > 6) return null
    seen.add(cur)
    for (const par of parentOf.get(cur) ?? []) {
      const r = walk(par, [...chain, par])
      if (r) return r
    }
    return null
  }
  return walk(t, [])
}

const handled: string[] = []
const internal: string[] = []
const internalWhy = new Map<string, string>()
const viaParent = new Map<string, string>()
const gaps: string[] = []

for (const t of ALL) {
  if (isInternal(t)) {
    internal.push(t)
    internalWhy.set(
      t,
      t === "end"
        ? "tree-sitter id 0 — the language's end-of-input symbol, not a grammar rule (absent from grammar.js and from the scanner's TokenType enum)"
        : t.startsWith("_")
          ? "hidden rule: not visible as a named child in the tree, so no analyzer can reach it as a node"
          : /_repeat\d+$/.test(t)
            ? "generated repetition wrapper — holds the repeated children, is not itself a construct"
            : /_token\d+$/.test(t)
              ? "generated token wrapper for a lexeme the value rules already cover"
              : /comment|content/.test(t)
                ? "comment or string payload — carries no symbol and no edge"
                : "punctuation or keyword token — the construct is its parent",
    )
    continue
  }
  // `important_value` is the one named type that is only ever produced INSIDE an
  // error subtree, so it is filed as internal rather than as handled: a rule the
  // analyzer can only meet on already-broken input is not handled coverage.
  if (t === "important_value") {
    internal.push(t)
    internalWhy.set(
      t,
      "the non-standard `!foo` fallback; `!important` parses as `important`, and `important_value` is only ever produced inside an ERROR subtree (reproduction `.a { color: red !urgent; }` has hasError=true), so no clean source reaches it",
    )
    continue
  }
  if (namedOrField(t) && (inCorpus(t) || emits(t))) { handled.push(t); continue }
  // Not named directly — but reachable through a construct the analyzer DOES
  // resolve. Verified against the observed tree, not assumed from the name.
  const chain = handledVia(t)
  if (chain && (inCorpus(t) || emits(t))) {
    handled.push(t)
    viaParent.set(t, `${t} -> ${chain.join(" -> ")} (handled construct)`)
    continue
  }
  if (inCorpus(t) && clean(t) === true && !emits(t)) { gaps.push(t); continue }
  internal.push(t)
  // A type the reach probe can reproduce but whose only clean form is shadowed by a
  // sibling rule gets the MEASUREMENT as its reason, not the generic fallback text:
  // "unexamined" and "ruled, and here is the ruling" are different claims.
  if (t === "postcss_statement") {
    internalWhy.set(
      t,
      "RULED (CSS-D2): the rule is defined at prec(-1) and un-precedenced `at_rule` matches the same shape, so tree-sitter prefers at_rule on every conflict — `@tailwind --apply;` parses CLEAN as at_rule + keyword_query, and `@custom-selector :--n .a, .b;` errors without ever producing it. The construct is handled through at_rule; handling it here would mean handling a rule no input can select.",
    )
  } else {
    internalWhy.set(
      t,
      chain
        ? `reached only through a parent chain the analyzer does not name: ${t} -> ${chain.join(" -> ")}`
        : "not named by the analyzer, and no observed parent chain reaches a construct it names; never observed emitting on its own — see the gap search",
    )
  }
}

// tree-sitter's universal recovery symbols: in every tree-sitter parse tree, not
// declared by this grammar's source, and consulted for ERROR RANGES rather than
// being constructs. F3 adds them to section A's list explicitly, so a spec that
// omits them is read as two unclassified types.
for (const u of UNIVERSAL) {
  if (!internal.includes(u)) internal.push(u)
  internalWhy.set(
    u,
    "tree-sitter's universal error/recovery symbol, present in every parse tree and declared by no grammar's source. It is a position inside a recovery region, not a construct: the analyzer reads it to report error ranges, and there is nothing in it to name.",
  )
}

internal.sort(); handled.sort()

const out = {
  language: "css",
  grammar: "tree-sitter-css.wasm",
  vocabulary: {
    _description:
      "The grammar pin gate (script/m14/verify-grammar-pins.ts) reports three counts for a lane, and this file uses the same three so the two documents can be compared directly. `ids` is tree-sitter's whole symbol space, which mixes three vocabularies; `namedUnique` and `anonUnique` are the two halves of it by tree-sitter's OWN nodeTypeIsNamed flag, not by a regex on the name. This spec buckets by ANALYZER REACHABILITY instead, which is a different axis and deliberately not the same partition — `internal_silent` holds named types (hidden `_rules`, generated `_repeatN`/`_tokenN` wrappers) AND anonymous tokens (punctuation, keywords, comments). The two axes are reconciled in `internal_silent.named_vs_anonymous`.",
    ids: cen.vocabulary.ids,
    namedUnique: cen.vocabulary.namedUnique,
    anonUnique: cen.vocabulary.anonUnique,
  },
  handled_verified: {
    _description:
      `Analyzer-referenced node types, behavior-verified 2026-09-26 (real-css-analyzer.ts, at the CSS spec wave). ` +
      `Verification is three independent signals, all measured: ${spec.reachedByReproduction} node types reached by a minimal ` +
      `reproduction (css-spec-classify.ts), ${cen.typesSeenInCorpus} of ${ids.length} wasm symbol ids present in the real corpus of ` +
      `${cen.filesNonEmpty} non-empty svelte .css files (css-spec-corpus-census.ts), and for each type an observed symbol, edge, or ` +
      `pattern count. A type counts as HANDLED when the analyzer names it or reads its field AND it was observed in real code or in a ` +
      `reproduction — never on name alone. Handled does NOT mean "emits a symbol": the analyzer can handle a construct by consciously ` +
      `declaring that it emits nothing for it, and two types do exactly that (CSS-D5). The distinction that matters is handled vs ` +
      `unexamined: nothing in this list is merely unaccounted for. Types reached only through a parent construct (unit, integer_value, ` +
      `color_value, escape_sequence, feature_name, keyframe_block, binary_expression, …) are handled via that parent and are listed here ` +
      `rather than left unadjudicated.`,
    types: handled.filter((t) => isStructuralName(t)),
    flagged_anonymous: {
      _description:
        "Handled, but tree-sitter's `nodeTypeIsNamed` flag says they are not named node types, so they are OUT of `types` above and would otherwise read to F3's section A as grammar drift. The flag is authoritative about the ABI and is wrong about intent here: `selector` is a rule of this grammar that the analyzer genuinely handles — `@media selector(.a)` reaches it — and tree-sitter reports it as a token because it is an alias target rather than a directly-declared named rule. Dropping the row would lose a real construct; claiming it as structural would be asserting something the wasm contradicts. It is filed here, in both directions.",
      types: handled.filter((t) => !isStructuralName(t)),
    },
    resolved_via_parent: Object.fromEntries([...viaParent].sort()),
  },
  internal_silent: {
    _description:
      `Grammar-internal containers, generated repetition/token wrappers, hidden rules, punctuation and keyword tokens, comment and ` +
      `string payloads, and tree-sitter's id-0 end-of-input symbol — ${internal.length} of ${ids.length} unique type names across ` +
      `${ids.length} wasm symbol ids (the id list repeats names, which is how tree-sitter aliases a token to several rules). Every ` +
      `entry below is silent BY CONTRACT: a symbol's edge names a construct, and none of these IS a construct. Each carries a stated ` +
      `reason so "silent" is auditable rather than assumed.`,
    types: internal.filter((t) => isStructuralName(t) || UNIVERSAL.includes(t)),
    not_structural: {
      _description:
        "Silent, and deliberately OUT of `types` above: the anonymous punctuation and keyword tokens, the hidden `_`-prefixed rules, the generated `_repeatN`/`_tokenN` wrappers, and tree-sitter's id-0 end-of-input symbol. None of these is a STRUCTURAL node type — F3's section A asks the grammar for `nodeTypeIsNamed(i)` with `_`-prefixed names dropped, and a row outside that vocabulary reads to it as grammar drift. They are silent for the same reason the rows above are silent, and the reasons are the same map.",
      types: internal.filter((t) => !isStructuralName(t) && !UNIVERSAL.includes(t)),
    },
    named_vs_anonymous: {
      named: internal.filter((t) => namedFlag.get(t) === true && !t.startsWith("_")),
      anonymous: internal.filter((t) => namedFlag.get(t) === false),
      flag_unknown: internal.filter((t) => namedFlag.get(t) == null),
      _note: "tree-sitter nodeTypeIsNamed, from the census. The named half is entirely hidden rules, generated wrappers and comments; the anonymous half is punctuation and keywords.",
    },
    reasons: Object.fromEntries([...internalWhy].sort()),
  },
  limitations: [
    {
      id: "CSS-L1",
      scope: "the .scss / .sass / .less files this lane is also ROUTED",
      severity: "declared, not a defect in the CSS contract",
      measured:
        "The product routes all four extensions to this analyzer (src/ast/parallel-indexer.ts lists .css/.scss/.sass, and script/m13/corpus-map.ts maps .scss/.sass/.less -> css), and every one of the 254 real .scss files in the corpus routes here — measured, 254/254. The CSS grammar does not support SCSS: 42 of 244 non-empty .scss files parse CLEAN (17.2%), 202 produce errors, 0 crash, for 11,451 distinct error lines. The lane still emits 4,477 symbols and 2,025 relationships from them, so a caller indexing an SCSS file gets a partial graph.",
      cause_breakdown:
        "SCSS variables and @include dominate: $variable reference 17.9%, @include 12.8%, $variable declaration 6.7%, `//` line comment 2.7%, @use 1.6%, #{...} interpolation 1.2%, @each/@for/@if/@else 1.1%, @mixin 0.6%; 55.3% is the structural fallout of those rather than a separate cause. (@use looked like the dominant cause in a first pass and was not — that sample read only the first error rows of files in name order, and @use sorts early. The number above is every distinct error line.)",
      decision:
        "DECLARED, and deliberately not fixed here. The plain-CSS rules inside an SCSS file parse correctly and are worth keeping, so removing the routing would take away real capability; and teaching the CSS grammar SCSS is a different grammar (tree-sitter-scss) with its own A/B, not a third hunk on a pinned 0.25.0 that has already been measured twice. What was missing was not the behaviour but the DECLARATION: nothing in the repo said this lane also receives .scss, so an 82.8% parse-failure rate on 254 real files was invisible to every gate. It is now stated here, in docs/analyzers/css.md, and in reviews/m49-css-review.md.",
    },
    {
      id: "CSS-L2",
      scope: "the `progid:` value class",
      severity: "residual floor, not fixed",
      measured:
        "An IE filter value (`filter: progid:DXImageTransform.Microsoft.gradient(startColorStr = '#fff')`) does not parse. This is the same family as the relative-url defect that WAS patched, and it is the LARGEST remaining class by a wide margin: 37 of the 62 corpus .css files that still fail (60%), and in all 37 the error sits ON the progid line. It is not one class but two — 13 error files are genuine modern CSS the newest grammar cannot read (range queries, `&div`, `@page :right`, `[attr i]`, escaped unicode ids, HTML comments, `chrome://` imports, `--foo: ;`) and 37 are this one.",
      attempted_and_rejected:
        "Adding `=` to the separator choice in the `arguments` rule — the obvious one-token edit — was built and A/B'd and is PROVABLY INERT: 61 error files before, 61 after, 0 fixed, 0 regressed, 151 -> 151 node types, 0 field delta. Not adopted, because adopting a build that changes nothing while looking like a fix is worse than not patching. The reason it cannot work is worth recording, because it is the opposite of the obvious diagnosis: the `progid:` TOKEN already lexes fine (`plain_value`'s trailing repeat has always admitted `:`), and the failure is INSIDE the parentheses. The value parses as `parenthesized_value`, whose rule is `seq('(', $._value, ')')` — exactly ONE value — so `startColorStr = '#fff'` cannot be a `parenthesized_value` at all, and `arguments` (which does allow separators) is unreachable because nothing matched the callee as a `function_name`.",
      decision:
        "Left unpatched, and the reason is now measured rather than asserted. A real fix has to widen `parenthesized_value` from one value to a separated list, or add an IE-filter argument form — and `parenthesized_value` participates in EVERY parenthesized value in CSS (`calc((1px + 2px) * 3)`, nested parens, `var()` fallbacks). That is a different KIND of change from the two additive hunks adopted earlier, which only widened a token BODY and a step CHOICE while leaving every existing parse path untouched, and it would need its own A/B plus a shape-delta decision. Recorded so the next person does not write the inert patch: the cause is the rule's ARITY, not the token's character set.",
    },
    {
      id: "CSS-L3",
      scope: "the complexity performance row",
      severity: "measured, unscorable on this host",
      measured:
        "Both budgets are met (1.45 s over 2 files, 6.04 s over 185) but the run was measured at loadAvg1 31-37, and a row measured on a loaded box is not scored. The load-stable comparison is userCpuMsPerFile: 149.0 ms fixtures, 15.9 ms corpus.",
      decision:
        "Left `unscorable` rather than re-run until the number happened to land. The gate's own rule is that a load-stable measurement is the only scorable one, and re-rolling until a host cooperates is how a red row becomes a green one without the code changing.",
    },
  ],
  gap: {
    _description:
      `EMPTY, and that is a claim with a method rather than a default. Searched for: a node type that parses with hasError=false and ` +
      `still yields no symbol, edge, or pattern. Two types parse clean and emit nothing by DESIGN and are recorded as rulings instead — ` +
      `charset_statement (an encoding declaration, not a construct) and universal_selector (\u002A matches every element; publishing a symbol named \u002A would be the same noise the HTML lane already ruled out for anonymous structural tags). ` +
      `Everything else that is silent is silent for a reason in internal_silent.reasons, and the earlier waves carry the behavioral ` +
      `half of this: the 41/41 M12 differential, the ontology class-resolution census, and the M59 line oracle over 7,647 edges.`,
    gaps: [] as string[],
  },
  design_decision: {
    description:
      "CSS contract rulings, each one reached by reading the pinned grammar and then MEASURED, because every one of them looked like dead grammar on the way in.",
    decisions: [
      {
        id: "CSS-D1",
        node_type: "end",
        status: "RULED",
        question: "`end` is reported as node type id 0 by the wasm but appears nowhere in grammar.js or in the scanner's TokenType enum.",
        resolution:
          "It is tree-sitter's end-of-input symbol, not a rule of this grammar — the language's reserved id 0, which is why enumerating node types reports it and why no source can ever produce it. internal_silent, with the absence from both grammars recorded as the evidence rather than a guess.",
      },
      {
        id: "CSS-D2",
        node_type: "postcss_statement",
        status: "RULED",
        question: "the grammar defines postcss_statement (`at_keyword` + values + `;`) at prec(-1), but no reproduction reached it.",
        resolution:
          "`at_rule` is un-precedenced and matches the same shape, so tree-sitter prefers it on every conflict: `@tailwind --apply;` parses CLEAN as at_rule + keyword_query, and `@custom-selector :--n .a, .b;` errors without ever producing postcss_statement. The analyzer therefore handles the construct through at_rule/keyword_query, which is the path real PostCSS-style directives take. Handling it as postcss_statement would have been a rule no input can select.",
      },
      {
        id: "CSS-D3",
        node_type: "important_value",
        status: "RULED",
        question: "a named `important_value` rule exists alongside `important`; which one does real CSS produce?",
        resolution:
          "`!important` produces `important`; `important_value` matches a non-standard `!foo` and is only ever produced INSIDE an error subtree — `.a { color: red !urgent; }` yields important_value together with hasError=true. A rule the analyzer can only meet on already-broken input is not coverage, so it is internal_silent with that measurement attached rather than counted as handled.",
      },
      {
        id: "CSS-D4",
        node_type: "of",
        status: "RULED",
        question: "`of` is reported by the wasm but my first three candidate sources missed it entirely.",
        resolution:
          "It is the anonymous keyword token of nth-child's selector list (grammar.js: `optional(seq('of', $._selector))` inside `pseudo_class_nth_child_arguments`), so the construct is the parent and the token is internal_silent. The reason it is a decision rather than a line in the reasons table: `.a:nth-child(odd of .b)` parses clean and produces it, while the more natural `.a:nth-child(2n of .b, .c)` spelling ERRORS in this grammar. Recorded because the obvious spelling is the broken one — a future reader must not 'fix' the reproduction into the form that does not parse.",
      },
      {
        id: "CSS-D5",
        node_type: "charset_statement,universal_selector",
        status: "RULED",
        question: "the only two types that parse clean and emit nothing.",
        resolution:
          "Both are silent by design, and both are in handled_verified rather than in gap BECAUSE the analyzer switches on them and decides: `@charset` declares the document encoding, which is not a construct a caller navigates to, and `*` matches every element — publishing a symbol named `*` would be the anonymous-structural-tag noise the HTML lane already ruled out. The measured count of clean-parses-with-no-emit types is exactly these two, and the search that produced it is recorded in gap._description. A zero-symbol result here is the contract working, not a gap.",
      },
      {
        id: "CSS-D6",
        node_type: "grid_value,parenthesized_value",
        status: "RULED",
        question: "two real value shapes the 185-file corpus never contains.",
        resolution:
          "Reached by reproduction instead — `[full-start] minmax(1em, 1fr) [main] …` and `calc((1px + 2px) * 3)`, both clean. They are value payload under a property the analyzer already resolves, so no separate symbol is owed; the spec says so explicitly instead of letting corpus-absence read as ignorance of the feature.",
      },
      {
        id: "CSS-D7",
        node_type: "class_name,arguments,declaration,(,string_value,:",
        status: "RULED",
        question: "the wasm id list is 151 long but only 129 unique type names appear.",
        resolution:
          "tree-sitter assigns several symbol ids to one name when a token is aliased into different rules, so the census counts ids (151) and the spec counts unique names (129) and says so. Both numbers are stated in this file rather than reconciled silently, because a reader comparing 151 against 129 needs to know which is which.",
      },
      {
        id: "CSS-D10",
        node_type: "nested rule_set (contains, isNestedSelector)",
        status: "RULED",
        question: "a `&`-composed nested rule's `contains` edge carries NO line, because the edge's TARGET is the RESOLVED selector (`.a { & .b {} }` -> `.a .b`) and that string is written nowhere in the file. 52 of the lane's 28,432 relationships are in this state. Should the line be omitted, or should it be the nested rule's own line?",
        resolution:
          "OMITTED, on a measurement rather than a preference. Claiming the nested rule's line made 96 of 96 nested-selector edges INCONSISTENT against the source text — not because the line was nearly right, but because the name the line is supposed to carry is not in the file at all. The governing rule is M59's: a relationship's line belongs to the NAME node, not to the enclosing construct, and `.a .b` has no line because it is not written on one. The test for which case applies is not `does the selector contain &` — an IMPLICIT descendant (`.a { .b {} }`, no `&` at all) also resolves to a composed name that is written nowhere, and it accounted for the 67 INCONSISTENT edges left after the `&` test. The exact test is whether the resolved text and the as-written text are the same string, so the one case where the name genuinely IS written keeps its line. LOCATABILITY IS NOT LOST: the edge carries `asWrittenSelector` (`& .title`) in its metadata, so a consumer can find the site by text even though it cannot be given a line that would imply the name is there. The alternative — stamping the construct's line and weakening the oracle to check the as-written form instead — is defensible and was considered; it is not adopted because it would trade a guarantee the rest of the lane holds (the line carries the name) for one it does not (the line carries the construct), and that trade should be made once for the whole codebase rather than lane by lane.",
      },
      {
        id: "CSS-D9",
        node_type: "@page,@starting-style,@position-try",
        status: "RULED",
        question: "three at-rules that wrap rules in a block, like @media and @layer do, but which the analyzer gives no symbol and no `contains` edge — so a rule inside one is published with no context at all.",
        resolution:
          "Not a gap, and the reason is a property of the LANGUAGE rather than a choice about the analyzer: none of the three can be NAMED by anything else in CSS. There is no `var(@starting-style)`, no `@layer` that points at one, no query that resolves it — so a `contains` edge sourced from one would have to name a node that cannot exist, which is the unjoinable-string failure the F10 differential exists to catch. Compare `@layer base`, which another `@layer base { }` can join, and `@container card`, which a `container-name: card` can query: those two are nameable, so they get symbols and edges. The rules inside the three are still symbolized and their own declarations still read; what is dropped is the attribution that the language gives no way to express. NOTE these are not node types in this grammar at all — `@starting-style` reaches the analyzer as a generic `at_keyword` under `at_rule`, which is why they do not appear in `internal_silent` and why an earlier version of real-css-analyzer.ts pointed at a per-type entry here that did not and could not exist.",
      },
      {
        id: "CSS-D8",
        node_type: "_repeat1,_token1,_selector,_query,_value,_descendant_operator,__error_recovery",
        status: "RULED",
        question: "17 _repeatN/_tokenN wrappers and 6 hidden rules are unreachable by any source.",
        resolution:
          "They are generated by tree-sitter's rule flattening and the external scanner: hidden rules are not named children, so no analyzer can receive them as a node, and the scanner's enum holds exactly DESCENDANT_OP, PSEUDO_CLASS_SELECTOR_COLON and ERROR_RECOVERY — the three that back real constructs. Recorded against the scanner source so the silence is a property of the grammar's shape, not of an omission in the analyzer.",
      },
    ],
  },
}

// Sorted on emit, not on insertion: the decisions were written in the order they
// were discovered, which put CSS-D9 ahead of CSS-D8 once D9 was added later. A
// list whose order depends on when someone had an idea is a list that rots.
out.design_decision.decisions.sort((a, b) => a.id.localeCompare(b.id))
const decisionIds = out.design_decision.decisions.map((d) => d.id)
if (new Set(decisionIds).size !== decisionIds.length) { console.error("duplicate decision id: " + decisionIds.join(" ")); process.exit(1) }

writeFileSync("script/m14/spec/css-completeness.json", JSON.stringify(out, null, 2) + "\n")
console.log(
  `css-completeness.json: ${handled.length} handled_verified + ${internal.length} internal_silent + ${gaps.length} gap ` +
    `= ${handled.length + internal.length + gaps.length} of ${ALL.length} unique types (${ids.length} wasm ids)`,
)
const unbucketed = ALL.filter((t) => !handled.includes(t) && !internal.includes(t) && !gaps.includes(t))
if (unbucketed.length) { console.error("UNBUCKETED: " + unbucketed.join(" ")); process.exit(1) }
