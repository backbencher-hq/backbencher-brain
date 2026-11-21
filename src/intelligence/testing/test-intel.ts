// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the static test-evidence engine: mapping of production symbols to test evidence, risk-ranked gaps, and direct/indirect test impact for one symbol.
// WHICH TOOL IT SERVES — bb_analyze (mutability read, requiresIndex true, modes
//   test_mapping, test_gaps, test_impact).
// WHY IT IS SHAPED THIS WAY — only relationship kinds the classifier can name count as evidence; populations and page bounds are published so the arithmetic closes in public; zero evidence is a declared unknown, never a confident zero.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_analyze.md, docs/BB_TEST_INTEL.md, validation/tools/bb_analyze/**;
//   gates: npx tsx script/m13/verify-analyze-modes.ts, npx tsx script/verify-analyze.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_analyze/handler.ts,
//   script/tool-docs/curation/bb_analyze.ts, and the gates named above.
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   the read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import { BrainDatabase } from "../../brain/database"
import { AnalysisExclusions } from "../../ast/analysis-exclusions"
import type { ProjectID } from "../../project/schema"
import type {
  TestEvidenceKind,
  TestGap,
  TestGapReport,
  TestImpactReport,
  TestIntelOptions,
  TestLink,
  TestMappingEntry,
  TestMappingReport,
} from "../contracts"
import { makeProvenance } from "../evidence"
// M57.T5 (#793): ONE non-code vocabulary, shared with the indexer's classifier
// (src/ast/test-classification.ts). The private copy this module used to own is
// exactly the drift the canonical definition exists to prevent.
import { NON_CODE_TEST_LANGUAGES } from "../../ast/test-classification"

const DIRECT_TYPES = new Set(["calls", "instantiates"])
const REFERENCE_TYPES = new Set(["references", "uses", "extends", "implements"])
const IMPORT_TYPES = new Set(["imports"])

/** The kinds the TEST-IMPACT walk is allowed to see: exactly the kinds
 *  `classify` can name, DERIVED from those same three sets rather than restated,
 *  so the walk and the classifier cannot drift apart.
 *
 *  WHY THE WALK NEEDS A KIND FILTER AT ALL. The graph engine's default covers
 *  every stored kind, and for a general question that is right (its own docs
 *  say so). For this question it published a claim nobody made: `testImpact`
 *  reads the caller set, keeps the rows that come from test files, and calls a
 *  depth-0 row a DIRECT test — without asking what kind of row it was. So a test
 *  class that CONTAINS the symbol under test answered as a test that depends on
 *  it, and `testSuggestions` labelled that `direct_call` at 0.85 confidence.
 *  `contains` is the one kind that INVERTS the relation: it runs parent → member,
 *  so an inbound `contains` row says the target is a member of the source — the
 *  opposite of "the source depends on the target". It is excluded here along
 *  with every other kind `classify` cannot name (`exports`); `uses` and
 *  `references` are KEPT, because a test that reads a symbol's constant or
 *  references its type does depend on it, at the lower tiers the classifier
 *  already declares. */
export const TEST_IMPACT_KINDS: readonly string[] = [
  ...DIRECT_TYPES,
  ...REFERENCE_TYPES,
  ...IMPORT_TYPES,
]

/** The confidence each evidence tier carries. Exported because the tier is the
 *  fact and this is its declared weight: a second copy in a consumer is how the
 *  two drift, and one consumer (testSuggestions) was choosing its tier from
 *  `depth` alone — the defect TEST_IMPACT_KINDS closes on the walk side. */
export const EVIDENCE_CONFIDENCE: Record<TestEvidenceKind, number> = {
  direct_call: 0.85,
  reference: 0.6,
  import: 0.4,
}

const PROD_SYMBOL_TYPES = "('function','method','class','interface','struct','enum')"

// M50.A2 residual — what counts as a test SOURCE.
//
// The indexer's `is_test_file` flag matches directory segments (…/spec/…) with
// no regard for file type, so on a real repo data fixtures are flagged as
// tests: 30 files, every one of them JSON (script/m14/spec/*-completeness.json,
// validation/m14/results/M14.0.SPEC.json). Trusting the flag alone made this
// engine report a "30 test files / 5,196 test symbols" corpus that is entirely
// data, and made every production symbol look "untested" while the engine had
// classified zero call/reference/import edges (all 4,651 relationships from
// those files are `contains`).
//
// A test source must therefore be code. Non-code flagged files are excluded
// from the test corpus here, and the exclusion is DECLARED in provenance.unknowns
// so a smaller corpus is never silent.
// M57.T5 (#793): the indexer-side misclassification is now FIXED at the source
// (test-classification.ts gates the flag on file type). The non-code vocabulary
// below is no longer a private copy — it is imported from the ONE definition
// so the indexer and this engine can never drift apart again.


/** SQL fragment: exclude non-code languages from a test-corpus predicate. */
export function codeTestClause(alias: string): { sql: string; params: string[] } {
  const col = alias ? `${alias}.language` : "language"
  return {
    sql: ` AND LOWER(COALESCE(${col}, '')) NOT IN (${NON_CODE_TEST_LANGUAGES.map(() => "?").join(", ")})`,
    params: [...NON_CODE_TEST_LANGUAGES],
  }
}

/** Default page size for the test-intelligence reports.
 *
 *  Measured on backbencher-brain/src: test_mapping at the old default of 1000
 *  rendered 375,270 bytes (~104k tokens) in ONE tool call, because every entry
 *  carries a `links` array. A default is a promise about what a caller gets
 *  without asking; this one is a page a caller can read, and a caller who
 *  wants the whole corpus passes `limit`. */
const DEFAULT_PAGE = 50

/** Cap on the `links` array inside one mapping entry. A utility called by 400
 *  tests would otherwise render 400 rows for a single symbol, and what a caller
 *  wants from that entry — is it tested, and how strongly — is unchanged by the
 *  380 rows after the first few. Capped and DECLARED; the ranking and the
 *  summary still use the complete set. */
const DEFAULT_MAX_LINKS = 20







/** Human-readable provenance token for a corpus that produced no evidence. */
const NO_EVIDENCE_UNKNOWN =
  "no-test-evidence-edges: no calls/references/imports relationship originates from a code test file, so every production symbol is reported untested — this is an absence of evidence, not evidence of absence"

/** M57.T2: shared disclosure helper — a zero test corpus must say WHY it is zero. */
export function noEvidenceUnknown(): string {
  return NO_EVIDENCE_UNKNOWN
}

export function nonCodeUnknown(nonCodeTestFiles: number): string | null {
  return nonCodeTestFiles > 0
    ? `non-code-test-files-excluded: ${nonCodeTestFiles} is_test_file path(s) are data/config formats, not test sources, and were excluded from the test corpus`
    : null
}

