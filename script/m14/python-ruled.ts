/**
 * PYTHON_RULED — the ruling table `script/m14/ontology-coverage-gate.ts` needs before it
 * will report this lane at all.
 *
 * ## SUPERSEDED 2026-10-10 — `implements` IS emitted, and A's verdict was the wrong answer
 *
 * This file was authored while the lane believed python emitted zero `implements` edges, and
 * the `PYTHON_RULED` entry below is that verdict. It was WRONG, and the way it was wrong is
 * worth keeping: instrument A's "0 of 17 conformance node-type names" is a true measurement
 * of the GRAMMAR and a false answer to "does python have the relation", because the relation
 * does not arrive as its own node — it arrives INSIDE the base list (`class C(Mapping)`),
 * which is where every other OO language puts `extends`. Instrument B was the right
 * instrument and had already counted it: **71 interface-declaring base entries across 33
 * files** (14 ABC + 57 Protocol over 16,377 base-list entries).
 *
 * The lane reversed the ruling on 2026-10-09 (PY-27 → PY-34): a proven interface base
 * publishes ONE edge, the most specific true label (`implements`), with the inheritance fact
 * carried in `metadata.superTypes` — the column the store copies into
 * `brain_symbol.super_types` for the ancestor walk. MEASURED after the change
 * (`script/m14/python-lane-census.mjs`, a 1,200-file derived draw over the whole box):
 * **26 `implements` edges in 14 files, 80.8% with both endpoints resolved.**
 *
 * So the A entry below is retained only as the record of a corrected mistake, NOT as a live
 * verdict: the type IS observed, and the gate's own decision order finds `EMITTED` from
 * observation before it ever reaches a ruling. A reader must not take "RULED-SOUND" from the
 * numbers below. The reversal and its full evidence are in
 * `docs/analyzers/python.md` §`implements`.
 *
 * ## Why this file exists, and why it is not an edit to the gate
 *
 * The gate refuses to run for a language it has no ruling source for. Measured on this
 * branch, 2026-10-05:
 *
 *     $ bun script/m14/ontology-coverage-gate.ts python
 *     ontology coverage gate — python
 *     corpus: 424 admitted files
 *     ontology coverage gate — no RULING SOURCE for python.
 *     Refusing to report: with no ruling anywhere, every un-emitted type would be called
 *     RULED-UNJUSTIFIED, and that is a verdict about the absence of evidence, not about
 *     the lane.  Neither RULED_BY_LANG.python nor script/m14/spec/python-completeness.json
 *     supplies one.
 *     exit 2
 *
 * Note the FIRST line of that output as well: **424 admitted files**. The gate admits
 * corpus only from a top-level directory that is a git checkout, and `python-corpus/` is
 * an AGGREGATE of five checkouts rather than one, so the gate sees none of its 5,365
 * files. The 424 it does admit are stray `.py` inside other languages' repos — 286 in
 * swift-corpus, 41 in haskell, 32 in otp, 20 in ruby. A correct number about the wrong
 * population, which is the failure docs/M14-HONESTY-CONTRACT.md's "Rule: an instrument
 * must declare the population it covered" exists to stop. Fixing it is a change to the
 * shared gate's corpus admission, so it is REPORTED, not made.
 *
 * `script/m14/ontology-coverage-gate.ts` is supervisor-owned, so this lane did not add
 * the table there. The split is the one `script/m14/julia-ruled.ts` established: the
 * ruling DATA is lane-owned and lives here, and the shared gate needs one import.
 *
 * ## The supervisor's edit, in full
 *
 * In `script/m14/ontology-coverage-gate.ts`:
 *
 *   1. after the other `*_RULED` imports, add
 *        import { PYTHON_RULED } from "./python-ruled"
 *   2. add `python: PYTHON_RULED` to `RULED_BY_LANG` (line ~220 on this base)
 *
 * The `Ruled` and `Instrument` types are declared but NOT exported from the gate, so the
 * shape is restated structurally below. TypeScript's structural typing makes the
 * imported value assignable to the gate's local `Ruled[]` without either type being
 * exported.
 *
 * ## Nothing else is needed for the verdict, and that is checked rather than assumed
 *
 * `rulingFor()` (ontology-coverage-gate.ts:327) checks the TABLE FIRST and only falls
 * back to `script/m14/spec/python-completeness.json` when the table has no entry. So the
 * entry below is sufficient on its own; the matching `PY-D8` decision has been added to
 * the spec file as well, because a ruling that lives in only one of the two places the
 * gate reads is a ruling whose disappearance is invisible.
 *
 * ## Read this before accepting the `implements` ruling: the instrument decides the verdict
 *
 * The gate's decision order is EMITTED if observed -> FALSIFIED if `treeHits` has it ->
 * FALSIFIED if instrument A's node list intersects the grammar -> RULED-SOUND if
 * `rulingFor` found prose. And `treeHits` is populated ONLY from entries that declare
 * `instrument: "B:parse-tree-count"` AND supply `countOnTree`. So the instrument is not a
 * label on the evidence; it selects which evidence the gate is allowed to look at.
 *
 * Both readings are runnable and both are published below, so the choice is the
 * supervisor's with the numbers in hand rather than a lane's:
 *
 *   PYTHON_RULED               registers instrument A -> gate reports RULED-SOUND.
 *   PYTHON_RULED_INSTRUMENT_B  registers instrument B -> gate reports FALSIFIED with
 *                              "the construct occurs N times across M files on the PARSE
 *                              TREE — it is derivable, so the ruling is wrong".
 *
 * ## Every number here comes from one run
 *
 *     bun run validation/m14/fixtures/python/implements-probe.ts
 *
 * over the whole pinned population (5,365 tracked `.py`/`.pyi` in five git checkouts
 * under `fixtures/repositories/python-corpus`) plus the UNPINNED `cpython-stdlib`
 * directory (621 files, not a checkout) measured on separate counters. The probe walks
 * the tree-sitter tree with `node.type` and named children only — no regex — and
 * CALIBRATES itself first: `--self-test` asserts exact counts on a synthetic source
 * containing every shape, and the corpus run exits non-zero if that self test fails.
 *
 * The calibration is not ceremony. It caught two real defects in the probe itself: an
 * import-binding pass that read zero on imports it should have found (the `import`
 * keyword is ANONYMOUS, so it is not among namedChildren), and a `.register(` counter
 * that read 365 where 0 was the answer.
 *
 * ## No regex
 *
 * `countOnTree` below navigates `node.type` and named children only. There is not one
 * regular expression in this file.
 */

