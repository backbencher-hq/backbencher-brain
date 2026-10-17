// script/m61/refresh-stale-seals.ts — the bounded repair for a STALE seal.
//
// The defect class this closes (found at HEAD 306bec22b, 2026-10-07): a record's
// `bbSeal` envelope can stop matching its own bytes without any gate noticing,
// because the seal is verified only where a caller happens to use a trusted read
// — and the records that go stale are exactly the ones whose content is rewritten
// by a producer that carries the old envelope forward (a merge/restore that copies
// sealed bytes from an older tree, or a pre-M61 raw write path that re-stamps
// content). Measured on the whole `validation/` namespace at that commit: 3,577
// JSON records, 583 carrying a seal, 559 verifying, and **24 stale** — every one of
// them sealed by the single M61 migration run at 2026-09-14T23:42:47-48Z and
// rewritten afterwards. No gate read any of them, so all 24 sat there silently.
// The 25th instance is what made this urgent: M29.R2's trusted read of
// validation/m14/results/M14.0.SPEC.json refused a file that was present, current
// and 109 KB long, which is a red gate with no visible cause.
//
// What this tool does, and its bound: it calls the library's own
// `refreshStaleSeal`, which refuses a record whose seal VERIFIES (nothing to do),
// refuses an unsealed record (that is sealLegacyFile's job), refuses a malformed
// envelope, and requires a non-empty --why. So it can only ever rewrite the
// envelope of a record whose seal is provably stale, and every content field is
// preserved (each write is round-tripped through the trusted read and compared
// field-by-field below). The reason is recorded per file in
// validation/m61/seal-refresh-register.json, so a refresh is a written act with a
// trace a reviewer can check, not a silent re-stamp.
//
// Usage: npx tsx script/m61/refresh-stale-seals.ts --why "<why>" <path> [<path>...]
// Exit 0 = every given path was refreshed or already valid; 1 = any refusal.

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { SEAL_KEY, readEvidence, refreshStaleSeal, sealLegacyFile } from "../lib/evidence.ts"
// The register's row shape, its ONE-ROW-PER-PATH folding, and its single
// locked write path live in seal_register.ts. This file used to carry its own
// copies of the first two and a bare writeFileSync for the third — the L4
// adoption audit (M61.V2) named it as an evidence-shaped bare write, and a
// duplicated coalescing rule is the kind of copy that drifts silently.
import { coalesceRows, writeRegister, type RegisterEntry } from "./seal_register.ts"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
const DEFAULT_REGISTER = "validation/m61/seal-refresh-register.json"

const REGISTER_PURPOSE =
  "M61 stale-seal refreshes: every record whose bbSeal envelope had to be recomputed because a producer rewrote its content after sealing. A row here is the written reason for that refresh — old digest, new digest, why, when. Written only by script/m61/refresh-stale-seals.ts, and CHECKED by script/m61/verify-seal-audit.ts (each row's newDigest must equal the file's current seal, so the register cannot outlive the fact it records)."

const argv = process.argv.slice(2)
function flagValue(name: string): string | undefined {
  const i = argv.indexOf(name)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
}
const why = flagValue("--why")
// Two repair modes beyond the stale-envelope repair, each for a state the
// register can record but refreshStaleSeal refuses BY DESIGN:
//
//   --re-record  the seal VERIFIES but is not the digest the register names,
//                because the owning gate legitimately re-ran and moved content
//                and seal together. Nothing is rewritten; the ROW moves to the
//                digest the file now carries (the row is a claim about the
//                file, so the claim is re-stated, not deleted — A4 checks every
//                row, so a stale row cannot be left behind and a second row for
//                the same path would fail too).
//
//   --seal-lost  the seal is ABSENT: a producer that stamped raw JSON dropped it
//                (the defect M61.A1's A4 measures). The file is sealed IN PLACE
//                through sealLegacyFile — every field preserved — and the row is
//                re-recorded. Fixing the producer is the owner's job; this only
//                restores the envelope the register already claims.
const RE_RECORD = argv.includes("--re-record")
const SEAL_LOST = argv.includes("--seal-lost")
const registerArg = flagValue("--register") ?? DEFAULT_REGISTER
// An ABSOLUTE --register must stay absolute: `path.join(ROOT, "/tmp/x.json")`
// silently becomes `<root>/tmp/x.json` and the write dies with ENOENT (found by
// probing the tool on a record copied out of the repo, 2026-10-07).
const registerPath = path.isAbsolute(registerArg) ? registerArg : path.join(ROOT, registerArg)
const paths = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--why" && argv[i - 1] !== "--register")

