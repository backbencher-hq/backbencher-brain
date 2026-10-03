/**
 * SQL's entry for `script/m14/ontology-coverage-gate.ts`'s ruling table.
 *
 * ## WHY THE TABLE LIVES HERE AND NOT IN THE GATE
 *
 * `script/m14/ontology-coverage-gate.ts` is supervisor-owned shared machinery
 * (`script/m14/` §8 of the lane brief), and its `RULED_BY_LANG` is a literal with
 * no extension point. Run against `sql` it therefore refuses to report at all:
 *
 *   $ npx tsx script/m14/ontology-coverage-gate.ts sql
 *   ontology coverage gate — sql
 *   corpus: 1460 admitted files
 *   ontology coverage gate — no RULING TABLE for sql.
 *   Refusing to report: a gate with an empty table would call every un-emitted type
 *   RULED-UNJUSTIFIED and that is a verdict about the TABLE, not about the lane.
 *   $ echo $?
 *   2
 *
 * That refusal is the gate behaving correctly — an empty table would make it
 * render a verdict about its own configuration — and it is also the one thing
 * standing between this lane and a measured verdict. So the table lives in a file
 * this lane owns, in the gate's own `Ruled` shape, and the supervisor's permanent
 * change is two lines:
 *
 *   import { SQL_RULED } from "../m60/sql-ontology-ruled"
 *   const RULED_BY_LANG: Record<string, Ruled[]> = { bash: BASH_RULED, json: JSON_RULED, sql: SQL_RULED }
 *
 * The measurements behind every entry are NOT here. They are in
 * `validation/m14/fixtures/sql/construct-probe.json` (465 distinct node types the
 * wired grammar actually produces over the 1,460-file census, plus the semantic
 * counts), and each entry names the probe key that produced its number so the
 * ruling can be re-derived without re-running the corpus.
 *
 * ## WHICH TYPES ARE IN THIS TABLE, AND WHY ONLY THREE
 *
 * The table covers the types the analyzer does not emit. `imports`, `overrides`
 * and `instantiates` are absent from it because the analyzer now emits them —
 * SQL-D11, SQL-D12 and SQL-D13 in `script/m14/spec/sql-completeness.json`, each
 * with its own corpus measurement — and a table entry for a type that IS emitted
 * would be dead configuration. `calls`, `uses`, `contains` and `references` were
 * already emitted. That leaves exactly the three this table carries:
 * `exports`, `extends`, `implements`.
 *
 * ## WHY ALL THREE ARE INSTRUMENT A, AND WHY THAT IS NOT THE JSON LANE'S MISTAKE
 *
 * The json lane removed its `exports` ruling because "a grammar cannot see a
 * CONVENTION", and that is right for a Node manifest: `exports` and `main` there
 * are ordinary object keys with no node type of their own, so a grammar inventory
 * cannot see them. Instrument A is unsound for a construct that is written as
 * ordinary syntax the grammar already tokenises.
 *
 * SQL's three are not that. Each one needs a CLAUSE — a place in a declaration
 * where the unit names something it extends, implements, or publishes — and a
 * clause is not an ordinary object key: the grammar would have to have a rule for
 * it, and the rule's node type would appear in the inventory. So the question
 * instrument A answers ("does this grammar have a rule for inheritance at all?")
 * is the right question for all three, and the inventory is not merely suggestive
 * here, it is decisive: 465 node types, and none of them is an inheritance,
 * supertype, export, module-publication or interface shape. `CREATE EXTENSION`
 * and `create_extension` ARE in the vocabulary and are handled by the analyzer
 * (`Module` symbol), which is the honest counter-example to check — see the
 * `exports` entry.
 */
type Type = "calls" | "uses" | "contains" | "imports" | "references" | "exports" | "extends" | "implements" | "overrides" | "instantiates"

type Ruled = {
  type: Type
  instrument: "A:grammar-inventory" | "B:parse-tree-count"
  /** A: node types that would express the construct. B: unused. */
  nodeTypesThatWouldMeanIt?: string[]
  /** B: count occurrences on the tree. A: unused. */
  countOnTree?: (root: any, fileLabel: string, hits: string[]) => void
  describe: string
}

export const SQL_RULED: Ruled[] = [
  {
    type: "extends",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: [
      "inheritance_specifier",
      "inherits_clause",
      "keyword_inherits",
      "keyword_inherit",
      "extends_clause",
      "class_declaration",
      "class",
      "interface_declaration",
      "trait_declaration",
      "struct_declaration",
    ],
    describe: "a declaration naming a type it inherits from — `CREATE TABLE c (...) INHERITS (p)`, `ALTER TABLE c INHERIT p`",
  },
  {
    type: "implements",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: [
      "implements_clause",
      "interface_declaration",
      "interface_implementation",
      "superclass",
      "extends_clause",
      "trait_declaration",
    ],
    describe: "a declaration naming a supertype it satisfies — SQL has no interface type and no clause in which to name one",
  },
  {
    type: "exports",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: [
      "export_statement",
      "exports_statement",
      "module_declaration",
      "provide_statement",
      "module",
    ],
    describe: "a declaration naming the symbols this unit publishes to other units — SQL's visibility scope is the DATABASE, and nothing in a SQL file enumerates what it publishes",
  },
]

