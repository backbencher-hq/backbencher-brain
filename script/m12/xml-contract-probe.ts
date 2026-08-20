import { readFileSync, writeFileSync } from "node:fs"
import { ASTEngine } from "../../src/ast/engine"

const checks: { name: string; passed: boolean; detail?: string }[] = []
const check = (name: string, passed: boolean, detail?: string) => checks.push({ name, passed, detail })

const read = async (file: string) => {
  const path = `validation/m12/fixtures/xml/${file}`
  return ASTEngine.parseFile(path, readFileSync(path, "utf8"))
}

const catalog = await read("Catalog.xml")
const catalogNames = new Set(catalog.symbols.map((s: any) => `${s.kind}:${s.name}`))
check("document PI is a module symbol", catalogNames.has("module:catalog-processing"))
check("default namespace is a namespace symbol", catalogNames.has("namespace:default"))
check("prefixed namespace is a namespace symbol", catalogNames.has("namespace:book"))
check("empty-element attribute is extracted", catalogNames.has("property:name"))
check("element ranges carry byte offsets", catalog.symbols.filter((s: any) => s.metadata?.isXmlElement).every((s: any) => Number.isInteger(s.range.startIndex) && Number.isInteger(s.range.endIndex)))
check("valid catalog has no syntax errors", (catalog.errors?.length ?? 0) === 0)

const doctype = await read("Doctype.xml")
check("DOCTYPE external ID is an import", doctype.imports.some((i: any) => i.path === "catalog.dtd" && i.importType === "xml-doctype"))
check("DOCTYPE import relationship is emitted", doctype.relationships.some((r: any) => r.type === "imports" && r.source === "catalog" && r.target === "catalog.dtd"))
check("valid doctype document has no syntax errors", (doctype.errors?.length ?? 0) === 0)

const schema = await read("Schema.xsd")
check("XSD extension detects as XML", schema.language === "xml")
check("schema constructs retain structural metadata", schema.symbols.some((s: any) => s.metadata?.isSchemaConstruct === true))
check("valid XSD has no syntax errors", (schema.errors?.length ?? 0) === 0)

const negative = await read("Negative.xml")
check("malformed XML reports syntax errors", (negative.errors?.length ?? 0) > 0)
check("malformed XML creates no recovery symbols", negative.symbols.length === 0)

const result = {
  analyzer: "xml",
  checks,
  passed: checks.every((item) => item.passed),
  count: checks.length,
  passedCount: checks.filter((item) => item.passed).length,
}
writeFileSync("validation/m12/results/xml-contract.json", JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
