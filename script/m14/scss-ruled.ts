/**
 * SCSS RULING TABLE — the two types `src/ast/real-scss-analyzer.ts` does not emit,
 * each with the instrument the workstream defines and the measurement behind it.
 *
 * ## WHAT IS IN THIS TABLE
 *
 * Two entries: `implements` and `instantiates`. Those are the only two of the ten the
 * lane does not emit, and both are ruled on instrument A.
 *
 * The other eight are EMITTED and the gate counts them from production `parseFile`, so
 * they take no row here. Measured over the lane's whole admitted corpus — 4,433 tracked
 * `.scss` files across 116 repositories, every one of them, through `parseFile`
 * (`validation/m14/fixtures/scss/scss-relationship-census.ts 5000`, 0 parse failures):
 *
 *   contains     12,369 edges / 2,321 files    both ends resolved 100.0%
 *   references    6,594 edges /   585 files    both ends resolved  46.9%
 *   exports       4,018 edges /   324 files    both ends resolved 100.0%
 *   imports       3,623 edges /   825 files    both ends resolved   0.0%
 *   extends         423 edges /   151 files    both ends resolved  13.5%
 *   calls           304 edges /    57 files    both ends resolved 100.0%
 *   uses             91 edges /    42 files    both ends resolved 100.0%
 *   overrides        32 edges /    12 files    both ends resolved 100.0%
 *                                         -------------------------
 *                                         27,454 edges
 *
 * No edge this lane emits carries `confidence < 0.7` (0 of 27,454), because each is a
 * deterministic parse fact rather than a name-match guess.
 *
 * The total is written as a sum on purpose. It previously read `0 of 28,068`, which is 600
 * MORE than the eight figures printed directly above it add to (27,468). A total that does
 * not reconcile with its own parts is not a measurement, and a reader who had summed the
 * table would have had no way to tell which of the nine numbers was the invented one.
 *
 * The census is NOT byte-reproducible and these figures are one run's. Five runs over the
 * same file set move `contains` 12,369-12,374, `imports` 3,611-3,634, `extends` 423-427 and
 * `exports` 4,018-4,019, while `calls` 304, `uses` 91, `references` 6,594 and `overrides` 32
 * are identical in all five. The spread is measured rather than described in
 * `docs/analyzers/real-scss-analyzer.md` and in the census harness header; the cause is
 * WHICH files take the degraded extractor, and that set differs per run.
 *
 * Reproduce with `npx tsx validation/m14/fixtures/scss/scss-relationship-census.ts 5000`,
 * which takes the same admission rule the gate takes — `detectLanguageFromPath(abs, text)`
 * with BOTH arguments, over `git ls-files`, under 512 KB. A census over a different file
 * set than the arbiter's makes every number here uncheckable by the instrument meant to
 * check them; the css lane once read 1,171 where the gate read 1,180 purely because it
 * called that function with one argument.
 *
 * ## WHY THE TABLE IS A SEPARATE FILE AND NOT AN ENTRY IN THE GATE
 *
 * `script/m14/ontology-coverage-gate.ts` is supervisor-owned shared machinery (lane brief
 * §8) and `RULED_BY_LANG` in it is a literal with no extension point. Run against `scss` it
 * refused to report at all, which is the gate behaving correctly:
 *
 *   $ npx tsx script/m14/ontology-coverage-gate.ts scss
 *   ontology coverage gate — scss
 *   corpus: 4431 admitted files
 *   ontology coverage gate — no RULING SOURCE for scss.
 *   Refusing to report: with no ruling anywhere, every un-emitted type would be called
 *   RULED-UNJUSTIFIED, and that is a verdict about the absence of evidence, not about the lane.
 *   $ echo $?
 *   2
 *
 * The table was written here first, in a file this lane owns, in the gate's own `Ruled`
 * shape. Registration is one import and one map entry, and it is recorded in
 * `docs/analyzers/real-scss-analyzer.md` as the supervisor-side step.
 *
 * ## THE SHAPE IS IMPORTED, NOT RESTATED — because restating it hid a change
 *
 * This file used to declare its own `Ruled` and its own ten-name `Type` union, on the
 * reasoning that the gate's copy was not exported and "a structural copy diverging is a
 * compile error at the registration point rather than a silent pass". That reasoning was
 * half right and it was wrong in the half that mattered. A structural copy DOES fail to
 * compile when the gate's shape changes incompatibly — the gate's own header records
 * julia-ruled and xml-ruled failing exactly that way — but it does NOT fail when the gate
 * GAINS a field, and the gate has since gained two: `publishedCount` / `publishedFiles`,
 * which hold the numbers a ruling publishes so the arbiter can check them instead of
 * trusting prose. A restatement is blind to exactly the class of change that matters most,
 * because an added field is backwards-compatible to every consumer that never sets it.
 *
 * The gate exports `Ruled` now, so this file imports it. Nothing else about the table
 * changed: both entries are instrument A, so both new fields stay unset, and the gate does
 * not read them for instrument A.
 *
 * ## THE MEASUREMENT BEHIND BOTH ENTRIES IS PRINTED, NOT ASSERTED
 *
 * Instrument A's whole claim is an inventory, and an inventory is only evidence if it can
 * be read. `validation/m14/fixtures/scss/scss-grammar-vocabulary.ts` prints the entire
 * vocabulary, and both entries' numbers come from running it:
 *
 *   $ npx tsx validation/m14/fixtures/scss/scss-grammar-vocabulary.ts 1200
 *   distinct node types PRODUCED: 134
 *   MUST_APPEAR: 15 of 15 present
 *   SUPERTYPE (would mean implements): 0 of 30 present
 *   CONSTRUCTOR (would mean instantiates): 0 of 10 present
 *
 * The calibration row is not decoration. "0 of 30 names appear" is only evidence of
 * absence if the same probe finds the 15 names that DO appear; a probe that returned 0 for
 * everything would be indistinguishable from a broken one. The gate's own header records
 * what that failure costs in the other direction — its first version convicted a correct
 * ruling using a text regex, matching `class voice` inside a telnet IAC word list in a
 * string literal. Nothing in this file matches text.
 *
 * ## WHAT INSTRUMENT A CANNOT SEE HERE — stated rather than implied
 *
 * The inventory is collected from parse trees, so it can only report node types the
 * grammar PRODUCES. A name the grammar never produces on this corpus is a capability this
 * corpus does not exercise, and that is weaker than "the grammar cannot express it". Two
 * things bound the claim, and both are measurements rather than reassurances:
 *
 * 1. The vocabulary is 134 names and the full list is printed, so a reader can see the
 *    whole space rather than take 30 absences on trust. There is no supertype node in it
 *    and no constructor node in it — not "the 30 I probed", which is the part a reviewer
 *    would otherwise have to take on trust.
 * 2. Both rulings' OVERTURN conditions are conditions a correct, exhaustive implementation
 *    could actually meet. That is the test the round brief sets, after julia shipped two
 *    rulings whose conditions no correct implementation could satisfy — one demanded a
 *    count above the `ExportInfo` count from a path that emits one row per `ExportInfo`, so
 *    only a WRONG edge could satisfy it. Neither condition here is a count of the lane's
 *    own output. Both are a fact about the GRAMMAR: produce one of these node types and the
 *    arbiter flips the row itself, with no change to any lane.
 */
