/**
 * MIGRATION: rewrite every `contains` expectation row's target to the member's
 * published qualified name.
 *
 * ## Why this file exists
 *
 * `src/ast/real-zig-analyzer.ts:1116` changed the `contains` target from the bare
 * member name to the member's own published spelling:
 *
 *     target: s.name  ->  target: `${s.ownerName}.${s.name}`
 *
 * That is a CONTRACT change, not a refactor, and the fixtures encoded the old
 * contract. Eight of the lane's expectation files spell the target as a bare name
 * on `expectRelationships` rows. Hand-editing them is the obvious move and the
 * wrong one: the rewrite is mechanical (`target = source + "." + target`), it has
 * to be applied to ~90 rows across 10 files, and a hand edit that misses one row
 * leaves a fixture that fails for a reason nobody can reconstruct.
 *
 * So the rewrite is a script, and the script is committed next to its own output.
 * Re-running it on an already-migrated file is a NO-OP, which is the property that
 * makes it safe to run twice.
 *
 * ## What it deliberately does NOT rewrite
 *
 * 1. **`forbidRelationships`.** Those rows pin spellings that must stay ABSENT —
 *    chiefly the pre-fix source half that Z-p22 removed (`{source: "Chdr", target:
 *    "reserved"}`, where `Chdr` names three real declarations in one file). The
 *    target half of those rows is part of what is being forbidden. Rewriting them
 *    would delete the regression the lane already paid for.
 * 2. **`expectSymbols`.** The published NAME surface is deliberately unchanged by
 *    this fix: `symbols.push({ name: s.name })` still publishes the bare member.
 *    Rewriting a symbol row would assert a change that was not made.
 * 3. **A target already prefixed by its source.** Idempotence guard.
 *
 * ## Usage
 *
 *     npx tsx validation/m14/fixtures/zig/migrate-contains-targets.mts           # write
 *     npx tsx validation/m14/fixtures/zig/migrate-contains-targets.mts --check   # verify only
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHECK_ONLY = process.argv.includes("--check")

const files = readdirSync(HERE)
  .filter((n) => n.endsWith(".expectation.json"))
  .sort()

let filesChanged = 0
let rowsRewritten = 0
const touched: string[] = []

for (const f of files) {
  const p = path.join(HERE, f)
  const before = readFileSync(p, "utf8")
  const exp = JSON.parse(before)
  const rows: any[] = exp.expectRelationships ?? []
  let n = 0

  for (const r of rows) {
    if (r?.type !== "contains") continue
    // `source` is the spelling the zig fixtures use; `from` is accepted because
    // `run-fixtures.ts` `normRel` accepts either and a lane should not have to
    // know which one this particular file was written with.
    const src = r.source ?? r.from
    if (typeof src !== "string" || src.length === 0) continue
    if (typeof r.target !== "string" || r.target.length === 0) continue
    // Idempotence guard. It is `startsWith`, and the first version of this line
    // compared `r.target === \`${src}.${r.target}\`` — a string equality that can
    // never hold, so the guard never fired and a SECOND run of this script would
    // have double-qualified every row it had already migrated. The proof that it
    // matters is `--check`, which is the only thing that would have caught it.
    if (r.target.startsWith(src + ".")) continue
    r.target = `${src}.${r.target}`
    n++
  }

  if (n === 0) continue
  rowsRewritten += n
  filesChanged++
  touched.push(`${f}  ${n} row(s)`)
  if (CHECK_ONLY) {
    const after = JSON.stringify(exp, null, 2) + "\n"
    if (after !== before) console.log(`WOULD CHANGE  ${f}`)
    continue
  }
  writeFileSync(p, JSON.stringify(exp, null, 2) + "\n")
}

console.log(`population   ${files.length} expectation file(s) in ${HERE}`)
console.log(`contains rows rewritten   ${rowsRewritten}`)
console.log(`files changed             ${filesChanged}`)
for (const t of touched) console.log(`  ${t}`)
if (CHECK_ONLY) {
  // The migration is idempotent, so the whole test is "a second pass finds
  // nothing to do". Anything the rewrite would still change is a bare target.
  let remaining = 0
  for (const f of files) {
    const exp = JSON.parse(readFileSync(path.join(HERE, f), "utf8"))
    for (const r of exp.expectRelationships ?? []) {
      if (r?.type !== "contains") continue
      const src = r.source ?? r.from
      if (typeof src !== "string" || src.length === 0) continue
      if (typeof r.target === "string" && !r.target.startsWith(src + ".")) remaining++
    }
  }
  console.log(`bare-target contains rows remaining   ${remaining}`)
  process.exit(remaining === 0 ? 0 : 1)
}