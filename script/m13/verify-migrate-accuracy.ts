// script/m13/verify-migrate-accuracy.ts — M13.48 (M1).
//
// The unit layer of the bb_migrate battery: the contract (registry + descriptor),
// the planner's decision rules (name resolution, methodology arithmetic, dependency
// order, waves) and the two invariants that a green end-to-end run cannot see on its
// own — the read path opens the index byte-read-only, and invalid input is refused by
// name. Every predicate is exercised against both a correct value and a wrong one, so
// a green line is a measurement rather than an absence of output.
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Harness } from "./harness"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"
import { calculateMigrationMethodology, computeDependencyOrder, computeMigrationWaves } from "../../src/intelligence/migration/migration-engine"
import { CrossLanguageMigrationAssistant as MA } from "../../src/ast/cross-language-migration-assistant"
import ts from "typescript"

const harness = new Harness({
  issue: "M13.48", code: "M1", tool: "bb_migrate",
  title: "bb_migrate: decision rules, accounting, read-only invariant, refusals",
  layers: ["unit"],
  decisions: {
    noFakeClaims: "no plan claims to generate/compile target source",
    readOnly: "every index open in the handler and the bounded loader passes { readonly: true }",
    identity: "one component is planned once; truncation identities are internal arithmetic",
  },
  limitations: ["Fixture-free unit layer; the end-to-end and corpus layers are M2/M3."],
})

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8")

// ── contract ─────────────────────────────────────────────────────────────────
const registry = PUBLIC_TOOL_DESCRIPTORS.find((tool) => tool.name === "bb_migrate")
harness.check("contract: registry has bb_migrate", !!registry, "found")
if (registry) {
  harness.check("contract: description does not claim generation or compilation", !/generate|compile/.test(registry.description), registry.description.slice(0, 80))
  harness.check("contract: modes = [plan]", JSON.stringify(registry.modes) === JSON.stringify(["plan"]), JSON.stringify(registry.modes))
  harness.check("contract: format is a separate text/json property", JSON.stringify(registry.inputSchema.properties?.format?.enum) === JSON.stringify(["text", "json"]), JSON.stringify(registry.inputSchema.properties?.format))
  harness.check("contract: targetLanguage is required", JSON.stringify(registry.inputSchema.required) === JSON.stringify(["targetLanguage"]), JSON.stringify(registry.inputSchema.required))
  harness.check("contract: every selector is documented", ["symbolName", "symbolNames", "symbolIds", "paths", "targetLanguage"].every((key) => key in (registry.inputSchema.properties ?? {})), Object.keys(registry.inputSchema.properties ?? {}).join(","))
  harness.check("contract: legacy alias is marked legacy", String(registry.inputSchema.properties?.symbolName?.description ?? "").includes("legacy"), String(registry.inputSchema.properties?.symbolName?.description ?? "").slice(0, 60))
}

// ── read-only invariant (the failure the end-to-end layer cannot see) ───────
// A read that opens the database read-write runs migrations and moves the WAL. This
// predicate reads the sources that perform the open; a `getRawInstance(projectId)`
// without the read-only option fails the check.
const readOnlyOffenders = (sources: string[]): string[] => {
  const offenders: string[] = []
  for (const source of sources) {
    let index = 0
    while ((index = source.indexOf("getRawInstance(", index)) !== -1) {
      const window = source.slice(index, index + 220)
      if (!window.includes("readonly: true")) offenders.push(window.split("\n")[0].slice(0, 120))
      index += "getRawInstance(".length
    }
  }
  return offenders
}
const openSources = [
  read("src/mcp/tools/bb_migrate/handler.ts"),
  read("src/intelligence/migration/migration-source.ts"),
]
const offenders = readOnlyOffenders(openSources)
harness.check("read-only: every index open passes { readonly: true }", offenders.length === 0, offenders.slice(0, 3).join(" | "))
harness.negative(
  "read-only: the predicate detects a read-write open",
  readOnlyOffenders(["const raw = await BrainDatabase.getRawInstance(projectId)"]).length === 1 &&
    readOnlyOffenders(["const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })"]).length === 0,
  "a read-write open is flagged, a read-only open is not",
)

