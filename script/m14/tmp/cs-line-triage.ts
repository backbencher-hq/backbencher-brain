// script/m14/tmp/cs-line-triage.ts — classify the csharp line round's
// INCONSISTENT set by SHAPE (not by count). Reads the oracle's scoped artifact,
// which carries up to 5 samples per file with the claimed line's source text.
import * as fs from "fs"

const p = "validation/m59/results/oracle-callsite-scoped-csharp-f200.json"
const a = JSON.parse(fs.readFileSync(p, "utf8"))
const files: any[] = Array.isArray(a.perFile) ? a.perFile : Object.values(a.perFile ?? {}).flat() as any[]
console.log("top-level keys:", Object.keys(a).join(","))
const samples: any[] = []
let inconsistentTotal = 0
const byType: Record<string, number> = {}
for (const f of files) {
  inconsistentTotal += f.inconsistent ?? 0
  for (const s of f.inconsistentSample ?? []) samples.push({ ...s, file: f.file })
}
for (const s of samples) byType[s.type] = (byType[s.type] ?? 0) + 1
console.log(`\nINCONSISTENT total=${inconsistentTotal}  sampled=${samples.length}`)
console.log("by type (sampled):", JSON.stringify(byType))

// Group by a coarse shape: the token, and whether the claimed line looks like a
// declaration, a call, a type reference, etc.
const norm = (s: any) => `${s.type} | token=${s.callee} | src=${JSON.stringify((s.sourceLine ?? "").slice(0, 70))}`
const groups = new Map<string, { n: number; examples: any[] }>()
for (const s of samples) {
  const k = norm(s)
  const g = groups.get(k) ?? { n: 0, examples: [] }
  g.n++
  if (g.examples.length < 3) g.examples.push(`${s.file}:${s.claimedLine}`)
  groups.set(k, g)
}
const sorted = [...groups.entries()].sort((x, y) => y[1].n - x[1].n)
console.log(`\ndistinct sampled shapes: ${sorted.length}`)
for (const [k, g] of sorted.slice(0, 60)) {
  console.log(`  [${g.n}] ${k}  @ ${g.examples.join(", ")}`)
}
