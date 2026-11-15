/**
 * dart/nested-block-shadows-member — THE MUTANTS, and the check that they are caught.
 *
 * ## Why this battery exists
 *
 * This fixture shipped for two days with TWO UNFIREABLE `forbidRelationships` rows. They
 * named lines 20 and 22, which in the committed source are comment lines, and the file they
 * described did not exist: its code began with `var value = 1;`, which in Dart shadows the
 * field for the WHOLE body, so the file contained no member read — while its own rationale
 * said "two local reads and one member read … tell them apart". The fixture was GREEN and
 * asserted nothing about the property it was named for. A `forbid` that cannot fire is worse
 * than no forbid, because it reads as coverage; this file is the check that the repaired
 * rows CAN fire, which is the one thing a passing fixture cannot tell you about itself.
 *
 * ## THE MUTANTS — three are PLANTS, and that word is load-bearing
 *
 * `script/m14/mutate-analyzer.ts` is SHARED machinery (report, do not edit), so this battery
 * is lane-owned and self-contained like `untyped-method-mutant.ts`. Unlike that battery,
 * three of the four mutants here are SHAPES PLANTED INTO THE REAL PAYLOAD rather than
 * replays of a broken analyzer: the property under test is "this fixture REFUSES this edge",
 * so the honest way to prove the refusal is to hand it the edge. A plant proves fireability
 * and says nothing about which code path would produce the shape; the round that made the
 * shape reachable is named in each note instead.
 *
 *   P1 FIELD-EDGE-OUT-OF-run — add `uses run -> Box.value` on line 51. This is the shape a
 *      broken local suppression produces (the nested block's local stops suppressing and the
 *      field read leaks out). Caught by `forbidRelationships` row 1, which is the property
 *      the fixture is named for and the row the pre-repair file could not state.
 *
 *   P2 BARE-MEMBER-READ — rewrite `uses readsMember -> Box.value` to the bare `value`. This
 *      is the pre-2026-10-08 spelling of a member read. Caught TWICE, in both directions: the
 *      qualified `expectRelationships` row goes missing AND the forbid on the bare spelling
 *      fires — a fixture that pinned only one of those two would pass a mutant that swapped
 *      the spelling for something else entirely.
 *
 *   P3 LOCAL-READ-DROPPED — remove the `uses run -> value` edge. This is the INVERTED-GUARD
 *      shape (`insideCollected` read the wrong way, so the body's own declarations are
 *      dropped). Caught by the expect row AND the dedup count (1 -> 0).
 *
 *   P4 DEDUP-BROKEN — keep the deduped edge and add the other two occurrences (51 and 53).
 *      Caught by the count (1 -> 3) and by both per-line forbids, which is why those two rows
 *      exist: a count alone would catch the number but not say WHICH occurrence leaked.
 *
 * A mutant that cannot be constructed proves nothing and a battery that passes because a
 * mutant silently did nothing is worse than no battery, so each mutant asserts it MOVED
 * something, and the battery exits non-zero if any mutant survives.
 *
 * ## CLI
 *
 *   npx tsx validation/m14/fixtures/dart/nested-block-shadows-member-mutant.ts
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const HERE = (import.meta as any).dirname
const FIXTURE = path.join(HERE, "nested-block-shadows-member.dart")
const EXPECTATION = path.join(HERE, "nested-block-shadows-member.expectation.json")

type Rel = {
  type?: string
  relationshipType?: string
  source?: string
  from?: string
  target?: string
  to?: string
  confidence?: number
  line_number?: number
  metadata?: Record<string, unknown>
}
type Sym = { name?: string; kind?: string; ownerName?: string; owner?: string }
type Res = { symbols?: Sym[]; relationships?: Rel[] }

const relType = (r: Rel): string => String(r.type ?? r.relationshipType ?? "")
const relSrc = (r: Rel): string => String(r.source ?? r.from ?? "")
const relTgt = (r: Rel): string => String(r.target ?? r.to ?? "")
const symOwner = (s: Sym): string => String(s.ownerName ?? s.owner ?? "")

const base: Res = await parseFile(FIXTURE, HERE)
const baseRels = base.relationships ?? []
const baseSyms = base.symbols ?? []

const parsed = JSON.parse(fs.readFileSync(EXPECTATION, "utf8"))
const metaOf = (r: any): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(r)) if (k.startsWith("meta.")) out[k.slice(5)] = r[k]
  return out
}

/** The fixture's FOUR sections, evaluated the way `run-fixtures.ts` evaluates them. */
function fixtureVerdict(res: Res): string[] {
  const bad: string[] = []
  const rels = res.relationships ?? []
  const syms = res.symbols ?? []
  for (const w of parsed.expectSymbols ?? []) {
    const hit = syms.find(
      (s) =>
        s.name === w.name &&
        (w.kind === undefined || s.kind === w.kind) &&
        (w.ownerName === undefined || symOwner(s) === w.ownerName),
    )
    if (!hit) bad.push(`MISSING symbol    ${w.name}${w.ownerName ? ` in ${w.ownerName}` : ""}`)
  }
  const match = (r: Rel, w: any): boolean => {
    if (relType(r) !== String(w.type)) return false
    const wantFrom = w.from ?? w.source
    const wantTo = w.target ?? w.to
    if (wantFrom !== undefined && relSrc(r) !== wantFrom) return false
    if (wantTo !== undefined && relTgt(r) !== wantTo) return false
    if (w.line_number !== undefined && r.line_number !== w.line_number) return false
    if (w.confidence !== undefined && r.confidence !== w.confidence) return false
    for (const [k, v] of Object.entries(metaOf(w))) {
      const mv = (r.metadata ?? {})[k]
      if (v === null) {
        if (mv !== undefined && mv !== null) return false
        continue
      }
      if (mv !== v) return false
    }
    return true
  }
  for (const w of parsed.expectRelationships ?? []) {
    if (!rels.some((r) => match(r, w))) {
      bad.push(`MISSING edge      ${w.type} ${w.from} -> ${w.target}${w.line_number ? ` @${w.line_number}` : ""}`)
    }
  }
  for (const w of parsed.forbidRelationships ?? []) {
    const hit = rels.find((r) => match(r, w))
    if (hit) {
      bad.push(
        `UNEXPECTED edge   ${w.type} ${w.from ?? "*"} -> ${w.target ?? "*"}` +
          `${w.line_number ? ` @${w.line_number}` : ""} (line ${hit.line_number})`,
      )
    }
  }
  for (const c of parsed.expectRelationshipCount ?? []) {
    const n = rels.filter((r) => match(r, { ...c, line_number: undefined, confidence: undefined })).length
    if (n !== c.equals) bad.push(`COUNT             ${c.type} ${c.from} -> ${c.target}: expected ${c.equals}, got ${n}`)
  }
  return bad
}

