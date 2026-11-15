// Build instrument: author the CSS fixture lane and VERIFY it against the analyzer.
//
//   bun script/m14/tmp/css-fixtures.ts --out <dir> [--verify]
//   bun run script/m14/tmp/css-fixtures.ts --stage && bun run script/m14/tmp/css-fixtures.ts --verify
//
// WHY THIS EXISTS SEPARATELY FROM run-fixtures.ts
//
// A fixture directory that no runner lane claims is an ORPHAN, and the full
// fixture run exits 6 on an orphan — deliberately, because a directory of
// expectations that nothing executes "looks like evidence and cannot fail, which
// is the one property a gate may not have". So the fixtures cannot be installed
// before `css` is in run-fixtures.ts's LANGS map, and that file is being edited
// concurrently. Authoring + verifying here means the install is a one-line
// change with the expectations already proven, instead of a risk.
//
// THE EXPECTATIONS ARE DERIVED FROM THE CONTRACT, NOT TRANSCRIBED
//
// Every value below comes from a ruling already on the record — the ontology
// table in reviews/m49-css-review.md, CSS-D1..D9 in the spec, and the relationship
// classes measured in the corpus census. Nothing here was copied out of analyzer
// output. That is the whole difference between a fixture and a mirror, and it is
// why `--verify` is expected to be able to FAIL: if the analyzer disagrees with
// the contract, the disagreement is the finding.
//
// The matcher re-implements run-fixtures.ts's documented semantics (lines 143-200):
// every specified constraint field must match, unspecified fields are wildcards,
// `comment`/`note` are documentation rather than constraints, `meta.x: null` means
// "must NOT carry x", and `from`/`target`/`type` accept their aliases.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs"
import { join } from "path"
import { ASTEngine } from "../../../src/ast/engine"

const args = process.argv.slice(2)
const STAGE = "/tmp/opencode/css-fixtures-stage"
const outDir = args.includes("--out") ? args[args.indexOf("--out") + 1] : STAGE

// ── the fixtures ────────────────────────────────────────────────────────────
// Sources are written to be READABLE first: every line exists because a ruling or
// a measured class depends on it, not to maximise the number of assertions.

