// script/m61/gate_lint.ts — M61.V4 (issue #845): the verifier lint.
//
// The defect this pins: nothing requires a gate to be able to fail. A verifier
// with no mutants, no declared output, or no execution tier is still treated as
// evidence — the I1 cap bug lived for weeks inside a "verified" gate.
//
// Design rule (D-5, no duplicated facts): the lint DERIVES everything it can
// from single owners and only asks for a declaration where no owner exists.
//
//   ownership     a record names its gate (verifierCommand), or the gate's
//                 source names the record's filename — derived, not declared.
//   can-fail      the record's declared counts OR its per-check verdict list
//                 (the house `M: <name>` / "negative" conventions) — derived.
//   tiers         machine-read command lists from package.json and the lane's
//                 own ladder script — derived.
//   declarations  only what no owner can express: which lane scripts are
//                 knowingly NOT gates, which skip env-vars are declared, which
//                 gates are knowingly without a can-fail proof (each with a
//                 REASON), and which unsealed records are declared legacy.
//
// Laws gated by script/m61/verify-lint.ts:
//   G1 gate census:  every lane script that runs checks owns >= 1 lane record,
//                    unless it is DECLARED a non-gate; a declared non-gate that
//                    owns a record fails (a stale declaration must not hide a
//                    real gate).
//   G2 attribution:  every lane record is attributable to a gate. An orphan
//                    record (evidence nobody claims) fails.
//   G3 sealing:      every lane record is sealed, unless declared legacy.
//   G4 can-fail:     every gate carries >= the declared floor of can-fail
//                    proofs, unless declared without one AND with a reason. A
//                    "declared no can-fail" gate that HAS proof fails (stale).
//   G5 wiring:       every gate appears in >= 1 declared execution tier, and
//                    the fast tier is a strict subset of the full tier.
//   G6 skip modes:   every BB_* env-var a gate reads is declared.
//
// Run: npx tsx script/m61/verify-lint.ts
// Evidence: validation/m61/results/V4.json (sealed)

import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"

export const ROOT = path.resolve(import.meta.dirname, "..", "..")
export const REGISTRY_FILE = path.join(ROOT, "script/m61/gate-registry.json")

export type Registry = {
  schemaVersion: number
  milestone: string
  issue: string
  authority: string
  lanes: string[]
  canFailFloor: number
  tiers: { name: string; kind: "npm-script" | "script-list"; script?: string; source?: string }[]
  declaredNonGates: { path: string; reason: string }[]
  declaredNoCanFail: { gate: string; reason: string }[]
  declaredOnDemand: { gate: string; reason: string }[]
  declaredEnv: { name: string; role: "skip" | "input"; reason: string }[]
  declaredArtifactRecords: { record: string; reason: string }[]
  declaredLegacyUnsealed: { record: string; reason: string }[]
}

export function loadRegistry(file = REGISTRY_FILE): Registry {
  return JSON.parse(readFileSync(file, "utf8")) as Registry
}

export function isSealed(record: Record<string, unknown>): boolean {
  return record.bbSeal !== undefined
}

/**
 * Can-fail proofs a record carries. Two independent sources, both single
 * owners: the counts the gate declares, and the per-check verdict list where
 * the house conventions name mutants `M: <name>` and negative cases with
 * "negative". A record is only proof-bearing if one of them is > 0.
 */
export function canFailProofs(record: Record<string, unknown>): { mutants: number; negatives: number } {
  const declaredKeys = ["mutantsCaught", "mutants", "negativeCases", "negatives", "canFail"]
  let mutants = 0
  let negatives = 0
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0)
  for (const k of declaredKeys) {
    const v = record[k]
    if (typeof v === "number") {
      if (k === "negatives" || k === "negativeCases") negatives += num(v)
      else mutants += num(v)
    } else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>
      mutants += num(o.mutants) + num(o.caught) + num(o.mutantsCaught)
      negatives += num(o.negatives) + num(o.planned) + num(o.negativeCases)
    }
  }
  // The house shape nests the proof under `verdict` (mutantsCaught / mutantsTotal)
  // with the negative count beside it — both are declarations by the record's
  // owner, so the lint reads them rather than asking the gate to restate them.
  const verdict = record.verdict
  if (verdict && typeof verdict === "object") {
    const o = verdict as Record<string, unknown>
    mutants += num(o.mutantsCaught) + num(o.mutants)
  }
  for (const listKey of ["checksList", "checks"]) {
    const list = record[listKey]
    if (!Array.isArray(list)) continue
    for (const c of list) {
      if (typeof c !== "string") continue
      if (/^(ok|FAIL):\s*M[::]/.test(c) || /^M[::]\s/.test(c)) mutants++
      else if (/\bnegative\b/i.test(c)) negatives++
    }
  }
  return { mutants, negatives }
}

