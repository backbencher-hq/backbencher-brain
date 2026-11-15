import { parseFile } from "../../../../src/ast/pool-worker"
const repo = "/home/ishaq2321/bb_tests/repositories/gql-sangria"
const f = `${repo}/modules/core/src/test/resources/scenarios/execution/Executor.yaml`
const r: any = await parseFile(f, repo, { projectRoot: repo } as any)
console.log("symbols containing test-data:", r.symbols.filter((s: any) => String(s.qualifiedName).includes("test-data")).slice(0, 8).map((s: any) => s.qualifiedName))
for (const rel2 of r.relationships) {
  const md = rel2.metadata ?? {}
  if (rel2.type === "references") console.log("REF src=", JSON.stringify(rel2.source), "tgt=", JSON.stringify(rel2.target), "rt=", md.relationshipType, "pointer=", JSON.stringify(md.pointer))
}