const FIXTURES: Array<{
  id: string
  source: string
  expectation: Record<string, unknown>
}> = [
  {
    id: "scope-conditions-and-custom-properties",
    // Covers: contains/isMediaScope, contains/isLayerScope, contains/isContainerScope,
    // contains/isCustomPropertyScope, references/isVariableRef, imports (quoted AND
    // unquoted url()). Every `imports` edge here is `import_based`, every
    // `references` edge is `import_based`, and every `contains` is `structural` —
    // so this one fixture carries two of the three evidence tiers.
    source: `@import "base.css";
@import url("theme.css");

@layer base {
  .btn {
    color: red;
  }
}

@media print {
  .only-print {
    display: none;
  }
}

@container (min-width: 400px) {
  .wide {
    color: blue;
  }
}

@supports (display: grid) {
  .grid-capable {
    display: grid;
  }
}

:root {
  --brand: #06c;
  --gap: 8px;
}

.btn {
  color: var(--brand);
  padding: var(--gap);
}
`,
    expectation: {
      fixtureId: "css/scope-conditions-and-custom-properties",
      language: "css",
      authoredBeforeAnalyzerRun: true,
      rationale:
        "Scope containment is the largest `contains` class in the corpus (7,601 @layer + 2,921 @media + 11 @container) and custom-property containment the second (3,999). The `var()` reads are the `references` class (13,218). Pinned together because they are the same shape seen from both sides: a rule both DECLARES a property and READS one. @import is pinned in both spellings — quoted and `url()` — because the unquoted form has no string_value node and was a real oracle bug once already.",
      expectSymbols: [
        { name: "@layer base", kind: "module" },
        { name: "@media print", kind: "module" },
        { name: "@container (min-width: 400px)", kind: "module" },
        // `@supports` is a CONDITIONAL SCOPE and emits the same `contains` edge.
        // It did not: 16 scope symbols were published and 0 rules attributed to them,
        // and the construct had never been in a 60-file sample until the rotation
        // drew one.
        { name: "@supports (display: grid)", kind: "interface" },
        { name: ".grid-capable", kind: "class" },
        { name: ".btn", kind: "class" },
        { name: ".only-print", kind: "class" },
        { name: ".wide", kind: "class" },
        { name: ":root", kind: "class" },
        { name: "--brand", kind: "variable" },
        { name: "--gap", kind: "variable" },
      ],
      expectRelationships: [
        { type: "imports", target: "base.css", line_number: 1, "meta.evidenceClass": "import_based", "meta.isCssImport": true },
        { type: "imports", target: "theme.css", line_number: 2, "meta.evidenceClass": "import_based", "meta.isCssImport": true },
        { type: "contains", target: ".btn", "meta.evidenceClass": "structural", "meta.isLayerScope": true },
        { type: "contains", target: ".only-print", "meta.evidenceClass": "structural", "meta.isMediaScope": true },
        { type: "contains", target: ".wide", "meta.evidenceClass": "structural", "meta.isContainerScope": true },
        { type: "contains", target: ".grid-capable", "meta.evidenceClass": "structural", "meta.isSupportsScope": true },
        { type: "contains", target: "--brand", "meta.evidenceClass": "structural", "meta.isCustomPropertyScope": true },
        { type: "contains", target: "--gap", "meta.evidenceClass": "structural", "meta.isCustomPropertyScope": true },
        { type: "references", target: "--brand", "meta.evidenceClass": "import_based", "meta.isVariableRef": true },
        { type: "references", target: "--gap", "meta.evidenceClass": "import_based", "meta.isVariableRef": true },
      ],
      expectErrorCount: [{ equals: 0 }],
      forbidRelationships: [
        // A property name is declaration payload, NOT a graph node (the ruling that
        // separates `--brand` from `color`). `color` must never appear as a target.
        { type: "contains", target: "color" },
        { type: "references", target: "color" },
        // `var()` reads must not be reported as `uses`: they are `references`.
        { type: "uses", target: "--brand" },
      ],
    },
  },
  {
    id: "keyframes-and-animation-uses",
    // Covers: uses/isAnimationRef (the `uses` class, usage_contextual) and the
    // keyframes declaration itself. The forward reference is deliberate: CSS does
    // not care about declaration order, and the analyzer is order-independent by
    // measurement (that was wave-2 work). Pinning the forward case is what stops a
    // future "optimisation" that resolves only backwards.
    source: `.spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

.fade {
  animation-name: spin;
  animation-duration: 2s;
}

.undeclared {
  animation: notInThisFile 1s;
}
`,
    expectation: {
      fixtureId: "css/keyframes-and-animation-uses",
      language: "css",
      authoredBeforeAnalyzerRun: true,
      rationale:
        "`uses` is the class the ontology work shrank from 34,727 edges at 6.0% resolution to 26 at 100%, so the small number is the point: every `uses` edge in this lane has both endpoints resolvable. Three cases are pinned — a forward reference (declared after use), a separate `animation-name` property, and a name this file does NOT declare. The last one is the one that matters: an animation can legitimately come from another stylesheet, and inventing an endpoint for it is the `global` phantom this lane already removed once.",
      expectSymbols: [
        { name: ".spinner", kind: "class" },
        // The NAME is the symbol, as a `function`, and the @keyframes STATEMENT is
        // deliberately not published as a module of its own. Measured, and it is an
        // asymmetry with @layer/@media rather than an inconsistency: a `@media` or
        // `@layer` is nameable ONLY by its own text, so it needs a module symbol to
        // be an edge endpoint at all, whereas a keyframes name is referenced from a
        // declaration (`animation: spin`) and the `uses` edge already connects the
        // reference to it. Publishing both would be two symbols for one thing.
        { name: "spin", kind: "function" },
        { name: ".fade", kind: "class" },
        { name: ".undeclared", kind: "class" },
      ],
      expectRelationships: [
        { type: "uses", target: "spin", line_number: 2, "meta.evidenceClass": "usage_contextual", "meta.isAnimationRef": true },
        { type: "uses", target: "spin", "meta.evidenceClass": "usage_contextual", "meta.isAnimationRef": true },
      ],
      forbidRelationships: [
        // Not declared in this file: there is no such symbol, so an edge to it
        // would be an endpoint nothing can resolve.
        { type: "uses", target: "notInThisFile" },
        // The keyframes sequence contains no property nodes, and `opacity` is
        // declaration payload like any other property.
        { type: "contains", target: "opacity" },
        { type: "uses", target: "from" },
        { type: "uses", target: "to" },
        // the keyframes STATEMENT is not a symbol; only its name is
        { name: "@keyframes spin" },
        { name: "spin", kind: "module" },
      ],
    },
  },
  {
    id: "selector-chains-and-nesting",
    // Covers: contains/isSelectorChain, contains/isNestedSelector +
    // isSynthesizedName + asWrittenSelector. Every edge here is `structural`.
    // The three negatives are the measured chain rules, and each is a case where
    // the OBACLE was wrong before the analyzer was consulted.
    source: `nav {
  color: black;
}

a {
  color: blue;
}

nav a {
  color: inherit;
}

.card {
  color: red;

  & .title {
    font-weight: bold;
  }

  .body {
    margin: 0;
  }
}

ul.square li {
  padding: 0;
}
`,
    expectation: {
      fixtureId: "css/selector-chains-and-nesting",
      language: "css",
      authoredBeforeAnalyzerRun: true,
      rationale:
        "The chain class is 419 edges in the corpus and every one of its rules was measured rather than assumed: all four combinators produce it; ADJACENT pairs are joined, not just the ends; the right part's qualifiers are dropped while the left part's are not; and each part must be a SINGLE simple selector, so a compound like `ul.square` is not a chain part. Nesting is pinned in both forms — explicit `& .title` and implicit `.body`, which CSS nests as a descendant and which an oracle handling only `&` drops entirely.",
      expectSymbols: [
        { name: "nav", kind: "type" },
        { name: "a", kind: "type" },
        { name: "nav a", kind: "type" },
        { name: ".card", kind: "class" },
        { name: ".card .title", kind: "class" },
        { name: ".card .body", kind: "class" },
        { name: "ul.square li", kind: "class" },
      ],
      expectRelationships: [
        // both endpoints resolve as their own symbols, so the chain joins them
        { type: "contains", from: "nav", target: "a", "meta.evidenceClass": "structural", "meta.isSelectorChain": true },
        // explicit nesting: the RESOLVED name, and `&` is the parent selector
        { type: "contains", from: ".card", target: ".card .title", "meta.evidenceClass": "structural", "meta.isNestedSelector": true, "meta.asWrittenSelector": "& .title" },
        // implicit nesting: `.body` under `.card` IS `.card .body`
        { type: "contains", from: ".card", target: ".card .body", "meta.evidenceClass": "structural", "meta.isNestedSelector": true },
      ],
      forbidRelationships: [
        // a COMPOUND part is a selector of its own, not a chain part
        { type: "contains", from: "ul.square", target: "li" },
        { type: "contains", from: "ul", target: "square li" },
        // the as-written `&` form is not a name anything can reference
        { type: "contains", from: ".card", target: "& .title" },
        // a chain does not imply the container contains the leaf's DECLARATIONS
        { type: "contains", from: "nav", target: "color" },
      ],
    },
  },
  {
    id: "font-faces-and-registered-properties",
    // Covers: uses/isFontFamilyRef and the @property symbol NAME. Both were
    // omissions the omission audit found, and both are the same class of defect:
    // a construct that is published but never CONNECTED, so the graph could
    // answer each half of a question and not the question.
    source: `@font-face {
  font-family: "Inter";
  src: url(inter.woff2) format("woff2");
}

@property --brand {
  syntax: "<color>";
  inherits: false;
  initial-value: #06c;
}

/* A rule that USES the family this file declares, before the declaration. */
.prose {
  font-family: "Inter", sans-serif;
  color: var(--brand);
}

/* A family this file does NOT declare — no endpoint may be invented. */
.other {
  font-family: "NotDeclared", serif;
}
`,
    expectation: {
      fixtureId: "css/font-faces-and-registered-properties",
      language: "css",
      authoredBeforeAnalyzerRun: true,
      rationale:
        "Two omissions, found by script/m14/tmp/css-omission-audit.ts rather than by a fixture. 1) A `font-family` naming a DECLARED `@font-face` emitted nothing, while the identical `animation` -> `@keyframes` path had been emitting since the order-dependence fix — 135 corpus files declare a `font-family`, 21 declare an `@font-face`, 344 family symbols were published and NOTHING connected them. 2) A `var(--brand)` read emitted `references` to `--brand` while the only published symbol was `@property --brand`, so the read pointed at a name nothing published — a dangling endpoint in a lane whose whole chain rule is that both ends resolve. The edge is also pinned to name the DECLARATION (`@font-face Inter`) rather than the bare family, because that is the published symbol; a bare `Inter` is an endpoint that resolves to nothing.",
      expectSymbols: [
        { name: "@font-face Inter", kind: "variable" },
        // the property's OWN NAME, so `var(--brand)` resolves to it
        { name: "--brand", kind: "variable" },
        { name: ".prose", kind: "class" },
        { name: ".other", kind: "class" },
      ],
      expectRelationships: [
        // line 14 is the `font-family` declaration, and the edge takes the VALUE's line
        // (M59.A7: the name is what is written in the value, not the property)
        { type: "uses", target: "@font-face Inter", line_number: 14, "meta.evidenceClass": "usage_contextual", "meta.isFontFamilyRef": true },
        // line 15 is the `var()` read
        { type: "references", target: "--brand", line_number: 15, "meta.evidenceClass": "import_based", "meta.isVariableRef": true },
      ],
      expectErrorCount: [{ equals: 0 }],
      forbidRelationships: [
        // not declared in this file: an endpoint may not be invented for it
        { type: "uses", target: "@font-face NotDeclared" },
        { type: "uses", target: "NotDeclared" },
        { type: "uses", target: "serif" },
        // the keyword-prefixed name is NOT published for @property, so nothing may
        // point at it
        { type: "references", target: "@property --brand" },
      ],
    },
  },
  {
    id: "layer-ordering-and-font-families",
    // Covers: the `@layer a, b, c;` ORDERING form, and the dedup against the block
    // form. The ordering statement used to publish ONE symbol named after the whole
    // statement text — `@layer reset, base, components` — which is a name with no
    // referent (M60 R7's placeholder-literal anti-pattern) and DUPLICATED the
    // individually declared layers, so the file carried both `@layer base` and
    // `@layer base, special` for the same layer.
    source: `@layer reset, base, components;

@layer base {
  .btn {
    color: red;
  }
}

@layer components {
  .card {
    color: blue;
  }
}
`,
    expectation: {
      fixtureId: "css/layer-ordering-and-font-families",
      language: "css",
      authoredBeforeAnalyzerRun: true,
      rationale:
        "A layer is ONE symbol however many times it is mentioned. The ordering statement declares the CASCADE POSITION of each layer, and that position rides the symbol as `layerIndex` rather than as file metadata — because `parseFile` rebuilds file metadata as a fresh literal of specific keys (engine.ts:1572, whose own comment records that an omitted key is computed and DISCARDED silently), so a file-level key added at the analyzer would never reach a consumer. The block form, when it comes second, corrects the range to the block so the symbol is located where its rules are. The ordering statement precedes the blocks in the normal order, which is what makes the dedup necessary rather than incidental.",
      expectSymbols: [
        { name: "@layer reset", kind: "module" },
        { name: "@layer base", kind: "module" },
        { name: "@layer components", kind: "module" },
        { name: ".btn", kind: "class" },
        { name: ".card", kind: "class" },
      ],
      // per-NAME, so it pins DEDUPE: a layer mentioned by an ordering statement AND
      // by a block must yield exactly one symbol, which is the defect this fixes
      expectSymbolCount: [
        { name: "@layer reset", equals: 1, kind: "module" },
        { name: "@layer base", equals: 1, kind: "module" },
        { name: "@layer components", equals: 1, kind: "module" },
      ],
      expectRelationships: [
        { type: "contains", target: ".btn", "meta.evidenceClass": "structural", "meta.isLayerScope": true },
        { type: "contains", target: ".card", "meta.evidenceClass": "structural", "meta.isLayerScope": true },
      ],
      expectErrorCount: [{ equals: 0 }],
      forbidSymbols: [
        // the placeholder-literal name: nothing can reference it
        { name: "@layer reset, base, components" },
      ],
    },
  },
  {
    id: "declarations-the-corpus-never-uses",
    // Covers: `@counter-style`, `@custom-media`, `@font-feature-values` and
    // `@scope` — the four constructs the corpus census reported NO OCCURRENCE for,
    // and which were therefore recorded as "not a defect" rather than measured.
    //
    // A probe then showed all four were broken. Three of them declared a named,
    // referable thing and published NOTHING: no symbol, so `list-style: thumbs`
    // had no endpoint, `@media (--narrow)` named itself by raw text, and
    // `font-feature-settings` had nothing to point at. That is the `@font-face` /
    // `@property` defect class a second time, and it survived precisely BECAUSE the
    // corpus was silent — which is the real cost of the NO OCCURRENCE label. It
    // means the corpus cannot speak about a construct, not that the construct
    // works. Three of three turned out to be broken.
    //
    // `@scope` was the fourth and the only one already working, pinned here so that
    // "unexercised" stops being a category anything can sit in.
    source: `@counter-style thumbs { system: cyclic; symbols: "X"; suffix: " "; }
@custom-media --narrow (max-width: 400px);
@custom-media --wide (min-width: 900px);
@font-feature-values Body Text {
  @styleset { nice: 12; }
}
@font-face { font-family: "Body Text"; src: url(body.woff2); font-feature-settings: "nice" }
@scope (.card) to (.content) {
  .card { color: red; }
}
ul { list-style: thumbs; }
@media (--narrow) { .a { color: red; } }
@media (--wide) { .b { color: blue; } }
.badge { font-feature-settings: "nice"; }
`,
    expectation: {
      fixtureId: "css/declarations-the-corpus-never-uses",
      language: "css",
      authoredBeforeAnalyzerRun: true,
      rationale:
        "Each of these at-rules DECLARES a named, referable thing, so each publishes a symbol and each use of it is an edge whose BOTH endpoints resolve — the same both-ends-must-resolve rule the chain, animation and font-family edges follow. `@custom-media` publishes the bare `--ident` and NOT `@custom-media --narrow (max-width: 400px)`, for the same reason `@property` publishes `--brand` and not `@property --brand`: the name is the referable part, the condition is its value. That also means a `@custom-media` symbol and a registered `@property` symbol are the same SHAPE, so each carries a metadata marker saying which construct declared it. `@font-feature-settings` is emitted ONLY inside a `@font-face`: a rule-level one is legal CSS, but which family's feature it names depends on the cascade, and emitting an edge there would invent an endpoint for something this lane cannot see — so the rule-level use in this fixture is deliberately the forbidden one.",
      expectSymbols: [
        { name: "@counter-style thumbs", kind: "variable", "meta.isCounterStyleDeclaration": true },
        { name: "--narrow", kind: "variable", "meta.isCustomMediaDeclaration": true },
        { name: "--wide", kind: "variable", "meta.isCustomMediaDeclaration": true },
        { name: "@font-feature-values Body Text", kind: "variable", "meta.isFontFeatureValuesDeclaration": true },
        { name: "@font-face Body Text", kind: "variable" },
        { name: "@scope (.card) to (.content)", kind: "module" },
        { name: "ul", kind: "type" },
        { name: "@media (--narrow)", kind: "module" },
        { name: "@media (--wide)", kind: "module" },
        { name: ".a", kind: "class" },
        { name: ".b", kind: "class" },
      ],
      expectSymbolCount: [
        // one symbol per declaration, however many times it is mentioned
        { name: "@counter-style thumbs", equals: 1, kind: "variable" },
        { name: "--narrow", equals: 1, kind: "variable" },
        { name: "@font-feature-values Body Text", equals: 1, kind: "variable" },
      ],
      expectRelationships: [
        { type: "uses", from: "ul", target: "@counter-style thumbs", "meta.isCounterStyleRef": true },
        { type: "references", from: "@media (--narrow)", target: "--narrow", "meta.isCustomMediaRef": true },
        { type: "references", from: "@media (--wide)", target: "--wide", "meta.isCustomMediaRef": true },
        { type: "uses", from: "@font-face Body Text", target: "@font-feature-values Body Text", "meta.isFontFeatureValuesRef": true },
        { type: "contains", from: "@scope (.card) to (.content)", target: ".card", "meta.isScopeScope": true },
      ],
      expectErrorCount: [{ equals: 0 }],
      forbidSymbols: [
        // the placeholder-literal name: the condition is the declaration's VALUE,
        // so nothing could ever resolve against it
        { name: "@custom-media --narrow (max-width: 400px)" },
        { name: "@font-feature-values @styleset" },
      ],
      forbidRelationships: [
        // a rule-level `font-feature-settings` names a feature of WHATEVER family
        // the cascade resolves for that element, which this lane cannot see
        { type: "uses", from: ".badge", target: "@font-feature-values Body Text" },
      ],
    },
  },
  {
    id: "repeated-selectors-are-one-symbol",
    // Found by the CSS MUTANTS, not by a corpus sweep: 11 of the 12 CSS mutants were
    // caught on the first run and the one that SURVIVED was `symbol-identity-collapsed`
    // — the lane's single largest measured defect, 36.6% of corpus files publishing an
    // ambiguous symbol. It survived because NO FIXTURE REPEATED A SELECTOR, so the
    // defect the whole identity rule exists to prevent was not pinned anywhere.
    //
    // That is the argument for mutants rather than fixtures: a fixture only proves
    // what its author thought to write down, and this class was 27,321 symbols wide
    // and entirely unpinned. The mutant asked what the suite could NOT fail on, and
    // the answer was the lane's biggest bug.
    source: `.btn { color: red; }
.btn { padding: 4px; }
.btn:hover { color: blue; }
.btn::before { content: ""; }
.card { border: 0; }
.card { margin: 0; }
`,
    expectation: {
      fixtureId: "css/repeated-selectors-are-one-symbol",
      language: "css",
      authoredBeforeAnalyzerRun: true,
      rationale:
        "Identity is `(kind, resolved name)`, so a selector written N times is ONE symbol and the repetitions are provenance, not nodes. Before the fix identity was the node's own RANGE, so every rule re-published its selector: 36.6% of corpus files carried an ambiguous name, the same selector up to 12 times, and a `contains` edge addressed one of N indistinguishable rows — so \"what is inside this rule\" had no single answer. The pins are per-NAME rather than a total, because a total would also pass if the lane published `.btn` once and `.btn:hover` zero times. `.btn:hover` and `.btn::before` are separate symbols: a pseudo-class is part of the selector's identity, not a variant of the base rule's identity.",
      expectSymbols: [
        { name: ".btn", kind: "class" },
        { name: ".btn:hover", kind: "class" },
        { name: ".btn::before", kind: "class" },
        { name: ".card", kind: "class" },
      ],
      expectSymbolCount: [
        // each written TWICE in the source, each pinned at exactly ONE symbol
        { name: ".btn", equals: 1, kind: "class" },
        { name: ".card", equals: 1, kind: "class" },
        { name: ".btn:hover", equals: 1, kind: "class" },
        { name: ".btn::before", equals: 1, kind: "class" },
      ],
      expectErrorCount: [{ equals: 0 }],
    },
  },
  {
    id: "error-recovery-is-reported",
    // Found by the SECOND surviving CSS mutant, `parse-errors-swallowed`, and it is
    // the more important of the two: every other CSS fixture pinned
    // `expectErrorCount: 0`, which is SATISFIED BY AN EMPTY ARRAY. So the whole suite
    // could not tell \"this file parsed cleanly\" from \"this file failed and the
    // failure was swallowed\" — and swallowing is what a silently-truncated
    // extraction looks like to every gate that does not read the errors array.
    //
    // Two fixtures also pinned no error count at all, which is a third state with no
    // claim in it; both now pin one.
    source: `@page :first { margin: 1cm; }

.recovered { color: red; }

@page :left { margin: 2cm; }
`,
    expectation: {
      fixtureId: "css/error-recovery-is-reported",
      language: "css",
      authoredBeforeAnalyzerRun: true,
      rationale:
        "A named page selector (`@page :first`) is unreadable by the pinned grammar, and it is a DECLARED residual rather than an accident. The pin is `atLeast: 1` and not the measured count on purpose: an exact number would fail the moment the grammar learned `@page :first`, and a fixture that breaks when the lane improves is a fixture that gets deleted instead of fixed. What must stay true is that the failure is REPORTED. The positive half is that `.recovered` — a valid rule between two unreadable at-rules — is still extracted, which is what error recovery is FOR: a construct failing to parse and a construct being lost are different claims, and only the first is true here.",
      expectSymbols: [
        { name: ".recovered", kind: "class" },
      ],
      // the failure must be visible, and must not be pinned to a count a grammar
      // fix would invalidate
      expectErrorCount: [{ atLeast: 1 }],
    },
  },
  {
    id: "ie-filter-arguments",
    // PINS GRAMMAR PATCH 3/3. A grammar patch with no fixture can be silently
    // reverted: the pin gate proves the wasm is a BUILD of the vendored source, so
    // reverting the hunk AND rebuilding still satisfies source↔wasm — only a fixture
    // that parses this source catches it. `expectErrorCount: [{equals: 0}]` is the
    // whole assertion: before the patch this file was four ERROR nodes.
    source: `.gradient {
  filter: progid:DXImageTransform.Microsoft.gradient(startColorStr = '#ffffff', EndColorStr = '#000000');
}

@supports (display: grid) {
  .grid {
    display: grid;
  }
}
`,
    expectation: {
      fixtureId: "css/ie-filter-arguments",
      language: "css",
      authoredBeforeAnalyzerRun: true,
      rationale:
        "An IE filter argument is a `name = value` PAIR, and `parenthesized_value` allowed exactly one value, so the whole argument list was an ERROR. Measured A/B over 533 corpus files in 13 repositories: 61 error files -> 24, 37 fixed, 0 regressed, 0 collateral, grails-core 20.94% -> 1.57%. The first attempt (adding `=` to `arguments`' separators) was provably inert and is recorded in the review so it is not written twice. This file also carries an `@supports` block, because that class was a second omission the corpus rotation exposed — 16 scopes published, 0 rules attributed.",
      expectSymbols: [
        { name: ".gradient", kind: "class" },
        { name: "@supports (display: grid)", kind: "interface" },
        { name: ".grid", kind: "class" },
      ],
      expectRelationships: [
        { type: "contains", target: ".grid", "meta.evidenceClass": "structural", "meta.isSupportsScope": true },
      ],
      // the assertion that pins the grammar patch
      expectErrorCount: [{ equals: 0 }],
    },
  },
  {
    id: "complexity-matrix",
    // Matrix 1b, the one row css can honestly fill. `complexity` was a literal 1
    // for every symbol in this lane (measured 9,338 of 9,338), so a `>= 1` check
    // was vacuous. These are the measured terms: a combinator, a pseudo-class or
    // element, an attribute selector, an extra step for a FUNCTIONAL pseudo, and
    // nesting depth. A comma group aggregates as MAX, mirroring how specificity
    // aggregates the same group.
    source: `.plain {
  color: red;
}

.one-class {
  color: red;
}

div > p {
  color: red;
}

a:hover {
  color: red;
}

a[href] {
  color: red;
}

li:not(.skip) {
  color: red;
}

.a,
.b {
  color: red;
}

main > section:where(.wide) ul li {
  color: red;
}
`,
    expectation: {
      fixtureId: "css/complexity-matrix",
      language: "css",
      authoredBeforeAnalyzerRun: true,
      rationale:
        "The metric is only useful if it can tell these apart, and it could not while it was a literal 1. Each rule is one term further than the last, and the last two are the ones a reviewer actually pays for: a functional pseudo-class is counted FROM its `pseudo_class_arguments` node (so `:where(.wide)` costs a step for the selector inside it, not for the word `where`), and a comma group is no dearer than its worst member.",
      expectSymbols: [
        { name: ".plain", kind: "class" },
        { name: ".one-class", kind: "class" },
        // a chain of BARE TAGS is a `type`, not a `class` — measured: `nav a` and
        // `div > p` are both `type`, while `a:hover` and `a[href]` are `class`
        // because a pseudo or an attribute qualifies the selector.
        { name: "div > p", kind: "type" },
        { name: "a:hover", kind: "class" },
        { name: "a[href]", kind: "class" },
        { name: "li:not(.skip)", kind: "class" },
        { name: ".a, .b", kind: "class" },
        { name: "main > section:where(.wide) ul li", kind: "class" },
      ],
      // The house shape: an array of {symbol, equals}, read off the symbol's
      // contract field. `equals` rather than `min` because a metric that can only
      // assert a floor cannot catch a metric that has stopped discriminating —
      // which is exactly how the dead functional-pseudo term survived.
      expectComplexity: [
        { comment: "a single compound selector: the base and nothing else", symbol: ".plain", equals: 1 },
        { symbol: ".one-class", equals: 1 },
        { comment: "one child combinator", symbol: "div > p", equals: 2 },
        { comment: "one pseudo-class", symbol: "a:hover", equals: 2 },
        { comment: "one attribute selector", symbol: "a[href]", equals: 2 },
        // a pseudo AND a functional pseudo: `:not()` carries a selector, so it is
        // two steps. This is the case the dead `pseudo_class_arguments` predicate
        // scored as 2.
        { symbol: "li:not(.skip)", equals: 3 },
        { comment: "a comma group is no dearer than its worst member", symbol: ".a, .b", equals: 1 },
        // 1 base + 3 combinators (`>`, and the two implicit descendants) +
        // 1 pseudo + 1 for the selector :where() carries inside it = 6
        { symbol: "main > section:where(.wide) ul li", equals: 6 },
      ],
      expectErrorCount: [{ equals: 0 }],
    },
  },
]

