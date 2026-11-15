/**
 * Scratch edge probe (this session only): does ONE file emit an edge to a given target?
 * Used to confirm the keyword / concept-`Self` guard fires where the census says it should.
 *
 * Usage: npx tsx validation/m14/fixtures/nim/tmp-edge-probe.mts <file> <target> [target ...]
 */
import { parseFile } from "../../../../src/ast/pool-worker"

const [file, ...targets] = process.argv.slice(2)
if (!file || targets.length === 0) { console.error("usage: tmp-edge-probe.mts <file> <target>..."); process.exit(2) }
const repo = file.slice(0, file.indexOf("/repositories/") + "/repositories/".length)
const repoRoot = repo + file.slice(repo.length).split("/")[0]
const r: any = await parseFile(file, repoRoot, { projectRoot: repoRoot } as any)
const rels: any[] = Array.isArray(r?.relationships) ? r.relationships : []
console.log(`${file.split("repositories/")[1]} — ${rels.length} relationships`)
for (const t of targets) {
  const hits = rels.filter((x) => String(x?.target ?? "") === t)
  console.log(`  target "${t}" : ${hits.length} edge(s)`)
  for (const h of hits.slice(0, 4)) console.log(`     ${h.type} line ${h.line_number}  ${JSON.stringify(h.metadata)}`)
}
