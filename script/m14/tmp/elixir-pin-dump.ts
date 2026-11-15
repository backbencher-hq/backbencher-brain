/** Print the metadata fields a fixture pin can assert, for the named fixture
 *  files — expectation authoring that reads the analyzer so a pin is exact. */
import * as fs from "node:fs"
import * as path from "node:path"
const ROOT = "/home/sano/ishaq/backbencher-brain"
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const FILES = (arg("files") ?? "").split(",").filter(Boolean)
const FIELDS = (arg("fields") ?? "guards,hasPatternMatching,isTypeSpec,isProtocol,isProtocolImplementation,forType,isStruct,isStructField,docstring,visibility,scope,ownerName,kind,metadata.otpBehavior").split(",")
async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  for (const rel of FILES) {
    const f = path.join(ROOT, "validation/m14/fixtures/elixir", rel)
    const text = fs.readFileSync(f, "utf8")
    const res: any = await ASTEngine.parseFile(f, text)
    console.log(`\n##### ${rel}`)
    for (const s of res.symbols ?? []) {
      const out: any = {}
      for (const fld of FIELDS) {
        if (fld.startsWith("metadata.")) { const k = fld.slice(9); if (s.metadata && k in s.metadata) out[fld] = s.metadata[k] }
        else if (fld === "docstring") { if (s.docstring !== undefined) out.docstring = s.docstring }
        else out[fld] = s[fld]
      }
      console.log(`  ${s.kind} ${s.name} ${JSON.stringify(out)}`)
    }
    if ((arg("rels") ?? "") === "1") for (const r of res.relationships ?? []) console.log(`  R ${r.type} ${r.source} -> ${r.target} @${r.line_number} ${JSON.stringify(r.metadata)}`)
    if ((arg("imports") ?? "") === "1") console.log(`  IMPORTS ${JSON.stringify(res.imports)}`)
    if ((arg("exports") ?? "") === "1") console.log(`  EXPORTS ${JSON.stringify((res.exports ?? []).map((e: any) => e.name))}`)
    if ((arg("patterns") ?? "") === "1") console.log(`  PATTERNS ${JSON.stringify(res.metadata?.patterns)}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
