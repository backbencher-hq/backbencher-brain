import { readFileSync, writeFileSync } from "node:fs"
import { ASTEngine } from "../../src/ast/engine"

const checks: { name: string; passed: boolean; detail?: string }[] = []
const check = (name: string, passed: boolean, detail?: string) => checks.push({ name, passed, detail })

async function read(file: string) {
  const path = `validation/m12/fixtures/hcl/${file}`
  return ASTEngine.parseFile(path, readFileSync(path, "utf8"))
}

const infra = await read("Infrastructure.tf")
const symbols = infra.symbols as any[]
const relationships = infra.relationships as any[]

// Block symbol identity + kind mapping
check("terraform block is a module", symbols.some((s) => s.name === "terraform" && s.kind === "module"))
check("provider block is a module", symbols.some((s) => s.name === "aws" && s.kind === "module"))
check("variable block is a variable", symbols.some((s) => s.name === "region" && s.kind === "variable"))
check("output block is a variable", symbols.some((s) => s.name === "instance_ip" && s.kind === "variable"))
check("module block is a module", symbols.some((s) => s.name === "network" && s.kind === "module"))
check("locals block is a module", symbols.some((s) => s.name === "locals" && s.kind === "module"))
check("data source is a class with type.name identity", symbols.some((s) => s.name === "aws_ami.ubuntu" && s.kind === "class"))
check("resource is a class with type.name identity", symbols.some((s) => s.name === "aws_instance.web" && s.kind === "class"))
check("resource is a class with type.name identity (sg)", symbols.some((s) => s.name === "aws_security_group.web" && s.kind === "class"))

// Nested block + owner chain
const lifecycle = symbols.find((s) => s.name === "lifecycle")
check("nested lifecycle block is a class", lifecycle?.kind === "class")
check("nested lifecycle owner is the resource", lifecycle?.ownerName === "aws_instance.web")
check("nested lifecycle scope is the resource", lifecycle?.scope === "aws_instance.web")
const backend = symbols.find((s) => s.name === "backend.s3")
check("nested backend block keeps block type in identity", backend?.name === "backend.s3" && backend?.ownerName === "terraform")

// Attribute owner contract
const ami = symbols.find((s) => s.name === "ami")
check("attribute is a property", ami?.kind === "property")
check("attribute owner is enclosing block", ami?.ownerName === "aws_instance.web")
check("attribute scope is qualified", ami?.scope === "aws_instance.web")
const cbd = symbols.find((s) => s.name === "create_before_destroy")
check("nested attribute owner is the nested block", cbd?.ownerName === "lifecycle" && cbd?.scope === "aws_instance.web.lifecycle")

// Containment relationships
check("resource contains attribute", relationships.some((r) => r.type === "contains" && r.source === "aws_instance.web" && r.target === "aws_instance.web.ami"))
check("resource contains nested block", relationships.some((r) => r.type === "contains" && r.source === "aws_instance.web" && r.target === "aws_instance.web.lifecycle"))
check("nested block contains its attribute", relationships.some((r) => r.type === "contains" && r.source === "aws_instance.web.lifecycle" && r.target === "aws_instance.web.lifecycle.create_before_destroy"))

// Reference families
check("references var.<name>", relationships.some((r) => r.type === "references" && r.source === "aws_instance.web" && r.target === "var.instance_count"))
check("references local.<name>", relationships.some((r) => r.type === "references" && r.source === "aws_instance.web" && r.target === "local.common_tags"))
check("references data source attribute", relationships.some((r) => r.type === "references" && r.source === "aws_instance.web" && r.target === "data.aws_ami.ubuntu.id"))
check("references resource attribute", relationships.some((r) => r.type === "references" && r.source === "instance_ip" && r.target === "aws_instance.web.public_ip"))
check("depends_on references a resource", relationships.some((r) => r.type === "references" && r.source === "aws_security_group.web" && r.target === "aws_instance.web"))

// Template interpolation + object-key + type-keyword + loop-var exclusions
check("template interpolation is extracted", relationships.some((r) => r.type === "references" && r.source === "locals" && r.target === "var.region"))
check("object value reference is extracted", relationships.some((r) => r.type === "references" && r.source === "locals" && r.target === "var.environment"))
check("object key is NOT a reference", !relationships.some((r) => r.type === "references" && r.target === "Environment"))
check("type keyword `string` is NOT a reference", !relationships.some((r) => r.type === "references" && r.target === "string"))
check("for-loop iterable is extracted", relationships.some((r) => r.type === "references" && r.source === "locals" && r.target === "var.instance_ids"))
check("for-loop variable `i` is NOT a reference", !relationships.some((r) => r.type === "references" && (r.target === "i" || r.target.startsWith("i."))))

// Module import contract
check("module import records the source path", (infra.imports as any[]).some((i) => i.module === "network" && i.path === "./modules/network"))

// Range + byte offsets
check("all ranges carry byte offsets", symbols.every((s) => Number.isInteger(s.range.startIndex) && Number.isInteger(s.range.endIndex)))

// No analyzer-owned syntax errors on the clean fixture
check("clean fixture has no syntax errors", (infra.errors?.length ?? 0) === 0)

// Negative fixture: engine-owned error + no phantom symbol for malformed count
const negative = await read("Negative.tf")
check("malformed HCL reports a syntax error", (negative.errors?.length ?? 0) > 0)
check("malformed count argument produces no phantom symbol", !(negative.symbols as any[]).some((s) => s.name === "count"))
check("malformed file still extracts valid symbols", (negative.symbols as any[]).some((s) => s.name === "aws_instance.web"))

// No source-text regex in the analyzer
const source = readFileSync("src/ast/real-hcl-analyzer.ts", "utf8")
check("analyzer uses no regex literals or match/replace/split", !/(\.match\(|\.replace\(|\.test\(|RegExp\s*\(|\/\^|\\\.\*\/)/.test(source))

const result = {
  analyzer: "hcl",
  checks,
  passed: checks.every((item) => item.passed),
  count: checks.length,
  passedCount: checks.filter((item) => item.passed).length,
}
writeFileSync("validation/m12/results/hcl-contract.json", JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
