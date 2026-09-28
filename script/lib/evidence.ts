// script/lib/evidence.ts — M61.V1 (issue #842): the ONE evidence write/read
// path for the IDE lane.
//
// The defect this pins: evidence JSONs are written by scattered
// writeFileSync(JSON.stringify(...)) calls and read by bare JSON.parse. No
// record carries a content hash, so a clobbered, hand-edited, or half-written
// record is believed by every downstream gate (audited at HEAD eec76d37:
// 690 evidence records, 0 sealed; 34 files written by 2+ distinct gates).
//
// The law (docs/m61/M61-MASTER-PLAN.md D-1):
//   seal at write:  every record written through writeSealed() carries a
//                   `bbSeal` envelope { alg, sealedAt, contentSha256 } — the
//                   sha256 of the record's canonical content (see M2 below).
//   trusted read:   readEvidence() verifies seal-vs-content before returning.
//                   Tampered/clobbered/unsealed records are refused with the
//                   reason (never silent, never coerced).
//   re-stamps:      a legitimate gate re-run rewrites `generatedAt` /
//                   `currentCommit` and produces a NEW valid seal. Seals
//                   verify INTEGRITY (this record is exactly what its writer
//                   sealed), not freshness — freshness stays the relevance
//                   rule's job (M29's analyzer-relevance law).
//   migration:      records written before M61 are unsealed. sealLegacyFile()
//                   seals them in place, preserving every field of the
//                   original record (D-1's one-shot migration). Gates in the
//                   transition window read legacy records with
//                   readEvidenceAllowingLegacy() and FAIL on unsealed records
//                   that were written AFTER the window opened — WARN/FAIL on
//                   the right side, never the reverse, never silent.
//
// Import-time purity (the M55 lesson): this module runs NOTHING at import —
// it only exports functions. Gates call them explicitly.

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import { type AcquireOptions, withLock } from "./lock.ts"

/** The seal envelope carried in every sealed record under the key `bbSeal`. */
export interface EvidenceSeal {
  alg: "sha256"
  sealedAt: string
  /** sha256 hex digest of the record's canonical content (M2). */
  contentSha256: string
}

export const SEAL_KEY = "bbSeal"

/** The discriminated result of a trusted read — never throws for expected
 *  tamper states; the caller decides how loudly to fail. */
export type EvidenceRead<T> =
  | { ok: true; record: T; seal: EvidenceSeal }
  | { ok: false; reason: string; kind: "missing" | "unparseable" | "unsealed" | "tampered" | "bad-seal" }

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex")
}

/** M2 — the sealed content is the record's canonical JSON WITHOUT the seal
 *  key itself, computed on the STRING form so verification recomputes exactly
 *  what the writer sealed, independent of the file's whitespace/key order. */
/**
 * M61.V4 (D-4): a gate's can-fail declaration, derived from its OWN check
 * list rather than restated by hand. The house conventions name a mutant
 * check `M: <name>` and a negative case with "negative"; the gate passes the
 * same list it already accumulates, so the record can never disagree with the
 * run (the count is computed at write time from the checks themselves).
 */
export function canFailFromChecks(checks: string[]): { mutants: number; negatives: number } {
  let mutants = 0
  let negatives = 0
  for (const c of checks) {
    if (/^(ok|FAIL):\s*M[::]/.test(c)) mutants++
    else if (/\bnegative\b/i.test(c)) negatives++
  }
  return { mutants, negatives }
}

/**
 * Canonical key order for a record VALUE: object keys are sorted recursively,
 * arrays keep their order (arrays carry meaning; object key order does not).
 *
 * Why this is not cosmetic: an evidence file's BYTES are inputs of drift gates
 * (the M29 precision ledger hashes its inputs' semantic content), and one of
 * our producers hands us data that passed through a Lua table
 * (script/m29/wave-editor-driver.lua → vim.json.encode), whose key order is
 * arbitrary per run. A record whose bytes differ every run for no semantic
 * reason makes every artifact that hashes it un-drift-gatable — found at HEAD
 * e596a107, where the S6 evidence's shuffled `raw` payloads were the only thing
 * keeping the M29 ledger from reaching a byte-identical fixpoint. Fixed at the
 * producer (the S6 record is canonicalized before it is sealed), with the
 * helper owned here so every producer shares one rule.
 */
export function canonicalizeKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => canonicalizeKeys(v)) as unknown as T
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = canonicalizeKeys((value as Record<string, unknown>)[k])
    }
    return out as unknown as T
  }
  return value
}

export function sealedContent(record: Record<string, unknown>): string {
  const { [SEAL_KEY]: _omit, ...rest } = record
  return JSON.stringify(rest)
}

/** The seal for a record: sha256 over the canonical content (M2). */
export function sealFor(record: Record<string, unknown>, now = new Date()): EvidenceSeal {
  return {
    alg: "sha256",
    sealedAt: now.toISOString(),
    contentSha256: sha256Hex(sealedContent(record)),
  }
}

