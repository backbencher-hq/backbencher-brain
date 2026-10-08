/**
 * PHP's mutant set — the `exports` rule this lane added.
 *
 * ## Why this file is separate from `script/m14/mutate-analyzer.ts`
 *
 * `script/m14/mutate-analyzer.ts` is shared machinery (workstream §8), and a per-language
 * registry beside it is the established shape — `json-mutants.ts`, `css-mutants.ts`,
 * `nim-mutants.ts`, `protobuf-mutants.ts`, `clean-mutants.ts` all sit in that directory.
 * PHP's older mutants live INSIDE the shared array; this file's are spread into it the same
 * way, by two lines in `mutate-analyzer.ts`:
 *
 *   import { PHP_MUTANTS } from "./php-mutants"
 *   ...
 *   export const MUTANTS: Mutant[] = [ ..., ...PHP_MUTANTS, ... ]
 *
 * A registry nothing imports is not a mutant that was caught, it is a file that typechecks.
 * That was MEASURED here rather than reasoned about, because the first version of this header
 * argued the wiring was unnecessary and was wrong: `npx tsx script/m14/verify-orphaned-mutants.ts`
 * read `script/m14/php-mutants.ts  PHP_MUTANTS  6  ORPHANED` and failed the gate with "3 mutant
 * file(s) export a registry that mutate-analyzer.ts does not spread … Those mutants have never
 * run", the three being php, go and ts-deriv. The import and the spread are now in place and the
 * same gate reads `WIRED`. The gate is the authority on that claim; re-run it, do not trust this
 * sentence.
 *
 * Two layers, because the mutants below can only reach ONE of them:
 *
 *   - `validation/m14/fixtures/php/mutant-check.mts` injects these transforms for real,
 *     evaluates every `validation/m14/fixtures/php/*.expectation.json` against the mutated
 *     result with the SAME `matchConstraints` the production gate uses, and exits non-zero if
 *     any mutant survives. It is the layer that reports WHICH fixture killed which mutant.
 *   - the shared registry runs them through `run-fixtures.ts` so the F4 gate can fail for this
 *     lane at all.
 *
 * NEITHER reaches the projection. `run-fixtures.ts:728` calls `analyzer.analyze()` directly, so
 * a rule applied in `keepSymbol` (`src/ast/pool-worker.ts:494`) is invisible to both — which is
 * why `php/drop-keyword-named-members` below is a RESULT-level revert of a PROJECTION-level
 * defect, and why the projection itself is pinned separately by
 * `validation/m14/fixtures/php/orphan-endpoint-gate.mts` (it imports `parseFile`, the production
 * path, and fails on a `contains` target its own file did not publish).
 *
 * ## What each mutant reproduces
 *
 * Every one of the three is a defect that was actually possible in this code, not a
 * hypothetical. The first two are the two ways the rule goes wrong silently — a dropped
 * edge and a widened edge both leave the OTHER nine types untouched, so no per-edge gate
 * on any other type notices. The third is the labelling defect.
 */
import type { Mutant } from "./mutate-analyzer"

export const PHP_MUTANTS: Mutant[] = [
  {
    id: "php/drop-define-exports-edge",
    language: "php",
    defectClass: "relationship-loss",
    description:
      "drops every `exports` edge — the php/define-exports pin. The defect class is the one the whole workstream exists to catch: a type that is EMITTED by the source and fires on 49 of 4,642 corpus files can still be lost in one filter, and the loss is invisible to every other type's gate because the other nine are untouched.",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "exports") }),
  },
  {
    id: "php/emit-nested-define-as-file-export",
    language: "php",
    defectClass: "fabricated-relationship",
    description:
      "publishes a `define()` that sits INSIDE a function body as a file export (`global -> LAZY_ONLY`) — the scope defect. The corpus has 11 such calls, so this mutant fabricates 11 edges asserting the file publishes a name whose publication depends on a function running. Caught by php/define-exports' forbidRelationships: a function-body `define()` is not a file publication.",
    transform: r => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        {
          source: "global",
          target: "LAZY_ONLY",
          type: "exports",
          confidence: 1,
          line_number: 51,
          metadata: { phpSpecific: true, fileLevel: true, relationshipType: "define_call", mutant: true },
        },
      ],
    }),
  },
  {
    id: "php/file-define-as-contains",
    language: "php",
    defectClass: "mislabelled-relationship",
    description:
      "also files a `define()`d name under `contains` (`global -> CLOOGLE_DB_HOST`) — the labelling defect. A `define()`d name resolves against the GLOBAL scope and no node in the file contains it, so a `contains` edge says the file owns a global. It is the specific confusion this contract has to hold: `DECLARED_CONST` (a namespace-scoped `const`) IS carried by `contains`, and the two look alike.",
    transform: r => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        {
          source: "global",
          target: "CLOOGLE_DB_HOST",
          type: "contains",
          confidence: 1,
          line_number: 43,
          metadata: { isContained: true, mutant: true },
        },
      ],
    }),
  },
  {
    id: "php/drop-absolute-fq-define-publication",
    language: "php",
    defectClass: "relationship-loss",
    description:
      "reverts the callee-resolution fix: drops every `exports` edge whose callee was the FULLY QUALIFIED `\\define`, which is exactly what the bare-name-only rule did before 2026-10-08. Written GENERICALLY off the edge's own `metadata.calleeShape` rather than a hardcoded target name, for the reason recorded above the owner mutants — a name-hardcoded filter silently stops matching and then reports a survive as a pass. Caught by php/define-exports' `expectRelationships` on `AUTO_PREPEND_STYLE`; the population it costs is 1 edge, and it is a publication PHP guarantees unconditionally (`\\define` is fully qualified, so there is no namespace lookup and no fallback for the rule to be wrong about), in phpunit's `tests/end-to-end/generic/_files/auto_prepend_file.php` — a file whose whole purpose is that the constant is globally visible.",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).filter(
        (x: any) => !(x.type === "exports" && x.metadata?.calleeShape === "absolute-fq"),
      ),
    }),
  },
]