/**
 * The node types the 465-entry inventory was searched for, and the answer for
 * each, so a reader does not have to run anything to check the three rulings
 * above. Recorded here rather than left implicit because a ruling whose evidence
 * lives only in a 74 KB JSON is a ruling nobody can audit.
 *
 * Source: `validation/m14/fixtures/sql/construct-probe.json`, `grammarVocabulary`
 * (465 entries) and `zeroProbes`.
 */export const SQL_GRAMMAR_INVENTORY_FINDINGS = {
  distinctNodeTypesOverCorpus: 465,
  corpusFiles: 1460,
  /** Every entry here was searched for by SUBSTRING over all 465 type names. */
  substringSearches: {
    inherit: 0,
    implements: 0,
    exports: 0,
    module: 0,
    provide: 0,
    class: 1,
    interface: 0,
    trait: 0,
    struct: 0,
    super: 0,
    extension: 2,
  },
  /** The three node types that DID match a substring, and why none of them is the construct. */
  substringHitsExplained: [
    { type: "create_extension", matchedOn: "extension", n: 0, why: "`CREATE EXTENSION name` — handled by the analyzer as a `Module` symbol, and it occurs 0 times over the census. It is an INBOUND declaration of a package that publishes objects; the publishing set lives in the extension's own control file, not in this unit, so the clause that would express an `exports` edge does not exist here. Named here because it is the strongest candidate a reader could raise against the `exports` ruling, and answering it costs one line." },
    { type: "keyword_extension", matchedOn: "extension", n: 0, why: "the `EXTENSION` keyword token itself — the token half of the above, so it inherits the same 0." },
    { type: "keyword_regclass", matchedOn: "class", n: 0, why: "the `regclass` type name. It matches `class` as a SUBSTRING of a type name, not as a construct, which is the same false-positive shape the gate's own header records for bash (`class voice` inside a telnet IAC word list) and for json (`new Map(` inside a heredoc). It occurs 0 times." },
  ],
  /** Instrument B counts, from `construct-probe.json` `constructCounts` / `zeroProbes`. */
  semanticCounts: {
    "extends-inherits": 0,
    "implements-keyword": 0,
    "implements-node": 0,
    "exports-keyword": 0,
    "exports-node": 0,
    "exports-grant": 0,
  },
} as const

/**
 * A KNOWN WEAKNESS IN THE ARBITER'S CITATION STEP, recorded because running the
 * gate with this table produces three wrong `Written ruling:` pointers.
 *
 * `rulingFor` in `script/m14/ontology-coverage-gate.ts` does not read an
 * explicit per-type id. It walks the spec's RULED decisions in order and returns
 * the FIRST whose `resolution` prose matches `` /`type`/ `` or `/\<type\>/i` AND
 * contains one of `ontology|emits|excluded|type`. Prose is a weak key, and the
 * verdicts come out right while the citations come out wrong:
 *
 *   gate output          cites      the ruling that is actually about it
 *   -------------------  ---------  ---------------------------------------
 *   exports  RULED-SOUND SQL-D11    SQL-D16  (D11 is about `imports`; it names
 *                                           D16 in passing as the counter-case)
 *   extends  RULED-SOUND SQL-D16    SQL-D14
 *   implements RULED-SOUND SQL-D13  SQL-D16  (D13 is about `instantiates`; the
 *                                           word appears in its interface clause)
 *
 * This does NOT change a verdict: `RULED-SOUND` is decided by the instrument
 * result, and `rulingFor` only supplies the citation string appended to the
 * detail. It does mean a reader who follows the pointer lands on the wrong
 * paragraph, which is worth fixing in the shared file.
 *
 * THE FIX, for whoever owns the gate — the reason it is specified rather than
 * left as a complaint: `rulingFor` should take the type's ruling id from data,
 * not from prose. The cheapest correct change is an optional `ontologyType`
 * field on each decision, falling back to the existing prose match:
 *
 *   type Ruled = { … ; ontologyType?: Type }
 *   // in the spec's decisions:
 *   { id: "SQL-D14", ontologyType: "extends", … }
 *   { id: "SQL-D16", ontologyType: "exports",  … }
 *   { id: "SQL-D16", ontologyType: "implements", … }   // needs a second entry, or split D16
 *   // in rulingFor:
 *   const explicit = decs.find((d) => d.status === "RULED" && d.ontologyType === t)
 *   if (explicit) return { reason: explicit.resolution, src: `${specPath}#${explicit.id}` }
 *
 * SQL-D16 covers two types, so it either becomes SQL-D16 and SQL-D17 with the
 * `exports` half and the `implements` half separated, or the explicit field is
 * allowed to be a list. Splitting is cleaner and costs one edit in a file this
 * lane owns.
 */
export const SQL_RULING_CITATIONS = {
  exports: "SQL-D16",
  extends: "SQL-D14",
  implements: "SQL-D16",
} as const