// ── P1-3: TEST-LINK VALIDATION ─────────────────────────────────────────────
//
// A stored relationship row whose SOURCE lives in a test file is NOT test
// evidence by itself. The measured bettercap defect (ISSUE-05): the Go analyzer
// records a package-qualified call as its bare leaf (`errors.New` → `New`,
// `otto.New` → `New`) and the name resolver binds that leaf to the project-wide
// lowest-id symbol, so `caplets/caplet_test.go:142` "called" `session.New` at
// direct_call 0.85 although it only ever called `errors.New`/`NewCaplet`, and
// `js/data_test.go` functions "called" it via `otto.New()`. Before a row becomes
// a link it must now prove that the test can REACH the target:
//   * the row's own metadata must not say the callee is an external/stdlib leaf;
//   * a qualified call's qualifier must be an imported package naming the
//     target's package (a package-qualified spelling stored as a bare leaf is
//     not evidence for any same-named symbol);
//   * a receiver/member chain (`m.Lock`, `mod.Session.Lock`) is unresolved here —
//     the index carries no receiver type — so it fails closed instead of binding
//     a same-named method from another package;
//   * an unqualified callee must be in the caller's own package/module, or be
//     reachable through the test file's imports.
// Rejections are counted PER REASON and declared in provenance.unknowns, so a
// user sees why a candidate row was not published rather than a silent drop.
export type TestLinkRejection =
  | "external-stdlib-leaf"
  | "target-name-mismatch"
  | "qualified-call-target-is-a-leaf"
  | "receiver-selector-unresolved"
  | "cross-package-unreachable"

/** Receiver evidence proven from the TEST FILE's own declarations (index-time
 *  metadata does not carry Go types). `external` means the receiver's declared
 *  type is a non-project/stdlib package member: the call cannot be evidence for
 *  a project symbol. `project` means the receiver's declared type is an indexed
 *  project type; `ownerHasMethod` says that type declares the called method. */
export type ReceiverEvidence = {
  kind: "project" | "external"
  typeName: string
  ownerHasMethod?: boolean
}

export interface TestLinkValidationInput {
  relationshipType: string
  /** the stored target name (leaf) */
  targetExternal: string
  /** the resolved target symbol's name */
  targetName: string
  /** project-relative target file */
  targetFile: string
  /** project-relative test file (the edge's source symbol's file) */
  testFile: string
  /** brain_file.language of the test file */
  language: string | null
  /** brain_relationship.metadata (parsed) — carries callExpression/isStdlib */
  metadata: Record<string, unknown> | null
  /** brain_import import_path values for the test file */
  testImports: string[]
  /** Proven receiver evidence for selector calls (see inferReceiverEvidence). */
  receiver?: ReceiverEvidence
}

export type TestLinkValidation = { ok: true } | { ok: false; reason: TestLinkRejection }

/** Languages whose module boundary IS the directory: an unqualified callee can
 *  name a declaration in the caller's own directory, so same-directory is
 *  reachability evidence. File-scoped module languages (JS/TS/Python) require an
 *  actual import instead — `calc.test.ts` does not reach a sibling `b.ts` by
 *  living next to it. */
const PACKAGE_DIRECTORY_LANGUAGES = new Set(["go", "java", "kotlin", "scala", "csharp"])

function posixDir(p: string): string {
  const i = p.lastIndexOf("/")
  return i < 0 ? "" : p.slice(0, i)
}
function posixBase(p: string): string {
  const i = p.lastIndexOf("/")
  return i < 0 ? p : p.slice(i + 1)
}
function withoutExtension(p: string): string {
  return p.replace(/\.[^./]+$/, "")
}

/** Does one `brain_import` specifier reach the target file? */
function importReachesTarget(spec: string, testFile: string, targetFile: string, language: string): boolean {
  if (!spec) return false
  const targetNoExt = withoutExtension(targetFile)
  if (spec === targetFile || withoutExtension(spec) === targetNoExt) return true
  if (spec.startsWith(".") || spec.startsWith("/")) {
    const base = posixDir(testFile)
    const joined = spec.startsWith("/") ? spec : base ? base + "/" + spec : spec
    const parts: string[] = []
    for (const seg of joined.split("/")) {
      if (seg === "" || seg === ".") continue
      if (seg === "..") {
        parts.pop()
        continue
      }
      parts.push(seg)
    }
    const resolved = parts.join("/")
    return resolved.length > 0 && (resolved === targetNoExt || targetNoExt.startsWith(resolved + "/") || posixBase(resolved) === posixBase(targetNoExt))
  }
  if (language === "go") {
    // A Go package import's last path segment names the target's package.
    const segs = spec.split("/").filter(Boolean)
    const last = segs[segs.length - 1] ?? ""
    return last.length > 0 && last === posixBase(posixDir(targetFile))
  }
  return posixBase(withoutExtension(spec)) === posixBase(targetNoExt)
}

function goPackageNameFor(file: string): string {
  return posixBase(posixDir(file))
}


// ── RECEIVER EVIDENCE (P1-3 completion) ──────────────────────────────────────
// The index carries no Go receiver types, so selector calls used to fail closed
// (`receiver-selector-unresolved`) even when the test file itself declares the
// receiver. These helpers prove the receiver from the test file's own
// declarations — never from a guess — and are hash-gated: if the file on disk no
// longer matches the indexed hash, the evidence is UNKNOWN and the caller keeps
// the old fail-closed behaviour.
type ReceiverCaches = {
  fileRows: Map<string, { path: string; fileHash: string | null } | null>
  texts: Map<string, string | null>
  typeRows: Map<string, Array<{ id: string; fileId: string; name: string }>>
  ownerMethod: Map<string, boolean>
}

export function newReceiverCaches(): ReceiverCaches {
  return { fileRows: new Map(), texts: new Map(), typeRows: new Map(), ownerMethod: new Map() }
}

function stripTypeText(text: string): string {
  return text.replace(/[\[\]\s*]/g, "")
}

async function freshTestSource(raw: any, projectId: ProjectID, rel: string, caches: ReceiverCaches): Promise<string | null> {
  if (caches.texts.has(rel)) return caches.texts.get(rel) ?? null
  let row = caches.fileRows.get(rel)
  if (row === undefined) {
    row = (raw.prepare("SELECT path, file_hash AS fileHash FROM brain_file WHERE project_id = ? AND relative_path = ? LIMIT 1")
      .get(projectId, rel) as { path: string; fileHash: string | null } | undefined) ?? null
    caches.fileRows.set(rel, row)
  }
  if (!row?.path) { caches.texts.set(rel, null); return null }
  let text: string | null = null
  try {
    const [{ readFileSync }, { createHash }, fsMod] = await Promise.all([import("node:fs"), import("node:crypto"), import("node:path")])
    void fsMod
    text = readFileSync(row.path, "utf8")
    // Hash-gate: stale source must never produce evidence. brain_file.file_hash is
    // stored as a 16-char sha256 prefix on the incremental path (and as the full
    // digest on some older rows), so compare at the stored precision instead of
    // assuming one width.
    if (row.fileHash) {
      const hash = createHash("sha256").update(text).digest("hex")
      if (hash !== row.fileHash && hash.slice(0, row.fileHash.length) !== row.fileHash) text = null
    }
  } catch {
    text = null
  }
  caches.texts.set(rel, text)
  return text
}

