// script/m65/verify-migrate-selectors.ts — every selector bb_migrate documents, run.
//
// THE DEFECT THIS PINS. `bb_migrate` documents four ways to name a component —
// `symbolName`, `symbolNames`, `symbolIds`, `paths` — and three properties of how
// they combine: they UNION, a component named twice is planned once, and an id no
// symbol carries is a refusal rather than an empty success. The ambiguity refusal
// goes further and TELLS the caller to pass `symbolIds`.
//
// Not one of those was exercised by any gate. Grep across the migrate suites for
// `symbolIds` returned nothing, so the selector existed in the registry, in the
// handler and in the docs, and no test ever called it. That is the same shape as
// the inverted dictionary and the vacuous dictionary audit found earlier in this
// lane: a capability described in prose with no execution behind it, where the
// prose stays true right up until someone uses it.
//
// WHAT IS ASSERTED, on corpus code through the PRODUCTION engine and the real
// MCP handler (not a re-implementation):
//
//   identity      a name and an id name the same component; the plan's own
//                 `symbolId` is the identity compared, not the display name.
//   union         name + id, and name + the path that contains it, plan ONCE.
//   refusal       an unknown id produces a `missing-symbol` refusal that names
//                 the id — not zero plans and no complaint.
//   accounting    a mixed request (one good id, one unknown) reports both.
//   advice        the ambiguous-symbol refusal's candidate ids are actually
//                 accepted as input. This is the check that separates an
//                 actionable message from a polite one.
//   handler       `symbolName` (the legacy singular alias) plans the same
//                 component as `symbolNames`; an unknown id is an ERROR result;
//                 an absolute path inside the project equals its relative form;
//                 a path outside the project is REFUSED by name.
//
// Every predicate is exercised against a failing input as well, so a green line
// is a reading rather than an absence of output.
//
// The corpus is READ, never written; the index lives in a temp BB_DATA_DIR.

