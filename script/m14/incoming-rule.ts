/**
 * THE INCOMING RULE, as an importable module.
 *
 * `incoming-gate.ts` is the arbiter: it discovers a population, walks it with the real
 * analyzer, and can exit non-zero. A census answers "why" about the same edges, and it must
 * count them the SAME way or the two numbers are about different questions. The rule
 * therefore lives here, imported by both, rather than being copied into a census — this
 * programme has already paid for copied rules twice (the kind-count vs declaration-count
 * ambiguity, and `incoming-check`'s published map that counted kinds).
 *
 * Everything in this file is PURE: it takes the key spaces it is given and returns an
 * outcome. Population discovery, parsing, scoping and reporting stay in the gate.
 */

/**
 * Metadata keys that mark an edge as naming something outside the corpus.
 *
 * An EXPLICIT list, not a heuristic, because "looks like a stdlib name" is exactly the
 * kind of inference that made `no-regex-gate.sh` report 187 where the truth was 5: a rule
 * that fires on shape convicts a correct analyzer. A lane must opt in, per key, and the
 * key must mean the same thing fleet-wide or the number is not comparable between lanes.
 *
 * `zigExternalRef` and `nimStdlibModule` are read from the committed analyzers:
 *   real-zig-analyzer.ts:2281 zigExternalReceiverPath, measured marking 2,189 recoverable
 *     + 5,009 external edges (validation/m14/fixtures/zig/measurements/incoming-abc-400-p30.json)
 *   real-nim-analyzer.ts  meta.nimStdlibModule, measured marking 66 of 485 unbindable
 *     (docs/analyzers/real-nim-analyzer.md:435-449)
 */
// The binding separator is a FAMILY constant (src/ast/types.ts) rather than a local copy: the
// analyzer spells a binding with it and this rule checks that spelling, so two definitions
// would be two rules and the arbiter's copy would be the one that mattered.
import { BINDING_SEP } from "../../src/ast/types"

export const EXTERNAL_KEYS = [
  "zigExternalRef",
  "nimStdlibModule",
  "isExternal",
  "isExternalTarget",
  "external",
  "externalRef",
  "isStdlib",
  "stdlibModule",
  "moduleNamingEdges",
  "markAsExternal",
  // dart: the first-heritage fallback in `real-dart-analyzer.ts`, which fires only where
  // NO evidence refutes the base (the base is a name this run cannot see) and only for a
  // member carrying the `@override` annotation. Named `isExternalBase` rather than one of
  // the generic spellings because it marks a BASE, not a target: the marked row still
  // names a member, and that member is still required to exist (see the Object retarget).
  "isExternalBase",
  // dart: `importOutsideProject`, the IMPORT/EXPORT claim — different in kind from every key
  // above, and handled by its own verification below. The others claim "the declaration this
  // target names is not in the population", which the key space itself can check (look the
  // owner up). This one claims "the FILE this specifier names is not in this project", which
  // no symbol lookup can check: a specifier is a path, so it is verified against the
  // project's own pubspec files and its admitted file list. Same rule, different evidence.
  "importOutsideProject",
]

/**
 * WHAT A MARKER CLAIMS — because "external" is not one claim, and one check cannot verify two.
 *
 *   owner        the target names a declaration whose OWNER the project does not publish.
 *                Verified by looking the owner up in the name table (`verifyExternalClaim`).
 *   projectFacts the target names a FILE the project does not contain (a package its
 *                pubspec files do not declare, an SDK library it does not carry, a scheme
 *                that is not a path at all). Verified against the project's own facts.
 *
 *   binding      the target names a BINDING — a local, parameter or lambda parameter — which
 *                the family contract publishes no symbol for (DARTD8). There is nothing to
 *                look up and nothing to find: verified against the TARGET'S OWN SPELLING
 *                (`BINDING_SEP` present, and the part after it non-empty), and refuted the
 *                moment the target names a declaration, because that is exactly the state the
 *                spelling exists to make impossible.
 *
 * The kind is decided by WHICH KEY marked the edge, not by the shape of the target: a
 * `package:` target could in principle carry either claim, and choosing the check by shape
 * would be guessing at what the analyzer meant.
 */
export type ExternalClaim = { kind: "owner" | "projectFacts" | "binding" }