function declarationsOfType(text: string, root: string): string[] {
  const out: string[] = []
  const esc = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const patterns = [
    new RegExp(`\\bvar\\s+${esc}\\s+([*\\[\\]]?[A-Za-z_][\\w.]*)`, "g"),
    new RegExp(`\\b${esc}\\s*:=\\s*&?\\s*([A-Za-z_][\\w.]*)\\s*\\{`, "g"),
    new RegExp(`\\b${esc}\\s*:=\\s*new\\(\\s*([A-Za-z_][\\w.]*)\\s*\\)`, "g"),
    // function parameters: `func x(a *T, b T)` — name followed by a type.
    new RegExp(`\\b${esc}\\s+([*\\[\\]]?[A-Za-z_][\\w.]*)`, "g"),
  ]
  for (const re of patterns) {
    for (const m of text.matchAll(re)) if (m[1]) out.push(stripTypeText(m[1]))
  }
  return Array.from(new Set(out.filter((t) => t.length > 0 && t !== root)))
}

function projectTypeRows(raw: any, projectId: ProjectID, name: string, caches: ReceiverCaches) {
  const hit = caches.typeRows.get(name)
  if (hit) return hit
  const rows = raw.prepare(
    "SELECT id, file_id AS fileId, name FROM brain_symbol WHERE project_id = ? AND name = ? " +
      "AND symbol_type NOT IN ('function','method','module','property','variable','parameter','field') LIMIT 4",
  ).all(projectId, name) as Array<{ id: string; fileId: string; name: string }>
  caches.typeRows.set(name, rows)
  return rows
}

function fieldTypeOf(text: string, field: string): string[] {
  const esc = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const out: string[] = []
  for (const m of text.matchAll(new RegExp(`\\b${esc}\\s+([*\\[\\]]?[A-Za-z_][\\w.]*)`, "g"))) {
    if (m[1]) out.push(stripTypeText(m[1]))
  }
  return Array.from(new Set(out))
}

function importIsStdlibPackage(imports: string[], pkg: string): boolean {
  for (const spec of imports) {
    const segs = spec.split("/").filter(Boolean)
    const last = segs[segs.length - 1] ?? ""
    if (last !== pkg) continue
    // Go stdlib import paths have no dot in their first segment; module paths do.
    return !segs[0].includes(".")
  }
  return false
}

function importIsNonStdlibPackage(imports: string[], pkg: string): boolean {
  for (const spec of imports) {
    const segs = spec.split("/").filter(Boolean)
    const last = segs[segs.length - 1] ?? ""
    if (last === pkg && segs[0].includes(".")) return true
  }
  return false
}

async function ownerHasMethod(raw: any, projectId: ProjectID, typeId: string, methodName: string, caches: ReceiverCaches): Promise<boolean> {
  const key = `${typeId}|${methodName}`
  const hit = caches.ownerMethod.get(key)
  if (hit !== undefined) return hit
  const row = raw.prepare(
    "SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ? AND name = ? AND symbol_type = 'method' AND owner_symbol_id = ?",
  ).get(projectId, methodName, typeId) as { c: number }
  const ok = Number(row?.c ?? 0) > 0
  caches.ownerMethod.set(key, ok)
  return ok
}

/** Prove a selector call's receiver from the TEST FILE's declarations. Returns
 *  `null` when the evidence is not conclusive (unknown/multiple declarations,
 *  stale source, unresolvable field chain) — the caller then keeps failing closed. */
export async function inferReceiverEvidence(
  raw: any,
  projectId: ProjectID,
  testFileRel: string,
  language: string | null,
  testImports: string[],
  callExpression: string,
  targetName: string,
  caches: ReceiverCaches,
): Promise<ReceiverEvidence | null> {
  if (String(language ?? "").toLowerCase() !== "go") return null
  const segments = callExpression.split(".").filter((seg) => seg.length > 0)
  if (segments.length < 2) return null
  const text = await freshTestSource(raw, projectId, testFileRel, caches)
  if (!text) return null
  const root = segments[0]
  const declared = declarationsOfType(text, root)
  // `pkg.Fn` where pkg is the TARGET's package is existing package evidence, not
  // receiver evidence: leaving it unresolved keeps the package rule in charge.
  if (declared.length === 0) return null
  if (declared.length > 1) return null
  let current: { kind: "project" | "external"; typeName: string; typeId?: string } | null = null
  const classifyType = (typeText: string): { kind: "project" | "external"; typeName: string; typeId?: string } | null => {
    const dot = typeText.lastIndexOf(".")
    const base = dot >= 0 ? typeText.slice(dot + 1) : typeText
    const pkg = dot >= 0 ? typeText.slice(0, dot) : ""
    if (pkg) {
      if (importIsStdlibPackage(testImports, pkg)) return { kind: "external", typeName: typeText }
      if (importIsNonStdlibPackage(testImports, pkg)) {
        const rows = projectTypeRows(raw, projectId, base, caches)
        return rows.length === 1 ? { kind: "project", typeName: base, typeId: rows[0].id } : null
      }
      return null
    }
    const rows = projectTypeRows(raw, projectId, base, caches)
    return rows.length === 1 ? { kind: "project", typeName: base, typeId: rows[0].id } : null
  }
  current = classifyType(declared[0])
  if (!current) return null
  // Resolve intermediate selectors (`mod.StatusLock.Lock`): each field type is
  // read from the project type's own declaration; a non-unique field stays unknown.
  for (const field of segments.slice(1, segments.length - 1)) {
    if (current.kind !== "project" || !current.typeId) return null
    const rows = projectTypeRows(raw, projectId, current.typeName, caches)
    if (rows.length !== 1) return null
    const typeFileRow = (raw.prepare("SELECT relative_path AS rel FROM brain_file WHERE id = ?").get(rows[0].fileId) as { rel: string } | undefined)
    if (!typeFileRow?.rel) return null
    const typeText = await freshTestSource(raw, projectId, typeFileRow.rel, caches)
    if (!typeText) return null
    const fieldTypes = fieldTypeOf(typeText, field)
    if (fieldTypes.length !== 1) return null
    const next = classifyType(fieldTypes[0].startsWith(current.typeName + ".") ? fieldTypes[0].slice(current.typeName.length + 1) : fieldTypes[0])
    if (!next) return null
    current = next
  }
  if (current.kind === "external") return { kind: "external", typeName: current.typeName }
  if (!current.typeId) return { kind: "project", typeName: current.typeName, ownerHasMethod: false }
  const has = await ownerHasMethod(raw, projectId, current.typeId, targetName, caches)
  return { kind: "project", typeName: current.typeName, ownerHasMethod: has }
}

