/**
 * dart/object-interface — THE MUTANTS, and the check that they are caught.
 *
 * ## Why this file exists separately from the fixture
 *
 * `object-interface-override.expectation.json` pins what the analyzer does. A pin
 * that cannot fail proves nothing, and the project's own record is that this lane
 * shipped four defects behind a green suite — `script/m14/verify-dart-overrides.ts`
 * opens on exactly that: "Fixtures pin the ANALYZER. Nothing pinned the oracle, and
 * the oracle was where four of the six defects ... lived."
 *
 * `script/m14/mutate-analyzer.ts` is SHARED machinery (§8 of the ontology
 * workstream: report, do not edit), and registering a lane's mutants in it means
 * editing it. So the battery is lane-owned and self-contained: it constructs the
 * two ways this change can be wrong, applies each to the real analyzer's output,
 * and requires the fixture's own rows to catch both.
 *
 * ## THE TWO MUTANTS
 *
 *   M1 REVERT — undo the retarget, restoring the pre-fix first-parent target by
 *      reading the two metadata fields the retarget itself writes. This is the
 *      exact shape the corpus carried for 2,422 of 247,737 `overrides` rows.
 *      Caught by: `forbidRelationships` on
 *      `ProtocolException.toString -> Exception.toString`.
 *
 *   M2 OVERREACH — retarget EVERY override onto `Object`, ignoring both the
 *      five-member set and the in-file-base boundary. The tempting wrong fix.
 *      Caught by: `forbidRelationships` on `Banner.build -> Object.build`, and by
 *      the `expectRelationshipCount` on `overrides`, which moves from 7 to 5.
 *      Its evidence is `isExternalBase` OR `baseBeyondRunScope` since the bucket-3
 *      split (2026-10-09): case H, the row that made this mutant constructible,
 *      now carries the declared cause, and a mutant that reads one key would have
 *      become a no-op — and a no-op mutant passes every check.
 *
 *   M5 WRONG REASON — keep a declared cause and point it at a base that is not the
 *      edge's own owner. Caught by the `forbidRelationships` pin on
 *      `meta.baseBeyondRunScope: "Object"`, which is otherwise a string no producer
 *      writes and therefore a pin that cannot fail.
 *
 *   M6 SKIP TOO FAR — apply the Object-skip to EVERY member, including Object's own
 *      five. The fallback must keep `Object` as the base when the member IS one of
 *      them (`class Direct extends Object { @override String toString() }`), because
 *      that interface is the one thing a per-file run can name with no evidence about
 *      the base. Caught by the MISSING row `Direct.toString -> Object.toString` and by
 *      the `overrides` count. Constructed from the analyzer's OWN output: an
 *      `Object.<member>` override with no `isObjectInterfaceBase` IS the `first ===
 *      Object` shape, so the mutant cannot be built unless that shape exists.
 *
 *   M7 NO-SUPPRESSION CONTROL — fabricate every row the fixture forbids. The two
 *      absence pins this change adds (case L `PlainRoot.length`, case M
 *      `MentionsOnly.length`) are rows the analyzer must NEVER produce, so no
 *      output-transform can reach them: the row is not there to transform. This mutant
 *      is the only way to show those pins are wired rather than decorative — it appends
 *      each forbidden row with its own `meta.` pins and requires the fixture to reject
 *      every one. It is a control on the FIXTURE, not a model of a wrong analyzer, and
 *      it is named as such.
 *
 * ## WHAT MAKES THIS BATTERY HONEST
 *
 * A mutant that CANNOT be constructed proves nothing, and a battery that passes
 * because the mutant silently did nothing is worse than no battery. So both
 * mutants assert they were actually built — M1 refuses to run unless it found at
 * least one row carrying `isObjectInterfaceBase`, and M2 refuses unless it found
 * at least one row carrying `isExternalBase` — and the battery exits non-zero if
 * either mutant SURVIVES the fixture's rows.
 *
 * ## CLI
 *
 *   bun run validation/m14/fixtures/dart/object-interface-mutant.ts
 */
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const FIXTURE = path.join(import.meta.dirname, "object-interface-override.dart")
const EXPECTATION = path.join(import.meta.dirname, "object-interface-override.expectation.json")

type Want = { type: string; from: string; target: string; meta?: Record<string, unknown> }
type Rel = { type?: string; relationshipType?: string; source?: string; from?: string; target?: string; to?: string; confidence?: number; metadata?: Record<string, any> }
type Res = { symbols?: any[]; relationships?: Rel[] }

