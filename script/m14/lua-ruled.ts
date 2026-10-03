/**
 * LUA's ruling table for `script/m14/ontology-coverage-gate.ts`.
 *
 * ## Why this file exists and why it is NOT the gate
 *
 * `ontology-coverage-gate.ts` is the arbiter for the whole ontology workstream, and
 * `RULED_BY_LANG` in it holds two worked examples: `BASH_RULED` and `JSON_RULED`. It
 * is shared machinery owned by the supervisor (§8 of
 * `docs/analyzers/ONTOLOGY-WORKSTREAM.md`), so this lane writes the table beside it
 * and does not edit it. Wiring is one import and one map entry:
 *
 *   import { LUA_RULED } from "./lua-ruled"
 *   const RULED_BY_LANG: Record<string, Ruled[]> = { bash: BASH_RULED, json: JSON_RULED, lua: LUA_RULED }
 *
 * `script/m60/lua-ruled-proof.ts` applies exactly that patch to a scratch copy and
 * runs it, so the table is proved rather than asserted. Until the wiring lands,
 * `npx tsx script/m14/ontology-coverage-gate.ts lua` exits 2 and REFUSES to report,
 * by its own design: "a gate with an empty table would call every un-emitted type
 * RULED-UNJUSTIFIED and that is a verdict about the TABLE, not about the lane."
 *
 * ## Why this table has ONE row
 *
 * Nine of the ten types are EMITTED by production `parseFile` on the corpus, and the
 * gate's verdict loop checks EMITTED FIRST — a row for an emitted type would be a
 * claim the type is not emitted, which is false. The full census is in
 * `docs/analyzers/real-lua-analyzer.md` §3.1 and every row of it was re-measured in
 * this pass.
 *
 *   calls 57,057 | uses 54,562 | contains 55,028 | imports 6,547 | references 39,886
 *   exports 5,108 | extends 171 | overrides 66 | instantiates 122 | implements 0
 *
 * So the table is the ninth type's absence and nothing else. A table padded to ten
 * rows would look more complete and be less true.
 *
 * ## THE ROW: `implements`, instrument A
 *
 * Instrument A is the correct instrument here and the choice is not a default. It is
 * correct because the construct needs a NODE TYPE THAT DOES NOT EXIST: Lua has no
 * `class` keyword, no `interface` keyword, and no declaration form for a type at all,
 * so no corpus of Lua — not this one, not a larger one — can produce a supertype
 * clause. That is a fact about the language's vocabulary, which is what instrument A
 * measures. The pinned grammar produced **100 distinct node types** across 1,875
 * corpus files (`script/m60/lua-grammar-inventory.ts`, artifact
 * `validation/m60/lua/grammar-inventory.json`) and none of the six below is among
 * them.
 *
 * This is NOT true of the other three types in the grammar-inventory artifact, which
 * is why that artifact carries `silentByConstruction` per row. A redefinition IS a
 * second `function_declaration`; `Table:new(...)` and `setmetatable(D, B)` are
 * ordinary `function_call`s. For those three the inventory reads 0 on EVERY possible
 * corpus and settles nothing — which is precisely how json's `exports` ruling was
 * wrong. Had this table been built from that artifact's old
 * `instrumentASettlesIt: present.length === 0`, it would have carried three rows
 * claiming constructs that do not exist while this lane's own census measures 66, 122
 * and 171 edges of them.
 *
 * ## WHAT WOULD OVERTURN IT
 *
 * A non-zero count of any of the six node types in the instrument-A artifact — which
 * is what a Lua dialect with a `class`/`interface` declaration would introduce, and
 * the gate reports that as FALSIFIED rather than RULED-SOUND.
 *
 * The document's second falsification condition is a PROBE on the tree, and it is
 * `script/m60/lua-conformance-probe.ts`. It was named in the doc as a condition with
 * no instrument behind it — a wish, not a test — and this pass wrote the probe and
 * ran it over all 3,252 corpus files. It returns non-zero on two buckets, so the
 * ruling was re-adjudicated rather than assumed:
 *
 *   b1 a written supertype argument   4 hits, 1 file   — 0 with a NAME, 0 with a
 *                                                            string, 4 with an
 *                                                            expression. The 4 are
 *                                                            luarocks' own
 *                                                            `class(prototype,
 *                                                            properties, parent)`.
 *
 *     >>> CORRECTION, measured in this pass. b1 reads `as[1]` — the SECOND argument —
 *     >>> as the supertype. That is argparse's MIDDLE argument, a table of properties,
 *     >>> so all four landed in `other` and the bucket read 0 names. The convention's
 *     >>> position is a property of the callee's OWN parameter list, which is written in
 *     >>> the same file and was quoted two paragraphs above. Re-run with the position
 *     >>> READ from that `parameters` node instead of guessed
 *     >>> (script/m60/lua-supertype-arg-probe.ts):
 *     >>>
 *     >>>   written supertype arguments   7 across 5 files   (role-resolved)
 *     >>>   of which the supertype argument is a NAME       7
 *     >>>   the positional guess would have counted         0
 *     >>>
 *     >>> Two of the seven are real INHERITANCE and are MISSED `extends` edges:
 *     >>>   luarocks/vendor/argparse.lua:277  class arg3 (param 'parent') -> Parser
 *     >>>   luarocks/vendor/argparse.lua:328  class arg3 (param 'parent') -> Argument
 *     >>> The callee body proves the relation at :41 —
 *     >>>   `if parent then cl.__prototype = deep_update(deep_update({}, parent.__prototype), prototype)`
 *     >>> — and both names are assigned at the top level, so `Command extends Parser`
 *     >>> and `Option extends Argument` are written facts the analyzer does not emit.
 *     >>> The other five are a tree-traversal `parent` parameter (`_each(widget,
 *     >>> parent)`, `add(result, parent)`) and are not type relations.
 *     >>>
 *     >>> This does NOT overturn the `implements` ruling: a written supertype argument
 *     >>> is `extends`, which this lane already emits, and counting it toward
 *     >>> `implements` would invent a second relation out of one construct. It IS a
 *     >>> GAP in `extends` coverage — LUA-51, reported and fixed in
 *     >>> src/ast/real-lua-analyzer.ts.
 *   b2 `assert(type(x) == "...")`   288 hits, 99 files — a shape check, no type named
 *   b3 `if type(x) ~= "..." then     322 hits, 87 files — the same, as a guard
 *      error(...) end`
 *   b4 a called name meaning         14 hits, 3 files   — see below
 *      conformance
 *   b5 the denominator b2/b3 sit in  2,337 hits, 605 files
 *   b6 `__index = <name>`           349 hits, 236 files — the relation `extends`
 *                                                            already publishes
 *
 * b4 is the one that needed adjudication, because the corpus DOES name conformance.
 *
 * MEASURED: 14 occurrences across 3 files — kong `implements(...)` 1 occurrence in
 * 1 file, luvit `instanceof(...)` 13 occurrences in 2 files. None of the 14 is a type
 * clause an edge could carry:
 *
 *   luvit `core.instanceof(obj, Class)` — 13 sites in 2 files (deps/buffer.lua:251 and
 *     tests/test-instanceof.lua:29). It is a runtime helper whose body lives in another
 *     module (`luvit/deps/core.lua:55`, walking the `meta.super` chain). The analyzer
 *     cannot know what it means without reading that module, and the same callee name
 *     in kong means something else entirely.
 *   kong `implements(plugin, method)` — 1 site, `kong/db/dao/plugins.lua:200`. Its
 *     body is a CAPABILITY check on a method name: `type(plugin[method]) == "function"`.
 *     `implements(handler, "response")` would publish an edge claiming `handler`
 *     implements a TYPE named `response`.
 *
 * So a name-keyed rule would publish a wrong edge for kong and a right-by-luck edge
 * for luvit, off 14 call sites in 3 files. That is the fabrication rule refusing a
 * table cell, and the ruling stands — now on a measurement rather than on the
 * grammar alone.
 *
 * >>> CORRECTION, measured in this pass: three different totals for b4 appear in
 * >>> earlier drafts of this header — "17 sites in two files", "16 sites in 3 files",
 * >>> and "17 call sites in 5 files". None is reproducible. The bucket
 * >>> (`lua-conformance-probe.json`, `buckets.b4_namedConformanceApi`) reads
 * >>> **14 occurrences / 3 files**, and 14 = 1 + 13. The others came from adding the
 * >>> per-file counts and the per-kind counts as if they were independent totals. A
 * >>> number in a ruling that cannot be reproduced from the artifact beside it is
 * >>> exactly what this gate exists to catch, so it is corrected here rather than
 * >>> left to be found.
 *
 * ### Instrument B for `implements` was also run, and refused
 *
 * `script/m60/lua-ruled-table-check.ts` runs `REJECTED_IMPLEMENTS_TREE_PROBE` from
 * this file over the whole corpus: a tree probe for a conformance clause that NAMES A
 * TYPE, bucketing every hit by the ROLE the string plays (node types and fields, not a
 * word list). It returns **3,916 hits across 213 files**, and the gate would call the
 * ruling FALSIFIED on that number. It is refused because no hit carries a type-position
 * role — the strings are an enum compared for equality (`kind == "SERVER"`,
 * zipkin/span.lua:34), a format argument (`assert(x509.new(pem, "PEM"))`,
 * prometheus/exporter.lua:206), a table field value (`method = "GET"`,
 * scripts/changelog-helper.lua:63), a record name (`Schema.new({ name = "Foo" })`,
 * 04-dao_spec.lua:507) and an assertion message. Making the probe role-resolved enough
 * to exclude those would mean hardcoding five project-specific vocabularies, and a
 * probe whose correctness rests on a hardcoded list is the shape-match this gate
 * exists to catch. Instrument B is therefore NOT AVAILABLE for this construct, which
 * is a finding about the instrument rather than a pass.
 */

