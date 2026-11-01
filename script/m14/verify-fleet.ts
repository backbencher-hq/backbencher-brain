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
const mutantsByLang = new Map<string, { live: number; retired: number }>()
for (const m of MUTANTS) {
  const row = mutantsByLang.get(m.language) ?? { live: 0, retired: 0 }
  if (m.retired) row.retired++
  else row.live++
  mutantsByLang.set(m.language, row)
}
const lanes: Lane[] = Object.keys(LANGS)
  .sort()
  .map((lane) => {
    const mut = mutantsByLang.get(lane) ?? { live: 0, retired: 0 }
    const measuredRow = diffMeasuredLangs.get(lane)
    const differential: Lane["differential"] = diffPinnedLangs.has(lane)
      ? "pinned"
      : diffUnmeasuredLangs.has(lane)
        ? "unmeasured"
        : measuredRow
          ? "measured"
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
    }
  })
const guarded = (l: Lane) => l.fixtures && l.mutants > 0 && l.differential !== "absent"
const bad = lanes.filter((l) => !guarded(l))
const gaps = {
  noFixtures: lanes.filter((l) => !l.fixtures).map((l) => l.lane),
  noMutants: lanes.filter((l) => l.mutants === 0).map((l) => l.lane),
  noDifferential: lanes.filter((l) => l.differential === "absent").map((l) => l.lane),
  measuredUnpinned: lanes.filter((l) => l.differential === "measured").map((l) => l.lane),
  unmeasuredDifferential: lanes.filter((l) => l.differential === "unmeasured").map((l) => l.lane),
  noSpec: lanes.filter((l) => !l.spec).map((l) => l.lane),
  noDeclaration: lanes.filter((l) => !l.declaration).map((l) => l.lane),
}
if (JSON_OUT) {
  console.log(JSON.stringify({ lanes: lanes.length, guarded: lanes.filter(guarded).length, gaps, rows: lanes }, null, 1))
} else {
  console.log(`verify-fleet — ${lanes.length} lanes · guarded ${lanes.filter(guarded).length} · unguarded ${bad.length}`)
  console.log(`  fixtures missing:      ${gaps.noFixtures.length ? gaps.noFixtures.join(" ") : "—"}`)
  console.log(`  mutants missing:       ${gaps.noMutants.length ? gaps.noMutants.join(" ") : "—"}`)
  console.log(`  differential absent:   ${gaps.noDifferential.length ? gaps.noDifferential.join(" ") : "—"}`)
  console.log(`  differential measured-unpinned: ${gaps.measuredUnpinned.length ? gaps.measuredUnpinned.map((lane) => { const c = lanes.find((l) => l.lane === lane)?.differentialCounts; return c ? `${lane}(${c.missing}m/${c.unexplained}u)` : lane }).join(" ") : "—"}`)
  console.log(`  differential unmeasured: ${gaps.unmeasuredDifferential.length ? gaps.unmeasuredDifferential.join(" ") : "—"}`)
  console.log("")
  console.log("lane".padEnd(11) + "fixtures  mutants(live/retired)  differential   spec  decl")
  for (const l of lanes) {
    if (guarded(l) && l.differential !== "unmeasured") continue
    console.log(
      l.lane.padEnd(11) +
        String(l.fixtures ? "yes" : "NO").padEnd(10) +
        `${l.mutants}/${l.mutantsRetired}`.padEnd(23) +
        l.differential.padEnd(15) +
        (l.spec ? "yes" : "NO").padEnd(6) +
        (l.declaration ? "yes" : "NO")
    )
  }
  console.log("")
  console.log(bad.length ? `FAIL — ${bad.length} lane(s) unguarded: ${bad.map((l) => l.lane).join(" ")}` : "PASS — every lane carries fixtures, at least one live mutant, and a differential oracle")
}
process.exit(bad.length ? 1 : 0)
