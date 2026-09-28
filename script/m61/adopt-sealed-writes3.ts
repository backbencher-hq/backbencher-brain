// script/m61/adopt-sealed-writes3.ts — M61.V1 adoption helper, pass 3 (repair).
//
// The defect this repairs: pass 2 rewrote the pattern to
//     writeSealed(<file>, JSON.stringify(<value>, null, 2) + "\n")
// — keeping the stringify as the VALUE. writeSealed seals a record OBJECT;
// spreading a string yields a char-index map, corrupting any evidence file
// the gate then wrote (first caught by m24's X1 regeneration fingerprint:
// P2.json came back as {"0":"{","1":"\n",...}).
//
// This pass rewrites every such call to the correct shape:
//     writeSealed(<file>, <value>)
// and reports each file it touches. Idempotent. --write applies.
//
// Run: npx tsx script/m61/adopt-sealed-writes3.ts [--write]

import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
const APPLY = process.argv.includes("--write")

const TARGET_DIRS = [
  "script/m24", "script/m25", "script/m26", "script/m27", "script/m28", "script/m29",
  "script/m42", "script/m44", "script/m53", "script/m55", "script/m61",
]

// Greedy inner capture: the value expression may itself contain commas and
// nested parens; the anchor is the LAST `, null, 2) + "\n"` (the house
// write style) before the closing paren of writeSealed. The file part is
// greedy `.*` so it crosses path.join(...) parens (a `[^)]*` pre-filter here
// MISSED most pass-2 products — declared so the lesson sticks).
const BROKEN_RE = /writeSealed\((?<file>.*),\s*JSON\.stringify\((?<inner>.+),\s*null,\s*2\s*\)\s*\+\s*"\\n"(?:,\s*"utf8")?\)/g

let changedFiles = 0
let changedWrites = 0

for (const dir of TARGET_DIRS) {
  const abs = path.join(ROOT, dir)
  for (const f of readdirSync(abs)) {
    if (!f.endsWith(".ts") || f.includes(".mutant-") || f.startsWith("adopt-sealed-writes")) continue
    const filePath = path.join(abs, f)
    const src = readFileSync(filePath, "utf8")
    if (!src.includes("writeSealed(") || !src.includes("JSON.stringify(")) continue
    if (!/writeSealed\(.*JSON\.stringify/.test(src)) continue
    let n = 0
    const out = src.replace(BROKEN_RE, (_m, file, inner) => {
      n++
      return `writeSealed(${file}, ${inner})`
    })
    if (n === 0) continue
    console.log(`${APPLY ? "REPAIRED" : "WOULD REPAIR"} ${dir}/${f}: ${n} call(s)`)
    if (APPLY) writeFileSync(filePath, out)
    changedFiles++
    changedWrites += n
  }
}

console.log(`\n${changedFiles} file(s), ${changedWrites} call(s) ${APPLY ? "repaired" : "would be repaired"}`)
if (!APPLY) console.log("(dry run — pass --write to apply)")
