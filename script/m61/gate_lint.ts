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
  declaredEnv: { name: string; role: "skip" | "input"; reason: string }[]
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
  for (const k of declaredKeys) {
    const v = record[k]
    if (typeof v === "number") {
      if (k === "negatives" || k === "negativeCases") negatives += v
      else mutants += v
    } else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>
      if (typeof o.mutants === "number") mutants += o.mutants
      if (typeof o.negatives === "number") negatives += o.negatives
    }
  }
  const list = record.checksList
  if (Array.isArray(list)) {
    for (const c of list) {
      if (typeof c !== "string") continue
      if (/^(ok|FAIL):\s*M[::]/.test(c)) mutants++
      else if (/\bnegative\b/i.test(c)) negatives++
    }
  }
  return { mutants, negatives }
}

export type ScriptInfo = { rel: string; lane: string; source: string; runsChecks: boolean; jsonLiterals: string[]; envVars: string[] }

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
      out.push({ rel, lane, source, runsChecks, jsonLiterals, envVars })
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
      const candidates = scripts.filter((s) => gatePaths.has(s.rel) && s.jsonLiterals.includes(r.fileName))
      // Exactly one candidate is attribution; more than one is ambiguity, which
      // is reported as an orphan to be fixed (the writer must name itself).
      if (candidates.length === 1) owner = candidates[0].rel
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

// --- the lint --------------------------------------------------------------------

export type LintReport = {
  gateCount: number
  recordCount: number
  tiers: { name: string; gateCount: number }[]
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
  declaredNonGates: string[]
  declaredNoCanFail: string[]
}

export function lint(reg: Registry): LintReport {
  const failures: string[] = []
  const scripts = scanLaneScripts(reg.lanes)
  const records = loadLaneRecords(reg.lanes)
  const nonGatePaths = new Set(reg.declaredNonGates.map((d) => d.path))
  const tiers = readTiers(reg)

  // G1: the gate census. Uniform rule with no heuristics: a lane script that
  // runs checks is either a GATE (it owns >= 1 lane record) or it is DECLARED
  // a non-gate with a reason. Anything else is a gate that produces no
  // evidence; a declared non-gate that owns a record means the declaration is
  // hiding a real gate.
  const namedByRecord = new Set(records.map((r) => r.owner).filter((o): o is string => !!o))
  const gatePaths = new Set(namedByRecord)
  for (const s of scripts) {
    if (!s.runsChecks) continue
    const owns = namedByRecord.has(s.rel)
    const declared = nonGatePaths.has(s.rel)
    if (owns && declared) failures.push(`G1: ${s.rel} is declared a non-gate but OWNS a record — the declaration hides a real gate`)
    if (!owns && !declared) failures.push(`G1: ${s.rel} runs checks but owns no lane record and is not declared a non-gate`)
  }
  for (const p of nonGatePaths) {
    if (!scripts.some((x) => x.rel === p)) failures.push(`G1: declared non-gate ${p} does not exist`)
  }

  // G2: every record is attributable (derived from the one attribution pass,
  // so a mutant on `attribute` manifests here).
  const { groups: attributed, orphans: orphanRecords } = attribute(records, scripts, gatePaths)
  for (const o of orphanRecords) failures.push(`G2: ${o} is an orphan record — no gate claims it (its writer must name itself)`)

  const legacy = new Set(reg.declaredLegacyUnsealed.map((d) => d.record))
  const noCanFail = new Set(reg.declaredNoCanFail.map((d) => d.gate))
  const declaredEnv = new Map((reg.declaredEnv ?? []).map((d) => [d.name, d.role]))
  const tierOf = new Map<string, string[]>()
  for (const t of tiers) {
    for (const c of t.commands) {
      const g = commandGate(c)
      if (!g) continue
      tierOf.set(g, [...(tierOf.get(g) ?? []), t.name])
    }
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
    // G5
    if (script && script.runsChecks && gateTiers.length === 0) failures.push(`G5: ${gate} is wired into NO execution tier`)
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
    tiers: tiers.map((t) => ({ name: t.name, gateCount: t.commands.map(commandGate).filter(Boolean).length })),
    gates: gates.sort((a, b) => a.gate.localeCompare(b.gate)),
    failures,
    orphanRecords,
    declaredNonGates: [...nonGatePaths],
    declaredNoCanFail: [...noCanFail],
  }
}