/**
 * The marker key that means "the target names a BINDING, not a declaration".
 *
 * A third claim kind, because it is verifiable by NOTHING the other two use. `owner` and
 * `projectFacts` both ask the project about the thing the target DEPENDS ON; a binding claim
 * says the target has no dependency to find — the family contract publishes no locals,
 * parameters or lambda parameters as symbols (DARTD8), so the string can never name a
 * declaration, and the only thing to check is whether the SPELLING says so.
 *
 * The spelling is `<callable>#<binding>` (`BINDING_SEP`, src/ast/types.ts). `#` cannot appear
 * in an identifier in any language of this family, which is what makes this claim checkable
 * by the ARBITER rather than by the analyzer that wrote it: presence of the separator is a
 * fact about the string, and "no published key contains the separator" is a fact about the
 * key space, asserted once per run (see `separatorFreeKeys` — a population tripwire, not a
 * per-edge lookup, because the key space is still being built while the walk classifies).
 */
export const BINDING_CLAIM_KEY = "localBinding"

/** The marker key that means "the FILE is outside this project". Checked after the binding
 *  claim: both are specific, and an edge carrying both is verified on the binding spelling
 *  first because that one is a statement about the target itself. */
export const IMPORT_CLAIM_KEY = "importOutsideProject"

export function externalClaimOf(rel: any): ExternalClaim | null {
  const md = rel?.metadata
  if (!md || typeof md !== "object") return null
  // Checked FIRST, and it is the one claim whose evidence is the target's own spelling rather
  // than a lookup: an edge carrying it says "do not look this up, it is a binding". A lane
  // cannot launder a gap with it — the claim is refuted outright when the target names a
  // declaration (see `classifyEdge`).
  if (md[BINDING_CLAIM_KEY] === true) return { kind: "binding" }
  if (md[IMPORT_CLAIM_KEY] === true) return { kind: "projectFacts" }
  for (const k of EXTERNAL_KEYS) {
    if (k === IMPORT_CLAIM_KEY) continue
    if (md[k] === true) return { kind: "owner" }
    if (Array.isArray(md[k]) && md[k].length > 0) return { kind: "owner" }
  }
  return null
}

/** Is this edge declared as naming something outside the corpus? */
export function isMarkedExternal(rel: any): boolean {
  const md = rel?.metadata
  if (!md || typeof md !== "object") return false
  for (const k of EXTERNAL_KEYS) {
    if (md[k] === true) return true
    // `moduleNamingEdges` is an ARRAY of such flags on some lanes; presence counts.
    if (Array.isArray(md[k]) && md[k].length > 0) return true
  }
  return false
}

export type Outcome =
  | "resolved" | "ambBoth" | "ambDeclOnly" | "unresolved"
  | "externalVerified" | "externalRefuted" | "externalUnverified"
  // A BINDING's outcomes are their own, and are NOT the external ones. A verified binding is
  // not a resolution (nothing was resolved — there is nothing to resolve to) and not a gap
  // either (nothing is missing), so folding it into either column would misstate one of two
  // different things. The lane reports it in its own column, and `bindingRefuted` counts
  // against the lane exactly as `externalRefuted` does.
  | "bindingVerified" | "bindingRefuted" | "bindingUnverified"

/**
 * IS THE TARGET SPELLED AS A BINDING? The one check whose evidence is the target itself.
 *
 * Measured before it was built (`validation/m14/fixtures/dart/local-read-phantom.ts`): a
 * function's own `counter`, published as the bare name, was bound by the store's own rule to
 * an unrelated class's field in another file, because `resolveRelationships` matches a target
 * by NAME and never reads this metadata. The separator is the fix's whole mechanism, so this
 * function's job is to make a spelling that lost it impossible to pass quietly:
 *
 *   bindingVerified    the target carries `BINDING_SEP` and names something after it.
 *   bindingRefuted     the target carries NO separator. A marked edge whose target could be a
 *                      declaration's name is the defect this round exists to remove, and
 *                      "refuted" is the outcome that counts against the lane.
 *   bindingUnverified  a separator with nothing after it (`run#`) — a spelling no producer in
 *                      this family writes, and one no binding can be read out of. Counted,
 *                      never merged into either of the other two.
 */
