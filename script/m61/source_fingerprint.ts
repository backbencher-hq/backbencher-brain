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
 * Re-exported, NOT re-implemented. A gate that needs the per-file digest gets
 * it from the ONE owner of this rule, and this module gets it from the ONE
 * primitive that carries the NIST vectors — so there is exactly one
 * implementation of "hash these bytes" in the chain, and a reader auditing a
 * record never has to ask which of the two copies is authoritative.
 */
export { sha256File, sha256Text, SHA256_KAT }

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

/**
 * The smallest coverage that can mean anything: the oracle plus ONE other
 * path. Stated as a named constant because "a single covered file" is the shape
 * a decorative implementation takes — `covers: [theVerifier]` over a verifier
 * that never runs, or a digest of one file nobody edits. `coverageFindings`
 * already rejects a list that names nothing but the oracle; this constant makes
 * the floor explicit and lets the gate assert it directly.
 */
export const MIN_COVERED_PATHS = 2

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
  if (covers.length < MIN_COVERED_PATHS) {
    out.push(`coverage names ${covers.length} path(s), below the floor of ${MIN_COVERED_PATHS} — a digest over one file cannot distinguish a component change from a comment change`)
  }
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

// ---------------------------------------------------------------------------
// THE CLASSIFIER — a value on disk is one of FOUR states, and the four are
// reported separately because they have different owners and different fixes.
// ---------------------------------------------------------------------------

/**
 * WHY FOUR STATES AND NOT A BOOLEAN. The first form of this gate asked one
 * question — "is the field present?" — and a decorative 64-hex constant passed
 * it (RED PROOF: `m26 0/11` → `m26 1/11` with 64 `a`s planted, and `m26.W1`
 * disappeared from the failing list). The fix is not a stricter boolean; it is
 * naming the four states a claim can be in, because they are four different
 * problems:
 *
 *   VERIFIABLE     the value equals what this rule computes from the declared
 *                  coverage on disk right now. The claim re-earned.
 *   STALE          the value is well-formed and was a real digest of the
 *                  declared coverage AS OF THE RECORD'S OWN COMMIT, but a
 *                  covered file has moved since. §8.2 says evidence must
 *                  regenerate at the CURRENT commit, so this is a REAL failure —
 *                  but it is not dishonesty, it is bookkeeping. The fix is
 *                  re-running the verifier. Calling it "malformed" would send
 *                  an owner hunting for a forger who does not exist; calling it
 *                  a pass would let a claim outlive the code it measured.
 *   MALFORMED      the value is absent, empty, not a sha256 digest, a constant,
 *                  the digest of nothing, the digest of the record's own file,
 *                  or a value the rule cannot reproduce from ANY covered path.
 *                  Nothing about the tree explains it. The fix is to stop
 *                  writing it.
 *   UNEXPLAINED    the value does not re-derive AND no covered path changed
 *                  since the record's commit — so it is not staleness either.
 *                  This is the state that separates "the source moved" from
 *                  "the number was invented", and it is its own verdict because
 *                  a gate that folds it into STALE would launder a forged
 *                  digest as bookkeeping the moment someone touches an
 *                  unrelated file.
 *
 * `sinceCommit` is the discriminator between STALE and UNEXPLAINED, and it is
 * INJECTED, never computed here: this module stays free of git and of the
 * clock (the ledger_projection.ts discipline — a rule that shells out cannot be
 * unit-tested against a fixture tree), and the gate supplies the real diff.
 */
export type FingerprintState =
  | { state: "verifiable"; fingerprint: string; covers: Coverage }
  | { state: "stale"; fingerprint: string; rederived: string; moved: string[]; covers: Coverage }
  | { state: "unexplained"; fingerprint: string; rederived: string; covers: Coverage }
  | { state: "malformed"; findings: DecorativeVerdict[]; covers: Coverage }
  | { state: "no-coverage"; findings: string[]; covers: Coverage }

/** The injected "did any of these paths change since this commit" probe.
 *  Returns the changed subset, or `null` when the question cannot be answered
 *  (an unknown/absent commit) — and `null` is NOT the same as "nothing
 *  changed": an unanswerable question must produce UNEXPLAINED, never STALE. */
export type MovedSince = (commit: string | undefined, covers: Coverage) => string[] | null

