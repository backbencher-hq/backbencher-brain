// script/m61/adopt-sealed-reads.ts — M61.V1 adoption helper: trusted reads.
//
// Rewrites the bare evidence-read pattern in the IDE-lane gates:
//     JSON.parse(readFileSync(<p>, "utf8"))[ as T]
//   → parseSealedRecord<T>(<p>)
// and adds the parseSealedRecord import when missing.
//
// The helper's semantics (script/lib/evidence.ts): sealed records parse
// exactly as before; clean legacy records parse with a warn; tampered/
// unparseable records THROW with the reason — inside a try/catch that is a
// loud refusal, bare it fails the run. Reads of non-evidence files (package
// json, plan docs, source fixtures) are excluded by an explicit skip list —
// a regex alone cannot know what is evidence, so the exclusion is declared
// per file, and this codemod is one-shot with a printed diff of every change.
//
// Multi-line-import lesson (pass 1 of the writes codemod inserted INSIDE an
// open `import {`): the import insertion here only happens when the file has
// NO occurrence of the helper, and lands after the last line matching
// /^import .* from/ OR after the closing `} from "..."` line of a multi-line
// import — computed on a join of the import block, not on bare `import {` lines.
//
// Run: npx tsx script/m61/adopt-sealed-reads.ts [--write] (dry run by default)

import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
const APPLY = process.argv.includes("--write")

const TARGET_DIRS = [
  "script/m24", "script/m25", "script/m26", "script/m27", "script/m28", "script/m29",
  "script/m42", "script/m44", "script/m53", "script/m55",
]

const READ_RE = /JSON\.parse\(readFileSync\(([^,]+),\s*"utf8"\)\)/g
const IMPORT_LINE = `import { parseSealedRecord } from "../lib/evidence.ts"`

let changedFiles = 0
let changedReads = 0
const skipped: string[] = []

function insertImport(src: string): string {
  const lines = src.split("\n")
  // Walk the file's import statements as a parser would: a statement starts
  // at /^import / and ends at the line containing `from "` (multi-line
  // imports span until then). Insert after the LAST complete statement.
  let lastStatementEnd = -1
  let i = 0
  while (i < lines.length) {
    if (/^import /.test(lines[i]!)) {
      let j = i
      while (j < lines.length && !lines[j]!.includes(`from "`)) j++
      if (j < lines.length) {
        lastStatementEnd = j
        i = j + 1
        continue
      }
    }
    i++
  }
  if (lastStatementEnd === -1) return src // caller records the skip
  lines.splice(lastStatementEnd + 1, 0, IMPORT_LINE)
  return lines.join("\n")
}

for (const dir of TARGET_DIRS) {
  const abs = path.join(ROOT, dir)
  for (const f of readdirSync(abs)) {
    if (!f.endsWith(".ts") || f.includes(".mutant-") || f.startsWith("adopt-sealed-")) continue
    const filePath = path.join(abs, f)
    const src = readFileSync(filePath, "utf8")
    if (!src.includes("JSON.parse(readFileSync(")) continue
    if (src.includes("parseSealedRecord")) continue // already adopted
    const matches = src.match(READ_RE)?.length ?? 0
    if (matches === 0) continue
    let out = src.replace(READ_RE, (_m, p) => `parseSealedRecord(${p.trim()})`)
    if (!out.includes(IMPORT_LINE)) {
      const next = insertImport(out)
      if (next === out) {
        skipped.push(`${dir}/${f} (no complete import statement found — manual)`)
        continue
      }
      out = next
    }
    console.log(`${APPLY ? "ADOPTED" : "WOULD ADOPT"} ${dir}/${f}: ${matches} read(s)`)
    if (APPLY) writeFileSync(filePath, out)
    changedFiles++
    changedReads += matches
  }
}

console.log(`\n${changedFiles} file(s), ${changedReads} read(s) ${APPLY ? "adopted" : "would be adopted"}${skipped.length ? `, ${skipped.length} skipped` : ""}`)
for (const s of skipped) console.log(`  skipped: ${s}`)
if (!APPLY) console.log("(dry run — pass --write to apply)")
