// script/m61/source_fingerprint.ts — the ONE owner of §8.4's `sourceFingerprint`.
//
// THE DEFECT THIS PINS (measured at HEAD d3108fc04 on this branch, census by
// script/m61/verify-claim-fingerprints.ts):
//
//   287 of 310 `verified` evidence records in this repository carry NO
//   sourceFingerprint. A claim that cannot name the bytes it was computed from
//   cannot be re-earned or falsified against its inputs, which is exactly what
//   IDE Honesty Contract §8.2 requires ("evidence must regenerate
//   byte-identically from the current commit") and exactly what it could not
//   demonstrate for 92% of the corpus. Four mutually incompatible conventions
//   were already in use for the 23 records that did carry one:
//     A  script/m24/verify-positions.ts:613   sha256(raw bytes of ONE file)
//     B  script/m20/*  via src/intelligence/*/evidence.ts
//                                           sha256(path NUL bytes NUL) over a
//                                           DECLARED ordered path list
//     C  script/m30/*                         `sha256sum` SPAWNED (a binary
//                                              script/m24/portability.ts
//                                              BANS — the m24 lane's own F7
//                                              defect, still live)
//     D  script/m28/verify-surface-parity.ts:715
//                                           an OBJECT {path: digest}, so no
//                                           string comparison finds it
//   Four spellings of one field means two of them are wrong, and a gate cannot
//   check what it cannot parse.
//
// THE DEFINITION, stated once here (definition 1 + the oracle, NOT definition
// 2 alone — see the rejected alternative below):
//
//   A claim's `sourceFingerprint` is a sha256 digest over a DECLARED, ORDERED
//   list of repo-relative paths. Each covered path contributes
//
//       <path> NUL <64-hex sha256 of that file's RAW BYTES> NUL
//
//   to the digest. What each fingerprint COVERS is declared per claim in
//   script/m61/claim_fingerprints.ts and copied into the record as
//   `sourceFingerprintCovers`, so a reader of the record alone can see what it
//   was computed from.
//
//   WHY THE COMPONENT, NOT ONLY THE VERIFIER (definition 1 chosen over
//   definition 2 — the alternative rejected):
//
//     definition 1  content hash of the component(s) under test — "this result
//                   was computed from these exact bytes". Detects the component
//                   changing after its evidence was sealed.
//     definition 2  hash of the verifier's own source — "this exact verifier
//                   produced this". Detects the ORACLE changing.
//   Definition 2 alone is the weaker claim and is REJECTED as the definition: a
//   fingerprint that survives a rewrite of `src/lsp/hover.ts` is a green record
//   describing a component that no longer exists, which is the §8.2 failure
//   itself. Definition 1 alone is also rejected: a fingerprint that survives a
//   rewrite of the harness would let the harness quietly stop testing the law it
//   claims to test. So the covered list ALWAYS carries both roles, and the gate
//   enforces that structurally (a list with no non-verifier path, or with no
//   verifier path, is REJECTED — see `coverageFindings`). That makes the two
//   semantics inseparable by construction instead of a matter of discipline.
//
//   Why the PATH is inside the digest: without it, moving a covered file's bytes
//   under a new name leaves the fingerprint identical, and a "rename the
//   component" change is exactly the kind of change evidence must not survive.
//   This is the m20 convention (definition B above), the only one of the four
//   that already binds the path.
//
//   Why the per-file digest is TEXT (hex) inside the composite: so the whole
//   fingerprint is reproducible by hand with nothing but `sha256sum`:
//
//     { for p in COVER; do printf '%s\0%s\0' "$p" "$(sha256sum "$p" | cut -d' ' -f1)"; done; } | sha256sum
//
//   A value nobody can recompute by hand is a value nobody can falsify, and
//   §8.2 asks for byte-identical regeneration.
//
// WHY `sha256File()` AND NOT A SECOND PRIMITIVE: the byte digest is
// `sha256File()` from script/m24/portability.ts — the one primitive in this
// repository that carries NIST/FIPS 180-4 known-answer vectors, and the one that
// exists because spawning `sha256sum` killed two m24 gates on darwin
// (portability.ts:6-12). It is imported, never re-implemented; `primitiveKAT()`
// below proves at run time that the imported primitive agrees with the
// KAT-checked TEXT primitive over the same bytes, which is what catches a
// `sha256File` that silently normalizes line endings or decodes text.
//
// Purity: no fs writes, no process spawn, no clock. It runs NOTHING at import
// (the M55 lesson, same as script/lib/evidence.ts) — a gate calls it
// explicitly. Reading files is a function argument (the repo root), never a
// module-level constant, so the same rule runs over a scratch tree in a test.