import type { Ruled } from "./ontology-coverage-gate"

// ─────────────────────────────────────────────────────────────────────── implements
//
// The probed vocabulary is the SUPERTYPE RELATION, not a type declaration. Sass declares
// mixins, functions and variables; none of those is a type another type could conform to,
// and the lane's `implements` ruling would be unsound if it rested on their absence — which
// is the mistake the zig table documents at length, where `struct_declaration` is a type
// DECLARATION while `extends` needs a SUPERTYPE CLAUSE, a different node. So the 30 names
// below are clauses and relations, not declarations.
const SCSS_SUPERTYPE_NODE_TYPES = [
  "class_declaration", "class_specifier", "class", "class_definition",
  "interface_declaration", "interface_definition", "interface_body",
  "trait_declaration", "trait_definition", "trait_specifier",
  "struct_declaration", "struct_specifier", "struct_item",
  "enum_declaration", "enum_item", "union_declaration", "union_specifier",
  "object_declaration", "object_type", "type_declaration",
  "extends_clause", "implements_clause", "superclass", "base_class",
  "inheritance_specifier", "interface_implementation", "super_type",
  "protocol_declaration", "mixin_declaration", "base_list",
]

// ────────────────────────────────────────────────────────────────────── instantiates
//
// The probed vocabulary is CONSTRUCTION OF A VALUE. Sass's nearest candidates are
// `@function` (which RETURNS a value — a call, and the lane emits `calls`) and
// `@extend %placeholder` (which ADDS a selector to an existing rule at compile time and
// creates nothing), so neither is construction and the probe is over the right question.
const SCSS_CONSTRUCTOR_NODE_TYPES = [
  "new_expression", "object_creation_expression", "constructor_invocation",
  "new_declaration", "class_instance", "object_literal", "instantiation",
  "allocate_expression", "constructor_call", "instance_creation",
]