if (!why || paths.length === 0) {
  console.error('usage: npx tsx script/m61/refresh-stale-seals.ts --why "<why>" <path> [<path>...]')
  process.exit(2)
}

/**
 * The file's bytes with the bbSeal envelope's own lines removed — a LINE-based
 * operation bounded by markers (the `"bbSeal": {` line and the first line after it
 * that is just the object's closing brace), the same technique the merge tools use
 * to bound a block without parsing it. Used to MEASURE the repair's blast radius:
 * two texts that agree once the envelope is removed moved nowhere but the envelope.
 * It exists because the first version of this tool claimed "field-for-field" and
 * 2 of the first 24 records had in fact been re-serialized canonically (494600.0 →
 * 494600, and a missing final newline added) — a real byte change, invisible to a
 * value-level comparison, which the seal then covers.
 */
export function withoutEnvelope(raw: string): string {
  const lines = raw.split("\n")
  const start = lines.findIndex((l) => /^\s*"bbSeal":\s*\{\s*$/.test(l))
  if (start === -1) return raw
  let end = -1
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === "}" || lines[i].trim() === "},") {
      end = i
      break
    }
  }
  if (end === -1) return raw
  return [...lines.slice(0, start), ...lines.slice(end + 1)].join("\n")
}

const entries: RegisterEntry[] = []
/** Rows MOVED in place (one per path — see --re-record above), keyed by path. */
const moved = new Map<string, RegisterEntry>()
let refreshed = 0
let alreadyValid = 0
let refused = 0
let reRecorded = 0
let sealLost = 0

/** The register as it stands, read once: --re-record needs the row it moves. */
const readRegister = (): RegisterEntry[] => {
  if (!existsSync(registerPath)) return []
  try {
    return (JSON.parse(readFileSync(registerPath, "utf8")) as { entries?: RegisterEntry[] }).entries ?? []
  } catch {
    return []
  }
}

if ((RE_RECORD || SEAL_LOST) && why && paths.length > 0) {
  const existing = readRegister()
  for (const arg of paths) {
    const rel = path.isAbsolute(arg) ? path.relative(ROOT, arg) : arg
    const file = path.isAbsolute(arg) ? arg : path.join(ROOT, arg)
    const before = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
    const seal = before[SEAL_KEY] as { contentSha256?: string } | undefined
    const rowIndex = existing.findIndex((e) => e.path === rel)
    if (rowIndex === -1) {
      console.error(`REFUSED    ${rel} — no register row to move (this mode re-records an existing row)`)
      refused++
      continue
    }
    const row = existing[rowIndex] as RegisterEntry
    let current = seal?.contentSha256
    if (SEAL_LOST) {
      if (current !== undefined) {
        console.error(`REFUSED    ${rel} — a seal is present (${current.slice(0, 8)}); --seal-lost is for a record whose envelope was dropped`)
        refused++
        continue
      }
      const newSeal = sealLegacyFile(file)
      if (newSeal === null) {
        console.error(`REFUSED    ${rel} — sealLegacyFile refused (seal appeared between the read and the write)`)
        refused++
        continue
      }
      current = newSeal.contentSha256
      sealLost++
    } else {
      if (current === undefined) {
        console.error(`REFUSED    ${rel} — the seal is ABSENT; use --seal-lost (this mode re-records a VERIFYING seal)`)
        refused++
        continue
      }
      const back = readEvidence<Record<string, unknown>>(file)
      if (!back.ok) {
        console.error(`REFUSED    ${rel} — the seal does not verify (${back.reason}); a stale envelope is repaired by the default mode`)
        refused++
        continue
      }
      if (current === row.newDigest) {
        console.log(`valid      ${rel} (register row already names ${current.slice(0, 8)} — untouched)`)
        continue
      }
      reRecorded++
    }
    moved.set(rel, {
      path: rel,
      oldDigest: row.newDigest,
      newDigest: current,
      why: `${row.why.trim()} | ${why.trim()}`,
      at: new Date().toISOString(),
      tool: "script/m61/refresh-stale-seals.ts (--re-record)",
      envelopeOnly: true,
    })
    console.log(`re-recorded  ${rel}  row ${row.newDigest.slice(0, 8)} -> seal ${current.slice(0, 8)}`)
  }
  const all = coalesceRows(existing.map((e) => moved.get(e.path) ?? e))
  // Written when a row moved OR when the register still carries duplicates from
  // an older append-style refresh (the coalescing above is the repair).
  if (moved.size > 0 || all.length !== existing.length) {
    const written = writeRegister(registerPath, all)
    console.log(
      `register   ${path.relative(ROOT, registerPath)}: ${moved.size} row(s) re-recorded, ${existing.length - written.length} duplicate row(s) folded`,
    )
  }
  console.log(`refresh-stale-seals: ${reRecorded} re-recorded, ${sealLost} seal-lost repaired, ${refused} refused (of ${paths.length} given)`)
  process.exit(refused > 0 ? 1 : 0)
}


