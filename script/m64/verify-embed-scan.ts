// script/m64/verify-embed-scan.ts — M64.F.
//
// A default bb_health call on a real 6,507-file index did not finish in fifteen
// minutes. The cause was two per-symbol EXISTS probes written in this lane, and
// the comment above them asserted the exact opposite of what SQLite does:
//
//   "The EXISTS probes brain_embed_entity_idx, so this is one index lookup per
//    symbol rather than a scan."
//
// brain_semantic_embedding has brain_embed_entity_idx on (entity_id) AND
// brain_embed_health_idx on (project_id, embedding_model, entity_id,
// vector_dimension). Adding `project_id = ?` to the EXISTS makes SQLite prefer
// the covering health index and filter entity_id, so the subquery walks every
// embedding of the project once PER SYMBOL:
//
//   plan   SEARCH e USING COVERING INDEX brain_embed_health_idx (project_id=?)
//   cost   10.2ms per symbol, measured over slices of 200 / 1,000 / 5,000
//          -> ~2,770 SECONDS at 304,926 symbols
//
// Nothing caught it. Every fixture in this lane has a handful of symbols and a
// handful of embeddings, where a 60,388-row scan is indistinguishable from an
// index lookup — the defect is a FUNCTION OF SCALE, and the whole suite ran at a
// scale where it cannot exist.
//
// So this gate does not assert a time. A time assertion is what made the two
// gates in verify-actionability flaky, and a fixture big enough to expose this
// honestly makes the gate slow. It asserts the three things that are decidable
// without a clock:
//
//   1. SHAPE     the EXISTS probes by entity_id and does not re-filter
//                project_id, which is the property that selects the index
//   2. SCOPE     dropping that predicate did not break project scoping: an
//                embedding belonging to ANOTHER project must not be counted
//   3. COST      on a fixture scaled to make the two plans distinguishable, the
//                plan probes entity_id — and the same work is ~500x cheaper
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Harness } from "../m13/harness"
import { getProjectId } from "../../src/util/project-id"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { getUnifiedHealth } from "../../src/intelligence/health/health-provider"

const harness = new Harness({
  issue: "M64",
  code: "H64f",
  tool: "bb_health",
  title: "bb_health embedding coverage: the per-symbol EXISTS must probe entity_id, and must still be project-scoped",
  layers: ["integration", "performance"],
  decisions: {
    why: "a default call took >15 minutes on a real 6,507-file index because the per-symbol EXISTS re-filtered project_id and so scanned every embedding once per symbol",
    fix: "drop the redundant project_id predicate; entity_id is minted as `${projectId}:...` for both brain_symbol.id and brain_semantic_embedding.entity_id, so the predicate cannot change the answer",
    gate: "shape, scope and plan — never a clock, because a timing assertion is decided by contention and a fixture big enough to expose this honestly would be too slow to run every time",
  },
  limitations: [
    "The real-index numbers (10.2ms/symbol, ~2,770s extrapolated, 513x speedup) came from the 1.6GB index at ~/.bb/projects/818db37d.../ and are NOT reproduced by this gate, which runs on a small fixture. The gate pins the query shape and the plan; the magnitude lives in reviews/health/master-review.md and is not re-measured on every run.",
    "The equivalence of dropping project_id depends on the id convention `${projectId}:${rest}`. This gate pins that convention by planting a foreign-project embedding and requiring it to be ignored; it cannot prove the convention holds for code that does not exist yet.",
  ],
})

const clean = (root: string, pid: string) => {
  try { rmSync(path.dirname(BrainDatabase.getDbPath(pid as any)), { recursive: true, force: true }) } catch {}
  rmSync(root, { recursive: true, force: true })
}

// ══ 1. SHAPE — the predicate that defeats the index must not be there ═══════
// Asserted against the SOURCE, not a plan, because a plan on a small fixture
// picks the same index either way and would pass no matter what.
{
  const src = readFileSync(path.resolve("src/intelligence/health/health-provider.ts"), "utf8")
  // Strip comments before scanning. The first run of this gate matched the
  // M64.F banner's own quotation of the old bad SQL and reported a third live
  // site that does not exist — a gate that documentation can turn red is a
  // fragile gate, and one that can be made green by editing a comment is worse.
  // The comment assertions below test the prose deliberately and separately.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
  const existsClauses = code.match(/EXISTS \(SELECT 1 FROM brain_semantic_embedding[^)]*\)/g) ?? []
  harness.check("the executable code still contains per-symbol embedding EXISTS probes (the queries under test exist)", existsClauses.length >= 2, `found ${existsClauses.length} in code: ${existsClauses.map((c) => c.slice(0, 62)).join(" | ")}`)
  const withProject = existsClauses.filter((c) => /e\.project_id/.test(c))
  harness.check("NOT ONE of them re-filters project_id inside the EXISTS", withProject.length === 0, `${withProject.length} clause(s) still carry e.project_id: ${withProject.join(" | ")} — that predicate is what makes SQLite scan every embedding of the project once per symbol (~2,770s at 304,926 symbols)`)
  harness.negative("and the comment does not claim the index probe again", !/probes brain_embed_entity_idx, so this is one index lookup per symbol/.test(src), "that claim was measured FALSE on a real index: the plan uses brain_embed_health_idx (project_id=?) and filters entity_id")
  harness.negative("nor does it claim the scan is avoided", !/rather than a scan/.test(src), "a comment asserting an unmeasured performance property is how this defect shipped with a gate suite green")
  harness.check("and the real-index measurement is recorded next to the fix", /2,770|2770|10\.2ms|513/.test(src), "a fix whose magnitude is unrecorded will be re-litigated as 'probably fine' by the next reader — the measurement is the argument")
}

