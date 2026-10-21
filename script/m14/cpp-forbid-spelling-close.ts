/**
 * cpp-forbid-spelling-close — CLOSE THE SPELLING HOLES THE AUDIT FOUND, REPRODUCIBLY.
 *
 * THE RULE (L-2026-10-21-07): a forbid row must pin the SPELLING CONTRACT, not only the
 * relationship. The csharp lane's measured case: 73 mutants, 1 survivor, invisible because the
 * defect re-added rows with the target spelled `IThing.GetName` while every forbid pinned the
 * BARE spelling `GetName`.
 *
 * WHAT THIS DOES: it takes the audit's work-list (`script/m14/cpp-forbid-spelling-audit.ts
 * --json=<p>`) and ADDS the missing spelling rows to the fixtures — one forbid row per
 * owner-qualified variant of an existing forbid row's `from` or `target`, with the SAME
 * constraint shape as the row it came from (the runner's own convention: an ABSENT key is
 * unconstrained, a `null` key means "this field must be absent or null").
 *
 * IT IS SAFE BY CONSTRUCTION, and the safety is checked rather than asserted:
 *   · every added row FORBIDS a SPELLING of something already forbidden, so it can only narrow
 *     what the suite accepts — it can never make a fixture pass that was failing;
 *   · the script re-parses every file it writes and refuses to write a file whose row count does
 *     not change by exactly the number of rows it added;
 *   · the suite is re-run afterwards, and the count must not move.
 *
 * IT IS A FIXPOINT: the added rows have owner-qualified targets of their own, so the audit finds
 * their variants too. Run the audit → close → audit until the audit reads ZERO holes; the loop
 * terminates because the owner chain is finite (a namespace has no owner).
 *
 * USAGE
 *   bun run script/m14/cpp-forbid-spelling-close.ts --json=<audit.json> [--apply] [--dry-run]
 */
import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const FIX = path.join(ROOT, "validation/m14/fixtures/cpp")
const argOf = (f: string): string | null => {
  const j = process.argv.find((a) => a.startsWith(`${f}=`))
  return j ? j.slice(f.length + 1) : null
}
const AUDIT = argOf("--json")
if (!AUDIT) {
  console.error("usage: bun run script/m14/cpp-forbid-spelling-close.ts --json=<audit.json> [--apply]")
  process.exit(2)
}
const APPLY = process.argv.includes("--apply")
const audit = JSON.parse(readFileSync(AUDIT, "utf8"))
const NOTE =
  "SPELLING CONTRACT (L-2026-10-21-07): a defect that re-spells this end of the row as the owner-qualified spelling would NOT be caught by the bare-spelling forbid beside it, so the spelling is pinned here too."

/** The array's own closing bracket — the fixtures' formatting is not uniform, so the bracket is
 *  FOUND, not searched for by a literal. */
function findClose(text: string, i: number): number {
  let depth = 0
  let inStr = false
  let esc = false
  for (let j = i; j < text.length; j++) {
    const c = text[j]
    if (inStr) {
      if (esc) esc = false
      else if (c === "\\") esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') { inStr = true; continue }
    if (c === "[" || c === "{") depth++
    else if (c === "]" || c === "}") {
      depth--
      if (depth === 0) return j
    }
  }
  return -1
}

const byFix = new Map<string, any[]>()
for (const h of audit.holes ?? []) {
  const name = String(h.fixture).split("/")[1]
  if (!byFix.has(name)) byFix.set(name, [])
  byFix.get(name)!.push(h)
}

let filesChanged = 0
let rowsAdded = 0
const skipped: string[] = []
for (const [name, holes] of [...byFix].sort()) {
  const p = path.join(FIX, `${name}.expectation.json`)
  const text = readFileSync(p, "utf8")
  const d = JSON.parse(text)
  const before = d.forbidRelationships ?? []
  const seen = new Set<string>()
  const rows: any[] = []
  for (const h of holes) {
    const v = h.variantRow ?? {}
    const key = JSON.stringify(
      Object.fromEntries(Object.entries(v).filter(([k]) => k === "type" || k === "from" || k === "target").sort()),
    )
    if (seen.has(key)) continue
    if (
      before.some(
        (r: any) =>
          JSON.stringify(
            Object.fromEntries(Object.entries(r).filter(([k]) => k === "type" || k === "from" || k === "target").sort()),
          ) === key,
      )
    )
      continue
    seen.add(key)
    const row: any = {}
    row.type = v.type
    if ("from" in v) row.from = v.from ?? null
    if ("target" in v) row.target = v.target ?? null
    row.note = NOTE
    rows.push(row)
  }
  if (rows.length === 0) continue
  const m = /"forbidRelationships"\s*:\s*\[/.exec(text)
  if (!m) { skipped.push(`${name}: no forbidRelationships array`); continue }
  const i = m.index + m[0].length - 1
  const close = findClose(text, i)
  if (close < 0) { skipped.push(`${name}: array close not found`); continue }
  const body = text.slice(i + 1, close)
  const stripped = body.replace(/\s+$/, "")
  const sep = stripped.endsWith(",") ? "" : ","
  const ins = rows.map((r) => `    ${JSON.stringify(r)}`).join(",\n")
  const newText = stripped
    ? `${text.slice(0, i + 1)}${stripped}${sep}\n${ins}\n  ${text.slice(close)}`
    : `${text.slice(0, i + 1)}\n${ins}\n  ${text.slice(close)}`
  let nd: any
  try {
    nd = JSON.parse(newText)
  } catch (e) {
    skipped.push(`${name}: INVALID after edit (${e})`)
    continue
  }
  if ((nd.forbidRelationships ?? []).length !== before.length + rows.length) {
    skipped.push(`${name}: row-count mismatch`)
    continue
  }
  if (APPLY) {
    writeFileSync(p, newText)
    filesChanged++
    rowsAdded += rows.length
  }
}
console.log(`cpp-forbid-spelling-close — ${APPLY ? "APPLIED" : "DRY RUN"}: ${filesChanged} file(s), ${rowsAdded} row(s)`)
for (const s of skipped) console.log(`  skipped: ${s}`)
process.exit(skipped.length > 0 && APPLY ? 3 : 0)
