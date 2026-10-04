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
 *
 * ## WHAT PASS 2 ADDED TO `extends`, AND WHY IT MATTERS MORE THAN THE COUNT
 *
 * Pass 1's overturn condition was "a `keyword_inherits`/`inherits_clause` node
 * inside `create_table`". That is a NODE-NAMED condition, and it is unsound in a
 * specific way: PostgreSQL has a SECOND construct that makes one table a subtype
 * of another, and since PostgreSQL 11 the child inherits the parent's columns
 * without any `INHERITS` clause at all —
 *
 *   CREATE TABLE c PARTITION OF p FOR VALUES FROM (…) TO (…);
 *   ALTER TABLE p ATTACH PARTITION c FOR VALUES FROM (…) TO (…);
 *
 * A grammar could grow that clause, call the node `table_partition_attached` or
 * anything else, and produce zero nodes matching pass 1's condition while making
 * `extends` fully derivable. The ruling would then read 0 on a corpus where
 * the construct is present and readable — still wrong, and still sounding right.
 *
 * So pass 2 PARSED all five shapes against the wired wasm rather than searching
 * node names, in `validation/m14/fixtures/sql/adversarial-probe.mts`'s A12
 * section. Result: `INHERITS` is absorbed into an ERROR, `PARTITION OF` has its
 * `OF <parent>` absorbed into an ERROR, `ATTACH PARTITION` has its whole clause
 * absorbed into an ERROR, `PARTITION BY RANGE` parses cleanly as `table_partition`
 * but names no parent, and `LIKE p` parses (while `INCLUDING ALL` does not). The
 * ruling SURVIVES, and now against the strongest counterexample the language has
 * rather than only the one pass 1 happened to think of.
 *
 * ## THE NUMBERS BELOW, AND WHY THEY ARE FROM A DIFFERENT CORPUS
 *
 * `SQL_GRAMMAR_INVENTORY_FINDINGS` quotes 465 node types over 1,460 admitted
 * files. The shared corpus has since grown to 1,946 admitted files across 141
 * repositories as other lanes cloned into it, and pass 2 re-ran the probe over
 * the whole grown corpus: the inventory is 465 distinct node types still, and
 * every zero below is 0 still. The corpus-wide artifact is
 * `validation/m14/fixtures/sql/construct-probe.json`, regenerated at pass 2's
 * HEAD. A number that had moved would be restated rather than carried, so the
 * fact that none did is itself the check that this table's entries are not
 * sampling artefacts.
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
  corpusFilesAtPass2: 1946,
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
    /**
     * PASS 2 ADDED THIS ONE, and it is the strongest candidate a reader could raise
     * against the `extends` ruling: declarative partitioning makes a child table a
     * subtype of a parent, and the grammar HAS a `table_partition` rule and a
     * `keyword_partition` token — 57 of them corpus-wide. They are all the
     * `PARTITION BY <strategy>` form, which names no parent; the `PARTITION OF
     * <parent>` form puts `OF <parent>` inside an ERROR. Measured, not assumed:
     * `adversarial-probe.mts` A12 parses `CREATE TABLE c PARTITION OF p FOR VALUES
     * …` against the wired wasm and reports the node shape.
     */
    partition: 2,
  },
  /** The node types that DID match a substring, and why none of them is the construct. */
  substringHitsExplained: [
    { type: "create_extension", matchedOn: "extension", n: 30, why: "`CREATE EXTENSION name` — handled by the analyzer as a `Module` symbol. It is an INBOUND declaration of a package that publishes objects; the publishing set lives in the extension's own control file, not in this unit, so the clause that would express an `exports` edge does not exist here. Named here because it is the strongest candidate a reader could raise against the `exports` ruling, and answering it costs one line. The count is 30 at pass 2's corpus against 27 at pass 1's — the corpus grew from 1,460 to 1,946 admitted files — and the verdict does not turn on it." },
    { type: "keyword_extension", matchedOn: "extension", n: 30, why: "the `EXTENSION` keyword token itself — the token half of the above, so it inherits the same count." },
    { type: "keyword_regclass", matchedOn: "class", n: 51, why: "the `regclass` type name. It matches `class` as a SUBSTRING of a type name, not as a construct, which is the same false-positive shape the gate's own header records for bash (`class voice` inside a telnet IAC word list) and for json (`new Map(` inside a heredoc)." },
    { type: "table_partition", matchedOn: "partition", n: 6, why: "`CREATE TABLE t (...) PARTITION BY RANGE|HASH|LIST (…)` — a partitioning STRATEGY, which names no parent table and inherits nothing. A12 parses `PARTITION OF p` separately and it is an ERROR." },
    { type: "keyword_partition", matchedOn: "partition", n: 57, why: "the `PARTITION` keyword token, the token half of the above. 6 of the 57 sit inside a `table_partition`; the rest are `ALTER TABLE … PARTITION BY`, `DROP TABLE … PARTITION OF`-adjacent damage, and `PARTITION OF` absorbed into an ERROR." },
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
  /**
   * PASS 2's A12 capability battery — the shapes that would make `extends`
   * derivable, each PARSED against `wasm/tree-sitter-sql.wasm` rather than
   * searched for by name. A corpus count of 0 is consistent both with "the
   * language lacks the construct" and with "the grammar cannot read it", and only
   * a parse separates them.
   */
  capabilityBattery: [
    { construct: "CREATE TABLE c (…) INHERITS (p)", verdict: "NOT EXPRESSIBLE — the clause does not survive the parse; the create_table ends at the column list and an ERROR holds the rest", nodeType: "ERROR" },
    { construct: "CREATE TABLE c PARTITION OF p FOR VALUES …", verdict: "NOT EXPRESSIBLE — `OF p FOR VALUES FROM` is absorbed by an ERROR inside table_partition", nodeType: "table_partition(ERROR)" },
    { construct: "ALTER TABLE p ATTACH PARTITION c FOR VALUES …", verdict: "NOT EXPRESSIBLE — the whole clause lands in a top-level ERROR", nodeType: "ERROR" },
    { construct: "CREATE TABLE p (…) PARTITION BY RANGE (x)", verdict: "EXPRESSIBLE, but it is a STRATEGY and names no parent, so it is not the construct", nodeType: "table_partition" },
    { construct: "CREATE TABLE c (LIKE p)", verdict: "EXPRESSIBLE — parsed as a column_definition whose type is `p`, i.e. a structural COPY (PostgreSQL: the two tables evolve independently)", nodeType: "column_definition" },
    { construct: "CREATE TABLE c (LIKE p INCLUDING ALL)", verdict: "PARTIALLY EXPRESSIBLE — LIKE survives, `INCLUDING ALL` lands in an ERROR", nodeType: "column_definition(ERROR)" },
  ],
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
