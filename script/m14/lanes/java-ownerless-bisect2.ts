/**
 * java-ownerless-bisect2.ts — DERIV_EXPORTS_JAVA3.
 *
 * Bisection with the CONSEQUENCE kept.
 *
 * java-ownerless-bisect.ts (fixed version) produced a control result that
 * invalidated its own search population:
 *
 *   - unreduced Preconditions.java: class_declaration ends line 1003 of 1541,
 *     30 methods orphaned to `program` level, 10 ERROR/MISSING nodes.
 *   - head + the 108 class_body members + the class's REAL `}`: CLEAN. 0 orphans.
 *
 * So the 30 trailing methods are the CONSEQUENCE of the truncation, not its
 * cause. Removing them lets the parser close the class normally. Bisecting over
 * the 108 members alone therefore cannot reproduce anything, and the first run
 * of that probe reported "does not reproduce" for every subset — a correct
 * measurement of the wrong population, which is the honesty contract's named
 * failure shape.
 *
 * This probe therefore keeps the consequence and bisects the cause: the
 * population is [subset of the 108 class_body members] + [the trailing program
 * members the unreduced parse produced], and only the 108 are candidates for
 * removal. If the truncation is caused by one of the 108, removing it stops the
 * cascade even with the trailing text present.
 *
 * NO REGEX. Tree walk + byte-offset slicing. The trailing members are located by
 * node type and source order, not by matching text.
 */
import { readFileSync } from "node:fs"
import { getParser } from "../../../src/ast/engine"

const FILE = process.env.PROBE_FILE ??
  "$HOME/fixtures/repositories/java-lib/guava/src/com/google/common/base/Preconditions.java"

interface Slice { label: string; start: number; end: number; startLine: number; endLine: number; type: string }

function lastBraceIndex(src: string): number {
  for (let i = src.length - 1; i >= 0; i--) if (src.charCodeAt(i) === 125) return i
  return src.length - 1
}

function findFirst(root: any, type: string): any {
  const s = [root]
  while (s.length) {
    const n = s.pop(); if (!n) continue
    if (n.type === type) return n
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) s.push(c) }
  }
  return null
}

function probe(parser: any, text: string) {
  const tree = parser.parse(text)
  const cls = findFirst(tree.rootNode, "class_declaration")
  let errs = 0, orphans = 0
  const se = [tree.rootNode]
  while (se.length) {
    const n = se.pop(); if (!n) continue
    if (n.type === "ERROR" || n.isMissing) errs++
    for (let i = n.childCount - 1; i >= 0; i--) { const c = n.child(i); if (c) se.push(c) }
  }
  for (let i = 0; i < tree.rootNode.namedChildCount; i++) {
    const c = tree.rootNode.namedChild(i)
    if (c && c.type === "method_declaration") orphans++
  }
  return {
    clsEndLine: cls ? cls.endPosition.row + 1 : -1,
    clsEndByte: cls ? cls.endIndex : -1,
    orphans,
    errs,
  }
}

/** TRUNCATION, measured by BYTE OFFSET, which is invariant under the slicing
 *  this probe does.
 *
 *  The first version used a LINE number and a count of orphaned methods, and
 *  both were wrong for the job:
 *   - a line number is not comparable across synthetic files whose line count
 *     changes as members are removed;
 *   - `orphans` counts the CONSEQUENCE, and the consequence is present in a file
 *     where the class closes early *because there is nothing after it*, so
 *     "orphans > 0" was true for subsets that had not been truncated at all.
 *
 *  The class_declaration must END on the class's real closing brace. If its
 *  endIndex is not that brace's offset, the class body closed early and the
 *  rest of the file fell out of it. That is the thing to minimise. */
function truncates(parser: any, text: string, realBraceInText: number): boolean {
  const tree = parser.parse(text)
  const cls = findFirst(tree.rootNode, "class_declaration")
  if (!cls) return false
  return cls.endIndex !== realBraceInText
}

