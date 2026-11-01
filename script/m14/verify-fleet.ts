#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────────────────────────────
// VERIFY-FLEET — the 50-lane GUARD MATRIX
//
// The analyzers are DONE (50 lanes at n/n, 50 DONE). What keeps that true is not another
// declaration: it is the three independent guards every lane must carry, because each answers a
// question the others cannot:
//
//   1. FIXTURES (M14.0.F3)  — does the analyzer do the right thing on hand-built constructs?
//   2. MUTANTS (M14.0.F4)   — CAN the suite fail? A lane with no mutant has a suite that has never
//                             been shown to go red, which is decoration, not verification.
//   3. DIFFERENTIAL (M14.0.F5) — does an INDEPENDENT oracle agree on real corpus files? A lane with
//                             no differential has only its own fixtures as evidence.
//
// A lane is GUARDED when all three exist. This file is the census of that property, and its exit
// code is the gate: every lane guarded, or the run fails and names the lane and which guard is
// missing. It never runs the suites (that is the lanes' own job); it proves the guards are WIRED,
// which is exactly the defect class the fleet has been bitten by three separate times — a mutant
// file nothing imports, a spec nothing reads, an oracle that was dropped by a merge.
//
// CLI:
//   bun script/m14/verify-fleet.ts            human table, exit 1 on any unguarded lane
//   bun script/m14/verify-fleet.ts --json     machine output
// ─────────────────────────────────────────────────────────────────────────────────────────────
import * as fs from "fs"
import * as path from "path"
import { LANGS } from "./run-fixtures"
import { MUTANTS } from "./mutate-analyzer"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const V = (p: string) => path.join(ROOT, p)
const JSON_OUT = process.argv.includes("--json")

type Lane = {
  lane: string
  fixtures: boolean
  mutants: number
  mutantsRetired: number
  differential: "pinned" | "measured" | "unmeasured" | "absent"
  differentialDetail: string
  differentialCounts?: { missing: number; unexplained: number }
  spec: boolean
  declaration: boolean
  /** ITEM 1: the fleet mutation battery's own result for this lane (validation/m14/results/mutants-fleet.json),
   *  measured by running every live mutant in a fresh process against the lane's fixtures. A lane the battery
   *  did not execute is UNMEASURED, and a lane with any SURVIVED mutant has a registry that does not kill the
   *  defects it declares — a no-op mutant reads as coverage while proving nothing. */
  mutantsBattery: { measured: boolean; caught: number; survived: number; survivorIds: string[] }
  /** PHASE D of the inbound model (docs/analyzers/INBOUND-EDGE-MODEL.md): the lane's own inbound census.
   *  Every lane's `validation/m14/instruments/<lane>/incoming-declaration.json` declares, per relation type,
   *  how many emitted edges RESOLVED to an identity, how many are external, ambiguous or otherwise unresolved.
   *  That is the falsifiable form of the three lies `script/m14/incoming-check.ts` documents — and its
   *  arithmetic is exact: parts must sum to the declared edges, or the census is not a census. */
  inbound: {
    status: "declared" | "unreconciled" | "absent"
    types: number
    edges: number
    resolved: number
    external: number
    ambiguous: number
    otherUnresolved: number
    /** `declared` = the declaration states its own `edges` total (parts are then a falsifier);
     *  `parts` = the declaration predates the `edges` field, so the total is the sum of its parts (the
     *  partition is then an identity, not a check — disclosed rather than presented as reconciled). */
    edgesSource: "declared" | "parts"
    detail: string
  }
}

