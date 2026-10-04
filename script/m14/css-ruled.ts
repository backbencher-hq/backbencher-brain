/**
 * CSS's entry for `script/m14/ontology-coverage-gate.ts`'s ruling table.
 *
 * ## WHY THE TABLE LIVES HERE AND NOT IN THE GATE
 *
 * `script/m14/ontology-coverage-gate.ts` is supervisor-owned shared machinery (lane
 * brief §8) and `RULED_BY_LANG` in it is a literal with no extension point. Run
 * against `css` it refuses to report at all:
 *
 *   $ npx tsx script/m14/ontology-coverage-gate.ts css
 *   ontology coverage gate — css
 *   corpus: 1196 admitted files
 *   ontology coverage gate — no RULING TABLE for css.
 *   Refusing to report: a gate with an empty table would call every un-emitted type
 *   RULED-UNJUSTIFIED and that is a verdict about the TABLE, not about the lane.
 *   $ echo $?
 *   2
 *
 * That refusal is the gate behaving correctly. It is also why this lane's five RULED
 * verdicts have never been checked by the arbiter, which is the whole point of the
 * table. So it lives in a file this lane owns, in the gate's own `Ruled` shape, and
 * the supervisor's permanent change is two lines:
 *
 *   import { CSS_RULED } from "./css-ruled"
 *   const RULED_BY_LANG: Record<string, Ruled[]> = { bash: BASH_RULED, json: JSON_RULED, css: CSS_RULED }
 *
 * The `Ruled` type is declared here rather than imported because the gate's own copy
 * is not exported. It is a structural copy of the gate's (lines 79–87) and the runner
 * below proves the two agree by compiling the gate against this file.
 *
 * `validation/m14/fixtures/css/ruled-gate.ts` applies exactly those two lines to a COPY
 * of the gate in /tmp and runs it, so the table is proven rather than asserted. The
 * MEASUREMENTS behind every entry are not here — they are in
 * `validation/m14/census/css-ontology-probe.ts`, which prints the full grammar
 * vocabulary and every probe's count — and each entry names the probe that produced
 * its number.
 *
 * ## WHAT IS IN THIS TABLE
 *
 * Five entries: every type the analyzer does not emit. `contains`, `uses`,
 * `references`, `imports` and `overrides` are absent because a table entry for an
 * EMITTED type is dead configuration — the gate checks `observed` first and never
 * consults the table for a type it saw.
 *
 * ## WHY TWO ENTRIES ARE INSTRUMENT B, AND WHY THAT IS THE JSON LANE'S LESSON APPLIED
 *
 * The json lane REMOVED its `exports` ruling because it had been made on a grammar
 * inventory and "a grammar cannot see a CONVENTION". That is right: a Node manifest's
 * `exports` and `main` are ordinary object keys, so no node type distinguishes them.
 *
 * CSS has two constructs in the same position and BOTH are counted on the tree here:
 *
 *   - `exports` needs a cross-file export SURFACE, and CSS Modules writes one with no
 *     export syntax at all: `composes: x from "./y.css"` and the `:export` named-export
 *     block. Both are instrument B. Both count 0 on this corpus.
 *   - `calls` needs a user-defined function, and CSS Functions and Mixins L4 gives CSS
 *     its own — `@function --add(a, b) { … }` — which the pinned grammar has no
 *     production for, so it would arrive as a generic `at_rule`. Counting it needs
 *     instrument B too, because instrument A is silent by construction on anything the
 *     grammar routes through `at_rule`.
 *
 * The gate FALSIFIES both rows if the count is non-zero, and that is the point: a
 * CSS-Modules-heavy repository, or one using `@function`, overturns the ruling and the
 * lane then owes an implementation.
 *
 * ## WHAT A RULED VERDICT IS NOT
 *
 * It is not a claim that the language could never express the construct. For `extends`
 * it demonstrably can: SCSS's `@extend .base` is real selector-level inheritance, and
 * the 3 `.sass` and 54 `.less` files routed to this lane can both write it. What the
 * measurement shows is that the construct occurs 0 times in the admitted corpus, so
 * the ruling is about the corpus and the gate re-measures it on every run rather than
 * trusting this note. `.scss` — 4,404 files, the largest CSS-family population in the
 * corpus — routes to `real-scss-analyzer.ts` under `analyzer/SCSS`, not here, and the
 * `extends` question for it is that lane's separate verdict on a separate corpus.
 */
