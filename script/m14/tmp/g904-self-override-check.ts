// #904 verification: the two files that produced the measured self-override
// edges must no longer emit an override whose source equals its target, and the
// rest of the file's override edges must survive.
//
// Run: bun script/m14/tmp/g904-self-override-check.ts
import { parseFile } from "../../../src/ast/pool-worker"

const CASES: Array<[string, string, string, string, string]> = [
  [
    "groovy",
    "/home/ishaq2321/bb_tests/repositories/grails-core",
    "/home/ishaq2321/bb_tests/repositories/grails-core/grails-datamapping-rx/src/main/groovy/org/grails/gorm/rx/finders/FindAllByFinder.groovy",
    "FindAllByFinder",
    "doInvokeInternal",
  ],
  [
    "scala",
    "/home/ishaq2321/bb_tests/repositories/scala3",
    "/home/ishaq2321/bb_tests/repositories/scala3/library/src/scala/io/Position.scala",
    "Position",
    "checkInput",
  ],
]

// The whole-file self-override scan is the general form: no file anywhere may
// emit an override whose source and target are identical.
for (const [lang, root, file, owner, method] of CASES) {
  const r: any = await parseFile(file, root)
  const ovr = (r.relationships ?? []).filter((x: any) => String(x.type) === "overrides")
  const self = ovr.filter((x: any) => x.source === x.target)
  console.log(`\n=== ${lang}: ${file.split("/").pop()} ===`)
  console.log(`overrides edges: ${ovr.length} | self (source === target): ${self.length}`)
  for (const s of self) console.log(`  SELF  ${s.source} -> ${s.target} conf=${s.confidence} ${s.metadata?.reasonCode}`)
  const target = ovr.filter((x: any) => String(x.source).startsWith(`${owner}.`) && String(x.source).includes(method))
  console.log(`edges out of ${owner}.${method}: ${target.length}`)
  for (const t of target) console.log(`  ${t.source} -> ${t.target} (conf ${t.confidence}, ${t.metadata?.reasonCode})`)
}
