// script/m61/adopt-sealed-writes2.ts — M61.V1 adoption helper, pass 2.
//
// The pass-1 regex deliberately skipped writes whose file expression contains
// commas (writeFileSync(path.join(a, b), JSON.stringify(...))) to avoid
// mis-capturing. This pass handles exactly that shape with a greedy line
// match anchored on the JSON.stringify call, which is unique per line:
//     writeFileSync(<anything>, JSON.stringify(<value>, null, 2) + "\n")
//   → writeSealed(<anything>, <value>)
// Greedy to the LAST comma before JSON.stringify — the file expression may
// itself contain commas (path.join(...)), the value expression may too.
// Only single-line JSON.stringify writes are touched; byte-gated markdown
// writes and fixtures keep their writeFileSync. Idempotent. --write applies.
//
// Run: npx tsx script/m61/adopt-sealed-writes2.ts [--write]

import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
const APPLY = process.argv.includes("--write")

const TARGET_DIRS = [
  "script/m24", "script/m25", "script/m26", "script/m27", "script/m28", "script/m29",
  "script/m42", "script/m44", "script/m53", "script/m55", "script/m61",
]

const LINE_RE = /^(?<indent>\s*)writeFileSync\((?<file>.*),(?<value>.*JSON\.stringify\(.*null,\s*2\s*\)\s*\+\s*"\\n")\)\s*$/
const IMPORT_LINE = `import { writeSealed } from "../lib/evidence.ts"`
const IMPORT_RE = /import \{ writeSealed[^}]*\} from "\.\.\/lib\/evidence\.ts"/

let changedFiles = 0
let changedWrites = 0
const skipped: string[] = []

for (const dir of TARGET_DIRS) {
  const abs = path.join(ROOT, dir)
  for (const f of readdirSync(abs)) {
    if (!f.endsWith(".ts") || f.includes(".mutant-") || f.startsWith("adopt-sealed-writes")) continue
    const filePath = path.join(abs, f)
    const src = readFileSync(filePath, "utf8")
    if (!src.includes("JSON.stringify(") || !src.includes("writeFileSync(")) continue
    if (src.includes("writeSealed") && src.includes("lib/evidence")) {
      // already adopted — but pass-2 may still find stragglers if pass 1
      // adopted SOME writes; only skip when no JSON stringify write remains.
    }
    const lines = src.split("\n")
    let fileWrites = 0
    let hasImport = IMPORT_RE.test(src)
    const outLines: string[] = []
    for (const line of lines) {
      const m = LINE_RE.exec(line)
      if (m && m.groups) {
        fileWrites++
        outLines.push(`${m.groups.indent}writeSealed(${m.groups.file},${m.groups.value})`)
      } else {
        outLines.push(line)
      }
    }
    if (fileWrites === 0) continue
    let out = outLines.join("\n")
    if (!hasImport) {
      let lastImport = -1
      for (let i = 0; i < Math.min(outLines.length, 60); i++) {
        if (/^import /.test(outLines[i]!)) lastImport = i
      }
      if (lastImport === -1) {
        skipped.push(`${dir}/${f} (no import block — manual)`)
        continue
      }
      const l = out.split("\n")
      l.splice(lastImport + 1, 0, IMPORT_LINE)
      out = l.join("\n")
    }
    const rel = path.relative(ROOT, filePath)
    console.log(`${APPLY ? "REWROTE" : "WOULD REWRITE"} ${rel}: ${fileWrites} write(s)`)
    if (APPLY) writeFileSync(filePath, out)
    changedFiles++
    changedWrites += fileWrites
  }
}

console.log(`\n${changedFiles} file(s), ${changedWrites} write(s) ${APPLY ? "rewritten" : "would be rewritten"}${skipped.length ? `, ${skipped.length} skipped` : ""}`)
for (const s of skipped) console.log(`  skipped: ${s}`)
if (!APPLY) console.log("(dry run — pass --write to apply)")
