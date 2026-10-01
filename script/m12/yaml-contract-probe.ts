// M12.36 — the yaml per-analyzer CONTRACT probe.
//
// WHY THIS FILE EXISTS. `docs/analyzers/real-yaml-analyzer.md` has cited
// `validation/m12/results/yaml-contract.json` — "19/19 checks" — since the lane
// shipped, and NO SCRIPT PRODUCED IT. `script/m12/` contained no `yaml-*` file at
// all, so the claim was unreproducible: a reader could not re-derive the number, and
// nothing failed if it stopped being true. An evidence file with no producer is an
// assertion wearing a JSON extension. This is the producer, and it reads the analyzer
// through the PRODUCTION entry (`ASTEngine.parseFile`) rather than by calling
// `analyze()` directly, so the contract is stated about the path a consumer takes.
//
// The checks are the M12 symbol/relationship contract for a data language: identity,
// kind, owner, range, the relationship ontology including the classes the lane newly
// emits, the payload fields with live store bindings, and the honesty fields (line
// carriage, evidence tiers, reason codes, declared limitations).
//
// Usage: bun run script/m12/yaml-contract-probe.ts
import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"

const ROOT = process.cwd()
const OUT = path.join(ROOT, "validation/m12/results/yaml-contract.json")
const FIXTURES = path.join(ROOT, "validation/m14/fixtures/yaml")

const checks: { name: string; passed: boolean; detail?: string }[] = []
const check = (name: string, passed: boolean, detail?: string) => checks.push({ name, passed, detail })

async function read(file: string) {
  const full = path.join(FIXTURES, file)
  return ASTEngine.parseFile(full, readFileSync(full, "utf8"))
}

const doc = await read("tag-declared-type.yaml")
const symbols = doc.symbols as any[]
const relationships = (doc.relationships ?? []).map((r: any) => ({ ...r, type: r.type ?? r.relationshipType }))
const meta = doc.metadata as any

// ---------------------------------------------------------------- identity
const tagged = symbols.find((s) => s.name === "tagged")
check("a mapping key becomes a symbol", symbols.length >= 5, `${symbols.length} symbols`)
check("identity is the qualified path", tagged?.qualifiedName === "tag-declared-type.tagged", String(tagged?.qualifiedName))
check("owner is the containing mapping", tagged?.ownerName === "tag-declared-type", String(tagged?.ownerName))
check("owner kind is recorded", tagged?.ownerKind === "module", String(tagged?.ownerKind))
check("range is 1-based and non-degenerate",
  tagged?.range?.startLine === 4 && tagged?.range?.endLine >= 4 && tagged?.range?.startIndex < tagged?.range?.endIndex,
  JSON.stringify(tagged?.range))

// ---------------------------------------------------------------- kinds
const plain = symbols.find((s) => s.name === "plain")
check("scalar-valued key is a property", plain?.kind === "property", String(plain?.kind))
check("a tag overrides the value's resolved type", tagged?.metadata?.valueType === "string" && plain?.metadata?.valueType === "integer",
  `tagged=${tagged?.metadata?.valueType} plain=${plain?.metadata?.valueType}`)
check("the override is attributed to the tag", tagged?.metadata?.valueTypeSource === "tag", String(tagged?.metadata?.valueTypeSource))
check("the resolved type is a closed vocabulary member", plain?.metadata?.valueTypeSource === "grammar", String(plain?.metadata?.valueTypeSource))

// --------------------------------------------------------- relationships
check("document contains its top-level keys",
  relationships.some((r) => r.type === "contains" && r.source === "tag-declared-type" && r.target === "tag-declared-type.tagged"))
check("a tag produces a declared_type reference",
  relationships.some((r) => r.type === "references" && r.source === "tag-declared-type.tagged" && r.target === "str" && r.metadata?.relationshipType === "declared_type"))

// ------------------------------------------------------------- honesty
check("every relationship carries a 1-based line",
  relationships.length > 0 && relationships.every((r) => typeof r.line_number === "number" && r.line_number >= 1),
  `${relationships.filter((r) => typeof r.line_number === "number" && r.line_number >= 1).length}/${relationships.length}`)
check("every relationship carries an evidence tier",
  relationships.every((r) => ["structural", "usage_contextual", "import_based", "reference_qualified", "inferred"].includes(r.metadata?.evidenceClass)),
  JSON.stringify([...new Set(relationships.map((r) => r.metadata?.evidenceClass))]))
check("no symbol metadata carries the placeholder `unknown`",
  symbols.every((s) => !Object.values(s.metadata ?? {}).some((v) => String(v) === "unknown")))