const relType = (r: Rel): string => String(r.type ?? r.relationshipType ?? "")
const relSrc = (r: Rel): string => String(r.source ?? r.from ?? "")
const relTgt = (r: Rel): string => String(r.target ?? r.to ?? "")

const base: Res = await parseFile(FIXTURE, import.meta.dirname)
const baseRels = base.relationships ?? []

// ---------------------------------------------------------------- the fixture's own rows
const exp = (await import("node:fs")).readFileSync(EXPECTATION, "utf8")
const parsed = JSON.parse(exp)
const metaOf = (r: any): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(r)) if (k.startsWith("meta.")) out[k.slice(5)] = r[k]
  return out
}
const expectRows: Want[] = parsed.expectRelationships
  .filter((r: any) => String(r.type) === "overrides" || String(r.type) === "calls")
  .map((r: any) => ({ type: r.type, from: r.from, target: r.target, meta: metaOf(r) }))
const forbidRows: Array<{ type: string; from: string; target: string; meta?: Record<string, unknown> }> = parsed.forbidRelationships
  .filter((r: any) => String(r.type) === "overrides")
  .map((r: any) => ({ type: r.type, from: r.from, target: r.target, meta: metaOf(r) }))
const expectOverridesCount: number | undefined = parsed.expectRelationshipCount
  ?.find((c: any) => String(c.type) === "overrides")?.equals


/**
 * The subset of the fixture's assertions a relationship list must satisfy, read
 * from the SAME expectation file `run-fixtures.ts` reads, with the same
 * `meta.<key>: null` convention for ABSENT (M59: several analyzers emit a label on
 * TRUE only, so the absent case is the one a consumer hits most, and a strict `!==`
 * could never be true for it).
 *
 * The metadata check was MISSING at first and two mutants survived because of it:
 * this harness compared only (type, from, target), so stamping or stripping
 * `isLocalRead` on a `calls` row changed nothing it could see. A second rule that
 * reads the same file but checks less is a second rule, and it drifted on exactly
 * the field the new mutants move.
 */
function matches(r: Rel, w: Want): boolean {
  if (relType(r) !== w.type || relSrc(r) !== w.from || relTgt(r) !== w.target) return false
  for (const [k, v] of Object.entries(w.meta ?? {})) {
    const mv = (r.metadata ?? {})[k]
    if (v === null) { if (mv !== undefined && mv !== null) return false; continue }
    if (mv !== v) return false
  }
  return true
}
function fixtureVerdict(rels: Rel[]): string[] {
  const bad: string[] = []
  for (const w of expectRows) {
    if (!rels.some(r => matches(r, w))) {
      const md = Object.keys(w.meta ?? {}).length ? ` [${JSON.stringify(w.meta)}]` : ""
      bad.push(`MISSING expected  ${w.type} ${w.from} -> ${w.target}${md}`)
    }
  }
  // THE FORBIDS ARE CHECKED WITH THEIR `meta.` PINS TOO, and this is the same bug the comment
  // above records for `expectRows`, found the other way round: a forbid written to pin a MARKER
  // (`meta.isExternalBase: true` on the bucket-3 row) was being compared on (type, from, target)
  // alone — a rule that reads the same file but checks less. The effect is not subtle: the real
  // analyzer EMITS that row, so a meta-blind forbid reported it as present and failed the
  // control, which is how this was caught rather than shipped.
  for (const f of forbidRows) {
    if (rels.some(r => matches(r, { type: f.type, from: f.from, target: f.target, meta: f.meta }))) {
      bad.push(`UNEXPECTED       ${f.type} ${f.from} -> ${f.target}`)
    }
  }
  if (expectOverridesCount !== undefined) {
    const n = rels.filter(r => relType(r) === "overrides").length
    if (n !== expectOverridesCount) bad.push(`COUNT overrides   expected ${expectOverridesCount}, got ${n}`)
  }
  return bad
}

// ---------------------------------------------------------------- M1 REVERT
/**
 * Undo the retarget using only the analyzer's OWN two metadata fields, so the
 * mutant cannot be built if the retarget stops writing them. That is the property
 * that makes this a test of the change rather than a test of a copy of it.
 */
