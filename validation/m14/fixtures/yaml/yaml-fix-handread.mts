/** Hand-read extractor: for ten named edges the fix moves, print the source line, the emitted
 *  target, and the declaration on disk the code actually means (role entry file / test-data key). */
import { readFileSync, existsSync } from "node:fs"
import { parseFile } from "../../../../src/ast/pool-worker"
const REPOS = "/home/ishaq2321/bb_tests/repositories"
const cases: [string, number][] = [
  ["ansible/test/integration/targets/roles/privacy.yml", 21],
  ["ansible/test/integration/targets/roles/privacy.yml", 33],
  ["ansible/test/integration/targets/roles/privacy.yml", 44],
  ["ansible/test/integration/targets/roles/privacy.yml", 55],
  ["ansible/test/integration/targets/roles/allowed_dupes.yml", 9],
  ["ansible/test/integration/targets/roles/allowed_dupes.yml", 18],
  ["ansible/test/integration/targets/path_lookups/testplay.yml", 8],
  ["ansible/test/integration/targets/handlers/82241.yml", 4],
  ["gql-sangria/modules/core/src/test/resources/scenarios/execution/Executor.yaml", 38],
  ["gql-sangria/modules/core/src/test/resources/scenarios/execution/Executor.yaml", 47],
]
const cache = new Map<string, any>()
for (const [rel, line] of cases) {
  const repoName = rel.split("/")[0]
  const repo = `${REPOS}/${repoName}`
  const f = `${REPOS}/${rel}`
  if (!cache.has(repo)) cache.set(repo, new Map())
  const byFile: Map<string, any> = cache.get(repo)
  if (!byFile.has(rel)) byFile.set(rel, await parseFile(f, repo, { projectRoot: repo } as any))
  const r = byFile.get(rel)
  const src = readFileSync(f, "utf8").split("\n")
  console.log(`\n### ${rel}:${line}`)
  console.log(`  SOURCE   ${JSON.stringify(src[line - 1])}`)
  const rels = r.relationships.filter((x: any) => x.line_number === line &&
    (x.metadata?.relationshipType === "yaml_keyword_include" || x.metadata?.relationshipType === "yaml_json_pointer"))
  for (const x of rels) {
    const md = x.metadata ?? {}
    console.log(`  EMITTED  type=${x.type} target=${JSON.stringify(x.target)} resolved=${md.resolved} via=${md.resolvedVia ?? ""} claimFile=${JSON.stringify(md.importProjectFile ?? null)} roleName=${JSON.stringify(md.roleName ?? null)}`)
    if (md.importProjectFile) {
      const tf = `${repo}/${md.importProjectFile[0]}`
      console.log(`  ON DISK  ${existsSync(tf) ? "EXISTS" : "MISSING"} ${md.importProjectFile[0]}`)
      if (existsSync(tf)) {
        const t = readFileSync(tf, "utf8").trim().split("\n").slice(0, 3)
        console.log(`  DECLARES ${JSON.stringify(t)}`)
      }
    }
    if (md.relationshipType === "yaml_json_pointer") {
      const declared = r.symbols.some((s: any) => String(s.qualifiedName) === String(x.target))
      console.log(`  DECLARES the file publishes a symbol with that exact qualifiedName: ${declared}`)
      // the declaring mapping key as the source writes it
      const key = String(x.target).split(".").pop()
      console.log(`  SOURCE KEY ${JSON.stringify(key)} at line(s) ${(src.map((l, i) => [l, i + 1] as const).filter(([l]) => l.trim().startsWith(key + ":")).map(([, i]) => i).join(","))}`)
    }
  }
  if (rels.length === 0) console.log("  (no pointer/keyword edge on this line)")
}