for (const arg of paths) {
  const file = path.isAbsolute(arg) ? arg : path.join(ROOT, arg)
  const rel = path.relative(ROOT, file)
  const rawBefore = readFileSync(file, "utf8")
  const before = JSON.parse(rawBefore) as Record<string, unknown>
  const { [SEAL_KEY]: _sealBefore, ...contentBefore } = before
  const contentBeforeText = JSON.stringify(contentBefore)
  const result = refreshStaleSeal(file, why)
  if (!result.ok) {
    if (result.kind === "valid") {
      alreadyValid++
      console.log(`valid      ${rel} (seal already verifies — untouched)`)
      continue
    }
    console.error(`REFUSED    ${rel} — ${result.reason} (kind=${result.kind})`)
    refused++
    continue
  }
  // The repair's own proof: the trusted read accepts the record, and no content
  // field moved. A refresh that changed a field would be a hand-edit wearing a
  // tool's name, and it fails here rather than in a reviewer's diff.
  const back = readEvidence<Record<string, unknown>>(file)
  if (!back.ok) {
    console.error(`REFUSED    ${rel} — resealed but the trusted read refused it: ${back.reason} (kind=${back.kind})`)
    refused++
    continue
  }
  const { [SEAL_KEY]: _sealAfter, ...contentAfter } = back.record
  if (JSON.stringify(contentAfter) !== contentBeforeText) {
    console.error(`REFUSED    ${rel} — CONTENT CHANGED while refreshing the envelope`)
    refused++
    continue
  }
  refreshed++
  // The blast radius, measured rather than asserted: with the envelope's lines
  // removed from both texts, did the file move anywhere else? A `false` here is a
  // canonical re-serialization (see withoutEnvelope) — value-identical content, a
  // new byte form, and the new seal covers it. Reported per record, never silent.
  const envelopeOnly = withoutEnvelope(rawBefore) === withoutEnvelope(readFileSync(file, "utf8"))
  entries.push({
    path: rel,
    oldDigest: result.oldDigest,
    newDigest: result.newDigest,
    why: why.trim(),
    at: new Date().toISOString(),
    tool: "script/m61/refresh-stale-seals.ts",
    envelopeOnly,
  })
  console.log(`refreshed  ${rel}  ${result.oldDigest.slice(0, 8)} -> ${result.newDigest.slice(0, 8)}${envelopeOnly ? "" : "  (RE-SERIALIZED beyond the envelope — value-identical, byte form canonicalized)"}`)
}

if (entries.length > 0) {
  const existing = existsSync(registerPath)
    ? (JSON.parse(readFileSync(registerPath, "utf8")) as { entries?: RegisterEntry[] })
    : {}
  const all = coalesceRows([...(existing.entries ?? []), ...entries])
  const written = writeRegister(registerPath, all)
  console.log(`register   ${path.relative(ROOT, registerPath)} now carries ${written.length} entr${written.length === 1 ? "y" : "ies"} (one per path)`)
}

const reSerialized = entries.filter((e) => !e.envelopeOnly)
console.log(`refresh-stale-seals: ${refreshed} refreshed (${refreshed - reSerialized.length} envelope-only, ${reSerialized.length} also re-serialized), ${alreadyValid} already valid, ${refused} refused (of ${paths.length} given)`)
if (reSerialized.length > 0) {
  console.log("re-serialized beyond the envelope (value-identical content, canonical byte form):")
  for (const e of reSerialized) console.log(`  ${e.path}`)
}
process.exit(refused > 0 ? 1 : 0)