/** Mirrors `ontology-coverage-gate.ts`'s non-exported `Instrument`. */
type Instrument = "A:grammar-inventory" | "B:parse-tree-count"

/**
 * The gate's relationship-type vocabulary, restated as a literal union rather than `string`.
 *
 * `type: string` LOOKED assignable and was not: the gate's `Ruled.type` is the literal union of
 * its ten ontology types, so `string` is not assignable to it — and NOTHING caught that until
 * `python: PYTHON_RULED` was actually registered in `RULED_BY_LANG` (2026-10-10), because the
 * error only exists at an assignment site and this lane's table had no consumer before then.
 * The neighbouring `script/m14/zig-ruled.ts` declares the same union the same way.
 */
type Type = "calls" | "uses" | "contains" | "imports" | "references" | "exports" | "extends" | "implements" | "overrides" | "instantiates"

/** Mirrors `ontology-coverage-gate.ts`'s `Ruled`. */
export type Ruled = {
  type: Type
  instrument: Instrument
  /** A: node types that would express the construct. B: unused. */
  nodeTypesThatWouldMeanIt?: string[]
  /**
   * WHICH SPACES this lane's probe enumerated. The arbiter refuses to treat a
   * vocabulary-based ruling as RULED-SOUND in a language whose corpus writes key/value
   * bindings unless the ruling declares the `attribute-keys` space, because a construct spelled
   * as an attribute key or keyword argument cannot appear in a node-type inventory (measured on
   * HCL, where `inherits = [...]` left 44 sites invisible to a node-type probe).
   *
   * python IS such a language — the arbiter counts 801,877 key/value bindings over its 11,488
   * files — and this lane's probes DO enumerate that space: `implements-probe.ts` counts the
   * `metaclass=ABCMeta` / `metaclass=abc.ABCMeta` KEYWORD ARGUMENT (a construct spelled as an
   * attribute key, and the interface declaration that needs no import), and
   * `python-construct-census.mts` counts the `.register(` METHOD-NAME spelling (493 calls, 1 with
   * a provable receiver). So the declaration is a statement about what was measured, not a
   * relaxation of the check.
   */
  spacesProbed?: ("node-types" | "block-types" | "attribute-keys" | "corpus-count")[]
  /** B: count occurrences on the tree. A: unused. */
  countOnTree?: (root: any, fileLabel: string, hits: string[]) => void
  /**
   * B only: the count and file count this ruling PUBLISHES for `countOnTree`, over the
   * corpus the gate discovers. These are the numbers the ruling is accountable to, and
   * they live HERE so there is one source of truth — the julia table records that a
   * probe which hardcoded its own figure reported MISMATCH while exiting 0, which is a
   * gate that can neither fail nor be right.
   */
  publishedCount?: number
  publishedFiles?: number
  describe: string
}

