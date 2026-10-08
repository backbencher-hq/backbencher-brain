#!/usr/bin/env tsx
// script/m62/reseal-ledger.ts — bring a SEALED LEDGER's rows back into line with
// the evidence they summarise, and re-seal with a stated reason.
//
// THE PROBLEM THIS SOLVES, MEASURED 2026-10-08.
//
// `validation/m27/results/manifest.json` is a ledger: one row per issue, each
// recording a `status`. Those rows are supposed to track the sealed evidence file
// beside them. They drift, because a gate re-run rewrites its evidence and the
// ledger is a separate committed artefact nobody re-derives:
//
//   H1.json          status = "verified"    (the gate is green)
//   manifest.json    H1 status = "known-gap" (the ledger never caught up)
//
// and the closure gate's completion bar reads the LEDGER, so it reports a leg as
// unproven that is in fact proven:
//
//   FAIL: X1: v3 completion bar audited item-by-item — zero violations
//         — bar1: an adapter leg is neither verified nor blocked
//
// WHY THE SEAL DOES NOT BLOCK THIS. `bbSeal` exists to catch a record whose bytes
// moved WITHOUT its content moving — hand-edits and forgery. It is not meant to
// make a ledger impossible to correct. `script/lib/evidence.ts` already ships the
// sanctioned repair: `refreshStaleSeal(filePath, why)`, which refuses when the seal
// already verifies, refuses an empty reason, and writes under the directory lock.
//
// A NOTE ON AN EARLIER, WRONG CLAIM. A previous note in
// docs/M26-OUTGOING-CALLS-PERF.md said the repo had "no sanctioned way to
// re-seal". That was wrong: it was written after grepping for `sealFor` and
// missing `refreshStaleSeal` and `writeSealed`, both of which exist. The
// correction is recorded in the commit that adds this tool.
//
// WHAT IT REFUSES TO DO — the whole safety argument:
//   - it never invents a status. A row's status is copied from its evidence file
//     and only when that file's OWN SEAL VERIFIES. Tampered evidence therefore
//     cannot promote a row, because a tampered file is not read.
//   - it never touches a row with no evidence file.
//   - it never changes anything else about the row — only `status`, and only
//     where it disagrees with the evidence.
//   - every change is printed with the before/after and the evidence path it came
//     from, so a run is reviewable line by line.
//
// Usage:
//   npx tsx script/m62/reseal-ledger.ts <ledger.json> [--apply] [--dry-run]
//   (default is a dry run; --apply writes)

import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { refreshStaleSeal, verifySeal } from "../lib/evidence.ts"

interface Row {
  code?: string
  status?: string
  evidence?: { status?: string; blockedReason?: string; blockedLegs?: unknown[] }
  [k: string]: unknown
}

export interface Change {
  code: string
  field: string
  from: string
  to: string
  evidenceFile: string
}

export interface RefreshOutcome {
  changed: Change[]
  /** Rows whose evidence exists but whose status already agrees. */
  agreed: string[]
  /** Rows with no evidence file beside them — reported, never invented. */
  noEvidence: string[]
  /** Evidence files that failed their own seal. A tampered file must NOT promote. */
  tampered: string[]
}

/** Find every `{ code, status }`-shaped row, at any depth. */
function collectRows(node: unknown, out: Row[] = []): Row[] {
  if (Array.isArray(node)) {
    for (const v of node) collectRows(v, out)
  } else if (node !== null && typeof node === "object") {
    const o = node as Row
    if (typeof o.code === "string") out.push(o)
    for (const v of Object.values(o)) collectRows(v, out)
  }
  return out
}

/** The status a row's evidence actually proves — or null when it proves nothing. */
function evidencedStatus(row: Row, resultsDir: string): { status: string | null; file: string; tampered: boolean } {
  if (typeof row.code !== "string") return { status: null, file: "", tampered: false }
  const file = path.join(resultsDir, `${row.code}.json`)
  if (!existsSync(file)) return { status: null, file, tampered: false }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"))
  } catch {
    return { status: null, file, tampered: true }
  }
  // A file whose own seal does not verify is not evidence. This is the line that
  // stops a hand-edited H1.json from promoting a row.
  const verdict = verifySeal(parsed)
  if (!verdict.ok) return { status: null, file, tampered: true }
  const status = typeof parsed["status"] === "string" ? (parsed["status"] as string) : null
  return { status, file, tampered: false }
}

/**
 * Compute the changes without writing anything. Pure, so the gate can call it and
 * compare against a real run.
 */
export function planRefresh(ledger: Record<string, unknown>, resultsDir: string): RefreshOutcome {
  const rows = collectRows(ledger)
  const changed: Change[] = []
  const agreed: string[] = []
  const noEvidence: string[] = []
  const tampered: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const code = row.code as string
    if (seen.has(code)) continue
    seen.add(code)
    const ev = evidencedStatus(row, resultsDir)
    if (ev.tampered) {
      tampered.push(`${code} (${path.basename(ev.file)})`)
      continue
    }
    if (ev.status === null) {
      noEvidence.push(code)
      continue
    }
    const current = row.evidence?.status ?? row.status
    if (current === ev.status) {
      agreed.push(code)
      continue
    }
    // Only the nested evidence.status is written. The row's own `status` is the
    // ledger's lifecycle claim and is left alone — a gate owns that.
    if (row.evidence !== undefined && typeof row.evidence === "object") {
      changed.push({ code, field: "evidence.status", from: String(current), to: ev.status, evidenceFile: ev.file })
    } else {
      changed.push({ code, field: "status", from: String(current), to: ev.status, evidenceFile: ev.file })
    }
  }
  return { changed, agreed, noEvidence, tampered }
}