/** The injected "what was the digest of these paths AS OF this commit" probe.
 *
 *  THIS IS THE REAL DISCRIMINATOR, and the one above is not sufficient. The
 *  live proof is why: with an unrelated edit to the verifier sitting uncommitted,
 *  `movedSince` truthfully reports a move, and two forged values (the record's
 *  own hash, and a correct digest of `package.json`) were filed as STALE — the
 *  reassuring verdict, with the fix named as "re-run the verifier". A dirty
 *  tree launders a forgery into bookkeeping.
 *
 *  So the question is not "did something move?" but "WAS THIS VALUE THE DIGEST
 *  OF THESE BYTES AT THE MOMENT IT WAS SEALED?", asked of the blobs stored in
 *  git rather than of the working tree. It cannot be faked by an unrelated edit,
 *  because it never looks at the working tree:
 *
 *    digestAtCommit == the record's value  → the value was honest and the
 *        source has since moved: STALE, and the fix is to re-run.
 *    otherwise                            → the value was never a digest of the
 *        declared coverage at any point: UNEXPLAINED, whatever else has changed.
 *
 *  `null` when the question cannot be answered (no usable commit, or a covered
 *  path that did not exist then) — and null means UNEXPLAINED, never STALE.
 */
export type DigestAtCommit = (commit: string | undefined, covers: Coverage) => string | null

/** The structural findings that make a value malformed REGARDLESS of the tree's
 *  state — the ones that are true of the value alone. Extracted from
 *  `decorativeVerdict` so the classifier can ask "is this value dishonest?"
 *  before it asks "does the tree explain the difference?". */
export function valueFindings(args: {
  fingerprint: unknown
  root: string
  evidenceFile?: string
}): DecorativeVerdict[] {
  const { fingerprint, root, evidenceFile } = args
  const out: DecorativeVerdict[] = []
  const add = (reason: string): void => {
    out.push({ field: "sourceFingerprint", fingerprint, reason })
  }
  if (typeof fingerprint !== "string" || fingerprint.length === 0) {
    add(`absent or empty (${JSON.stringify(fingerprint)}) — §8.4 requires every claim field to carry one`)
    return out
  }
  if (!HEX_64.test(fingerprint)) {
    add(`not a sha256 digest (${fingerprint.length} chars, not 64 lowercase hex)`)
    return out
  }
  if (evidenceFile) {
    const evRel = evidenceFile.split(path.sep).join("/")
    const evAbs = path.isAbsolute(evRel) ? evRel : path.join(root, evRel)
    if (existsSync(evAbs)) {
      if (fingerprint === sha256File(evAbs)) add("is the digest of THIS RECORD'S OWN evidence file — a function of its own output")
      if (fingerprint === sha256Text(readFileSync(evAbs, "utf8"))) add("is the digest of this record's own TEXT — the same self-reference in string form")
    }
  }
  if (fingerprint === SHA256_OF_NOTHING) add("is sha256 of ZERO BYTES — the hash of nothing at all")
  if (/^([0-9a-f])\1{63}$/.test(fingerprint)) add(`is the constant ${fingerprint.slice(0, 8)}… repeated — a decorative value`)
  if (fingerprint === "0".repeat(64)) add("is 64 zeros — a decorative value")
  if (fingerprint === "f".repeat(64)) add("is 64 f's — a decorative value")
  return out
}

/**
 * THE CLASSIFIER. `covers` is the DECLARED coverage (from
 * script/m61/claim_fingerprints.ts, or from the record's own
 * `sourceFingerprintCovers` when it has one); `recordCommit` is the record's
 * `currentCommit`, the only evidence available about WHEN the value was written.
 *
 * Order matters and is the reason this is a function rather than a pile of
 * predicates:
 *   1. no coverage declared        → no-coverage   (cannot judge a value over nothing)
 *   2. coverage structurally broken→ no-coverage   (named, never re-derived)
 *   3. value dishonest on its own  → malformed     (constant, empty, self-hash…)
 *   4. value re-derives            → verifiable    (the only pass)
 *   5. value WAS the digest at the record's own commit, and a covered path has
 *      moved since                        → stale      (real, not dishonest)
 *   6. value was NOT the digest at the record's own commit → unexplained (invented)
 * Steps 5 and 6 are the F4 discrimination, and step 5 consults BOTH probes on
 * purpose: `digestAtCommit` proves the value was honest WHEN it was sealed, and
 * `movedSince` proves something actually changed since (otherwise an
 * unaccountable difference would be filed as routine bookkeeping). Requiring
 * both is what stops a dirty working tree from laundering a forgery — the defect
 * the live proof found in the first version of this function, where
 * `movedSince` alone classified the record's own hash and a digest of
 * `package.json` as STALE.
 */
