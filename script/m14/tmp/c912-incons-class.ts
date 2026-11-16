// Classify the M59 oracle's FULL inconsistent dump (BB_M59_INCONSISTENT_DUMP)
// by where the target's name is actually written. The oracle's own token and
// Tier A boundary rule are mirrored exactly, so a row re-tested here is the same
// row the gate counted.
//
// Usage: bun script/m14/tmp/c912-incons-class.ts /tmp/c912-incons.json
import { readFileSync } from "node:fs"
import path from "node:path"

const REPOS = "<corpus-root>/bb_tests/repositories"
const rows: any[] = JSON.parse(readFileSync(process.argv[2] ?? "/tmp/c912-incons.json", "utf8"))

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const boundaryRe = (token: string): RegExp => new RegExp(`(^|[^\\w])\\$?${escapeRe(token)}([^\\w]|$)`)
const tierA = (src: string, token: string): boolean => {
  const head = token.replace(/_+$/, "")
  const variants = token === head ? [token] : [token, head]
  return variants.some((v) => boundaryRe(v).test(src))
}

const counts: Record<string, number> = {}
const byType: Record<string, number> = {}
const files = new Map<string, string[]>()
const examples: Record<string, string[]> = {}

for (const r of rows) {
  const abs = path.join(REPOS, r.file)
  let lines = files.get(abs)
  if (!lines) {
    try {
      lines = readFileSync(abs, "utf8").split("\n")
    } catch {
      lines = []
    }
    files.set(abs, lines)
  }
  const ln = r.claimedLine
  const src = lines[ln - 1] ?? ""
  let cls: string
  if (String(r.type).includes("phantom-target-claims-line")) {
    cls = "P-phantom-target-claims-a-line"
  } else if (tierA(src, r.token)) {
    cls = "OK-mirror-mismatch"
  } else {
    const head = r.token.replace(/_+$/, "")
    const vars = r.token === head ? [r.token] : [r.token, head]
    const hit = (i: number) => vars.some((v) => boundaryRe(v).test(lines![i] ?? ""))
    let where = -1
    for (let i = ln; i < Math.min(lines.length, ln + 6) && where < 0; i++) if (hit(i)) where = i + 1
    let anywhere = -1
    for (let i = 0; i < lines.length && anywhere < 0; i++) if (hit(i)) anywhere = i + 1
    if (where === ln + 1) cls = "A-name-on-the-next-line"
    else if (where > ln + 1) cls = "B-name-later-in-the-declaration"
    else if (anywhere > 0) cls = "C-name-elsewhere-in-file"
    else cls = "D-name-nowhere-in-file"
  }
  counts[`${r.lang}/${cls}`] = (counts[`${r.lang}/${cls}`] ?? 0) + 1
  byType[`${r.lang}/${cls}/${r.type}`] = (byType[`${r.lang}/${cls}/${r.type}`] ?? 0) + 1
  const key = `${r.lang}/${cls}`
  ;(examples[key] ??= []).push(`      ${r.file}:${ln} ${r.type} ${r.token}  | ${src.trim().slice(0, 80)}`)
}

console.log(`total rows: ${rows.length}`)
console.log("\n=== classes ===")
for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${k}: ${v}`)
console.log("\n=== classes x relationship type ===")
for (const [k, v] of Object.entries(byType).sort()) console.log(`  ${k}: ${v}`)
console.log("\n=== examples (up to 4 per class) ===")
for (const [k, v] of Object.entries(examples)) {
  console.log(`  ${k}`)
  for (const e of v.slice(0, 4)) console.log(e)
}
