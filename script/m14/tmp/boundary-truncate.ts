/**
 * Boundary truncation: localise a defect to a MEMBER, by cutting the file at
 * member boundaries rather than at arbitrary lines.
 *
 * THREE earlier designs failed on this file and each failure is why this one is
 * shaped the way it is:
 *
 *  - A prefix bisect measures the truncation. A cut inside a `Class` body leaves
 *    an unterminated block, which is an error in any correct grammar, so every
 *    prefix fails and the instrument reports nothing.
 *  - Whole-file EXCISION (delete a group, see if it parses) is sound in
 *    principle and unsound in practice on a 2870-line file: deleting any one of
 *    2870 lines perturbs the token stream, and on this file a single-line
 *    deletion "fixed" it at a line that parses perfectly well in isolation. A
 *    culprit you cannot reproduce standalone is not a culprit.
 *  - RECONSTRUCTION (rebuild the file from `header + member + footer`) has the
 *    mirror problem: a member with its body removed is a different program.
 *
 * This cuts only at boundaries where the file is still a WELL-FORMED prefix --
 * after a member's `End Sub` / `End Function` / `End Property` / `End Enum` -- and
 * re-closes the class and namespace itself. Every candidate is therefore a
 * parseable VB file, so "this prefix fails" is a statement about the member just
 * added and nothing else.
 */
import { readFileSync } from "node:fs"
import { Parser, Language } from "<corpus-root>/backbencher-brain/node_modules/web-tree-sitter/tree-sitter.js"
import { readVbSource } from "./vb-source"

const CORE_WASM = "<corpus-root>/backbencher-brain/wasm/tree-sitter.wasm"
const GRAMMAR_WASM = process.env.VB_WASM ?? "<corpus-root>/backbencher-brain/wasm/tree-sitter-vbnet.wasm"

const isBad = (n: any) => n.type === "ERROR" || n.type === "_ERROR" || n.isMissing
function hasBadBelow(node: any): boolean {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (isBad(c) || hasBadBelow(c)) return true
  }
  return false
}
function indentOf(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === " ") n++
    else if (s[i] === "\t") n += 4
    else break
  }
  return n
}
function isBlank(s: string): boolean {
  const t = s.trim()
  return t.length === 0 || t.startsWith("'")
}

await Parser.init({ locateFile: () => CORE_WASM, wasmBinary: readFileSync(CORE_WASM) })
const lang = await Language.load(GRAMMAR_WASM)
const parser = new Parser()
parser.setLanguage(lang)

function parses(text: string): boolean {
  const t = parser.parse(text)
  const ok = !isBad(t.rootNode) && !hasBadBelow(t.rootNode)
  t.delete()
  return ok
}

/** 1-based line of the first bad node, or 0. */
function firstErrorLine(text: string): number {
  const t = parser.parse(text)
  let line = 0
  const rec = (n: any): void => {
    if (line !== 0) return
    if (isBad(n)) { line = n.startPosition.row + 1; return }
    for (let i = 0; i < n.namedChildCount; i++) rec(n.namedChild(i))
  }
  rec(t.rootNode)
  t.delete()
  return line
}