/**
 * The RECEIVER OWNER mutants.
 *
 * `metadata.owner` on a member-position edge is the identity half of a member: a php member is
 * PUBLISHED as `(bare name, ownerName)` and the edge now carries the owner the receiver node
 * already stated. Three things can go wrong with that, and they fail in OPPOSITE directions —
 * the first loses the key, the other two invent it — so one mutant cannot stand for all three.
 *
 * The expensive direction is the second. A dropped owner costs a missing edge, which is a gap a
 * consumer can see. An INVENTED owner does not: it names a class that really exists and really
 * has a method with that name, so the edge resolves, the graph looks healthy, and the reverse
 * walk has been told the caller lives on the wrong class. That is wrong refactoring advice
 * rather than a missing edge, which is why `php/owner-falls-back-to-enclosing-scope` is the one
 * that matters rather than the easiest one.
 *
 * All three are written off the result's OWN symbol table (`ownerName`, `metadata.fqn`) rather
 * than a name-hardcoded filter, so they stay valid on any fixture — the failure mode that left
 * `swift/drop-container-subscript-uses` surviving was a hardcoded string that silently stopped
 * matching.
 */
const MEMBER_TYPES = new Set(["calls", "uses"])

/** method/function name -> the owner it is published under. */
function ownerOfMethod(r: any): Map<string, string> {
  const m = new Map<string, string>()
  for (const s of r?.symbols ?? []) {
    const owner = s.ownerName ?? s.owner
    if (owner && typeof s.name === "string" && (s.kind === "method" || s.kind === "function")) {
      m.set(s.name, owner)
    }
  }
  return m
}

/** class leaf name -> the fully-qualified path its own symbol publishes. */
function fqnOfOwner(r: any): Map<string, string> {
  const m = new Map<string, string>()
  for (const s of r?.symbols ?? []) {
    if (typeof s.name !== "string") continue
    const fqn = s.metadata?.fqn
    if (typeof fqn === "string" && fqn.length > 0 && fqn !== s.name) m.set(s.name, fqn)
  }
  return m
}

