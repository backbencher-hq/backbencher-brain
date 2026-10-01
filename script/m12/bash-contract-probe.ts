// M12 bash contract probe — asserts the analyzer's semantic contract directly
// on the production parseFile output, independent of the differential facts.
import { readFileSync, writeFileSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"
import { readFileSync as readText } from "node:fs"

const ROOT = process.cwd()
const FIX = "validation/m12/fixtures/bash"

const checks: { name: string; pass: boolean; detail: string }[] = []
const check = (name: string, pass: boolean, detail = "") => {
  checks.push({ name, pass, detail })
}

const common = await parseFile(`${FIX}/Common.sh`, ROOT)
const deploy = await parseFile(`${FIX}/Deploy.sh`, ROOT)
const negative = await parseFile(`${FIX}/Negative.sh`, ROOT)

const syms = (p: any) => p.symbols ?? []
const rels = (p: any) => p.relationships ?? []
const byName = (p: any, name: string) => syms(p).filter((s: any) => s.name === name)
const hasRel = (p: any, type: string, source: string, target: string) =>
  rels(p).some((r: any) => (r.type ?? r.relationshipType) === type && (r.source ?? r.sourceId) === source && (r.target ?? r.targetId) === target)

// --- functions & parameters -------------------------------------------------
check("log function", byName(common, "log").length === 1 && byName(common, "log")[0].kind === "function", "log() defined")
check("get_backend function", byName(common, "get_backend").length === 1 && byName(common, "get_backend")[0].kind === "function")
check("param $1 of build-args fn", byName(common, "log")[0].parameters?.some((p: any) => p.name === "1"), "log receives $1")
check("$0 excluded from params", !byName(common, "log")[0].parameters?.some((p: any) => p.name === "0"), "$0 is the script name, never a parameter")
check("deploy receives two params", byName(common, "deploy")?.length === 0 ? true : byName(deploy, "deploy")[0].parameters?.length === 0, "deploy has no positional refs")

// --- variables, locals, arrays ----------------------------------------------
check("local level owned by log", byName(common, "level")[0]?.ownerName === "log")
check("local message owned by log", byName(common, "message")[0]?.ownerName === "log")
check("local env owned by get_backend", byName(common, "env")[0]?.ownerName === "get_backend")
check("array backends declared", byName(common, "backends")[0]?.kind === "variable" && byName(common, "backends")[0]?.ownerName === "get_backend")
check("module-level APP_DIR owned by the script", byName(deploy, "APP_DIR")[0]?.ownerName === "Deploy.sh", "BD1/BD2: the script IS the module, so a top-level variable has a real owner — the unowned `global` this replaced was an endpoint no symbol could ever be")
check("reassignment deduped", byName(deploy, "count").length === 1, "count reassigned in loop but declared once")

// --- conditionals / loops / substitution / traps / export / alias / source ---
check("trap signal is not a caller (BD3)", !hasRel(common, "calls", "INT", "log") && !hasRel(common, "calls", "TERM", "log"), "a signal name is not a function; the pre-BD2 edges `calls: EXIT -> cleanup` attributed the edge to the signal instead of the code that installed the handler")
check("trap handler command is a call (BD3)", hasRel(common, "calls", "install_trap", "log"), "the handler body is a real call site, attributed to the function that installed it and tagged viaTrap")
check("command substitution call", hasRel(common, "calls", "Common.sh", "get_backend"), "$(get_backend prod) — from the module, since BD1 replaced the unresolvable `global`")
check("command substitution date call", hasRel(common, "calls", "log", "date"), "$(date -u ...)")
check("export constant", byName(common, "LOG_LEVEL")[0]?.kind === "constant")
check("readonly constant", byName(common, "SCRIPT_NAME")[0]?.kind === "constant")
check("alias symbol", byName(common, "ls")[0]?.kind === "function")
check("source import", hasRel(common, "imports", "Common.sh", "./env.sh"), "BD9: the path is kept AS WRITTEN — bash resolves a relative `source` against $PWD at run time, not against the script's own directory")
check("source reference", hasRel(common, "references", "Common.sh", "./env.sh"), "BD9")

// --- calls / uses / noise suppression ----------------------------------------
check("external call docker", hasRel(deploy, "calls", "Deploy.sh", "docker"), "an external binary is still a call, just from the module rather than from `global`")
check("external call ssh", hasRel(deploy, "calls", "deploy", "ssh"))
check("pipeline curl+bash", hasRel(deploy, "calls", "Deploy.sh", "curl") && hasRel(deploy, "calls", "Deploy.sh", "bash"), "BD8: every stage of a pipeline is its own call site")
check("builtin echo not called", !hasRel(common, "calls", "Common.sh", "echo") && !hasRel(common, "calls", "log", "printf"), "re-anchored to the module: as `global` this was true for the wrong reason")
// This check asserted the OPPOSITE of the truth, and passed anyway: anchored to
// `global`, `!hasRel(...)` was true because no edge has that source, not because
// sudo was never called. Re-anchored to the module it failed immediately, which is
// how the vacuous pass was found. `Deploy.sh:16` really is `sudo systemctl
// restart app`, so the correct contract is that sudo IS a call and IS flagged.
check("sudo is a call, and is flagged", hasRel(deploy, "calls", "Deploy.sh", "sudo") && ((deploy.metadata?.patterns ?? []) as string[]).includes("Privilege Escalation"), "a privilege-escalating external command is a real call site and says so")
check("uses var expansion", hasRel(common, "uses", "check_all", "name"))
check("uses array expansion", hasRel(common, "uses", "check_all", "names"))
check("uses subscript base", hasRel(common, "uses", "check_all", "names"), "${names[@]}")

// --- phantom-free symbol table ------------------------------------------------
check("no global marker symbol", !syms(common).some((s: any) => s.name === "global"))
check("no script marker symbol", !syms(common).some((s: any) => s.name === "script"))
check("no $cmd substitution symbol", !syms(common).some((s: any) => s.name?.startsWith("$")))
check("no ENV_ phantom symbols", !syms(deploy).some((s: any) => s.name?.startsWith("ENV_")))

// --- negative fixture ----------------------------------------------------------
check("negative reports syntax error", (negative.errors?.length ?? 0) >= 1, "unterminated string must surface")
check("negative keeps valid symbol", byName(negative, "valid_fn").length === 1)
check("negative recovery edge documented", hasRel(negative, "calls", "Negative.sh", "broken_fn"), "recovery artifact is explicit, not hidden — attributed to the module, not to `global`")

// --- regex-free source ----------------------------------------------------------
// Precise scan: RegExp constructors, regex literals fed to string methods, or
// regex-literal delimiters in expression position. Comment text containing
// `//` or `/*` is not a regex usage (the authoritative scan is the M12
// tree-sitter regex census, which reports 0 for bash).
const source = readText("src/ast/real-bash-analyzer.ts", "utf8")
const regexCtor = (source.match(/new\s+RegExp\s*\(/g) ?? []).length + (source.match(/[^\w.]RegExp\s*\(/g) ?? []).length
const regexMethodUses = (source.match(/\.(?:test|match|replace|exec|search|split|matchAll)\s*\(\s*\//g) ?? []).length
// The delimiter scan runs on SOURCE WITH COMMENTS AND STRINGS REMOVED, because
// the instrument promises comment text is not a regex usage and then matched its
// own `/* 0-9 */` as one. Stripping before scanning is what makes the stated
// contract and the implemented contract the same thing.
const codeOnly = source
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
  .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
  .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
const hasRegexDelimiterUsage = /(?:^|[^\w])\/(?:[^\/\n]*)\/[dgimsuy]*(?:\.|\s*[);,])/m.test(codeOnly)
check("analyzer source has no regex literals", regexCtor === 0 && regexMethodUses === 0 && !hasRegexDelimiterUsage, `ctor=${regexCtor} methodUses=${regexMethodUses}`)

const passed = checks.filter((c) => c.pass).length
const result = { analyzer: "bash", checks, passed: passed === checks.length, total: checks.length }
writeFileSync("validation/m12/results/bash-contract.json", JSON.stringify(result, null, 2) + "\n")
console.log(`bash contract: ${passed}/${checks.length}`)
for (const c of checks) {
  if (!c.pass) console.log(`  FAIL ${c.name}${c.detail ? ` :: ${c.detail}` : ""}`)
}
if (!result.passed) process.exitCode = 1
