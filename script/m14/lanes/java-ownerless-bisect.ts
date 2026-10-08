/**
 * java-ownerless-bisect.ts — DERIV_EXPORTS_JAVA3.
 *
 * The annotated varargs ALONE does not reproduce the corpus defect. Measured in
 * java-varargs-annotation-grammar.ts: cases C, D and E — `@N Object @N ... rest`,
 * the exact shape Preconditions.java uses — produce ERROR nodes (2 in each) and
 * still keep 2/2 methods inside the class_body. So the annotated varargs is
 * NECESSARY-SUSPECTED but NOT SUFFICIENT, and claiming it was the trigger would
 * be exactly the prose-instead-of-measurement failure the ontology gate exists to
 * stop.
 *
 * This probe bisects the REAL file instead. It parses the real Preconditions.java,
 * takes the direct children of the class_body (which the grammar does produce,
 * 108 of them), and emits synthetic compilations that keep a CHOSEN subset of
 * those members verbatim — source slices, so the text is never rewritten — and
 * then asks the tree the only question that matters:
 *
 *     does the class_declaration still END at the last kept member?
 *
 * It walks members by DELETION from both ends, then halves the survivor window,
 * and reports the smallest member set that still reproduces the truncation. The
 * population is the 108 class_body children, derived by tree walk; nothing is a
 * hand-written list and nothing is matched by a regular expression.
 *
 * NO REGEX. Tree walk + source slicing by byte offsets only.
 */
import { readFileSync } from "node:fs"
import { getParser } from "../../../src/ast/engine"

const FILE = process.env.PROBE_FILE ??
  "$HOME/fixtures/repositories/java-lib/guava/src/com/google/common/base/Preconditions.java"

interface Member { i: number; type: string; startLine: number; endLine: number; start: number; end: number }

function describe(n: any): string {
  let nm = ""
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && (c.type === "identifier" || c.type === "type_identifier")) { nm = c.text; break }
  }
  return nm ? `${n.type} ${nm}` : n.type
}

/** Build a compilation unit from the real file: header (everything before the
 *  class_body's `{`) + kept member slices + the class's closing brace.
 *
 *  THE BRACE MUST COME FROM THE FILE'S REAL END, NOT FROM `clsBody.endIndex`.
 *
 *  The first version of this function used `src.slice(clsBody.endIndex - 1)` for
 *  the tail. That is wrong in exactly the case this probe exists to investigate:
 *  in the unreduced parse the grammar ALREADY truncated class_body at line 1003 of
 *  1541, so `clsBody.endIndex` was the brace of the truncated body and the "tail"
 *  was the 30 orphaned methods plus the rest of the file. Every synthetic unit
 *  therefore still contained the orphans, every bisect verdict came back
 *  "REPRODUCES", and the instrument reported a result while measuring nothing.
 *
 *  That is worth recording beyond this file: it is the same shape as
 *  EXPORTS_JAVA2's recorded bisect, which reported the orphan count moving in
 *  BOTH directions (59, 42, 0, 15 against a baseline of 30) as any 49-member
 *  window was emptied. A measurement that moves the answer in both directions
 *  under deletion is not a measurement of the construct; here it was a measurement
 *  of the tail.
 *
 *  Character walk, not a regular expression: the class's closing brace is the last
 *  `}` in the source, found by scanning backwards from the end of the string.
 *  For a compilation unit whose outermost declaration is this class, that is the
 *  class's brace. The probe PRINTS the brace it chose and the offset it came from
 *  so a wrong choice is visible rather than silent. */
function lastBraceIndex(src: string): number {
  for (let i = src.length - 1; i >= 0; i--) if (src.charCodeAt(i) === 125) return i // '}'
  return src.length - 1
}
function build(src: string, clsBody: any, members: Member[], realBrace: number): string {
  const head = src.slice(0, clsBody.startIndex + 1) // up to and including `{`
  const tail = src.slice(realBrace)                // the class's REAL `}` onward
  return head + "\n" + members.map(m => src.slice(m.start, m.end)).join("\n") + "\n" + tail
}

/** The one question. Returns the class_declaration's end line, and the number
 *  of method_declarations that ended up as direct children of `program`. */
function probe(parser: any, text: string): { clsEnd: number; orphanMethods: number; totalMethods: number; errs: number } {
  const tree = parser.parse(text)
  let cls: any = null
  const s0 = [tree.rootNode]
  while (s0.length) {
    const n = s0.pop(); if (!n) continue
    if (n.type === "class_declaration") { cls = n; break }
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) s0.push(c) }
  }
  let errs = 0
  const se = [tree.rootNode]
  while (se.length) {
    const n = se.pop(); if (!n) continue
    if (n.type === "ERROR" || n.isMissing) errs++
    for (let i = n.childCount - 1; i >= 0; i--) { const c = n.child(i); if (c) se.push(c) }
  }
  let totalMethods = 0, orphanMethods = 0
  for (let i = 0; i < tree.rootNode.namedChildCount; i++) {
    const c = tree.rootNode.namedChild(i)
    if (c && c.type === "method_declaration") { totalMethods++; orphanMethods++ }
  }
  let inClass = 0
  if (cls) {
    const body = (() => { for (let i = 0; i < cls.namedChildCount; i++) { const c = cls.namedChild(i); if (c && c.type === "class_body") return c } return null })()
    if (body) {
      const st = [body]
      while (st.length) {
        const n = st.pop(); if (!n) continue
        if (n.type === "method_declaration") inClass++
        for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) st.push(c) }
      }
    }
  }
  totalMethods += inClass
  return { clsEnd: cls ? cls.endPosition.row + 1 : -1, orphanMethods, totalMethods, errs }
}