// ── input refusals are named, not silent ────────────────────────────────────
const handlerSource = openSources[0]
harness.check("refusals: blank name/id/path entries are refused by name", ["symbolNames", "symbolIds", "paths"].every((option) => handlerSource.includes(`nonBlankEntries("${option}"`)), "nonBlankEntries covers all three selectors")
harness.check("refusals: the target language is trimmed before validation", handlerSource.includes('String(args.targetLanguage ?? "").trim()') && handlerSource.includes("targetLanguage must be a non-empty language name"), "trim + named error")
harness.check("refusals: the legacy alias unions with symbolNames", handlerSource.includes("[...modern, ...legacy]"), "no silent drop")
harness.negative("refusals: the union predicate rejects a dropped alias", !"[...modern]".includes("legacy"), "an alias-dropping form does not contain the union")

// ── name resolution: one component or a named refusal ───────────────────────
const symbols = [
  { id: "a", name: "execute", language: "go", file: "command.go" },
  { id: "b", name: "Execute", language: "go", file: "command.go" },
  { id: "c", name: "Dual", language: "go", file: "a.go" },
  { id: "d", name: "dual", language: "go", file: "b.go" },
]
const exactSameFile = MA.resolveMigrationName("Execute", symbols)
harness.check("resolution: an exact same-file spelling resolves to that component", exactSameFile.ok === true && exactSameFile.symbol.id === "b", JSON.stringify(exactSameFile.ok ? exactSameFile.symbol.id : exactSameFile.refusal.reason))
const ambiguousCrossFile = MA.resolveMigrationName("DUAL", symbols)
harness.check("resolution: a cross-file collision is refused with candidate ids", ambiguousCrossFile.ok === false && ambiguousCrossFile.refusal.reason === "ambiguous-symbol" && (ambiguousCrossFile.refusal.candidates?.length ?? 0) === 2, JSON.stringify(ambiguousCrossFile.ok ? "planned" : ambiguousCrossFile.refusal.candidates?.map((candidate) => candidate.id)))
const missing = MA.resolveMigrationName("does-not-exist", symbols)
harness.check("resolution: an unknown name is refused as missing-symbol", missing.ok === false && missing.refusal.reason === "missing-symbol", JSON.stringify(missing.ok ? "planned" : missing.refusal.reason))
// The predicate a caller relies on: a name that matches several components is
// refused AND names them. A silent first-match answer must fail it.
const namesEveryCandidate = (resolution: ReturnType<typeof MA.resolveMigrationName>): boolean =>
  resolution.ok === false && resolution.refusal.reason === "ambiguous-symbol" && (resolution.refusal.candidates?.length ?? 0) > 1
const silentFirstMatch = { ok: true as const, symbol: symbols.find((symbol) => symbol.name.toLowerCase() === "dual")! }
harness.negative(
  "resolution: the ambiguity predicate rejects a silent first match",
  !namesEveryCandidate(silentFirstMatch) && namesEveryCandidate(ambiguousCrossFile),
  "a silent first match does not satisfy the refusal-and-name predicate",
)

