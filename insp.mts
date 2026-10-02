import * as fs from "fs"
import { RealGroovyAnalyzer } from "./src/ast/real-groovy-analyzer"
const file = process.argv[2]
const src = fs.readFileSync(file, "utf8")
const a: any = new (RealGroovyAnalyzer as any)()
const r = a.analyze(file, src, "groovy")
const syms = r.symbols ?? []
console.log(`  ${syms.length} symbols`)
for (const s of syms) {
  if (!/constructor/i.test(String(s.symbolKind ?? "")) && !/^(Color|Robot|Counter|User|UserService)$/.test(String(s.name)))
    continue
  console.log(`   kind=${s.symbolKind} name=${JSON.stringify(s.name)} owner=${s.ownerName ?? "-"} line=${s.range?.start?.line ?? "?"} nodeType=${s.metadata?.nodeType ?? "-"}`)
}