import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { SHA256_KAT, sha256File, sha256Text } from "../m24/portability.ts"

/**
 * The algorithm, spelled out as a value that goes INTO every record. A record
 * that names its algorithm is a record a reader (and a future gate) can check;
 * one that carries a bare digest is an assertion with nothing to check it
 * against.
 */
export const FINGERPRINT_ALGORITHM =
  "sha256 over the covered paths in DECLARED ORDER; each path contributes " +
  "<repo-relative path> NUL <64-hex sha256 of the file's RAW BYTES> NUL; " +
  "per-file digest = script/m24/portability.ts sha256File() (node:crypto, no process spawn)"

/** A fingerprint is 64 lowercase hex characters. Nothing else is one. */
export const HEX_64 = /^[0-9a-f]{64}$/

/** The digest of zero bytes. Carried explicitly because "hash of nothing" is the
 *  most common decorative value and it is syntactically a perfect fingerprint. */
export const SHA256_OF_NOTHING = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

/** The covered paths of one claim: repo-relative, declared, ORDERED. The order
 *  is part of the value (the digest folds paths in sequence), so a list is never
 *  sorted at hash time — the declaration states the order it intends. */
export type Coverage = readonly string[]

/** The three §8.4 fields, as they appear in a record. Named as one unit so a
 *  verifier spreads one call and cannot emit a digest without its declaration. */
export interface FingerprintFields {
  sourceFingerprint: string
  sourceFingerprintAlgorithm: string
  sourceFingerprintCovers: string[]
}

/** Thrown when a declared covered path does not exist. A MISSING covered file is
 *  a hard failure with a name — never a fallback value, never an empty string,
 *  and never a digest over the paths that happened to survive. */
export class CoverageError extends Error {
  constructor(readonly missing: string[]) {
    super(`declared covered path(s) do not exist on disk: ${missing.join(", ")}`)
    this.name = "CoverageError"
  }
}

/**
 * The one computation. `covers` is the DECLARED list (never a glob: a glob is
 * a coverage that changes shape without anybody editing it), `root` is the repo
 * root every path is relative to.
 */
export function sourceFingerprintOf(covers: Coverage, root: string): string {
  const missing = covers.filter((rel) => !existsSync(path.join(root, rel)))
  if (missing.length > 0) throw new CoverageError(missing)
  const hash = createHash("sha256")
  for (const rel of covers) {
    hash.update(rel, "utf8")
    hash.update("\0", "utf8")
    // The text form of the per-file digest, so the composite is reproducible
    // from `sha256sum` output alone (see the header).
    hash.update(sha256File(path.join(root, rel)), "utf8")
    hash.update("\0", "utf8")
  }
  return hash.digest("hex")
}

/** The record fields for one claim, from its declared coverage. */
export function fingerprintFieldsOf(covers: Coverage, root: string): FingerprintFields {
  return {
    sourceFingerprint: sourceFingerprintOf(covers, root),
    sourceFingerprintAlgorithm: FINGERPRINT_ALGORITHM,
    sourceFingerprintCovers: [...covers],
  }
}

/** Every path of `covers` that exists, plus the ones that do not — the gate's
 *  census needs both halves and must not lose the missing one in a filter. */
export function coveragePresence(covers: Coverage, root: string): { present: string[]; missing: string[] } {
  return {
    present: covers.filter((rel) => existsSync(path.join(root, rel))),
    missing: covers.filter((rel) => !existsSync(path.join(root, rel))),
  }
}

// ---------------------------------------------------------------------------
// The structural rules a coverage list must satisfy
// ---------------------------------------------------------------------------

export type CoverageRole = { verifier: string; components: string[]; fixtures: string[] }

/**
 * Split a declared list into its ROLES, by path shape, so the gate can require
 * both roles to be present without hard-coding one lane's file layout:
 *
 *   verifier    the claim's own oracle: the `script/<lane>/verify-*.ts` that the
 *               record's own `verifierCommand` names (matched by the caller).
 *   component   anything else under `src/`, `ide/`, `docs/`, `grammars/`,
 *               `website/` — the thing under test, the contract text, the
 *               renderer it renders through.
 *   fixture     lane-local harness modules (`script/<lane>/*.ts` that are not
 *               the oracle): fixtures, shared probes, generated-doc builders.
 */
