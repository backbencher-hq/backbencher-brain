const REPO = "/home/ishaq2321/mcp/backbencher-brain"
const { getParser } = await import(`${REPO}/src/ast/engine.ts`)
const m: any = await import(`${REPO}/src/ast/real-yaml-analyzer.ts`)
const Cls = Object.values(m).find((v: any) => typeof v === "function" && /Analyzer$/.test(v.name)) as any
import { readFileSync } from "node:fs"
const ROOT = "/home/ishaq2321/bb_tests/repositories/kubernetes"
const files = ["hack/golangci.yaml", "hack/golangci-hints.yaml", "hack/kube-api-linter/kube-api-linter.yaml"]
let hits = 0, markerEdges = 0
for (const rel of files) {
  let content = ""
  try { content = readFileSync(`${ROOT}/${rel}`, "utf8") } catch { console.log(`  (absent) ${rel}`); continue }
  const markerInText = (content.match(/k8s:optional/g) ?? []).length
  hits += markerInText
  const pr = await (await getParser("yaml")).parse(content, `${ROOT}/${rel}`)
  const res = new Cls().analyze(pr.rootNode, content, `${ROOT}/${rel}`)
  const edges = (res.relationships ?? []).filter((e: any) => String(e.target) === "k8s:optional")
  markerEdges += edges.length
  console.log(`  ${rel}: 'k8s:optional' occurs ${markerInText}x in TEXT, ${edges.length} edge(s) emitted`)
}
console.log(`\nTOTAL: the marker occurs ${hits}x in the source, and the analyzer emits ${markerEdges} edge(s) naming it.`)
console.log(markerEdges === 0
  ? "RULE ACTIVE — every marker occurrence is refused, so the class is 0 edges by construction."
  : `RULE NOT FULLY ACTIVE — ${markerEdges} edge(s) still name a marker.`)
