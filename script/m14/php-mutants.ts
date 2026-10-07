/**
 * PHP's mutant set — the `exports` rule this lane added.
 *
 * ## Why this file is separate from `script/m14/mutate-analyzer.ts`
 *
 * `script/m14/mutate-analyzer.ts` is shared machinery (workstream §8), and a per-language
 * registry beside it is the established shape — `json-mutants.ts`, `css-mutants.ts`,
 * `nim-mutants.ts`, `protobuf-mutants.ts`, `clean-mutants.ts` all sit in that directory.
 * PHP's existing mutants live INSIDE the shared array, which is why they run; the wiring
 * needed for this file is therefore reported rather than applied:
 *
 *   import { PHP_MUTANTS } from "./php-mutants"
 *   ...
 *   export const MUTANTS: Mutant[] = [ ...PHP_MUTANTS, ... ]   // or: ...PHP_MUTANTS spread into the array
 *
 * A registry nothing imports is not a mutant that was caught, it is a file that typechecks.
 * `script/m60/scss-mutants.ts` records that failure mode in its own header, so this lane did
 * NOT stop at writing the file: `validation/m14/fixtures/php/mutant-check.mts` imports these
 * transforms, evaluates every `validation/m14/fixtures/php/*.expectation.json` against the
 * mutated result with the SAME `matchConstraints` the real fixture gate uses, and exits
 * non-zero if any mutant survives. Run it; do not infer the pin from this header.
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

PHP_MUTANTS.push(...PHP_RECEIVER_OWNER_MUTANTS)