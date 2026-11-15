/**
 * THE SHARED FILE CLAIM — one guard for every lane whose edge names a FILE rather than a
 * declaration (`imports` in json, php, protobuf, graphql, clean, scss, zig, toml; and any later lane
 * that measures one).
 *
 * ## Why it is shared, and what is NOT
 *
 * The GUARD is the same in every lane: resolve the target to a project-relative path, require an
 * extension the lane's OWN admitted list holds, require the file to exist, and refuse anything that
 * escapes the project. The CANDIDATE ARITHMETIC is not shareable and is deliberately left to the
 * caller: a path is folded (protobuf, graphql, zig, json, toml), a Sass specifier has to try
 * `_partial` and `_index.scss` spellings (scss), and a Clean import is `Module:item` — a MODULE with
 * an item suffix, which is not a path at all. A shared rule would have silently mis-bound that last
 * one.
 *
 * ## The measurement this guard is the shape of
 *
 * `validation/m14/fixtures/toml/tools/imports-claim-pricing.mts` priced the claim across five lanes
 * before one was emitted: 3,921 edges would VERIFY and 392 would REFUTE. Every refutation was an
 * extension the lane's population cannot hold — `build.zig.zon` (a package manifest, not a `.zig`
 * source) and `_all.sass` (`.sass` routes to language `sass`, not to the scss lane). Adding the
 * admitted-extension clause took refutations to **0 in all five lanes**, which is why that clause is
 * INSIDE this guard rather than left to callers: a file claim is a statement the project can check,
 * and THE GATE CHECKS A CLAIM BEFORE THE COUNT, so a wrongly-attached claim does not merely fail to
 * help — it BREAKS an edge that would otherwise resolve. `extFAIL` must stay 0.
 *
 * The two guards this generalises, which stay correct until they adopt it:
 *   - `real-json-analyzer.ts` — three sites, the original
 *   - `real-php-analyzer.ts` — `claimResolvableIncludes`, which additionally resolves `__DIR__` and
 *     `__FILE__` in pure String (this guard takes those as `magicConstants`)
 */

import { statSync } from "node:fs"
import * as path from "node:path"

/** Characters that mean the target is not a plain path (glob, whitespace, shell expansion). */
const NOT_A_PLAIN_PATH = [" ", "\t", "*", "?", "<", ">", "|", "{", "}", "$"]

export type FileClaimInput = {
  /** The project root the claim will be checked against — the lane's admitted scope. */
  projectRoot: string
  /** The file the edge is written in. Its directory is the base a relative path resolves against. */
  filePath: string
  /** The target as written in the source. The claim is a statement ABOUT this, never a rewrite. */
  written: string
  /**
   * The extensions the lane's ADMITTED list can hold, WITHOUT the dot and lowercase (e.g. `["zig"]`,
   * `["scss"]`, `["proto"]`). Required, because the arbiter's facts are exactly this list: a claim
   * about any other extension can never verify, while a miss still REFUTES.
   */
  admittedExtensions: readonly string[]
  /**
   * Lane arithmetic, already folded: extra spellings to try (Sass `_partial`/`_index.scss`, a Clean
   * `Module` -> `Module.icl`). Tried AFTER the written path itself.
   */
  extraCandidates?: readonly string[]
  /**
   * Magic constants the analyzer knows without the filesystem — php's `__DIR__`/`__FILE__`,
   * python's `__file__`. Values are substituted into the written target in pure String, longest key
   * first so `dirname(__FILE__)` is not left mangled.
   */
  magicConstants?: Readonly<Record<string, string>>
}

/**
 * Fold a written path onto a base directory, in pure String.
 * Returns null when it is not a plain relative path or when it escapes the base.
 */
export function foldProjectPath(baseDir: string, written: string): string | null {
  const w = written.trim()
  if (w.length === 0 || w.length > 300) return null
  if (w.includes("://") || w.startsWith("/") || w.startsWith("~") || w.startsWith("\\")) return null
  for (const ch of NOT_A_PLAIN_PATH) if (w.includes(ch)) return null
  const out: string[] = []
  for (const seg of (baseDir + w).split("/")) {
    if (seg.length === 0 || seg === ".") continue
    if (seg === "..") { if (out.length === 0) return null; out.pop(); continue }
    out.push(seg)
  }
  return out.length > 0 ? out.join("/") : null
}

/** The directory part of a repo-relative POSIX path, with a trailing slash, or "" at the root. */
export function dirOf(rel: string): string {
  const i = rel.lastIndexOf("/")
  return i < 0 ? "" : rel.slice(0, i + 1)
}

const extOf = (rel: string): string => {
  const dot = rel.lastIndexOf(".")
  const slash = rel.lastIndexOf("/")
  return dot > slash && dot >= 0 ? rel.slice(dot + 1).toLowerCase() : ""
}

/**
 * The one guard. Returns the project-relative POSIX path to record as `metadata.importProjectFile`,
 * or null when no candidate can be confirmed — and null is the safe answer, because an unconfirmed
 * claim is what REFUTES.
 */
export function fileClaimForTarget(input: FileClaimInput): string | null {
  const { projectRoot, filePath, admittedExtensions } = input
  if (projectRoot.length === 0 || admittedExtensions.length === 0) return null
  let written = input.written.trim()
  if (written.length === 0) return null

  // MAGIC CONSTANTS FIRST, in pure String, longest key first: `dirname(__FILE__)` must be substituted
  // before `__FILE__`, or the value lands inside a `dirname(…)` that was never resolved.
  const magic = input.magicConstants
  if (magic) {
    for (const key of Object.keys(magic).sort((a, b) => b.length - a.length)) {
      if (key.length > 0) written = written.split(key).join(magic[key])
    }
  }

  const root = path.resolve(projectRoot)
  const fileRel = path.relative(root, filePath).split(path.sep).join("/")
  const candidates: string[] = []
  for (const c of [foldProjectPath(dirOf(fileRel), written), foldProjectPath("", written), ...(input.extraCandidates ?? [])]) {
    if (c !== null && c.length > 0 && !candidates.includes(c)) candidates.push(c)
  }

  const admitted = new Set(admittedExtensions.map((e) => e.replace(/^\./, "").toLowerCase()))
  for (const candidate of candidates) {
    if (candidate === ".." || candidate.startsWith("../")) continue
    // THE ARBITER'S KEY SPACE HOLDS THESE EXTENSIONS AND NOTHING ELSE — the clause that took
    // refutations from 392 to 0 across five lanes.
    if (!admitted.has(extOf(candidate))) continue
    try {
      if (!statSync(path.join(root, candidate)).isFile()) continue
    } catch { continue }
    return candidate
  }
  return null
}