export const PHP_RECEIVER_OWNER_MUTANTS: Mutant[] = [
  {
    id: "php/drop-receiver-owner",
    language: "php",
    defectClass: "relationship-loss",
    description:
      "strips `metadata.owner` from every edge — the state of this lane before the change, reproduced faithfully rather than described. The receiver node was on hand at all six member-position emission sites and discarded, so `$this->render()`, `self::render()`, `parent::render()` and `Widget::render()` all published the bare target `render` and were mutually indistinguishable; `render` is a method on many classes, so the reverse walk picked one declaration by a rule nobody chose. Caught by php/receiver-owner's `meta.owner` rows.",
    transform: r => ({
      ...r,
      relationships: (r?.relationships ?? []).map((x: any) => {
        if (!x?.metadata || typeof x.metadata !== "object") return x
        if (!("owner" in x.metadata)) return x
        const { owner: _dropped, ...rest } = x.metadata
        return { ...x, metadata: rest }
      }),
    }),
  },
  {
    id: "php/owner-falls-back-to-enclosing-scope",
    language: "php",
    defectClass: "fabricated-relationship",
    description:
      "fills in the ABSENT owner with the enclosing scope — the tempting wrong answer, and the only direction in this set that is silently harmful. A member-position edge's source is the enclosing METHOD (an edge reads `calls -> build`, `uses -> __construct`), so the result's own symbol table maps it to the class it is written in, and that class is exactly what gets attached to receivers that state no owner: `$obj->m()` (a local variable whose class is whatever was assigned), `$this->svc->m()` (a chain whose type is the PROPERTY's), and `parent::m()` in a class with no declared base. Every fabricated owner names a real class that really has a method with that name, so the edge RESOLVES and the graph looks healthy — which is why a wrong owner is worse than a missing one. Caught by php/receiver-owner's three `meta.owner: null` rows.",
    transform: r => {
      const ownerOf = ownerOfMethod(r)
      return {
        ...r,
        relationships: (r?.relationships ?? []).map((x: any) => {
          if (!MEMBER_TYPES.has(x?.type)) return x
          if (x?.metadata && typeof x.metadata === "object" && x.metadata.owner) return x
          const enclosing = ownerOf.get(String(x?.source ?? ""))
          if (!enclosing) return x
          return { ...x, metadata: { ...(x?.metadata ?? {}), owner: enclosing, mutant: true } }
        }),
      }
    },
  },
  {
    id: "php/owner-publishes-qualified-path",
    language: "php",
    defectClass: "mislabelled-relationship",
    description:
      "publishes the owner as the FULLY-QUALIFIED path (`\\Fixture\\ReceiverOwner\\Qualified`) rather than the leaf name every other row in this lane publishes. Targets are bare names everywhere else — `leafName` in processObjectCreation, the `name` field of the scoped/member calls — so the qualified form would not join against the `ownerName` on the symbol side and would change what every downstream consumer sees. On graphql a qualified publish measured -75% unresolved, so it is not a strawman; it is the alternative this rule had to reject on evidence. Caught by php/receiver-owner, whose `onlyViaAbsolutePath` row has no unqualified twin to satisfy it (a fixture row matches with some(), so the qualified form alone is what pins the reduction).",
    transform: r => {
      const fqn = fqnOfOwner(r)
      return {
        ...r,
        relationships: (r?.relationships ?? []).map((x: any) => {
          const owner = x?.metadata?.owner
          if (typeof owner !== "string" || owner.length === 0) return x
          const qualified = fqn.get(owner)
          if (!qualified) return x
          return { ...x, metadata: { ...x.metadata, owner: qualified, mutant: true } }
        }),
      }
    },
  },
]

/**
 * The PROJECTION mutants — the defect class neither fixture harness can reach.
 *
 * `php/drop-keyword-named-members` is a FAITHFUL revert of a live defect, not a hypothetical.
 * `src/ast/pool-worker.ts` `keepSymbol` refused php symbols BY NAME —
 * `RESERVED = { php: new Set(["self", "parent"]) }` — with no reference to the kind or the
 * owner, while the analyzer went on emitting the `contains` edges that name those members.
 * `self` and `parent` are SEMI-RESERVED in php 7+: illegal as a top-level declaration name
 * (`class parent {}` is a parse error) and perfectly legal as a method, a property or a class
 * constant. So the rule deleted legal members and left an edge whose endpoint was in no store
 * row. Measured over the whole admitted population (5,094 files, 350,342 edges): exactly ONE
 * such edge existed, `contains Node -> parent` at
 * `phpmyadmin/src/Navigation/Nodes/Node.php:54` (`public Node|null $parent = null;`), and it
 * was the only edge in the lane naming a declaration the store did not hold. The fix exempts
 * php symbols whose KIND is a member kind AND that carry an `ownerName`; classes, functions and
 * namespaces named `parent`/`self` are still refused, which is the half that cannot be written
 * as valid php and therefore has to be pinned from this side.
 *
 * WHY THE REVERT IS RESULT-LEVEL. The defect is in the PROJECTION, and the projection is not
 * on the fixture path (`run-fixtures.ts:728` calls `analyze()` directly), so a mutant cannot
 * reproduce it where it lived. This one reproduces its EFFECT: the name-only drop, applied to
 * the symbol table, leaving every relationship intact. Caught by the five `expectSymbols` rows
 * of `php/keyword-member-names` — which also fail on the unfixed tree's own behaviour, measured
 * BEFORE the fix as "0 of 5 member declarations published, 5 orphaned contains targets".
 *
 * `php/publish-ownerless-reserved-names` is the OPPOSITE direction, and it is the one a
 * careless fix produces: exempt `parent`/`self` by name and let an ownerless one through. The
 * two are not redundant — the first loses a legal member, the second admits an illegal
 * declaration — and the same fixture pins both, via `forbidSymbols` rows that say a symbol
 * named `parent`/`self` with NO owner must not be published at all. The exempted form is
 * exactly `(member kind, owner present)`, and each half of that conjunction needs a row that
 * fails when it is dropped.
 */
