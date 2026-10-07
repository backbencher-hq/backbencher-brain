/**
 * RUST LANE MUTANTS — the lane's own mutation evidence for the two edges this
 * wave added (`imports` in RUST-D31, `overrides` in RUST-D32).
 *
 * WHY A LANE-OWNED FILE. `script/m14/mutate-analyzer.ts` is MASTER-owned
 * (ONTOLOGY-WORKSTREAM.md, Ownership), so a lane cannot register a mutant in
 * it. Registering these four there is reported as a need, not done here.
 *
 * WHAT IT PROVES, and what it does not. It wraps the analyzer exactly the way
 * the shared harness wraps it — `analyze` delegates to the real
 * `RealRustAnalyzer` and the transform runs on its result — and it asks the same
 * question with the same instrument (`runLang` from `run-fixtures.ts`, i.e. the
 * fixture expectations are the only oracle). So "CAUGHT" here means the fixture
 * suite fails with the defect injected and passes without it.
 *
 * It is NOT a substitute for the shared gate: the shared run is what the
 * milestone records, it covers 20+ lanes at once, and it is the artifact whose
 * freshness the honesty gate checks. This file is the lane's proof that each new
 * behaviour has a test that can fail, produced without editing a file this lane
 * does not own.
 *
 * Each mutant is a REVERT to the pre-fix state, in the same spirit as the shared
 * registry's existing rust mutants ("restores the pre-fix bug where ..."), so a
 * survivor would mean the fix is untested rather than that the mutant was odd.
 *
 * CLI: npx tsx script/m14/rust-lane-mutants.ts
 */
import { runLang } from "./run-fixtures"

type Result = { symbols?: any[]; relationships?: any[]; imports?: any[]; exports?: any[]; metadata?: any }
type Transform = (r: Result) => Result

const MUTANTS: { id: string; defectClass: string; description: string; transform: Transform }[] = [
  {
    id: "rust/drop-use-import-edges",
    defectClass: "relationship-loss",
    description:
      "RUST-D31 revert: drops every `imports` relationship, which is the lane's pre-fix state exactly — the `use` declarations were recorded in the imports array and published as NO relationship, so the LSP file-level dependency reader could not see a rust `use`. Caught by rust/use-import-edges, whose five expectation rows are all `imports` edges.",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.type !== "imports") }),
  },
  {
    id: "rust/import-edge-global-source",
    defectClass: "fabricated-endpoint",
    description:
      "RUST-D31 revert of the SOURCE rule: republishes every import edge from the magic source `\"global\"`, which is the spelling css rejected in this position ('a magic source that names no symbol in any stylesheet') and which R7 bans in a name-bearing field. Caught by rust/use-import-edges — one fixture cannot catch this twice over, so the mutant is the reason the forbid row exists.",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map(x => (x.type === "imports" ? { ...x, source: "global" } : x)),
    }),
  },
  {
    id: "rust/drop-trait-impl-overrides",
    defectClass: "relationship-loss",
    description:
      "RUST-D32 revert: drops every `overrides` relationship, which is the state RUST-D1's prose ruling described ('no overrides edge exists by design'). Caught by rust/trait-impl-overrides.",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.type !== "overrides") }),
  },
  {
    id: "rust/overrides-target-bare-method",
    defectClass: "relationship-mislabel",
    description:
      "RUST-D32: keeps the edge but drops the BASE OWNER from its target (`Store.put` becomes `put`). The edge then names a call rather than an override and cannot be joined to the trait it replaces. Caught by rust/trait-impl-overrides' forbid row — which is the reason that row exists rather than a fourth expectation.",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map(x =>
        x.type === "overrides" ? { ...x, target: String(x.target ?? "").split(".").pop() } : x),
    }),
  },
  {
    id: "rust/imports-evidence-tier-usage-contextual",
    defectClass: "evidence-tier",
    description:
      "RUST-D31: stamps `usage_contextual` on every import edge instead of `import_based`, which is the fall-through the tier classifier used before the branch was added. Nothing about the EDGE changes, so this is only catchable by an expectation that pins the tier — and the tier is what a consumer reads to decide the dependency needs no corroboration. Caught by rust/use-import-edges' `meta.evidenceClass` row.",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map(x =>
        x.type === "imports" ? { ...x, metadata: { ...(x.metadata ?? {}), evidenceClass: "usage_contextual" } } : x),
    }),
  },
  {
    id: "rust/overrides-any-local-trait-name",
    defectClass: "fabricated-edge",
    description:
      "RUST-D32: claims the override whenever the impl's trait LEAF matches an in-file trait, path prefix or not — the guess a name-matching implementation makes. It fabricates `Ghost.ping overrides Foreign.ping` for `impl some_other_crate::Foreign for Ghost`, where a per-file analyzer cannot tell a crate from a local module. Caught by rust/trait-impl-overrides' forbid row for `Ghost.ping`.",
    transform: r => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        { source: "Ghost.ping", target: "Foreign.ping", type: "overrides", confidence: 1, metadata: { isOverride: true, reasonCode: "leaf-match" } },
      ],
    }),
  },
  {
    id: "rust/fnptr-declaration-position-guard-removed",
    defectClass: "fabricated-edge",
    description:
      "RUST-MR re-measured (2026-10-03): removes the fn-pointer-TYPE parameter guard entirely, which is what the pre-measurement state of `real-rust-analyzer.ts:1989` looked like once its two UNREACHABLE arms were the only thing keeping the branch honest. The edge is fabricated: `schema`, `cb`, `paren_schema` and `name` only DECLARE in a type alias — there is no body and therefore no bound-name set — so each of them must publish nothing. Caught by rust/fnptr-parameter-declares, whose four forbid rows are load-bearing because every name is `use`-imported and therefore RESOLVES (a declaration-position name only publishes a read when it also resolves, so a fixture with unresolvable names would pass with this mutant in place).",
    transform: r => ({
      ...r,
      // Simulating the guard's ABSENCE means publishing the reads it suppresses.
      // The sources are spelled the way the analyzer spells them today when a
      // declaration has no enclosing symbol — which is the defect this mutant
      // is built on top of (see the lane report's `global`-source finding).
      relationships: [
        ...(r.relationships ?? []),
        ...FN_PTR_FABRICATED.map(t => ({
          source: "global", target: t, type: "uses", confidence: 0.9, metadata: { rustSpecific: true },
        })),
      ],
    }),
  },
]

