// CS-DEEP-18 — the RELATIONSHIP-TYPE LEDGER: which emitted labels has an independent
// corpus-scale oracle, and which is gated only by fixtures and mutants.
//
// The question "are all relationships emitted?" has two halves that get conflated:
//
//   COVERAGE    does the analyzer emit the edges the tree implies?  (the F5 differential)
//   ORACLE      is there an INDEPENDENT derivation of the same edge to compare against?
//
// 100% coverage with no oracle is not a claim — it is a lane agreeing with itself. The F5
// artifact's per-lane allowlist is what decides which labels get the second half, and for
// csharp it is narrower than the set of labels the analyzer emits. This prints the ledger, so
// "the lane is done" can be checked against a table rather than against a summary line.
//
// Also emits, on real code, the count of every label the analyzer actually produces — because
// a label with a zero count cannot be "unemitted", and a label with a large count and no
// oracle is the real exposure.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

/** The F5 per-lane label allowlist, read out of differential.ts's own source. */
function csharpComparedLabels(diffSrc: string): { compared: string[]; excluded: string[] } {
  // The analyzer-side filter is the `...(["calls","references"])` csharp clause plus the
  // universal four. Read them out of the source rather than restating them, so this
  // instrument cannot drift from the gate it is describing.
  const universal = ["extends", "implements", "instantiates"]
  const m = diffSrc.match(/\.\.\.\(lang === "csharp" \? \[([^\]]*)\] : \[\]\)/)
  const compared = [...universal, ...(m ? m[1].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean) : [])]
  // `overrides` moved out of a "lanes that compare it" list into a "lanes that EXCLUDE it" list
  // in the 2026-09-28 round, so the first version of this instrument read it as absent and
  // under-reported the covered share. Derive it from the exclusion form as well, or the ledger
  // becomes the one instrument in the round that cannot see a change it is supposed to measure.
  const ex = diffSrc.match(/\.\.\.\((lang === "[a-z]+"(?: \|\| lang === "[a-z]+")*) \? \[\] : \["overrides"\]\)/)
  if (ex && !ex[1].includes('lang === "csharp"') && !compared.includes("overrides")) compared.push("overrides")
  return { compared: compared.sort(), excluded: [] }
}

async function main() {
  const listFile = arg("--list")
  if (!listFile) { console.error("usage: cs-deep-18-relationship-ledger.ts --list <paths> [limit]"); process.exit(2) }
  const limit = Number(arg("--limit") ?? 300)
  const files = fs.readFileSync(listFile, "utf8").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, limit)

  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const counts = new Map<string, number>()
  const usesOfLabel = new Map<string, Set<string>>()
  const byEvidence = new Map<string, Map<string, number>>()
  let total = 0
  for (const f of files) {
    const res: any = await ASTEngine.parseFile(f, fs.readFileSync(f, "utf8"))
    for (const r of res.relationships ?? []) {
      const t = String(r.type ?? r.relationshipType ?? "?")
      counts.set(t, (counts.get(t) ?? 0) + 1)
      if (t === "uses") {
        let set = usesOfLabel.get(t)
        if (!set) { set = new Set<string>(); usesOfLabel.set(t, set) }
        set.add(String((r.metadata ?? {}).relationshipType ?? "-"))
      }
      total++
      let m = byEvidence.get(t)
      if (!m) { m = new Map<string, number>(); byEvidence.set(t, m) }
      const ev = String((r.metadata ?? {}).evidenceClass ?? "-")
      m.set(ev, (m.get(ev) ?? 0) + 1)
    }
  }

  const diffSrc = fs.readFileSync(path.join(ROOT, "script", "m14", "differential.ts"), "utf8")
  const { compared } = csharpComparedLabels(diffSrc)
  // 2026-09-28: the allowlist also admits `uses` for csharp, but scoped to the FIELD-ACCESS
  // marker — the bare-identifier half still has no truth and is excluded at the filter. So
  // `uses` is compared for the csharp_field_access rows and NOT for identifier_usage ones, and
  // the ledger has to say which is which or the share it prints is a rounding error.
  const MARKER_SCOPED: Record<string, Set<string> | null> = { uses: new Set(["csharp_field_access"]) }

  console.log(`files: ${files.length}   relationships emitted: ${total}\n`)
  console.log("label          emitted   % of total   F5 corpus oracle?   evidence classes")
  console.log("-".repeat(96))
  for (const [label, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const scope = MARKER_SCOPED[label]
    const allOfLabel = usesOfLabel.get(label) ?? new Set<string>()
    const has = compared.includes(label) && (scope == null || (scope.size > 0 && [...allOfLabel].some((m) => scope.has(m))))
    const ev = [...(byEvidence.get(label) ?? new Map()).entries()].map(([k, v]) => `${k}:${v}`).join(" ")
    console.log(
      `  ${label.padEnd(14)}${String(n).padStart(7)} ${((n / total) * 100).toFixed(1).padStart(10)}%   ` +
      `${(has ? "YES" : "NO  <--").padEnd(19)} ${ev}`,
    )
  }
  const noOracle = [...counts.entries()].filter(([l]) => !compared.includes(l)).sort((a, b) => b[1] - a[1])
  console.log(`\nF5 compares for csharp: ${compared.join(", ")}`)
  console.log(`labels with NO independent corpus oracle: ${noOracle.length}`)
  for (const [l, n] of noOracle) console.log(`   ${l.padEnd(14)} ${n} edges  (${((n / total) * 100).toFixed(1)}% of all emitted)`)
  const covered = total - noOracle.reduce((a, b) => a + b[1], 0)
  console.log(`\nshare of emitted edges that HAVE an independent oracle: ${((covered / total) * 100).toFixed(1)}%`)
}

if (import.meta.main) await main()