// ── the matcher, per run-fixtures.ts's documented semantics ─────────────────

type Entry = Record<string, any>

function matchConstraints(actual: Entry, want: Entry): boolean {
  for (const [k, v] of Object.entries(want)) {
    if (k === "comment" || k === "note") continue
    if (k === "line_number" && v === null) {
      if (actual.line_number !== undefined && actual.line_number !== null) return false
      continue
    }
    if (k === "confidenceMin") { if (!(typeof actual.confidence === "number" && actual.confidence >= v)) return false }
    else if (k === "confidenceMax") { if (!(typeof actual.confidence === "number" && actual.confidence <= v)) return false }
    else if (k.endsWith("EndsWith")) {
      const field = k.slice(0, -"EndsWith".length)
      const aliases: Record<string, string[]> = { target: ["target", "to", "toSymbol"], from: ["from", "source", "fromSymbol"] }
      const vals = (aliases[field] ?? [field]).map((a) => actual[a]).filter((x) => typeof x === "string")
      if (!vals.some((x) => x.endsWith(v))) return false
    } else if (k.startsWith("meta.")) {
      const mk = k.slice(5)
      const mv = (actual.metadata ?? {})[mk]
      if (Array.isArray(v)) {
        if (!Array.isArray(mv)) return false
        if (JSON.stringify([...mv].sort()) !== JSON.stringify([...v].sort())) return false
      } else if (v === null) {
        if (mv !== undefined && mv !== null) return false
      } else if (mv !== v) return false
    } else if (actual[k] !== v) {
      const aliases: Record<string, string[]> = {
        from: ["from", "source", "fromSymbol"],
        target: ["target", "to", "toSymbol"],
        type: ["type", "relationshipType"],
      }
      const alt = aliases[k]
      if (alt && alt.some((a) => actual[a] === v)) continue
      return false
    }
  }
  return true
}

