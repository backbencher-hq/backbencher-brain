// M12 powershell contract probe — asserts the analyzer's semantic contract
// directly on the production parseFile output.
import { readFileSync, writeFileSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = process.cwd()
const FIX = "validation/m12/fixtures/powershell"

const checks: { name: string; pass: boolean; detail: string }[] = []
const check = (name: string, pass: boolean, detail = "") => {
  checks.push({ name, pass, detail })
}

const module_ = await parseFile(`${FIX}/Module.ps1`, ROOT)
const deploy = await parseFile(`${FIX}/Deploy.ps1`, ROOT)
const negative = await parseFile(`${FIX}/Negative.ps1`, ROOT)

const syms = (p: any) => p.symbols ?? []
const rels = (p: any) => p.relationships ?? []
const byName = (p: any, name: string, kind?: string) =>
  syms(p).filter((s: any) => s.name === name && (!kind || s.kind === kind))
const hasRel = (p: any, type: string, source: string, target: string) =>
  rels(p).some((r: any) => (r.type ?? r.relationshipType) === type && (r.source ?? r.sourceId) === source && (r.target ?? r.targetId) === target)

// --- functions & params -----------------------------------------------------
check("Get-Config function", byName(module_, "Get-ConfigPath", "function").length === 1)
check("params typed", byName(module_, "Get-ConfigPath")[0]?.parameters?.[0]?.type === "string", "EnvName: string")
check("param optional", byName(module_, "Get-ConfigPath")[0]?.parameters?.[1]?.isOptional === true, "Retries defaults")
check("script param declared", byName(module_, "Environment", "variable").length === 1, "param([string]$Environment)")
check("no $ prefix on symbols", !syms(module_).some((s: any) => s.name?.startsWith("$")))

// --- classes ------------------------------------------------------------------
check("class Deployment", byName(module_, "Deployment", "class").length === 1)
check("property Name owned by class", byName(module_, "Name", "property")[0]?.ownerName === "Deployment")
check("constructor named like class", byName(module_, "Deployment", "constructor").length === 1)
check("constructor params", byName(module_, "Deployment", "constructor")[0]?.parameters?.length === 1)
check("method Start owned by class", byName(module_, "Start", "method")[0]?.ownerName === "Deployment")
check("static method FromName", byName(module_, "FromName", "method").length === 1)
check("inheritance edge", hasRel(module_, "extends", "ProdDeployment", "Deployment"))

// --- enums --------------------------------------------------------------------
check("enum EnvironmentKind", byName(module_, "EnvironmentKind", "enum").length === 1)
check("enum members", byName(module_, "Dev", "enum_member").length === 1 && byName(module_, "Prod", "enum_member").length === 1)

// --- variables -----------------------------------------------------------------
check("assignment declares variable", byName(deploy, "cfg", "variable").length === 1, "$cfg = ...")
check("foreach var declared", byName(module_, "item", "variable").length === 1)
check("switch mode declared once", byName(module_, "mode", "variable").length === 1, "reassignment deduped")
check("global-qualified skipped", !syms(module_).some((s: any) => s.name?.startsWith("global:") || s.name?.startsWith("script:")))
check("automatic var skipped", !syms(module_).some((s: any) => s.name === "this" || s.name === "_"))

// --- calls / instantiations / imports -----------------------------------------
check("cmdlet call", hasRel(module_, "calls", "global", "Get-Service"))
check("static call qualified", hasRel(module_, "calls", "global", "Deployment::FromName"))
check("static new instantiates", hasRel(module_, "instantiates", "global", "Deployment"))
check("method call", hasRel(deploy, "calls", "global", "Describe"), "$app.Describe()")
check("dot-source invocation", hasRel(module_, "calls", "global", "./bootstrap.ps1"))
check("call operator invocation", hasRel(module_, "calls", "global", "./run-check.ps1"))
check("Import-Module bare arg", hasRel(module_, "references", "global", "Az.Accounts"), "-Name flag value captured")
check("using module import", hasRel(module_, "references", "global", "./helpers.psm1"))
check("#requires module import", hasRel(module_, "references", "global", "ActiveDirectory"))
check("pipeline commands each called", hasRel(module_, "calls", "global", "Get-Process") && hasRel(module_, "calls", "global", "Stop-Process"))
check("property read not called", !hasRel(module_, "calls", "global", "Status"), "$svc.Status member access")

// --- phantom-free ----------------------------------------------------------------
check("no global marker symbol", !syms(module_).some((s: any) => s.name === "global"))
check("no script-block symbols", !syms(module_).some((s: any) => s.name?.startsWith("scriptblock")))
check("no self-contains", !rels(module_).some((r: any) => r.type === "contains" && r.source === r.target))

// --- negative --------------------------------------------------------------------
check("negative reports syntax error", (negative.errors?.length ?? 0) >= 1)
check("negative keeps valid symbol", byName(negative, "Name", "variable").length === 1)

// --- regex-free source ------------------------------------------------------------
const source = readFileSync("src/ast/real-powershell-analyzer.ts", "utf8")
const regexCtor = (source.match(/new\s+RegExp\s*\(/g) ?? []).length + (source.match(/[^\w.]RegExp\s*\(/g) ?? []).length
const regexMethodUses = (source.match(/\.(?:test|match|replace|exec|search|split|matchAll)\s*\(\s*\//g) ?? []).length
const hasRegexDelimiterUsage = /(?:^|[^\w])\/(?:[^\/\n]*)\/[dgimsuy]*(?:\.|\s*[);,])/m.test(source)
check("analyzer source has no regex literals", regexCtor === 0 && regexMethodUses === 0 && !hasRegexDelimiterUsage, `ctor=${regexCtor} methodUses=${regexMethodUses}`)

const passed = checks.filter((c) => c.pass).length
const result = { analyzer: "powershell", checks, passed: passed === checks.length, total: checks.length }
writeFileSync("validation/m12/results/powershell-contract.json", JSON.stringify(result, null, 2) + "\n")
console.log(`powershell contract: ${passed}/${checks.length}`)
for (const c of checks) {
  if (!c.pass) console.log(`  FAIL ${c.name}${c.detail ? ` :: ${c.detail}` : ""}`)
}
if (!result.passed) process.exitCode = 1