export function classifyCoverage(covers: Coverage, verifierPath: string): CoverageRole {
  const verifier = verifierPath ? verifierPath.split(path.sep).join("/") : ""
  const components: string[] = []
  const fixtures: string[] = []
  for (const raw of covers) {
    const rel = raw.split(path.sep).join("/")
    if (rel === verifier) continue
    if (/^script\/[^/]+\//.test(rel)) fixtures.push(rel)
    else components.push(rel)
  }
  return { verifier: covers.map((c) => c.split(path.sep).join("/")).includes(verifier) ? verifier : "", components, fixtures }
}

/**
 * The structural findings on one declared coverage list. Each is a NAMED
 * failure, because a coverage list that cannot mean anything is the failure this
 * whole file exists to make impossible:
 *
 *   empty            the digest covers no input at all.
 *   no-oracle        nothing that produced the result is covered, so the ORACLE
 *                    can change and the evidence still claims to be re-earned
 *                    (definition 2's failure, rejected as a definition above).
 *   no-component     nothing the claim is ABOUT is covered, so the digest is
 *                    the hash of a test harness (definition 1's failure).
 *   self-reference   the record's own evidence file is covered, so the digest is
 *                    a function of its own output — the classic self-referential
 *                    "integrity" value, which is decorative by construction.
 *   not-repo-relative  an absolute path or a `../` escape, which would make the
 *                    digest depend on where the tree happens to live.
 *   duplicate        the same path twice, which means the declaration was
 *                    assembled rather than written.
 *   missing          a covered path that is not on disk (also thrown by
 *                    `sourceFingerprintOf`; reported, never skipped).
 */
export function coverageFindings(covers: Coverage, ctx: { root: string; verifierCommand: string; evidenceFile?: string }): string[] {
  const out: string[] = []
  if (covers.length === 0) return ["coverage is EMPTY — the digest covers no input"]
  if (new Set(covers).size !== covers.length) out.push(`coverage repeats a path (${covers.length} entries, ${new Set(covers).size} distinct)`)
  const rel = covers.map((c) => c.split(path.sep).join("/"))
  const verifier = ctx.verifierCommand.match(/(script\/[A-Za-z0-9_./-]+\.(?:ts|mts|js))/)
  const verifierPath = verifier ? verifier[1]! : ""
  if (verifierPath === "") out.push("the record names no verifierCommand, so no oracle can be required in the coverage")
  else if (!rel.includes(verifierPath)) out.push(`coverage omits the ORACLE (${verifierPath}) — the harness could change and the evidence would still read fresh`)
  const { components, fixtures } = classifyCoverage(rel, verifierPath)
  if (components.length === 0 && fixtures.length === 0) out.push(`coverage names nothing but the oracle (${verifierPath}) — a digest of the harness is not a digest of what the claim is about`)
  if (ctx.evidenceFile) {
    const evRel = ctx.evidenceFile.split(path.sep).join("/")
    const evAbs = path.isAbsolute(evRel) ? evRel : path.join(ctx.root, evRel)
    if (rel.includes(evRel) || rel.some((p) => path.resolve(ctx.root, p) === path.resolve(evAbs))) {
      out.push(`coverage includes the record's OWN evidence file (${path.basename(evRel)}) — a digest that is a function of its own output is decorative`)
    }
  }
  for (const p of rel) {
    if (path.isAbsolute(p) || p.startsWith("../")) out.push(`coverage path is not repo-relative: ${p}`)
    if (!existsSync(path.join(ctx.root, p))) out.push(`covered path does not exist: ${p}`)
  }
  return out
}

// ---------------------------------------------------------------------------
// The red-team predicate: is a value on a record a DISCRIMINATING fingerprint?
// ---------------------------------------------------------------------------

/** Every reason a value is not a fingerprint, most specific first. A gate
 *  reports ALL of them: one value can be both "not re-derivable" and "the digest
 *  of nothing", and the second is the diagnosis a reader needs. */
export type DecorativeVerdict = { field: string; fingerprint: unknown; reason: string; rederived?: string }

/**
 * THE PREDICATE. Given what a record carries and what it SHOULD carry, name
 * every reason the value cannot prove what source it came from.
 *
 * Ordered deliberately:
 *   1 shape            — not a string / not 64 lowercase hex
 *   2 self-reference   — the digest OF the evidence file (or of the record's own
 *                        committed hash), i.e. a function of its own output
 *   3 degeneracy       — the digest of nothing / a zero run / an all-same-digit
 *                        run, the constants a well-meaning hand-edit produces
 *   4 re-derivation    — the value differs from `sourceFingerprintOf(covers)`
 *   5 role structure   — the declared coverage cannot mean anything
 * A value that reaches step 4 and differs IS non-discriminating even when it is
 * a perfectly well-formed 64-hex digest: shape is not meaning, which is the
 * whole point of this predicate existing.
 */
export function decorativeVerdict(args: {
  fingerprint: unknown
  covers: Coverage
  root: string
  verifierCommand: string
  evidenceFile?: string
  declaredAlgorithm?: unknown
}): DecorativeVerdict[] {
  const { fingerprint, covers, root, verifierCommand, evidenceFile, declaredAlgorithm } = args
  const out: DecorativeVerdict[] = []
  const add = (field: string, reason: string, rederived?: string): void => {
    out.push({ field, fingerprint, reason, ...(rederived === undefined ? {} : { rederived }) })
  }
  if (declaredAlgorithm !== undefined && declaredAlgorithm !== FINGERPRINT_ALGORITHM) {
    add("sourceFingerprintAlgorithm", `does not name the owner's algorithm (${JSON.stringify(String(declaredAlgorithm)).slice(0, 80)}…)`)
  }
  if (typeof fingerprint !== "string" || fingerprint.length === 0) {
    add("sourceFingerprint", `absent or empty (${JSON.stringify(fingerprint)}) — §8.4 requires every claim field to carry one`)
    return out
  }
  if (!HEX_64.test(fingerprint)) {
    add("sourceFingerprint", `not a sha256 digest (${fingerprint.length} chars, not 64 lowercase hex)`)
    return out
  }
  if (evidenceFile) {
    const evRel = evidenceFile.split(path.sep).join("/")
    const evAbs = path.isAbsolute(evRel) ? evRel : path.join(root, evRel)
    if (existsSync(evAbs)) {
      const selfDigest = sha256File(evAbs)
      if (fingerprint === selfDigest) add("sourceFingerprint", "is the digest of THIS RECORD'S OWN evidence file — a function of its own output")
      if (fingerprint === sha256Text(readFileSync(evAbs, "utf8"))) add("sourceFingerprint", "is the digest of this record's own TEXT — the same self-reference in string form")
    }
  }
  if (fingerprint === SHA256_OF_NOTHING) add("sourceFingerprint", "is sha256 of ZERO BYTES — the hash of nothing at all")
  if (/^([0-9a-f])\1{63}$/.test(fingerprint)) add("sourceFingerprint", `is the constant ${fingerprint.slice(0, 8)}… repeated — a decorative value`)
  if (fingerprint === "0".repeat(64)) add("sourceFingerprint", "is 64 zeros — a decorative value")
  if (fingerprint === "f".repeat(64)) add("sourceFingerprint", "is 64 f's — a decorative value")
  for (const reason of coverageFindings(covers, { root, verifierCommand, ...(evidenceFile === undefined ? {} : { evidenceFile }) })) {
    add("sourceFingerprintCovers", reason)
  }
  try {
    const rederived = sourceFingerprintOf(covers, root)
    if (rederived !== fingerprint) {
      add("sourceFingerprint", `is not re-derivable from the declared coverage (record=${fingerprint.slice(0, 12)}… re-derived=${rederived.slice(0, 12)}…) — §8.2 asks for byte-identical regeneration from the current commit, and this value cannot be regenerated`, rederived)
    }
  } catch (e) {
    add("sourceFingerprintCovers", `cannot be re-derived: ${(e as Error).message}`)
  }
  return out
}

// ---------------------------------------------------------------------------
// The primitive's own proof
// ---------------------------------------------------------------------------

export type KatResult = { vector: string; ok: boolean; got: string }

/**
 * Prove the IMPORTED byte primitive agrees with the known-answer-checked TEXT
 * primitive over the same bytes.
 *
 * This is the load-bearing part of "do not duplicate `sha256File()`": the
 * imported function is only trustworthy for this rule if it is the same function
 * the KAT vectors describe. A `sha256File` that decoded text, normalized CRLF,
 * or hashed a decoded string would disagree here for at least one vector — and
 * the empty-input vector is the one that catches "hash only the first line" and
 * "return a constant for an empty file". Runs entirely in memory: a temp file is
 * written and removed per vector, and `finally` removes it on a throw.
 */
export function primitiveKAT(writeTemp: (name: string, bytes: Buffer) => string, remove: (p: string) => void): KatResult[] {
  return SHA256_KAT.map((v) => {
    const p = writeTemp(`m61-fingerprint-kat-${Buffer.from(v.label).toString("hex").slice(0, 16)}.bin`, Buffer.from(v.input, "utf8"))
    let got: string
    try {
      got = sha256File(p)
    } finally {
      remove(p)
    }
    const textOk = sha256Text(v.input) === v.want
    return { vector: v.label, ok: got === v.want && textOk, got }
  })
}