/** Validate one candidate test-evidence row. Pure — exported for the gate. */
export function validateTestLink(input: TestLinkValidationInput): TestLinkValidation {
  const language = String(input.language ?? "").toLowerCase()
  const meta = input.metadata ?? {}
  const isDirect = input.relationshipType === "calls" || input.relationshipType === "instantiates"
  const callExpression = String((meta.callExpression ?? meta.selectorExpression ?? "") || "")
  const sameDirectory = posixDir(input.testFile) === posixDir(input.targetFile)
  const reachableByImport = input.testImports.some((spec) => importReachesTarget(spec, input.testFile, input.targetFile, language))
  const reachable = (sameDirectory && PACKAGE_DIRECTORY_LANGUAGES.has(language)) || reachableByImport

  // The row itself states the callee is an external/stdlib package member: the
  // stored target id cannot be that callee's declaration. (This is the precise
  // `errors.New → session.New` pin.)
  if (meta.isStdlib === true) return { ok: false, reason: "external-stdlib-leaf" }

  // Non-call evidence (references/uses/extends/implements/imports) only needs
  // reachability, not a call expression.
  if (!isDirect) return reachable ? { ok: true } : { ok: false, reason: "cross-package-unreachable" }

  // A direct call with no recorded call expression cannot be validated.
  if (!callExpression) return reachable ? { ok: true } : { ok: false, reason: "cross-package-unreachable" }

  const segments = callExpression.split(".").filter((s) => s.length > 0)
  const leaf = segments[segments.length - 1] ?? ""
  if (leaf !== input.targetName) return { ok: false, reason: "target-name-mismatch" }

  if (segments.length > 1) {
    // PROVEN receiver evidence first: it is derived from the test file's own
    // declarations, so a selector that used to fail closed can now be decided
    // honestly — a project-type receiver whose type declares the method is real
    // evidence; a stdlib/external receiver is NOT evidence for a project symbol.
    if (input.receiver) {
      if (input.receiver.kind === "external") return { ok: false, reason: "external-stdlib-leaf" }
      if (input.receiver.kind === "project") {
        if (input.receiver.ownerHasMethod === true) return reachable ? { ok: true } : { ok: false, reason: "cross-package-unreachable" }
        return { ok: false, reason: "receiver-selector-unresolved" }
      }
    }
    // Receiver/package selector. A member chain (`mod.Session.Lock`) cannot be
    // resolved without receiver types; a two-segment `pkg.Fn` is proven only when
    // the qualifier names the TARGET's package AND the test file imports it.
    if (segments.length > 2) return { ok: false, reason: "receiver-selector-unresolved" }
    const qualifier = segments[0]
    const targetPkg = goPackageNameFor(input.targetFile)
    const qualifierNamesTargetPackage = language === "go" ? qualifier === targetPkg : true
    if (qualifierNamesTargetPackage && reachableByImport) return { ok: true }
    if (sameDirectory && PACKAGE_DIRECTORY_LANGUAGES.has(language) && qualifier === targetPkg) return { ok: true }
    return { ok: false, reason: "qualified-call-target-is-a-leaf" }
  }

  // Unqualified callee names a declaration in the caller's OWN package/module.
  return reachable ? { ok: true } : { ok: false, reason: "cross-package-unreachable" }
}

type ProdRow = {
  id: string
  name: string
  symbolType: string
  file: string
  line: number
  complexity: number
  gravity: number
}

type TestEdgeRow = {
  targetId: string
  relType: string
  testSymId: string
  testSymName: string
  testFile: string
  testLanguage: string | null
  targetName: string | null
  targetFile: string | null
  metadata: string | null
}

function classify(relType: string): TestEvidenceKind | null {
  if (DIRECT_TYPES.has(relType)) return "direct_call"
  if (REFERENCE_TYPES.has(relType)) return "reference"
  if (IMPORT_TYPES.has(relType)) return "import"
  return null
}

/** Escape %/_/\ so a path is a VALUE in a LIKE comparison, never a pattern.
 *  Character-wise, because a path is data the caller typed — there is no
 *  pattern here to get wrong. */
function escapeLikeValue(value: string): string {
  let out = ""
  for (const ch of value) out += ch === "\\" || ch === "%" || ch === "_" ? "\\" + ch : ch
  return out
}

/**
 * A project-relative path scope: the FILE ITSELF, or any file under it on a
 * whole segment boundary.
 *
 * The exact-match arm is the same rule `dependencies` and `complexity` apply,
 * and it was missing here: `filePath: "src/core/engine.ts"` (a real file) was a
 * scope with zero matches, so the report said the file holds no production
 * symbols — a confident false negative. A prefix without a segment boundary is
 * the other failure this predicate prevents: `src/util` must not match
 * `src/utilities`.
 */
function pathScope(alias: string, filePath: string): { sql: string; params: string[] } {
  let clean = filePath
  while (clean.endsWith("/")) clean = clean.slice(0, -1)
  const col = alias ? `${alias}.relative_path` : "relative_path"
  return { sql: ` AND (${col} = ? OR ${col} LIKE ? ESCAPE '\\')`, params: [clean, escapeLikeValue(clean) + "/%"] }
}

function strongest(links: TestLink[]): TestEvidenceKind | "none" {
  if (links.some((l) => l.evidence === "direct_call")) return "direct_call"
  if (links.some((l) => l.evidence === "reference")) return "reference"
  if (links.some((l) => l.evidence === "import")) return "import"
  return "none"
}

