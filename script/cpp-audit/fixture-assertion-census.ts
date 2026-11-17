/**
 * C++ LANE AUDIT — what the fixture suite can and cannot FAIL on.
 *
 * WHY THIS EXISTS. `docs/m65-cpp/NEXT-WORK.md` §10.3 reported the cpp suite's strength as
 * "873 assertions, 21 exact = 2.4%", and that number was used to rank the fixture suite as the
 * lane's weakest verifier. Re-derived by enumerating every assertion key actually present in the
 * 55 suites, the 21 was `expectRelationshipCount` ONLY — it ignored 38 `expectSymbolCount`
 * (`equals`) and 88 `forbidSymbols`. The ratio measured *relationship* exactness while claiming to
 * measure the *suite's*. Same failure mode as the four wrong resolution numbers in §12/§13: a rate
 * printed without saying what it is a rate OF.
 *
 * WHAT IT COUNTS. Every top-level assertion array in
 * `validation/m14/fixtures/cpp/*.expectation.json`, and for each key, whether an assertion of that
 * kind **can fail on an over-emission** (an extra row or an extra symbol):
 *
 *   expectRelationships     NO   — ">=1 match"; a duplicate or an extra row satisfies it
 *   expectSymbols           NO   — existence only
 *   expectRelationshipCount YES  — `equals`
 *   expectSymbolCount       YES  — `equals`
 *   forbidRelationships     YES  — directed: fails if the NAMED row reappears
 *   forbidSymbols           YES  — directed: fails if the NAMED symbol reappears
 *   everything else         mixed field/range checks, counted but not classified
 *
 * The load-bearing output is the last block: **how many of the relationship assertions could fail
 * on an extra row**. That is the lane's real over-emission coverage, and it is strictly smaller
 * than "the suite", which is what the old 2.4% conflated.
 *
 * This probe reads fixture JSON only. It does not run the analyzer, does not run the fixtures, and
 * makes no claim about whether any fixture's EXPECTED values are correct — only about which
 * assertions exist and what kind of failure each one can detect.
 *
 * Usage: bun run script/cpp-audit/fixture-assertion-census.ts [--json]
 */
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const DIR = "validation/m14/fixtures/cpp"
/** Keys that are fixture METADATA, not assertions. */
const META = new Set(["fixtureId", "language", "authoredBeforeAnalyzerRun", "rationale", "note"])

/** Can an assertion of this kind fail when the analyzer emits an EXTRA row/symbol? */
const OVER_EMISSION: Record<string, "yes" | "no" | "directed" | "other"> = {
  expectRelationships: "no",
  expectSymbols: "no",
  expectRelationshipCount: "yes",
  expectSymbolCount: "yes",
  forbidRelationships: "directed",
  forbidSymbols: "directed",
}

interface Census {
  suites: number
  totalAssertions: number
  byKey: Record<string, number>
  canFailOnExtra: number
  cannot: number
  directedNegative: number
  relationshipAssertions: number
  relationshipAssertionsWithCount: number
  relationshipAssertionsAtLeastOne: number
  symbolAssertions: number
  symbolAssertionsWithCount: number
}

function main(): void {
  const asJson = process.argv.includes("--json")
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith(".expectation.json"))
    .sort()

  const byKey: Record<string, number> = {}
  let totalAssertions = 0
  for (const f of files) {
    const j = JSON.parse(readFileSync(join(DIR, f), "utf8")) as Record<string, unknown>
    for (const [k, v] of Object.entries(j)) {
      if (META.has(k)) continue
      const n = Array.isArray(v) ? v.length : 1
      byKey[k] = (byKey[k] ?? 0) + n
      totalAssertions += n
    }
  }

  const sum = (keys: string[]): number => keys.reduce((n, k) => n + (byKey[k] ?? 0), 0)
  const out: Census = {
    suites: files.length,
    totalAssertions,
    byKey,
    canFailOnExtra: sum(Object.keys(OVER_EMISSION).filter((k) => OVER_EMISSION[k] === "yes")),
    cannot: sum(Object.keys(OVER_EMISSION).filter((k) => OVER_EMISSION[k] === "no")),
    directedNegative: sum(Object.keys(OVER_EMISSION).filter((k) => OVER_EMISSION[k] === "directed")),
    relationshipAssertions: sum(["expectRelationships", "expectRelationshipCount"]),
    relationshipAssertionsWithCount: byKey["expectRelationshipCount"] ?? 0,
    relationshipAssertionsAtLeastOne: byKey["expectRelationships"] ?? 0,
    symbolAssertions: sum(["expectSymbols", "expectSymbolCount"]),
    symbolAssertionsWithCount: byKey["expectSymbolCount"] ?? 0,
  }

  if (asJson) {
    console.log(JSON.stringify(out, null, 2))
    return
  }

  console.log(`=== CPP FIXTURE ASSERTION CENSUS — ${out.suites} suites ===`)
  console.log(`total assertion entries: ${out.totalAssertions}\n`)
  for (const [k, n] of Object.entries(byKey).sort((a, b) => b[1] - a[1])) {
    const kind = OVER_EMISSION[k] ?? "other"
    console.log(`  ${String(n).padStart(5)}  ${k.padEnd(24)} fails-on-extra: ${kind}`)
  }
  console.log("\n=== WHAT THE SUITE CAN ACTUALLY CATCH ===")
  const pct = (a: number, b: number) => `${((100 * a) / b).toFixed(1)}%`
  console.log(`  exact counts that can fail on an extra row/symbol: ${out.canFailOnExtra} of ${out.totalAssertions} (${pct(out.canFailOnExtra, out.totalAssertions)})`)
  console.log(`  directed negatives (fail if a NAMED row/symbol reappears): ${out.directedNegative} of ${out.totalAssertions} (${pct(out.directedNegative, out.totalAssertions)})`)
  console.log(`  "exists / >=1 match" (cannot see an extra row/symbol): ${out.cannot} of ${out.totalAssertions} (${pct(out.cannot, out.totalAssertions)})`)
  console.log("")
  console.log(`  RELATIONSHIP assertions: ${out.relationshipAssertions}`)
  console.log(`    with an exact count:      ${out.relationshipAssertionsWithCount} (${pct(out.relationshipAssertionsWithCount, out.relationshipAssertions)})`)
  console.log(`    ">=1 match" only:         ${out.relationshipAssertionsAtLeastOne} (${pct(out.relationshipAssertionsAtLeastOne, out.relationshipAssertions)})`)
  console.log(`  SYMBOL assertions: ${out.symbolAssertions}`)
  console.log(`    with an exact count:      ${out.symbolAssertionsWithCount} (${pct(out.symbolAssertionsWithCount, out.symbolAssertions)})`)
}

main()