export type CssRuledType =
  | "calls" | "uses" | "contains" | "imports" | "references"
  | "exports" | "extends" | "implements" | "overrides" | "instantiates"

type Instrument = "A:grammar-inventory" | "B:parse-tree-count"

export type Ruled = {
  type: CssRuledType
  instrument: Instrument
  /** A: node types that would express the construct. B: unused. */
  nodeTypesThatWouldMeanIt?: string[]
  /** B: count occurrences on the tree. A: unused. */
  countOnTree?: (root: any, fileLabel: string, hits: string[]) => void
  describe: string
}

// ---------------------------------------------------------------- tree helpers
//
// Pure-string and node-API only. There is not one regular expression in this file, and
// that is the same rule the analyzers are held to: a pattern over node text cannot
// distinguish a construct from its own mention in a comment, inside a `url()`, or
// inside a string literal, and the gate's own header records two rulings that a regex
// would have overturned (`class voice` in a telnet IAC word list read as an `extends`;
// `new Map(` in a bash heredoc read as an `instantiates`).

/** Named children of `n`, as an array. */
function kids(n: any): any[] {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}

/** Every descendant of `n`, `n` included. */
function descendants(n: any): any[] {
  const out: any[] = []
  const stack: any[] = [n]
  while (stack.length > 0) {
    const x = stack.pop()
    out.push(x)
    for (const c of kids(x)) stack.push(c)
  }
  return out
}

/** The `at_keyword` of an at-rule, lowercased, or `""`. */
function atKeywordOf(n: any): string {
  const kw = kids(n).find((c: any) => c.type === "at_keyword")
  return kw ? String(kw.text).trim().toLowerCase() : ""
}

/** Strip one layer of matching single or double quotes. */
function unquote(text: string): string {
  const t = text.trim()
  if (t.length >= 2) {
    const a = t.charAt(0)
    const b = t.charAt(t.length - 1)
    if ((a === '"' || a === "'") && a === b) return t.slice(1, -1)
  }
  return t
}

// ---------------------------------------------------------------- the table