export function verifyBindingClaim(tgt: string): Outcome {
  const at = tgt.lastIndexOf(BINDING_SEP)
  if (at < 0) return "bindingRefuted"
  return at === tgt.length - 1 ? "bindingUnverified" : "bindingVerified"
}

/**
 * WHAT THE PROJECT ITSELF SAYS, for verifying an IMPORT claim.
 *
 * Built by the caller from the project's own files (never from the analyzer's opinion of
 * them), because a claim verified by its author is not verified:
 *   packages  every package name the project's `pubspec.yaml` files declare;
 *   files     every project-relative path the project ADMITS (tracked, present, under the
 *             analyzer's size cap) — the population, not the filesystem;
 *   sdkLib    whether the project carries an SDK at all (`sdk/lib`).
 */
export type ProjectFacts = {
  packages: Set<string>
  files: Set<string>
  sdkLib: boolean
}

/**
 * CAN THE PROJECT REFUTE AN IMPORT CLAIM?
 *
 * The analyzer refuses to turn a specifier into a path for two different reasons, and only
 * one of them is a claim: a package the checkout does not declare is OUTSIDE it, while a
 * declared package whose file is missing is a DANGLING INTERNAL reference — the analyzer
 * marks the first and not the second, and this function would refute the second if a lane
 * ever marked it, which is the point.
 *
 *   VERIFIED      the package is not declared here / the SDK file is not here. The project
 *                 has looked for what this import depends on and does not have it.
 *   REFUTED       the project DOES contain it, so "outside this project" is false and the
 *                 edge is reported as the defect it is (this is the check that catches an
 *                 analyzer resolving a path key it should have resolved already).
 *   UNVERIFIABLE  the target is not a `package:`/`dart:` specifier at all (another scheme,
 *                 or a shape neither side can turn into a path). Counted, never merged.
 */
export function verifyImportClaim(
  facts: ProjectFacts,
  tgt: string,
): "externalVerified" | "externalRefuted" | "externalUnverified" {
  const raw = tgt.endsWith(":*") ? tgt.slice(0, -2) : tgt
  if (raw.startsWith("package:")) {
    const rest = raw.slice("package:".length)
    const slash = rest.indexOf("/")
    if (slash <= 0) return "externalUnverified"
    const pkg = rest.slice(0, slash)
    if (pkg.length === 0) return "externalUnverified"
    return facts.packages.has(pkg) ? "externalRefuted" : "externalVerified"
  }
  if (raw.startsWith("dart:")) {
    const lib = raw.slice("dart:".length)
    if (lib.length === 0) return "externalUnverified"
    // The SDK's layout, exactly as the analyzer resolves it. A project WITH the file is
    // refuted even if the analyzer's own `sdkLib` probe missed it — the file is the evidence.
    return facts.files.has(`sdk/lib/${lib}/${lib}.dart`) ? "externalRefuted" : "externalVerified"
  }
  return "externalUnverified"
}

/**
 * The owner segment of a qualified target: everything before the FINAL dot.
 *
 * `Object.hashCode` -> `Object`; `package:flutter/material.dart:*` -> a non-identifier,
 * which is the point of returning it rather than a cleaned-up guess.
 */
export function targetOwner(tgt: string): string | null {
  const dot = tgt.lastIndexOf(".")
  if (dot <= 0) return null
  return tgt.slice(0, dot)
}

/**
 * CAN THE POPULATION REFUTE THE CLAIM? An external marker is a claim the corpus can check,
 * and a gate that accepts it unverified is a gate that can be laundered: mark every
 * unresolved edge external and `unresolved` reads 0. So the claim is verified here.
 *
 *   VERIFIED   the target's OWNER is not published anywhere in the key space. The corpus
 *              has looked for the declaration this edge depends on and does not have it —
 *              that is what "outside the declared population" means, measured.
 *   REFUTED    the key space DOES publish the owner. The claim "this names something outside
 *              the corpus" is then false about the owner, and the edge is reported as what
 *              it is: unresolved. It is never counted clean.
 *   UNVERIFIABLE  the target has no identifier-shaped owner to look up (a module URI such
 *              as `package:flutter/material.dart:*`, or a bare unqualified name). The index
 *              cannot confirm or deny, so this is a THIRD bucket — visible, counted, and
 *              deliberately not merged into either of the other two.
 *
 * Calibrated on this programme's own record: `docs/analyzers/INCOMING-WORKLIST.md` says an
 * unmarked external "counts against a lane, because a genuinely-external target and a
 * broken edge are otherwise indistinguishable". This keeps that standard and adds the
 * missing half — a marked one must still survive a lookup.
 */
export function verifyExternalClaim(
  declCount: Map<string, number>,
  tgt: string,
): "externalVerified" | "externalRefuted" | "externalUnverified" {
  const owner = targetOwner(tgt)
  if (owner === null) return "externalUnverified"
  // `:`, `/` or whitespace means the owner is not an identifier — a URI scheme, a path, or
  // a member spelling like `operator ==`. No published symbol can be keyed by it, so a
  // lookup would return 0 for a reason that has nothing to do with the claim.
  if (/[:/\s]/.test(owner)) return "externalUnverified"
  return (declCount.get(owner) ?? 0) > 0 ? "externalRefuted" : "externalVerified"
}

export type Classified = {
  outcome: Outcome
  /** how many declarations answer to the target IN THIS KEY SPACE */
  decls: number
  /** the distinct kinds among them, `|`-joined — empty when there are none */
  kinds: string
  /** WHICH evidence confirmed a verified external claim — reported so a lane can audit the
   *  mechanism that produced the number, not only the number. */
  verifiedBy?: "owner" | "projectFacts" | "binding"
}

/**
 * THE ONE RULE. Measurement and control both call this, because two copies of a counting
 * rule are two rules, and the copy the control runs is the one that stays correct.
 */
export function classifyEdge(
  declCount: Map<string, number>,
  kinds: Map<string, Set<string>>,
  tgt: string,
  claim: ExternalClaim | null,
  /** the project's own facts, for a `projectFacts` claim. Absent means the check could not
   *  be run at all, and the claim is then UNVERIFIABLE — never quietly accepted. */
  facts?: ProjectFacts,
): Classified {
  const decls = declCount.get(tgt) ?? 0
  const kindSet = kinds.get(tgt)
  const kindText = [...(kindSet ?? [])].sort().join("|")
  // A BINDING CLAIM IS CHECKED BEFORE THE COUNT, and that ordering is the whole point: the
  // claim says "this target names a binding, not a declaration", so the moment the key space
  // answers the target with a declaration the claim is FALSE — even though the edge would
  // otherwise read as a happy `resolved`. That is the defect measured in
  // `local-read-phantom.ts`: a bare local name, of which the project declares exactly one,
  // counted as resolved while naming a field of an unrelated class.
  if (claim !== null && claim.kind === "binding") {
    if (decls > 0) return { outcome: "bindingRefuted", decls, kinds: kindText }
    const outcome = verifyBindingClaim(tgt)
    return { outcome, decls, kinds: kindText, verifiedBy: outcome === "bindingVerified" ? "binding" : undefined }
  }
  if (decls === 0) {
    if (claim === null) return { outcome: "unresolved", decls, kinds: kindText }
    if (claim.kind === "projectFacts") {
      if (!facts) return { outcome: "externalUnverified", decls, kinds: kindText }
      const outcome = verifyImportClaim(facts, tgt)
      return { outcome, decls, kinds: kindText, verifiedBy: outcome === "externalVerified" ? "projectFacts" : undefined }
    }
    const outcome = verifyExternalClaim(declCount, tgt)
    return { outcome, decls, kinds: kindText, verifiedBy: outcome === "externalVerified" ? "owner" : undefined }
  }
  if (decls > 1) {
    return { outcome: (kindSet?.size ?? 0) > 1 ? "ambBoth" : "ambDeclOnly", decls, kinds: kindText }
  }
  return { outcome: "resolved", decls, kinds: kindText }
}

/**
 * ONE SCOPE'S TALLY. The gate reports two, because "resolved" is not a property of an edge
 * on its own — it is a property of an edge AGAINST A KEY SPACE, and the two key spaces
 * answer two different questions (see `PROJECT SCOPE` in `incoming-gate.ts`).
 */
export type Outcomes = {
  /** targets resolving to exactly one published declaration */
  resolved: number
  /** targets naming MORE THAN ONE published declaration — the number that matters */
  ambiguousByDecl: number
  /** the same targets, counted by DISTINCT KIND — incoming-check's metric, for comparison */
  ambiguousByKind: number
  /** targets naming nothing published and NOT declared external */
  unresolved: number
  /** targets naming nothing published but carrying an external marker — the claim, total */
  markedExternal: number
  /** of those: the owner is absent, so the claim survives */
  externalVerified: number
  /** of `externalVerified`: confirmed by the owner lookup */
  externalVerifiedByOwner: number
  /** of `externalVerified`: confirmed by the project's own pubspec files and file list */
  externalVerifiedByProjectFacts: number
  /** targets spelled as a BINDING (`<callable>#<binding>`) and not naming a declaration */
  bindingVerified: number
  /** marked as a binding but spelled so it CAN name a declaration — counted against the lane */
  bindingRefuted: number
  /** a separator with nothing after it: countable, but no binding can be read out of it */
  bindingUnverified: number
  /** of those: the target has no identifier-shaped owner to check */
  externalUnverified: number
  /** of those: the key space publishes the owner, so the claim is FALSE and the edge is not clean */
  externalRefuted: number
  /** the colliding TARGET STRINGS, so the gap is a list a lane can act on */
  ambiguousNames: { name: string; declarations: number; kinds: string }[]
  unresolvedNames: { name: string; type: string }[]
}

export const emptyOutcomes = (): Outcomes => ({
  resolved: 0, ambiguousByDecl: 0, ambiguousByKind: 0, unresolved: 0,
  markedExternal: 0, externalVerified: 0, externalVerifiedByOwner: 0, externalVerifiedByProjectFacts: 0,
  externalUnverified: 0, externalRefuted: 0,
  bindingVerified: 0, bindingRefuted: 0, bindingUnverified: 0,
  ambiguousNames: [], unresolvedNames: [],
})

/**
 * COUNT IT WHERE IT BELONGS — one rule, called once per scope, so the two columns can never
 * drift into being two rules.
 */
export function tally(out: Outcomes, c: Classified, tgt: string, label: string): void {
  switch (c.outcome) {
    case "resolved":
      out.resolved++
      break
    case "ambDeclOnly":
    case "ambBoth":
      out.ambiguousByDecl++
      if (c.outcome === "ambBoth") out.ambiguousByKind++
      if (out.ambiguousNames.length < 25) {
        out.ambiguousNames.push({ name: tgt, declarations: c.decls, kinds: c.kinds })
      }
      break
    case "externalVerified":
      out.markedExternal++
      out.externalVerified++
      if (c.verifiedBy === "projectFacts") out.externalVerifiedByProjectFacts++
      else out.externalVerifiedByOwner++
      break
    case "externalUnverified":
      out.markedExternal++
      out.externalUnverified++
      break
    case "bindingVerified":
      out.bindingVerified++
      break
    case "bindingUnverified":
      out.bindingUnverified++
      break
    case "bindingRefuted":
      // NOT `unresolved` (that column means "carries no claim at all") and NOT clean. It is
      // the one outcome that says the SPELLING is wrong, and the verdict counts it as bad.
      out.bindingRefuted++
      if (out.unresolvedNames.length < 25) {
        out.unresolvedNames.push({
          name: `${tgt}   [binding claim REFUTED — the target can name a declaration]`,
          type: label,
        })
      }
      break
    case "externalRefuted":
      // NOT `unresolved` (that column means "carries no external claim") and NOT clean
      // (that column means "names exactly one declaration"). It is its own thing, and
      // the verdict counts it as bad, so a lane cannot mark its way to a PASS.
      out.markedExternal++
      out.externalRefuted++
      if (out.unresolvedNames.length < 25) {
        out.unresolvedNames.push({
          name: `${tgt}   [external claim REFUTED — the population publishes ${targetOwner(tgt)}]`,
          type: label,
        })
      }
      break
    case "unresolved":
      out.unresolved++
      // NAME IT. A count a lane cannot resolve back to the things it counted leaves
      // the only response as re-running the whole lane hoping to see it again — and
      // it is not guaranteed to reproduce. This is the population rule applied to the
      // verdict itself, and it is capped per type so one pathological name (a
      // stdlib function used 40,000 times) cannot produce a 40,000-line report.
      if (out.unresolvedNames.length < 25) out.unresolvedNames.push({ name: tgt, type: label })
      break
  }
}