const KEYWORD_MEMBER_NAMES = new Set(["self", "parent"])

export const PHP_PROJECTION_MUTANTS: Mutant[] = [
  {
    id: "php/drop-keyword-named-members",
    language: "php",
    defectClass: "symbol-loss",
    description:
      "re-instates the name-only symbol drop (`self`/`parent` refused without reference to kind or owner) at the result level, exactly as `keepSymbol` did before the fix. Relationships are left untouched, which is the defect's whole danger: the analyzer keeps emitting `contains Holder -> parent` while the member it names is gone, so the lane's only orphan endpoint is a store-vs-analyzer divergence rather than a missing edge — a shape no per-edge gate on any other type can see. Caught by php/keyword-member-names, whose five expectSymbols rows are the property, constant and method forms of both names.",
    transform: r => ({
      ...r,
      symbols: (r?.symbols ?? []).filter((s: any) => !KEYWORD_MEMBER_NAMES.has(String(s?.name))),
    }),
  },
  {
    id: "php/publish-ownerless-reserved-names",
    language: "php",
    defectClass: "fabricated-symbol",
    description:
      "the over-broad fix: a `parent`/`self` declaration with no owner (the class, interface, trait, enum, namespace or top-level function the language really does reserve) is published. It is the direction that looks like an improvement — the projection stops deleting anything — and it is wrong for a reason the symbol table would hide: a bare `parent` joins every `parent::` and `$this->parent` edge at once, so a keyword illegally in a type position becomes a resolution candidate for a member. Caught by php/keyword-member-names' two forbidSymbols rows, which name a `parent`/`self` symbol whose ownerName is absent.",
    transform: r => ({
      ...r,
      symbols: [
        ...(r?.symbols ?? []),
        { name: "parent", kind: "class", metadata: { mutant: true } },
        { name: "self", kind: "function", metadata: { mutant: true } },
      ],
    }),
  },
]

// TWO pushes, and the reason this is spelled out rather than folded into the array literal: the
// projection group was added by REPLACING the receiver-owner push line, which silently made the
// three receiver-owner mutants unreachable — they are still exported, still counted by
// `verify-orphaned-mutants.ts` (it reads the FIRST `export const *_MUTANTS` and PHP_MUTANTS is
// still spread, so the gate stays green), and they stopped RUNNING. Measured, not argued: with
// the push missing, `BB_MUTANT_ONLY=php/ bun script/m14/mutate-analyzer.ts` printed no line for
// any of the three. A registry that is exported and counted but not reached is the exact failure
// `verify-orphaned-mutants.ts` was written for, one level down, and no gate in this repo can see
// it — so the count below is asserted at runtime instead, by
// `validation/m14/fixtures/php/mutant-check.mts`, which fails if `PHP_MUTANTS.length` disagrees
// with the number of `id:` rows this file declares.
/**
 * The RECOVERY-ESCAPE mutants — the fix that publishes the members `markdown.php`'s mis-nested
 * class body hid (see `php/recovery-swallowed-members`, and TIER 0.2 of the lane's status).
 *
 * Three directions, because the change has three ways to be wrong and they fail differently:
 * the first is the state before the fix (a member written below a damaged statement is invisible),
 * the second is the reading the fixture REJECTS (a recovered member published as a global
 * function), and the third is the one a reader is most likely to ship by writing only HALF of the
 * fix — publishing the recovered declarations without stopping the damaged body's walk from
 * reaching them, so every call inside them is emitted twice under two different sources.
 *
 * The third is the reason the fix is two paired changes rather than one, and it is not
 * hypothetical: `walkBody` reaches a nested declaration's subtree today, so the moment the escape
 * publishes that declaration AS a symbol its body has two walkers. A gate that matches 'at least
 * one' edge of a kind cannot see a duplicate, which is why the fixture pins this with
 * `expectRelationshipCount` (`equals: 1` on a call that must exist exactly once, `equals: 0` on
 * the attribution the damaged method must NOT carry) rather than with a forbid row.
 */