/**
 * The 17 node-type names that would express a conformance relation distinct from a
 * supertype clause. Carried over from the candidate lists the gate's own BASH_RULED and
 * CSS_RULED use, plus python's own neighbours, so the gate asks python the question it
 * asks every other lane.
 */
export const PYTHON_SUPERTYPE_NODE_TYPES = [
  "implements_clause",
  "implements_list",
  "implements_specifier",
  "implements_declaration",
  "interface_implementation",
  "interface_specifier",
  "interface_declaration",
  "protocol_declaration",
  "protocol_conformance",
  "conformance_clause",
  "super_interfaces",
  "abstract_class_declaration",
  "type_declaration_list",
  "base_class_clause",
  "type_inheritance_clause",
  "mixin_clause",
  "conform_clause",
]

export const PYTHON_RULED: Ruled[] = [
  {
    type: "implements",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: PYTHON_SUPERTYPE_NODE_TYPES,
    spacesProbed: ["node-types", "attribute-keys"],
    describe:
      "SUPERSEDED 2026-10-10 (PY-34) — python DOES emit `implements` and this verdict is " +
      "stale; see the file header. It is kept as the record of a corrected mistake. " +
      "a CONFORMANCE CLAUSE — a supertype entry naming a type the class satisfies as a " +
      "contract, as distinct from one it inherits an implementation from. " +
      "MEASURED, instrument A (validation/m14/fixtures/python/implements-probe.ts, " +
      "population 5,365 tracked .py/.pyi in 5 checkouts + 621 unpinned cpython-stdlib " +
      "files): the pinned grammar produces 196 distinct node types over the pinned " +
      "population and 198 across both, and **0 of the 17 names above is among them**. " +
      "That is positive evidence of absence rather than a failed search: the full " +
      "vocabulary is enumerated by the probe, not hand-picked. " +
      "WHY python has one class relation and not two: `class C(X)` is the ONLY way to " +
      "name a supertype, and it means the same thing whatever X is. `issubclass(C, X)` " +
      "is True for a concrete base, for an `abc.ABC`, and for a `typing.Protocol` " +
      "alike, and X appears in `C.__mro__` in all three — so `implements` would assert a " +
      "SECOND relation between two nodes the runtime relates in exactly one way. " +
      "NEAREST CONSTRUCT, PUBLISHED RATHER THAN HIDDEN: the corpus does use python's " +
      "interface system — 14 ABC bases and 57 Protocol bases over 16,377 base-list " +
      "entries (0.43%), and 134 `@abstractmethod` methods — and every one of those 71 " +
      "base entries is ALREADY published as an `extends` edge, because it is an " +
      "inheritance. Publishing `implements` as well would add 71 edges duplicating 71 " +
      "`extends` edges to the same targets under a second label, so `bb_graph` on an ABC " +
      "would show two edges to one node. " +
      "THE ONE CONSTRUCT THAT WOULD SETTLE IT, AND ITS COUNT: python does have " +
      "conformance WITHOUT inheritance — `SomeABC.register(SomeConcrete)`, which makes " +
      "`issubclass` true with no base-list entry at all. Measured TIGHT (receiver must " +
      "be a registry this file can prove): **0 occurrences in 0 files**, in the pinned " +
      "population AND in the unpinned cpython-stdlib one, against 365 loose " +
      "`.register(` calls in 75 files that are object and plugin registration " +
      "(`LocalManager.register`, `super().register`). So the construct that would " +
      "genuinely be a second relation is not merely rare — it is absent from 5,986 " +
      "files, and the probe is calibrated to find it when it is there (`--self-test` " +
      "asserts exactly 3 of 6). " +
      "Written ruling: script/m14/spec/python-completeness.json#PY-D8. " +
      "TO OVERTURN: (a) the grammar produces one of the 17 names above, or (b) a probe " +
      "finds a non-zero count of `SomeABC.register(SomeConcrete)` where SomeABC is a " +
      "real abc registry. Either falsifies this and the gate will say so. " +
      "This lane's position, stated so it can be disagreed with: A is the correct " +
      "instrument. A reader who thinks ABC/Protocol bases SHOULD be split out has the " +
      "71-edge number above and can register PYTHON_RULED_INSTRUMENT_B to make the gate " +
      "count it.",
  },
]

