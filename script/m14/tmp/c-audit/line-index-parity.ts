/**
 * C audit probe: PARITY of the #929 line-index change.
 *
 * `indexToLineColumn` used to walk the whole content from 0; it now binary
 * searches a line-start index built once per file. The claim is that it answers
 * IDENTICALLY. A claim like that is worth nothing unmeasured, and the fixtures
 * cannot see it: no fixture pins a function's `endLine`, because the range's end
 * is the matching brace, not a line anybody writes a fixture row about.
 *
 * So this probe measures it directly. It runs BOTH implementations over every
 * byte offset of every corpus file and reports the first disagreement, if any.
 * Offsets cover newlines, multi-byte UTF-8, CRLF, and the boundaries either side
 * of every line, because those are where an off-by-one lives.
 *
 *   bun run script/m14/tmp/c-audit/line-index-parity.ts --dir <corpus dir>
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..", "..", "..")
const argv = process.argv.slice(2)
const arg = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const DIR = arg("dir", "/home/sano/ishaq/bb_tests/repositories/redis/src")
const MAX_FILES = Number(arg("max-files", "60"))

/** The pre-#929 implementation, verbatim. */
function oldIndexToLineColumn(content: string, index: number): { line: number; column: number } {
  let line = 1
  let column = 1
  const max = Math.min(index, content.length)
  for (let i = 0; i < max; i++) {
    if (content[i] === "\n") {
      line++
      column = 1
    } else {
      column++
    }
  }
  return { line, column }
}

/** The current implementation, verbatim from the analyzer. */
function lineStartIndex(content: string): Int32Array {
  let lines = 1
  for (let i = 0; i < content.length; i++) if (content[i] === "\n") lines++
  const starts = new Int32Array(lines)
  let n = 0
  starts[n++] = 0
  for (let i = 0; i < content.length; i++) if (content[i] === "\n") starts[n++] = i + 1
  return starts
}
function newIndexToLineColumn(starts: Int32Array, index: number, content: string): { line: number; column: number } {
  const clamped = index < 0 ? 0 : index > content.length ? content.length : index
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= clamped) lo = mid
    else hi = mid - 1
  }
  return { line: lo + 1, column: clamped - starts[lo] + 1 }
}

const files: string[] = []
const walk = (d: string) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.name === ".git") continue
    const full = path.join(d, e.name)
    if (e.isDirectory()) walk(full)
    else if ((e.name.endsWith(".c") || e.name.endsWith(".h")) && files.length < MAX_FILES) files.push(full)
  }
}
walk(DIR)

let offsetsTested = 0
let disagreements = 0
const firstFew: string[] = []
for (const f of files) {
  const content = fs.readFileSync(f, "utf8")
  const starts = lineStartIndex(content)
  // Every byte offset, plus the boundaries around every newline, plus past-the-end.
  for (let i = 0; i <= content.length; i++) {
    const a = oldIndexToLineColumn(content, i)
    const b = newIndexToLineColumn(starts, i, content)
    offsetsTested++
    if (a.line !== b.line || a.column !== b.column) {
      disagreements++
      if (firstFew.length < 8) {
        firstFew.push(
          `${path.basename(f)} offset ${i}: old L${a.line}C${a.column} vs new L${b.line}C${b.column}  ctx=${JSON.stringify(content.slice(Math.max(0, i - 12), i + 12))}`,
        )
      }
    }
  }
  // Out-of-range probes: `recoverFunctionRange` can ask about an offset the brace
  // scan never reached, and the old implementation clamped with Math.min.
  for (const i of [content.length + 1, content.length + 99999, -1]) {
    const a = oldIndexToLineColumn(content, i)
    const b = newIndexToLineColumn(starts, i, content)
    offsetsTested++
    if (a.line !== b.line || a.column !== b.column) {
      disagreements++
      if (firstFew.length < 8) firstFew.push(`${path.basename(f)} OUT-OF-RANGE ${i}: old ${JSON.stringify(a)} vs new ${JSON.stringify(b)}`)
    }
  }
}

console.log(`files: ${files.length}`)
console.log(`offsets tested: ${offsetsTested}`)
console.log(`disagreements: ${disagreements}`)
for (const d of firstFew) console.log(`  ${d}`)
if (disagreements > 0) {
  console.log("\nPARITY FAILED -- the two implementations are not interchangeable")
  process.exit(1)
}
console.log("\nPARITY HOLDS: the line index answers identically at every offset tested")