async function loadGraph(projectId: ProjectID, includeMethods: boolean, filePath?: string) {
  const raw = await BrainDatabase.getRawInstance(projectId)

  // Optional scope: production symbols under a project-relative path prefix, or
  // in one named file. Applied at the SQL layer so a scoped call is cheaper than
  // project-wide, not just a post-filter.
  const scope = filePath ? pathScope("f", filePath) : { sql: "", params: [] as string[] }
  const scopeSql = scope.sql
  const scopeParams: string[] = scope.params

  const prodRows = raw.prepare(
    "SELECT s.id, s.name, s.symbol_type AS symbolType, f.relative_path AS file, " +
      "COALESCE(s.line_start,0) AS line, COALESCE(s.complexity,0) AS complexity, COALESCE(s.gravity_score,0) AS gravity " +
      "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
      "WHERE s.project_id = ? AND COALESCE(f.is_test_file,0) = 0 AND s.symbol_type IN " + PROD_SYMBOL_TYPES + scopeSql,
  ).all(projectId, ...scopeParams) as ProdRow[]

  const fileCode = codeTestClause("")
  const flaggedTestFiles = (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=? AND COALESCE(is_test_file,0)=1").get(projectId) as { c: number }).c
  const testFileCount = (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=? AND COALESCE(is_test_file,0)=1" + fileCode.sql).get(projectId, ...fileCode.params) as { c: number }).c
  const symCode = codeTestClause("f")
  const testSymCount = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND COALESCE(f.is_test_file,0)=1" + symCode.sql).get(projectId, ...symCode.params) as { c: number }).c
  const nonCodeTestFiles = Math.max(0, flaggedTestFiles - testFileCount)

  // M50.A2 residual: the edge query scans the whole relationship table to find
  // rows whose SOURCE symbol lives in a test file. When no code test source
  // exists the answer is provably empty (same predicate, same definition), so
  // the scan is skipped entirely instead of paying 370ms to prove zero.
  const edgeCode = codeTestClause("tf")
  const rawEdges = testFileCount === 0 ? ([] as TestEdgeRow[]) : (raw.prepare(
    "SELECT r.target_symbol_id AS targetId, r.relationship_type AS relType, " +
      "ts.id AS testSymId, ts.name AS testSymName, tf.relative_path AS testFile, tf.language AS testLanguage, " +
      "tgt.name AS targetName, tgtf.relative_path AS targetFile, r.metadata AS metadata " +
      "FROM brain_relationship r " +
      "JOIN brain_symbol ts ON ts.id = r.source_symbol_id " +
      "JOIN brain_file tf ON tf.id = ts.file_id AND COALESCE(tf.is_test_file,0) = 1 " +
      "LEFT JOIN brain_symbol tgt ON tgt.id = r.target_symbol_id " +
      "LEFT JOIN brain_file tgtf ON tgtf.id = tgt.file_id " +
      "WHERE r.project_id = ? AND r.target_symbol_id IS NOT NULL" + edgeCode.sql,
  ).all(projectId, ...edgeCode.params) as TestEdgeRow[])

  // Path predicates are per FILE, not per symbol (~12 symbols per file here), so
  // resolve each distinct path once — the same memo the orphan engine uses.
  const noisePathMemo = new Map<string, boolean>()
  const isNoisePath = (file: string): boolean => {
    let v = noisePathMemo.get(file)
    if (v === undefined) { v = AnalysisExclusions.isHardNoisePath(file); noisePathMemo.set(file, v) }
    return v
  }
  const filtered = prodRows.filter(
    (r) =>
      !isNoisePath(r.file) &&
      !AnalysisExclusions.isNoiseSymbolName(r.name) &&
      (includeMethods || r.symbolType !== "method"),
  )
  // What the filter removed, as a NUMBER the answer carries.
  //
  // The population was silently smaller than the store's, and nothing said so:
  // on the atlas corpus the documented filter (`symbol_type IN
  // PROD_SYMBOL_TYPES`, non-test files) selects 171 symbols and the report said
  // `productionSymbols: 169`. Two symbols were dropped as noise paths or noise
  // names — a reasonable decision, and one an agent cannot reconstruct, because
  // the numbers do not reconcile against anything they can query.
  const filteredIds = new Set(filtered.map((r) => r.id))

  // P1-3: the TEST FILE's imports are the reachability evidence. Read once per
  // test corpus (relative path -> specifiers). A Go test file with no imports is
  // still legitimate via same-directory package semantics.
  const testImportsByFile = new Map<string, string[]>()
  if (testFileCount > 0) {
    const importCode = codeTestClause("f")
    const importRows = raw.prepare(
      "SELECT f.relative_path AS file, COALESCE(i.import_path, '') AS target " +
        "FROM brain_file f JOIN brain_import i ON i.file_id = f.id AND i.project_id = f.project_id " +
        "WHERE f.project_id = ? AND COALESCE(f.is_test_file,0) = 1" + importCode.sql,
    ).all(projectId, ...importCode.params) as Array<{ file: string; target: string }>
    for (const row of importRows) {
      if (!row.target) continue
      const arr = testImportsByFile.get(row.file) ?? []
      arr.push(row.target)
      testImportsByFile.set(row.file, arr)
    }
  }

  // Validate every classified candidate row. Rejections are counted PER REASON so
  // the payload can say WHY a candidate was not published (a bare rejection rate
  // would be a different defect).
  const rejectedLinks: Partial<Record<TestLinkRejection, number>> = {}
  let rejectedTotal = 0
  const receiverCaches = newReceiverCaches()
  const testEdges: TestEdgeRow[] = []
  for (const edge of rawEdges) {
    // Only rows the classifier can name were ever candidate evidence; validating
    // the rest would report "unvalidated" for kinds the mapping never published.
    if (!classify(edge.relType)) continue
    if (!filteredIds.has(edge.targetId)) continue
    if (!edge.targetFile || !edge.targetName) {
      rejectedLinks["target-name-mismatch"] = (rejectedLinks["target-name-mismatch"] ?? 0) + 1
      rejectedTotal++
      continue
    }
    let metadata: Record<string, unknown> | null = null
    if (edge.metadata) {
      try {
        metadata = JSON.parse(edge.metadata) as Record<string, unknown>
      } catch {
        metadata = null
      }
    }
    // P1-3 completion: selector calls carry no receiver type in the index, so
    // prove the receiver from the test file's own declarations (hash-gated);
    // unknown evidence keeps the fail-closed path in validateTestLink.
    let receiver: ReceiverEvidence | undefined
    const callExpr = String((metadata?.callExpression ?? metadata?.selectorExpression ?? "") || "")
    if (callExpr.split(".").filter((seg) => seg.length > 0).length > 1) {
      try {
        receiver = (await inferReceiverEvidence(raw, projectId, edge.testFile, edge.testLanguage, testImportsByFile.get(edge.testFile) ?? [], callExpr, edge.targetName, receiverCaches)) ?? undefined
      } catch {
        receiver = undefined
      }
    }
    const verdict = validateTestLink({
      relationshipType: edge.relType,
      targetExternal: edge.targetName,
      targetName: edge.targetName,
      targetFile: edge.targetFile,
      testFile: edge.testFile,
      language: edge.testLanguage,
      metadata,
      testImports: testImportsByFile.get(edge.testFile) ?? [],
      receiver,
    })
    if (verdict.ok) {
      testEdges.push(edge)
      continue
    }
    rejectedLinks[verdict.reason] = (rejectedLinks[verdict.reason] ?? 0) + 1
    rejectedTotal++
  }

  const excludedAsNoise = prodRows.length - filtered.length
  // P1-3: rows that FAILED validation are not dropped silently — they are counted
  // per reason and declared by every consuming mode.
  return { filtered, testEdges, testFileCount, testSymCount, nonCodeTestFiles, excludedAsNoise, rejectedLinks, rejectedTotal }
}

/**
 * Fold stored test edges into at most ONE link per (target symbol, test symbol).
 *
 * A production symbol can reach the same test through several stored edges — a
 * call and a reference, or the same call recorded by two scan passes. Those used to
 * arrive as separate links: measured on 0.1.8, `ModuleParam` repeated
 * `TestModuleParamValidate:107` sixteen times and `EventPool` repeated
 * `TestNewEventPool`, so the 20-link cap was spent on repeats and one test read as
 * twenty. The stronger evidence wins (a `direct_call` outranks a `reference`) rather
 * than the first seen, and the consolidation is counted so the page can say how many
 * edges collapsed.
 *
 * PURE: no DB, no I/O. Exported so a gate can pin the fold on synthetic edges.
 */
export function aggregateTestLinks(
  testEdges: Array<{ targetId: string; testSymId: string; testSymName: string; testFile: string; relType: string }>,
): { linksByTarget: Map<string, TestLink[]>; consolidatedLinks: number; classifiedEdges: number } {
  const linksByTarget = new Map<string, TestLink[]>()
  const linkSlot = new Map<string, Map<string, number>>()
  let consolidatedLinks = 0
  let classifiedEdges = 0
  for (const e of testEdges) {
    const kind = classify(e.relType)
    if (!kind) continue
    classifiedEdges++
    if (!linksByTarget.has(e.targetId)) linksByTarget.set(e.targetId, [])
    const slots = linkSlot.get(e.targetId) ?? new Map<string, number>()
    if (!linkSlot.has(e.targetId)) linkSlot.set(e.targetId, slots)
    const incoming: TestLink = {
      testSymbolId: e.testSymId,
      testSymbolName: e.testSymName,
      testFile: e.testFile,
      evidence: kind,
      relationshipType: e.relType,
      confidence: EVIDENCE_CONFIDENCE[kind],
    }
    const existingIndex = slots.get(e.testSymId)
    if (existingIndex !== undefined) {
      consolidatedLinks++
      const list = linksByTarget.get(e.targetId)!
      if (incoming.confidence > list[existingIndex].confidence) list[existingIndex] = incoming
      continue
    }
    slots.set(e.testSymId, linksByTarget.get(e.targetId)!.length)
    linksByTarget.get(e.targetId)!.push(incoming)
  }
  return { linksByTarget, consolidatedLinks, classifiedEdges }
}

// MODE: mapping — production symbols -> test evidence, keyed by RESOLVED symbol
// id (avoids same-named-symbol contamination).
export async function testMapping(projectId: ProjectID, options: TestIntelOptions = {}): Promise<TestMappingReport> {
  const includeMethods = options.includeMethods ?? true
  // The page, not the whole corpus: see DEFAULT_PAGE. At the old 1000 a
  // single call on backbencher-brain/src rendered 375,270 bytes (~104k tokens).
  const maxResults = options.maxResults ?? DEFAULT_PAGE
  const { filtered, testEdges, testFileCount, testSymCount, nonCodeTestFiles, excludedAsNoise, rejectedLinks, rejectedTotal } = await loadGraph(projectId, includeMethods, options.filePath)

  const { linksByTarget, consolidatedLinks, classifiedEdges } = aggregateTestLinks(testEdges)

  const entries: TestMappingEntry[] = filtered.map((s) => {
    const links = linksByTarget.get(s.id) ?? []
    return {
      symbolId: s.id,
      name: s.name,
      symbolType: s.symbolType,
      file: s.file,
      line: s.line,
      complexity: s.complexity,
      gravity: s.gravity,
      links,
      strongestEvidence: strongest(links),
    }
  })

  const tested = entries.filter((e) => e.links.length > 0).length
  const totalLinks = entries.reduce((sum, e) => sum + e.links.length, 0)
  entries.sort((a, b) => b.links.length - a.links.length || b.complexity - a.complexity)

  // The page is a page. testGaps already declared its bound; testMapping
  // sliced to maxResults and said nothing, so a caller could not tell 50
  // entries out of 4048 from the whole corpus.
  const page = entries.slice(0, maxResults)
  // Rank on the FULL link count, then trim the array — the ranking is the
  // finding, the trim is the budget.
  const ranked = page.map((e) => ({
    ...e,
    links: e.links.slice(0, DEFAULT_MAX_LINKS),
    linksTruncated: e.links.length > DEFAULT_MAX_LINKS,
  }))

  const mappingUnknowns: string[] = []
  if (rejectedTotal > 0) {
    const why = Object.entries(rejectedLinks)
      .map(([reason, count]) => `${reason}=${count}`)
      .sort()
      .join(", ")
    mappingUnknowns.push(
      `unvalidated-test-links: ${rejectedTotal} stored relationship row(s) from test files did not prove their target and were NOT published as evidence (${why}); a stored call is not test evidence until the test can reach the target's exact symbol`,
    )
  }
  if (classifiedEdges === 0) mappingUnknowns.push(NO_EVIDENCE_UNKNOWN)
  const mappingNonCode = nonCodeUnknown(nonCodeTestFiles)
  if (mappingNonCode) mappingUnknowns.push(mappingNonCode)
  if (entries.length > ranked.length) {
    mappingUnknowns.push(`entry-page: showing ${ranked.length} of ${entries.length} production symbols — raise limit for the rest`)
  }

  return {
    entries: ranked,
    provenance: makeProvenance({
      evidenceClass: "inferred",
      engine: "test-intel@intelligence",
      engineVersion: "m10.05",
      projectId,
      source: "brain_symbol+brain_relationship+brain_file",
      limitations: [
        "Static relationships do not prove runtime execution or line coverage.",
        "A production symbol is one whose type is in PROD_SYMBOL_TYPES; constants, properties, type aliases, modules and namespaces are outside the untested denominator entirely.",
        `An entry carries at most ${DEFAULT_MAX_LINKS} links (linksTruncated says when more exist); the ranking and the summary use the complete set.`,
      ],
      truncated: entries.length > ranked.length,
      unknowns: mappingUnknowns,
    }),
    summary: {
      productionSymbols: entries.length,
      // So `productionSymbols + excludedAsNoise` is the store's population
      // under this mode's own documented filter, and a reader can check it.
      excludedAsNoise,
      returned: ranked.length,
      truncated: entries.length > ranked.length,
      testedSymbols: tested,
      untestedSymbols: entries.length - tested,
      testFiles: testFileCount,
      scannedTestSymbols: testSymCount,
      evidenceLinks: totalLinks,
      // P1-3: candidate rows that failed reachability validation. Not part of the
      // frozen TestMappingReport contract (contracts.ts is frozen for this wave),
      // so it is attached as a declared intersection field.
      unvalidatedLinks: rejectedTotal,
      consolidatedLinks,
      unvalidatedByReason: rejectedLinks,
    },
  } as TestMappingReport & { summary: TestMappingReport["summary"] & { unvalidatedLinks: number; unvalidatedByReason: Partial<Record<TestLinkRejection, number>> } }
}

// MODE: gaps — untested / weakly-tested production symbols, risk-ranked.
//
// M50.A2 residual: this used to call `testMapping(..., {maxResults: 100000})`,
// which materialized EVERY production symbol with its links array, then built a
// gap object (with its recommendation string) for every one of them, sorted
// ~30k of those, and sliced to 200. Same defect shape as bb_patterns/
// bb_security/bb_analyze complexity: the engine built far more than it can
// return. Candidates are now lightweight sort keys and the finding objects are
// built only for the returned page. The two-stage stable sort reproduces the
// previous ordering exactly (previous first key: links.length desc,
// complexity desc; second key: riskScore desc, file asc), so the returned page
// is byte-identical.
export async function testGaps(projectId: ProjectID, options: TestIntelOptions = {}): Promise<TestGapReport> {
  const maxResults = options.maxResults ?? DEFAULT_PAGE
  const includeMethods = options.includeMethods ?? true
  const { filtered, testEdges, nonCodeTestFiles, excludedAsNoise, rejectedLinks, rejectedTotal } = await loadGraph(projectId, includeMethods, options.filePath)

  // One pass over the edges: classify once, count per target (the count is the
  // previous implementation's `links.length`, needed to reproduce its order).
  const anyEvidence = new Set<string>()
  const hasDirect = new Set<string>()
  const linkCount = new Map<string, number>()
  let classifiedEdges = 0
  for (const e of testEdges) {
    const kind = classify(e.relType)
    if (!kind) continue
    classifiedEdges++
    anyEvidence.add(e.targetId)
    linkCount.set(e.targetId, (linkCount.get(e.targetId) ?? 0) + 1)
    if (kind === "direct_call") hasDirect.add(e.targetId)
  }

  const candidates = filtered
    .filter((s) => !hasDirect.has(s.id))
    .map((s) => ({
      s,
      links: linkCount.get(s.id) ?? 0,
      category: (anyEvidence.has(s.id) ? "weak_evidence" : "no_evidence") as TestGap["category"],
      riskScore: Math.round((s.complexity * 2 + s.gravity * 10) * 100) / 100,
    }))
  // Stage 1 reproduces testMapping's entries order; stage 2 the gap ranking.
  candidates.sort((a, b) => b.links - a.links || b.s.complexity - a.s.complexity)
  candidates.sort((a, b) => b.riskScore - a.riskScore || a.s.file.localeCompare(b.s.file))

  const byCategory: Record<string, number> = {}
  let highRisk = 0
  for (const c of candidates) {
    byCategory[c.category] = (byCategory[c.category] ?? 0) + 1
    if (c.riskScore >= 10) highRisk++
  }

  const gaps: TestGap[] = candidates.slice(0, maxResults).map((c) => ({
    symbolId: c.s.id,
    name: c.s.name,
    symbolType: c.s.symbolType,
    file: c.s.file,
    line: c.s.line,
    category: c.category,
    complexity: c.s.complexity,
    gravity: c.s.gravity,
    riskScore: c.riskScore,
    recommendation:
      c.category === "no_evidence"
        ? "No test references this symbol; add a direct test."
        : "Only indirect/import evidence; add a direct assertion-bearing test.",
  }))

  const gapUnknowns: string[] = []
  if (rejectedTotal > 0) {
    const why = Object.entries(rejectedLinks)
      .map(([reason, count]) => `${reason}=${count}`)
      .sort()
      .join(", ")
    gapUnknowns.push(
      `unvalidated-test-links: ${rejectedTotal} stored test-file relationship row(s) did not prove their target and are NOT counted as evidence (${why})`,
    )
  }
  if (classifiedEdges === 0) gapUnknowns.push(NO_EVIDENCE_UNKNOWN)
  const gapNonCode = nonCodeUnknown(nonCodeTestFiles)
  if (gapNonCode) gapUnknowns.push(gapNonCode)

  return {
    gaps,
    provenance: makeProvenance({ evidenceClass: "inferred", engine: "test-gaps@intelligence", engineVersion: "m10.02", projectId, source: "static-test-mapping", limitations: ["A missing static link does not prove that runtime coverage is absent."], truncated: candidates.length > maxResults, unknowns: gapUnknowns }),
    summary: {
      // `total` is the number of GAPS, not the number of production symbols —
      // it is `productionSymbols` minus the ones with a direct test. That is
      // correct and it was invisible, because `test_mapping.summary` reports a
      // field of the same name meaning the population: on the atlas corpus the
      // two modes answered 169 and 163 for what reads as one question, and
      // nothing in either payload said the arithmetic.
      //
      // The identity closes in public, and it is stated in the CONTRACTS
      // vocabulary rather than invented here:
      //   productionSymbols = total + directlyTested      (gaps + directly tested)
      //   productionSymbols + excludedAsNoise = the store's population under
      //                                        this mode's own filter
      // `excludedAsNoise` is NOT part of `productionSymbols` — the population is
      // already post-noise. Measured on the behaviour fixture: 17 = 17 + 0, and
      // productionSymbols + 0 = the 17 filtered production symbols.
      productionSymbols: filtered.length,
      total: candidates.length,
      directlyTested: filtered.length - candidates.length,
      excludedAsNoise,
      returned: gaps.length,
      truncated: candidates.length > gaps.length,
      byCategory,
      highRisk,
    },
  }
}

// MODE: impact — which tests exercise a changed symbol (direct + indirect via
// the shared graph engine's caller traversal). Runtime coverage is a separate,
// unpopulated field unless a real artifact is supplied.
export async function testImpact(
  projectId: ProjectID,
  target: string,
  /** `timeBudgetMs` is this mode's own wall-clock bound. The graph engine defaults
   *  to NO clock bound and this mode refuses `limit`, so without it the one
   *  walking mode with no page size also had no ceiling. */
  options: TestIntelOptions & { timeBudgetMs?: number } = {},
): Promise<TestImpactReport> {
  const { graphTraversal } = await import("../graph/graph-engine")
  const raw = await BrainDatabase.getRawInstance(projectId)

  const testFileIds = new Set(
    (raw.prepare("SELECT id FROM brain_file WHERE project_id=? AND COALESCE(is_test_file,0)=1").all(projectId) as Array<{ id: string }>).map((r) => r.id),
  )
  const symbolFile = new Map<string, string>()
  for (const r of raw.prepare("SELECT id, file_id AS fileId FROM brain_symbol WHERE project_id=?").all(projectId) as Array<{ id: string; fileId: string }>) {
    symbolFile.set(r.id, r.fileId)
  }
  const fileRel = new Map<string, string>()
  for (const r of raw.prepare("SELECT id, relative_path AS rel FROM brain_file WHERE project_id=?").all(projectId) as Array<{ id: string; rel: string }>) {
    fileRel.set(r.id, r.rel)
  }

  const timeBudgetMs = Math.max(0, Math.floor(options.timeBudgetMs ?? 2_000))
  const depthCap = options.maxDepth ?? 4
  let graph
  try {
    graph = await graphTraversal(projectId, target, {
      direction: "callers",
      maxDepth: depthCap,
      timeBudgetMs,
      // The declared rule (see TEST_IMPACT_KINDS): the walk sees only kinds this
      // engine can classify, so `contains` membership is never read as a test
      // dependency and every entry below can name its own tier.
      relationshipTypes: [...TEST_IMPACT_KINDS],
    })
  } catch {
    return {
      target,
      found: false,
      directTests: [],
      indirectTests: [],
      affectedTestFiles: [],
      truncated: false,
      truncationReason: null,
      summary: { returned: 0, total: 0, truncated: false, truncationReason: null, timeBudgetMs, timeBudgetExhausted: false, depthCap },
      provenance: makeProvenance({ evidenceClass: "unknown", engine: "test-impact@intelligence", engineVersion: "m10.02", projectId, source: "graph-resolution", limitations: ["The target could not be resolved in the indexed graph."], unknowns: ["target-not-found"] }),
      runtimeCoverage: { available: false },
    }
  }

  const direct: TestImpactReport["directTests"] = []
  const indirect: TestImpactReport["indirectTests"] = []
  const affected = new Set<string>()
  // P1-3 completion: test_impact walked the graph's caller edges without asking
  // whether the edge IS test evidence, so a name-resolved row (`m.Lock()` on a
  // sync.Mutex bound to a project method) was published as a test impact. Each
  // edge is now validated with the SAME contract test_mapping uses; unvalidated
  // edges are counted per reason and excluded, never silently dropped.
  const rejectedLinks: Partial<Record<TestLinkRejection, number>> = {}
  let rejectedTotal = 0
  const receiverCaches = newReceiverCaches()
  const languageByFile = new Map<string, string | null>()
  for (const r of raw.prepare("SELECT relative_path AS rel, language FROM brain_file WHERE project_id=?").all(projectId) as Array<{ rel: string; language: string | null }>) {
    languageByFile.set(r.rel, r.language)
  }
  const nameAndFile = new Map<string, { name: string; file: string | null }>()
  for (const r of raw.prepare("SELECT s.id AS id, s.name AS name, f.relative_path AS file FROM brain_symbol s LEFT JOIN brain_file f ON f.id = s.file_id WHERE s.project_id=?").all(projectId) as Array<{ id: string; name: string; file: string | null }>) {
    nameAndFile.set(r.id, { name: r.name, file: r.file })
  }
  const importsByFile = new Map<string, string[]>()
  for (const r of raw.prepare(
    "SELECT f.relative_path AS file, COALESCE(i.import_path,'') AS target FROM brain_file f JOIN brain_import i ON i.file_id=f.id AND i.project_id=f.project_id WHERE f.project_id=? AND COALESCE(f.is_test_file,0)=1",
  ).all(projectId) as Array<{ file: string; target: string }>) {
    if (!r.target) continue
    const arr = importsByFile.get(r.file) ?? []
    arr.push(r.target)
    importsByFile.set(r.file, arr)
  }
  const edgeMeta = new Map<string, string | null>()
  const metadataFor = (sourceId: string, targetId: string, relType: string): Record<string, unknown> | null => {
    const key = `${sourceId}|${targetId}|${relType}`
    if (!edgeMeta.has(key)) {
      const row = raw.prepare("SELECT metadata FROM brain_relationship WHERE project_id=? AND source_symbol_id=? AND target_symbol_id=? AND relationship_type=? LIMIT 1")
        .get(projectId, sourceId, targetId, relType) as { metadata: string | null } | undefined
      edgeMeta.set(key, row?.metadata ?? null)
    }
    const rawMeta = edgeMeta.get(key)
    if (!rawMeta) return null
    try { return JSON.parse(rawMeta) as Record<string, unknown> } catch { return null }
  }

  for (const edge of graph.callers) {
    const node = graph.nodes[edge.from]
    if (!node || node.isExternal) continue
    const fileId = symbolFile.get(node.id)
    if (!fileId || !testFileIds.has(fileId)) continue
    const testFile = fileRel.get(fileId) ?? node.file
    // A kind this engine cannot classify is not test evidence, whatever the walk
    // was asked for: the classifier is the ONE vocabulary (see its sets above),
    // and `classify` returning null means "no tier to report" — never a tier
    // guessed from the depth.
    const kind = classify(String(edge.relationshipType))
    if (!kind) continue
    const targetMeta = nameAndFile.get(String(edge.to))
    if (!targetMeta?.file) { rejectedLinks["target-name-mismatch"] = (rejectedLinks["target-name-mismatch"] ?? 0) + 1; rejectedTotal++; continue }
    const metadata = metadataFor(node.id, String(edge.to), String(edge.relationshipType))
    let receiver: ReceiverEvidence | undefined
    const callExpr = String((metadata?.callExpression ?? metadata?.selectorExpression ?? "") || "")
    if (callExpr.split(".").filter((seg) => seg.length > 0).length > 1) {
      try {
        receiver = (await inferReceiverEvidence(raw, projectId, testFile, languageByFile.get(testFile) ?? node.language ?? null, importsByFile.get(testFile) ?? [], callExpr, targetMeta.name, receiverCaches)) ?? undefined
      } catch { receiver = undefined }
    }
    const verdict = validateTestLink({
      relationshipType: String(edge.relationshipType),
      targetExternal: targetMeta.name,
      targetName: targetMeta.name,
      targetFile: targetMeta.file,
      testFile,
      language: languageByFile.get(testFile) ?? node.language ?? null,
      metadata,
      testImports: importsByFile.get(testFile) ?? [],
      receiver,
    })
    if (!verdict.ok) {
      rejectedLinks[verdict.reason] = (rejectedLinks[verdict.reason] ?? 0) + 1
      rejectedTotal++
      continue
    }
    affected.add(testFile)
    const entry = {
      testSymbol: node.name,
      testFile,
      depth: edge.depth,
      relationshipType: String(edge.relationshipType),
      evidence: kind,
    }
    if (edge.depth === 0) direct.push(entry)
    else indirect.push(entry)
  }

  // testMapping and testGaps both attach the "no-test-evidence-edges" unknown
  // when the corpus produced nothing. testImpact did not, so on a project with
  // no test files it reported found:true with two empty arrays — an
  // authoritative "no test touches this" backed by nothing. The evidence is
  // one COUNT away, so take it.
  const testSymbols = (
    raw.prepare("SELECT COUNT(*) c FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ? AND COALESCE(f.is_test_file,0) = 1").get(projectId) as { c: number }
  ).c
  const unknowns = ["runtime-coverage-unavailable"]
  if (rejectedTotal > 0) {
    const reasons = Object.entries(rejectedLinks).map(([reason, count]) => `${reason}=${count}`).join(", ")
    unknowns.unshift(`unvalidated-test-links: ${rejectedTotal} caller edge(s) from test files did not prove a test link and are NOT test impact (${reasons})`)
  }
  if (testSymbols === 0) unknowns.unshift(NO_EVIDENCE_UNKNOWN)
  const walk: any = graph.summary
  const truncationReason: string | null = walk.truncationReason ?? (Array.isArray(walk.truncationReasons) && walk.truncationReasons.length ? walk.truncationReasons.join("+") : null)
  return {
    target,
    found: true,
    directTests: direct,
    indirectTests: indirect,
    affectedTestFiles: Array.from(affected).sort(),
    truncated: graph.summary.truncated,
    truncationReason,
    // What this engine returned and which bound fired. `total` is the set the
    // walk produced (the engine's own derivation, not the caller's site count):
    // when the walk was cut, `truncationReason`/`timeBudgetExhausted` say so
    // instead of leaving `truncated: true` unexplained.
    summary: {
      returned: direct.length + indirect.length,
      total: direct.length + indirect.length,
      truncated: graph.summary.truncated,
      truncationReason,
      timeBudgetMs,
      timeBudgetExhausted: walk.timeBudgetExhausted === true,
      depthCap: graph.summary.maxDepth,
      // P1-3 completion: caller edges that FAILED the test-link contract are
      // counted per reason and declared, exactly as test_mapping does — they are
      // NOT test impact and must never be published as such.
      unvalidatedLinks: rejectedTotal,
      unvalidatedByReason: rejectedLinks,
    },
    provenance: makeProvenance({ evidenceClass: "inferred", engine: "test-impact@intelligence", engineVersion: "m10.02", projectId, source: "brain_relationship", limitations: ["Static test impact does not prove runtime execution or coverage."], truncated: graph.summary.truncated, unknowns }),
    runtimeCoverage: { available: false },
  }
}