import { existsSync, mkdtempSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { resolveCorpusRoot } from "../lib/corpus-root.ts"
import { optionalCorpusMissingMessage } from "../lib/optional-corpus.ts"

const TEMP_DATA_DIR = mkdtempSync(path.join(tmpdir(), "m65-migrate-selectors-"))
process.env.BB_DATA_DIR = TEMP_DATA_DIR
process.env.BB_NO_AUTO_REFRESH = "1"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const EVIDENCE = path.join(ROOT, "validation/m65/results/migrate-selectors.json")
const FIXTURE = { id: "gql-gqlgen/api", sub: "gql-gqlgen/api" }
const TARGET = "python"

type Check = { name: string; passed: boolean; detail: string; negative?: boolean }
const checks: Check[] = []
const check = (name: string, passed: boolean, detail: string, negative = false): void => {
  checks.push({ name, passed, detail, negative })
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}  ${detail}`)
}

async function main(): Promise<void> {
  const corpus = resolveCorpusRoot(process.cwd())
  const dir = corpus ? path.join(corpus, FIXTURE.sub) : null
  const present = !!dir && existsSync(dir)
  check(
    "migrate selectors: the corpus fixture is present",
    present,
    present ? `${FIXTURE.id} under ${corpus}` : optionalCorpusMissingMessage("fixtures corpus", "BB_CORPUS_ROOT"),
  )

  let measurements: Record<string, unknown> = { skipped: "the corpus fixture is absent on this machine" }
  if (present && dir && corpus) {
    const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
    const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
    const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
    const { generateMigrationPlans } = await import(path.join(ROOT, "src/intelligence/migration/migration-engine.ts"))
    const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers.ts"))

    const projectId = getProjectId(dir)
    await indexProjectParallel(projectId, dir, {})
    const raw = await BrainDatabase.getRawInstance(projectId)
    const totals = raw
      .prepare(
        `SELECT (SELECT COUNT(*) FROM brain_symbol WHERE project_id=?) AS symbols,
                (SELECT COUNT(*) FROM brain_relationship WHERE project_id=?) AS relationships`,
      )
      .get(projectId, projectId) as { symbols: number; relationships: number }
    check("migrate selectors: the fixture indexed non-empty", totals.symbols > 100 && totals.relationships > 100, JSON.stringify(totals))

    // The predicates, named so the checks and the can-fail controls below run the
    // SAME rule instead of two statements of it.
    const sameComponent = (a: { symbolId?: string } | undefined, b: { symbolId?: string } | undefined): boolean =>
      !!a && !!b && typeof a.symbolId === "string" && a.symbolId.length > 0 && a.symbolId === b.symbolId
    const plannedOnce = (plans: any[], id: string): boolean => plans.filter((p) => p.symbolId === id).length === 1

    // A plannable symbol with real fan-in, so the identity comparison is made on a
    // plan that cites edges rather than on a refusal over an empty neighbourhood.
    const candidates = raw
      .prepare(
        `SELECT s.id AS id, s.name AS name, f.relative_path AS file
         FROM brain_symbol s
         JOIN brain_file f ON f.id = s.file_id
         WHERE s.project_id = ? AND f.language = 'go'
           AND s.symbol_type IN ('function','method','class','interface','type')
         ORDER BY (SELECT COUNT(*) FROM brain_relationship r
                   WHERE r.source_symbol_id = s.id OR r.target_symbol_id = s.id) DESC,
                  s.id
         LIMIT 40`,
      )
      .all(projectId) as Array<{ id: string; name: string; file: string }>

    let chosen: { id: string; name: string; file: string } | null = null
    let baseline: any = null
    for (const candidate of candidates) {
      const probe = await generateMigrationPlans(projectId, { symbolNames: [candidate.name], targetLanguage: TARGET, projectRoot: dir })
      const plan = probe.plans.find((p: any) => p.symbolId === candidate.id)
      if (plan) {
        chosen = candidate
        baseline = plan
        break
      }
    }
    check(
      "migrate selectors: a plannable symbol exists to select by",
      !!chosen && !!baseline,
      chosen ? `${chosen.name} in ${chosen.file} -> ${baseline.symbolId}` : "none of the 40 busiest Go symbols produced a plan",
    )

    if (chosen && baseline) {
      // ---- symbolIds -------------------------------------------------------
      // The selector the ambiguity refusal points at. If this stopped working the
      // refusal's advice would name a capability that does not exist again.
      const byId = await generateMigrationPlans(projectId, { symbolNames: [], symbolIds: [chosen.id], targetLanguage: TARGET, projectRoot: dir })
      check(
        "migrate selectors: symbolIds alone plans the same component the name does",
        byId.plans.length === 1 && sameComponent(byId.plans[0], baseline) && byId.unsupported.length === 0,
        `symbolIds -> ${byId.plans.length} plan(s), id ${byId.plans[0]?.symbolId ?? "none"}, refused ${byId.unsupported.length}; name -> ${baseline.symbolId}`,
      )

      // ---- the union, and de-duplication ----------------------------------
      // Both docs claims: ids union with names, and a component named twice is
      // planned once. One plan AND no refusal is the only reading that satisfies
      // both — two plans means the union does not de-duplicate, zero means it
      // does not union.
      const nameAndId = await generateMigrationPlans(projectId, { symbolNames: [chosen.name], symbolIds: [chosen.id], targetLanguage: TARGET, projectRoot: dir })
      check(
        "migrate selectors: a name and its own id plan once, and neither is refused",
        plannedOnce(nameAndId.plans, chosen.id) && nameAndId.unsupported.length === 0,
        `plans ${nameAndId.plans.length} (${nameAndId.plans.filter((p: any) => p.symbolId === chosen!.id).length} for the component), refused ${nameAndId.unsupported.length}`,
      )

      const nameAndPath = await generateMigrationPlans(projectId, { symbolNames: [chosen.name], paths: [chosen.file], targetLanguage: TARGET, projectRoot: dir })
      check(
        "migrate selectors: a name and the path that contains it plan once",
        plannedOnce(nameAndPath.plans, chosen.id),
        `paths:[${chosen.file}] + name -> ${nameAndPath.plans.length} plan(s), ${nameAndPath.plans.filter((p: any) => p.symbolId === chosen!.id).length} for the component`,
      )

      // ---- an id nobody carries is a refusal ------------------------------
      const UNKNOWN_ID = "0000000000000000000000000000000000000000:no/such/file.go:missing:1"
      const unknown = await generateMigrationPlans(projectId, { symbolNames: [], symbolIds: [UNKNOWN_ID], targetLanguage: TARGET, projectRoot: dir })
      check(
        "migrate selectors: an unknown id is refused, named, and produces no plan",
        unknown.plans.length === 0 &&
          unknown.unsupported.length === 1 &&
          unknown.unsupported[0].unsupportedReason === "missing-symbol" &&
          String(unknown.unsupported[0].reason).includes(UNKNOWN_ID),
        `${unknown.plans.length} plan(s), ${unknown.unsupported.length} refusal(s): ${unknown.unsupported[0]?.unsupportedReason ?? "none"}`,
      )

      const mixed = await generateMigrationPlans(projectId, { symbolNames: [], symbolIds: [chosen.id, UNKNOWN_ID], targetLanguage: TARGET, projectRoot: dir })
      check(
        "migrate selectors: a mixed request plans the good id and reports the bad one",
        plannedOnce(mixed.plans, chosen.id) && mixed.unsupported.length === 1 && mixed.plans.length + mixed.unsupported.length === 2,
        `plans ${mixed.plans.length} + refusals ${mixed.unsupported.length} of 2 requested`,
      )

      // ---- the ambiguity advice is actionable -----------------------------
      // This is the one that cannot be satisfied by prose. The refusal names
      // candidate ids; if those ids do not resolve, the advice is a dead end.
      const duplicates = raw
        .prepare(
          `SELECT s.name AS name
           FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
           WHERE s.project_id = ? AND f.language = 'go'
           GROUP BY lower(s.name) HAVING COUNT(DISTINCT s.file_id) > 1
           ORDER BY COUNT(*) DESC, lower(s.name)
           LIMIT 40`,
        )
        .all(projectId) as Array<{ name: string }>
      let ambiguity: { name: string; candidates: Array<{ id: string }>; plannedByCandidate: string | null } | null = null
      for (const duplicate of duplicates) {
        const refusal = await generateMigrationPlans(projectId, { symbolNames: [duplicate.name], targetLanguage: TARGET, projectRoot: dir })
        const entry = refusal.unsupported.find((u: any) => u.unsupportedReason === "ambiguous-symbol")
        if (!entry || !Array.isArray(entry.candidates) || entry.candidates.length < 2) continue
        let plannedByCandidate: string | null = null
        for (const candidate of entry.candidates) {
          const byCandidate = await generateMigrationPlans(projectId, { symbolNames: [], symbolIds: [String(candidate.id)], targetLanguage: TARGET, projectRoot: dir })
          if (byCandidate.plans.some((p: any) => p.symbolId === candidate.id)) {
            plannedByCandidate = String(candidate.id)
            break
          }
        }
        ambiguity = { name: duplicate.name, candidates: entry.candidates, plannedByCandidate }
        break
      }
      check(
        "migrate selectors: an ambiguous name refuses with candidate ids that actually resolve",
        !!ambiguity && !!ambiguity.plannedByCandidate,
        ambiguity
          ? `"${ambiguity.name}" -> ${ambiguity.candidates.length} candidate(s); first resolvable id ${ambiguity.plannedByCandidate ?? "NONE"}`
          : "no cross-file duplicate Go name produced an ambiguous-symbol refusal in this fixture",
      )

      // ---- the handler, not the engine ------------------------------------
      // The engine tests above cannot see the handler's own translation: the
      // singular alias, the absolute-path normalization, and the error result an
      // unknown id produces are all handler behaviour.
      const handlers = createToolHandlers()
      const context = { projectId, projectPath: dir }
      const callJson = async (args: Record<string, any>): Promise<{ isError: boolean; text: string; body: any }> => {
        const result = await handlers.bb_migrate({ ...args, targetLanguage: TARGET, format: "json" }, context)
        const text = result.content.map((part: any) => part.text).join("\n")
        let body: any = null
        if (!result.isError) {
          try { body = JSON.parse(text) } catch { body = null }
        }
        return { isError: result.isError === true, text, body }
      }

      const singular = await callJson({ symbolName: chosen.name })
      check(
        "migrate selectors: the legacy symbolName alias plans the same component",
        !singular.isError && !!singular.body && singular.body.plans.some((p: any) => p.symbolId === chosen!.id),
        singular.isError ? `error: ${singular.text.slice(0, 160)}` : `plans ${singular.body.plans.length}, component ${singular.body.plans.some((p: any) => p.symbolId === chosen!.id) ? "present" : "ABSENT"}`,
      )

      const unknownViaHandler = await callJson({ symbolIds: [UNKNOWN_ID] })
      check(
        "migrate selectors: the handler turns an unknown id into an error result",
        unknownViaHandler.isError && unknownViaHandler.text.includes(UNKNOWN_ID),
        unknownViaHandler.isError ? `isError, message names the id` : `NOT an error: ${unknownViaHandler.text.slice(0, 160)}`,
      )

      const relativePath = await callJson({ paths: [chosen.file] })
      const absolutePath = await callJson({ paths: [path.join(dir, chosen.file)] })
      const idsOf = (body: any): string[] => (body?.plans ?? []).map((p: any) => String(p.symbolId)).sort()
      check(
        "migrate selectors: an absolute path inside the project equals its relative spelling",
        !relativePath.isError && !absolutePath.isError &&
          JSON.stringify(idsOf(relativePath.body)) === JSON.stringify(idsOf(absolutePath.body)) &&
          idsOf(relativePath.body).includes(chosen.id),
        `${relativePath.isError || absolutePath.isError ? "an error occurred" : `${idsOf(relativePath.body).length} plan(s) each, identical: ${JSON.stringify(idsOf(relativePath.body)) === JSON.stringify(idsOf(absolutePath.body))}`}`,
      )

      const outside = await callJson({ paths: ["../.."] })
      check(
        "migrate selectors: a path outside the project is refused by name",
        outside.isError && outside.text.includes("../.."),
        outside.isError ? `isError, message names the path` : `NOT an error: ${outside.text.slice(0, 160)}`,
      )

      // ---- can-fail controls ----------------------------------------------
      check(
        "migrate selectors: the identity predicate rejects a different component [negative control]",
        sameComponent(baseline, { symbolId: baseline.symbolId }) && !sameComponent(baseline, { symbolId: `${baseline.symbolId}:other` }) && !sameComponent(baseline, { symbolId: "" }),
        "same id matches; a suffixed id and an empty id do not",
        true,
      )
      check(
        "migrate selectors: the de-duplication predicate detects a doubled plan [negative control]",
        plannedOnce([{ symbolId: "a" }], "a") && !plannedOnce([{ symbolId: "a" }, { symbolId: "a" }], "a") && !plannedOnce([], "a"),
        "one plan passes; two plans and zero plans fail",
        true,
      )

      measurements = {
        fixture: FIXTURE.id,
        totals,
        chosen,
        baselineSymbolId: baseline.symbolId,
        unknownRefusal: unknown.unsupported[0] ?? null,
        ambiguity: ambiguity ? { name: ambiguity.name, candidates: ambiguity.candidates.length, plannedByCandidate: ambiguity.plannedByCandidate } : null,
        handler: {
          singularPlans: singular.isError ? null : singular.body.plans.length,
          unknownIsError: unknownViaHandler.isError,
          absoluteEqualsRelative: !relativePath.isError && !absolutePath.isError && JSON.stringify(idsOf(relativePath.body)) === JSON.stringify(idsOf(absolutePath.body)),
          outsideRefused: outside.isError,
        },
      }
    }
  }

  const { writeSealed } = await import(path.join(ROOT, "script/lib/evidence.ts"))
  const failed = checks.filter((c) => !c.passed)
  const negativeCases = checks.filter((c) => c.negative).length
  mkdirSync(path.dirname(EVIDENCE), { recursive: true })
  writeSealed(EVIDENCE, {
    issue: "M65.MIGRATE-SELECTORS",
    code: "M65",
    tool: "bb_migrate",
    title: "bb_migrate: every documented selector, and the combination rules, executed end to end",
    command: "bun run script/m65/verify-migrate-selectors.ts",
    status: failed.length === 0 ? "verified" : "known-gap",
    checks: checks.length,
    passed: checks.length - failed.length,
    failed: failed.length,
    negativeCases,
    measurements,
    corpusRoot: corpus ?? null,
    dataDir: TEMP_DATA_DIR,
    before: "symbolIds was documented, registered, implemented and pointed at by the ambiguity refusal, and no gate ever called it; the union/de-duplication rules and the unknown-id refusal were prose only",
    contract: "symbolName, symbolNames, symbolIds and paths each name components; the selectors union and de-duplicate by symbol id; an unknown id is a named refusal (an error at the handler); an ambiguous refusal's candidate ids resolve; an absolute path inside the project equals its relative spelling and a path outside it is refused",
    note: "asserted through the production engine and the real MCP handler on corpus code; the index is built in a temp BB_DATA_DIR and discarded",
  })
  console.log(`\nevidence: ${EVIDENCE}`)
  if (failed.length > 0) {
    console.log(`\n${failed.length} check(s) FAILED.`)
    process.exitCode = 1
  } else {
    console.log("\nAll checks passed — every documented selector does what the docs say it does.")
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
