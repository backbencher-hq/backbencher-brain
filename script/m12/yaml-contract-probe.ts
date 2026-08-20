import { readFileSync, writeFileSync } from "node:fs"
import { ASTEngine } from "../../src/ast/engine"

const checks: { name: string; passed: boolean; detail?: string }[] = []
const check = (name: string, passed: boolean, detail?: string) => checks.push({ name, passed, detail })

async function read(file: string) {
  const path = `validation/m12/fixtures/yaml/${file}`
  return ASTEngine.parseFile(path, readFileSync(path, "utf8"))
}

const kubernetes = await read("Kubernetes.yaml")
const symbols = kubernetes.symbols as any[]
const relationships = kubernetes.relationships as any[]
check("multi-document stream creates two modules", symbols.filter((s) => s.kind === "module").length === 2)
check("anchors are emitted once", symbols.filter((s) => s.metadata?.isAnchor).length === 1)
check("anchor has a qualified identity", symbols.some((s) => s.qualifiedName === "Kubernetes.defaults#defaults"))
check("merge key is a property", symbols.some((s) => s.name === "<<" && s.kind === "property"))
check("merge resolves to extends", relationships.some((r) => r.type === "extends" && r.source === "Kubernetes.services.web" && r.target === "Kubernetes.defaults#defaults"))
check("sequence object paths are indexed", symbols.some((s) => s.qualifiedName === "Kubernetes.services.web.ports[0]") && symbols.some((s) => s.qualifiedName === "Kubernetes.services.web.ports[1]"))
check("sequence item paths are unique", new Set(symbols.filter((s) => s.metadata?.isArrayItem).map((s) => s.qualifiedName)).size === symbols.filter((s) => s.metadata?.isArrayItem).length)
check("template metadata is detected", kubernetes.metadata.patterns?.includes("Template Variables") === true)
check("Kubernetes framework is detected", kubernetes.metadata.detectedFrameworks?.includes("Kubernetes") === true)
check("qualified ranges carry byte offsets", symbols.every((s) => Number.isInteger(s.range.startIndex) && Number.isInteger(s.range.endIndex)))

const flow = await read("Flow.yml")
const flowSymbols = flow.symbols as any[]
check("boolean scalar is typed from AST", flowSymbols.some((s) => s.qualifiedName === "Flow.config.enabled" && s.metadata?.scalarType === "boolean"))
check("integer scalar is typed from AST", flowSymbols.some((s) => s.qualifiedName === "Flow.config.retries" && s.metadata?.scalarType === "integer"))
check("float scalar is typed from AST", flowSymbols.some((s) => s.qualifiedName === "Flow.config.ratio" && s.metadata?.scalarType === "float"))
check("null scalar is typed from AST", flowSymbols.some((s) => s.qualifiedName === "Flow.config.nested.nullValue" && s.metadata?.scalarType === "null"))
check("flow sequence remains a variable", flowSymbols.some((s) => s.qualifiedName === "Flow.config.tags" && s.kind === "variable"))
check("ordinary alias resolves to uses", (flow.relationships as any[]).some((r) => r.type === "uses" && r.source === "Flow.alias" && r.target === "Flow.anchor#base"))
check("flow document has no syntax errors", (flow.errors?.length ?? 0) === 0)

const negative = await read("Negative.yaml")
check("malformed YAML reports syntax errors", (negative.errors?.length ?? 0) > 0)
check("malformed recovery emits only valid key", negative.symbols.length === 1 && negative.symbols[0].name === "valid")

const result = {
  analyzer: "yaml",
  checks,
  passed: checks.every((item) => item.passed),
  count: checks.length,
  passedCount: checks.filter((item) => item.passed).length,
}
writeFileSync("validation/m12/results/yaml-contract.json", JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
