// script/m65/verify-migrate-latency.ts — bb_migrate's latency budget and its WORK bound.
//
// THE DEFECT THIS PINS. The planner used to call
// `analyzePolyglotProjectFromDB`, which loads EVERY symbol, relationship and taint
// flow in the project and reconstructs them. Measured 2342 ms for a ONE-symbol
// request on cobra (1216 symbols / 5228 relationships) — flat in request size,
// because the cost was the load and not the request. The loader was replaced with
// resolve → cap → load only the requested symbols' own edges, and that design claim
// has never had a budget attached to it.
//
// WHAT IS MEASURED, on real corpus code rather than a synthetic fixture:
//
//   budgets      wall-clock means over 5 runs for three request shapes. The budgets
//                are set to catch a return of the 2.3-second class, not to police
//                milliseconds on a loaded machine, and the measured values are
//                printed beside them so the headroom is visible.
//   the bound    `cohort.work` — symbolsLoaded / relationshipsLoaded against the
//                project's OWN totals. This is the machine-independent half of the
//                claim: a wall-clock assertion passes on a quiet machine and fails
//                on a busy one, while this one is a reading anywhere. It is also
//                what makes "bounded by the request, not the repository" checkable:
//                two fixtures differing by 7.6x in symbols must not differ by 7.6x
//                in the work a comparable request does.
//   accounting   every name in a 12-name request must come back either planned or
//                refused. A name that vanishes is the exact failure mode the batch
//                used to have.
//   the cap      a directory cohort larger than 100 must return exactly 100 plans
//                and NAME what it dropped in `truncation.cappedNames`.
//   determinism  two identical requests must report identical work and plan counts.
//   can-fail     the budget predicate is applied to the HISTORICAL measurement
//                (2342 ms for one symbol) and must fail it, so a green line below is
//                a reading and not an absence of output.
//
// The corpus is READ, never written; the index this gate builds lives in a temp
// BB_DATA_DIR and is discarded.

