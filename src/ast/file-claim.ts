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

/**
 * THE INDEXER'S OWN ADMISSION CAP. `src/ast/parallel-indexer.ts` skips a file larger than
 * `maxFileSizeBytes` (1 MB) and extracts it structurally instead, so such a file is NOT in the
 * population a claim is checked against — and a claim about it is REFUTED, not merely unverified.
 * Exported so a lane passes one identifier rather than re-typing a magic number.
 */
export const FILE_CLAIM_MAX_BYTES = 1 * 1024 * 1024

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
   *
   * **THE VALUES MUST BE PROJECT-RELATIVE, AND THIS IS THE ONE CLAUSE WHOSE MISUSE PRODUCES NO
   * SIGNAL.** The substitution happens HERE, BEFORE the shape check below, so an ABSOLUTE value (the
   * obvious thing to pass — `path.dirname(filePath)`) makes the whole target begin with `/` and the
   * guard refuses it as an absolute path. MEASURED: php's include claim lost **145 of its 147 claims**
   * (`extOK 6,443 -> 6,298`) the first time it was put on this guard, with **no refutation, no error
   * and no counter** to say why — just a smaller number. Pass a project-relative directory, and `.`
   * for a file at the project root: an empty string would leave a leading slash and reintroduce the
   * same silent loss. (`__FILE__` takes the project-relative path of the file itself.)
   */
  magicConstants?: Readonly<Record<string, string>>
  /**
   * The population's size cap, when the lane's admitted list has one. A candidate LARGER than this is
   * not admitted, so it is not claimable: the guard refuses it exactly as it refuses a missing file,
   * because a claim about it would be REFUTED. Omit it only where the lane's population has no cap.
   */
  maxFileSizeBytes?: number
}

/**
 * Fold a written path onto a base directory, in pure String.
 * Returns null when it is not a plain relative path or when it escapes the base.
 */
export function foldProjectPath(baseDir: string, written: string): string | null {
  const rel = projectRelativeOf(baseDir, written)
  // AN EMPTY RESULT MEANS THE PROJECT ROOT, AND THE ROOT IS NOT A FILE. Callers of this function want
  // a path they can stat, so the root is not one — but a caller whose target names a DIRECTORY needs
  // to know it reached the root, and that is what `projectRelativeOf` answers.
  return rel !== null && rel.length > 0 ? rel : null
}

/**
 * The same fold, with ONE difference that matters to DIRECTORY-SHAPED targets: a path that lands
 * exactly on the project root returns `""` rather than null.
 *
 * MEASURED, toml, whole population (1,485 files): `path = ".."` in `docs/Project.toml` and `"../.."`
 * two levels down land on the root, where `Project.toml` really is — and the gate VERIFIES that
 * claim. Ten edges were lost to this case before it was handled, and the loss is INVISIBLE to every
 * FILE-shaped lane, which is why it survived five lane adoptions of the shared guard: a file-shaped
 * target never produces an empty project-relative form because it always names a file.
 */
export function projectRelativeOf(baseDir: string, written: string): string | null {
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
  return out.join("/")
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
      const st = statSync(path.join(root, candidate))
      if (!st.isFile()) continue
      if (input.maxFileSizeBytes !== undefined && st.size > input.maxFileSizeBytes) continue
    } catch { continue }
    return candidate
  }
  return null
}
