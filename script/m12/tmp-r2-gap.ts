// Which review-class census entries lack register rows, and where do they live?
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
const census = JSON.parse(readFileSync("validation/m12/results/regex-census.json", "utf8"))
const register = JSON.parse(readFileSync("validation/m49/regex-debt-register.json", "utf8"))
const REVIEW = new Set(["needs_review", "replaceable"])
const reg = new Set(register.entries.map((e: any) => `${e.file}|${e.source}`))
const gap = census.perFile.flatMap((f: any) => f.usages).filter((u: any) => REVIEW.has(u.classification))
console.log(`review-class total: ${gap.length} (baseline ${register.baselineTotal}), register rows: ${register.entries.length}`)
for (const u of gap) {
  const has = reg.has(`${u.file}|${u.source}`)
  if (!has) {
    console.log(`\n=== UNJUSTIFIED ${u.file}:${u.line}  op=${u.operation} recv=${u.receiverCategory}\n    ${u.source}`)
    const txt = readFileSync(`src/ast/${u.file}`, "utf8").split("\n")
    for (let i = Math.max(0, u.line - 4); i < Math.min(txt.length, u.line + 3); i++) console.log(`   ${String(i + 1).padStart(5)}| ${txt[i]}`)
  }
}
