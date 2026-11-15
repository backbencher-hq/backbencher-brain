import { parseFile } from "../../../../src/ast/pool-worker"
const cases = [
  ["gql-sangria/modules/core/src/test/resources/scenarios/execution/Executor.yaml", "gql-sangria"],
  ["ansible/test/integration/targets/roles/privacy.yml", "ansible"],
  ["ansible/test/integration/targets/path_lookups/testplay.yml", "ansible"],
  ["ansible/test/integration/targets/handlers/82241.yml", "ansible"],
]
for (const [rel, repoName] of cases) {
  const repo = `/home/ishaq2321/bb_tests/repositories/${repoName}`
  const f = `/home/ishaq2321/bb_tests/repositories/${rel}`
  const r: any = await parseFile(f, repo, { projectRoot: repo } as any)
  console.log(`\n### ${rel}`)
  for (const rel2 of r.relationships) {
    const md = rel2.metadata ?? {}
    if (md.relationshipType === "yaml_json_pointer" || md.relationshipType === "yaml_keyword_include") {
      console.log(`  ${rel2.type} tgt=${JSON.stringify(rel2.target)} line=${rel2.line_number} resolved=${md.resolved} via=${md.resolvedVia ?? ""} reason=${md.unresolvedReason ?? ""} claimFile=${JSON.stringify(md.importProjectFile ?? null)} roleName=${JSON.stringify(md.roleName ?? null)} isExternal=${md.isExternal}`)
    }
  }
}