/**
 * The same ruling registered on instrument B, which the gate will FALSIFY. Present so
 * the falsification is a measured, runnable thing rather than a paragraph.
 *
 * Counted exactly as `implements-probe.ts` counts it, over that probe's population: a
 * base-list entry of a `class_definition` whose leaf is `ABC`, `ABCMeta` or `Protocol`
 * AND which is provably abc's or typing's rather than a local namesake — that
 * is, spelled qualified (`abc.ABC`, `typing.Protocol`) or bound by a `from abc import
 * ABC` / `from typing import Protocol` in the SAME file. Tree navigation only.
 *
 * POPULATION, DECLARED, because the numbers here were produced by instruments that do
 * not count the same files. `script/m14/python-ontology-census.ts` walks all **5,365**
 * tracked `.py`/`.pyi`; this table and `implements-probe.ts` walk the **4,573** of them
 * at or under 512 KiB, because a tree-sitter parse of a much larger file is not what
 * either probe is measuring. The 792-file difference is a CAP, not a sample, and the two
 * instruments that must agree with each other — this table and
 * `validation/m14/fixtures/python/ruled-probe-check.ts` — use the SAME population rule,
 * which is what makes the check meaningful.
 *
 * `validation/m14/fixtures/python/ruled-probe-check.ts` re-runs this very `countOnTree`
 * over that population and exits non-zero on a mismatch. It caught one: this table
 * published 31 files and the true figure is 33 — a wrong number that both its author and
 * a reader would have taken at face value, because the arbiter never compares
 * `publishedCount` against anything it measures.
 *
 * The unpinned `cpython-stdlib` adds 4 ABC bases and 15 Protocol bases and is never
 * merged into these figures.
 */