/** Write the plan and re-seal with a stated reason. */
export function applyRefresh(
  ledgerPath: string,
  ledger: Record<string, unknown>,
  resultsDir: string,
  why: string,
): { ok: boolean; reason: string; applied: Change[] } {
  const outcome = planRefresh(ledger, resultsDir)
  // THE REFUSAL LIVES HERE, NOT IN THE CLI. It was originally in main(), which
  // meant the library could promote a row from tampered evidence and only the
  // command-line wrapper stopped it — so any other caller got the unsafe version.
  // A safety property that lives in the caller is not a property of the code.
  if (outcome.tampered.length > 0) {
    return {
      ok: false,
      reason: `refusing to write: ${outcome.tampered.length} evidence file(s) failed their own seal (${outcome.tampered.join(", ")})`,
      applied: [],
    }
  }
  if (outcome.changed.length === 0) return { ok: true, reason: "nothing to refresh", applied: [] }
  const rows = collectRows(ledger)
  const byCode = new Map<string, Row>()
  for (const r of rows) if (typeof r.code === "string" && !byCode.has(r.code)) byCode.set(r.code, r)
  for (const c of outcome.changed) {
    const row = byCode.get(c.code)
    if (!row) continue
    if (c.field === "evidence.status" && row.evidence !== undefined) {
      ;(row.evidence as { status?: string }).status = c.to
    } else {
      row.status = c.to
    }
  }
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`)
  const seal = refreshStaleSeal(ledgerPath, why)
  if (!seal.ok) return { ok: false, reason: seal.reason, applied: outcome.changed }
  return { ok: true, reason: `re-sealed ${seal.oldDigest.slice(0, 12)} → ${seal.newDigest.slice(0, 12)}`, applied: outcome.changed }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const ledgerPath = args.find((a) => !a.startsWith("--")) ?? "validation/m27/results/manifest.json"
  const apply = args.includes("--apply")
  if (!existsSync(ledgerPath)) {
    console.error(`  no such ledger: ${ledgerPath}`)
    process.exit(1)
  }
  const resultsDir = path.dirname(ledgerPath)
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8")) as Record<string, unknown>
  const outcome = planRefresh(ledger, resultsDir)

  console.log(`\nLEDGER REFRESH — ${ledgerPath}\n`)
  if (outcome.changed.length === 0) {
    console.log(`  no row disagrees with its evidence (${outcome.agreed.length} rows checked)`)
  } else {
    console.log(`  ${outcome.changed.length} row(s) disagree with their evidence:\n`)
    for (const c of outcome.changed) {
      console.log(`    ${c.code.padEnd(6)} ${c.field.padEnd(16)} ${c.from}  ->  ${c.to}`)
      console.log(`           from ${path.relative(process.cwd(), c.evidenceFile)}`)
    }
  }
  if (outcome.noEvidence.length > 0) {
    console.log(`\n  ${outcome.noEvidence.length} row(s) have no evidence file (left alone, never invented):`)
    console.log(`    ${outcome.noEvidence.join(", ")}`)
  }
  if (outcome.tampered.length > 0) {
    console.log(`\n  ${outcome.tampered.length} evidence file(s) FAILED their own seal — refused as evidence:`)
    console.log(`    ${outcome.tampered.join(", ")}`)
  }

  if (!apply) {
    console.log(`\n  dry run — nothing written. Re-run with --apply to write and re-seal.\n`)
    return
  }
  if (outcome.tampered.length > 0) {
    console.error(`\n  REFUSING to write: tampered evidence would otherwise promote a row.\n`)
    process.exit(1)
  }
  const why = `ledger rows re-derived from their sealed evidence files: ${outcome.changed
    .map((c) => `${c.code} ${c.field} ${c.from}->${c.to}`)
    .join("; ")}`
  const res = applyRefresh(ledgerPath, ledger, resultsDir, why)
  if (!res.ok) {
    console.error(`\n  FAILED: ${res.reason}\n`)
    process.exit(1)
  }
  console.log(`\n  applied ${res.applied.length} change(s); ${res.reason}`)
  console.log(`  reason recorded on the ledger: ledger rows re-derived from their sealed evidence\n`)
}

// Compare REALPATHS, not the raw strings. On macOS /tmp is a symlink to
// /private/tmp, so `process.argv[1]` and `import.meta.url` name the same file by
// two different paths and a plain string compare silently skips main() — the tool
// then runs, writes nothing, prints nothing, and exits 0. A tool that can no-op
// without saying so is the exact defect class this repo keeps having to undo.
function isEntry(): boolean {
  const arg = process.argv[1]
  if (arg === undefined) return false
  try {
    // fileURLToPath, NOT new URL(...).pathname: this repo lives under a path
    // with a SPACE in it ("Default Project"), and pathname percent-encodes it,
    // so the two sides would never compare equal.
    return realpathSync(arg) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntry()) {
  await main()
}