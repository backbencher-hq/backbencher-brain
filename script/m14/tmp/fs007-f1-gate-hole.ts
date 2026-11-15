// FS007 — the F1 GATE HOLE, proven: `audit-analyzer-grammar.ts` cannot see a node-type
// literal compared against a BARE LOCAL (`type === "..."`), because its
// `isTypeComparison` requires a `member_expression` ending in `.type`.
//
// The fsharp analyzer dispatches almost entirely on a bare local —
// `const type = node.type` then a long `if/else if (type === "…")` chain — so the
// literals that decide the analyzer's BEHAVIOUR are outside F1's validation set.
// Measured at the baseline run: F1 validates 41 node-type literals for fsharp; the
// analyzer contains 92 type comparisons, and 91 of them read the bare local.
//
// This probe proves the blindness two ways, so the finding cannot be an artifact of how
// the number was counted:
//   1. a DELIBERATE wrong literal in the visible position (`n.type === "not_a_node"`)
//      is caught by F1 today;
//   2. the SAME wrong literal in the invisible position (`type === "not_a_node"`, on the
//      same local the analyzer really uses) is NOT caught.
//
// IT REPORTS, IT DOES NOT GATE. F1 exits non-zero on other lanes' pre-existing dirt
// (bash/css/makefile/markdown/perl/sql), which is not this lane's to fix, so the exit
// code is read but never treated as a failure here. The verdict is the two-row
// comparison, and the shared evidence file is restored byte-for-byte afterwards.
//
// Run: bun script/m14/tmp/fs007-f1-gate-hole.ts
import * as fs from "fs"
import * as path from "path"
import { spawnSync } from "child_process"

const ROOT = path.resolve((import.meta as any).dirname, "../../..")
const TARGET = path.join(ROOT, "src/ast/real-fsharp-analyzer.ts")
const EVIDENCE = path.join(ROOT, "validation/m14/results/M14.0.F1.json")
const BACKUP = "/tmp/opencode/fs007-real-fsharp-analyzer.ts.bak"
const EVIDENCE_BACKUP = "/tmp/opencode/fs007-F1.json.bak"

function runAudit(): { unknown: number; literals: number; line: string; exit: number } {
  const r = spawnSync("bun", [path.join(ROOT, "script/m14/audit-analyzer-grammar.ts")], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  })
  const out = `${r.stdout ?? ""}`
  const line = out.split("\n").find((l) => /^fsharp\s/.test(l)) ?? ""
  const m = line.match(/refs=\s*(\d+)\s+unknown=(\d+)/)
  return { unknown: m ? parseInt(m[2]) : -1, literals: m ? parseInt(m[1]) : -1, line: line.trim(), exit: r.status ?? -1 }
}

function main() {
  const original = fs.readFileSync(TARGET, "utf8")
  fs.writeFileSync(BACKUP, original)
  if (fs.existsSync(EVIDENCE)) fs.copyFileSync(EVIDENCE, EVIDENCE_BACKUP)
  const restore = () => {
    fs.copyFileSync(BACKUP, TARGET)
    if (fs.existsSync(EVIDENCE_BACKUP)) fs.copyFileSync(EVIDENCE_BACKUP, EVIDENCE)
  }
  try {
    const base = runAudit()
    console.log(`baseline            : ${base.line}`)

    // (1) the VISIBLE position: a helper-predicate comparison on `n.type`.
    const visible = original.replace(
      `(n) => n.type === "identifier" || n.type === "long_identifier"`,
      `(n) => n.type === "fs007_not_a_real_node" || n.type === "long_identifier"`,
    )
    if (visible === original) { console.error("ANCHOR 1 NOT FOUND — probe is stale"); process.exit(2) }
    fs.writeFileSync(TARGET, visible)
    const v = runAudit()
    console.log(`injected VISIBLE    : ${v.line}`)
    restore()

    // (2) the INVISIBLE position: the bare local the analyzer's dispatch chain uses.
    const invisible = original.replace(
      `      } else if (type === "val_property_defn") {`,
      `      } else if (type === "fs007_also_not_a_real_node") {`,
    )
    if (invisible === original) { console.error("ANCHOR 2 NOT FOUND — probe is stale"); process.exit(2) }
    fs.writeFileSync(TARGET, invisible)
    const n = runAudit()
    console.log(`injected INVISIBLE  : ${n.line}`)
    restore()

    console.log(`\n(F1's own exit code was ${base.exit} on the baseline run — pre-existing dirt on`)
    console.log(` other lanes, reported here and not treated as this lane's verdict.)\n`)

    const realDead = /type === "val_property_defn"/.test(original)
    const caughtVisible = v.unknown > base.unknown
    const caughtInvisible = n.unknown > base.unknown
    console.log(`verdict:`)
    console.log(`  F1 caught the visible injection   : ${caughtVisible ? "YES" : "NO"}  (unknown ${base.unknown} -> ${v.unknown})`)
    console.log(`  F1 caught the invisible injection : ${caughtInvisible ? "YES" : "NO"}  (unknown ${base.unknown} -> ${n.unknown})`)
    console.log(`  a real dead branch already ships : ${realDead ? '"val_property_defn" — an anonymous node, so the branch can never fire' : "absent"}`)
    const confirmed = caughtVisible && !caughtInvisible
    console.log(`\n  ${confirmed ? "CONFIRMED: F1's fsharp set excludes the bare-local dispatch chain that decides the analyzer's behaviour." : "NOT CONFIRMED — the hole did not reproduce; do not file this."}`)
    process.exit(confirmed ? 0 : 1)
  } finally {
    restore()
  }
}
main()