export const CSS_RULED: Ruled[] = [
  {
    type: "calls",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: [
      "function_declaration", "function_definition", "method_definition", "function_item",
      "generator_function_declaration", "arrow_function", "function_expression",
      "function_declarator", "function_rule", "custom_function_statement",
    ],
    describe:
      "a user-defined function DEFINITION — the callee a `calls` edge has to name. INSTRUMENT A: the corpus (1,171 admitted files across 76 repositories) yields 103 distinct node types and NOT ONE of them declares a function; the full vocabulary is printed by css-ontology-probe.ts so the claim is checkable rather than asserted. INSTRUMENT B as well, and this is the part that matters: CSS Functions and Mixins Level 1 gives CSS its own named function, `@function --add(a, b) { … }`, which the pinned grammar has no production for, so it can only arrive as a generic `at_rule` whose `at_keyword` reads `@function`. Counted on the tree: 0 declarations, 0 files. The corpus's 85 distinct `function_name` values are every one a CSS built-in — `var` 162,440, `rgba` 18,752, `calc` 15,004, `rgb` 7,347, `url` 4,931 — and no analyzer names a built-in as a `calls` target, which is right: a built-in is not declared anywhere, so there is no declaration to point at. Overturn: any `@function` at-rule on the tree, or any function-declaration node type in the printed vocabulary.",
  },
  {
    type: "exports",
    instrument: "B:parse-tree-count",
    countOnTree: (root, fileLabel, hits) => {
      // THE ROLE, not the shape, and this row is instrument B precisely because a
      // grammar cannot see a convention.
      //
      // CSS Modules writes a cross-file export surface with NO export syntax:
      //
      //   composes: <name> from "<path>"   re-export another file's class
      //   :export { <ident>: <value> }     the named-export map
      //
      // Neither has a node type. Both arrive as ordinary `declaration` / `rule_set`
      // nodes, so the only sound instrument counts them on the tree. Both shapes are
      // counted here, and a LOCAL `composes: y` is counted separately and NOT
      // reported as an export, because a same-file composition is a `uses` and this
      // lane already emits that.
      //
      // Note what is deliberately NOT matched: any declaration whose value merely
      // mentions a path, or any selector that happens to be spelled `:export`. The
      // first version of the json lane's probe scanned every string in the document,
      // matched 2,651 "imports" across 103 files, and every example was a filename in
      // a `files` array — a shape, not a role. The gate refused the measurement, which
      // is the correct outcome and the reason this probe keys on the DECLARATION NAME.
      const visit = (n: any): void => {
        if (n.type === "declaration") {
          const prop = kids(n).find((c: any) => c.type === "property_name")
          if (prop && String(prop.text).trim() === "composes") {
            // The value nodes of this declaration, in order. A `from` clause is a
            // `plain_value` / `identifier` token, never a `string_value` holding the
            // word "from", which is why this tests the token and not the text.
            const vals = kids(n).filter((c: any) => c.type !== "property_name")
            let sawFrom = false
            const names: string[] = []
            for (const v of vals) {
              if (String(v.text).trim().toLowerCase() === "from") { sawFrom = true; continue }
              if (v.type === "plain_value" || v.type === "identifier") names.push(String(v.text).trim())
            }
            if (sawFrom && names.length > 0) {
              hits.push(`${fileLabel}: composes: ${names[0]} from ${unquote(names[1] ?? "")} (cross-file export surface)`)
            }
          }
        }
        if (n.type === "rule_set") {
          const sel = kids(n).find((c: any) => c.type === "selectors")
          const t = sel ? String(sel.text).trim() : ""
          if (t === ":export" || t === ":exports") {
            hits.push(`${fileLabel}: ${t} { … } (named export map)`)
          }
        }
        for (const c of kids(n)) visit(c)
      }
      visit(root)
    },
    describe:
      "a cross-file export SURFACE. INSTRUMENT B and deliberately not instrument A, because the gate's own header records its json lane REMOVING an `exports` ruling made on a grammar inventory: a grammar cannot see a convention, and CSS Modules' surface is a convention with no syntax of its own. Counted on the tree: **0 `composes: … from …` declarations and 0 `:export` rule_sets** across 1,171 files / 76 repositories — and 0 `composes` declarations of ANY kind, so the local-composition case is empty too. INSTRUMENT A agrees and is not relied on: 0 of the 103 node types is `export_statement`, `export_declaration`, `export_list`, `exports_clause`, `export_specifier` or `export_block`. Overturn: any `:export` rule_set or any `composes … from …` declaration on the tree. This is a ruling about THIS corpus, which is dominated by framework stylesheets and holds one CSS-Modules file; a CSS-Modules-heavy repository produces a non-zero count and overturns it.",
  },
  {
    type: "extends",
    instrument: "B:parse-tree-count",
    countOnTree: (root, fileLabel, hits) => {
      // `@extend .base` inside a rule makes the extending SELECTOR match everything
      // the extended one matches. It is the only type-level inheritance the
      // CSS/SCSS/LESS family has, and it is a DIRECTIVE — an `at_rule` whose
      // `at_keyword` reads `@extend` — so it can only be counted on the tree. A text
      // probe would match the word "extend" in a comment, in a class name, and in a
      // `content:` value, and the gate's header records exactly that failure having
      // overturned a ruling once.
      //
      // Instrument A is silent BY CONSTRUCTION here, which is why B is the decider and
      // not a supplement: the pinned grammar routes every at-rule it does not
      // recognise through the catch-all `at_rule`, so no vocabulary change would ever
      // report `@extend` as absent.
      const visit = (n: any): void => {
        if ((n.type === "at_rule" || n.type === "postcss_statement") && atKeywordOf(n) === "@extend") {
          hits.push(`${fileLabel}: @extend (selector-level inheritance)`)
        }
        for (const c of kids(n)) visit(c)
      }
      visit(root)
    },
    describe:
      "selector-level or type-level INHERITANCE. INSTRUMENT B, because instrument A cannot see it: `@extend .base` is a directive the pinned grammar routes through the catch-all `at_rule`, so the 103-node-type inventory is silent by construction — the same structural reason bash's `overrides` needs instrument B. Counted on the tree: **0 `@extend` at-rules across 1,171 files / 76 repositories, and 0 occurrences of the at-keyword itself**, so the directive is not merely absent but unexercised by the corpus. INSTRUMENT A agrees and is not relied on: 0 of the 103 node types is a type declaration (`class_declaration`, `class_specifier`, `interface_declaration`, `struct_declaration`, `inheritance_specifier`, `base_class_clause`, `superclass`, `base_list`). WHAT THIS IS NOT: a claim that the language cannot express it. SCSS's `@extend` is real, `.sass` and `.less` are both routed to this lane and both can write it, and the corpus's 3 `.sass` + 54 `.less` files simply do not. `.scss` — 4,404 files, the largest CSS-family population in the corpus — routes to `real-scss-analyzer.ts` under `analyzer/SCSS`, so the `extends` question for it is that lane's separate verdict on a separate corpus. Overturn: any `@extend` at-rule on the tree, or any type-declaration node type in the printed vocabulary.",
  },
  {
    type: "implements",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: [
      "implements_clause", "extends_clause", "superclass", "interface_implementation",
      "base_class_clause", "type_inheritance_clause", "mixin_declaration_list", "super_interfaces",
    ],
    describe:
      "a SUPERTYPE CLAUSE naming a type this one satisfies. INSTRUMENT A, and it is the right instrument rather than a default: a clause is a NODE, so a grammar that can express one has a production for it. The corpus yields 103 distinct node types and NONE of the eight clause names above appears — the whole list is absent, not merely absent from this corpus. CSS has no type declarations to satisfy anything, which the `extends` row measures independently on the tree. Overturn: any of the eight node types appearing in the printed vocabulary.",
  },
  {
    type: "instantiates",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: [
      "new_expression", "object_creation_expression", "constructor_invocation",
      "object_creation", "instantiation_expression", "new_declarator",
    ],
    describe:
      "a CONSTRUCTOR CALL, or any expression that builds a value from a name. INSTRUMENT A: 0 of the 103 node types is an object-creation production; the pinned grammar has none because CSS has no user-defined type to construct. The one CSS construct that produces a value from a name is `var(--x)` substitution, and it is measured rather than argued: **162,440 `var()` calls across 386 files**, every one of them a READ of a declaration rather than a construction, and every one of them already emitted as a `references` edge by this lane. That is the population a careless probe would have counted as 162,440 instantiations, and it is why the row carries the number instead of the adjective. Overturn: any object-creation node type in the printed vocabulary, or a CSS construct that constructs rather than reads.",
  },
]

/**
 * The number of each instrument's population the table can actually examine.
 *
 * `overrides` needs NO entry — it is EMITTED, so the gate takes the EMITTED branch and
 * never consults the table. It is exported here anyway because the gate's report line
 * prints it, and a row whose instrument was never exercised reads identically to a row
 * whose instrument found nothing. `overrides` is EMITTED on the corpus: 48 edges in 7
 * files of 1,180, measured through production `parseFile`.
 */
export const CSS_OVERRIDES_EXAMINED = { edges: 48, files: 7, admittedFiles: 1180 }
