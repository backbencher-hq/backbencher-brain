/**
 * VUE_FIX MUTATION PROOF — lane-owned, because the shared mutation table
 * (script/m14/mutate-analyzer.ts) is master-owned and this lane may not edit it.
 *
 * A new behaviour is not a behaviour until a deliberately broken version of it
 * makes the suite go red (M14 honesty contract §5.3, and the dual-lens regime's
 * "fixture pins/forbids authored from re-probed emission + regression mutants").
 * This runner applies each defect class to the analyzer's OUTPUT — the same
 * shape the shared mutants use — and calls the SHARED fixture runner
 * (`runLang` from script/m14/run-fixtures.ts) with the mutant attached, so the
 * fixtures, the expectation matcher and the production entry point
 * (ASTEngine.parseFile, which is where the SFC seam runs) are the real ones and
 * nothing here re-implements a check.
 *
 * Each mutant states the defect, the fixture that must catch it, and why THAT
 * fixture is the only thing that can:
 *
 *  F19-NO-DEFAULT-ROW   the seam publishes `exports -> default` again (the exact
 *                       pre-F19 state: 121 such rows on vue-element-admin, 0
 *                       resolving). Caught by vue/options-rename-identity's
 *                       forbid row and by vue/ts-class-heritage-seam's.
 *  F20-DROP-IMPLEMENTS the seam stops carrying the delegate's `implements` rows.
 *  F20-DROP-OVERRIDES  the seam stops carrying the delegate's `overrides` rows.
 *  F20-DROP-EXTENDS    the seam stops carrying the delegate's `extends` rows —
 *                       the Options-API mixin rows still fire, so only the new
 *                       fixture's class-heritage row can see this one.
 *  M59-UNSHIFTED-LINE  a delegated row keeps the delegate's script-relative line
 *                       (the #825 pre-fix state). Caught by the line_number pins.
 *
 * A mutant that SURVIVES is the finding this file exists to produce, so the
 * exit code is non-zero when one does.
 *
 * NO REGEX. String comparison only.
 *
 * Usage: bun script/vue-fix/vue-mutation-proof.ts
 */
import { runLang } from "../m14/run-fixtures"

type Mutant = { id: string; defect: string; mustFail: string[]; transform: (r: any) => any }

const MUTANTS: Mutant[] = [
  {
    id: "F19-NO-DEFAULT-ROW",
    defect: "relationship-fabrication: the seam republishes the `exports -> default` row it now refuses (pre-F19 state)",
    mustFail: ["vue/options-rename-identity", "vue/ts-class-heritage-seam"],
    transform: (r) => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        {
          source: (r.symbols ?? []).find((s: any) => s.kind === "class")?.name ?? "component",
          target: "default",
          type: "exports",
          confidence: 1.0,
          metadata: { isDefault: true, evidenceClass: "structural" },
        },
      ],
    }),
  },
  {
    id: "F20-DROP-IMPLEMENTS",
    defect: "relationship-loss: the seam stops carrying the delegate's `implements` rows",
    mustFail: ["vue/ts-class-heritage-seam"],
    transform: (r) => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type ?? x.relationshipType) !== "implements") }),
  },
  {
    id: "F20-DROP-OVERRIDES",
    defect: "relationship-loss: the seam stops carrying the delegate's `overrides` rows",
    mustFail: ["vue/ts-class-heritage-seam"],
    transform: (r) => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type ?? x.relationshipType) !== "overrides") }),
  },
  {
    id: "F20-DROP-EXTENDS",
    defect: "relationship-loss: the seam stops carrying the delegate's `extends` rows (the Options-API mixin path is untouched, so only a class-heritage fixture can see it)",
    mustFail: ["vue/ts-class-heritage-seam"],
    transform: (r) => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type ?? x.relationshipType) !== "extends" || (x.metadata as any)?.isMixin !== undefined) }),
  },
  {
    id: "M59-UNSHIFTED-LINE",
    defect: "payload-incoherence: a delegated row keeps the delegate's script-relative line_number (the #825 pre-fix state — the offset is recorded on the row itself as metadata.sfcLineOffset)",
    mustFail: ["vue/ts-class-heritage-seam"],
    transform: (r) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        (x.metadata as any)?.sfcDelegated === true && typeof x.line_number === "number"
          ? { ...x, line_number: x.line_number - ((x.metadata as any)?.sfcLineOffset ?? 0) }
          : x,
      ),
    }),
  },
  {
    id: "F19-SILENTLY-DROP-NAMED",
    defect: "relationship-loss, the over-correction: the seam drops EVERY delegated exports row, including the NAMED default export that resolves to a real symbol (what a lazy reading of F19 would write)",
    mustFail: ["vue/ts-class-heritage-seam", "vue/options-rename-identity"],
    transform: (r) => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type ?? x.relationshipType) !== "exports") }),
  },
]

const baseline = await runLang("vue")
console.log(`baseline vue fixtures: pass=${baseline.pass} fail=${baseline.fail}`)
for (const d of baseline.details.filter((x: any) => !x.ok)) {
  console.log(`   pre-existing FAIL ${d.fixture}: ${(d.problems ?? []).join(" | ").slice(0, 160)}`)
}
const baselineFailures = new Set(baseline.details.filter((d: any) => !d.ok).map((d: any) => d.fixture))
console.log()

let survivors = 0
for (const m of MUTANTS) {
  const out = await runLang("vue", { transform: m.transform })
  const failed = new Set(out.details.filter((d: any) => !d.ok).map((d: any) => d.fixture))
  const newly = [...failed].filter((f) => !baselineFailures.has(f))
  const requiredMet = m.mustFail.every((f) => failed.has(f))
  const ok = requiredMet
  if (!ok) survivors++
  console.log(`${ok ? "CAUGHT " : "SURVIVED"} ${m.id.padEnd(28)} fixtures failing: ${[...failed].join(", ") || "(none)"}`)
  console.log(`         defect: ${m.defect}`)
  console.log(`         required to fail: ${m.mustFail.join(", ")} — ${requiredMet ? "all failed as required" : "AT LEAST ONE SURVIVED"}`)
  for (const d of out.details.filter((x: any) => !x.ok && newly.includes(x.fixture))) {
    console.log(`         caught by ${d.fixture}: ${(d.problems ?? [])[0]?.slice(0, 150)}`)
  }
}
console.log(`\nmutants: ${MUTANTS.length}  caught: ${MUTANTS.length - survivors}  survived: ${survivors}`)
if (survivors > 0) process.exitCode = 1