const fixtureBaseline = JSON.parse(fs.readFileSync(V("validation/m14/fixture-baseline.json"), "utf8")) as Record<string, unknown>
const diffBaseline = JSON.parse(fs.readFileSync(V("validation/m14/differential-baseline.json"), "utf8")) as {
  counts: Record<string, unknown>
  unmeasured: Record<string, { reason?: string }>
}
// per-lane presence from the differential baseline: `counts` is keyed either by lane or by
// `<repo>:<lane>`;
const diffPinnedLangs = new Set<string>()
for (const k of Object.keys(diffBaseline.counts)) diffPinnedLangs.add(k.includes(":") ? k.split(":").pop()! : k)
const diffUnmeasuredLangs = new Map<string, string>()
for (const [k, v] of Object.entries(diffBaseline.unmeasured ?? {})) {
  const lang = k.includes(":") ? k.split(":").pop()! : k
  if (!diffUnmeasuredLangs.has(lang)) diffUnmeasuredLangs.set(lang, v.reason ?? "")
}
// A lane the canonical sweep MEASURED but the pin gate refused to pin (it carries its own
// missing/unexplained rows, #870). That is a VERDICT, not an absence: the numbers are recorded in
// validation/m14/results/M14.0.F5.lane-measurements.json by the sweep itself.
const diffMeasuredLangs = new Map<string, { missing: number; unexplained: number }>()
try {
  const measured = JSON.parse(fs.readFileSync(V("validation/m14/results/M14.0.F5.lane-measurements.json"), "utf8")) as {
    lanes: Record<string, { missing?: number; unexplained?: number; pinned?: boolean; unmeasured?: boolean }>
  }
  for (const [k, v] of Object.entries(measured.lanes ?? {})) {
    if (v.unmeasured) continue
    const lang = k.includes(":") ? k.split(":").pop()! : k
    diffMeasuredLangs.set(lang, { missing: v.missing ?? 0, unexplained: v.unexplained ?? 0 })
  }
} catch { /* not written yet: every lane then reads from the baseline alone */ }
// ITEM 1 — the fleet mutation battery artifact. Every lane must have been executed (unmeasured is not a pass)
// and must have ZERO survivors: a mutant that changes nothing the fixtures pin is a no-op, and a no-op mutant
// is coverage that cannot fail.
const mutantsBattery = new Map<string, { measured: boolean; caught: number; survived: number; survivorIds: string[] }>()
let mutantsBatteryTotals = { mutantsRun: 0, caught: 0, survived: 0 }
try {
  const battery = JSON.parse(fs.readFileSync(V("validation/m14/results/mutants-fleet.json"), "utf8")) as {
    totals?: { mutantsRun?: number; caught?: number; survived?: number }
    lanes?: Record<string, { caught?: number; survived?: number; survivorIds?: string[] }>
  }
  mutantsBatteryTotals = {
    mutantsRun: battery.totals?.mutantsRun ?? 0,
    caught: battery.totals?.caught ?? 0,
    survived: battery.totals?.survived ?? 0,
  }
  for (const [lane, row] of Object.entries(battery.lanes ?? {})) {
    mutantsBattery.set(lane, {
      measured: true,
      caught: row.caught ?? 0,
      survived: row.survived ?? 0,
      survivorIds: row.survivorIds ?? [],
    })
  }
} catch { /* absent artifact: every lane reads as unmeasured, which the guard refuses */ }
const mutantsByLang = new Map<string, { live: number; retired: number }>()
for (const m of MUTANTS) {
  const row = mutantsByLang.get(m.language) ?? { live: 0, retired: 0 }
  if (m.retired) row.retired++
  else row.live++
  mutantsByLang.set(m.language, row)
}
/**
 * PHASE D — load and RECONCILE one lane's inbound census.
 *
 * The declaration is the lane's own measurement of what it emitted: for each relation type, `edges` and the
 * partition of those edges into `resolved` (an identity), `external` (a known-external identity) and the two
 * string states (`ambiguous` / `otherUnresolved`). The reconciliation is the falsifier: if the parts do not
 * sum to `edges`, or the file declares no type with edges, the census is refused rather than counted. A lane
 * without the file is `absent`, which the guard treats as unguarded (an absence must be visible, not zero).
 */