/**
 * Restated from `script/m14/ontology-coverage-gate.ts` rather than imported: the gate
 * is a top-level-await SCRIPT, not a module, so it exports nothing to import from,
 * and this lane does not edit it. The shape is copied verbatim from the `Ruled` type
 * there and `script/m60/lua-ruled-proof.ts` FAILS LOUDLY if the two ever diverge —
 * it re-reads the gate's own `type Ruled` block and compares field by field, because a
 * table typed against a stale copy of the gate is a table the gate cannot use.
 */
export type Ruled = {
  type: "calls" | "uses" | "contains" | "imports" | "references" | "exports" | "extends" | "implements" | "overrides" | "instantiates"
  instrument: "A:grammar-inventory" | "B:parse-tree-count"
  /** A: node types that would express the construct. B: unused. */
  nodeTypesThatWouldMeanIt?: string[]
  /** B: count occurrences on the tree. A: unused. */
  countOnTree?: (root: any, fileLabel: string, hits: string[]) => void
  describe: string
}


/** Field separator for the refused probe's hit records — a TS escape, not a raw byte. */
const US = "\u001f"

/**
 * The instrument-B probe that was TRIED for `implements` and REFUSED, kept so the
 * refusal is measured rather than asserted.
 *
 * It is NOT wired into `LUA_RULED` and the gate never calls it. It lives here so
 * `script/m60/lua-ruled-table-check.ts` can run it over the corpus and bucket every hit
 * by the ROLE the string plays in the tree. Each hit is `where US role US value`.
 *
 * The role is read off node types and fields, never off a word list. The first version
 * of this audit classified by word list and left 3,904 of 3,916 hits `unclassified`,
 * which is the same defect as the probe it was auditing: a shape match cannot tell a
 * type name from an error message.
 */