// ── verify ─────────────────────────────────────────────────────────────────

async function verify(dir: string): Promise<number> {
  let failures = 0
  const files = readdirSync(dir).filter((f) => f.endsWith(".css"))
  for (const f of files) {
    const id = f.replace(/\.css$/, "")
    const src = readFileSync(join(dir, f), "utf8")
    const exp: Entry = JSON.parse(readFileSync(join(dir, `${id}.expectation.json`), "utf8"))
    const r: any = await ASTEngine.parseFile(f, src)
    const syms: Entry[] = (r.symbols ?? []).map((s: any) => ({ ...s, metadata: s.metadata ?? {} }))
    const rels: Entry[] = (r.relationships ?? []).map((x: any) => ({ ...x, metadata: x.metadata ?? {} }))
    const problems: string[] = []

    for (const want of exp.expectSymbols ?? []) {
      if (!syms.some((a) => matchConstraints(a, want))) problems.push(`symbol ${JSON.stringify(want)} matched nothing`)
    }
    for (const want of exp.forbidSymbols ?? []) {
      if (syms.some((a) => matchConstraints(a, want))) problems.push(`forbidSymbol ${JSON.stringify(want)} DID match`)
    }
    for (const want of exp.expectRelationships ?? []) {
      if (!rels.some((a) => matchConstraints(a, want))) problems.push(`relationship ${JSON.stringify(want)} matched nothing`)
    }
    for (const want of exp.forbidRelationships ?? []) {
      if (rels.some((a) => matchConstraints(a, want))) problems.push(`forbidRelationship ${JSON.stringify(want)} DID match`)
    }
    // the house shape: an array of {symbol, equals|min}
    for (const want of (exp.expectComplexity ?? []) as any[]) {
      if (!want.symbol) continue
      const a = syms.find((s) => s.name === want.symbol)
      if (!a) { problems.push(`expectComplexity: symbol ${JSON.stringify(want.symbol)} not found`); continue }
      // the SAME field run-fixtures.ts reads (line 578) — reading metadata as a
      // fallback here is how a shape mismatch between analyzer and harness hides
      const got = a.complexity
      if (want.equals !== undefined && got !== want.equals) {
        problems.push(`expected ${want.symbol} complexity ${want.equals}; got ${got}`)
      }
      if (want.min !== undefined && !(typeof got === "number" && got >= want.min)) {
        problems.push(`expected ${want.symbol} complexity >= ${want.min}; got ${got}`)
      }
    }
    // house shapes: BOTH are arrays (run-fixtures.ts:859, :872)
    for (const want of (exp.expectSymbolCount ?? []) as any[]) {
      const n = syms.filter((x: any) => x.name === want.name && (want.kind === undefined || x.kind === want.kind)).length
      if (want.equals !== undefined && n !== want.equals) {
        problems.push(`expected ${want.equals} symbol(s) named ${JSON.stringify(want.name)}; got ${n}`)
      }
    }
    for (const want of (exp.expectErrorCount ?? []) as any[]) {
      const n = (r.errors ?? []).length
      if (want.equals !== undefined && n !== want.equals) problems.push(`expected ${want.equals} parse error(s); got ${n}`)
      if (want.atMost !== undefined && !(n <= want.atMost)) problems.push(`expected at most ${want.atMost} parse error(s); got ${n}`)
    }
    if (problems.length) {
      failures++
      console.log(`\nFAIL ${id}`)
      for (const p of problems) console.log(`   - ${p}`)
      console.log(`   actual: ${syms.length} symbol(s), ${rels.length} relationship(ise), ${(r.errors ?? []).length} error(s)`)
    } else {
      console.log(`pass ${id}  (${syms.length} symbols, ${rels.length} relationships, ${(r.errors ?? []).length} errors)`)
    }
  }
  return failures
}