function loadInbound(lane: string): Lane["inbound"] {
  const file = V(`validation/m14/instruments/${lane}/incoming-declaration.json`)
  if (!fs.existsSync(file)) {
    return { status: "absent", types: 0, edges: 0, resolved: 0, external: 0, ambiguous: 0, otherUnresolved: 0, edgesSource: "parts", detail: "no incoming-declaration.json" }
  }
  try {
    const d = JSON.parse(fs.readFileSync(file, "utf8")) as { types?: Record<string, Record<string, unknown>> }
    const types = d.types ?? {}
    let edges = 0, resolved = 0, external = 0, ambiguous = 0, otherUnresolved = 0, counted = 0
    let edgesSource: "declared" | "parts" = "declared"
    let derivedEdges = 0
    const mismatches: string[] = []
    for (const [type, v] of Object.entries(types)) {
      const r = Number(v.resolved ?? 0), x = Number(v.external ?? 0), a = Number(v.ambiguous ?? 0), o = Number(v.otherUnresolved ?? 0)
      const unclassed = Number(v.unclassed ?? 0)
      const sum = r + x + a + o + unclassed
      const stated = v.edges === undefined || v.edges === null ? null : Number(v.edges)
      if (stated === null) {
        // A declaration that predates the `edges` field: the total is the sum of its parts, so the partition
        // is an identity here rather than a check. Recorded as such, never presented as reconciled arithmetic.
        if (sum === 0) continue
        edgesSource = "parts"; derivedEdges++
        edges += sum
      } else {
        if (!Number.isFinite(stated) || stated === 0) continue
        if (sum !== stated) mismatches.push(`${type}: edges=${stated} parts=${sum}`)
        edges += stated
      }
      resolved += r; external += x; ambiguous += a; otherUnresolved += o; counted++
    }
    const detailBase = edgesSource === "parts" ? `${derivedEdges} type(s) declare no edges total; their partition is the total` : ""
    if (mismatches.length > 0) {
      return { status: "unreconciled", types: counted, edges, resolved, external, ambiguous, otherUnresolved, edgesSource, detail: mismatches.slice(0, 3).join("; ") }
    }
    if (counted === 0) {
      return { status: "unreconciled", types: 0, edges: 0, resolved: 0, external: 0, ambiguous: 0, otherUnresolved: 0, edgesSource, detail: "declares no relation type with edges" }
    }
    return { status: "declared", types: counted, edges, resolved, external, ambiguous, otherUnresolved, edgesSource, detail: detailBase }
  } catch (error) {
    return { status: "unreconciled", types: 0, edges: 0, resolved: 0, external: 0, ambiguous: 0, otherUnresolved: 0, edgesSource: "parts", detail: `unreadable declaration: ${(error as Error).message}` }
  }
}

const lanes: Lane[] = Object.keys(LANGS)
  .sort()
  .map((lane) => {
    const mut = mutantsByLang.get(lane) ?? { live: 0, retired: 0 }
    const measuredRow = diffMeasuredLangs.get(lane)
    // MEASUREMENT OUTRANKS THE BASELINE'S `unmeasured` BOOKKEEPING. That map is CARRIED across baseline
    // updates by design (mergeBaseline's #870 note: rows measured but deliberately not pinned are
    // bookkeeping), and entries from a sweep where an oracle did not exist yet survive forever. The
    // fresh measurement record is the current verdict, so it is consulted first: a lane with a row there
    // was measured THIS sweep and cannot be "unmeasured". Measured 2026-11-01 (round 8): bash, nim and vb
    // were reported unmeasured by the guard even though the canonical sweep had just measured them,
    // because their 2026-10-xx zero-truth entries were still in the carried map.
    const differential: Lane["differential"] = diffPinnedLangs.has(lane)
      ? "pinned"
      : measuredRow
        ? "measured"
        : diffUnmeasuredLangs.has(lane)
          ? "unmeasured"
          : "absent"
    return {
      lane,
      fixtures: lane in fixtureBaseline,
      mutants: mut.live,
      mutantsRetired: mut.retired,
      differential,
      differentialDetail:
        differential === "unmeasured"
          ? (diffUnmeasuredLangs.get(lane) ?? "").slice(0, 90)
          : differential === "measured" && measuredRow
            ? `missing=${measuredRow.missing} unexplained=${measuredRow.unexplained} (measured, not pinned — the pin gate refuses a lane carrying its own anomalies)`
            : "",
      differentialCounts: differential === "measured" ? measuredRow : undefined,
      spec: fs.existsSync(V(`script/m14/spec/${lane}-completeness.json`)),
      declaration: fs.existsSync(V(`validation/m14/instruments/${lane}/incoming-declaration.json`)),
      mutantsBattery: mutantsBattery.get(lane) ?? { measured: false, caught: 0, survived: 0, survivorIds: [] },
      inbound: loadInbound(lane),
    }
  })