const revertTarget = (r: Rel): Rel | null => {
  const md = r.metadata ?? {}
  if (md.isObjectInterfaceBase !== true) return null
  const parent = String(md.firstHeritageParent ?? "")
  if (parent.length === 0) return null
  const member = relTgt(r).split(".").slice(1).join(".")
  if (member.length === 0) return null
  return { ...r, target: `${parent}.${member}` }
}
const m1 = { ...base, relationships: baseRels.map(r => revertTarget(r) ?? r) }
const m1Reverted = baseRels.filter(r => revertTarget(r) !== null).length

// ---------------------------------------------------------------- M2 OVERREACH
/** Retarget EVERY `isExternalBase` override onto `Object`, whatever the member.
 *  A fabricated edge the corpus does not contain, and the tempting wrong fix. */
/** The over-broad retarget, and its EVIDENCE IS WIDENED BY THE BUCKET-3 SPLIT: the analyzer no
 *  longer writes `isExternalBase` on a row whose base this run could not reach (case H, which is
 *  what used to make this mutant constructible), and reads the declared cause instead. A mutant
 *  keyed on `isExternalBase` alone would now be a NO-OP, and this battery's own header says what
 *  a no-op mutant is worth: it passes every check. So the evidence is "either marker says the
 *  base was not resolved", which is the honest statement of what an over-broad retarget does. */
const unresolvedOn = (r: Rel): boolean => {
  const md = r.metadata ?? {}
  return md.isExternalBase === true || typeof md.baseBeyondRunScope === "string"
}
const m2 = {
  ...base,
  relationships: baseRels.map(r => {
    if (relType(r) !== "overrides" || !unresolvedOn(r)) return r
    const member = relTgt(r).split(".").slice(1).join(".")
    if (member.length === 0) return r
    const tgt = `Object.${member}`
    return tgt === relTgt(r) ? r : { ...r, target: tgt }
  }),
}
const m2Retargeted = baseRels.filter(r => {
  if (relType(r) !== "overrides" || !unresolvedOn(r)) return false
  const member = relTgt(r).split(".").slice(1).join(".")
  return member.length > 0 && `Object.${member}` !== relTgt(r)
}).length

// ---------------------------------------------------------------- M3 STAMPEDE / M4 UNTAG
const m3 = { ...base, relationships: baseRels.map(r => (relType(r) === "calls" ? { ...r, metadata: { ...(r.metadata ?? {}), isLocalRead: true } } : r)) }
const m3Tagged = baseRels.filter(r => relType(r) === "calls").length
const m4 = { ...base, relationships: baseRels.map(r => { const md = { ...(r.metadata ?? {}) }; delete md.isLocalRead; return relType(r) === "calls" ? { ...r, metadata: md } : r }) }
const m4Untagged = baseRels.filter(r => relType(r) === "calls" && (r.metadata as any)?.isLocalRead === true).length

// ---------------------------------------------------------------- verdict
let failures = 0
const report = (label: string, ok: boolean, detail: string): void => {
  if (!ok) failures++
  console.log(`${ok ? "ok  " : "FAIL"} ${label} — ${detail}`)
}

console.log(`dart object-interface mutant battery`)
console.log(`fixture ${FIXTURE}`)
console.log(`base: ${baseRels.length} relationships, ${baseRels.filter(r => relType(r) === "overrides").length} overrides`)
console.log("")

// CONTROL — the real analyzer must satisfy the fixture, or every mutant below is
// measuring a broken baseline.
const controlBad = fixtureVerdict(baseRels)
report("control", controlBad.length === 0,
  controlBad.length === 0 ? "the real analyzer satisfies the fixture" : controlBad.join("; "))

// M1 must be CONSTRUCTIBLE. Zero reverted rows means the fixture cannot catch it.
report("M1 constructed", m1Reverted > 0,
  `${m1Reverted} row(s) carry isObjectInterfaceBase + firstHeritageParent and can be reverted`)

const m1Bad = fixtureVerdict(m1.relationships ?? [])
report("M1 caught", m1Bad.length > 0,
  m1Bad.length > 0 ? m1Bad.join("; ") : "THE MUTANT SURVIVED — the fixture cannot detect the pre-fix rule")

// M2 must be CONSTRUCTIBLE too.
report("M2 constructed", m2Retargeted > 0,
  `${m2Retargeted} external-base override row(s) can be over-retargeted onto Object`)

