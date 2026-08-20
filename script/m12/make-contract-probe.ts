import { readFileSync, writeFileSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"

const checks: { name: string; passed: boolean; detail?: string }[] = []
const check = (name: string, passed: boolean, detail?: string) => checks.push({ name, passed, detail })

const ROOT = process.cwd()

async function read(file: string) {
  const path = `validation/m12/fixtures/make/${file}`
  return parseFile(`${ROOT}/${path}`, ROOT)
}

const build = await read("Build.mk")
const lib = await read("Library.mk")
const neg = await read("Negative.mk")

const syms = (p: any) => p.symbols ?? []
const rels = (p: any) => p.relationships ?? []
const hasSym = (p: any, name: string, kind: string) => syms(p).some((s: any) => s.name === name && s.kind === kind)
const hasRel = (p: any, type: string, source: string, target: string) => rels(p).some((r: any) => (r.type ?? "") === type && (r.source ?? "") === source && (r.target ?? "") === target)

// ---- symbol kinds ----
check(":= assignment is a constant", hasSym(build, "CC", "constant"))
check("= assignment is a constant", hasSym(build, "CFLAGS", "constant"))
check("?= assignment is a constant", hasSym(build, "DEBUG", "constant"))
check("+= assignment is a constant", hasSym(build, "OBJS", "constant"))
check("!= shell assignment is a constant", hasSym(build, "VERSION", "constant"))
check("define/endef variable is a constant", hasSym(build, "HELP", "constant"))
check("rule target is a function", hasSym(build, "all", "function"))
check("variable-reference target is a function", hasSym(build, "$(BIN)", "function"))
check("order-only target is a function", hasSym(build, "builddir", "function"))
check("pattern-rule target is a function", hasSym(lib, "print-%", "function"))

// ---- grammar quirks ----
check("nested rule inside swallowed conditional (ifdef)", hasSym(build, "debug-build", "function"), "grammar nests the conditional in the previous recipe; walker descends")
check("nested rule inside else branch", hasSym(build, "release-build", "function"))
check("nested rule inside ifeq", hasSym(build, "gcc-ok", "function"))
check("nested rule inside ifeq else", hasSym(build, "clang-ok", "function"))

// ---- special targets excluded ----
check(".PHONY itself is not a symbol", !hasSym(build, ".PHONY", "function"))
check("no .PHONY dependency edges", !rels(build).some((r: any) => r.source === ".PHONY"))

// ---- relationships ----
check("target depends on prereq", hasRel(build, "uses", "main.o", "src/main.c"))
check("order-only prereq edge", hasRel(build, "uses", "$(BIN)", "builddir"))
check("recipe variable reference edge", hasRel(build, "uses", "main.o", "CC"))
check("variable value references another variable", hasRel(lib, "uses", "LIB", "BUILD_DIR"))
check("$(call NAME,...) is a calls edge", hasRel(lib, "calls", "verify", "RUN_TESTS"))
check("include directive imports config.mk", hasRel(build, "imports", "makefile", "config.mk"))
check("-include imports optional.mk", hasRel(build, "imports", "makefile", "optional.mk"))
check("sinclude imports local.mk", hasRel(build, "imports", "makefile", "local.mk"))

// ---- imports array ----
const imports = (build.imports ?? []).map((i: any) => i.name ?? i.module)
check("imports array has config.mk", imports.includes("config.mk"))
check("imports array has local.mk", imports.includes("local.mk"))
check("import lines preserved", (build.imports ?? []).some((i: any) => (i.line ?? i.range?.startLine ?? 0) === 59))

// ---- negative fixture: syntax errors are engine-owned, recovery recorded ----
const negErrors = neg.errors ?? []
check("Negative.mk reports the unclosed conditional error", negErrors.some((e: any) => (e.range?.startLine ?? e.line ?? 0) === 11))
check("Negative.mk reports the unterminated value error", negErrors.some((e: any) => (e.range?.startLine ?? e.line ?? 0) === 17))
check("grammar-recovered rule inside ERROR region is recorded", hasSym(neg, "broken_target", "function"))
check("orphan recipe line does not create a symbol", !syms(neg).some((s: any) => s.name === "echo"))

// ---- noise traps ----
check("automatic variables are not symbols", !syms(build).some((s: any) => s.name === "$@"))
check("builtin function wildcard is not a symbol", !syms(build).some((s: any) => s.name === "wildcard"))

// ---- regex-free source ----
const source = readFileSync("src/ast/real-makefile-analyzer.ts", "utf8")
const regexLines = source.split("\n").map((line, i) => ({ line, i: i + 1 })).filter(({ line }) => {
  const trimmed = line.trim()
  if (!trimmed.includes("/")) return false
  // match a literal /.../ regex (not comments, not division, not URLs)
  return /[=(\s,]\/(?:\\.|[^/\\\n])+\/[dgimsuy]*/.test(trimmed) && !trimmed.startsWith("//")
})
check("analyzer source has no regex literals", regexLines.length === 0, regexLines.map((r) => `line ${r.i}`).join(", "))

const result = { analyzer: "make", checks, passed: checks.every((c) => c.passed), total: checks.length, passedCount: checks.filter((c) => c.passed).length }
writeFileSync("validation/m12/results/make-contract.json", JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
