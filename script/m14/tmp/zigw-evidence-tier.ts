/**
 * ZIG WAVE 5 — the EVIDENCE-TIER gate (Z36).
 *
 * Every analyzer in this family classifies each edge it publishes, and the
 * classification is CONSUMED: the MCP handler's `tierFor` returns a STORED
 * `metadata.evidenceClass` in preference to one derived from the relationship
 * type, so a wrong stored value beats a correct derivation. The rule is stated
 * explicitly in ~26 analyzers (objc/c/clean/yaml among them):
 *
 *   contains                        structural
 *   imports / exports / references  import_based
 *   calls / uses                    usage_contextual (or inferred below threshold)
 *   instantiates                    structural when proven, else inferred
 *
 * Wave 4 added two classes and no gate on this lane asked whether they survived
 * the pipeline. They did not: `imports` and `exports` fell through to the default
 * and were published as `usage_contextual` — a module dependency and a published
 * API name, both reported as usage — and the `instantiates` branch read two
 * metadata fields this lane never set, so it returned the right answer by
 * accident. That is the class of defect only a pipeline question finds, and this
 * file is that question.
 *
 * CALIBRATION NOTE, because a gate that has never been observed to fail is not
 * evidence: the expected table below was written from the FAMILY'S rule, not from
 * this lane's current output, and it reported 5 of 7 types wrong on its first run.
 * A table copied from the thing it is meant to check would have passed.
 *
 * Usage: npx tsx script/m14/tmp/zigw-evidence-tier.ts [files]
 */
import * as fs from "fs"
import { init, zigFiles, parser, analyzer } from "./zigw-harness"

const EXPECTED: Record<string, string[]> = {
  contains: ["structural"],
  imports: ["import_based"],
  exports: ["import_based"],
  calls: ["usage_contextual", "inferred"],
  uses: ["usage_contextual", "inferred", "import_based", "reference_qualified"],
  references: ["import_based", "reference_qualified"],
  instantiates: ["structural", "inferred"],
}

async function main(): Promise<void> {
  await init()
  const limit = Number(process.argv[2] ?? 200)
  const files = zigFiles(["zig", "zls", "ghostty"], limit)
  const seen = new Map<string, Map<string, number>>()
  const bad: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser().parse(src)
    const res: any = analyzer().analyze(tree.rootNode, src, f)
    for (const r of res.relationships as any[]) {
      const t = String(r.type)
      const tier = String((r.metadata ?? {}).evidenceClass ?? "(none)")
      const m = seen.get(t) ?? new Map<string, number>()
      m.set(tier, (m.get(tier) ?? 0) + 1)
      seen.set(t, m)
      const allowed = EXPECTED[t]
      if (allowed && !allowed.includes(tier) && bad.length < 12) {
        bad.push(`${f.split("/repositories/")[1]}  ${t} -> ${tier}  (family rule allows: ${allowed.join(" | ")})`)
      }
    }
    tree.delete()
  }
  console.log(`files: ${files.length}`)
  for (const [t, m] of [...seen].sort()) {
    const allowed = EXPECTED[t] ?? ["(no family rule recorded)"]
    const ok = [...m.keys()].every((k) => allowed.includes(k))
    console.log(`  ${ok ? "OK  " : "WRONG"} ${t.padEnd(13)} ${JSON.stringify(Object.fromEntries(m))}${ok ? "" : `   <- allowed: ${allowed.join(" | ")}`}`)
  }
  const unclassified = [...seen.keys()].filter((t) => !EXPECTED[t])
  if (unclassified.length) console.log(`\n  NOTE: ${unclassified.join(", ")} carry no family rule recorded here — a NEW class is exactly how Z36 happened, so a type with no rule is a gap in THIS table rather than a pass.`)
  for (const b of bad) console.log("  " + b)
  console.log(bad.length === 0 ? "\nverdict: every class carries a tier the family rule allows" : `\nverdict: ${bad.length}+ class/tier combination(s) violate the family rule`)
  process.exit(bad.length === 0 ? 0 : 1)
}
void main()