const m2Bad = fixtureVerdict(m2.relationships ?? [])
report("M2 caught", m2Bad.length > 0,
  m2Bad.length > 0 ? m2Bad.join("; ") : "THE MUTANT SURVIVED — the fixture cannot detect an over-broad retarget")

report("M3 constructed", m3Tagged > 0, `${m3Tagged} calls row(s) can be stamped isLocalRead`)
const m3Bad = fixtureVerdict(m3.relationships ?? [])
report("M3 caught", m3Bad.length > 0, m3Bad.length > 0 ? m3Bad.join("; ") : "THE MUTANT SURVIVED — nothing pins that a DECLARED callee stays untagged")

report("M4 constructed", m4Untagged > 0, `${m4Untagged} calls row(s) carry isLocalRead and can be untagged`)
const m4Bad = fixtureVerdict(m4.relationships ?? [])
report("M4 caught", m4Bad.length > 0, m4Bad.length > 0 ? m4Bad.join("; ") : "THE MUTANT SURVIVED — nothing pins that a BINDING callee stays tagged")

// ---------------------------------------------------------------- M5 WRONG REASON
/** Keep the declared cause and attach it to a base that is NOT this edge's own owner — `Object`,
 *  the convenient wrong reason. The rule refutes this at the gate (`the stated base must BE the
 *  target's own owner`), and this mutant is what proves the FIXTURE's forbid on
 *  `meta.baseBeyondRunScope: "Object"` can fire at all: without it that pin is a string nothing
 *  ever produces, which is a pin that cannot fail. */
const m5 = {
  ...base,
  relationships: baseRels.map(r => {
    const md = { ...(r.metadata ?? {}) }
    if (typeof md.baseBeyondRunScope !== "string") return r
    return { ...r, metadata: { ...md, baseBeyondRunScope: "Object" } }
  }),
}
const m5Rewritten = baseRels.filter(r => typeof (r.metadata as any)?.baseBeyondRunScope === "string").length

report("M5 constructed", m5Rewritten > 0, `${m5Rewritten} row(s) carry a declared cause and can be given a wrong reason`)
const m5Bad = fixtureVerdict(m5.relationships ?? [])
report("M5 caught", m5Bad.length > 0, m5Bad.length > 0 ? m5Bad.join("; ") : "THE MUTANT SURVIVED — nothing pins that a declared cause names this edge's own base")

// ---------------------------------------------------------------- M6 SKIP TOO FAR
/** The Object-skip applied where it must NOT be: to a member Object DOES declare. */
const isObjectFirstInterfaceRow = (r: Rel): boolean =>
  relType(r) === "overrides" && /^Object\./.test(relTgt(r)) && (r.metadata as any)?.isObjectInterfaceBase !== true
const m6 = { ...base, relationships: baseRels.filter(r => !isObjectFirstInterfaceRow(r)) }
const m6Dropped = baseRels.filter(isObjectFirstInterfaceRow).length

report("M6 constructed", m6Dropped > 0,
  `${m6Dropped} row(s) are \`first === Object\` interface rows and can be skipped along with the rest`)
const m6Bad = fixtureVerdict(m6.relationships ?? [])
report("M6 caught", m6Bad.length > 0,
  m6Bad.length > 0 ? m6Bad.join("; ") : "THE MUTANT SURVIVED — nothing pins that Object stays the base for its OWN five members")

// ---------------------------------------------------------------- M7 NO-SUPPRESSION CONTROL
/** Append every forbidden row, with its own `meta.` pins, and require the fixture to reject all of
 *  them. Fires the absence pins (case L, case M) that no output transform can otherwise reach. */
const m7Fabricated: Rel[] = forbidRows.map(f => ({
  type: f.type, source: f.from, target: f.target, confidence: 0.8, metadata: { ...(f.meta ?? {}) },
}))
const m7 = { ...base, relationships: [...baseRels, ...m7Fabricated] }

report("M7 constructed", m7Fabricated.length > 0, `${m7Fabricated.length} forbidden row(s) can be fabricated`)
const m7Bad = fixtureVerdict(m7.relationships ?? [])
report("M7 caught", m7Bad.length > 0,
  m7Bad.length > 0 ? m7Bad.join("; ") : "THE MUTANT SURVIVED — a forbid pin is not wired and could never fail")

console.log("")
if (failures > 0) {
  console.log(`${failures} check(s) FAILED — a mutant that survives fails the suite, not the mutant.`)
  process.exit(1)
}
console.log("every mutant constructed and every mutant caught; the control passes")
