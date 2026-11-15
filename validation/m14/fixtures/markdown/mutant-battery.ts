/**
 * MARKDOWN MUTANT BATTERY — a runner, not a mutant set.
 *
 * ## Why this exists
 *
 * `script/m60/markdown-mutants.ts` exports 14 mutants and NOTHING runs them.
 * `script/m14/mutate-analyzer.ts` builds its `MUTANTS` array from six lane modules
 * (fsharp, css, nim, protobuf, json and the inline set) and markdown is not among them, so
 * `bun run script/m14/mutate-analyzer.ts` never constructs a markdown mutant. A mutant set
 * that is written, reviewed and never executed is a comment about the fixtures rather than
 * a check on them — the exact failure the M14 standing rules call the real shame, and the
 * one `markdown-mutants.ts`'s own header says this lane was found guilty of.
 *
 * Registering the set is a ONE-LINE change to a shared file (import `MARKDOWN_MUTANTS`, add
 * `...MARKDOWN_MUTANTS` to the array) and that file is §8: reported, not edited. So the
 * battery is run HERE instead, and it runs the SAME mutants through the SAME matcher the
 * arbiter would use — `runLang` imported from `script/m14/run-fixtures.ts`, which is
 * exported for exactly this purpose. Nothing about the mutant semantics or the fixture
 * matching is reimplemented; if this script and `mutate-analyzer.ts` disagree, the difference
 * is this script's, and it is visible as such.
 *
 * ## The caught rule, transcribed from `mutate-analyzer.ts:18866`
 *
 *   caught = mutated.fail > base.fail || total problems in mutated > total problems in base
 *
 * so a defect landing inside an ALREADY-failing fixture still counts as caught. With 0
 * markdown fixtures failing at baseline, the second term is 0 and the rule reduces to "more
 * failures" — this script reports both terms separately rather than relying on that.
 *
 * ## What a SURVIVED here would mean
 *
 * Not that the analyzer is right. It means the fixture named in that mutant's `description`
 * does not pin the surface the mutant removes, and the mutant has not been retired — it is
 * still a live claim about coverage that this evidence contradicts.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/markdown/mutant-battery.ts
 */
import { writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { runLang } from "../../../../script/m14/run-fixtures"
import { MARKDOWN_MUTANTS } from "../../../../script/m60/markdown-mutants"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, "../../../..")
const OUT = path.join(REPO, "validation/m60/markdown/mutant-battery.json")

type AnyRec = { id: string; language: string; defectClass: string; description: string; transform: (r: any, src?: string) => any }

async function realAnalyzer(lang: string): Promise<any> {
  const mod: any = await import("../../../../src/ast/real-markdown-analyzer")
  const cls = Object.values(mod).find((v: any) => typeof v === "function" && /Analy/.test(v.name))
  if (!cls) throw new Error(`no analyzer class exported by src/ast/real-markdown-analyzer.ts`)
  return new (cls as any)()
}

async function main(): Promise<void> {
  const mutants = MARKDOWN_MUTANTS as unknown as AnyRec[]
  console.log(`markdown mutant battery — ${mutants.length} mutants from script/m60/markdown-mutants.ts`)
  console.log(`matcher: runLang() imported from script/m14/run-fixtures.ts (the arbiter's own)`)
  console.log(`NOTE: script/m14/mutate-analyzer.ts does NOT import this set, so none of these run in the project gate.\n`)

  const base = await runLang("markdown")
  console.log(`baseline: ${base.pass} pass, ${base.fail} fail`)
  const baseProblems = base.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)

  const real = await realAnalyzer("markdown")
  const rows: any[] = []
  let survived = 0
  for (const m of mutants) {
    const mutant = {
      analyze: async (...args: any[]) =>
        m.transform(await (real as any).analyze(...args), typeof args[1] === "string" ? args[1] : undefined),
      transform: m.transform,
    }
    const mutated = await runLang("markdown", mutant as any)
    const mutProblems = mutated.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
    const caught = mutated.fail > base.fail || mutProblems > baseProblems
    const caughtBy = mutated.details
      .filter((d: any) => !d.ok)
      .map((d: any) => d.fixture)
      .filter((f: string) => !base.details.some((bd: any) => !bd.ok && bd.fixture === f))
    if (!caught) survived++
    console.log(`${caught ? "CAUGHT   " : "SURVIVED "} ${m.id}  (${base.fail} -> ${mutated.fail} failures${caughtBy.length ? "; " + caughtBy.join(", ") : ""})`)
    rows.push({
      id: m.id,
      defectClass: m.defectClass,
      caught,
      baseFail: base.fail,
      mutatedFail: mutated.fail,
      baseProblems,
      mutatedProblems: mutProblems,
      caughtBy,
      description: m.description,
    })
  }

  const out = {
    instrument: "markdown mutant battery (validation/m14/fixtures/markdown/mutant-battery.ts)",
    mutantSet: "script/m60/markdown-mutants.ts",
    registeredInProjectGate: false,
    registrationGap:
      "script/m14/mutate-analyzer.ts builds MUTANTS from fsharp/css/nim/protobuf/json and the inline set; MARKDOWN_MUTANTS is not among them. Shared file, §8: one import and one array entry, reported not edited. Consequence measured here instead: these 14 mutants never execute under `bun run script/m14/mutate-analyzer.ts`.",
    matcher: "runLang() from script/m14/run-fixtures.ts — the arbiter's own matcher, imported, not reimplemented",
    caughtRule: "mutated.fail > base.fail || mutatedProblems > baseProblems (transcribed from mutate-analyzer.ts:18866)",
    baseline: { pass: base.pass, fail: base.fail, problems: baseProblems },
    mutants: rows.length,
    caught: rows.length - survived,
    survived,
    rows,
    verdict: survived === 0
      ? `all ${rows.length} mutants are caught by the fixture suite when the suite is run with them — the set is live evidence against this lane's fixtures, even though the project gate never constructs it`
      : `${survived} of ${rows.length} mutants SURVIVE: the fixtures named in their descriptions do not pin the surface those mutants remove. Each is a live coverage claim this evidence contradicts.`,
  }
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(`\n${out.verdict}`)
  console.log(`wrote ${path.relative(REPO, OUT)}`)
  process.exit(survived === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })