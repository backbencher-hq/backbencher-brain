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
]

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
}

/**
 * THE ONE RULE. Measurement and control both call this, because two copies of a counting
 * rule are two rules, and the copy the control runs is the one that stays correct.
 */
export function classifyEdge(
  declCount: Map<string, number>,
  kinds: Map<string, Set<string>>,
  tgt: string,
  markedExternal: boolean,
): Classified {
  const decls = declCount.get(tgt) ?? 0
  const kindSet = kinds.get(tgt)
  const kindText = [...(kindSet ?? [])].sort().join("|")
  if (decls === 0) {
    const outcome = markedExternal ? verifyExternalClaim(declCount, tgt) : "unresolved"
    return { outcome, decls, kinds: kindText }
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
  markedExternal: 0, externalVerified: 0, externalUnverified: 0, externalRefuted: 0,
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
      break
    case "externalUnverified":
      out.markedExternal++
      out.externalUnverified++
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