// PHASE D: the fourth guard column is the lane's reconciled inbound census. A lane whose census is absent or
// does not reconcile is not guarded — its inbound behaviour is not measured, and an unmeasured dimension is
// not a passing one.
const guarded = (l: Lane) =>
  l.fixtures &&
  l.mutants > 0 &&
  l.differential !== "absent" &&
  l.inbound.status === "declared" &&
  // ITEM 1: a registry the battery never executed is unmeasured; a registry with survivors does not kill the
  // defects it declares. Both are unguarded, and the survivor ids are printed so the defect is named.
  l.mutantsBattery.measured &&
  l.mutantsBattery.survived === 0
const bad = lanes.filter((l) => !guarded(l))
const gaps = {
  noFixtures: lanes.filter((l) => !l.fixtures).map((l) => l.lane),
  noMutants: lanes.filter((l) => l.mutants === 0).map((l) => l.lane),
  noDifferential: lanes.filter((l) => l.differential === "absent").map((l) => l.lane),
  measuredUnpinned: lanes.filter((l) => l.differential === "measured").map((l) => l.lane),
  unmeasuredDifferential: lanes.filter((l) => l.differential === "unmeasured").map((l) => l.lane),
  noSpec: lanes.filter((l) => !l.spec).map((l) => l.lane),
  noDeclaration: lanes.filter((l) => !l.declaration).map((l) => l.lane),
  mutantsBatteryUnmeasured: lanes.filter((l) => !l.mutantsBattery.measured).map((l) => l.lane),
  mutantSurvivors: lanes.filter((l) => l.mutantsBattery.survived > 0).map((l) => `${l.lane}(${l.mutantsBattery.survived})`),
  inboundAbsent: lanes.filter((l) => l.inbound.status === "absent").map((l) => l.lane),
  inboundUnreconciled: lanes.filter((l) => l.inbound.status === "unreconciled").map((l) => `${l.lane}(${l.inbound.detail})`),
}
// Fleet-wide inbound census totals (population: the 50 lane declarations; scope: every declared relation type
// with edges; the partition must sum to `edges` per lane — see loadInbound).
const inboundTotals = lanes.reduce(
  (acc, l) => {
    acc.edges += l.inbound.edges; acc.resolved += l.inbound.resolved; acc.external += l.inbound.external
    acc.ambiguous += l.inbound.ambiguous; acc.otherUnresolved += l.inbound.otherUnresolved
    return acc
  },
  { edges: 0, resolved: 0, external: 0, ambiguous: 0, otherUnresolved: 0 },
)
const inboundPct = (n: number) => (inboundTotals.edges > 0 ? ((n / inboundTotals.edges) * 100).toFixed(1) : "0.0")
// Durable memory of the census. Deterministic content: no timestamp, lane order is the guard's own order, so
// the file only changes when a lane's measurement does.
try {
  fs.mkdirSync(V("validation/m14/results"), { recursive: true })
  fs.writeFileSync(
    V("validation/m14/results/inbound-fleet.json"),
    JSON.stringify({
      gate: "M14 inbound fleet census (phase D)",
      population: `${lanes.length} lanes, each lane's validation/m14/instruments/<lane>/incoming-declaration.json`,
      scope: "every declared relation type with edges; partition per type must sum to edges",
      falsifier: "a lane whose parts do not sum to its declared edges, or that declares no type with edges, is UNRECONCILED and unguarded",
      totals: inboundTotals,
      lanes: Object.fromEntries(lanes.map((l) => [l.lane, l.inbound])),
    }, null, 1) + "\n",
  )
} catch { /* artifact is memory, never a gate: the guard's verdict above does not depend on writing it */ }
if (JSON_OUT) {
  console.log(JSON.stringify({ lanes: lanes.length, guarded: lanes.filter(guarded).length, gaps, inboundTotals, mutantsBatteryTotals, rows: lanes }, null, 1))
} else {
  console.log(`verify-fleet — ${lanes.length} lanes · guarded ${lanes.filter(guarded).length} · unguarded ${bad.length}`)
  console.log(`  fixtures missing:      ${gaps.noFixtures.length ? gaps.noFixtures.join(" ") : "—"}`)
  console.log(`  mutants missing:       ${gaps.noMutants.length ? gaps.noMutants.join(" ") : "—"}`)
  console.log(`  differential absent:   ${gaps.noDifferential.length ? gaps.noDifferential.join(" ") : "—"}`)
  console.log(`  differential measured-unpinned: ${gaps.measuredUnpinned.length ? gaps.measuredUnpinned.map((lane) => { const c = lanes.find((l) => l.lane === lane)?.differentialCounts; return c ? `${lane}(${c.missing}m/${c.unexplained}u)` : lane }).join(" ") : "—"}`)
  console.log(`  differential unmeasured: ${gaps.unmeasuredDifferential.length ? gaps.unmeasuredDifferential.join(" ") : "—"}`)
  console.log(`  mutant battery unmeasured: ${gaps.mutantsBatteryUnmeasured.length ? gaps.mutantsBatteryUnmeasured.join(" ") : "—"}`)
  console.log(`  mutant SURVIVORS:         ${gaps.mutantSurvivors.length ? gaps.mutantSurvivors.join(" ") : "—"}`)
  console.log(`  mutation battery: ${mutantsBatteryTotals.mutantsRun} mutants run — ${mutantsBatteryTotals.caught} caught, ${mutantsBatteryTotals.survived} survived (population: 50 lanes, fresh process per lane)`)
  console.log(`  inbound census absent:  ${gaps.inboundAbsent.length ? gaps.inboundAbsent.join(" ") : "—"}`)
  console.log(`  inbound unreconciled:   ${gaps.inboundUnreconciled.length ? gaps.inboundUnreconciled.join(" ") : "—"}`)
  console.log(`  inbound census (${lanes.filter((l) => l.inbound.status === "declared").length}/${lanes.length} lanes reconciled): ${inboundTotals.edges.toLocaleString("en-US")} declared edges — resolved ${inboundTotals.resolved.toLocaleString("en-US")} (${inboundPct(inboundTotals.resolved)}%), external ${inboundTotals.external.toLocaleString("en-US")} (${inboundPct(inboundTotals.external)}%), ambiguous ${inboundTotals.ambiguous.toLocaleString("en-US")} (${inboundPct(inboundTotals.ambiguous)}%), other unresolved ${inboundTotals.otherUnresolved.toLocaleString("en-US")} (${inboundPct(inboundTotals.otherUnresolved)}%)`)
  console.log("")
  console.log("lane".padEnd(11) + "fixtures  mutants(live/retired)  differential   spec  decl  inbound  battery")
  for (const l of lanes) {
    if (guarded(l) && l.differential !== "unmeasured") continue
    console.log(
      l.lane.padEnd(11) +
        String(l.fixtures ? "yes" : "NO").padEnd(10) +
        `${l.mutants}/${l.mutantsRetired}`.padEnd(23) +
        l.differential.padEnd(15) +
        (l.spec ? "yes" : "NO").padEnd(6) +
        (l.declaration ? "yes" : "NO").padEnd(6) +
        `${l.inbound.status === "declared" ? `${l.inbound.types}t ${(l.inbound.edges / 1000).toFixed(0)}k edges` : l.inbound.status.toUpperCase()}`.padEnd(25) +
        (l.mutantsBattery.measured ? `${l.mutantsBattery.caught}c/${l.mutantsBattery.survived}s` : "UNMEASURED")
    )
  }
  console.log("")
  console.log(gaps.mutantSurvivors.length ? `MUTATION: ${gaps.mutantSurvivors.length} lane(s) carry a registry that does NOT kill every mutant it declares: ${gaps.mutantSurvivors.join(" ")}` : `MUTATION: 0 survivors — every lane's registry kills every mutant it declares`)
  console.log(bad.length ? `FAIL — ${bad.length} lane(s) unguarded: ${bad.map((l) => l.lane).join(" ")}` : "PASS — every lane carries fixtures, at least one live mutant, and a differential oracle")
}
process.exit(bad.length ? 1 : 0)