import { existsSync, mkdtempSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { resolveCorpusRoot } from "../lib/corpus-root.ts"
import { optionalCorpusMissingMessage } from "../lib/optional-corpus.ts"

// Both set BEFORE the store is imported, so the gate cannot touch the developer's
// own index and cannot trigger an auto-refresh of the corpus.
const TEMP_DATA_DIR = mkdtempSync(path.join(tmpdir(), "m65-migrate-latency-"))
process.env.BB_DATA_DIR = TEMP_DATA_DIR
process.env.BB_NO_AUTO_REFRESH = "1"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const EVIDENCE = path.join(ROOT, "validation/m65/results/migrate-latency.json")

/**
 * Budgets in milliseconds. The comment records ONE run of this gate (2026-10-17) so
 * the headroom is auditable rather than implied; the gate prints the current reading
 * every time, and it moves a few milliseconds between runs, so the comment is an
 * example and the printed line is the measurement:
 *
 *   one symbol    measured 16.3 ms (gql-gqlgen/api) / 29.6 ms (gh-cli/internal)
 *   12 symbols    measured 39.1 ms                    / 193.3 ms
 *   dir cohort    measured 49.7 ms                    / 211.1 ms
 *
 * The historical one-symbol cost was 2342 ms. These budgets are at least 7x the measured
 * values on purpose: what they exist to catch is a return of the load-everything
 * class, and a tight budget on a shared machine would fail for reasons that have
 * nothing to do with the planner.
 */
const BUDGETS = { oneSymbolMs: 500, twelveSymbolsMs: 1500, cohortMs: 3000 } as const

/** The single machine-independent bound: what one request may READ. */
const LIMITS = { oneSymbolRelationships: 1000, oneSymbolSymbols: 100, twelveSymbolsSymbols: 200, cohortSymbols: 100, cohortRelationships: 2000 } as const

/** The request cap, restated here so a change to the engine's cap fails this gate. */
const COMPONENT_CAP = 100

type Check = { name: string; passed: boolean; detail: string; negative?: boolean }
const checks: Check[] = []
const check = (name: string, passed: boolean, detail: string, negative = false): void => {
  checks.push({ name, passed, detail, negative })
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}  ${detail}`)
}

type Fixture = { id: string; sub: string; label: string }

const FIXTURES: Fixture[] = [
  { id: "gql-gqlgen/api", sub: "gql-gqlgen/api", label: "small" },
  { id: "gh-cli/internal", sub: "gh-cli/internal", label: "large" },
]

type ShapeMeasurement = { meanMs: number; minMs: number; plans: number; refused: number; work: { symbolsLoaded: number; relationshipsLoaded: number; projectSymbols: number; projectRelationships: number }; capped: number; cappedNames: string[]; returned: number; requested: number; resolved: number }

async function main(): Promise<void> {
  const corpus = resolveCorpusRoot(process.cwd())
  const repoPresent = !!corpus && FIXTURES.every((f) => existsSync(path.join(corpus, f.sub)))
  check(
    "migrate latency: both corpus fixtures are present",
    repoPresent,
    repoPresent ? `${FIXTURES.map((f) => f.id).join(", ")} under ${corpus}` : optionalCorpusMissingMessage("fixtures corpus", "BB_CORPUS_ROOT"),
  )
  // The block is DECLARED and the verdict still exits on the normal path: an
  // optional corpus that is absent records that fact, it does not pass silently and
  // it does not crash.
  let measurements: Record<string, unknown> = { skipped: "the corpus fixtures are absent on this machine" }
  if (repoPresent && corpus) {
    const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
    const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
    const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
    const { generateMigrationPlans } = await import(path.join(ROOT, "src/intelligence/migration/migration-engine.ts"))

    // The gate's own predicates, named so the checks AND the can-fail controls below
    // exercise the same code rather than two statements of the same rule. Declared
    // before the loop because the loop's checks use them.
    const withinBudget = (meanMs: number, budgetMs: number) => meanMs <= budgetMs
    const accounted = (requested: number, plans: number, refused: number) => plans + refused === requested
    const withinCap = (plans: number) => plans <= COMPONENT_CAP

    const results: Record<string, any> = {}
    for (const fixture of FIXTURES) {
      const dir = path.join(corpus, fixture.sub)
      const projectId = getProjectId(dir)
      await indexProjectParallel(projectId, dir, {})
      const raw = await BrainDatabase.getRawInstance(projectId)
      const totals = raw
        .prepare(
          `SELECT (SELECT COUNT(*) FROM brain_symbol WHERE project_id=?) AS symbols,
                  (SELECT COUNT(*) FROM brain_relationship WHERE project_id=?) AS relationships`,
        )
        .get(projectId, projectId) as { symbols: number; relationships: number }
      check(`migrate latency ${fixture.id}: the fixture indexed non-empty`, totals.symbols > 100 && totals.relationships > 100, JSON.stringify(totals))

      // A symbol with real fan-in, so the measurement is of a plan that cites edges
      // rather than of a refusal over an empty neighbourhood. The first candidate
      // that PRODUCES A PLAN is used, and the choice is recorded: a gate that
      // silently measured the refusal path would pin the wrong number.
      const busy = raw
        .prepare(
          `SELECT s.name AS name, COUNT(r.id) AS edges
           FROM brain_symbol s
           LEFT JOIN brain_relationship r ON r.source_symbol_id = s.id OR r.target_symbol_id = s.id
           WHERE s.project_id = ? AND s.symbol_type IN ('function','method','class','interface','type')
           GROUP BY s.name ORDER BY edges DESC LIMIT 14`,
        )
        .all(projectId) as Array<{ name: string; edges: number }>
      let chosen: { name: string; edges: number; plans: number } | null = null
      for (const candidate of busy) {
        const probe = await generateMigrationPlans(projectId, { symbolNames: [candidate.name], targetLanguage: "python", projectRoot: dir })
        if (probe.plans.length > 0) {
          chosen = { name: candidate.name, edges: candidate.edges, plans: probe.plans.length }
          break
        }
      }
      check(`migrate latency ${fixture.id}: a plannable high-fan-in symbol exists`, !!chosen, chosen ? JSON.stringify(chosen) : "none of the 14 busiest symbols produced a plan")
      if (!chosen) continue

      const names = [...new Set(busy.map((b) => b.name))].slice(0, 12)
      // Distinct names, bounded by what the fixture actually has: the accounting
      // check below is against THIS number, not against a literal 12, so a fixture
      // with eleven plannable names does not fail for having eleven.
      const requestedTwelve = names.length
      const time = async (request: Record<string, unknown>, runs = 5): Promise<ShapeMeasurement> => {
        const samples: number[] = []
        let last: any
        for (let i = 0; i < runs; i++) {
          const started = performance.now()
          last = await generateMigrationPlans(projectId, { ...request, targetLanguage: "python", projectRoot: dir })
          samples.push(performance.now() - started)
        }
        samples.sort((a, b) => a - b)
        return {
          meanMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
          minMs: samples[0],
          plans: last.plans.length,
          refused: last.unsupported.length,
          work: last.cohort.work,
          capped: last.truncation.capped,
          cappedNames: last.truncation.cappedNames,
          returned: last.truncation.returned,
          requested: last.truncation.requested,
          resolved: last.cohort.symbolsResolved,
        }
      }

      const one = await time({ symbolNames: [chosen.name] })
      const twelve = await time({ symbolNames: names })
      const cohort = await time({ paths: ["."], symbolNames: [] })
      // Determinism is asserted on the shape that cites the most evidence.
      const repeat = await time({ symbolNames: names }, 1)

      check(
        `migrate latency ${fixture.id}: one symbol within ${BUDGETS.oneSymbolMs} ms (mean of 5)`,
        one.meanMs <= BUDGETS.oneSymbolMs,
        `mean ${one.meanMs.toFixed(1)} ms (min ${one.minMs.toFixed(1)}), budget ${BUDGETS.oneSymbolMs}`,
      )
      check(
        `migrate latency ${fixture.id}: 12 symbols within ${BUDGETS.twelveSymbolsMs} ms (mean of 5)`,
        twelve.meanMs <= BUDGETS.twelveSymbolsMs,
        `mean ${twelve.meanMs.toFixed(1)} ms (min ${twelve.minMs.toFixed(1)}), budget ${BUDGETS.twelveSymbolsMs}`,
      )
      check(
        `migrate latency ${fixture.id}: a directory cohort within ${BUDGETS.cohortMs} ms (mean of 5)`,
        cohort.meanMs <= BUDGETS.cohortMs,
        `mean ${cohort.meanMs.toFixed(1)} ms (min ${cohort.minMs.toFixed(1)}), budget ${BUDGETS.cohortMs}`,
      )

      // THE BOUND. One request reads one request's worth of graph.
      check(
        `migrate latency ${fixture.id}: one symbol reads <= ${LIMITS.oneSymbolRelationships} relationships`,
        one.work.relationshipsLoaded <= LIMITS.oneSymbolRelationships,
        `loaded ${one.work.relationshipsLoaded} of ${one.work.projectRelationships} (${((one.work.relationshipsLoaded / Math.max(1, one.work.projectRelationships)) * 100).toFixed(1)}%)`,
      )
      check(
        `migrate latency ${fixture.id}: one symbol loads <= ${LIMITS.oneSymbolSymbols} symbols`,
        one.work.symbolsLoaded <= LIMITS.oneSymbolSymbols,
        `loaded ${one.work.symbolsLoaded} of ${one.work.projectSymbols}`,
      )
      check(
        `migrate latency ${fixture.id}: 12 symbols load <= ${LIMITS.twelveSymbolsSymbols} symbols`,
        twelve.work.symbolsLoaded <= LIMITS.twelveSymbolsSymbols,
        `loaded ${twelve.work.symbolsLoaded}`,
      )
      check(
        `migrate latency ${fixture.id}: the cohort reads <= ${LIMITS.cohortRelationships} relationships`,
        cohort.work.relationshipsLoaded <= LIMITS.cohortRelationships,
        `loaded ${cohort.work.relationshipsLoaded} of ${cohort.work.projectRelationships}`,
      )

      // ACCOUNTING: nothing requested may vanish.
      check(
        `migrate latency ${fixture.id}: every one of the ${requestedTwelve} requested names is planned or refused`,
        accounted(requestedTwelve, twelve.plans, twelve.refused),
        `plans ${twelve.plans} + refused ${twelve.refused} of ${requestedTwelve}`,
      )
      // THE CAP, and its report.
      check(
        `migrate latency ${fixture.id}: a cohort never returns more than the ${COMPONENT_CAP}-component cap`,
        cohort.plans <= COMPONENT_CAP,
        `plans ${cohort.plans}, resolved ${cohort.resolved}, capped ${cohort.capped}`,
      )
      if (cohort.resolved > COMPONENT_CAP) {
        check(
          `migrate latency ${fixture.id}: the cap NAMES what it dropped`,
          cohort.capped > 0 && cohort.cappedNames.length === cohort.capped,
          `capped ${cohort.capped}, named ${cohort.cappedNames.length}`,
        )
      }
      check(
        `migrate latency ${fixture.id}: identical requests report identical work`,
        repeat.plans === twelve.plans && repeat.refused === twelve.refused &&
          repeat.work.symbolsLoaded === twelve.work.symbolsLoaded &&
          repeat.work.relationshipsLoaded === twelve.work.relationshipsLoaded,
        `plans ${repeat.plans}/${twelve.plans}, symbols ${repeat.work.symbolsLoaded}/${twelve.work.symbolsLoaded}, relationships ${repeat.work.relationshipsLoaded}/${twelve.work.relationshipsLoaded}`,
      )

      results[fixture.label] = {
        fixture: fixture.id,
        symbols: totals.symbols,
        relationships: totals.relationships,
        chosenSymbol: chosen,
        requestedNames: requestedTwelve,
        budgets: BUDGETS,
        oneSymbol: one,
        twelveSymbols: twelve,
        cohort,
      }
    }

    // THE SCALE CLAIM. Two fixtures that are not actually different sizes would make
    // the bound above meaningless, so the contrast is asserted rather than assumed.
    const small = results.small
    const large = results.large
    if (small && large) {
      check(
        "migrate latency: the two fixtures differ in scale",
        large.symbols >= 2 * small.symbols && large.relationships >= 2 * small.relationships,
        `small ${small.symbols} symbols / ${small.relationships} relationships vs large ${large.symbols} / ${large.relationships}`,
      )
      // Work tracks the REQUEST: a 7.6x project must not load 7.6x the graph for a
      // comparable one-symbol request. The ratio is bounded, not fixed: the chosen
      // symbols have their own fan-in, and this asserts the difference is of a
      // different order than the project-size difference.
      const ratio = large.oneSymbol.work.relationshipsLoaded / Math.max(1, small.oneSymbol.work.relationshipsLoaded)
      const scaleRatio = large.relationships / Math.max(1, small.relationships)
      check(
        "migrate latency: work grows with the request, not with the repository",
        ratio < scaleRatio,
        `loaded-relationship ratio ${ratio.toFixed(2)}x < project-size ratio ${scaleRatio.toFixed(2)}x (per-symbol costs ${small.oneSymbol.meanMs.toFixed(1)} ms vs ${large.oneSymbol.meanMs.toFixed(1)} ms)`,
      )
      // The historical per-symbol cost, in the same units: if a one-symbol request
      // still cost what it did before the bounded loader, this is what it would be.
      check(
        "migrate latency: the budget would fail the historical 2342 ms one-symbol cost",
        !withinBudget(2342, BUDGETS.oneSymbolMs),
        "2342 ms (measured on cobra before the bounded loader) > budget " + BUDGETS.oneSymbolMs + " ms",
        true,
      )
    }
    measurements = results

    // CAN-FAIL, on the gate's own predicates. Without these the green lines above
    // could be reading nothing at all.
    check(
      "migrate latency: the budget predicate passes a measured value [negative control]",
      withinBudget(19.4, BUDGETS.oneSymbolMs) && !withinBudget(2342, BUDGETS.oneSymbolMs),
      "19.4 ms <= 500 ms <= no; 2342 ms > 500 ms",
      true,
    )
    check(
      "migrate latency: the accounting predicate detects a vanished name [negative control]",
      accounted(12, 2, 10) && !accounted(12, 2, 9),
      "12 = 2 + 10 accounts; 12 != 2 + 9 does not",
      true,
    )
    check(
      "migrate latency: the cap predicate detects an over-cap answer [negative control]",
      withinCap(COMPONENT_CAP) && !withinCap(COMPONENT_CAP + 1),
      `100 plans are within the cap; ${COMPONENT_CAP + 1} are not`,
      true,
    )
  }

  const { writeSealed } = await import(path.join(ROOT, "script/lib/evidence.ts"))
  const failed = checks.filter((c) => !c.passed)
  const negativeCases = checks.filter((c) => c.negative).length
  mkdirSync(path.dirname(EVIDENCE), { recursive: true })
  writeSealed(EVIDENCE, {
    issue: "M65.MIGRATE-LATENCY",
    code: "M65",
    tool: "bb_migrate",
    title: "bb_migrate: latency budget and the work bound, measured on corpus code",
    command: "bun run script/m65/verify-migrate-latency.ts",
    status: failed.length === 0 ? "verified" : "known-gap",
    checks: checks.length,
    passed: checks.length - failed.length,
    failed: failed.length,
    negativeCases,
    budgets: BUDGETS,
    limits: LIMITS,
    measurements,
    corpusRoot: corpus ?? null,
    dataDir: TEMP_DATA_DIR,
    before: "a one-symbol request cost 2342 ms on a 1216-symbol repository because the planner loaded the whole project (flat in request size), and no budget existed to catch a return of that class",
    contract: "a request costs its own resolved symbols' edges: one symbol <= 500 ms and <= 1000 relationships, 12 names <= 1500 ms with every name accounted for, a directory cohort <= 3000 ms and never more than the 100-component cap, with the dropped components named",
    note: "wall-clock figures are from this machine; the WORK bound is the machine-independent half and is what the gate asserts more tightly",
  })
  console.log(`\nevidence: ${EVIDENCE}`)
  if (failed.length > 0) {
    console.log(`\n${failed.length} check(s) FAILED.`)
    process.exitCode = 1
  } else {
    console.log("\nAll checks passed — bb_migrate costs its request, not the repository.")
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