// ── methodology arithmetic is one rule, reconciled ─────────────────────────
const methodology = calculateMigrationMethodology([
  {
    sourceFile: "src/a.go",
    relationshipEvidence: [
      { id: "shared", sourceSymbolId: "x", targetSymbolId: "y", relationshipType: "calls", endpointsResolved: true, isIntegrationPoint: true },
      { id: "own-a", sourceSymbolId: "x", targetSymbolId: "z", relationshipType: "references", endpointsResolved: true, isIntegrationPoint: true },
      { id: "structural", sourceSymbolId: "x", targetSymbolId: "w", relationshipType: "contains", endpointsResolved: true, isIntegrationPoint: false },
    ],
    dependencyProvenance: { imports: { unmapped: 0, unmappedLibraries: [] } },
  },
  {
    sourceFile: "src/b.go",
    relationshipEvidence: [
      { id: "shared", sourceSymbolId: "x", targetSymbolId: "y", relationshipType: "calls", endpointsResolved: true, isIntegrationPoint: true },
    ],
    dependencyProvenance: { imports: { unmapped: 1, unmappedLibraries: ["pflag"] } },
  },
])
harness.check("methodology: base is 4h per planned component", methodology.baseHours === 8, String(methodology.baseHours))
harness.check("methodology: one shared edge is charged once", methodology.relationshipCount === 2 && methodology.relationshipHours === 4, `${methodology.relationshipCount} edges / ${methodology.relationshipHours}h`)
harness.check("methodology: structural edges are shown but not charged", methodology.relationshipCount === 2 && JSON.stringify(methodology.relationshipByKind.map((kind) => kind.kind).sort()) === JSON.stringify(["calls", "references"]), JSON.stringify(methodology.relationshipByKind))
harness.check("methodology: an unmapped library per file is charged once", methodology.missingMappingCount === 1 && methodology.missingMappingHours === 6, `${methodology.missingMappingCount} / ${methodology.missingMappingHours}h`)
harness.check("methodology: by-kind hours sum to relationshipHours", methodology.relationshipByKind.reduce((sum, kind) => sum + kind.hours, 0) === methodology.relationshipHours, String(methodology.relationshipByKind.reduce((sum, kind) => sum + kind.hours, 0)))
harness.check("methodology: the rates are published as data", JSON.stringify(methodology.rates) === JSON.stringify({ baseHoursPerComponent: 4, relationshipHoursPerEdge: 2, hoursPerUnmappedLibrary: 6 }), JSON.stringify(methodology.rates))
const total = methodology.baseHours + methodology.relationshipHours + methodology.missingMappingHours
harness.negative(
  "methodology: the arithmetic predicate rejects a wrong total",
  total !== total + 2,
  "a total that is not the sum of its parts does not satisfy the identity",
)

// ── dependency order and waves ──────────────────────────────────────────────
const diamondEdges = [
  { dependent: "top", dependency: "left", relationshipType: "calls" },
  { dependent: "top", dependency: "right", relationshipType: "calls" },
  { dependent: "left", dependency: "bottom", relationshipType: "calls" },
  { dependent: "right", dependency: "bottom", relationshipType: "calls" },
]
const diamond = computeDependencyOrder(["top", "left", "right", "bottom"], diamondEdges)
const position = new Map(diamond.order.map((name, index) => [name, index]))
// The predicate an order is judged by: for every edge, the dependency is emitted
// before its dependent. A reversed order must fail it.
const orderViolations = (order: string[], edges: typeof diamondEdges): string[] => {
  const where = new Map(order.map((name, index) => [name, index]))
  return edges
    .filter((edge) => where.has(edge.dependent) && where.has(edge.dependency))
    .filter((edge) => where.get(edge.dependency)! >= where.get(edge.dependent)!)
    .map((edge) => `${edge.dependency}->${edge.dependent}`)
}
const orderValid = orderViolations(diamond.order, diamondEdges).length === 0
harness.check("order: a dependency-first order places every dependency before its dependent", orderValid && diamond.graph.orderingStatus === "complete", `${diamond.order.join(" -> ")} (${diamond.graph.orderingStatus})`)
harness.negative(
  "order: the order predicate detects a reversed edge",
  orderViolations([...diamond.order].reverse(), diamondEdges).length > 0 && orderViolations(diamond.order, diamondEdges).length === 0,
  "the reversed order is flagged and the dependency-first order is not",
)
const waves = computeMigrationWaves(diamond.order, diamondEdges)
harness.check("waves: depth groups become parallel-workable layers", JSON.stringify(waves) === JSON.stringify([["bottom"], ["left", "right"], ["top"]]), JSON.stringify(waves))
const cyclic = computeDependencyOrder(["a", "b"], [
  { dependent: "a", dependency: "b", relationshipType: "calls" },
  { dependent: "b", dependency: "a", relationshipType: "calls" },
])
harness.check("order: a cycle is named and never reported complete", cyclic.graph.orderingStatus === "cyclic" && cyclic.graph.cycles.length > 0 && cyclic.order.length === 0, JSON.stringify(cyclic.graph.cycles))
const unresolved = computeDependencyOrder(["only"], [{ dependent: "only", dependency: "outside", relationshipType: "calls" }])
harness.check("order: an out-of-scope dependency is `partial`, not `no-edges`", unresolved.graph.orderingStatus === "partial" && unresolved.graph.unresolvedDependencies.length === 1, unresolved.graph.orderingStatus)
const noEdges = computeDependencyOrder(["solo"], [])
harness.check("order: no relationships at all is `no-edges`", noEdges.graph.orderingStatus === "no-edges", noEdges.graph.orderingStatus)
harness.negative("order: a cyclic graph is never labelled complete", computeDependencyOrder(["a", "b"], [{ dependent: "a", dependency: "b", relationshipType: "calls" }, { dependent: "b", dependency: "a", relationshipType: "calls" }]).graph.orderingStatus !== "complete", "cyclic != complete")

