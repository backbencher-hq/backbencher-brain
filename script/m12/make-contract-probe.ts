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
// A `define` is a MACRO, and a macro is callable, so it is a `function`. This
// check previously asserted `constant`, which made `$(call RUN_TESTS,...)`
// resolve to a value that cannot be called — a call edge pointing at a constant.
// Asserting the old kind is how that survived: the probe was never run for this
// lane, so a check that encoded the bug was indistinguishable from a passing one.
check("define/endef macro is a FUNCTION (a call target must be callable)", hasSym(build, "HELP", "function"))
check("define is NOT a constant (the pre-fix shape)", !hasSym(build, "HELP", "constant"))
check("rule target is a function", hasSym(build, "all", "function"))
// A target that is an EXPRESSION declares nothing: `$(BIN):` is the VALUE of
// BIN, and a `function` symbol literally named `$(BIN)` would be a buildable
// nobody can invoke. The expansion is published as a reference instead, and the
// check below stops the invented buildable coming back.
check("computed target declares no symbol", !hasSym(build, "$(BIN)", "function"))
check("computed target publishes a reference to the variable", rels(build).some((r: any) => (r.target ?? "") === "BIN" && (r.type ?? "") === "references"))
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
// A prerequisite that is a FILE resolves to nothing in the index, so it is a
// `uses` edge and says so. Publishing it as a project-internal reference would
// assert a declaration named `src/main.c` that no line creates.
check("target depends on prereq (a FILE -> uses, labelled)", rels(build).some((r: any) => r.type === "uses" && r.source === "main.o" && r.target === "src/main.c" && (r.metadata as any)?.evidenceClass === "external_prerequisite"))
check("file prereq is NOT a references edge", !rels(build).some((r: any) => (r.type ?? "") === "references" && (r.target ?? "") === "src/main.c"))
// The order-only group. Its SOURCE is the module rather than `$(BIN)`, because
// `$(BIN)` is an expression and declares no target; the dependency itself is
// still recorded, which is the part that carries information.
// `$(BIN): $(OBJS) | builddir` — the rule's target is an EXPRESSION, so it
// declares no literal name and the old code (which iterated the empty list of
// literal targets) published NO prerequisite edge for the whole rule. The edge is
// now recorded against the module. Its LABEL is `references`, not `uses`,
// because `builddir` is a target this same file declares four lines later — the
// uses/references split decides that, and asserting `uses` here would have
// re-encoded the very conflation this lane removed.
check("order-only prereq edge recorded", rels(build).some((r: any) => (r.target ?? "") === "builddir" && ["uses", "references"].includes((r.type ?? ""))))
check("a computed-target rule still publishes its prereqs", rels(build).some((r: any) => (r.target ?? "") === "OBJS" && (r.line_number ?? 0) === 22))
check("the order-only prereq is labelled `references` (builddir is declared here)", rels(build).some((r: any) => (r.target ?? "") === "builddir" && (r.type ?? "") === "references"))
// A variable THIS FILE DECLARES is a `references` edge. The pre-split shape
// published every reference as `uses`, which demoted real declarations out of
// the reference graph; 1,566 corpus edges are `references` now.
check("recipe variable reference edge is `references` (CC is declared here)", hasRel(build, "references", "main.o", "CC"))
check("declared variable is NOT demoted to `uses`", !rels(build).some((r: any) => (r.type ?? "") === "uses" && (r.target ?? "") === "CC"))
check("variable value references another variable", hasRel(lib, "references", "LIB", "BUILD_DIR"))
check("$(call NAME,...) is a calls edge", hasRel(lib, "calls", "verify", "RUN_TESTS"))
// Includes are sourced at THIS FILE's module node. A constant `makefile` source
// meant every makefile that includes `config.mk` produced the same edge, so two
// files could not be told apart in the graph.
check("include directive imports config.mk", hasRel(build, "imports", "Build.mk", "config.mk"))
check("-include imports optional.mk", hasRel(build, "imports", "Build.mk", "optional.mk"))
check("sinclude imports local.mk", hasRel(build, "imports", "Build.mk", "local.mk"))
check("include edges are NOT sourced at a constant 'makefile'", !rels(build).some((r: any) => (r.type ?? "") === "imports" && (r.source ?? "") === "makefile"))

// ---- the product field: line_number on EVERY relationship ----
const noLine = rels(build).concat(rels(lib)).filter((r: any) => typeof (r as any).line_number !== "number")
check("every relationship carries line_number", noLine.length === 0, `${noLine.length} without it`)

// ---- evidence tiers: what makes the `uses` pool readable ----
const tiers = new Set<string>()
for (const r of rels(build).concat(rels(lib))) { const t = (r.metadata as any)?.evidenceClass; if (t) tiers.add(t) }
check("at least 3 distinct evidenceClass tiers are published", tiers.size >= 3, [...tiers].join(","))
check("an automatic variable is labelled `automatic`, not `builtin`", rels(build).some((r: any) => (r.target ?? "") === "$@" && (r.metadata as any)?.evidenceClass === "automatic"))

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