export const REJECTED_IMPLEMENTS_TREE_PROBE = (root: any, fileLabel: string, hits: string[]): void => {
  const LUA_PRIMITIVES = new Set([
    "nil", "boolean", "number", "string", "table", "function", "thread", "userdata", "lightuserdata",
  ])
  const CONFORMANCE_APIS = new Set([
    "isa", "is_a", "isA", "instanceof", "isinstance", "isKindOf", "iskindof",
    "implements", "implementsInterface", "conforms_to", "conformsTo",
    "subclass_of", "subclassOf", "is_a_subclass_of", "isASubclassOf", "satisfies",
  ])
  const stringValue = (n: any): string | undefined => {
    if (!n || n.type !== "string") return undefined
    const t = String(n.text ?? "")
    const m = /^(?:\[\[|=|')([\s\S]*?)(?:\]\]|=|\2)$/.exec(t)
    return (m ? m[1] : t).replace(/^["']|["']$/g, "")
  }
  const lineOf = (n: any): number => (n?.startPosition?.row ?? 0) + 1

  /** The ROLE a `string` node plays, read off the tree. This is the whole point:
   * `type = "EC"` and `assert(type(x) == "Parser")` are both strings, and only one of
   * them is a name in a type position. */
  const roleOf = (s: any): string => {
    const p = s?.parent
    const gp = p?.parent
    if (!p) return "orphan string"
    if (p.type === "binary_expression") {
      const op = String(p.childForFieldName?.("operator")?.text ?? "")
      if (/^(==|~=)$/.test(op)) return "compared for equality - an enum or sentinel value"
      return "operand of a binary expression"
    }
    if (p.type === "field") {
      const k = p.childForFieldName?.("name")
      const key = k ? (k.type === "string" ? stringValue(k) : k.text) : undefined
      return `table field value${key ? ` of ${key}` : ""} - an option, format, phase or attribute`
    }
    if (p.type === "arguments") {
      let idx = -1
      for (let i = 0; i < p.namedChildCount; i++) if (p.namedChild(i) === s) { idx = i; break }
      const callee = gp?.childForFieldName?.("name")
      const cname = callee?.type === "identifier" ? callee.text : "?"
      if (cname === "assert" || cname === "error") {
        return idx === 0
          ? "first argument to assert/error - the expression under test, not a type"
          : `argument ${idx + 1} to ${cname} - a message or format label`
      }
      return `argument ${idx + 1} to ${cname}`
    }
    if (p.type === "variable_declaration" || p.type === "assignment_statement") return "assigned to a name"
    if (p.type === "return_statement") return "returned"
    return `inside ${p.type}`
  }

  const push = (s: any, where: string): void => {
    const v = stringValue(s)
    if (v === undefined || LUA_PRIMITIVES.has(v)) return
    // Only a bare Capitalised token is even a candidate for a type name.
    if (!/^[A-Z][A-Za-z0-9_]*$/.test(v)) return
    hits.push(`${where}${US}${roleOf(s)}${US}${v}`)
  }

  const walk = (n: any): void => {
    if (n.type === "function_call") {
      const callee = n.childForFieldName("name") ?? n.namedChild(0)
      const args = n.childForFieldName("arguments")
      if (callee?.type === "identifier" && args) {
        if (CONFORMANCE_APIS.has(callee.text)) {
          // The type position is the SECOND argument by the role these APIs share: the
          // value under test is first.
          const typeArg = args.namedChild(1) ?? null
          const at = `${fileLabel}:${lineOf(n)}`
          if (typeArg?.type === "string") push(typeArg, `${at} (${callee.text})`)
          else if (typeArg?.type === "identifier") {
            hits.push(`${at}${US}conformance API ${callee.text} type argument is a NAME${US}${typeArg.text}`)
          }
        }
        if (callee.text === "assert" || callee.text === "error") {
          const arg0 = args.namedChild(0)
          const strings = (x: any): void => {
            if (x?.type === "string") push(x, `${fileLabel}:${lineOf(n)} (${callee.text})`)
            for (let i = 0; i < x.namedChildCount; i++) { const c = x.namedChild(i); if (c) strings(c) }
          }
          if (arg0) strings(arg0)
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
  }
  if (root) walk(root)
}

export const LUA_RULED: Ruled[] = [
  {
    type: "implements",
    instrument: "A:grammar-inventory",
    // Taken from the same candidate list the gate's own BASH_RULED uses, plus the two
    // declaration forms, so the gate asks lua the question it asks bash. All six are
    // absent from the 100 node types the pinned grammar produces; see the header for
    // why that is conclusive HERE and silent-by-construction for `overrides`,
    // `instantiates` and `extends`.
    nodeTypesThatWouldMeanIt: [
      "implements_clause",
      "extends_clause",
      "superclass",
      "interface_implementation",
      "interface_declaration",
      "trait_declaration",
    ],
    describe: "a supertype clause naming an implemented or conformed-to type — Lua has no `class` keyword, no `interface` keyword and no declaration form for a type, so no corpus can produce one. 100 distinct node types observed across the corpus, none of these six. Instrument B run as the adversary twice, and it does NOT clear the ruling: (1) lua-conformance-probe b4 measures 14 occurrences / 3 files naming conformance — 13 luvit `core.instanceof` (a runtime helper whose body lives in another module) and 1 kong `implements(plugin, method)` (a capability check, `type(plugin[method]) == \"function\"`), so a name-keyed rule would publish a wrong edge for kong and a right-by-luck edge for luvit; (2) a tree probe for a clause that NAMES A TYPE returns 3,916 hits / 213 files, every one a label rather than a type (enum compared for equality, format argument, table field value, record name, assertion message), so instrument B is not available for this construct without hardcoding five project-specific vocabularies. NOT counted toward this ruling: 7 written supertype arguments resolved BY ROLE from the callee's own `parameters` node (2 of them inheritance — `class({...}, {...}, Parser)` at luarocks/vendor/argparse.lua:277 and :328 — which is `extends`, already emitted), because counting them here would invent a second relation out of one construct. Overturn: a non-zero count of any of the six node types in the grammar inventory.",
  },
]