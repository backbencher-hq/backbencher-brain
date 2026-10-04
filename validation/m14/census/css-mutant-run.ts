/**
 * M14.0.F4 for the css lane — RUN the lane's mutants against the css fixture suite and
 * report the counts.
 *
 * ## Why this exists and is lane-owned
 *
 * `script/m14/mutate-analyzer.ts` is shared machinery (ONTOLOGY-WORKSTREAM.md
 * §Ownership) and its `RULED_BY_LANG`-style registry holds `bash`, `json` and
 * `fsharp`'s entries. The css mutants live in `script/m14/css-mutants.ts`, which needs
 * a two-line import in the shared registry that this lane does not own and therefore
 * does not make. Until that wiring lands, `bun run script/m14/mutate-analyzer.ts css`
 * reports css mutants it has never heard of, and \"the F4 gate covers css\" would be a
 * claim about a registry entry that does not exist.
 *
 * So the evidence is produced HERE, by actually running each mutant: the clean suite is
 * run first to get the baseline, then each mutant's transform is handed to the SAME
 * `runLang` the shared harness uses, and the mutant is CAUGHT only if the failure count
 * rises above that baseline. A surviving mutant fails THIS script.
 *
 * `runLang` is imported from the shared runner rather than reimplemented: the point is
 * to prove the SHARED suite catches the defect, so the suite used must be the shared
 * one. Only the registry is lane-owned.
 *
 * ## Exit code
 *
 * 0 iff every mutant raised the failure count. Non-zero otherwise, so a survivor is a
 * failure of this script and not a note in a log.
 *
 * ## Usage
 *
 *   bun run validation/m14/census/css-mutant-run.ts
 *   bun run validation/m14/census/css-mutant-run.ts --json <path>
 */
import { CSS_MUTANTS } from "../../../script/m14/css-mutants"
import { CSS_MUTANTS as CSS_M60_MUTANTS } from "../../../script/m60/css-mutants"
import { runLang } from "../../../script/m14/run-fixtures"

/**
 * BOTH css mutant sets run, not just this round's.
 *
 * `script/m60/css-mutants.ts` holds 13 mutants the lane wrote earlier, and
 * `docs/analyzers/real-css-analyzer.md` claims "all 13 are caught". Nothing imports
 * that file: `script/m14/mutate-analyzer.ts` wires only `FSHARP_MUTANTS` from it, so
 * the claim has been describing a set no gate executes. Rather than restate the claim
 * with a different adjective, this runner runs them too and the doc records the
 * measured result — including if some of them no longer fail, because a pin that has
 * stopped being able to fail is a false assurance and the honest move is to say so.
 */
const SETS: { label: string; mutants: readonly any[] }[] = [
  { label: "m60 (13 pre-existing, unwired in script/m14/mutate-analyzer.ts)", mutants: CSS_M60_MUTANTS as any },
  { label: "m14 (this round's `overrides` set)", mutants: CSS_MUTANTS as any },
]

// `runLang(lang, overrideAnalyzer)` expects an ANALYZER whose `analyze` produces the
// result the fixtures check. A mutant is a transform on the RESULT, so it is applied
// by wrapping the real analyzer: same input, one deliberate defect on the way out.
const wrap = (transform: (r: any, src?: string) => any): any => {
  return class MutantAnalyzer {
    private inner: any
    constructor(inner: any) {
      this.inner = inner
    }
    async analyze(root: any, content: string, filePath: string, ctx?: any): Promise<any> {
      const r = await this.inner.analyze(root, content, filePath, ctx)
      return transform(r, content)
    }
  }
}

const buildReal = async (): Promise<any> => {
  const mod: any = await import("../../../src/ast/real-css-analyzer")
  const inst = new mod.RealCssAnalyzer()
  const ctor: any = inst?.constructor
  if (typeof ctor?.setGrammar === "function") {
    // Same handoff the shared runner performs, so the wrapper's inner analyzer is in
    // the same state the clean run is.
    const { getParser } = await import("../../../script/m14/run-fixtures")
    const parser: any = await getParser("css")
    try {
      ctor.setGrammar((parser as any).language, (parser as any).constructor)
    } catch {
      /* no grammar available: the lane's own ambiguity counters say so */
    }
  }
  return inst
}

const main = async (): Promise<void> => {
  const real = await buildReal()
  const clean = await runLang("css", real)
  console.log(`css mutant run — baseline: clean suite pass ${clean.pass} fail ${clean.fail}`)
  if (clean.fail !== 0) {
    console.log(`>>> REFUSING to score mutants against a red baseline. ${clean.fail} fixture(s) fail with no defect injected,`)
    console.log(`>>> and a mutant that "raises the failure count" from here would prove nothing.`)
    process.exit(1)
  }

  const rows: any[] = []
  let survivors = 0
  let total = 0
  for (const set of SETS) {
    console.log(`--- ${set.label}: ${set.mutants.length} mutant(s)`)
    for (const m of set.mutants as any[]) {
      total++
      const Wrapper: any = wrap(m.transform)
      const mutated = await runLang("css", new Wrapper(real))
      const caught = mutated.fail > clean.fail
      if (!caught) survivors++
      const broken = mutated.details.filter((d: any) => !d.ok).map((d: any) => d.fixture)
      rows.push({
        id: m.id,
        defectClass: m.defectClass,
        cleanFail: clean.fail,
        mutatedPass: mutated.pass,
        mutatedFail: mutated.fail,
        caught,
        fixturesBroken: broken,
      })
      console.log(
        `${caught ? "CAUGHT  " : "SURVIVED"} ${m.id.padEnd(46)} pass ${mutated.pass} fail ${mutated.fail}` +
          (broken.length ? `  (${broken.join(", ")})` : ""),
      )
    }
  }

  console.log("")
  console.log(`mutants ${total}   caught ${total - survivors}   SURVIVED ${survivors}`)
  const jsonArg = process.argv.indexOf("--json")
  if (jsonArg !== -1 && process.argv[jsonArg + 1]) {
    const { writeFileSync } = await import("node:fs")
    writeFileSync(
      process.argv[jsonArg + 1],
      JSON.stringify({ instrument: "css-mutant-run", language: "css", clean: { pass: clean.pass, fail: clean.fail }, mutants: rows, survivors }, null, 2) + "\n",
    )
  }
  if (survivors) {
    console.log(`>>> THIS LANE'S MUTATION GATE FAILS: ${survivors} mutant(s) survived, so the suite is decoration for them.`)
    process.exitCode = 1
  }
}

await main()