export const PHP_RECOVERY_MUTANTS: Mutant[] = [
  {
    id: "php/drop-recovered-members",
    language: "php",
    defectClass: "symbol-loss",
    description:
      "the PRE-FIX state, reproduced faithfully: every declaration the recovery-escape published is removed again, and so are the `contains` edges that only exist because it published them. That is what the analyzer did on `FSharp.Formatting/.../php/markdown.php` — 20 real class members (doLists, processListItems, makeCodeSpan, prepareItalicsAndBold, formParagraphs, encodeAttribute, encodeAmpsAndAngles, encodeEmailAddress, handleSpanToken, …) were invisible because recovery nested them inside the method before them, while the corpus kept emitting 19 `calls` edges naming them. Caught by php/recovery-swallowed-members, whose four member rows sit BELOW the damaged statement on purpose: a fix that recovered the first declaration and stopped would pass every row above and fail `callsSwallowed`.",
    transform: r => {
      const recovered = (r?.symbols ?? []).filter((s: any) => s.metadata?.recoveredFromBody === true)
      if (!recovered.length) return r
      const names = new Set(recovered.map((s: any) => String(s.name)))
      return {
        ...r,
        symbols: (r?.symbols ?? []).filter((s: any) => s.metadata?.recoveredFromBody !== true),
        relationships: (r?.relationships ?? []).filter(
          (x: any) => !(String(x.type) === "contains" && names.has(String(x.target))),
        ),
      }
    },
  },
  {
    id: "php/publish-recovered-members-as-global-functions",
    language: "php",
    defectClass: "mislabelled-relationship",
    description:
      "the reading the fixture REJECTS: a recovered declaration is published as a GLOBAL FUNCTION (kind `function`, no owner) and its containment edge is dropped, because a function owned by a class is not a shape this lane publishes. It is tempting for a reason worth stating — a `function` inside a body really does become a global in PHP when the enclosing code runs, and `collectPhpFileScope` already registers nested named functions as file-scope function values — but publication must describe the SOURCE, and the source writes these functions in the class body between members. Caught by php/recovery-swallowed-members' three `forbidSymbols` rows (`ownerName: null`, the top-level absent-or-null convention) and, independently, by its `expectSymbols` `kind: method` rows — two channels, because a mutant that cleared the owner but kept the kind would otherwise survive.",
    transform: r => {
      const recovered = (r?.symbols ?? []).filter((s: any) => s.metadata?.recoveredFromBody === true)
      if (!recovered.length) return r
      const names = new Set(recovered.map((s: any) => String(s.name)))
      return {
        ...r,
        symbols: (r?.symbols ?? []).map((s: any) => {
          if (s.metadata?.recoveredFromBody !== true) return s
          const { isMethod: _dropped, ...rest } = s.metadata ?? {}
          return { ...s, kind: "function", ownerName: undefined, ownerKind: undefined, metadata: { ...rest, mutant: true } }
        }),
        relationships: (r?.relationships ?? []).filter(
          (x: any) => !(String(x.type) === "contains" && names.has(String(x.target))),
        ),
      }
    },
  },
  {
    id: "php/re-walk-recovered-subtrees",
    language: "php",
    defectClass: "double-emission",
    description:
      "HALF THE FIX, the failure the paired skip exists to prevent: the recovered declarations are published, and the damaged method's body walk still reaches their subtrees, so every call and read inside them is emitted TWICE — once under the member that contains it and once under the method recovery nested it in. Reproduced from the result's own line ranges: for each recovered declaration, every call/read whose line falls inside it is re-emitted under the smallest enclosing callable, which on this fixture is `damaged`. This is the mutant that says the two halves are one change: `php/drop-recovered-members` would still be caught if the skip alone were removed, and `php/publish-recovered-members-as-global-functions` would be caught if only the kind were wrong — NEITHER notices a duplicated edge, because a fixture's `expectRelationships` matches at least one. Caught by php/recovery-swallowed-members' `expectRelationshipCount`: `calls swallowedB -> swallowedA` must be EXACTLY one and `calls damaged -> swallowedB` exactly ZERO.",
    transform: r => {
      const syms = (r?.symbols ?? []) as any[]
      const recovered = syms.filter((s: any) => s.metadata?.recoveredFromBody === true)
      if (!recovered.length) return r
      const line = (s: any): number => Number(s?.startLine ?? s?.range?.startLine ?? -1)
      const endLine = (s: any): number => Number(s?.endLine ?? s?.range?.endLine ?? -1)
      const extra: any[] = []
      for (const s of recovered) {
        const container = syms
          .filter((m: any) => (m.kind === "method" || m.kind === "function") && m !== s && line(m) <= line(s) && endLine(m) >= endLine(s))
          .sort((a: any, b: any) => endLine(a) - line(a) - (endLine(b) - line(b)))[0]
        if (!container) continue
        for (const x of (r?.relationships ?? []) as any[]) {
          if (!["calls", "uses", "instantiates", "references"].includes(String(x.type))) continue
          const ln = Number(x.line_number ?? -1)
          if (!(ln >= line(s) && ln <= endLine(s))) continue
          extra.push({ ...x, source: String(container.name), metadata: { ...(x.metadata ?? {}), mutant: true } })
        }
      }
      if (!extra.length) return r
      return { ...r, relationships: [...(r?.relationships ?? []), ...extra] }
    },
  },
]

/**
 * The NESTED NAMED FUNCTION round — `publishNestedNamedFunctions`.
 *
 * Four mutants, one per way the rule can be wrong, and every one of them is a reading that was
 * actually available rather than a hypothetical:
 *
 *   drop      the pre-fix state itself (the symbol pass simply does not run);
 *   as-method the rejected READING the source vetoes: a function written in a method's body
 *             published as a member of that method's class;
 *   bare      the second rejected reading: the same declaration published with NO owner, which in
 *             a namespaced file breaks the ownership rule every other function in the same file
 *             follows;
 *   damaged   removing the damage guard, so the class members a broken body swallowed are ALSO
 *             published as nested globals — the reading that would make `markdown.php`'s 22
 *             recovered members both members and globals.
 *
 * Each transform is written off the RESULT's own metadata (`metadata.nestedIn`, the callable the
 * declaration sits in; `metadata.recoveredFromBody`, the escape's marker) rather than off names,
 * so a mutant cannot silently stop matching when the fixture is edited — the failure mode that
 * left swift/drop-container-subscript-uses surviving for months.
 */
const PHP_NESTED_FUNCTION_MUTANTS: Mutant[] = [
  {
    id: "php/drop-nested-function-symbols",
    language: "php",
    defectClass: "symbol-loss",
    description:
      "THE PRE-FIX STATE, faithfully: every nested named function disappears from the store and so do the `contains` edges that give it an owner. Not a hypothetical — it is what all 5,094 admitted files produced before this round, where the only trace of the declaration was an edge SOURCED AT its name (Slim's two `references testProcessRequest -> ...`) or calling it (`calls useHelper -> nestedHelper`). Written off `metadata.nestedIn`, the marker the pass itself sets, so the revert stays faithful to whatever the fixture looks like. Caught by php/nested-named-functions' `expectSymbols`, `expectSymbolCount` and the two `contains` rows.",
    transform: r => {
      const nested = (r?.symbols ?? []).filter((s: any) => s.metadata?.nestedIn)
      if (!nested.length) return r
      const keys = new Set(nested.map((s: any) => `${String(s.name)}\u0000${String(s.ownerName ?? "")}`))
      return {
        ...r,
        symbols: (r?.symbols ?? []).filter((s: any) => !s.metadata?.nestedIn),
        relationships: (r?.relationships ?? []).filter(
          (x: any) => !(String(x.type) === "contains" && keys.has(`${String(x.target)}\u0000${String(x.source ?? "")}`)),
        ),
      }
    },
  },
  {
    id: "php/publish-nested-functions-as-methods",
    language: "php",
    defectClass: "fabricated-symbol",
    description:
      "THE REJECTED READING the source vetoes: a nested function published as a METHOD of the class whose method declared it. Reproduced generically off the result — the enclosing class is found by looking up the callable the symbol names in `metadata.nestedIn` in the symbol table and taking ITS owner, which is exactly how a reader would resolve it, so no class name is hardcoded. The symbol becomes a member that the source does not declare, and the store gains a `contains NestedHost -> nestedHelper` edge a consumer would use to resolve an inherited call. Caught by php/nested-named-functions' `forbidSymbols` row (ownerName NestedHost) and by its `expectSymbols` row (ownerName must be the namespace).",
    transform: r => {
      const syms = (r?.symbols ?? []) as any[]
      const ownerOfCallable = new Map<string, string>()
      for (const s of syms) {
        if (s.kind !== "method" && s.kind !== "function") continue
        if (s.ownerName) ownerOfCallable.set(String(s.name), String(s.ownerName))
      }
      let changed = false
      const symbols = syms.map((s: any) => {
        const encl = s.metadata?.nestedIn
        if (!encl) return s
        const cls = ownerOfCallable.get(String(encl))
        if (!cls) return s
        changed = true
        return { ...s, kind: "method", ownerName: cls, ownerKind: "class", metadata: { ...(s.metadata ?? {}), mutant: true } }
      })
      if (!changed) return r
      // the containment edge follows the owner, and the namespace's edge goes away
      const pairs = new Set(symbols.filter((s: any) => s.metadata?.nestedIn).map((s: any) => `${String(s.ownerName)}\u0000${String(s.name)}`))
      const relationships = (r?.relationships ?? []).filter(
        (x: any) => !(String(x.type) === "contains" && [...pairs].some((p) => p.endsWith(`\u0000${String(x.target)}`))),
      )
      for (const p of pairs) {
        const [owner, name] = p.split("\u0000")
        relationships.push({ source: owner, target: name, type: "contains", confidence: 1.0, metadata: { mutant: true } } as any)
      }
      return { ...r, symbols, relationships }
    },
  },
  {
    id: "php/publish-nested-functions-as-bare-globals",
    language: "php",
    defectClass: "fabricated-symbol",
    description:
      "THE SECOND REJECTED READING: the nested function is published, its `contains` edge is kept, but it carries NO owner. In a namespaced file every top-level function is owned by its namespace, so this makes two function symbols in ONE file follow two ownership rules — and PHP's global-table name for the declaration is `Fixture\\NestedFunctions\\innerValue`, not `innerValue`, so an ownerless symbol is a name no caller can spell. It is also the state a reader would land on by treating \"nested\" as \"file-level but unattached\". Caught by the fixture's `forbidSymbols` row with `ownerName: null` and by its `expectSymbols` ownerName.",
    transform: r => {
      const nested = (r?.symbols ?? []).filter((s: any) => s.metadata?.nestedIn && s.ownerName)
      if (!nested.length) return r
      const keys = new Set(nested.map((s: any) => `${String(s.name)}\u0000${String(s.ownerName)}`))
      return {
        ...r,
        symbols: (r?.symbols ?? []).map((s: any) =>
          s.metadata?.nestedIn ? { ...s, ownerName: undefined, ownerKind: undefined, metadata: { ...(s.metadata ?? {}), mutant: true } } : s,
        ),
        relationships: (r?.relationships ?? []).filter(
          (x: any) => !(String(x.type) === "contains" && keys.has(`${String(x.target)}\u0000${String(x.source ?? "")}`)),
        ),
      }
    },
  },
  {
    id: "php/publish-damaged-body-declarations-as-nested-functions",
    language: "php",
    defectClass: "double-emission",
    description:
      "THE DAMAGE GUARD REMOVED. The pass skips a declaration whose body parent `hasError`, because those 22 markdown.php declarations are class members the parser could not close the body over — MEMBERS, published as members by the recovery escape. Remove the guard and they are published a SECOND time as namespace-owned globals, which is the reading that would make one declaration both a member and a global. Reproduced off the escape's own marker: every symbol with `metadata.recoveredFromBody` gains a namespace-owned twin in the same file, plus the containment edge that follows. Caught by php/recovery-swallowed-members — its `expectSymbolCount` (`swallowedA` exactly 1) and its `forbidSymbols` rows were authored for the escape and catch the duplicate without being touched.",
    transform: r => {
      const syms = (r?.symbols ?? []) as any[]
      const recovered = syms.filter((s: any) => s.metadata?.recoveredFromBody === true && s.ownerName)
      if (!recovered.length) return r
      const ns = syms.find((s: any) => s.kind === "namespace")?.name
      const extra: any[] = []
      for (const s of recovered) {
        const owner = ns ?? undefined
        extra.push({ ...s, kind: "function", ownerName: owner, ownerKind: owner ? "namespace" : undefined, metadata: { ...(s.metadata ?? {}), mutant: true, nestedIn: String(s.ownerName) } })
      }
      const relationships = [...(r?.relationships ?? [])]
      for (const s of extra) {
        if (!s.ownerName) continue
        relationships.push({ source: s.ownerName, target: s.name, type: "contains", confidence: 1.0, metadata: { mutant: true } } as any)
      }
      return { ...r, symbols: [...syms, ...extra], relationships }
    },
  },
]

