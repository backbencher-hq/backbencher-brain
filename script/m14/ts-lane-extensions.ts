/**
 * THE LANE'S EXTENSION SET — read LIVE out of the gate's own map, never from memory.
 *
 * ## Why this file exists
 *
 * The charter's standing rule for this campaign: **"Extension lists come from the gate's own map
 * (`script/m14/incoming-gate.ts` LANES_A/LANES_B), never from memory."** A lane's own instrument
 * that hard-codes `"ts,tsx,mts,cts"` is a copy that can drift from the gate, and a drifted
 * population is a number about a population nobody parses.
 *
 * `script/m14/incoming-gate.ts` is a CLI whose module body RUNS the gate (its self-test, then
 * `measure()` over the corpus), so it cannot be `import`ed — the programme's own
 * `script/m14/language-board.ts` says so and PARSES the literal out of the file instead, live, on
 * every run. **This module does the same thing**, for `LANES_A`, and prints the source it read.
 *
 * ## What it returns
 *
 * The extension list for the requested lane, plus the SOURCE it came from, so an instrument can
 * print both and a reader can check the population claim against the gate's own file.
 *
 * ## The fallback
 *
 * If the file cannot be read, or the lane is not in the map, the caller gets the lane's HISTORICAL
 * list and a source string that says so in words — never a silent default that reads as the
 * gate's answer.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"

export const LANES_SRC = "script/m14/incoming-gate.ts"

/** STRIP COMMENTS — without this a comment containing a colon-space-quote becomes a lane entry
 *  (the board measured 24 lanes for 23). */
const stripComments = (src: string): string => {
  let out = ""
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++
      continue
    }
    if (ch === "/" && src[i + 1] === "*") {
      i += 2
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++
      i += 2
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch
      out += ch
      i++
      while (i < src.length && src[i] !== q) {
        if (src[i] === "\\") { out += src[i] ?? ""; i++ }
        out += src[i] ?? ""
        i++
      }
      out += q
      i++
      continue
    }
    out += ch
    i++
  }
  return out
}

export type LaneExtensions = { list: string[]; source: string }

/** THE EXTENSION LIST FOR ONE LANE, read live out of the gate's `LANES_A` map. */
export const laneExtensions = (lane: string, fallback: string[]): LaneExtensions => {
  const abs = path.resolve(process.cwd(), LANES_SRC)
  let raw = ""
  try { raw = readFileSync(abs, "utf8") } catch {
    return { list: fallback, source: `${LANES_SRC} (unreadable — the historical list is used, and this says so)` }
  }
  const src = stripComments(raw)
  const decl = src.indexOf("export const LANES_A")
  if (decl < 0) {
    return { list: fallback, source: `${LANES_SRC} (no LANES_A declaration — the historical list is used, and this says so)` }
  }
  const open = src.indexOf("{", decl)
  let depth = 0, quote = "", end = -1
  for (let i = open; open >= 0 && i < src.length; i++) {
    const ch = src[i]
    if (quote !== "") { if (ch === "\\") i++; else if (ch === quote) quote = ""; continue }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch
    else if (ch === "{") depth++
    else if (ch === "}" && --depth === 0) { end = i; break }
  }
  if (open < 0 || end < 0) {
    return { list: fallback, source: `${LANES_SRC} (unbalanced LANES_A literal — the historical list is used, and this says so)` }
  }
  const body = src.slice(open + 1, end)
  const keyAt = body.indexOf(lane)
  if (keyAt < 0) {
    return { list: fallback, source: `${LANES_SRC} (no "${lane}" entry — the historical list is used, and this says so)` }
  }
  const after = body.slice(keyAt + lane.length)
  const q1 = after.indexOf('"')
  const q2 = after.indexOf("'")
  const qi = q1 < 0 ? q2 : (q2 < 0 ? q1 : Math.min(q1, q2))
  if (qi < 0) {
    return { list: fallback, source: `${LANES_SRC} (the "${lane}" entry is not a quoted string — the historical list is used, and this says so)` }
  }
  const qc = after[qi]
  const close = after.indexOf(qc, qi + 1)
  if (close < 0) {
    return { list: fallback, source: `${LANES_SRC} (the "${lane}" entry is unterminated — the historical list is used, and this says so)` }
  }
  const list = after.slice(qi + 1, close).split(",").map((s) => s.trim()).filter((s) => s.length > 0)
  if (list.length === 0) {
    return { list: fallback, source: `${LANES_SRC} (the "${lane}" entry is empty — the historical list is used, and this says so)` }
  }
  return { list, source: `${LANES_SRC} · LANES_A.${lane}` }
}