export type ScriptInfo = {
  rel: string
  lane: string
  source: string
  runsChecks: boolean
  jsonLiterals: string[]
  /** Records the script WRITES (the literal is bound to a const passed to writeSealed, or sits inside the call). */
  writtenRecords: string[]
  envVars: string[]
}

/** Every lane script that runs checks or writes evidence, with its derived facts. */
export function scanLaneScripts(lanes: string[]): ScriptInfo[] {
  const out: ScriptInfo[] = []
  for (const lane of lanes) {
    const dir = path.join(ROOT, "script", lane)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir).sort()) {
      if (!/\.(ts|mts|js)$/.test(f)) continue
      const rel = `script/${lane}/${f}`
      const source = readFileSync(path.join(dir, f), "utf8")
      const runsChecks = /\bcheck\(/.test(source) || /writeSealed\(/.test(source)
      // Record filenames a gate names in its source — bare ("R3.json") or as a
      // path literal ("validation/m53/results/R3.json"). Compared by basename.
      const jsonLiterals = [...source.matchAll(/"([A-Za-z0-9._/-]+\.json)"/g)].map((m) => path.basename(m[1]))
      const envVars = [...new Set([...source.matchAll(/process\.env\.(BB_[A-Z0-9_]+)/g)].map((m) => m[1]))]
      // Which of those literals does this script actually WRITE? A reader must
      // never win attribution over a writer (that ambiguity is what orphaned
      // R2.json/R3.json). Two shapes cover the lane: a const bound to the
      // literal and passed to writeSealed, and a literal inside the call.
      // A write counts only when the expression clearly targets the results
      // tree (`validation/...` or a `RESULTS` const) — otherwise a screenshot
      // protocol writing its own out/<manifest.json> would be mistaken for the
      // milestone's ledger writer.
      const targetsResults = (expr: string) => /validation\/|RESULTS/.test(expr)
      const writtenRecords = new Set<string>()
      for (const m of source.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*([^\n]*"[A-Za-z0-9._/-]+\.json"[^\n]*)/g)) {
        if (!targetsResults(m[2])) continue
        const lit = m[2].match(/"([A-Za-z0-9._/-]+\.json)"/)
        if (lit && new RegExp(`writeSealed\\(\\s*${m[1]}\\b`).test(source)) writtenRecords.add(path.basename(lit[1]))
      }
      for (const m of source.matchAll(/writeSealed\(([^;]*?"[A-Za-z0-9._/-]+\.json"[^;]*?)\)/g)) {
        if (!targetsResults(m[1])) continue
        const lit = m[1].match(/"([A-Za-z0-9._/-]+\.json)"/)
        if (lit) writtenRecords.add(path.basename(lit[1]))
      }
      out.push({ rel, lane, source, runsChecks, jsonLiterals, writtenRecords: [...writtenRecords], envVars })
    }
  }
  return out
}

export type RecordInfo = { rel: string; lane: string; data: Record<string, unknown>; fileName: string; owner?: string }