// ------------------------------------------- the classes the lane added
const include = await read("tag-file-include.yaml")
const includeRels = (include.relationships ?? []).map((r: any) => ({ ...r, type: r.type ?? r.relationshipType }))
check("an include tag produces an import", (include.imports ?? []).some((i: any) => i.module === "other.yml"),
  JSON.stringify((include.imports ?? []).map((i: any) => i.module)))
check("the import is marked external", (include.imports ?? []).some((i: any) => i.module === "other.yml" && i.isExternal === true))
check("an import is an import_based edge",
  includeRels.some((r) => r.type === "imports" && r.metadata?.evidenceClass === "import_based"))

const pointer = await read("json-pointer-resolve.yaml")
const pointerRels = (pointer.relationships ?? []).map((r: any) => ({ ...r, type: r.type ?? r.relationshipType }))
check("a resolvable $ref names the symbol it points at",
  pointerRels.some((r) => r.type === "references" && r.target === "json-pointer-resolve.definitions.Thing" && r.metadata?.resolved === true))
check("an unresolvable $ref says so, with a reason and a sub-1.0 confidence",
  pointerRels.some((r) => r.type === "references" && r.metadata?.resolved === false && r.confidence < 1 && typeof r.metadata?.confidenceReason === "string"))

const anchors = await read("anchor-document-scope.yaml")
const anchorRels = (anchors.relationships ?? []).map((r: any) => ({ ...r, type: r.type ?? r.relationshipType }))
check("a cross-document alias is NOT resolved, and says why",
  anchorRels.some((r) => r.type === "extends" && r.metadata?.resolved === false && r.metadata?.unresolvedReason === "anchor-defined-in-another-document"))

const framework = await read("framework-shape.yaml")
check("the R8 framework contract keys are all present",
  "framework" in (framework.metadata as any) && Array.isArray((framework.metadata as any).detectedFrameworks) &&
  Array.isArray((framework.metadata as any).frameworkPatterns) && (framework.metadata as any).hasFrameworkIntelligence === true,
  JSON.stringify({ framework: (framework.metadata as any).framework, detected: (framework.metadata as any).detectedFrameworks }))

const negative = await read("framework-shape-negative.yaml")
check("a file with the right key NAMES at the wrong depth claims nothing",
  ((negative.metadata as any).detectedFrameworks ?? []).length === 0,
  JSON.stringify((negative.metadata as any).detectedFrameworks))

// ---------------------------------------------------------------- payloads
const complexity = await read("payload-complexity.yaml")
const wide = (complexity.symbols as any[]).find((s) => s.name === "wide")
const leaf = (complexity.symbols as any[]).find((s) => s.name === "leaf")
check("every symbol carries a per-symbol complexity", (complexity.symbols as any[]).every((s) => typeof s.complexity === "number"))
check("a wide node scores above a leaf", wide?.complexity === 4 && leaf?.complexity === 1, `wide=${wide?.complexity} leaf=${leaf?.complexity}`)

const comments = await read("comment-attribution.yaml")
const port = (comments.symbols as any[]).find((s) => s.name === "port" && s.ownerName === "comment-attribution")
check("a comment becomes the key's docstring", typeof port?.docstring === "string" && port.docstring.includes("the port to bind"), JSON.stringify(port?.docstring))

const openapi = await read("openapi-contract.yaml")
const get = (openapi.symbols as any[]).find((s) => s.name === "get" && s.ownerName === "openapi-contract.paths./tasks")
check("an OpenAPI operation carries an apiContractPath", get?.apiContractPath === "GET /tasks", String(get?.apiContractPath))
check("a YAML key that is not a contract carries none",
  (openapi.symbols as any[]).find((s) => s.name === "swagger")?.apiContractPath === undefined)

const pass = checks.every((c) => c.passed)
writeFileSync(OUT, JSON.stringify({
  analyzer: "yaml",
  issue: "#175",
  at: new Date().toISOString(),
  entry: "ASTEngine.parseFile (the production entry, not analyze() directly)",
  fixtures: "validation/m14/fixtures/yaml (25 fixtures; this probe reads 9 of them)",
  checks,
  passed: pass,
  count: checks.length,
  passedCount: checks.filter((c) => c.passed).length,
  note: "This file previously existed with no producer in the tree — script/m12/ had no yaml-* script, so the doc's '19/19' was unreproducible. Re-runnable: bun run script/m12/yaml-contract-probe.ts",
}, null, 1))

console.log(`${checks.filter((c) => c.passed).length}/${checks.length} contract checks passed`)
for (const c of checks) if (!c.passed) console.log(`  FAIL ${c.name}${c.detail ? ` — ${c.detail}` : ""}`)
console.log(`wrote ${OUT}`)
process.exit(pass ? 0 : 1)
