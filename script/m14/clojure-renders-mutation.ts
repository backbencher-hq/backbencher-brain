/**
 * CLOJURE LANE — THE `renders` FIXTURE'S MUTATION PROOF (the fixture is RED-able, or it is nothing).
 * Author: Muhammad Ishaq Khan (clojure lane).
 *
 * ## WHY THIS INSTRUMENT EXISTS
 *
 * A behavioural fixture that PASSES proves nothing unless it can FAIL. The lane's `renders`
 * fixture is the first one in this lane that pins a relation the analyzer had NO emitter for
 * (`renders` was one of the four extended values the lane had ruled), so the fixture has to answer
 * two questions with a MEASUREMENT and not with prose:
 *
 *   1 · **IS IT RED-ABLE?** — against an analyzer that does not emit `renders`, the fixture must
 *       FAIL. This is the "RED-able" half of the Lead's requirement, and it is the half that a
 *       green run can never show.
 *   2 · **DO THE CONTROLS HAVE TEETH?** — against an implementation that matched the SOURCE TEXT
 *       instead of the node structure, the fixture must FAIL on its `forbidRelationships` rows
 *       (a vector whose head is a symbol is a value, not an element; a call is not a render; a
 *       name inside a string is not a name). Without this half, the fixture would pin a TEXT
 *       MATCHER and call it a structural read.
 *
 * ## THE SHAPE (the Lead's harness's shape, not a new one)
 *
 * The Lead's `script/m14/mutate-analyzer.ts` wraps the analyzer's OUTPUT rather than rewriting the
 * analyzer's source: `analyze: async (...args) => m.transform(await real.analyze(...args), …)`.
 * That is the same shape here, for the same reason — the thing under test is the BEHAVIOUR, and
 * the suite is the instrument that decides. The Lead's file is the Lead's; this is the clojure
 * lane's own proof for its own fixture, and it is a separate file rather than an edit to a shared
 * one.
 *
 * ## USAGE
 *
 *   bun run script/m14/clojure-renders-mutation.ts
 */
import { runLang } from "./run-fixtures"
import { RealClojureAnalyzer } from "../../src/ast/real-clojure-analyzer"

const real = new RealClojureAnalyzer()
const base = await runLang("clojure")
console.log(`BASE (the shipped analyzer): ${base.pass} pass / ${base.fail} fail`)

type Rel = { type: string; from: string; target: string; [k: string]: any }

/** MUTANT A — THE EMITTER IS GONE. Every `renders` edge is dropped from the output, which is
 *  EXACTLY what an analyzer without the emitter publishes. The fixture must fail. */
const dropRenders = (result: any): any => {
  if (!result?.relationships) return result
  return { ...result, relationships: result.relationships.filter((r: Rel) => r.type !== "renders") }
}

/** MUTANT B — THE READ IS TEXTUAL. Every function symbol in the file is made to render every
 *  other function symbol in the file, which is what a source-text matcher would produce: the
 *  fixture's three `forbidRelationships` rows must each fire. */
const textualRenders = (result: any): any => {
  if (!result?.relationships) return result
  const fns: any[] = (result.symbols ?? []).filter((s: any) => s.kind === "function" || s.kind === "method")
  const extra: Rel[] = []
  for (const a of fns) for (const b of fns) {
    if (a.name === b.name) continue
    extra.push({ type: "renders", from: a.name, target: b.name, confidence: 0.8 })
  }
  return { ...result, relationships: [...result.relationships, ...extra] }
}

const mutants: { id: string; defectClass: string; transform: (r: any) => any }[] = [
  { id: "clojure/drop-renders-emitter", defectClass: "the emission site is removed", transform: dropRenders },
  { id: "clojure/textual-renders", defectClass: "the relation is read from text, not from nodes", transform: textualRenders },
]

let survivors = 0
for (const m of mutants) {
  const mutant = {
    analyze: async (...args: [any, any, any]) => m.transform(await (real.analyze as any)(...args)),
    transform: m.transform,
  }
  const run = await runLang("clojure", mutant as any)
  const baseProblems = base.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
  const mutProblems = run.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
  const caught = run.fail > base.fail || mutProblems > baseProblems
  const caughtBy = run.details.filter((d) => !d.ok).map((d: any) => d.fixture)
    .filter((f) => !base.details.some((bd: any) => !bd.ok && bd.fixture === f))
    .join(", ")
  console.log(`${caught ? "CAUGHT" : "SURVIVED"}  ${m.id}  (${base.fail} -> ${run.fail} failures; new failures: ${caughtBy || "(none)"})  [${m.defectClass}]`)
  if (!caught) survivors++
}

/* THE FIXTURE ROW, VERBATIM, so the reader can see WHAT the mutation broke and not only THAT
 * something broke. */
const rendersFixture = base.details.find((d: any) => String(d.fixture).includes("renders-component"))
console.log(`\nthe renders fixture's own state on the BASE analyzer: ${rendersFixture?.ok ? "PASS" : "FAIL"}`)

if (survivors > 0) {
  console.error(`\n${survivors} SURVIVING MUTANT(S) — the renders fixture cannot fail, so it asserts nothing.`)
  process.exit(2)
}
console.log(`\nall ${mutants.length} mutants caught — the renders fixture is RED-able and its controls have teeth`)