for (const f of process.argv.slice(2)) {
  const src = readVbSource(f).text
  const lines = src.split(/\r?\n/)
  console.log("=".repeat(100))
  console.log(`FILE ${f}  (${lines.length} lines)`)
  if (parses(src)) { console.log("  parses clean — nothing to localise"); continue }

  // The type header, and the member indent.
  let header = -1, headerIndent = 0
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (/^(?:(?:Public|Private|Friend|Protected|Partial|Static|NotInheritable|Abstract|Sealed)\s+)*(Class|Module|Structure)\s+[A-Za-z_]\w*/i.test(t)) {
      header = i; headerIndent = indentOf(lines[i]); break
    }
  }
  if (header < 0) { console.log("  no type header by indent"); continue }
  let memberIndent = -1
  for (let i = header + 1; i < lines.length; i++) {
    if (isBlank(lines[i])) continue
    const ind = indentOf(lines[i])
    if (ind > headerIndent) { memberIndent = ind; break }
  }
  if (memberIndent < 0) { console.log("  empty class body"); continue }

  // Boundary positions: a line at the MEMBER indent that closes a member, plus
  // the header itself. A cut here leaves a well-formed prefix.
  const closers = /^End\s+(Sub|Function|Property|Enum|Operator|Event|Structure|Class|Interface|Module)\b/i
  const boundaries: number[] = [header]
  for (let i = header + 1; i < lines.length; i++) {
    if (isBlank(lines[i])) continue
    if (indentOf(lines[i]) === memberIndent && closers.test(lines[i].trim())) boundaries.push(i)
  }
  console.log(`  header line ${header + 1}; member indent ${memberIndent}; ${boundaries.length} cut point(s)`)

  // NESTED boundaries. Cutting only at member boundaries localises a defect to a
  // member; to get from a member to a STATEMENT, the same idea is applied one
  // level in, cutting at every `End <construct>` and re-closing whatever the
  // prefix left open. The open-construct stack is tracked by indent, which is
  // sound for VB because a block's `End` is always at its opener's indent.
  //
  // This is the same discipline as the member-level search and for the same
  // reason: every candidate must be a WELL-FORMED prefix, or "fails" says nothing.
  if (process.env.NESTED === "1") {
    const opens: Array<{ word: string; indent: number }> = []
    const typeWord2 = typeWord
    let lastCleanIdx = -1
    let firstFailIdx = -1
    const cuts: number[] = []
    for (let i = header + 1; i < lines.length; i++) {
      const t = lines[i].trim()
      if (isBlank(lines[i])) continue
      const m = /^End\s+(Sub|Function|If|Using|Try|Select|With|Do|Loop|While|Class|Module|Structure|Enum|Property|Operator|Event|Namespace)\b/i.exec(t)
      if (m && indentOf(lines[i]) === opens.length ? false : (indentOf(lines[i]) === (opens[opens.length - 1]?.indent ?? -1))) {
        cuts.push(i)
        const word = m[1]
        const openWord = opens.length ? opens[opens.length - 1].word : ""
        opens.pop()
        const tailClosers = opens.slice().reverse()
          .map((o) => " ".repeat(o.indent) + (o.word === "Do" ? "Loop" : o.word === "While" ? "End While" : `End ${o.word}`))
          .join("\n")
        const cand = lines.slice(0, i + 1).join("\n") + "\n" + tailClosers + "\n" +
          " ".repeat(headerIndent) + `End ${typeWord2}\n` + tail
        const ok = parses(cand)
        if (ok) lastCleanIdx = i
        else { firstFailIdx = i; break }
      } else {
        const om = /^(?:(?:Public|Private|Friend|Protected|Shared|Static|Do|While|For|For\s+Each|Using|Select|Try|With|If)\b)/i.exec(t)
        if (om && indentOf(lines[i]) === memberIndent) {
          const w = (/^If\b/i.test(t) && /\bThen\s*$/i.test(t)) ? null : (/^If\b/i.test(t) ? "If" : (/^For\b/i.test(t) ? "For" : om[0].trim()))
          if (w) opens.push({ word: w, indent: indentOf(lines[i]) })
        }
      }
    }
    if (firstFailIdx < 0) {
      console.log("  NESTED: every nested boundary prefix parses")
    } else {
      const from = lastCleanIdx < 0 ? header + 1 : lastCleanIdx + 1
      console.log(`  NESTED DEFECT between lines ${from + 1} and ${firstFailIdx + 1}`)
      for (let i = Math.max(0, from - 3); i <= Math.min(lines.length - 1, firstFailIdx + 1); i++) {
        console.log(`   ${String(i + 1).padStart(5)} ${i >= from && i <= firstFailIdx ? ">>" : "  "} ${lines[i].slice(0, 150)}`)
      }
    }
    continue
  }

  // The file's own tail after the type's `End`, used to re-close each prefix.
  let endLine = -1
  for (let i = header + 1; i < lines.length; i++) {
    const t = lines[i].trim().toLowerCase()
    if (indentOf(lines[i]) === headerIndent && /^end\s+(class|module|structure)\b/.test(t)) { endLine = i; break }
  }
  const typeWord = (lines[header].trim().match(/\b(Class|Module|Structure)\b/i)?.[0] ?? "Class")
  const tail = endLine >= 0 ? lines.slice(endLine + 1).join("\n") : ""
  const close = (upTo: number): string =>
    lines.slice(0, upTo + 1).join("\n") + "\n" +
    " ".repeat(headerIndent) + `End ${typeWord}\n` + tail

  let lastClean = -1
  let firstFail = -1
  for (let k = 1; k < boundaries.length; k++) {
    const cand = close(boundaries[k])
    if (parses(cand)) { lastClean = k; continue }
    firstFail = k
    break
  }
  if (firstFail < 0) {
    console.log("  every member-boundary prefix parses; the defect is after the last cut point or in the head/tail")
    if (!parses(close(header))) {
      console.log("  the empty body already fails — localised to the head (imports/attributes) or the tail")
    }
    continue
  }
  const from = boundaries[lastClean < 0 ? 0 : lastClean] + 1
  const to = boundaries[firstFail] + 1
  console.log(`  DEFECT IS IN LINES ${from + 1}..${to}  (between cut ${lastClean} which parsed and cut ${firstFail} which did not)`)
  for (let i = Math.max(0, from - 2); i <= Math.min(lines.length - 1, to); i++) {
    console.log(`   ${String(i + 1).padStart(5)} ${i >= from && i <= to ? ">>" : "  "} ${lines[i].slice(0, 150)}`)
  }
  // Print where the grammar actually complained inside the failing prefix.
  const bad = close(boundaries[firstFail])
  const el = firstErrorLine(bad)
  if (el > 0) {
    console.log(`  the grammar's first error inside that prefix is at prefix line ${el}:`)
    for (let i = Math.max(0, el - 3); i <= Math.min(bad.split("\n").length - 1, el + 2); i++) {
      console.log(`   ${String(i + 1).padStart(5)} ${i + 1 === el ? "!!" : "  "} ${bad.split("\n")[i].slice(0, 150)}`)
    }
  }
}
parser.delete()
