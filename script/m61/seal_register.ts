// script/m61/seal_register.ts — the ONE owner of the seal-refresh register.
//
// WHY THIS MODULE EXISTS. validation/m61/seal-refresh-register.json records, per
// file, the seal digest that is CURRENT — and script/m61/verify-seal-audit.ts
// (M61.A1, check A4) fails when any row names a digest the file no longer
// carries. That makes the register a claim with an owner: whoever reseals a
// registered file must MOVE its row, or the next audit is red and a reader is
// told the seal was refreshed when the bytes on disk say otherwise. Measured
// three times on 2026-10-17: every run of a lane's own ledger sync (now that
// those syncs write through writeSealed) moved the digest out from under the
// row, and A1 went KNOWN-GAP until the row was moved by hand. A repair that
// leaves a manual re-record step is not a repair.
//
// So the movement is code: a writer that seals a registered path calls
// `reRecordRegisterRow` immediately after, and the row moves with the seal it
// names — the same act `script/m61/refresh-stale-seals.ts --re-record`
// performs for a file that was sealed by something that did not know about this
// register. Both go through this module, so there is still one rule, one
// coalescing step, and one purpose string (M61's one-owner convention).
//
// ONE ROW PER PATH is a correctness requirement, not tidiness: A4 checks EVERY
// row against the file it names, so a second refresh of the same file cannot be
// appended — the older row would instantly be a false claim about the current
// bytes. History lives in the row's `why`; the claim lives once.

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { SEAL_KEY, readEvidence } from "../lib/evidence.ts"
import { withLock } from "../lib/lock.ts"

export const SEAL_REGISTER_REL = "validation/m61/seal-refresh-register.json"

export const REGISTER_PURPOSE =
  "M61 stale-seal refreshes: every record whose bbSeal envelope had to be recomputed because a producer rewrote its content after sealing. A row here is the written reason for that refresh — old digest, new digest, why, when. Written only by script/m61/refresh-stale-seals.ts and script/m61/seal_register.ts, and CHECKED by script/m61/verify-seal-audit.ts (each row's newDigest must equal the file's current seal, so the register cannot outlive the fact it records)."

export interface RegisterEntry {
  path: string
  oldDigest: string
  newDigest: string
  why: string
  at: string
  tool: string
  /** false = the record was re-serialized canonically beyond its envelope (measured). */
  envelopeOnly: boolean
}

export function resolveRegisterPath(root: string, registerRel = SEAL_REGISTER_REL): string {
  const arg = process.env.BB_SEAL_REGISTER ?? registerRel
  // An ABSOLUTE --register must stay absolute: `path.join(ROOT, "/tmp/x.json")`
  // silently becomes `<root>/tmp/x.json` and the write dies with ENOENT (found by
  // probing the tool on a record copied out of the repo, 2026-10-07).
  return path.isAbsolute(arg) ? arg : path.join(root, arg)
}

export function readRegister(registerPath: string): RegisterEntry[] {
  if (!existsSync(registerPath)) return []
  try {
    return (JSON.parse(readFileSync(registerPath, "utf8")) as { entries?: RegisterEntry[] }).entries ?? []
  } catch {
    return []
  }
}

/** Fold duplicate rows for one path (see ONE ROW PER PATH above). */
export function coalesceRows(rows: RegisterEntry[]): RegisterEntry[] {
  const byPath = new Map<string, RegisterEntry>()
  for (const row of rows) {
    const previous = byPath.get(row.path)
    byPath.set(
      row.path,
      previous === undefined
        ? { ...row }
        : {
            ...row,
            oldDigest: previous.newDigest,
            why: `${previous.why.trim()} | ${row.why.trim()}`,
            envelopeOnly: previous.envelopeOnly && row.envelopeOnly,
          },
    )
  }
  return [...byPath.values()]
}

export function writeRegister(registerPath: string, rows: RegisterEntry[]): RegisterEntry[] {
  const all = coalesceRows(rows)
  const content = `${JSON.stringify({ schemaVersion: 1, purpose: REGISTER_PURPOSE, entries: all }, null, 2)}\n`
  // M61.V2's L4 rule: an evidence-shaped write goes through the declared lock.
  // The register is a read-modify-write of ONE file shared by every sealing
  // tool, so two concurrent refreshes could otherwise interleave and lose a
  // row (the same clobber class L3 proves impossible for evidence records).
  // writeSealed cannot be used here: the register is the seal bookkeeping, not
  // a sealed record — sealing it would make it its own subject.
  withLock(path.dirname(registerPath), () => {
    writeFileSync(registerPath, content)
  })
  return all
}

export type ReRecordResult =
  | { ok: true; path: string; oldDigest: string; newDigest: string }
  | { ok: false; path: string; reason: string; kind: "no-row" | "unsealed" | "unverifiable" | "unchanged" }

/**
 * Move the register row for a file this caller just SEALED.
 *
 * Refuses, rather than guesses: a path with no row is not a registered file, a
 * file whose seal does not verify is not this function's to bless (that is the
 * stale-seal path in refresh-stale-seals.ts), and a row that already names the
 * current digest needs nothing.
 */
export function reRecordRegisterRow(
  root: string,
  relPath: string,
  why: string,
  options: { registerPath?: string; tool?: string } = {},
): ReRecordResult {
  const registerPath = options.registerPath ?? resolveRegisterPath(root)
  const rel = path.isAbsolute(relPath) ? path.relative(root, relPath) : relPath
  const file = path.isAbsolute(relPath) ? relPath : path.join(root, relPath)
  const rows = readRegister(registerPath)
  const index = rows.findIndex((r) => r.path === rel)
  if (index === -1) return { ok: false, path: rel, reason: "no register row for this file", kind: "no-row" }
  if (!existsSync(file)) return { ok: false, path: rel, reason: "file does not exist", kind: "no-row" }
  const record = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
  const seal = record[SEAL_KEY] as { contentSha256?: string } | undefined
  if (!seal || typeof seal.contentSha256 !== "string") return { ok: false, path: rel, reason: "the file carries no seal", kind: "unsealed" }
  const verified = readEvidence<Record<string, unknown>>(file)
  if (!verified.ok) return { ok: false, path: rel, reason: `the seal does not verify: ${verified.reason}`, kind: "unverifiable" }
  const row = rows[index]!
  if (row.newDigest === seal.contentSha256) return { ok: false, path: rel, reason: "the row already names the current seal", kind: "unchanged" }
  const moved: RegisterEntry = {
    path: rel,
    oldDigest: row.newDigest,
    newDigest: seal.contentSha256,
    why: `${row.why.trim()} | ${why.trim()}`,
    at: new Date().toISOString(),
    tool: options.tool ?? "script/m61/seal_register.ts (reRecordRegisterRow)",
    envelopeOnly: row.envelopeOnly,
  }
  rows[index] = moved
  writeRegister(registerPath, rows)
  return { ok: true, path: rel, oldDigest: moved.oldDigest, newDigest: moved.newDigest }
}