export const SCSS_RULED: Ruled[] = [
  {
    type: "implements",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: SCSS_SUPERTYPE_NODE_TYPES,
    describe:
      "a SUPERTYPE CLAUSE — a declaration that names a type it satisfies or a base it takes. MEASURED (validation/m14/fixtures/scss/scss-grammar-vocabulary.ts over 1,200 of the 4,433 admitted files, every 3rd of the sorted admitted list): the grammar PRODUCES 134 distinct node types across that sample and 0 of the 30 clause/relation names below is among them. The probe is calibrated in the same run — 15 of 15 names that must appear do (`stylesheet` 1,164, `rule_set` 3,143, `declaration` 8,670, `mixin_statement` 55, `include_statement` 773, `use_statement` 252, `forward_statement` 24, `function_statement` 30, `class_selector` 2,502, `variable` 3,297, `call_expression` 3,565, `arguments` 4,500, `block` 4,132, `comment` 1,278, `identifier` 18,176) — so the 30 zeroes are absences and not a probe that finds nothing. The full 134-name vocabulary is printed by that script rather than summarised, because \"0 of the 30 I probed\" is weaker evidence than \"there is no supertype node in the 134 the grammar produces\". WHY: Sass has no interface, no class and no type hierarchy; what it has instead is `@mixin`, and `@include` is a CALL to it (which the lane emits as `calls`, 304 edges over 57 files) and never a conformance claim. The one reading that would make this a GAP is `@use` + `@include` described as \"implementing\" a module — that is a module dependency plus a call, i.e. `imports` (3,623 edges) and `calls`, and mapping it onto `implements` would assert a subtyping relation Sass does not have and would make `bb_impact` report that editing a module changes its consumers' type conformance. OVERTURN: any one of the 30 names produced by the grammar on this corpus. A correct and exhaustive `implements` implementation cannot satisfy this condition without the grammar changing, because there is no supertype clause in the file to read one from.",
  },
  {
    type: "instantiates",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: SCSS_CONSTRUCTOR_NODE_TYPES,
    describe:
      "a CONSTRUCTOR CALL — an expression that creates a value of a type. MEASURED (same run, same script): 0 of the 10 construction names below is among the 134 node types the grammar produces, on the same calibration of 15 of 15. WHY: Sass has no `new` and no value type. The two constructs that could be mistaken for one are both something else, and saying so is the substance of the ruling rather than a footnote. `@function double($n)` is invoked by `double(4px)`, which CONSTRUCTS nothing — it is a call on a name this file declares, and the lane emits it as `calls` (both syntaxes: `@include name` and `name(x)`, 304 edges over 57 files, both ends resolved on 100.0% of them). `@extend %badge` adds `%badge` to an existing rule's selector list at compile time; it creates no value and no instance, and the lane emits it as `extends` (423 edges over 151 files), which is the label that says what happened. The argument that a placeholder is therefore \"instantiated\" is an argument about the LABEL, not about the count, and it loses on the same ground the lua lane records for `uses` vs `calls`: the ontology already has the type that means inheritance, and using `instantiates` for it would leave `extends` with nothing to carry. OVERTURN: any one of the 10 names produced by the grammar on this corpus — which in Sass would mean the language acquired a constructor form, since no rearrangement of the existing 134 node types can express one.",
  },
]