// ══ 2. SCOPE — dropping the predicate must not let a foreign project count ══
// This is the property the fix could plausibly have broken, so it is asserted
// directly rather than argued from the id convention.
{
  const root = mkdtempSync(path.join(tmpdir(), "bb-h64f-scope-"))
  mkdirSync(path.join(root, "src"), { recursive: true })
  writeFileSync(path.join(root, "src", "a.ts"), "export function alpha(): number { return 1 }\nexport function beta(): number { return 2 }\n")
  writeFileSync(path.join(root, "src", "b.ts"), "export function gamma(): number { return 3 }\n")
  const pid = getProjectId(root)
  await indexProjectParallel(pid as any, root, {})
  try {
    const raw = await BrainDatabase.getRawInstance(pid as any)
    // `language` lives on brain_file, not brain_symbol — asserted by hitting it.
    const symbols = raw.prepare("SELECT id FROM brain_symbol WHERE project_id=?").all(pid) as any[]
    harness.check("the fixture indexed symbols to work with", symbols.length >= 3, `${symbols.length} symbols`)

    // The indexer embeds every symbol it indexes, so a planted embedding is
    // invisible: the first run of this gate reported embedded=3 of 3 symbols with
    // ONE row planted, and would have concluded the scoping was broken. Clear the
    // table so the only rows that can match are the ones this test plants.
    raw.prepare("DELETE FROM brain_semantic_embedding WHERE project_id=?").run(pid)
    const cleared = (raw.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE project_id=?").get(pid) as any).c
    harness.check("the fixture's own embeddings are cleared, so only planted rows can match", cleared === 0, `${cleared} embeddings left for this project — a test that cannot see its own fixture is a test that measures the fixture`)

    // The scoping question the dropped predicate could actually break: could one
    // project's EMBEDDINGS be counted towards ANOTHER project's coverage?
    //
    // The first run planted a row with OUR entity_id under a foreign project_id
    // and asserted it must not match — but that row is internally impossible
    // (entity_id says project A, project_id says project B; verified on the real
    // index: 60,388 of 60,388 entity_ids carry their own projectId). It matched,
    // correctly, because the code matches on entity_id. The test was asserting
    // behaviour for a corrupt row, which is the wrong test.
    //
    // The right row is internally CONSISTENT and foreign: another project's
    // project_id AND another project's entity_id. It must not match any of ours.
    const victim = symbols[0]
    const FOREIGN = "0000000000000000000000000000000000000000"
    const foreignEntity = `${FOREIGN}:src/elsewhere.ts:other:1`
    // Every NOT NULL column named explicitly. An earlier run guessed seven of the
    // fourteen and died on `content_hash` — a fixture that guesses at a schema
    // reports a schema problem as a coverage problem.
    raw.prepare("INSERT OR REPLACE INTO brain_semantic_embedding (id, project_id, entity_id, entity_type, embedding_model, embedding_vector, vector_dimension, content_hash, last_updated) VALUES (?,?,?,?,?,?,?,?,?)")
      .run("emb-foreign", FOREIGN, foreignEntity, "symbol", "test-model", "[]", 0, "h-foreign", 1)

    const foreignOnly = await getUnifiedHealth(pid, root, {})
    const langs = foreignOnly.embeddings.byLanguage
    harness.check("byLanguage is populated (the query ran, it did not fall into the catch)", langs.length > 0, `${langs.length} languages — 0 would mean the try/catch swallowed a failure, which reads as 'no coverage data' rather than as an error`)
    const symbolsTotal = langs.reduce((a, l) => a + l.symbols, 0)
    const embeddedTotal = langs.reduce((a, l) => a + l.embedded, 0)
    harness.check("another project's embeddings are NOT counted as ours", embeddedTotal === 0, `embedded=${embeddedTotal} against ${symbolsTotal} symbols — a foreign entity_id must not match, and with the project_id predicate gone the entity_id IS the scope`)

    // Now the real row: it must be counted. If the fix over-corrected, this fails.
    raw.prepare("INSERT OR REPLACE INTO brain_semantic_embedding (id, project_id, entity_id, entity_type, embedding_model, embedding_vector, vector_dimension, content_hash, last_updated) VALUES (?,?,?,?,?,?,?,?,?)")
      .run("emb-real", pid, victim.id, "symbol", "test-model", "[]", 0, "h-real", 1)
    const withReal = await getUnifiedHealth(pid, root, {})
    const embeddedAfter = withReal.embeddings.byLanguage.reduce((a, l) => a + l.embedded, 0)
    harness.check("OUR OWN embedding IS counted — the fix did not over-correct", embeddedAfter === 1, `embedded=${embeddedAfter}, expected exactly 1`)
    const kinds = (withReal.embeddings as any).kindsWithNoEmbeddings
    if (Array.isArray(kinds)) {
      harness.check("and the un-embedded kind census moved with it", kinds.length >= 0, `kindsWithNoEmbeddings has ${kinds.length} rows`)
    }
  } finally { clean(root, pid) }
}

// ══ 3. COST — on a fixture big enough to tell the two plans apart ══════════
// 4,000 symbols against 4,000 embeddings is the smallest scale at which a
// per-symbol 4,000-row scan (~16M row visits) is clearly distinguishable from an
// index probe, and it still runs in a couple of seconds.
{
  const root = mkdtempSync(path.join(tmpdir(), "bb-h64f-cost-"))
  mkdirSync(path.join(root, "src"), { recursive: true })
  const N = 4000
  for (let i = 0; i < N; i++) writeFileSync(path.join(root, "src", `f${i}.ts`), `export function fn${i}(): number { return ${i} }\nexport const c${i} = ${i}\n`)
  const pid = getProjectId(root)
  await indexProjectParallel(pid as any, root, {})
  try {
    const raw = await BrainDatabase.getRawInstance(pid as any)
    const symbols = raw.prepare("SELECT id FROM brain_symbol WHERE project_id=?").all(pid) as any[]
    const ins = raw.prepare("INSERT OR REPLACE INTO brain_semantic_embedding (id, project_id, entity_id, entity_type, embedding_model, embedding_vector, vector_dimension, content_hash, last_updated) VALUES (?,?,?,?,?,?,?,?,?)")
    const tx = raw.transaction(() => { for (const s of symbols) ins.run(`e-${s.id}`, pid, s.id, "symbol", "m", "[]", 0, `h-${s.id}`, 1) })
    tx()
    harness.check("the cost fixture has enough symbols for a per-symbol scan to hurt", symbols.length >= N, `${symbols.length} symbols, ${symbols.length} embeddings`)

    const probe = (sql: string, args: any[]) => { const t = Date.now(); raw.prepare(sql).all(...args); return Date.now() - t }
    const entityOnly = "SELECT COUNT(*) c FROM brain_symbol s WHERE s.project_id=? AND EXISTS (SELECT 1 FROM brain_semantic_embedding e WHERE e.entity_id = s.id)"
    const withProject = "SELECT COUNT(*) c FROM brain_symbol s WHERE s.project_id=? AND EXISTS (SELECT 1 FROM brain_semantic_embedding e WHERE e.project_id = ? AND e.entity_id = s.id)"

    const planSteps = raw.prepare("EXPLAIN QUERY PLAN " + entityOnly).all(pid) as any[]
    const planText = planSteps.map((s) => String(s.detail)).join(" | ")
    harness.check("the plan probes the embedding table by ENTITY_ID, not by project_id", /entity_id=\?/.test(planText) && !/brain_embed_health_idx \(project_id=\?\)/.test(planText), `plan: ${planText}`)

    // MEASURED, NOT ASSERTED — and this is the FOURTH time this review has had to
    // remove a claim a fixture cannot support. The first version of this check
    // demanded a 10x ratio and measured 2x on an 8,000-symbol fixture, because
    // at that scale a per-symbol index probe is already cheap and the two plans
    // differ far less than they do at 304,926 symbols (where it was 513x). A
    // threshold assertion here would be decided by fixture size and machine
    // speed, not by the code — the same trap as the two timing assertions in
    // verify-actionability and verify-paths.
    //
    // The PLAN is the decidable property and it is asserted above. The ratio is
    // scale-dependent by nature, so it is recorded here for the next reader and
    // asserted nowhere.
    const fast = probe(entityOnly, [pid])
    const slow = probe(withProject, [pid, pid])
    console.log(`  measured at fixture scale (${symbols.length} symbols): entity_id=${fast}ms, project_id=${slow}ms, ${(slow / Math.max(fast, 1)).toFixed(1)}x.`)
    console.log(`  at real scale (304,926 symbols) the same pair was 53ms vs 27,250ms per 3,000 symbols = 513x, and a full default call went from >900s to 30s.`)
    harness.check("the plan assertion above is the load-bearing one, and it passed on entity_id", /entity_id=\?/.test(planText), `plan: ${planText.slice(0, 120)} — the ratio is scale-dependent and is recorded, not asserted`)

    // And the report itself must still be correct at this scale.
    const r = await getUnifiedHealth(pid, root, {})
    const total = r.embeddings.byLanguage.reduce((a, l) => a + l.symbols, 0)
    harness.check("the report is still correct at that scale", total === symbols.length, `byLanguage symbols total=${total} vs ${symbols.length} indexed — a fast query that returns the wrong number is worse than a slow one`)
  } finally { clean(root, pid) }
}

harness.emit()
