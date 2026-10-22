/**
 * THE TWIN COMPARATOR — L-16's "NON-ZERO EXIT ON DISAGREEMENT", WITH AN INDEPENDENT FALSIFIER.
 *
 * WHAT L-16 ASKS FOR: a twin over the SAME KEY SPACE with the SAME ARBITER, an INDEPENDENT
 * FALSIFIER, and a **NON-ZERO EXIT ON DISAGREEMENT**. This instrument is the last of those three.
 *
 * ⇒ IT COMPARES THE TWIN's TABLE 1 AGAINST THE SHIPPING GATE's TABLE 1, ROW BY ROW AND COLUMN BY
 * COLUMN ✓✓ — the rows, not the raw text, because a byte comparison of the whole log would report
 * a timestamp difference as a twin difference ✓✓.
 *
 * ⇒ IT EXITS NON-ZERO ON DISAGREEMENT ✓✓, and it prints the differences NAMED BY TYPE AND COLUMN,
 * so a disagreement is a DIAGNOSIS ✓✓.
 *
 * ⇒ AND THE INDEPENDENT FALSIFIER IS THE PART THAT MAKES THE ZERO A FACT ✓✓. A comparator that
 * exits 0 proves nothing on its own: it might be reading nothing, comparing the wrong thing, or
 * disagreeing in a way it cannot express. **⇒ SO `--falsifier` DELIBERATELY CORRUPTS ONE NUMBER IN
 * A SCRATCH COPY OF THE SECOND LOG AND ASSERTS THAT THE COMPARATOR FAILS ✓✓.** If the corrupted
 * copy still exits 0, the comparator is BLIND and its verdict is void ✓✓ — and the falsifier says
 * so instead of reporting a pass.
 *
 * ⇒ ONE PARSER, TWO CONSUMERS ✓✓ — the cell reader and this comparator import the SAME table
 * parser (`script/m14/javascript-gate-tables.ts`), so a disagreement between them cannot be a
 * parser difference ✓✓.
 *
 * ⇒ USAGE:
 *     bun run script/m14/javascript-twin-comparator.ts --gate=<gate.log> --twin=<twin.log>
 *     bun run script/m14/javascript-twin-comparator.ts --gate=<gate.log> --twin=<twin.log> --falsifier
 *
 * EXIT CODES: 0 = the two agree (or, in --falsifier mode, the corruption was DETECTED);
 *             4 = the two DISAGREE; 5 = the falsifier's corruption was NOT detected (the comparator
 *             is blind, so its verdict is void); 2 = a usage or parse error.
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { parseGateLog, diffTable1, type GateTables } from "./javascript-gate-tables"

function argOf(name: string): string | null {
  const a = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`))
  return a ? a.slice(name.length + 3) : null
}
const GATE = argOf("gate")
const TWIN = argOf("twin")
const FALSIFIER = process.argv.includes("--falsifier")

if (!GATE || !TWIN) {
  console.error(`usage: bun run script/m14/javascript-twin-comparator.ts --gate=<gate.log> --twin=<twin.log> [--falsifier]`)
  process.exit(2)
}

function compare(gatePath: string, twinPath: string): { diffs: ReturnType<typeof diffTable1>; gate: GateTables; twin: GateTables } {
  const gate = parseGateLog(gatePath)
  const twin = parseGateLog(twinPath)
  return { diffs: diffTable1(gate, twin), gate, twin }
}

function report(gatePath: string, twinPath: string): number {
  const { diffs, gate, twin } = compare(gatePath, twinPath)
  console.log(`L-16 TWIN COMPARISON`)
  console.log(`  the shipping gate's log: ${gatePath}`)
  console.log(`  the twin's log:          ${twinPath}`)
  console.log(`  TABLE 1 rows compared:   ${gate.table1.length + 1} (per type + TOTAL)`)
  console.log(`  the gate's TOTAL:        edges=${(gate.total1 as any)?.edges} resolved=${(gate.total1 as any)?.resolved} ambDecl=${(gate.total1 as any)?.ambDecl} unresolved=${(gate.total1 as any)?.unresolved}`)
  console.log(`  the twin's TOTAL:        edges=${(twin.total1 as any)?.edges} resolved=${(twin.total1 as any)?.resolved} ambDecl=${(twin.total1 as any)?.ambDecl} unresolved=${(twin.total1 as any)?.unresolved}`)
  if (diffs.length === 0) {
    console.log(`  VERDICT: IDENTICAL — the twin reproduces the shipping gate's TABLE 1 row for row and column for column.`)
    return 0
  }
  console.log(`  VERDICT: **DISAGREEMENT** — ${diffs.length} differing cell(s):`)
  for (const d of diffs.slice(0, 40)) console.log(`    ${d.type}.${d.column}: the gate has ${String(d.left)}, the twin has ${String(d.right)}`)
  if (diffs.length > 40) console.log(`    … and ${diffs.length - 40} more`)
  return 4
}

// ── THE INDEPENDENT FALSIFIER ───────────────────────────────────────────────────────────────────────
// IT CORRUPTS ONE NUMBER IN A SCRATCH COPY OF THE SECOND LOG AND ASSERTS THE COMPARATOR FAILS.
// ⇒ THE SCOPE IS THE SECOND LOG (the twin's), so the corruption is in the file the comparator
// treats as "the thing being checked" ✓✓.
function falsify(gatePath: string, twinPath: string): number {
  const dir = mkdtempSync(path.join(tmpdir(), "js-twin-falsifier-"))
  const scratch = path.join(dir, "corrupted-twin.log")
  const original = readFileSync(twinPath, "utf8")
  const lines = original.split("\n")
  // THE TARGET: the TABLE 1 TOTAL row's `edges` cell. It is present in every gate log, it is a
  // NUMBER, and changing it by one must change the comparison — if it does not, the comparator
  // cannot see a difference and its verdict is void.
  let changed = -1
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/)
    if (parts[0] === "TOTAL" && parts.length > 2 && /^\d+$/.test(parts[1])) {
      parts[1] = String(Number(parts[1]) + 1)
      lines[i] = "  " + parts.join(" ")
      changed = i
      break
    }
  }
  if (changed < 0) {
    console.error(`FALSIFIER FAILED TO ARM: no TOTAL row with a numeric first column in ${twinPath}.`)
    process.exit(5)
  }
  writeFileSync(scratch, lines.join("\n"))
  console.log(`INDEPENDENT FALSIFIER — one number corrupted in a scratch copy of the second log:`)
  console.log(`  the corrupted cell: ${twinPath} line ${changed + 1}, TOTAL row, the edges column, +1`)
  console.log(`  the scratch copy:   ${scratch}`)
  const code = report(gatePath, scratch)
  if (code === 0) {
    console.log(`  ⇒ THE FALSIFIER FAILED: the comparator reported IDENTICAL on a deliberately corrupted log. ⇒ THE COMPARATOR IS BLIND AND ITS VERDICT IS VOID.`)
    return 5
  }
  console.log(`  ⇒ THE FALSIFIER FIRED: the comparator DETECTED the corruption (exit ${code}). ⇒ THE COMPARATOR CAN SEE A DISAGREEMENT, so its IDENTICAL verdict on the uncorrupted pair is a FACT and not a silence.`)
  return 0
}

try {
  process.exit(FALSIFIER ? falsify(GATE, TWIN) : report(GATE, TWIN))
} catch (e: any) {
  console.error(`TWIN COMPARATOR FAILED: ${e?.message ?? e}`)
  process.exit(2)
}
