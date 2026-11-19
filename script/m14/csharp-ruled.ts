/**
 * CSHARP_RULED — the ruling table `script/m14/ontology-coverage-gate.ts` needs before it will
 * report this lane at all.
 *
 * Before this file existed, `ontology-coverage-gate.ts csharp` could not render a verdict for
 * the three relationship types C# does not emit: `RULED_BY_LANG` had no `csharp` key, so
 * `rulingFor()` found nothing tabled and fell through to the spec, and the two rulings that
 * WERE correct lived only as prose in `script/m14/spec/csharp-completeness.json`. A ruling a
 * reader cannot run is a ruling nobody applies — the same defect the gate's own header records
 * for html/javascript/svelte, whose tables were committed but unregistered.
 *
 * ## What is in here, and why it is TWO entries and not three
 *
 * The spec excludes three types. They do not have the same reason, and this file separates them
 * because the gate's verdict depends on the instrument:
 *
 *   `decorates`  NOT RULED HERE. It is EMITTED (P0-1 of this close-out implemented it). The
 *                spec's old exclusion was ruled on grammar-absence reasoning while C#'s grammar
 *                produces `attribute`, `attribute_list` AND `attribute_argument` — measured, not
 *                argued: `validation/m14/measurements/csharp-grammar-nodes.json` (239 named /
 *                533 ids, written by `script/m14/grammar-node-inventory.ts`). An emitted type
 *                never reaches a ruling; the gate finds EMITTED from observation first.
 *
 *   `mixes_in`   RULED, instrument A (grammar inventory). C# has exactly ONE supertype
 *                mechanism — the base list — and it is already published as `extends` (first
 *                base) + `implements` (the rest). A mixin would need a supertype composition
 *                that is neither, and C# has no such construct. The ruling is ONTOLOGICAL, not
 *                an absence: `with_expression` is record-update on an instance, not supertype
 *                composition, so it is not a near miss to be generous about.
 *
 *   `part_of`    RULED, instrument A (grammar inventory). C# has no syntax that names ANOTHER
 *                FILE as part of this compilation unit: no `part_*` node type, and 0
 *                `#include`/`#import` directives across the whole admitted corpus. `partial`
 *                splits ONE type across declarations that merge into one symbol, so a `part_of`
 *                row would read `X -> X` and carry no information.
 *
 * ## The attribute-keys space, and why it is declared
 *
 * The gate refuses a vocabulary-based ruling when the corpus writes key/value bindings and the
 * ruling did not declare the `attribute-keys` space — the HCL lesson, where `inherits = [...]`
 * hid 44 inheritance sites from a node-type inventory. MEASURED for C# with the gate's own
 * detector (a node with >= 3 children whose SECOND child is `=` or `:`), over 300 files of the
 * admitted corpus: **8,402 key/value bindings** — `variable_declarator` 3,722,
 * `assignment_expression` 3,033, **`attribute_argument` 1,325**, `enum_member_declaration` 148,
 * `argument` 134, `switch_section` 40. Probe: `.scratch/keyspace.ts`.
 *
 * C# therefore DOES write that space, and both entries declare it. This is not a formality: the
 * 1,325 `attribute_argument` sites are precisely the `decorates` population, so the space that
 * a naive inventory would miss is the one carrying this close-out's largest finding.
 *
 * ## The falsifiers, stated so they can fire
 *
 *   `mixes_in`  — overturned if C#'s grammar ever produces a node type that composes a type into
 *                 another type's SUPERTYPE CHAIN and is neither its first base nor one of its
 *                 interfaces. Checked against the 239-name inventory; none of the probed names
 *                 is present. A base-list entry that names something other than a class or an
 *                 interface would also overturn it.
 *
 *   `part_of`   — overturned if C# grows a file-inclusion directive (a `part`/`include` node
 *                 type, or a directive naming a `.cs` file). The corpus sweep that would show
 *                 one is: `grep -rn '^\s*#\(include\|import\)' --include='*.cs'` over the
 *                 admitted corpus, which returned 0; and the grammar inventory, which lists no
 *                 `part_*` name.
 *
 * ## Nothing here is a resolution complaint
 *
 * The lane's open items — `overrides` at 0.5 over 22 first-parent guesses, `uses` at 0.7 over
 * the field-access half, and the 490,456-edge ambiguous population — are all cases where the
 * type IS emitted. They are a different axis from the one this table adjudicates, and writing
 * them here would convert a resolution defect into an inapplicability claim. They stay in
 * `docs/analyzers/csharp.md` and `validation/m14/reviews/`.
 */
