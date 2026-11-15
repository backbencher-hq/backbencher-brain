/**
 * PROTOBUF MUTANT SWEEP — does this lane's fixture suite actually detect defects?
 *
 * WHY THIS EXISTS ALONGSIDE `script/m14/mutate-analyzer.ts`. The shared harness
 * gates 46 lanes and `script/m14/mutate-analyzer.ts` is a file several lanes edit
 * concurrently, so this lane does not write its mutants into it: the registry
 * lives in `script/m14/protobuf-mutants.ts`, shaped exactly like
 * `script/m14/fsharp-mutants.ts`, and this runner drives it. Registering it with
 * the shared harness is a TWO-LINE change to that file and is written up as a
 * report item rather than made here.
 *
 * The detection rule is COPIED from the shared harness, not re-invented, because a
 * weaker rule here would report survivors the real gate does not have:
 *
 *   caught = more failing fixtures, OR more distinct problems inside fixtures that
 *   were ALREADY failing. A defect landing in broken code is still a defect.
 *
 * It also prints, per mutant, WHICH fixture went red and why, so a survivor names
 * the hole rather than just counting.
 *
 * Usage: bun run script/m14/tmp/protobuf/probe/mutant-sweep.mts [--only <id-prefix>]
 */
import { runLang } from "../../../run-fixtures"
import { PROTOBUF_MUTANTS } from "../../../protobuf-mutants"
import { RealProtobufAnalyzer } from "../../../../../src/ast/real-protobuf-analyzer"

const only = process.argv.includes("--only")
  ? process.argv[process.argv.indexOf("--only") + 1]
  : null

const real = new RealProtobufAnalyzer()

console.log("clean baseline:")
const base = await runLang("protobuf")
console.log(`  ${base.pass} pass / ${base.fail} fail`)
for (const d of base.details as any[]) {
  console.log(`  ${d.ok ? "PASS" : "FAIL"}  ${d.fixture}${d.ok ? "" : ` — ${(d.problems ?? []).length} problems`}`)
}

const selected = only ? PROTOBUF_MUTANTS.filter((m) => m.id.startsWith(only)) : PROTOBUF_MUTANTS
if (selected.length === 0) {
  console.error(`--only "${only}" matched 0 of ${PROTOBUF_MUTANTS.length} protobuf mutants — nothing verified`)
  process.exit(3)
}

const baseProblems = (base.details as any[]).reduce((a, d) => a + (d.problems?.length ?? 0), 0)
let survivors = 0
const rows: { id: string; caught: boolean; by: string }[] = []

for (const m of selected) {
  const mutant = {
    analyze: async (...args: any[]) =>
      m.transform(
        await (real as any).analyze(...args),
        typeof args[1] === "string" ? args[1] : undefined,
      ),
    transform: m.transform,
  }
  const mutated = await runLang("protobuf", mutant)
  const mutProblems = (mutated.details as any[]).reduce((a, d) => a + (d.problems?.length ?? 0), 0)
  const caught = mutated.fail > base.fail || mutProblems > baseProblems
  const by = (mutated.details as any[])
    .filter((d) => !d.ok)
    .filter((d) => !(base.details as any[]).some((bd) => !bd.ok && bd.fixture === d.fixture))
    .map((d) => {
      const first = (d.problems ?? [])[0]
      return `${d.fixture}${first ? ` [${String(first).slice(0, 150)}]` : ""}`
    })
  if (!caught) survivors++
  rows.push({ id: m.id, caught, by: by.join(" | ") })
  console.log(
    `${caught ? "CAUGHT  " : "SURVIVED"}  ${m.id}  (${base.fail} -> ${mutated.fail} failures, ` +
      `${baseProblems} -> ${mutProblems} problems${by.length ? "; " + by.join(" | ") : ""})`,
  )
}

console.log("")
console.log(`SUMMARY ${selected.length} protobuf mutants: ${selected.length - survivors} caught, ${survivors} survived`)
if (survivors > 0) {
  console.error(
    `${survivors} SURVIVING PROTOBUF MUTANT(S) — the protobuf fixture suite cannot detect these defects.`,
  )
  process.exit(2)
}
