// script/m14/tmp/mutant-catch-reasons.ts
//
// Why a mutant was caught is the difference between a gate and decoration. The
// F4 harness reports `CAUGHT  <id>  (0 -> 1 failures; new failures: <fixture>)`,
// which says WHICH fixture fired but not WHICH expectation — so a mutant can be
// "caught" by an expectation that has nothing to do with its defect class.
//
// This probe runs each mutant of one lane and prints the failing fixture's
// problems verbatim, so the reason is read rather than assumed.
//
// Run: bun script/m14/tmp/mutant-catch-reasons.ts <lang> [mutantIdPrefix]
import { runLang } from "../run-fixtures"
import { MUTANTS } from "../mutate-analyzer"

const lang = process.argv[2]
if (!lang) {
  console.error("usage: bun script/m14/tmp/mutant-catch-reasons.ts <lang> [prefix]")
  process.exit(2)
}
const prefix = process.argv[3] ?? `${lang}/`
const selected = MUTANTS.filter((m) => m.language === lang && m.id.startsWith(prefix))
if (selected.length === 0) {
  console.error(`no mutants for lang=${lang} prefix=${prefix}`)
  process.exit(2)
}

const cfgMod: any = await import("../differential")
const cfg = cfgMod.LANGS[lang]
const mod: any = await import(`../../../src/ast/${cfg.analyzerFile}`)
const real = new mod[cfg.className]()

const base = await runLang(lang)
const baseProblems = base.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
console.log(`${lang}: base fail=${base.fail} problems=${baseProblems} fixtures=${base.details.length}\n`)

for (const m of selected) {
  const mutant = {
    analyze: async (...args: any[]) => m.transform(await real.analyze(...args), typeof args[1] === "string" ? args[1] : undefined),
    transform: m.transform,
  }
  const res = await runLang(lang, mutant)
  const mutations = res.details.filter((d: any) => !d.ok)
  const caught = res.fail > base.fail || res.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0) > baseProblems
  console.log(`${caught ? "CAUGHT " : "SURVIVED"} ${m.id}  [${m.defectClass}]`)
  for (const d of mutations) {
    for (const p of d.problems ?? []) console.log(`    ${d.fixture}: ${p.slice(0, 200)}`)
  }
  if (caught && mutations.length === 0) {
    const extra = res.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0) - baseProblems
    console.log(`    (already-failing fixture gained ${extra} problem(s) — no NEW failing fixture)`)
  }
  console.log()
}