/**
 * The heritage payload (`metadata.superTypes`), and the THREE ways it fails.
 *
 * The payload exists because the store seam that persists a project-wide hierarchy reads
 * `symbol.metadata.superTypes` (`src/ast/parallel-indexer.ts:3590` -> `brain_symbol.super_types`) and
 * php never published it: the column was NULL on every row, so `retargetCrossFileOverrides`
 * returned before its first query and php's inheritance was, to a store consumer, ABSENT rather
 * than thin. Each mutant below is one direction of that failure, and the directions are not
 * interchangeable — which is why there are three rather than one:
 *
 *   1. the payload VANISHES. Every other label in the graph is untouched, so nothing else notices;
 *   2. the payload keeps the BASE and drops the INTERFACES. This is the one that arrives by
 *      accident, because `metadata.baseClass` already existed and mirroring it costs nothing — the
 *      result is a column that looks populated and is half the hierarchy, which is worse than NULL
 *      for a consumer that trusts it (a member reached through an interface is not inherited from
 *      the base). Reverted by reading the result's OWN `extends` edges, so it cannot go vacuous if
 *      the rule or a fixture is renamed;
 *   3. the payload names a heritage the declaration does NOT have — the naive re-derivation from
 *      the node text. It is the direction that fabricates rather than loses: the PHPD10 shape
 *      `class InvalidArgumentException extends \InvalidArgumentException` resolves to the class's
 *      OWN name, and a payload that re-read the node would write a SELF-LOOP into the column that
 *      exists to be walked.
 */
