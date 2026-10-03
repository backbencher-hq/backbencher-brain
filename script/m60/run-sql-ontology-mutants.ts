/**
 * RUN the SQL ontology mutants against the SQL fixture lane.
 *
 * WHY THIS EXISTS RATHER THAN A BLOCK IN `script/m14/mutate-analyzer.ts`. That
 * registry is supervisor-owned and shared across lanes that edit it concurrently,
 * so this lane cannot add its eight mutants to it. What it CAN do is prove the
 * claim those mutants exist to support — that the fixture suite goes red when the
 * behaviour is reverted — using the SAME `runLang` the shared harness uses, so
 * the comparison is the harness's own and not a second, weaker runner.
 *
 * It writes NO evidence. `validation/m14/results/*.json` is supervisor-owned, and a
 * lane-authored artifact there would be indistinguishable from a harness-authored
 * one, which is the exact property the honesty contract's §5 forbids.
 *
 * Exit code 2 on a surviving mutant, so it fails the way the shared harness does.
 */
import { runLang } from "../m14/run-fixtures"
import { SQL_ONTOLOGY_MUTANTS } from "./sql-ontology-mutants"
import { RealSqlAnalyzer } from "../../src/ast/real-sql-analyzer"

const LANGS: Record<string, any> = { sql: RealSqlAnalyzer }

async function main() {
  const clean = await runLang("sql")
  console.log(`sql fixture lane, clean: ${clean.pass} pass / ${clean.fail} fail`)
  if (clean.fail > 0) {
    console.error("the lane is already red: a mutant result here would be meaningless")
    process.exit(3)
  }
  const real = new RealSqlAnalyzer()
  let survivors = 0
  for (const m of SQL_ONTOLOGY_MUTANTS) {
    const mutated = await runLang("sql", {
      analyze: async (...args: any[]) => m.transform(await real.analyze(...args as [any, any, any]), typeof args[1] === "string" ? args[1] : undefined),
      transform: m.transform,
    })
    const caught = mutated.fail > clean.fail
    const caughtBy = mutated.details
      .filter((d: any) => !d.ok)
      .map((d: any) => d.fixture)
      .filter((f: string) => !clean.details.some((bd: any) => !bd.ok && bd.fixture === f))
      .join(", ")
    if (!caught) survivors++
    console.log(`${caught ? "CAUGHT" : "SURVIVED"}  ${m.id}  (${clean.fail} -> ${mutated.fail} failures${caughtBy ? "; " + caughtBy : ""})`)
  }
  console.log(`\n${SQL_ONTOLOGY_MUTANTS.length - survivors}/${SQL_ONTOLOGY_MUTANTS.length} caught`)
  if (survivors > 0) {
    console.error(`${survivors} SURVIVING MUTANT(S) — the fixture suite cannot detect these defects`)
    process.exit(2)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})