async function main() {
  const src = readFileSync(FILE, "utf8")
  const realBrace = lastBraceIndex(src)
  const parser = await getParser("java")
  const base = parser.parse(src)
  if (!base) throw new Error("parser.parse returned no tree (null result)")

  const cls = findFirst(base.rootNode, "class_declaration")!
  let clsBody: any = null
  for (let i = 0; i < cls.namedChildCount; i++) { const c = cls.namedChild(i); if (c && c.type === "class_body") { clsBody = c; break } }
  if (!clsBody) { console.error("no class_body"); process.exit(2) }

  const classMembers: Slice[] = []
  for (let i = 0; i < clsBody.namedChildCount; i++) {
    const c = clsBody.namedChild(i)!
    classMembers.push({ label: `#${i}`, start: c.startIndex, end: c.endIndex, startLine: c.startPosition.row + 1, endLine: c.endPosition.row + 1, type: c.type })
  }

  // The consequence, kept verbatim: every program-level child AFTER the
  // class_declaration, up to the class's real closing brace.
  const trailing: Slice[] = []
  for (let i = 0; i < base.rootNode.namedChildCount; i++) {
    const c = base.rootNode.namedChild(i)!
    if (c.startIndex < clsBody.endIndex) continue
    if (c.startIndex >= realBrace) continue
    trailing.push({ label: `t#${i}`, start: c.startIndex, end: c.endIndex, startLine: c.startPosition.row + 1, endLine: c.endPosition.row + 1, type: c.type })
  }

  const head = src.slice(0, clsBody.startIndex + 1)
  const tail = src.slice(realBrace)
  const build = (keep: Slice[]) =>
    head + "\n" + keep.map(m => src.slice(m.start, m.end)).join("\n") + "\n" +
    trailing.map(m => src.slice(m.start, m.end)).join("\n") + "\n" + tail

  // The real brace's offset INSIDE any synthetic text this builder produces.
  const realBraceIn = (text: string) => text.length - tail.length

  console.log(`FILE ${FILE}`)
  console.log(`population: ${classMembers.length} class_body members (candidates for removal)`)
  console.log(`           ${trailing.length} trailing program-level members (ALWAYS kept — they are the consequence)`)
  console.log(`           head = bytes 0..${clsBody.startIndex} ; tail = byte ${realBrace} (class's REAL brace)`)
  const unreducedText = build(classMembers)
  const unreduced = probe(parser, unreducedText)
  console.log(`\ncontrol: head + ALL ${classMembers.length} + trailing`)
  console.log(`  class_declaration endIndex=${unreduced.clsEndByte}  real brace offset in this text=${realBraceIn(unreducedText)}`)
  console.log(`  truncated=${truncates(parser, unreducedText, realBraceIn(unreducedText))}  orphans=${unreduced.orphans}  ERRORS=${unreduced.errs}`)
  console.log(`\nRAW unreduced file, for comparison: class_declaration endIndex=${cls.endIndex} vs real brace ${realBrace} -> truncated=${cls.endIndex !== realBrace}`)

  const reproduces = (keep: Slice[]) => truncates(parser, build(keep), realBraceIn(build(keep)))
  if (!reproduces(classMembers)) {
    console.log(`\nThe builder does not reproduce the truncation. STOPPING — that is a measurement of the builder, not of java.`)
    return
  }

  // Greedy removal over the class_body members only.
  let keep = classMembers.slice()
  const needed: Slice[] = []
  let pass = 0, changed = true
  while (changed) {
    changed = false; pass++
    for (let i = 0; i < keep.length; i++) {
      const cand = keep.slice(0, i).concat(keep.slice(i + 1))
      if (cand.length > 0 && reproduces(cand)) { keep = cand; changed = true; i-- }
      else if (!needed.includes(keep[i])) needed.push(keep[i])
    }
  }
  const dropped = classMembers.filter(m => !keep.includes(m))
  console.log(`\nGREEDY REMOVAL: ${dropped.length} of ${classMembers.length} class_body members removed; ${keep.length} kept`)
  console.log(`  every kept member was, at some point, NECESSARY to the truncation:`)
  for (const m of keep) console.log(`    ${m.label} ${m.type.padEnd(24)} lines ${m.startLine}..${m.endLine}`)
  console.log(`  each alone, with the trailing text present:`)
  for (const m of keep) {
    const t = build([m])
    const r = probe(parser, t)
    console.log(`    ${m.label} ${m.type.padEnd(24)} alone -> truncated=${truncates(parser, t, realBraceIn(t))} classEndLine=${r.clsEndLine} orphans=${r.orphans} ERRORS=${r.errs}`)
  }

  const minimalText = build(keep)
  const fr = probe(parser, minimalText)
  console.log(`\nMINIMAL, ${keep.length} member(s) + ${trailing.length} trailing: truncated=${truncates(parser, minimalText, realBraceIn(minimalText))} classEndLine=${fr.clsEndLine} orphans=${fr.orphans} ERRORS=${fr.errs}`)
  console.log(`\n--- verbatim minimal source ---`)
  for (const ln of minimalText.split("\n")) console.log(`| ${ln}`)
}

main().catch(e => { console.error(e); process.exit(1) })