export function loadLaneRecords(lanes: string[]): RecordInfo[] {
  const out: RecordInfo[] = []
  for (const lane of lanes) {
    const dir = path.join(ROOT, "validation", lane, "results")
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith(".json")) continue
      const rel = `validation/${lane}/results/${f}`
      let data: Record<string, unknown>
      try {
        data = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Record<string, unknown>
      } catch {
        continue // an unparseable record is reported by G3's parse census elsewhere
      }
      const cmd = typeof data.verifierCommand === "string" ? data.verifierCommand : undefined
      const owner = cmd ? cmd.replace(/^(npx tsx|bun run|node)\s+/, "").trim().split(/\s+/)[0] : undefined
      const isScript = !!owner && /\.(ts|mts|js)$/.test(owner)
      out.push({ rel, lane, data, fileName: f, owner: isScript ? owner : undefined })
    }
  }
  return out
}

/**
 * Attribution: a record belongs to the gate that names it, or to a lane script
 * whose source contains the record's filename as a literal (the `const OUT =
 * path.join(RESULTS, "X.json")` pattern). A record nobody claims is an orphan.
 */
export function attribute(records: RecordInfo[], scripts: ScriptInfo[], gatePaths: Set<string>): { groups: { gate: string; records: RecordInfo[] }[]; orphans: string[] } {
  const byGate = new Map<string, RecordInfo[]>()
  for (const g of gatePaths) byGate.set(g, [])
  const orphans: string[] = []
  for (const r of records) {
    let owner: string | undefined
    if (r.owner && gatePaths.has(r.owner)) owner = r.owner
    else {
      // A WRITER beats a mentioner; a bare mention is only attribution when it
      // is unique. Ambiguity is reported as an orphan (the writer must name
      // itself) rather than guessed.
      // Lane-aware: a lane's record can only be produced by a script of that
      // lane (a cross-lane link must be stated explicitly as verifierCommand,
      // as M44's U2.json does when it names the m26 webview harness). Without
      // this, "R3.json" collided between m29 and m53 and a writer stole a
      // record from another milestone entirely.
      const inLane = (s: ScriptInfo) => gatePaths.has(s.rel) && s.lane === r.lane
      const writers = scripts.filter((s) => inLane(s) && s.writtenRecords.includes(r.fileName))
      if (writers.length === 1) owner = writers[0].rel
      else {
        const mentions = scripts.filter((s) => inLane(s) && s.jsonLiterals.includes(r.fileName))
        if (mentions.length === 1) owner = mentions[0].rel
      }
    }
    if (owner) byGate.get(owner)!.push(r)
    else orphans.push(r.rel)
  }
  return { groups: [...byGate.entries()].map(([gate, recs]) => ({ gate, records: recs })), orphans }
}

/** Tier membership, machine-read from the declared sources. */
export function readTiers(reg: Registry): { name: string; commands: string[] }[] {
  const out: { name: string; commands: string[] }[] = []
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }
  for (const t of reg.tiers) {
    if (t.kind === "npm-script" && t.script) {
      const cmd = pkg.scripts[t.script] ?? ""
      out.push({ name: t.name, commands: cmd.split("&&").map((c) => c.trim()) })
    } else if (t.kind === "script-list" && t.source) {
      const src = readFileSync(path.join(ROOT, t.source), "utf8")
      const cmds = [...src.matchAll(/\[\s*"[^"]+",\s*"(script\/[^"]+\.(?:ts|mts|js))"\s*\]/g)].map((m) => m[1])
      out.push({ name: t.name, commands: cmds })
    }
  }
  return out
}

