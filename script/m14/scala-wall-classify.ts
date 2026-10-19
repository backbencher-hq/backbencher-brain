// scala-wall-classify — stream the gate's own scala arm dump into the D7 wall classes (light; no re-parse).
// USAGE: bun run script/m14/scala-wall-classify.ts <dump> [--json out]
import { createReadStream } from "node:fs"
import { createInterface } from "node:readline"
const FILE = process.argv.slice(2).find((a) => !a.startsWith("--"))!
const OUT = process.argv.find((a) => a.startsWith("--json="))?.slice("--json=".length) ?? ""
const labels = new Map<string, any>()
const shapes = new Map<string, number>()
const targetHits = new Map<string, number>()
let rows = 0
const shapeOf = (t: string): string => {
  if (t.length === 0) return "empty"
  if (t.includes("(") || t.includes(")")) return "call-or-attribute"
  if (t.includes("->")) return "arrow"
  if (t.includes(".")) return "dotted"
  if (t.includes("[")) return "generic"
  if (/^[A-Z][A-Za-z0-9_]*$/.test(t)) return "type-ish"
  if (/^[A-Z_][A-Z0-9_]*$/.test(t)) return "allcaps"
  if (/^[a-z_][A-Za-z0-9_]*$/.test(t)) return "lower-ident"
  if (/^[^A-Za-z0-9_]+$/.test(t)) return "operator"
  return "other"
}
const rl = createInterface({ input: createReadStream(FILE, "utf8"), crlfDelay: Infinity })
for await (const line of rl) {
  if (!line.startsWith("DUMP\t")) continue
  const p = line.split("\t"); if (p.length < 5) continue
  const [label, outcome, target, where] = [p[1], p[2], p[3] ?? "", p[4] ?? ""]
  if (!["unresolved", "ambDeclOnly", "ambBoth"].includes(outcome)) continue
  rows++
  const L = labels.get(label) ?? { amb: 0, unresolved: 0, ambDeclOnly: 0, ambBoth: 0, shapes: {}, topTargets: [] as string[], samples: [] as string[] }
  L[outcome] = (L[outcome] ?? 0) + 1
  if (outcome === "unresolved") L.unresolved++
  else L.amb++
  const sh = shapeOf(target)
  L.shapes[sh] = (L.shapes[sh] ?? 0) + 1
  targetHits.set(target, (targetHits.get(target) ?? 0) + 1)
  if (L.samples.length < 5) L.samples.push(`${outcome}\t${target}\t${where}`)
  labels.set(label, L)
}
const top = [...targetHits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)
const report = {
  dump: FILE, wallRows: rows,
  byLabel: Object.fromEntries([...labels.entries()].sort((a, b) => (b[1].amb + b[1].unresolved) - (a[1].amb + a[1].unresolved)).map(([l, v]) => [l, { amb: v.amb, unresolved: v.unresolved, ambDeclOnly: v.ambDeclOnly, ambBoth: v.ambBoth, shapes: Object.fromEntries(Object.entries(v.shapes).sort((a: any, b: any) => b[1] - a[1])), samples: v.samples }])),
  topTargets: top.map(([t, n]) => ({ target: t, rows: n })),
}
if (OUT) { const fs = await import("node:fs"); fs.writeFileSync(OUT, JSON.stringify(report, null, 1) + "\n") }
console.log(JSON.stringify({ wallRows: report.wallRows, byLabel: Object.fromEntries(Object.entries(report.byLabel).map(([l, v]: any) => [l, { amb: v.amb, unresolved: v.unresolved }])), topTargets: top.slice(0, 15) }, null, 1))