/** The parameter names that DECLARE inside the fn-pointer type aliases of
 *  `rust/fnptr-parameter-declares`. Fabricating a read for each one is what the
 *  removed guard used to do. `name` is in the list because the `extern "C"` type
 *  alias declares it too; the fixture's positive control reads the same imported
 *  leaf from a real function body under a DIFFERENT source (`control`), so this
 *  cannot be satisfied by the control and the fixture cannot pass with the
 *  mutant in place. */
const FN_PTR_FABRICATED = ["schema", "cb", "paren_schema", "name"]

async function realAnalyzer(): Promise<any> {
  const mod: any = await import("../../src/ast/real-rust-analyzer")
  return new mod.RealRustAnalyzer()
}

const base = await runLang("rust")
const real = await realAnalyzer()
console.log(`rust lane mutants — baseline: ${base.pass} pass / ${base.fail} fail\n`)

let survivors = 0
for (const m of MUTANTS) {
  const mutant = {
    analyze: async (...args: any[]) => m.transform(await real.analyze(...args)),
    transform: m.transform,
  }
  const mutated = await runLang("rust", mutant)
  const baseProblems = base.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
  const mutProblems = mutated.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
  const caught = mutated.fail > base.fail || mutProblems > baseProblems
  const caughtBy = mutated.details
    .filter((d: any) => !d.ok)
    .map((d: any) => d.fixture)
    .filter((f: string) => !base.details.some((bd: any) => !bd.ok && bd.fixture === f))
    .join(", ")
  if (!caught) survivors++
  console.log(`${caught ? "CAUGHT  " : "SURVIVED"}  ${m.id}`)
  console.log(`           ${base.fail} -> ${mutated.fail} fixture failures${caughtBy ? "; new failures: " + caughtBy : ""}`)
  if (!caught) console.log(`           ${m.description}`)
}
console.log(`\n${MUTANTS.length - survivors}/${MUTANTS.length} caught, ${survivors} survivors`)
console.log("NOTE: these four+two mutants are NOT registered in script/m14/mutate-analyzer.ts (MASTER-owned).")
process.exitCode = survivors === 0 ? 0 : 1