/** Verify a record's seal. Returns the precise failure reason on mismatch. */
export function verifySeal(
  record: Record<string, unknown>,
): { ok: true; seal: EvidenceSeal } | { ok: false; reason: string; kind: "unsealed" | "tampered" | "bad-seal" } {
  const raw = record[SEAL_KEY]
  if (raw === undefined) {
    return {
      ok: false,
      reason: `record carries no ${SEAL_KEY} seal (written before M61 or through a bypass)`,
      kind: "unsealed",
    }
  }
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, reason: `the ${SEAL_KEY} envelope is not an object`, kind: "bad-seal" }
  }
  const seal = raw as Partial<EvidenceSeal>
  if (seal.alg !== "sha256" || typeof seal.contentSha256 !== "string" || !/^[0-9a-f]{64}$/.test(seal.contentSha256)) {
    return {
      ok: false,
      reason: `the ${SEAL_KEY} envelope is malformed (alg must be "sha256", contentSha256 must be a 64-hex-char digest)`,
      kind: "bad-seal",
    }
  }
  const actual = sha256Hex(sealedContent(record))
  if (actual !== seal.contentSha256) {
    return {
      ok: false,
      reason: `seal mismatch: content sha256 ${actual} != sealed ${seal.contentSha256} — the record changed after sealing`,
      kind: "tampered",
    }
  }
  return { ok: true, seal: seal as EvidenceSeal }
}

/** The ONE write path: seal the record, then write atomically (temp file +
 *  rename in the same directory, so a crash never leaves a half-written
 *  record at the target path) UNDER THE DIR LOCK (M61.V2, D-2) so two gates
 *  can never interleave writes in one results dir. Returns the seal that was
 *  written. `now` is injectable for deterministic tests; `lock` carries the
 *  bounded-wait options (a contended dir refuses loudly instead of writing). */
export function writeSealed(
  filePath: string,
  record: Record<string, unknown>,
  now = new Date(),
  lock: AcquireOptions = {},
): EvidenceSeal {
  const seal = sealFor(record, now)
  const sealed: Record<string, unknown> = { ...record, [SEAL_KEY]: seal }
  const content = `${JSON.stringify(sealed, null, 2)}\n`
  const dir = path.dirname(filePath)
  mkdirSync(dir, { recursive: true })
  return withLock(dir, () => {
    const tmp = `${filePath}.tmp-${process.pid}`
    writeFileSync(tmp, content)
    renameSync(tmp, filePath)
    return seal
  }, lock)
}

/** The ONE trusted read: parse, then verify the seal. A record that fails any
 *  check is refused with its precise reason — the caller fails loudly. */
export function readEvidence<T = Record<string, unknown>>(filePath: string): EvidenceRead<T> {
  if (!existsSync(filePath)) return { ok: false, reason: `no such evidence file: ${filePath}`, kind: "missing" }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"))
  } catch (e) {
    return {
      ok: false,
      reason: `evidence file is not valid JSON: ${filePath} (${(e as Error).message})`,
      kind: "unparseable",
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: `evidence file is not a JSON object: ${filePath}`, kind: "unparseable" }
  }
  const verdict = verifySeal(parsed as Record<string, unknown>)
  if (!verdict.ok) return { ok: false, reason: verdict.reason, kind: verdict.kind }
  return { ok: true, record: parsed as T, seal: verdict.seal }
}

/** Transition-window read (D-1): legacy (pre-M61) records are accepted but
 *  flagged `legacy: true`. Only a CLEAN, valid-JSON, simply-unsealed object
 *  qualifies as legacy — unparseable/tampered/missing stay hard refusals.
 *  Gates using this during the window must WARN on legacy records and hard-
 *  FAIL on unsealed records written after the window opened. */
export function readEvidenceAllowingLegacy<T = Record<string, unknown>>(
  filePath: string,
): EvidenceRead<T> & { legacy?: boolean } {
  const result = readEvidence<T>(filePath)
  if (result.ok) return result
  if (result.kind === "unsealed") {
    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && (parsed as Record<string, unknown>)[SEAL_KEY] === undefined) {
        return {
          ok: true,
          record: parsed as T,
          legacy: true,
          reason: "legacy (pre-M61) record accepted in the transition window",
        } as EvidenceRead<T> & { legacy?: boolean }
      }
    } catch {
      // fall through to the hard refusal below
    }
  }
  return result
}

/** D-1's one-shot migration: seal an existing legacy evidence file IN PLACE,
 *  preserving every field of the original record. Returns the seal, or null
 *  when the file is absent or already sealed (idempotent). */
export function sealLegacyFile(filePath: string, now = new Date()): EvidenceSeal | null {
  if (!existsSync(filePath)) return null
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>
  if (parsed[SEAL_KEY] !== undefined) return null
  const seal = sealFor(parsed, now)
  const sealed = { ...parsed, [SEAL_KEY]: seal }
  // Under the same dir lock as every other evidence write (M61.V2).
  withLock(path.dirname(filePath), () => {
    writeFileSync(filePath, `${JSON.stringify(sealed, null, 2)}\n`)
  })
  return seal
}

/** Drop-in adoption helper for gates that already do
 *  `JSON.parse(readFileSync(p, "utf8"))` on evidence records (inside try/
 *  catch or bare). Semantics: a sealed record parses exactly as before; a
 *  clean legacy record parses with a warn (the declared transition window);
 *  tampered/bad-seal/unparseable records THROW with the reason — a gate that
 *  catches gets a loud refusal ("missing evidence"), a bare site fails the
 *  run. Never returns a record that failed verification. */
export function parseSealedRecord<T = Record<string, unknown>>(filePath: string): T {
  const read = readEvidenceAllowingLegacy<T>(filePath)
  if (read.ok) {
    if (read.legacy) console.error(`warn: ${path.basename(filePath)} is a legacy (unsealed) record — accepted in the M61 transition window only`)
    return read.record
  }
  throw new Error(`M61 trusted read refused ${path.basename(filePath)}: ${read.reason} (kind=${read.kind})`)
}
