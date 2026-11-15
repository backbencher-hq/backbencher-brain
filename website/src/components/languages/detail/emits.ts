import { RELATIONSHIP_TYPES } from "@/data/brain-languages"
import type { LangFamily, RelationshipTypeName } from "@/data/brain-languages"

// What this page knows about an analyzer's reach, derived — never asserted.
//
// WHY A HELPER INSTEAD OF A TEMPLATE
// ----------------------------------
// Round 1 of these pages had a `tier` on every family (full / structural /
// generic) and a library of prewritten sentences to go with it. Three of those
// sentences were false, and they were false on four live pages: TOML, Protobuf,
// Visual Basic and Nim were all described as having "no dedicated analyzer" and
// "no call graph is resolved". Every one of those families has a large
// hand-written analyzer wired into `getAnalyzer`, and `GenericAnalyzer` is the
// unreachable `default:` branch of that switch. The tier ranked the product
// backwards — it put PowerShell beside TOML.
//
// So there is no sentence bank here. A family row carries two things this page
// can state without inventing: the `extracts` line (what the analyzer records)
// and `emits` (the relationship types its module can construct, derived from
// src/ast/real-*-analyzer.ts). Anything else on the page — the headline, the
// limitations — comes from the family's authored record in data/language-depth,
// and where that record has not landed the page simply says less.

/** The ten types the engine's RelationshipType enum declares. */
export const VOCABULARY_SIZE = RELATIONSHIP_TYPES.length

/**
 * The relationship types this family's analyzer can construct.
 *
 * Read from the family row and filtered against the engine's own vocabulary, so
 * a name the registry invents cannot reach the page. Order is the registry's,
 * which is what makes the ledger on this page read as one fixed set of slots.
 *
 * The `string` arm is a shape tolerance, not a second source: `LangFamily.emits`
 * is declared as `RelationshipTypeName[]`, and the page must not break if a row
 * arrives carrying its list space-joined instead. Either shape names the same
 * types, and both are resolved against RELATIONSHIP_TYPES.
 */
export function emittedTypes(raw: LangFamily["emits"] | string | undefined): RelationshipTypeName[] {
  const parts = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/\s+/) : []
  const named = new Set<string>(parts.filter((p) => (RELATIONSHIP_TYPES as readonly string[]).includes(p)))
  return RELATIONSHIP_TYPES.filter((t) => named.has(t))
}

/** The types this analyzer does not construct — the empty half of the ledger. */
export function unconstructedTypes(emitted: RelationshipTypeName[]): RelationshipTypeName[] {
  return RELATIONSHIP_TYPES.filter((t) => !emitted.includes(t))
}

/**
 * The sentence the page opens with when a family has no authored record.
 *
 * Every clause is read off the family row — the extensions, the recorded
 * symbols, the size of the emitted vocabulary. It asserts nothing about
 * resolution, call graphs or quality, because a row cannot support such a claim
 * and a page that needs one has said too much.
 */
export function registryHeadline(family: LangFamily): string {
  const n = emittedTypes(family.emits).length
  const reach =
    n === 0
      ? "no relationship type is recorded against it yet"
      : `${n} of the engine's ${VOCABULARY_SIZE} relationship types`
  return `${family.name} files — ${family.ext} — are read by a dedicated analyzer that records ${family.extracts}, and constructs ${reach}.`
}

/** "3 of 10" — the ledger's own count line, never typed. */
export function reachLabel(count: number): string {
  return `${count} of ${VOCABULARY_SIZE}`
}