import { parseFile } from "../../../../src/ast/pool-worker"
const f = "/home/ishaq2321/bb_tests/repositories/hasura-engine/server/tests-py/queries/openapi/openapi_endpoint_with_multiple_methods.yaml"
const repo = "/home/ishaq2321/bb_tests/repositories/hasura-engine"
const r: any = await parseFile(f, repo, { projectRoot: repo } as any)
console.log("symbols:", r.symbols.length, "relationships:", r.relationships.length, "parseHadError?", r.metadata?.parseHadError ?? "n/a")
for (const s of r.symbols) {
  const p = String(s.metadata?.pointerPath ?? "")
  const q = String(s.qualifiedName ?? "")
  if (q.includes("uuid!") || q.endsWith(".openapi") || q.endsWith("definition") || q.includes("components.schemas")) {
    console.log("SYM", JSON.stringify(q), "kind=", s.kind, "meta.pointerPath=", JSON.stringify(p), "meta.fullPath=", JSON.stringify(s.metadata?.fullPath))
  }
}
console.log("--- pointer-typed relationships on uuid! ---")
for (const rel of r.relationships) {
  if (String(rel.target ?? "").includes("uuid")) console.log(rel.type, "src=", rel.source, "tgt=", rel.target, "line=", rel.line_number, "md=", JSON.stringify(rel.metadata))
}