import type { Ruled as GateRuled } from "./ontology-coverage-gate"

/**
 * The gate's `Ruled` type parameterises `type` over ITS OWN ten-value `ALL_TYPES`
 * (`ontology-coverage-gate.ts:99`), so an entry for one of the four EXTENDED values cannot be
 * expressed against it. This file therefore restates the pair — the same widening
 * `script/m14/clean-ruled.ts` performs and the same reason: the shape is shared data, and the
 * gate registers the wider table with `CLEAN_RULED as unknown as Ruled[]` rather than forking
 * the contract. The two entries below are validated by that same cast at registration.
 */
type Type =
  | "calls"
  | "uses"
  | "contains"
  | "imports"
  | "references"
  | "exports"
  | "extends"
  | "implements"
  | "overrides"
  | "instantiates"
  | "decorates"
  | "part_of"
  | "renders"
  | "mixes_in"

type Ruled = Omit<GateRuled, "type"> & { type: Type }

/** The node-type names other OO grammars use for a mixin/trait composition clause. None is
 *  produced by the pinned C# grammar; the list is what lets the gate FALSIFY this ruling rather
 *  than merely repeat it. */
const CSHARP_MIXIN_NODE_TYPES = [
  "mixin_clause",
  "mixin_declaration",
  "with_clause",
  "trait_use",
  "trait_declaration",
  "uses_clause",
  "heritage_mixin",
  "class_with",
]