// ------------------------------------------------------------------------ the mutants
const clone = (r: Rel): Rel => ({ ...r, metadata: { ...(r.metadata ?? {}) } })

/** P1 — the field edge a broken local suppression leaks out of `run()` (on line 51). */
const p1rels = [...baseRels, { type: "uses", source: "run", target: "Box.value", confidence: 0.6, line_number: 51, metadata: {} }]
const p1 = { symbols: baseSyms, relationships: p1rels }
const p1Moved = p1rels.length - baseRels.length

/** P2 — the pre-2026-10-08 spelling of a member read: bare, not qualified. */
const p2rels = baseRels.map((r) =>
  relType(r) === "uses" && relTgt(r) === "Box.value" ? { ...clone(r), target: "value" } : r,
)
const p2 = { symbols: baseSyms, relationships: p2rels }
const p2Moved = p2rels.filter((r, i) => relTgt(r) !== relTgt(baseRels[i])).length

/** P3 — the inverted guard: the body's local read is not emitted at all. */
const p3rels = baseRels.filter((r) => !(relType(r) === "uses" && r.metadata?.isLocalRead === true))
const p3 = { symbols: baseSyms, relationships: p3rels }
const p3Moved = baseRels.length - p3rels.length

/** P4 — the dedup broken: all three occurrences kept instead of the first. */
const localRead = baseRels.find((r) => relType(r) === "uses" && r.metadata?.isLocalRead === true)
const p4rels = [
  ...baseRels,
  { ...clone(localRead!), line_number: 51 },
  { ...clone(localRead!), line_number: 53 },
]
const p4 = { symbols: baseSyms, relationships: p4rels }
const p4Moved = p4rels.length - baseRels.length

// ---------------------------------------------------------------------------- the run
let failures = 0
const report = (label: string, ok: boolean, detail: string): void => {
  if (!ok) failures++
  console.log(`${ok ? "ok  " : "FAIL"} ${label} — ${detail}`)
}

console.log(`dart/nested-block-shadows-member mutant battery`)
console.log(`base: ${baseSyms.length} symbols, ${baseRels.length} relationships`)
console.log("")

const controlBad = fixtureVerdict(base)
report(
  "control",
  controlBad.length === 0,
  controlBad.length === 0 ? "the real analyzer satisfies every fixture row" : controlBad.join("; "),
)

const check = (name: string, built: number, builtWhat: string, mutant: Res): void => {
  report(`${name} constructed`, built > 0, built > 0 ? `${built} ${builtWhat}` : "NOTHING TO MUTATE — the fixture cannot catch this")
  if (built === 0) return
  const bad = fixtureVerdict(mutant)
  report(`${name} caught`, bad.length > 0, bad.length > 0 ? bad.slice(0, 3).join("; ") : "THE MUTANT SURVIVED")
}

check("P1 field-edge-out-of-run", p1Moved, "planted edge(s) `uses run -> Box.value`", p1)
check("P2 bare-member-read", p2Moved, "member read(s) rewritten to the bare spelling", p2)
check("P3 local-read-dropped", p3Moved, "local read edge(s) removed", p3)
check("P4 dedup-broken", p4Moved, "repeat read occurrence(s) re-added", p4)

console.log("")
if (failures > 0) {
  console.log(`${failures} check(s) FAILED — a mutant that survives fails the suite, not the mutant.`)
  process.exit(1)
}
console.log("every mutant constructed and every mutant caught; the control passes")
