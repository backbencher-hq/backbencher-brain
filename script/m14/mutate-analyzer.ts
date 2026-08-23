/**
 * M14.0.F4 — Mutation-Testing Harness
 *
 * Proves the verification gates CAN fail. For each mutant (a deliberately
 * defective analyzer), the fixture suite MUST go red. A surviving mutant
 * fails THE SUITE, not the mutant — suites that stay green no matter what
 * are decoration, and decoration is what let M13 claim dishonest things.
 *
 * Mutants wrap the real analyzer and transform its output — a faithful
 * simulation of an analyzer carrying the defect, without fragile source
 * surgery. Every mutant is documented with its defect class.
 *
 * Gate: every mutant must increase its language's failure count above the
 * recorded baseline (validation/m14/fixture-baseline.json). Exit 0 iff all
 * mutants are caught. Also emits evidence via the F2 harness.
 *
 * CLI: bun run script/m14/mutate-analyzer.ts
 */
import * as fs from "fs"
import * as path from "path"
import { runLang, LANGS } from "./run-fixtures"

const ROOT = path.resolve(__dirname, "..", "..")

interface Mutant {
  id: string
  language: string
  defectClass: string
  description: string
  transform: (result: any) => any
}

function normRel(r: any) { return { ...r, type: r.type ?? r.relationshipType } }

const MUTANTS: Mutant[] = [
  {
    id: "java/mislabel-inheritance",
    language: "java",
    defectClass: "relationship-mislabel",
    description: "relabels every extends edge as implements (the exact multi-interface bug class reported by the owner)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map(x => normRel(x).type === "extends" ? { ...x, type: "implements" } : x) }),
  },
  {
    id: "java/drop-method-symbols",
    language: "java",
    defectClass: "symbol-loss",
    description: "drops every method symbol",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => s.kind !== "method") }),
  },
  {
    id: "java/fqn-edge-drop",
    language: "java",
    defectClass: "edge-drop",
    description: "drops edges whose target contains a dot (FQN handling regression)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(normRel(x).target ?? "").includes(".")) }),
  },
  {
    id: "groovy/confidence-tamper",
    language: "groovy",
    defectClass: "confidence-dishonesty",
    description: "sets confidence 1.0 on every relationship (silent heuristic inflation, contract §4 violation)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map(x => ({ ...x, confidence: 1 })) }),
  },
  {
    id: "groovy/segment-garbage",
    language: "groovy",
    defectClass: "relationship-garbage",
    description: "adds a bogus implements edge to package segment 'java' for every class",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), ...(r.symbols ?? []).filter(s => s.kind === "class").map(s => ({ type: "implements", source: s.name, target: "java", confidence: 1, metadata: {} }))] }),
  },
  {
    id: "groovy/drop-class-symbols",
    language: "groovy",
    defectClass: "symbol-loss",
    description: "drops every class symbol",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => s.kind !== "class") }),
  },
]

async function realAnalyzer(lang: string): Promise<any> {
  const cfg = LANGS[lang]
  const mod: any = await import(`../../src/ast/${cfg.analyzerFile}`)
  return new mod[cfg.className]()
}

async function main() {
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, "validation", "m14", "fixture-baseline.json"), "utf8"))
  const mutationLog: { mutant: string; injectedAt: string; caughtBy: string; detail: string }[] = []
  const checks: { id: string; description: string; status: "pass" | "fail"; detail?: string }[] = []
  let survivors = 0

  // cache clean-run results per language once
  const cleanResults = new Map<string, Awaited<ReturnType<typeof runLang>>>()
  async function clean(lang: string) {
    if (!cleanResults.has(lang)) cleanResults.set(lang, await runLang(lang))
    return cleanResults.get(lang)!
  }

  for (const m of MUTANTS) {
    const base = await clean(m.language)
    const real = await realAnalyzer(m.language)
    const mutant = {
      analyze: async (...args: any[]) => m.transform(await real.analyze(...args)),
    }
    const mutated = await runLang(m.language, mutant)
    // Caught = more failing fixtures OR more distinct problems inside
    // already-failing fixtures (a defect landing in broken code is still a defect).
    const baseProblems = base.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
    const mutProblems = mutated.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
    const caught = mutated.fail > base.fail || mutProblems > baseProblems
    const caughtBy = mutated.details.filter(d => !d.ok).map((d: any) => d.fixture)
      .filter(f => !base.details.some((bd: any) => !bd.ok && bd.fixture === f))
      .join(", ")
    console.log(`${caught ? "CAUGHT" : "SURVIVED"}  ${m.id}  (${base.fail} -> ${mutated.fail} failures${caughtBy ? "; new failures: " + caughtBy : ""})`)
    checks.push({ id: `mutation-${m.id.replace("/", "-")}`, description: m.description, status: caught ? "pass" : "fail", detail: `${base.fail} -> ${mutated.fail}` })
    mutationLog.push({ mutant: m.id, injectedAt: new Date().toISOString(), caughtBy: caughtBy || "(none)", detail: `${m.defectClass}: ${base.fail} -> ${mutated.fail} fixture failures` })
    if (!caught) survivors++
  }

  const { emitEvidence } = await import("./evidence-harness")
  emitEvidence({
    issueId: "M14.0.F4",
    title: "Mutation-testing harness",
    claimLevel: "L1",
    layers: ["fixtures", "mutation"],
    checks,
    limitations: [
      { description: "mutants wrap analyzer output rather than rewriting analyzer source; equivalent at the suite level but not a compiler-level injection" },
      { description: "mutation coverage currently spans java + groovy (the wave languages); other languages add mutants when their waves start" },
    ],
    mutationLog,
    data: { summary: { mutantsRun: MUTANTS.length, caught: MUTANTS.length - survivors, survived: survivors } },
  })

  if (survivors > 0) {
    console.error(`\n${survivors} SURVIVING MUTANT(S) - the suite cannot detect real defects. Fix the suite before trusting any green.`)
    process.exit(2)
  }
  console.log(`\nall ${MUTANTS.length} mutants caught - the gates can fail`)
}

main().catch(e => { console.error(e); process.exit(1) })
