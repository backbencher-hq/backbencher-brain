/**
 * json's RULING TABLE — the lane's own file, ready for one import in the shared arbiter.
 *
 * ## Why this file exists when `ontology-coverage-gate.ts` already carries a `JSON_RULED`
 *
 * Because the copy in that file is STALE, and a stale ruling table is worse than none.
 * `script/m14/ontology-coverage-gate.ts` is §8 shared machinery, so this lane does not edit
 * it; the table is written here instead and the wiring — one import and one map entry — is
 * reported to the supervisor. The diff that applies it:
 *
 *   import { JSON_RULED } from "./json-ruled"
 *   ...
 *   const RULED_BY_LANG: Record<string, Ruled[]> = { bash: BASH_RULED, json: JSON_RULED }
 *
 * ## What changed, and why the old table could not have caught it
 *
 * The copy in the shared file carries FIVE entries. Three of them — `calls`, `imports`,
 * `overrides` — are for types this lane now EMITS, so the gate short-circuits them and they
 * are inert. The `imports` entry is worse than inert: it carries a `countOnTree` that the
 * gate RUNS over the whole corpus (instrument B is evaluated before the verdict loop) and
 * then never reads.
 *
 * The two live entries — `implements` and `instantiates` — were both on
 * **`A:grammar-inventory`**, and that is the instrument this lane has had to retract six
 * times. A grammar inventory says what the PARSER can express. JSON's grammar has 12 named
 * node types and no node type for a KEYWORD, so it would have reported RULED-SOUND for any
 * keyword-shaped construct, including the ones that turned out to exist: `imports`, `exports`,
 * `extends`, `calls`, `overrides`, and now `implements`. The gate's job is to catch a ruling
 * that sounds right and is wrong, and a grammar inventory cannot catch this one — it would
 * have passed the `implements` ruling that the corpus overturned.
 *
 * So both surviving entries are on **`B:parse-tree-count`** here, which is the instrument the
 * workstream says to use "for a type the language CAN express": a key can spell `implements`
 * or `instantiates` perfectly well, so only a count on the tree decides it, where a string or
 * a heredoc cannot fake it.
 *
 * ## The type this lane emitted rather than ruled
 *
 * `implements` was RULED at pass 1 and is EMITTED now. The measurement that overturned it is
 * in `validation/m14/fixtures/json/inheritance-probe.ts`, and it is one file:
 * `dart-sdk/third_party/pkg/language_server_protocol/lsp_meta_model.json` is the Language
 * Server Protocol's own serialisation of its type declarations; 113 of its structures state
 *
 *   "mixins": [{"kind": "reference", "name": "WorkDoneProgressParams"}]
 *
 * which names the TypeScript INTERFACES a class mixes in. An interface carries no
 * implementation, so there is nothing else for the word to mean. The gate reported
 * RULED-SOUND on this type against a grammar that had never heard of a keyword, and the
 * corpus carried 113 edges' worth of the construct the whole time.
 */

/** The shape `script/m14/ontology-coverage-gate.ts` expects. Restated rather than imported,
 *  because the shared file does not export `Ruled` and importing from it would create an
 *  import cycle once the supervisor adds the wiring. The two must stay identical: the gate
 *  reads `instrument`, `type`, `describe`, and `countOnTree` or `nodeTypesThatWouldMeanIt`. */
export type Ruled = {
  type: "calls" | "uses" | "contains" | "imports" | "references" | "exports" | "extends" | "implements" | "overrides" | "instantiates"
  instrument: "A:grammar-inventory" | "B:parse-tree-count"
  /** A: node types that would express the construct. B: unused. */
  nodeTypesThatWouldMeanIt?: string[]
  /** B: count occurrences on the tree. A: unused. */
  countOnTree?: (root: any, fileLabel: string, hits: string[]) => void
  describe: string
}

/** Keys that spell a constructor. Spelled, not inferred: the point of the probe is that the
 *  KEY alone never decides anything — the VALUE'S ROLE does. */
const CONSTRUCTOR_KEYS = ["new", "constructor", "__init__", "__new__", "init", "instantiate", "create", "factory"]

