// Delta-debug a groovy parse failure down to a MINIMAL failing source, so the
// next round works from a repro instead of a hunch about a file.
//
// THE PROPERTY IS NOT `hasError`. Measured, in this order, on
// end-to-end/spring-dependency-management/grails-app/controllers/UrlMappings.groovy:
//   - `hasError` alone reduced the 34-line file to a single `}` — any fragment no
//     Groovy parser could read satisfies it;
//   - adding a brace-balance guard produced the orphan block-comment body
//     `*  under the License.` — a truncated comment is itself an error;
//   - adding a "deleting the error node leaves clean source" guard produced
//     `constraints {` — an unclosed brace whose deletion leaves the empty
//     string, which parses clean.
// The first two are MANUFACTURED failures, and the census carries the same
// illusion: 31 of its 370 failing files report a bare `}` as their first error
// line. A candidate is therefore accepted only when all four hold:
//
//   1. it fails                  — rootNode.hasError;
//   2. the failure is LOCALIZED  — deleting the first non-zero-width
//                                  ERROR/MISSING node leaves source that parses
//                                  clean (the failure lives at its own span, not
//                                  in the file's global structure);
//   3. no protected range is cut — every comment / string literal of the ORIGINAL
//                                  that spans several lines is kept whole or
//                                  dropped whole, so the candidate cannot contain
//                                  half a comment or half a string;
//   4. the code delimiters match — braces, parens and brackets balance once the
//                                  protected ranges are removed.
//
// Two phases, both on line boundaries:
//   1. chunk removal — delete aligned blocks of decreasing size, keeping a
//      candidate that satisfies the property;
//   2. boundary trim — drop leading/trailing lines that are not needed.
// Nothing is claimed about WHY the reduced form fails: the failure is measured,
// the trigger is what a reader then has to explain.
//
// Usage: bun script/m59/reduce-groovy-parse-failure.ts <file> [--max-lines N]
import * as fs from "fs"