/** The gate a tier command names, or undefined for non-gate commands. */
export function commandGate(command: string): string | undefined {
  const m = command.match(/(script\/[^\s"']+\.(?:ts|mts|js))/)
  return m ? m[1] : undefined
}

/**
 * G7: STATIC IMPORT ORDER (issue #847, the TDZ bug class).
 *
 * The incident this memorializes: script/m29/verify-wave-execution.ts imported
 * its per-language relevance rule with a dynamic `import(...)` placed BELOW the
 * rule's first use. The ReferenceError landed in the staleness catch, so every
 * wave leg silently read stale — the gate lied by failing quietly.
 *
 * The shape is: a dynamic import whose specifier is a LANE module (a relative
 * path). Static imports are hoisted by ESM, so an `import` statement further
 * down a file is legal — it is NOT this class and is not flagged (flagging it
 * would drown the real signal in style noise, and a rule that cries wolf stops
 * being read). A dynamic import is NOT hoisted: it runs where it is written,
 * which is exactly how the incident's ReferenceError landed in the nearest
 * catch. The house convention is therefore STATIC imports for lane modules, and
 * the lint holds it.
 *
 * Deliberate non-relative dynamic imports (the mutant harnesses loading a
 * generated copy from a computed URL) are a different thing and are not flagged.
 *
 * Pure over (file, source) so the verifier can mutate it and feed doctored
 * sources as the can-fail proof.
 */
export function importOrderFindings(file: string, src: string): string[] {
  const out: string[] = []
  const lines = src.split("\n")
  const isComment = (l: string) => /^\s*(\/\/|\/\*|\*|#!)/.test(l)
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    if (isComment(l)) continue
    for (const m of l.matchAll(/\bimport\s*\(\s*["'`](\.\.?\/[^"'`]+)["'`]\s*\)/g)) {
      // A TYPE-position `typeof import("…")` is erased at compile time — it can
      // never throw at runtime, so it is not this class.
      if (/typeof\s+$/.test(l.slice(0, m.index ?? 0))) continue
      out.push(`${file}:${i + 1}: dynamic import of a lane module ("${m[1]}") — import it statically (the TDZ class)`)
    }
  }
  return out
}

/**
 * G8: THE RECORD MUST AGREE WITH THE RUN (issue #847's class, found in M61's own
 * gates).
 *
 * A gate that writes its evidence and THEN runs a check records counters that
 * are one check stale — the run says 34/34 while the record says 32/32. That is
 * a record that disagrees with its own run, which is the whole subject of this
 * milestone (M61.V1 shipped with it; M55.X1 had it; M61.V2 had a variant).
 *
 * The rule is deliberately mechanical: the LAST evidence write in a monitoring
 * script must not be followed by another check. Helper DEFINITIONS are ignored
 * (a `function <name>` declaration line is not a call), and non-gate scripts
 * (no evidence write at all) are not touched.
 */
export function recordAfterChecksFinding(file: string, src: string): string | null {
  const lines = src.split("\n")
  const isComment = (l: string) => /^\s*(\/\/|\/\*|\*|#!)/.test(l)
  const isDefinition = (l: string) => /\b(function|const|let|var)\s+(check|negative|mutant)\b/.test(l)
  let lastWrite = -1
  let lastCheck = -1
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    if (isComment(l)) continue
    if (!isDefinition(l) && /(?<![\w.])(?:writeSealed|writeFileSync)\s*\(/.test(l)) lastWrite = i
    if (isDefinition(l)) continue
    if (/(?<![\w.])(?:check|negative|mutant)\s*\(/.test(l)) lastCheck = i
  }
  if (lastWrite < 0) return null
  if (lastCheck > lastWrite) {
    return `${file}:${lastCheck + 1}: a check runs AFTER the last evidence write (line ${lastWrite + 1}) — the record can disagree with the run`
  }
  return null
}

// --- the lint --------------------------------------------------------------------

export type LintReport = {
  gateCount: number
  recordCount: number
  tiers: { name: string; gateCount: number }[]
  onDemandCount: number
  gates: {
    gate: string
    lane: string
    outputs: number
    sealed: boolean
    proof: { mutants: number; negatives: number }
    tiers: string[]
    envVars: string[]
  }[]
  failures: string[]
  orphanRecords: string[]
  artifactRecords: string[]
  declaredNonGates: string[]
  declaredNoCanFail: string[]
}

export function lint(reg: Registry): LintReport {
  const failures: string[] = []
  const scripts = scanLaneScripts(reg.lanes)
  const records = loadLaneRecords(reg.lanes)
  const nonGatePaths = new Set(reg.declaredNonGates.map((d) => d.path))
  // Declared measurement artifacts: records a declared runner produces that are
  // NOT a gate verdict (their verdict record is the companion *-verify.json).
  const artifactPaths = new Set((reg.declaredArtifactRecords ?? []).map((d) => d.record))
  const tiers = readTiers(reg)

  // G1: the gate census. Uniform rule with no heuristics: a lane script that
  // runs checks is either a GATE (it owns >= 1 lane record) or it is DECLARED
  // a non-gate with a reason. Anything else is a gate that produces no
  // evidence; a declared non-gate that owns a record means the declaration is
  // hiding a real gate.
  //
  // Ownership is the ATTRIBUTED set (owner named, else the unique writer), not
  // merely the scripts a record names — a gate that writes its record without
  // naming itself in it is still a gate.
  const candidateGates = new Set(scripts.filter((s) => s.runsChecks && !nonGatePaths.has(s.rel)).map((s) => s.rel))
  const gatePaths = new Set([...records.map((r) => r.owner).filter((o): o is string => !!o), ...candidateGates])
  const ownerOf = new Map<string, number>()
  for (const g of attribute(records, scripts, gatePaths).groups) ownerOf.set(g.gate, g.records.length)
  for (const s of scripts) {
    if (!s.runsChecks) continue
    const owns = (ownerOf.get(s.rel) ?? 0) > 0
    const declared = nonGatePaths.has(s.rel)
    if (owns && declared) failures.push(`G1: ${s.rel} is declared a non-gate but OWNS a record — the declaration hides a real gate`)
    if (!owns && !declared) failures.push(`G1: ${s.rel} runs checks but owns no lane record and is not declared a non-gate`)
  }
  for (const p of nonGatePaths) {
    const s = scripts.find((x) => x.rel === p)
    if (!s) {
      failures.push(`G1: declared non-gate ${p} does not exist`)
      continue
    }
    // A declaration cannot hide a gate: if a declared non-gate WRITES a record
    // that exists on disk and is NOT a declared measurement artifact, it is
    // producing evidence and must be declared a gate.
    const produced = records.find((r) => r.lane === s.lane && s.writtenRecords.includes(r.fileName))
    if (produced && !artifactPaths.has(produced.rel)) {
      failures.push(`G1: declared non-gate ${p} WRITES ${produced.rel} — the declaration hides a real gate`)
    }
  }

  // G2: every record is attributable (derived from the one attribution pass,
  // so a mutant on `attribute` manifests here). A record that is NOT gate
  // evidence (a milestone manifest, a publisher artifact) must be declared an
  // artifact with a reason — and an artifact that turns out to be a gate's
  // output fails, so the declaration cannot absorb real evidence.
  const { groups: attributed, orphans: orphanRecords } = attribute(records, scripts, gatePaths)
  const artifactRecords = artifactPaths
  const claimedByGate = new Set(attributed.flatMap((g) => g.records.map((r) => r.rel)))
  for (const o of orphanRecords) {
    if (!artifactRecords.has(o)) failures.push(`G2: ${o} is an orphan record — no gate claims it (its writer must name itself, or declare it an artifact with a reason)`)
  }
  for (const a of artifactRecords) {
    if (claimedByGate.has(a)) failures.push(`G2: ${a} is declared an artifact but a GATE outputs it — the declaration absorbs real evidence`)
    if (!records.some((r) => r.rel === a)) failures.push(`G2: declared artifact ${a} does not exist`)
  }

  const legacy = new Set(reg.declaredLegacyUnsealed.map((d) => d.record))
  const noCanFail = new Set(reg.declaredNoCanFail.map((d) => d.gate))
  const declaredEnv = new Map((reg.declaredEnv ?? []).map((d) => [d.name, d.role]))
  const onDemand = new Set((reg.declaredOnDemand ?? []).map((d) => d.gate))
  const tierOf = new Map<string, string[]>()
  for (const t of tiers) {
    for (const c of t.commands) {
      const g = commandGate(c)
      if (!g) continue
      tierOf.set(g, [...(tierOf.get(g) ?? []), t.name])
    }
  }

  // G7: static import order. A lane gate that imports a lane module dynamically
  // below its first use is the TDZ class (#847): the failure lands in whatever
  // catch is nearest and the gate reads stale instead of failing.
  for (const s of scripts) {
    for (const f of importOrderFindings(s.rel, s.source)) failures.push(`G7: ${f}`)
  }
  // G8: the record must agree with the run — no check after the last write.
  for (const s of scripts) {
    const f = recordAfterChecksFinding(s.rel, s.source)
    if (f) failures.push(`G8: ${f}`)
  }

  const gates: LintReport["gates"] = []
  for (const { gate, records: recs } of attributed) {
    const script = scripts.find((s) => s.rel === gate)
    const lane = gate.split("/")[1]
    const sealed = recs.length > 0 && recs.every((r) => isSealed(r.data) || legacy.has(r.rel))
    let mutants = 0
    let negatives = 0
    for (const r of recs) {
      const p = canFailProofs(r.data)
      mutants += p.mutants
      negatives += p.negatives
    }
    const proof = { mutants, negatives }
    const gateTiers = tierOf.get(gate) ?? []
    gates.push({
      gate,
      lane,
      outputs: recs.length,
      sealed,
      proof,
      tiers: gateTiers,
      envVars: script?.envVars ?? [],
    })

    // G3
    if (recs.length === 0) failures.push(`G3: ${gate} owns no lane record — it produces no evidence`)
    for (const r of recs) {
      if (!isSealed(r.data) && !legacy.has(r.rel)) failures.push(`G3: ${gate} record ${r.rel} is UNSEALED`)
    }
    // G4
    const total = proof.mutants + proof.negatives
    if (total >= reg.canFailFloor && noCanFail.has(gate)) {
      failures.push(`G4: ${gate} is declared without a can-fail proof but carries ${total} — stale declaration`)
    }
    if (total < reg.canFailFloor && !noCanFail.has(gate)) {
      failures.push(`G4: ${gate} carries ${total} can-fail proofs (< floor ${reg.canFailFloor}) and is not declared in declaredNoCanFail`)
    }
    // G5: D-4 requires every gate to be declared in exactly one execution tier
    // (CI fast / full / lane / ON-DEMAND). On-demand is a declared tier, but a
    // declaration is not a hiding place: each entry carries a reason, a declared
    // on-demand gate that IS in an automated tier is stale, and the census
    // reports the on-demand set so the residue stays countable.
    if (script && script.runsChecks && gateTiers.length === 0) {
      if (onDemand.has(gate)) {
        gateTiers.push("on-demand")
      } else {
        failures.push(`G5: ${gate} is wired into NO execution tier and is not declared in declaredOnDemand with a reason`)
      }
    } else if (onDemand.has(gate) && gateTiers.length > 0) {
      failures.push(`G5: ${gate} is declared on-demand but runs in ${gateTiers.join(", ")} — stale declaration`)
    }
    // G6: no folklore — every BB_* env var a gate reads is declared with its
    // role (skip mode vs data input), so a skip switch can never appear silently.
    for (const m of script?.envVars ?? []) {
      if (!declaredEnv.has(m)) failures.push(`G6: ${gate} reads undeclared env var ${m} (declare it in declaredEnv with its role)`)
    }
  }

  // G5 invariant: the fast tier must be a strict subset of the full tier.
  const fast = tiers.find((t) => t.name === "verify:fast")
  const full = tiers.find((t) => t.name === "verify")
  if (fast && full) {
    const fullSet = new Set(full.commands.map(commandGate).filter(Boolean))
    const missing = fast.commands.map(commandGate).filter((g): g is string => !!g && !fullSet.has(g))
    if (missing.length > 0) failures.push(`G5: verify:fast is not a subset of verify — missing from verify: ${missing.join(", ")}`)
  }

  return {
    gateCount: gates.length,
    recordCount: records.length,
    artifactRecords: [...artifactRecords],
    onDemandCount: gates.filter((g) => g.tiers.includes("on-demand")).length,
    tiers: tiers.map((t) => ({ name: t.name, gateCount: t.commands.map(commandGate).filter(Boolean).length })),
    gates: gates.sort((a, b) => a.gate.localeCompare(b.gate)),
    failures,
    orphanRecords,
    declaredNonGates: [...nonGatePaths],
    declaredNoCanFail: [...noCanFail],
  }
}