export const PYTHON_RULED_INSTRUMENT_B: Ruled[] = [
  {
    type: "implements",
    instrument: "B:parse-tree-count",
    publishedCount: 71,
    publishedFiles: 33,
    countOnTree: (root: any, fileLabel: string, hits: string[]) => {
      /** names this file binds by `from MODULE import NAME`. */
      const bound = new Map<string, string>()
      const collectImports = (n: any): void => {
        if (n.type === "import_from_statement") {
          let module = ""
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (!c || c.type === "wildcard_import") continue
            // The module is the FIRST named child; the `import` keyword is anonymous
            // and is NOT among namedChildren, which is the bug the calibration caught.
            if (module.length === 0 && (c.type === "dotted_name" || c.type === "relative_import")) {
              module = c.text
              continue
            }
            if (c.type === "identifier") bound.set(c.text, `${module}.${c.text}`)
            else if (c.type === "dotted_name") bound.set(c.text, `${module}.${c.text}`)
            else if (c.type === "aliased_import") {
              const nm = c.childForFieldName?.("name") || c.namedChild(0)
              const al = c.childForFieldName?.("alias") || c.namedChild(1)
              if (nm) bound.set(al?.text ?? nm.text, `${module}.${nm.text}`)
            }
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) collectImports(c)
        }
      }
      collectImports(root)

      const leafOf = (node: any): { leaf: string; qualified: boolean; obj?: string } | null => {
        if (node.type === "identifier") return { leaf: node.text, qualified: false }
        if (node.type === "subscript") {
          const first = node.namedChild(0)
          return first ? leafOf(first) : null
        }
        if (node.type === "attribute") {
          const last = node.namedChild(node.namedChildCount - 1)
          if (!last) return null
          const obj = node.namedChild(0)
          return { leaf: last.text, qualified: true, obj: obj && obj.type === "identifier" ? obj.text : undefined }
        }
        return null
      }
      const isAbc = (b: { leaf: string; qualified: boolean; obj?: string }): boolean =>
        (b.leaf === "ABC" || b.leaf === "ABCMeta") &&
        (b.qualified === true || bound.get(b.leaf) === "abc.ABC" || bound.get(b.leaf) === "abc.ABCMeta")
      const isProtocol = (b: { leaf: string; qualified: boolean; obj?: string }): boolean =>
        b.leaf === "Protocol" &&
        (b.qualified === true ||
          bound.get("Protocol") === "typing.Protocol" ||
          bound.get("Protocol") === "typing_extensions.Protocol")

      const sup = (n: any): void => {
        if (n.type === "class_definition") {
          for (let i = 0; i < n.namedChildCount; i++) {
            const args = n.namedChild(i)
            if (!args || args.type !== "argument_list") continue
            for (let j = 0; j < args.namedChildCount; j++) {
              const arg = args.namedChild(j)
              if (!arg || arg.type === "keyword_argument") continue
              const bl = leafOf(arg)
              if (!bl) continue
              if (isAbc(bl) || isProtocol(bl)) {
                hits.push(`${fileLabel}:${n.startPosition.row + 1} base \`${bl.leaf}\` is an interface`)
              }
            }
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) sup(c)
        }
      }
      sup(root)
    },
    describe:
      "71 base-list entries across 33 files name an abc ABC/ABCMeta or a typing " +
      "Protocol, provably abc's or typing's rather than a local namesake (14 ABC + 57 " +
      "Protocol over 16,377 base-list entries, 0.43%). Those ARE python's interface " +
      "declarations, and since 2026-10-09 (PY-34) the analyzer publishes each as a RELABELLED " +
      "edge — `implements`, the most specific true label — instead of `extends`. THIS is the " +
      "instrument that was right, and on 2026-10-09 (PY-34) the lane " +
      "ADOPTED its reading and reversed the instrument-A verdict above — so this table is no " +
      "longer a falsifier the lane is accountable to; it is the measurement the ruling rests " +
      "on. `the analyzer publishes all of them as extends` is no longer true: the 71 base " +
      "entries became 71 RELABELLED edges (`implements`, the most specific true label), with " +
      "the inheritance fact riding in `metadata.superTypes` so no consumer that WALKS the " +
      "hierarchy loses a parent, and the additive reading (both labels for one base) was " +
      "refused as 71 duplicates rather than 71 new facts. The ONE genuinely distinct " +
      "relation python has — `ABC.register(X)` — still reads 0 occurrences in 0 files over " +
      "5,986 files, which is why `implements` has exactly one source shape: the base list.",
  },
]