async function main(): Promise<void> {
  const file = process.argv[2]
  const maxLines = process.argv.includes("--max-lines")
    ? parseInt(process.argv[process.argv.indexOf("--max-lines") + 1])
    : 400
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P()
  parser.setLanguage(lang)

  const src = fs.readFileSync(file, "utf8")
  const orig = src.split("\n")
  const lineStart: number[] = []
  {
    let off = 0
    for (const l of orig) {
      lineStart.push(off)
      off += l.length + 1
    }
  }
  const lineOf = (index: number): number => {
    let lo = 0
    let hi = lineStart.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStart[mid] <= index) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  const firstError = (root: any): any => {
    let found: any = null
    const walk = (n: any): void => {
      if (found) return
      if ((n.type === "ERROR" || n.isMissing) && n.endIndex > n.startIndex) {
        found = n
        return
      }
      for (let i = 0; i < n.childCount && !found; i++) walk(n.child(i))
    }
    walk(root)
    return found
  }

  // Protected ranges of the ORIGINAL: comments and string literals, outermost
  // only (a string's fragments are covered by the string itself).
  const protectedRanges: Array<{ start: number; end: number }> = []
  const collect = (n: any): void => {
    if (/comment|string|gstring/.test(n.type)) {
      if (n.endIndex > n.startIndex) protectedRanges.push({ start: n.startIndex, end: n.endIndex })
      return
    }
    for (let i = 0; i < n.childCount; i++) collect(n.child(i))
  }
  const origRoot = parser.parse(src)?.rootNode
  collect(origRoot)
  // Multi-line ranges, as the set of original line indices they occupy.
  const multiLine: Array<Set<number>> = protectedRanges
    .map((r) => {
      const a = lineOf(r.start)
      const b = lineOf(Math.max(r.start, r.end - 1))
      const s = new Set<number>()
      for (let i = a; i <= b; i++) s.add(i)
      return s
    })
    .filter((s) => s.size > 1)

  const codeWithoutProtected = (text: string): string => {
    const chars = text.split("")
    for (const r of protectedRanges) {
      for (let i = r.start; i < r.end && i < chars.length; i++) chars[i] = " "
    }
    return chars.join("")
  }

  const whyRejected: string[] = []
  const fails = (idx: number[]): boolean => {
    const text = idx.map((i) => orig[i]).join("\n")
    const root = parser.parse(text)?.rootNode
    if (!root?.hasError) return false
    // (2) the failure is localized
    const err = firstError(root)
    if (!err) {
      whyRejected.push("no ERROR/MISSING node")
      return false
    }
    const without = text.slice(0, err.startIndex) + text.slice(err.endIndex)
    const clean = parser.parse(without)?.rootNode
    if (!clean || clean.hasError) {
      whyRejected.push("deleting the failing node does not leave clean source (global-structure failure)")
      return false
    }
    // (5) THE FAILING NODE MUST NOT BEGIN ON THE CANDIDATE'S FIRST LINE.
    //
    // Guards 1–4 do not establish locality when the failure is the recovery
    // WRAPPER: tree-sitter wraps the unparseable remainder in one ERROR node, and
    // deleting that node leaves text with nothing left to fail on — so guard (2)
    // passes while the candidate carries no localizable trigger at all. Measured:
    // reducing `grails-mail/.../MailMessageBuilder.groovy` (whose original failure
    // is genuinely localized at row 45) produced a candidate of deleted-lines soup
    // whose report was `ERROR row 1 col 1 :: "/*\n * Copyright …"` — a wrapper, i.e.
    // the third generation of the manufactured repro this file's header documents.
    // A failure that starts on the first line cannot be told apart from the
    // wrapper by anything this tool measures, so it is REFUSED rather than emitted:
    // the contract is a minimal LOCALIZED repro, and a trustworthy "cannot localize
    // this file" is worth more than a candidate a reader will mistake for a trigger.
    if ((err.startPosition?.row ?? 0) === 0) {
      whyRejected.push("failing node begins on the candidate's first line (wrapper-shaped: not a localized trigger)")
      return false
    }
    // (3) no protected range is cut
    const kept = new Set(idx)
    for (const range of multiLine) {
      let inside = 0
      for (const l of range) if (kept.has(l)) inside++
      if (inside !== 0 && inside !== range.size) return false
    }
    // (4) the code delimiters match
    const code = codeWithoutProtected(text)
    const count = (ch: string): number => code.split(ch).length - 1
    return count("{") === count("}") && count("(") === count(")") && count("[") === count("]")
  }

  const all = orig.map((_, i) => i)
  if (!fails(all)) {
    const last = whyRejected[whyRejected.length - 1] ?? "unknown"
    console.log(`the file does not fail under the reducer's property at this wasm — nothing to reduce`)
    console.log(`  reason: ${last}`)
    return
  }
  whyRejected.length = 0
  console.log(`original: ${orig.length} lines, fails (localized, integrity-checked)`)

  let best = all.slice()
  let gran = Math.max(1, Math.floor(best.length / 2))
  while (gran >= 1) {
    let i = 0
    let changed = false
    while (i < best.length) {
      const cand = best.slice(0, i).concat(best.slice(i + gran))
      if (cand.length > 0 && fails(cand)) {
        best = cand
        changed = true
      } else {
        i += gran
      }
    }
    if (!changed) gran = Math.floor(gran / 2)
  }
  while (best.length > maxLines) {
    const cand = best.slice(1)
    if (fails(cand)) best = cand
    else break
  }

  const out = best.map((i) => orig[i]).join("\n")
  console.log(`\nreduced to ${best.length} lines (original line numbers ${best[0] + 1}..${best[best.length - 1] + 1}):`)
  console.log("-".repeat(60))
  console.log(out)
  console.log("-".repeat(60))
  const root = parser.parse(out)?.rootNode
  console.log(`fails=${root?.hasError}`)
  const err = firstError(root)
  if (err) {
    console.log(
      `${err.isMissing ? "MISSING" : "ERROR"} ${err.type} row ${err.startPosition.row + 1} col ${err.startPosition.column + 1} :: ${JSON.stringify((err.text || "").slice(0, 160))}`,
    )
  }
  fs.writeFileSync("/tmp/g841-reduced.groovy", out + "\n")
  console.log("written to /tmp/g841-reduced.groovy")
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