export const CSHARP_RULED: Ruled[] = [
  {
    type: "mixes_in",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: CSHARP_MIXIN_NODE_TYPES,
    spacesProbed: ["node-types", "attribute-keys"],
    describe:
      "ONTOLOGICAL, not an absence. C# has exactly ONE supertype mechanism — the base list — and " +
      "it is already published as `extends` (the first entry, when it is a class) plus `implements` " +
      "(every remaining entry). `mixes_in` would require a supertype composition that is NEITHER of " +
      "those, and C# has no such construct: a mixin is composed INTO the supertype chain, while " +
      "C#'s other composition-looking shapes do not touch it. " +
      "MEASURED, instrument A: 0 of the 8 probed names above among the 239 named node types the " +
      "pinned grammar produces over the admitted corpus " +
      "(validation/m14/measurements/csharp-grammar-nodes.json, written by " +
      "script/m14/grammar-node-inventory.ts — 239 named / 533 ids). " +
      "NEAREST CONSTRUCT, NAMED AND DISMISSED ON THE MERITS RATHER THAN BY INVENTORY: " +
      "`with_expression` / `with_initializer` ARE produced by this grammar (673 corpus sites: " +
      "274 with_expression + 399 with_initializer) and are C#'s RECORD UPDATE form — they produce " +
      "a modified INSTANCE, not a subtype relationship. Extension methods (3,312 sites over 875 " +
      "files) are C#'s member-injection mechanism, but an extension member is resolved at the CALL " +
      "SITE and is never inherited into the supertype chain, so publishing one as `mixes_in` would " +
      "assert a composition the runtime does not perform. Neither is the contract's construct. " +
      "FALSIFIER: a C# construct that composes a type into another type's SUPERTYPE CHAIN and is " +
      "neither its first base nor one of its interfaces — either (a) the grammar grows one of the " +
      "node types above, or (b) a base-list entry names something that is neither a class nor an " +
      "interface. Either falsifies this ruling and the gate will say so.",
  },
  {
    type: "part_of",
    instrument: "A:grammar-inventory",
    // No C# node type names another FILE as part of this unit. The probed names are the ones
    // other grammars use for exactly that: Dart's `part`/`library`, C/C++'s include, the
    // preprocessor family. Their absence is the ruling's positive evidence.
    nodeTypesThatWouldMeanIt: [
      "part_of_directive",
      "part_directive",
      "part",
      "library_directive",
      "include_directive",
      "preproc_include",
      "import_directive",
    ],
    spacesProbed: ["node-types", "attribute-keys"],
    describe:
      "ONTOLOGICAL, and MEASURED rather than asserted: C# has no syntax that names ANOTHER FILE " +
      "as part of this compilation unit. The grammar produces no `part_*` name (0 of the 7 probed " +
      "above among the 239 named node types), AND the corpus contains 0 `#include`/`#import` " +
      "directives across all 1,181 admitted .cs files — swept with " +
      "`grep -rn '^\\s*#\\(include\\|import\\)' --include='*.cs'`, which returned nothing. " +
      "NEAREST CONSTRUCT, NAMED AND DISMISSED ON THE MERITS: the `partial` MODIFIER (1,873 sites " +
      "over the admitted corpus, on class/method/interface/struct/constructor/property " +
      "declarations). `partial` splits ONE type across several declarations that the compiler " +
      "MERGES INTO ONE SYMBOL, so a `part_of` row sourced from it would read `X -> X` — the edge " +
      "would name the same symbol at both ends and carry no information about any other unit. " +
      "That is the INFORMATION test, not a grammar test: the construct exists, and it does not " +
      "name a second party. " +
      "WHY THIS IS NOT THE SAME RULING AS `mixes_in`: `mixes_in` fails because C# composes types " +
      "only through a mechanism already published under two other labels; `part_of` fails because " +
      "C# composes UNITS not at all — there is no include, no part, no library clause. " +
      "FALSIFIER: a C# construct that names another file or unit as a component of this one — " +
      "(a) the grammar grows one of the node types above, or (b) a directive naming a `.cs` file " +
      "appears in the corpus. Either falsifies this ruling and the gate will say so.",
  },
  {
    type: "renders",
    instrument: "B:parse-tree-count",
    // The count the ruling publishes, and the number it is accountable to. C#'s component-render
    // construct is the DYNAMIC RENDER HOST (`builder.RenderComponent<Widget>()` as a TYPE ARGUMENT,
    // `RenderComponent(typeof(OtherWidget))` as a `typeof` ARGUMENT) — the `invocation_expression`
    // node type carries both, so no grammar change was ever needed. The analyzer EMITS the value;
    // the corpus has ZERO sites that name a component, which is the fleet's CORPUS-UNEXERCISED class
    // (graphql / sql precedent).
    //
    // WHY IT NEEDS A TABLE ENTRY AT ALL. `rulingFor()` reads the table FIRST and the spec second,
    // and the spec's `renders` entry lives under `coverage.corpusUnexercised` — a DIFFERENT key from
    // `design_decision.decisions`, which is the only thing the spec half of `rulingFor` scans. So
    // the claim existed but was unreachable: `ontology-coverage-gate.ts csharp` printed
    // `renders RULED-UNJUSTIFIED … NO written ruling was found in the spec` while the spec carried a
    // measured, cited corpus-unexercised ruling. Registering it here makes the written claim visible
    // to the arbiter, which is the whole purpose of this file.
    //
    // INSTRUMENT B, not A, and the distinction matters: the construct needs NO node type the grammar
    // lacks, so a grammar-inventory ruling is the wrong instrument — and worse, it would be FALSIFIED
    // the moment a corpus file did contain a render host, because instrument A's node list is checked
    // for PRESENCE. Instrument B counts the construct on the tree, so a corpus that starts exercising
    // the value shows up as `occurrences > 0` and the ruling is falsified loudly rather than quietly
    // passing.
    publishedCount: 0,
    publishedFiles: 0,
    countOnTree: (root: any, _fileLabel: string, hits: string[]): void => {
      // A render host call whose callee names a host AND which names a COMPONENT — the two shapes the
      // analyzer emits (`:2285` type-argument, `:2315` typeof). Both are read from the tree; a bare
      // `Render(x)` with neither is the non-component form and does NOT count, which is exactly the
      // distinction the census measures.
      //
      // THE SHAPES, read from the grammar rather than assumed (probe `.scratch/renders-shape.ts`):
      //   `builder.RenderComponent<Widget>()`       -> invocation[ member_access[ generic_name[identifier,
      //                                                  type_argument_list] ], argument_list ]
      //   `builder.RenderComponent(typeof(Widget))` -> invocation[ member_access[ identifier ],
      //                                                  argument_list[ argument[ typeof_expression ] ] ]
      //   `Render(x)`                               -> invocation[ identifier, argument_list[ argument[identifier] ] ]
      // So the type arguments are NOT a field of the invocation: they live on a `generic_name`
      // INSIDE the callee. A probe that read `childForFieldName("type_arguments")` found nothing on
      // any of the three shapes — measured, it reported 0 on a file the analyzer emits from.
      const HOSTS = new Set(["RenderComponent", "RenderChild", "Render", "AddComponent"])
      const stack: any[] = [root]
      while (stack.length > 0) {
        const n = stack.pop()
        if (!n) continue
        if (String(n.type) === "invocation_expression") {
          const callee = n.childForFieldName?.("function") ?? n.namedChild(0)
          if (callee) {
            // The callee's LEAF name: for a member access that is the last identifier, for a plain
            // identifier the callee itself.
            let leaf = ""
            const leafNode = (x: any): any => {
              if (!x) return null
              const t = String(x.type)
              if (t === "identifier") return x
              if (t === "generic_name") return leafNode(x.namedChild(0))
              if (t === "member_access_expression") {
                for (let i = x.namedChildCount - 1; i >= 0; i--) {
                  const got = leafNode(x.namedChild(i))
                  if (got) return got
                }
                return null
              }
              return leafNode(x.namedChild(0))
            }
            const ln = leafNode(callee)
            if (ln) leaf = String(ln.text ?? "")
            if (HOSTS.has(leaf)) {
              // (1) a TYPE ARGUMENT: a `generic_name` anywhere in the callee subtree carrying a
              // non-empty `type_argument_list`.
              let hasTypeArg = false
              const scan = (x: any): void => {
                if (!x || hasTypeArg) return
                if (String(x.type) === "generic_name") {
                  const tal = x.childForFieldName?.("type_argument_list") ??
                    x.namedChildren?.find?.((c: any) => String(c?.type) === "type_argument_list")
                  if (tal && tal.namedChildCount > 0) { hasTypeArg = true; return }
                }
                for (let i = 0; i < x.namedChildCount; i++) scan(x.namedChild(i))
              }
              scan(callee)
              // (2) a `typeof(...)` ARGUMENT.
              let hasTypeof = false
              const args = n.childForFieldName?.("arguments")
              if (args) {
                for (let i = 0; i < args.namedChildCount; i++) {
                  const a = args.namedChild(i)
                  if (!a) continue
                  for (let j = 0; j < a.namedChildCount; j++) {
                    const t = String(a.namedChild(j)?.type ?? "")
                    if (t === "typeof_expression" || t === "type_of_expression") { hasTypeof = true; break }
                  }
                  if (hasTypeof) break
                }
              }
              if (hasTypeArg || hasTypeof) hits.push(`${leaf} naming a component`)
            }
          }
        }
        for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
      }
    },
    spacesProbed: ["node-types", "attribute-keys"],
    describe:
      "CORPUS-UNEXERCISED — not absent and not ruled out. The C# component-render construct is the " +
      "DYNAMIC RENDER HOST: `builder.RenderComponent<Widget>()` names the component as a TYPE " +
      "ARGUMENT and `builder.RenderComponent(typeof(OtherWidget))` as a `typeof` ARGUMENT. The " +
      "`invocation_expression` node type carries both, so this was never a grammar question — rung " +
      "R3 of the remedy ladder, no grammar change. The analyzer EMITS the value; the corpus does " +
      "not exercise it. MEASURED over the whole admitted population: 298 render-host call sites " +
      "(over a FOUR-NAME superset: RenderComponent, RenderChild, Render, AddComponent) and 0 of them " +
      "NAME A COMPONENT, so the component tally is empty over 14,424 files / 22 repositories. " +
      "THE PROOF IS BEHAVIOURAL: fixture validation/m14/fixtures/csharp/render-host-component.cs, " +
      "whose edge exists only when the construct reaches the analyzer as a REAL NODE. " +
      "FALSIFIER: a C# file in the admitted population that calls a render host with a component " +
      "type argument or a `typeof` argument — the instrument-B count above rises above 0, or the " +
      "analyzer's own census emits cs.render_host_call_with_component_type / " +
      "_with_typeof_component, and this ruling is wrong.",
  },
]