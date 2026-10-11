/**
 * EMPTY-RESULT KIND — did a file that returned NOTHING have nothing to give, or was it a hole?
 *
 * ## Why this is its own module
 *
 * `incoming-gate.ts` counts files that return NO symbols AND NO relationships in ONE counter
 * (`emptyResults`). That counter covers two populations whose meanings are OPPOSITE:
 *
 *   * **contentless** — 0 bytes, or whitespace only. There was nothing to extract, so the run missed
 *     NOTHING and the population is **COMPLETE**. This is not a defect and must never be reported as
 *     one.
 *   * **hole** — the file HOLDS CONTENT and still returned nothing. `engine.ts:1991` returns
 *     `{ language, symbols: [], relationships: [], … }` on an analyzer timeout, so the file
 *     contributes **NO EDGES** and is invisible by construction: it DEFLATES the population and
 *     nothing in the counts shows it. That is a genuine gap in the evidence.
 *
 * The first version of this distinction was written TWICE — once in `incoming-gate.ts` and once in
 * `residual-gate.ts` — and **the two diverged immediately**. `incoming-gate` prefixes each name it
 * prints with `HOLE  ` or `empty `, so the copy in `residual-gate` read `"empty /path"` as a PATH,
 * failed to open it, took its own `catch` branch, and reported three 0-byte files in clean-stdlib as
 * a **population hole** while the instrument one line above called them contentless. A disclosure
 * that fires on the benign case trains its reader to ignore it on the real one, which is worse than
 * not printing it at all.
 *
 * So the rule lives HERE, once, and both the instrument and its control import THIS module. A control
 * pointed at a copy is not a control: the earlier `file-claim.ts` self-test had been importing the
 * lane's tools-directory COPY of the artifact, which would have kept passing while the shipped module
 * regressed — the precise failure a control exists to prevent.
 *
 * ## The unreadable case
 *
 * A file that cannot be read is reported as a **hole**, not as contentless. "Unreadable" is a gap in
 * the evidence, and defaulting it to `contentless` would silently shrink the disclosure to nothing —
 * the same error direction this module exists to stop.
 */

import { readFileSync } from "node:fs"

export type EmptyKind = "contentless" | "hole"
export type EmptyResult = { kind: EmptyKind; path: string }

/** Classify ONE file that returned no symbols and no relationships. */
export function classifyEmptyResult(filePath: string): EmptyResult {
  let contentless = false
  try {
    contentless = readFileSync(filePath, "utf8").trim() === ""
  } catch {
    // Unreadable is a HOLE: we could not establish that there was nothing to read.
    contentless = false
  }
  return { kind: contentless ? "contentless" : "hole", path: filePath }
}

export function classifyEmptyResults(files: string[]): EmptyResult[] {
  return files.map(classifyEmptyResult)
}
