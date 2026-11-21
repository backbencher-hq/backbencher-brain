// script/m13/verify-backfill-pending-agreement.ts
//
// Reported on 0.1.8: "Health and doctor disagree. Doctor says health reports
// BACKFILL PENDING; health omits it because the configured-space floor is 5%
// (embedding-spaces.ts:41), and health's last run: 693 is stale versus the 950
// just embedded."
//
// `pendingBackfill` was computed as `configuredCoverage < 5%` — the READ-PATH
// eligibility floor — so a project at 20.7% coverage with 44,250 symbols still
// missing the configured model reported NO pending backfill, while doctor told its
// reader that "bb health reports BACKFILL PENDING until complete".
//
// Two different questions were being answered by one boolean:
//   · may a vector answer be presented as the configured space?  (>= 5%)
//   · is the backfill finished?                                  (no gaps at all)

import { planEmbeddingSpaces } from "../../src/brain/semantic/embedding-spaces"

let failures = 0
let checks = 0
function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

const LOCAL = "local-word-vectors-v3"
const REMOTE = "nomic-embed-text"
const plan = (configured: number, total: number, opts: { local?: number; minCoverage?: number } = {}) =>
  planEmbeddingSpaces({
    configuredModel: REMOTE,
    localModel: LOCAL,
    symbolCount: total,
    spaces: [
      { model: REMOTE, dimension: 768, entities: configured },
      { model: LOCAL, dimension: 50, entities: opts.local ?? 0 },
    ].filter((s) => s.entities > 0),
    ...(opts.minCoverage !== undefined ? { minConfiguredCoverage: opts.minCoverage } : {}),
  })

console.log("M13 backfill-pending agreement\n")

// ── the reported case: well above the 5% floor, but 79% still missing ────────
{
  const p = plan(950, 4592) // 20.7% coverage, 3,642 symbols missing
  check("THE REPORTED DEFECT: 20.7% coverage with missing symbols reports BACKFILL PENDING", p.pendingBackfill === true, String(p.pendingBackfill))
  check("the pending detail names the gap, so doctor's promise is now true", typeof p.pendingDetail === "string" && p.pendingDetail.includes("backfill pending"), String(p.pendingDetail).slice(0, 90))
  check("the configured space is still USABLE for reads above the floor", p.compareModel === REMOTE, String(p.compareModel))
  check("no fallback is declared when the configured space is dense enough", p.fallbackDeclared === false)
}

// ── complete coverage reports no pending backfill ────────────────────────────
{
  const p = plan(1000, 1000)
  check("100% coverage reports NO pending backfill", p.pendingBackfill === false)
  check("100% coverage has no pending detail", p.pendingDetail === null)
  check("100% coverage compares in the configured space", p.compareModel === REMOTE)
}

// ── one symbol short is still pending (the honest reading) ──────────────────
{
  const p = plan(999, 1000)
  check("99.9% coverage still reports pending (a gap is a gap)", p.pendingBackfill === true, String(p.pendingBackfill))
}

// ── below the floor: pending AND the read path must fall back ───────────────
{
  const p = plan(100, 10000, { local: 6000 }) // 1% configured, local covers
  check("1% coverage reports pending", p.pendingBackfill === true)
  check("1% coverage declares the fallback to the local space", p.fallbackDeclared === true && p.compareModel === LOCAL, `${p.compareModel}/${p.fallbackDeclared}`)
  check("the fallback reason is the under-covered configured space", p.fallbackReason === "configured-model-space-under-covered", String(p.fallbackReason))
}

// ── no configured model: nothing to backfill ────────────────────────────────
{
  const p = planEmbeddingSpaces({ configuredModel: null, localModel: LOCAL, symbolCount: 100, spaces: [{ model: LOCAL, dimension: 50, entities: 100 }] })
  check("an unconfigured project reports no pending backfill", p.pendingBackfill === false)
  check("an unconfigured project compares in its populated space", p.compareModel === LOCAL)
}

// ── no symbols: nothing to backfill ─────────────────────────────────────────
{
  const p = planEmbeddingSpaces({ configuredModel: REMOTE, localModel: LOCAL, symbolCount: 0, spaces: [] })
  check("an empty project reports no pending backfill", p.pendingBackfill === false)
}

console.log(`\n${checks - failures}/${checks} passed`)
console.log(failures === 0 ? "BACKFILL AGREEMENT: PASS" : `BACKFILL AGREEMENT: FAIL (${failures})`)
process.exit(failures === 0 ? 0 : 1)