async function main() {
  const src = readFileSync(FILE, "utf8")
  const REAL_BRACE = lastBraceIndex(src)
  const parser = await getParser("java")

  const base = parser.parse(src)
  if (!base) throw new Error("parser.parse returned no tree (null result)")
  let cls: any = null
  const s0 = [base.rootNode]
  while (s0.length) {
    const n = s0.pop(); if (!n) continue
    if (n.type === "class_declaration") { cls = n; break }
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) s0.push(c) }
  }
  if (!cls) { console.error("no class_declaration found"); process.exit(2) }
  let clsBody: any = null
  for (let i = 0; i < cls.namedChildCount; i++) { const c = cls.namedChild(i); if (c && c.type === "class_body") { clsBody = c; break } }
  if (!clsBody) { console.error("no class_body"); process.exit(2) }

  const members: Member[] = []
  for (let i = 0; i < clsBody.namedChildCount; i++) {
    const c = clsBody.namedChild(i)!
    members.push({ i, type: c.type, startLine: c.startPosition.row + 1, endLine: c.endPosition.row + 1, start: c.startIndex, end: c.endIndex })
  }
  console.log(`FILE ${FILE}`)
  console.log(`class's REAL closing brace chosen for the synthetic tail: byte ${REAL_BRACE}` +
    ` (line ${src.slice(0, REAL_BRACE).split("\n").length}); ` +
    `clsBody.endIndex in the UNREDUCED parse is byte ${clsBody.endIndex} (line ${clsBody.endPosition.row + 1})` +
    `${clsBody.endIndex === REAL_BRACE ? "  [they agree]" : "  [they DISAGREE — the tail-bleed bug this file documents]"}`)
  console.log(`class_body named children (the bisect population): ${members.length}`)
  console.log(`  first: ${members[0].type} lines ${members[0].startLine}..${members[0].endLine}`)
  console.log(`  last : ${members[members.length - 1].type} lines ${members[members.length - 1].startLine}..${members[members.length - 1].endLine}`)
  const full = probe(parser, src)
  console.log(`  UNREDUCED: class_declaration ends line ${full.clsEnd} of ${src.split("\n").length}; ` +
    `orphan methods at program level: ${full.orphanMethods}/${full.totalMethods}; ERROR/MISSING nodes: ${full.errs}\n`)

  const reproduces = (keep: Member[]) => probe(parser, build(src, clsBody, keep, REAL_BRACE)).orphanMethods > 0

  console.log(`\nGREEDY MINIMISATION from all ${members.length} members, removing one at a time:`)
  let minimal = members.slice()
  console.log(`  start: ${minimal.length} members, reproduces=${reproduces(minimal)}`)
  if (!reproduces(minimal)) {
    console.log(`  THE UNREDUCED FILE DOES NOT REPRODUCE THROUGH THIS BUILDER. Stopping —`)
    console.log(`  reporting that is the honest outcome; the numbers above still describe it.`)
    return
  }
  let pass = 0
  let changed = true
  while (changed) {
    changed = false
    pass++
    for (let i = 0; i < minimal.length; i++) {
      const cand = minimal.slice(0, i).concat(minimal.slice(i + 1))
      if (cand.length > 0 && reproduces(cand)) {
        const dropped = minimal[i]
        console.log(`  pass ${pass}: removing member #${dropped.i} ${dropped.type.padEnd(22)} lines ${dropped.startLine}..${dropped.endLine} — STILL reproduces, so it is not needed`)
        minimal = cand; changed = true; i--
      } else {
        console.log(`  pass ${pass}: removing member #${minimal[i].i} ${minimal[i].type.padEnd(22)} lines ${minimal[i].startLine}..${minimal[i].endLine} — stops reproducing, so it IS NEEDED`)
      }
    }
  }
  console.log(`\nMINIMAL MEMBER SET: ${minimal.length} member(s)`)
  for (const m of minimal) {
    const slice = src.slice(m.start, m.end)
    console.log(`\n  --- member #${m.i} ${m.type} lines ${m.startLine}..${m.endLine} (${slice.length} bytes) verbatim ---`)
    for (const ln of slice.split("\n")) console.log(`  | ${ln}`)
  }

  // Is ONE member enough, on its own, with no neighbours?
  console.log(`\nSINGLE-MEMBER ISOLATION over the ${minimal.length} needed member(s):`)
  for (const m of minimal) {
    console.log(`  alone, member #${m.i} ${m.type} lines ${m.startLine}..${m.endLine}: reproduces=${reproduces([m])}`)
  }
  // And what does the first needed member alone do to the ERROR count (as
  // opposed to the orphan count)?
  for (const m of minimal) {
    const r = probe(parser, build(src, clsBody, [m], REAL_BRACE))
    console.log(`    -> class_declaration ends line ${r.clsEnd}; orphans ${r.orphanMethods}/${r.totalMethods}; ERROR/MISSING ${r.errs}`)
  }

  const finalText = build(src, clsBody, minimal, REAL_BRACE)
  const fr = probe(parser, finalText)
  console.log(`\n--- the full minimal source, verbatim, for a fixture ---`)
  for (const ln of finalText.split("\n")) console.log(`| ${ln}`)
  console.log(`\nMINIMAL REPRODUCTION, ${minimal.length} member(s):`)
  console.log(`  class_declaration ends line ${fr.clsEnd}; orphan methods at program level ${fr.orphanMethods}/${fr.totalMethods}; ERROR/MISSING nodes ${fr.errs}`)
}

main().catch(e => { console.error(e); process.exit(1) })