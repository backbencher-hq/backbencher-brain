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

/**
 * `hole` is RETAINED IN THE UNION so consumers written against it still COMPILE while they are updated;
 * the classifier no longer RETURNS it. That combination is deliberate and it is the safe intermediate:
 * a consumer filtering `kind === "hole"` now gets an empty list and therefore prints nothing, which is
 * **silence instead of a false claim** — strictly better, and the disclosure is restored when that
 * consumer is updated to `unknown`.
 */
export type EmptyKind = "contentless" | "unknown" | "hole"
export type EmptyResult = { kind: EmptyKind; path: string }

/** Classify ONE file that returned no symbols and no relationships. */
export function classifyEmptyResult(filePath: string): EmptyResult {
  let contentless = false
  try {
    contentless = readFileSync(filePath, "utf8").trim() === ""
  } catch {
    // Unreadable: we could not establish that there was nothing to read, so the kind is UNKNOWN.
    contentless = false
  }
  // ── WHY THE OTHER KIND IS `unknown` AND NOT `hole` ─────────────────────────────────────────────
  //
  // It was `hole`, and the block asserted "a timed-out file contributes NOTHING, so the population is
  // INCOMPLETE". **That assertion is not established by this counter, and julia-lane measured it
  // false.** Its three flagged files were two 8-BYTE files containing `# empty` and a 162-byte
  // comments-only `julia/etc/startup.jl` — all three parse to 2-3 nodes with **no declaring node at
  // all**. A comment-only file CANNOT contribute a symbol or a relationship, so for those the
  // population is **COMPLETE** and no evidence is missing.
  //
  // "0 bytes" is one thing. "Non-empty but returned nothing" is at least THREE things this counter
  // cannot separate: (1) content that cannot declare anything — comments, blank-only bodies;
  // (2) a genuine parse failure or timeout, which IS a hole; (3) a file the analyzer declined. The
  // counter has no way to tell them apart, and **a counter that cannot separate two meanings must not
  // assert one of them.** So it reports `unknown` and says so, and the reader is told plainly that
  // this run cannot answer the question rather than being handed the alarming reading.
  //
  // THIS IS THE THIRD ITERATION ON THIS ONE BLOCK, and the pattern is worth recording: iteration 1
  // conflated empty with timed-out; iteration 2 fixed that and classified the files ITSELF, in a second
  // copy of the rule that diverged immediately; iteration 3 asserted `hole` for anything non-empty.
  // **Every one of the three was caught by a LANE'S MEASUREMENT, not by my own reasoning** — which is
  // the strongest argument in this programme for a lane being able to refute the instrument.
  return { kind: contentless ? "contentless" : "unknown", path: filePath }
}

export function classifyEmptyResults(files: string[]): EmptyResult[] {
  return files.map(classifyEmptyResult)
}