/** The kinds the heritage payload can appear on — the four declaration shapes php publishes a
 *  heritage for. `trait` is in the set because the analyzer's own `isClassLikeOwnerKind` treats it
 *  as one; it carries no heritage in PHP, so including it only means mutant 3 has a shape it can
 *  name itself on, which is the direction it exists to reproduce. */
const CLASS_LIKE_KINDS = new Set(["class", "interface", "trait", "enum"])

const PHP_HERITAGE_MUTANTS: Mutant[] = [
  {
    id: "php/heritage-payload-dropped",
    language: "php",
    defectClass: "lost-metadata",
    description:
      "strips `metadata.superTypes` from every symbol — the state of this lane before the change, reproduced faithfully rather than described. Same symbols, same names, same kinds, same heritage EDGES; one metadata key gone. Nothing else in the ontology moves, so the graph looks exactly as healthy as it did: this is precisely why the column stayed NULL for php without any gate going red, and why the defect needed a fixture of its own. Caught by php/heritage-published's six `meta.superTypes` rows.",
    transform: r => ({
      ...r,
      symbols: (r?.symbols ?? []).map((s: any) => {
        if (!s?.metadata || typeof s.metadata !== "object") return s
        if (!("superTypes" in s.metadata)) return s
        const { superTypes: _dropped, ...rest } = s.metadata
        return { ...s, metadata: rest }
      }),
    }),
  },
  {
    id: "php/heritage-payload-base-only",
    language: "php",
    defectClass: "lost-metadata",
    description:
      "keeps the base and drops the interfaces — the accidental half-payload, and the reason the fixture asserts the set on a class that has BOTH rather than a class per shape. Reverted by reading the result's OWN `extends` edges, never a name list: an entry survives only if this declaration emits an `extends` edge to it, which is exactly the base-only rule (an interface's parents ARE extends edges, so an interface keeps its list and the discrimination stays honest). Caught by php/heritage-published — `WithBaseAndInterfaces` loses `Second` and `Labeled`, `WithInterfaceOnly` and `Suit` lose everything and go back to absent.",
    transform: r => {
      const extendsTargets = new Map<string, Set<string>>()
      for (const x of (r?.relationships ?? []) as any[]) {
        if (String(x?.type) !== "extends") continue
        const src = String(x?.source ?? "")
        let set = extendsTargets.get(src)
        if (!set) { set = new Set(); extendsTargets.set(src, set) }
        set.add(String(x?.target ?? ""))
      }
      return {
        ...r,
        symbols: (r?.symbols ?? []).map((s: any) => {
          const list = s?.metadata?.superTypes
          if (!Array.isArray(list) || list.length === 0) return s
          const keep = list.filter((n: any) => extendsTargets.get(String(s.name))?.has(String(n)))
          const { superTypes: _dropped, ...rest } = s.metadata
          return { ...s, metadata: keep.length ? { ...rest, superTypes: keep } : rest }
        }),
      }
    },
  },
  {
    id: "php/heritage-payload-names-itself",
    language: "php",
    defectClass: "fabricated-relationship",
    description:
      "adds each class-like declaration's OWN name to its heritage — what a payload re-derived from the node text produces, and the one direction here that FABRICATES instead of losing. Every declaration with no heritage gains one that points at itself, so the store column reads populated for exactly the shapes the analyzer declined to publish. It is not hypothetical: the PHPD10 gate exists because `class InvalidArgumentException extends \\InvalidArgumentException` resolves to the class's own name, and the class branch emits no edge for it — a payload that re-read the raw base text would put that self-loop in the column a consumer walks. Caught by php/heritage-published's three `meta.superTypes: null` rows (`NoHeritage`, `PlainIface`, `InvalidArgumentException`), which is what those rows are FOR: without them the omission side of the rule would be unfalsifiable.",
    transform: r => ({
      ...r,
      symbols: (r?.symbols ?? []).map((s: any) => {
        if (!s || typeof s.name !== "string" || !s.name) return s
        if (!CLASS_LIKE_KINDS.has(String(s.kind))) return s
        const md = { ...(s.metadata ?? {}) }
        const list = Array.isArray(md.superTypes) ? md.superTypes : []
        if (list.includes(s.name)) return s
        md.superTypes = [...list, s.name]
        return { ...s, metadata: md }
      }),
    }),
  },
]

PHP_MUTANTS.push(...PHP_RECEIVER_OWNER_MUTANTS)
PHP_MUTANTS.push(...PHP_PROJECTION_MUTANTS)
PHP_MUTANTS.push(...PHP_RECOVERY_MUTANTS)
PHP_MUTANTS.push(...PHP_NESTED_FUNCTION_MUTANTS)
PHP_MUTANTS.push(...PHP_HERITAGE_MUTANTS)