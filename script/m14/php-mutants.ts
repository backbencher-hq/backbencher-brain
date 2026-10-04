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