// ── main ───────────────────────────────────────────────────────────────────

if (args.includes("--verify")) {
  const dir = args.includes("--out") ? args[args.indexOf("--out") + 1] : STAGE
  if (!existsSync(dir)) { console.error(`no staged fixtures at ${dir}`); process.exit(1) }
  const failures = await verify(dir)
  console.log(failures ? `\n${failures} fixture(s) FAILED` : "\nall fixtures pass")
  process.exit(failures ? 1 : 0)
}

mkdirSync(outDir, { recursive: true })
for (const fx of FIXTURES) {
  writeFileSync(join(outDir, `${fx.id}.css`), fx.source)
  writeFileSync(join(outDir, `${fx.id}.expectation.json`), JSON.stringify(fx.expectation, null, 2) + "\n")
}
console.log(`wrote ${FIXTURES.length} fixture(s) to ${outDir}`)
console.log("NOT installed into validation/m14/fixtures/css — a fixture directory no runner lane")
console.log("claims is an ORPHAN and fails the full fixture run (exit 6). Install with:")
console.log('  css: { wasm: "tree-sitter-css.wasm", analyzerFile: "real-css-analyzer", className: "RealCssAnalyzer", ext: "css" },')
console.log("added to script/m14/run-fixtures.ts's LANGS, in the same commit as the directory.")
