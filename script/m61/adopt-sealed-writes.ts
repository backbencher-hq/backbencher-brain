// script/m61/adopt-sealed-writes.ts — M61.V1 adoption helper (one-shot).
//
// Rewrites the standard evidence-write pattern in the IDE-lane gates:
//     writeFileSync(<expr>, JSON.stringify(<expr>, null, 2) + "\n")
//   → writeSealed(<expr>, <expr>)
// and adds the library import when missing. ONLY JSON.stringify writes are
// touched — byte-gated markdown docs (receipts, generated docs) and fixture
// writes keep their writeFileSync. Files already containing writeSealed are
// skipped (idempotent). Prints every change; dry-run by default, pass --write.
//
// Run: npx tsx script/m61/adopt-sealed-writes.ts [--write]

import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
const APPLY = process.argv.includes("--write")

// The gates whose evidence this milestone adopts the sealed write into
// (the IDE lane + the shared machinery). Co-agent lanes are NOT touched.
const TARGET_DIRS = [
  "script/m24", "script/m25", "script/m26", "script/m27", "script/m28", "script/m29",
  "script/m42", "script/m44", "script/m53", "script/m55", "script/m61",
]

const WRITE_RE = /writeFileSync\(\s*([^,]+?),\s*JSON\.stringify\(\s*([^,]+?),\s*null,\s*2\s*\)\s*\+\s*"\\n"\s*\)/g
const IMPORT_LINE = `import { writeSealed } from "../lib/evidence.ts"`
const IMPORT_RE = /import \{ writeSealed[^}]*\} from "\.\.\/lib\/evidence\.ts"/

let changedFiles = 0
let changedWrites = 0
const skipped: string[] = []

for (const dir of TARGET_DIRS) {
  const abs = path.join(ROOT, dir)
  for (const f of readdirSync(abs)) {
    if (!f.endsWith(".ts") || f.includes(".mutant-")) continue
    const filePath = path.join(abs, f)
    const src = readFileSync(filePath, "utf8")
    if (!WRITE_RE.test(src)) continue
    WRITE_RE.lastIndex = 0
    if (src.includes("writeSealed") && src.includes("lib/evidence")) {
      skipped.push(`${dir}/${f} (already adopted)`)
      continue
    }
    const rel = path.relative(ROOT, filePath)
    let out = src.replace(WRITE_RE, (_m, fileExpr, valueExpr) => {
      changedWrites++
      return `writeSealed(${fileExpr}, ${valueExpr})`
    })
    if (!IMPORT_RE.test(out)) {
      // Add the import after the last top-of-file import line.
      const lines = out.split("\n")
      let lastImport = -1
      for (let i = 0; i < Math.min(lines.length, 60); i++) {
        if (/^import /.test(lines[i]!)) lastImport = i
      }
      if (lastImport === -1) {
        skipped.push(`${rel} (no import block found — manual)`)
        continue
      }
      lines.splice(lastImport + 1, 0, IMPORT_LINE)
      out = lines.join("\n")
    }
    console.log(`${APPLY ? "REWROTE" : "WOULD REWRITE"} ${rel}: ${changedWrites} write(s)`)
    if (APPLY) writeFileSync(filePath, out)
    changedFiles++
  }
}

console.log(`\n${changedFiles} file(s), ${changedWrites} write(s) ${APPLY ? "rewritten" : "would be rewritten"}${skipped.length ? `, ${skipped.length} skipped` : ""}`)
for (const s of skipped) console.log(`  skipped: ${s}`)
if (!APPLY) console.log("(dry run — pass --write to apply)")