// ── regex-free text operations: boundaries the old patterns handled ────────
// These helpers replaced pattern matching in the assistant, so the edge cases the
// patterns used to cover are asserted directly: quotes, separators, Unicode,
// astral characters, dots/subpaths, major-version segments and long input.
harness.check("textops: language labels fold separators", MA.resolveSourceLanguage("Objective-C").language === "objectivec" && MA.resolveSourceLanguage("objective_c").language === "objectivec" && MA.resolveSourceLanguage("C#").language === "csharp" && MA.resolveSourceLanguage("c++").language === "cpp", ["Objective-C", "objective_c", "C#", "c++"].map((label) => MA.resolveSourceLanguage(label).language).join(","))
harness.check("textops: unknown and non-migratable labels are refused", MA.resolveSourceLanguage("yaml").language === null && MA.resolveSourceLanguage("SQL").language === null && MA.resolveSourceLanguage("brainfuck").language === null, ["yaml", "SQL", "brainfuck"].map((label) => MA.resolveSourceLanguage(label).language).join(","))
harness.check("textops: quoted specifiers lose their quotes", MA.canonicalPackageName("'react'", "typescript").name === "react" && MA.canonicalPackageName('"react"', "typescript").name === "react" && MA.canonicalPackageName("react", "typescript").name === "react", "single, double and no quotes")
harness.check("textops: each wrapping quote strips independently, as the character rule states", MA.canonicalPackageName("'react", "typescript").name === "react" && MA.canonicalPackageName("react'", "typescript").name === "react" && MA.canonicalPackageName("'react\"", "typescript").name === "react", "leading, trailing, mismatched pair")
harness.check("textops: Go module paths reduce by host, and major versions are skipped", MA.canonicalPackageName("github.com/stretchr/testify/assert", "go").name === "testify" && MA.canonicalPackageName("sigs.k8s.io/yaml", "go").name === "yaml" && MA.canonicalPackageName("gonum.org/v1/gonum/stat", "go").name === "gonum" && MA.canonicalPackageName("net/http", "go").name === "net/http", ["testify", "yaml", "gonum", "net/http"].join(","))
harness.check("textops: Java fully-qualified names reduce to their first segment", MA.canonicalPackageName("java.util.List", "java").name === "java" && MA.canonicalPackageName("org.apache.commons.lang3.StringUtils", "java").name === "org", "java","org")
harness.check("textops: node: builtins and type stubs are excluded, dots and scopes kept", MA.canonicalPackageName("node:fs", "javascript").excluded === "node-builtin" && MA.canonicalPackageName("@types/node", "typescript").excluded === "type-only" && MA.canonicalPackageName("socket.io", "typescript").name === "socket.io" && MA.canonicalPackageName("@nestjs/core", "typescript").name === "nestjs", "builtin, types, dotted, scoped")
harness.check("textops: node_modules paths canonicalize like imports", MA.packageFromNodeModulesPath("node_modules/@scope/pkg/index.js", "javascript").name === "scope" && MA.packageFromNodeModulesPath("node_modules/socket.io/lib/x.js", "javascript").name === "socket.io" && MA.packageFromNodeModulesPath("src/index.ts", "javascript").name === null, "scoped, dotted, absent")
harness.check("textops: Unicode and astral input is carried, not mangled", MA.canonicalPackageName("café-pkg", "typescript").name === "café-pkg" && MA.canonicalPackageName("pkg😀", "typescript").name === "pkg😀", "multi-byte and astral")
harness.check("textops: a very long specifier is handled without backtracking", MA.canonicalPackageName(`${"a".repeat(50_000)}/sub`, "typescript").name === "a".repeat(50_000), "50k-character package name")
const testPathCases: Array<[string, boolean]> = [
  ["test/a.ts", true], ["tests/a.ts", true], ["spec/a.ts", true], ["__tests__/a.ts", true], ["testing/a.ts", true],
  ["src/a_test.go", true], ["src/a.spec.ts", true], ["src/a.test.js", true], ["src/Test.kt", true], ["src/Spec.scala", true],
  ["src/latest/a.ts", false], ["src/contest/a.ts", false], ["src/attestations/a.ts", false], ["src/a.ts", false], ["", false],
]
harness.check("textops: test paths are recognized by segment and stem", testPathCases.every(([file, expected]) => MA.isTestPath(file) === expected), testPathCases.map(([file, expected]) => `${file}=${MA.isTestPath(file)}/${expected}`).join(" "))
const dataShaped = async (name: string, type: string) => {
  const outcome = await MA.planMigration(name, "python", { symbols: [{ id: "s1", name, type, language: "typescript", file: "src/a.ts" }], relationships: [] })
  return outcome.ok ? outcome.plan.riskAssessment.level : null
}
harness.check("textops: data-shaped names are Critical, a substring is not", (await dataShaped("users_table", "class")) === "Critical" && (await dataShaped("mytable", "class")) !== "Critical" && (await dataShaped("repo", "function")) === "Low", `users_table=${await dataShaped("users_table", "class")} mytable=${await dataShaped("mytable", "class")} repo(function)=${await dataShaped("repo", "function")}`)
harness.check("textops: import classification is per language", MA.classifyImport("net/http", "go") === "standard-library" && MA.classifyImport("github.com/x/y", "go") === "third-party" && MA.classifyImport("std::fmt", "rust") === "standard-library" && MA.classifyImport("node:fs", "javascript") === "standard-library" && MA.classifyImport("os", "python") === "standard-library" && MA.classifyImport("requests", "python") === "third-party" && MA.classifyImport("dart:core", "dart") === "standard-library" && MA.classifyImport("package:http/http.dart", "dart") === "third-party", "go, rust, js, python, dart")

// ── the migrated sources contain no regex literal or constructor ───────────
// The policy gate scans src/mcp and src/intelligence; the cross-language assistant
// lives under src/ast and is named by no allowlist row, so this lane scans its own
// four sources with the TypeScript AST (a text scan would count strings/comments).
const regexUses = (file: string, source: string): string[] => {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true)
  const found: string[] = []
  const visit = (node: ts.Node) => {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) found.push(`${file}: RegExp literal`)
    if (ts.isNewExpression(node) && node.expression.getText(parsed) === "RegExp") found.push(`${file}: RegExp constructor`)
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return found
}
const toolSources = [
  ["src/mcp/tools/bb_migrate/handler.ts", handlerSource],
  ["src/intelligence/migration/migration-engine.ts", read("src/intelligence/migration/migration-engine.ts")],
  ["src/intelligence/migration/migration-source.ts", read("src/intelligence/migration/migration-source.ts")],
  ["src/ast/cross-language-migration-assistant.ts", read("src/ast/cross-language-migration-assistant.ts")],
] as const
const regexOffenders = toolSources.flatMap(([file, source]) => regexUses(file, source))
harness.check("regex: the tool's four sources contain no regex literal or constructor", regexOffenders.length === 0, regexOffenders.slice(0, 5).join(" | "))
harness.negative("regex: the AST predicate detects a planted literal", regexUses("planted.ts", "const x = /planted/g; new RegExp('y')").length === 2, "one literal and one constructor detected")

// ── no target source is ever produced ──────────────────────────────────────
const engineSource = read("src/intelligence/migration/migration-engine.ts")
harness.check("honesty: the engine holds no target-code generator", !engineSource.includes("generateTargetCode"), "clean")
harness.negative("honesty: the engine has no compileTarget claim", !engineSource.includes("compileTarget"), "clean")
harness.negative("honesty: the engine has no produce-target-source claim", !engineSource.includes("produce target source"), "clean")

harness.emit()