/** Keys that make an object a TYPE DECLARATION rather than one of its members. Same test the
 *  analyzer uses, restated here so the ruling is not decided by the code it audits. */
const TYPE_SHAPE_KEYS = ["properties", "values", "extends", "mixins", "implements", "members", "class"]

export const JSON_RULED: Ruled[] = [
  {
    type: "instantiates",
    instrument: "B:parse-tree-count",
    /**
     * A CONSTRUCTION, counted on the tree and asked as a role question.
     *
     * The naive probe — "does a key named `new` / `constructor` / `init` occur?" — answers
     * YES 274 times across 15 files and means nothing. Measured value-role split over the
     * whole admitted population:
     *
     *   142 string values   proxicall's i18n key `new` ("New"), nvim-treesitter's
     *                       `constructor` — a NAME, not a call
     *   100 array values    duckdb's serialization schemas, where `"constructor": ["index"]`
     *                       is the CONSTRUCTOR'S PARAMETER NAMES. That is a DECLARATION, and a
     *                       declaration is the opposite of a construction
     *    22 object values   a swagger `init` parameter schema, a svelte parser fixture
     *    10 scalar values   an i18n string, a `.run` session file
     *
     * and `new <Identifier>` occurs 5,093 times inside string values, of which 7 have that
     * identifier also declared as a key in the same file — every example a JavaScript AST dump
     * or a prose message. A probe that matches a SHAPE rather than a ROLE produces a number,
     * and the number is worth nothing; that is how the gate's own first `extends` probe
     * convicted `class voice` inside a telnet IAC word list.
     *
     * So the probe asks the only question that could mean "a construction happened": does a
     * document that DECLARES TYPES — by a `class` string, or by LSP's
     * `{"kind":"reference","name":X}` literal — contain a constructor-named key whose value is
     * an OBJECT, i.e. an instance's state rather than a parameter list? Measured: 0 over
     * 11,713 admitted files. duckdb declares constructors in exactly the documents that
     * declare types, and every one of them is an array of parameter names.
     *
     * **Overturn condition:** ≥1 such pair. The probe fires the moment a type-declaring
     * document carries a constructor-named key bound to an object.
     */
    countOnTree: (root, fileLabel, hits) => {
      const unquote = (t: string): string => {
        const v = t.trim()
        return v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"' ? v.slice(1, -1) : v
      }
      const keyOf = (pair: any): string | null => {
        if (pair?.type !== "pair") return null
        const k = pair.childForFieldName?.("key")
        if (!k) return null
        const c = k.namedChildren?.find((x: any) => x.type === "string_content")
        return c ? String(c.text ?? "") : unquote(String(k.text ?? ""))
      }
      const valueOf = (pair: any): any => pair?.childForFieldName?.("value")
      const stringValueOf = (pair: any): string | null => {
        const v = valueOf(pair)
        return v?.type === "string" ? unquote(String(v.text ?? "")) : null
      }

      // Pass 1 — does this DOCUMENT declare types at all? Both markers are structural and
      // both are corpus-bounded: 21 documents carry a `class` string, 2 carry a reference
      // literal, out of 11,713.
      let declaresTypes = false
      const scan = (node: any, fn: (n: any) => void) => {
        const stack: any[] = [node]
        while (stack.length) {
          const n = stack.pop()
          fn(n)
          for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i))
        }
      }
      scan(root, (n) => {
        if (n.type !== "pair") return
        const key = keyOf(n)
        if (key === "class" && stringValueOf(n) !== null) declaresTypes = true
        if (key === "kind" && stringValueOf(n) === "reference") declaresTypes = true
      })
      if (!declaresTypes) return

      // Pass 2 — a constructor-named key bound to an OBJECT inside such a document.
      scan(root, (n) => {
        if (n.type !== "pair") return
        const key = keyOf(n)
        if (key === null || !CONSTRUCTOR_KEYS.includes(key)) return
        if (valueOf(n)?.type !== "object") return
        hits.push(`${fileLabel}: constructor-named key "${key}" bound to an object inside a type-declaring document`)
      })
    },
    describe: "a CONSTRUCTION — a constructor-named key bound to an instance's state inside a document that declares types",
  },
]