export function classifyFingerprint(args: {
  fingerprint: unknown
  covers: Coverage
  root: string
  recordCommit?: string
  verifierCommand: string
  evidenceFile?: string
  movedSince: MovedSince
  digestAtCommit: DigestAtCommit
}): FingerprintState {
  const { fingerprint, covers, root, recordCommit, verifierCommand, evidenceFile, movedSince, digestAtCommit } = args
  const structural = coverageFindings(covers, { root, verifierCommand, ...(evidenceFile === undefined ? {} : { evidenceFile }) })
  if (covers.length === 0 || structural.length > 0) return { state: "no-coverage", findings: structural, covers }
  const dishonest = valueFindings({ fingerprint, root, ...(evidenceFile === undefined ? {} : { evidenceFile }) })
  if (dishonest.length > 0) return { state: "malformed", findings: dishonest, covers }
  const fp = fingerprint as string
  let rederived: string
  try {
    rederived = sourceFingerprintOf(covers, root)
  } catch (e) {
    return { state: "no-coverage", findings: [`cannot re-derive: ${(e as Error).message}`], covers }
  }
  if (rederived === fp) return { state: "verifiable", fingerprint: fp, covers }
  // The discriminator. BOTH probes must agree before the reassuring verdict:
  // the value has to have been the real digest at the record's own commit, AND
  // something covered has to have moved since. Either one alone is gameable —
  // the first by a forged commit stamp, the second by a dirty tree.
  const wasHonestAtSeal = digestAtCommit(recordCommit, covers)
  if (wasHonestAtSeal === null || wasHonestAtSeal !== fp) {
    return { state: "unexplained", fingerprint: fp, rederived, covers }
  }
  const moved = movedSince(recordCommit, covers)
  if (moved !== null && moved.length > 0) return { state: "stale", fingerprint: fp, rederived, moved, covers }
  return { state: "unexplained", fingerprint: fp, rederived, covers }
}

/** The one-line form a gate prints. The state is named FIRST, because the state
 *  is the finding and the detail only explains it. */
export function fingerprintStateLine(claim: string, s: FingerprintState): string {
  switch (s.state) {
    case "verifiable":
      return `${claim}: VERIFIABLE (${s.fingerprint.slice(0, 12)}… re-derived from ${s.covers.length} declared path(s))`
    case "stale":
      return `${claim}: STALE — ${s.moved.length} covered path(s) moved since ${s.moved.slice(0, 3).join(", ")}${s.moved.length > 3 ? ` … +${s.moved.length - 3}` : ""}; record=${s.fingerprint.slice(0, 12)}… now=${s.rederived.slice(0, 12)}… (re-run the verifier; §8.2)`
    case "unexplained":
      return `${claim}: UNEXPLAINED — the value does not re-derive AND no covered path changed since the record's commit; record=${s.fingerprint.slice(0, 12)}… re-derived=${s.rederived.slice(0, 12)}… (an invented digest, not bookkeeping)`
    case "malformed":
      return `${claim}: MALFORMED — ${s.findings.map((f) => f.reason).join("; ")}`
    case "no-coverage":
      return `${claim}: NO-COVERAGE — ${s.findings.join("; ")}`
  }
}

/**
 * REMOVED, and its removal is the point of this file's second half.
 *
 * The first form of this rule was one predicate, `decorativeVerdict()`, that
 * answered "name every reason this value is not a fingerprint" — and it folded
 * STALENESS and DISHONESTY into one undifferentiated list of strings. The RED
 * PROOF showed what that costs: a gate that asks a boolean question about a
 * predicate that returns prose cannot fail. It is replaced by
 * `classifyFingerprint()` above, which returns ONE OF FOUR STATES, because the
 * states have different owners (re-run the verifier / stop writing the value)
 * and collapsing them teaches an owner to ignore the finding.
 */

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
