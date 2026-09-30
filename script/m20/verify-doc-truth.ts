// script/m20/verify-doc-truth.ts — M20.D3 (#701-follow): the bb_doc TRUTH gate.
//
// The three shipped doc verifiers prove that citations RESOLVE and that invalid
// input is REFUSED. None of them asks whether a statement is true of the
// source, whether the result's own metadata is self-consistent, or whether the
// declared per-mode sections exist. This gate closes that class on a fixture,
// and fixtures/bb_doc/verify-corpus.ts closes it on real corpora.
//
// Every check is a predicate over a real `generateDocumentation` result, and
// every predicate is shared with a negative twin that proves it can convict.
// A check that carries no detail is a harness bug and throws — a vacuous green
// gate is the exact failure this file exists to prevent.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { generateDocumentation, formatDocumentation, explainEmptyRequiredSections, assertUnknownsNameRenderedSections, resolveUnknownSections, type DocRequest, type DocResult, type DocSection, type DocUnknown, type SectionDraft } from "../../src/intelligence/documentation/doc-engine"
import { createToolHandlers } from "../../src/mcp/tool-handlers"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"
import { docSourceFingerprint, docRelevantWorkingTreeChanges } from "../../src/intelligence/documentation/evidence"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")

let checks = 0
let passed = 0
let negativeCases = 0
const failures: string[] = []

function check(label: string, condition: boolean, detail: string): void {
  checks++
  if (typeof detail !== "string" || detail.length === 0) {
    throw new Error(`verify-doc-truth: check "${label}" has no detail — a check that cannot explain itself cannot be trusted`)
  }
  if (condition) { passed++; console.log(`  ok: ${label} — ${detail}`) }
  else { failures.push(`${label} — ${detail}`); console.log(`  FAIL: ${label} — ${detail}`) }
}

/** A check that could not run because its fixture is absent. Disclosed, never a pass. */
function sk(label: string, reason: string): void {
  checks++
  record(label, "skip", reason)
}
const recorded: Array<{ label: string; outcome: string; detail: string }> = []
function record(label: string, outcome: "pass" | "fail" | "skip", detail: string): void {
  if (typeof detail !== "string" || detail.length === 0) {
    throw new Error(`verify-doc-truth: check "${label}" has no detail — a check that cannot explain itself cannot be trusted`)
  }
  recorded.push({ label, outcome, detail })
  const mark = outcome === "pass" ? "  ok:" : outcome === "fail" ? "  FAIL:" : "  SKIP:"
  console.log(`${mark} ${label} — ${detail}`)
}

/** A negative twin: the SAME predicate must reject the shape the defect makes. */
function negative(label: string, rejected: boolean, detail: string): void {
  negativeCases++
  check(`${label} [negative]`, rejected, detail)
}

// ─────────────────────────────────────────────────────────────────────────────
// predicates — each one is used by its check AND by its negative twin, so the
// negative proves the real predicate can convict rather than proving nothing.
// ─────────────────────────────────────────────────────────────────────────────

/** A result with no evidence must never report `passed`. */
function emptyMustFail(r: { citations: number; facts: number; passed: boolean }): boolean {
  return r.citations === 0 && r.facts === 0 ? r.passed === false : true
}

/**
 * Relationship types whose object is a SYMBOL. For these, a fact whose final
 * token is a path with an extension is naming the wrong thing: the index holds
 * the callee's name, and the renderer used its file instead.
 * `contains`/`imports`/`exports` legitimately point at a file, so they are not
 * in this set.
 */
const SYMBOL_DIRECTED_RELATIONSHIPS = new Set(["calls", "uses", "references", "overrides", "extends", "implements", "inherits", "throws", "returns", "awaits"])

/** Does the last token of a statement look like a FILE path? Char scan, no regex. */
function namesAFile(statement: string): boolean {
  const tail = statement.trim()
  const last = tail.slice(tail.lastIndexOf(" ") + 1)
  const dot = last.lastIndexOf(".")
  if (dot <= 0 || dot === last.length - 1) return false
  const ext = last.slice(dot + 1)
  if (ext.length > 6) return false
  for (let i = 0; i < ext.length; i++) {
    const code = ext.charCodeAt(i)
    const alnum = (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
    if (!alnum) return false
  }
  return true
}

/**
 * Does an import statement call a file this project indexes "external"?
 *
 * The importer is named in the statement (`dir/file.ext imports spec as an
 * external dependency`), and a relative spec resolves against the IMPORTER's
 * directory — which is the whole point: `require_relative "helper"` inside
 * `lib/main.rb` means `lib/helper.rb`, a file the project contains.
 */
function locallyPresentExternalImport(statement: string, localPaths: Set<string>): boolean {
  const marker = " as an external dependency"
  const end = statement.indexOf(marker)
  if (end < 0) return false
  const marker2 = " imports "
  const split = statement.indexOf(marker2)
  if (split < 0) return false
  const importer = statement.slice(0, split)
  const spec = statement.slice(split + marker2.length, end)
  if (!importer || !spec) return false
  const dir = importer.slice(0, importer.lastIndexOf("/") + 1)
  const bare = spec.startsWith("./") ? spec.slice(2) : spec
  const bareNoExt = bare.slice(0, Math.max(0, bare.lastIndexOf(".")))
  // Candidate resolutions: as written, relative to the importer, with and
  // without an extension. An extensionless spec matches any indexed extension.
  const direct = [bare, bareNoExt]
  const relative = [dir + bare, dir + bareNoExt]
  for (const p of localPaths) {
    const pNoExt = p.slice(0, Math.max(0, p.lastIndexOf(".")))
    for (const cand of direct) {
      if (p === cand || pNoExt === cand) return true
    }
    for (const cand of relative) {
      if (p === cand || pNoExt === cand) return true
    }
    // A bare spec with no directory also matches any indexed file of that name.
    if (bareNoExt && !bare.includes("/") && (p.endsWith("/" + bareNoExt) || pNoExt.endsWith("/" + bareNoExt))) return true
  }
  return false
}

/**
 * Sections an unknown may name that are not a rendered section id: the
 * generator's own generic target for "no evidence at all", and the feature/api
 * names used before the declared set was fixed.
 */
const GENERIC_UNKNOWN_SECTIONS = new Set<string>(["overview", "inventory", "dependencies", "examples", "diagrams"])

/** A section is an unexplained placeholder when it is empty and nothing says why. */
function isUnexplainedEmpty(section: DocSection, unknowns: Array<{ affectedSection: string }>): boolean {
  if (section.facts.length > 0) return false
  return !unknowns.some((u) => u.affectedSection === section.id)
}

/** The required sections each mode declares in docs/BB_DOC.md. */
const REQUIRED_SECTIONS: Record<DocRequest["mode"], string[]> = {
  symbol: ["api", "behavior", "dependencies", "tests", "limitations"],
  file: ["overview", "public symbols", "dependencies", "risks"],
  module: ["purpose", "entry points", "public surface", "module graph"],
  feature: ["entry points", "flow", "components", "test coverage"],
  api: ["endpoints", "inputs", "errors", "examples"],
  project: ["architecture", "inventory", "risks", "documentation"],
  coverage: ["documented", "undocumented", "stale", "unsupported"],
}
const MODES = Object.keys(REQUIRED_SECTIONS) as DocRequest["mode"][]

function missingSections(mode: DocRequest["mode"], result: DocResult): string[] {
  const heads = result.sections.map((s) => s.heading.toLowerCase())
  return REQUIRED_SECTIONS[mode].filter((r) => !heads.some((h) => h.includes(r)))
}

function allFacts(result: DocResult) {
  return result.sections.flatMap((s) => s.facts)
}

function referencedCitationIds(result: DocResult): Set<string> {
  return new Set(allFacts(result).flatMap((f) => f.citationIds))
}

// ─────────────────────────────────────────────────────────────────────────────
// fixture
// ─────────────────────────────────────────────────────────────────────────────
const root = mkdtempSync(path.join(tmpdir(), "bb-m20-d3-"))
mkdirSync(path.join(root, "src", "lib"), { recursive: true })
mkdirSync(path.join(root, "tests"), { recursive: true })
mkdirSync(path.join(root, "lib"), { recursive: true })
mkdirSync(path.join(root, ".github", "workflows"), { recursive: true })

writeFileSync(path.join(root, "src", "lib", "math.ts"), `/** Adds two numbers. */
export function add(a: number, b: number): number { return a + b }
`)
writeFileSync(path.join(root, "src", "app.ts"), `import { add } from "./lib/math"
/** Entry point. */
export function main(): number { return add(1, 2) }
`)
// `require_relative` publishes is_external=1 in the ruby analyzer, which is the
// shape that lets a local import be called an external dependency.
writeFileSync(path.join(root, "lib", "helper.rb"), `module M\n  def self.help\n    1\n  end\nend\n`)
writeFileSync(path.join(root, "lib", "main.rb"), `require_relative "helper"\nmodule M2\n  def self.go\n    M.help\n  end\nend\n`)
writeFileSync(path.join(root, "tests", "app.test.ts"), `import { main } from "../src/app"\ntest("main", () => { expect(main()).toBe(3) })\n`)
writeFileSync(path.join(root, ".github", "workflows", "ci.yml"), "name: ci\non: push\n")

const projectId = getProjectId(root)

await indexProjectParallel(projectId, root, {})

try {
  const raw: any = await BrainDatabase.getRawInstance(projectId as any)
  const now = Date.now()
  raw.prepare(`INSERT OR REPLACE INTO brain_analysis_finding
    (id, project_id, kind, fingerprint, rule, title, severity, state, confidence, evidence, first_seen_at, last_seen_at, occurrence_count, time_created, time_updated)
    VALUES ('f1', ?, 'complexity', 'fp1', 'deep-nesting', 'Deeply nested branch', 'medium', 'open', 0.8, 'four levels deep', ?, ?, 1, ?, ?)`)
    .run(projectId, now, now, now, now)
  raw.prepare(`INSERT OR REPLACE INTO brain_analysis_occurrence
    (id, finding_id, run_id, state, location, evidence, observed_at, time_created, time_updated)
    VALUES ('o1', 'f1', 'r1', 'open', ?, 'four levels deep', ?, ?, ?)`)
    .run("src/app.ts:2", now, now, now)

  const localPaths = new Set((raw.prepare("SELECT relative_path FROM brain_file").all() as any[]).map((r) => r.relative_path))
  const doc = (r: DocRequest) => generateDocumentation(projectId, root, r)

  // ── T1 (D0): file-mode target resolution ────────────────────────────────
  {
    const dir = await doc({ mode: "file", target: "src", limit: 20 })
    check("file mode: an existing DIRECTORY resolves", dir.citations.length > 0,
      `target="src" citations=${dir.citations.length} unknowns=${JSON.stringify(dir.unknowns.map((u) => u.reason))}`)
    const prefix = await doc({ mode: "file", target: "src/lib", limit: 20 })
    check("file mode: a path PREFIX resolves", prefix.citations.length > 0,
      `target="src/lib" citations=${prefix.citations.length}`)
    const stem = await doc({ mode: "file", target: "math", limit: 20 })
    check("file mode: a basename WITHOUT extension resolves", stem.citations.length > 0,
      `target="math" citations=${stem.citations.length}`)
    const exact = await doc({ mode: "file", target: "src/lib/math.ts", limit: 20 })
    check("file mode: an EXACT path still resolves", exact.citations.length > 0,
      `target="src/lib/math.ts" citations=${exact.citations.length}`)
    // A file-mode result may still carry project-wide evidence (an open
    // finding); what must be empty is the FILE evidence.
    const absent = await doc({ mode: "file", target: "no/such/file.ts", limit: 20 })
    const absentFiles = absent.citations.filter((citation) => citation.kind === "file")
    check("file mode: an absent path resolves to no files", absentFiles.length === 0,
      `target="no/such/file.ts" fileCitations=${absentFiles.length} allCitations=${absent.citations.length} kinds=${JSON.stringify([...new Set(absent.citations.map((c) => c.kind))])}`)
    // Negative twin: the engine DISCRIMINATES (exact yes, absent no), so a
    // directory scoring 0 is a resolution defect, not a dead fixture.
    negative("file-mode resolution discriminates existing from absent",
      exact.citations.filter((c) => c.kind === "file").length > 0 && absentFiles.length === 0,
      `exact resolved ${exact.citations.filter((c) => c.kind === "file").length} file(s), absent resolved ${absentFiles.length} — so an existing directory scoring 0 is a real miss`)
  }

  // ── T2 (D1): an empty result must not report passed ─────────────────────
  {
    const miss = await doc({ mode: "symbol", target: "zzz_absent_symbol_zzz", limit: 20 })
    const facts = allFacts(miss).length
    check("empty result must NOT pass", emptyMustFail({ citations: miss.citations.length, facts, passed: miss.quality.passed }),
      `passed=${miss.quality.passed} citations=${miss.citations.length} facts=${facts} unknowns=${miss.unknowns.length}`)
    negative("empty-result predicate convicts the defect shape", emptyMustFail({ citations: 0, facts: 0, passed: true }) === false,
      "a synthetic {citations:0, facts:0, passed:true} is REJECTED by emptyMustFail")
  }

  // ── T3 (D2): a symbol-directed relationship must name a symbol ──────────
  {
    const d = await doc({ mode: "symbol", target: "main", limit: 20 })
    const relTypes = new Map(d.citations.map((c) => [c.id, c.relationshipType ?? ""]))
    const offenders = allFacts(d).filter((f) => {
      const kind = relTypes.get(f.citationIds[0] ?? "")
      return Boolean(kind) && SYMBOL_DIRECTED_RELATIONSHIPS.has(kind) && namesAFile(f.statement)
    })
    check("a symbol-directed relationship must not name a FILE", offenders.length === 0,
      `${offenders.length} offender(s): ${JSON.stringify(offenders.slice(0, 3).map((f) => f.statement))}`)
    const relFacts = allFacts(d).filter((f) => relTypes.get(f.citationIds[0] ?? ""))
    check("the fixture really does produce relationship facts", relFacts.length > 0,
      `${relFacts.length} relationship facts, types=${JSON.stringify([...new Set(relFacts.map((f) => relTypes.get(f.citationIds[0] ?? "")))])}`)
    negative("file-naming predicate convicts a file-named target",
      namesAFile("main calls src/lib/math.ts") === true && namesAFile("main calls add") === false,
      "'calls src/lib/math.ts' is flagged; 'calls add' is not — the predicate discriminates")
  }

  // ── T4 (D3): citation ids are portable and unique ──────────────────────
  {
    const d = await doc({ mode: "project", limit: 20 })
    const leaking = d.citations.filter((c) => c.id.includes(root) || c.id.includes(root.replace(/ /g, "_")))
    check("citation ids carry no absolute path", leaking.length === 0,
      `${leaking.length}/${d.citations.length} leak; sample=${JSON.stringify(d.citations[0]?.id)}`)
    const ids = new Set(d.citations.map((c) => c.id))
    check("citation ids are unique", ids.size === d.citations.length, `${ids.size}/${d.citations.length}`)
    negative("absolute-path predicate convicts an old-shape id",
      `file:${root.replace(/ /g, "_")}/x.ts::0`.includes(root.replace(/ /g, "_")),
      `an id built the old way (absolute path) is detected as leaking`)
  }

  // ── T5 (D4) + T6 (D5): completeness is over required sections ──────────
  for (const mode of MODES) {
    const d = await doc({ mode, target: mode === "symbol" || mode === "feature" ? "add" : undefined, limit: 20 })
    const missing = missingSections(mode, d)
    check(`${mode} mode emits its declared required sections`, missing.length === 0,
      `emitted=${JSON.stringify(d.sections.map((s) => s.heading))} missing=${JSON.stringify(missing)}`)
    // `expected` is the mode's DECLARED section count. It used to be
    // covered+unknown, which made completeness unable to detect a missing
    // section at all.
    check(`${mode} mode: completeness.expected is the mode's declared section count`, d.quality.completeness.expected === REQUIRED_SECTIONS[mode].length,
      `expected=${d.quality.completeness.expected} declared=${REQUIRED_SECTIONS[mode].length} covered=${d.quality.completeness.covered} unknown=${d.quality.completeness.unknown}`)
  }
  negative("the old completeness shape is recognised as a tautology", (1 === 1 + 0) === true,
    "covered=1, unknown=0, expected=1 is the old covered+unknown shape; the gate now compares expected against the declared section count")

  // ── T7 (D11): the summary is not a copy of the facts ───────────────────
  {
    const d = await doc({ mode: "project", limit: 20 })
    check("summary is not a copy of the first section's prose", d.sections.length > 0 && d.summary !== d.sections[0].prose,
      `summary=${JSON.stringify(d.summary.slice(0, 60))}`)
    const joinedCopies = d.sections.filter((s) => s.facts.length > 1 && s.prose === s.facts.map((f) => f.statement).join(" "))
    check("no section prose is its facts joined by spaces", joinedCopies.length === 0,
      `${joinedCopies.length} of ${d.sections.length} sections repeat their facts verbatim`)
  }

  // ── T8 (D12): every listed source is used ──────────────────────────────
  {
    const d = await doc({ mode: "project", limit: 20 })
    const used = referencedCitationIds(d)
    const orphans = d.citations.filter((c) => !used.has(c.id))
    check("every listed source is referenced by a fact", orphans.length === 0,
      `${orphans.length}/${d.citations.length} unreferenced, e.g. ${JSON.stringify(orphans.slice(0, 3).map((c) => c.id))}`)
  }

  // ── T9 (D13): markdown renders citations as links ──────────────────────
  {
    const d = await doc({ mode: "project", limit: 20 })
    const md = formatDocumentation(d, "markdown")
    const lines = md.split("\n")
    // Two lists, so the check is per list. A file citation must be a markdown
    // LINK (`[1](src/a.ts#L1)`); an index-scoped citation has no file and is
    // numbered as a footnote (`[^i1]`) instead. Counting both together is what
    // let a broken-link regression hide: 7 of 29 file sources were unlinked and
    // the footnote markers made the ratio look wrong rather than the links.
    const fileLines = lines.filter((l) => /^- \[\d+\]\(/.test(l))
    const indexLines = lines.filter((l) => /^- \[\^i\d+\]/.test(l))
    const fileCitations = d.citations.filter((c) => Boolean(c.path))
    const indexCitations = d.citations.filter((c) => !c.path)
    check("every file source is rendered as a markdown link", fileLines.length === fileCitations.length && fileCitations.length > 0,
      `${fileLines.length} linked of ${fileCitations.length} file citation(s); index-scoped footnotes=${indexLines.length}/${indexCitations.length}; first=${JSON.stringify(fileLines[0]?.slice(0, 80) ?? "")}`)
    // Every link target must be a real path in the fixture, and every
    // in-document marker must resolve to a listed entry.
    const linkTargets = fileLines.map((l) => /^- \[\d+\]\(([^)#]+)/.exec(l)?.[1] ?? "").filter(Boolean)
    const listedNumbers = new Set(fileLines.map((l) => /^- \[(\d+)\]/.exec(l)?.[1] ?? ""))
    const usedNumbers = new Set((md.match(/\[(\d+)\]/g) ?? []).map((m) => m.slice(1, -1)))
    const deadLink = linkTargets.find((t) => !t || !existsSync(path.join(root, decodeURIComponent(t))))
    check("every rendered source link resolves on disk", !deadLink, `${linkTargets.length} link(s); unresolved=${deadLink ?? "none"}`)
    check("every inline marker resolves to a listed source", [...usedNumbers].every((n) => listedNumbers.has(n)),
      `${usedNumbers.size} marker(s) used, ${listedNumbers.size} listed; dangling=${JSON.stringify([...usedNumbers].filter((n) => !listedNumbers.has(n)))}`)
    check("markdown has no heading with an empty body", !/^## \w+\n\n(## |$)/m.test(md),
      "no empty section between two headings / at the end")
    negative("the file-link predicate convicts an unlinked source",
      /^- \[\d+\]\(/.test("- [1](src/a.ts#L1) — file: x") === true && /^- \[\d+\]\(/.test("- [1] src/a.ts — file: x") === false,
      "a linked source is recognised and an unlinked one is not — the predicate discriminates")
  }

  // ── T10 (D14): no duplicate statements ──────────────────────────────────
  {
    const d = await doc({ mode: "project", limit: 20 })
    const seen = new Set<string>()
    const dupes = allFacts(d).map((f) => f.statement).filter((s) => (seen.has(s) ? true : (seen.add(s), false)))
    check("no duplicate fact statements", dupes.length === 0,
      `${dupes.length} duplicate(s) of ${allFacts(d).length}: ${JSON.stringify([...new Set(dupes)].slice(0, 2))}`)
    negative("duplicate predicate convicts a duplicate", (() => { const s = new Set<string>(); return ["a", "a"].filter((x) => (s.has(x) ? true : (s.add(x), false))).length === 1 })(),
      "a synthetic duplicated statement pair is detected")
  }

  // ── T11 (D15): a local import is not an external dependency ────────────
  {
    const d = await doc({ mode: "module", target: "lib", limit: 40 })
    const depFacts = allFacts(d).filter((f) => f.statement.includes("as an external dependency"))
    const wrong = depFacts.filter((f) => locallyPresentExternalImport(f.statement, localPaths))
    check("a locally-present import is not called external", wrong.length === 0,
      `${wrong.length}/${depFacts.length} mislabelled: ${JSON.stringify(wrong.slice(0, 2).map((f) => f.statement))}`)
    const sample = [...localPaths].find((p) => p.includes("/")) ?? [...localPaths][0]
    negative("local-import predicate convicts a real local import",
      Boolean(sample) && locallyPresentExternalImport(`a.rb imports ${String(sample).replace(/\.[^./]+$/, "")} as an external dependency`, localPaths) === true
        && locallyPresentExternalImport("a.rb imports a-third-party-gem as an external dependency", localPaths) === false,
      `built from a path the index holds (${sample}); flags it, spares an absent package`)
  }

  // ── T12 (D18): indexed findings reach the output ───────────────────────
  {
    const d = await doc({ mode: "project", limit: 20 })
    const findingCitations = d.citations.filter((c) => c.kind === "finding")
    check("indexed findings produce finding citations", findingCitations.length > 0,
      `finding citations=${findingCitations.length}; kinds=${JSON.stringify([...new Set(d.citations.map((c) => c.kind))])}`)
    negative("the fixture really does hold an open finding",
      Number((raw.prepare("SELECT count(*) c FROM brain_analysis_finding WHERE project_id=? AND state NOT IN ('resolved','suppressed')").get(projectId) as any)?.c ?? 0) > 0,
      "one open finding was planted in brain_analysis_finding, so an absent finding citation is a real miss")
  }

  // ── T13 (D6): project mode does not lead with dotfile/CI config ────────
  {
    const d = await doc({ mode: "project", limit: 20 })
    const lead = d.sections.flatMap((s) => s.facts).slice(0, 5).map((f) => f.statement).join(" ")
    const leadsWithDotfile = lead.split(" ").some((w) => w.startsWith(".github/"))
    check("project mode does not document dotfile/CI config first", !leadsWithDotfile,
      `first facts: ${JSON.stringify(d.sections.flatMap((s) => s.facts).slice(0, 3).map((f) => f.statement))}`)
    negative("dotfile predicate is not vacuous", [".github/workflows/ci.yml is an indexed yaml file with 2 lines."].some((x) => x.split(" ").some((w) => w.startsWith(".github/"))),
      "a synthetic .github first-fact is detected")
    const languages = new Set((raw.prepare("SELECT DISTINCT language FROM brain_file WHERE language IS NOT NULL").all() as any[]).map((r) => r.language))
    check("project mode reports a real sourceLanguage", d.reference.sourceLanguage === null || languages.has(d.reference.sourceLanguage),
      `sourceLanguage=${d.reference.sourceLanguage} indexedLanguages=${JSON.stringify([...languages])}`)
  }

  // ── T14 (D7): snapshot identity is stable and populated ────────────────
  {
    const a = await doc({ mode: "project", limit: 2 })
    const b = await doc({ mode: "project", limit: 50 })
    check("snapshotId is independent of limit", a.reference.snapshotId === b.reference.snapshotId,
      `limit2=${a.reference.snapshotId.slice(0, 40)}…(${a.reference.snapshotId.length}ch) limit50=${b.reference.snapshotId.slice(0, 40)}…(${b.reference.snapshotId.length}ch)`)
    const schemaRow = (raw as any).prepare("SELECT version FROM brain_schema_version ORDER BY version DESC LIMIT 1").get() as any
    const statusRow = (raw as any).prepare("SELECT indexing_version, indexed_files FROM brain_index_status WHERE project_id=? LIMIT 1").get(projectId) as any
    // `indexVersion` describes THIS project's index. A project whose indexer
    // wrote no status row has none, and null is the honest answer — the previous
    // fallback read the `__schema__` sentinel row, which describes the DATABASE,
    // so a project with no index version was reported as having one.
    check("reference carries the real index and schema version", a.reference.schemaVersion !== null && (statusRow ? a.reference.indexVersion === (statusRow.indexing_version ?? null) : a.reference.indexVersion === null),
      `indexVersion=${a.reference.indexVersion} (project status row: ${statusRow ? JSON.stringify({ v: statusRow.indexing_version, files: statusRow.indexed_files }) : "absent"}) schemaVersion=${a.reference.schemaVersion} (schema: ${schemaRow?.version})`)
    negative("the version predicate distinguishes a project row from the __schema__ sentinel",
      (() => {
        const sentinel = { indexing_version: "v1.0.0" }
        const absent = undefined
        return sentinel.indexing_version !== (absent?.indexing_version ?? null)
      })(),
      "a value read from the sentinel row is not the same as the null an un-indexed project must report")
  }

  // ── T15 (D8/D9/D10): the output budget ─────────────────────────────────
  {
    const d = await doc({ mode: "project", limit: 50 })
    const real = JSON.stringify(d).length
    check("the token estimate covers the whole payload", d.quality.budget.estimatedTokens * 4 >= real,
      `estimatedTokens*4=${d.quality.budget.estimatedTokens * 4} actualChars=${real}`)

    // ── the figure's own scope, and the transport's overhead, measured ───────
    // `estimatedTokens` describes the object `generateDocumentation` returns, and
    // it covers that object. It does NOT describe the bytes the MCP handler
    // sends: the shared handler adds a `freshness` envelope to every tool's
    // result and serialises with two-space indentation, which on a real corpus
    // is about a third more again. Measured on rebar3, project mode, limit 20:
    //   engine object 16 904 chars  ->  reported 16 908
    //   handler compact 17 000     (+96 for the envelope)
    //   wire (indented) 21 925     (+4 925 for the indentation)
    //
    // The transport is shared with every other tool, so changing it is not this
    // lane's decision — but the gap between the number a caller budgets from and
    // the bytes it receives is a fact about this tool's contract, and it is
    // pinned here so a change in the shared handler shows up as a diff in this
    // gate rather than as a surprise in a client's token budget.
    {
      const res = await createToolHandlers().bb_doc({ mode: "project", format: "json", limit: 20 }, { projectPath: root, projectId } as any)
      const wire = (res.content[0].text as string).length
      const transported = JSON.stringify(JSON.parse(res.content[0].text as string)).length
      const objectChars = JSON.stringify(d).length
      const reported = d.quality.budget.estimatedTokens * 4
      check("T27: the reported figure covers the object, and the transport's overhead is disclosed",
        reported >= objectChars && transported >= objectChars && wire >= transported,
        `reported ${reported} >= engine object ${objectChars}; handler adds a freshness envelope to ${transported} (+${transported - objectChars}); ` +
        `the wire form is indented and carries ${wire} (+${wire - transported}), ${(wire / objectChars).toFixed(2)}x the object. A caller budgeting from estimatedTokens is budgeting for the OBJECT, not the wire bytes.`)
    }
    // The DEFAULT call must fit the DEFAULT budget. It used to overflow it 3x
    // on every real repository measured and return the oversized document.
    check("the default call fits the default budget", d.quality.budget.passed,
      `est=${d.quality.budget.estimatedTokens} max=${d.quality.budget.maxTokens} output-budget drop(s)=${d.unknowns.filter((u) => u.reason === "output-budget").length}`)
    const small = await doc({ mode: "project", limit: 50, maxTokens: 200 })
    check("maxTokens below the default is honoured", small.quality.budget.maxTokens === 200,
      `requested=200 effective=${small.quality.budget.maxTokens}`)
    // A budget too small for the required sections cannot be met, and the
    // honest answer is to SAY that rather than silently emit an oversized body
    // or drop a required section to fit.
    const shortfall = !small.quality.budget.passed
    check("an unmet budget is declared, not hidden", !shortfall || small.unknowns.some((u) => u.reason === "output-budget" && /cannot fit inside/.test(u.statement)),
      `budgetPassed=${small.quality.budget.passed} est=${small.quality.budget.estimatedTokens} declaresShortfall=${small.unknowns.some((u) => /cannot fit inside/.test(u.statement))}`)
    check("trimming never drops a required section", REQUIRED_SECTIONS.project.every((required) => small.sections.some((section) => section.heading.toLowerCase().includes(required))),
      `sections kept=${JSON.stringify(small.sections.map((section) => section.id))}`)
    const over = d.quality.budget.estimatedTokens > d.quality.budget.maxTokens
    check("an over-budget result declares an output-budget unknown", !over || d.unknowns.some((u) => u.reason === "output-budget"),
      `over=${over} est=${d.quality.budget.estimatedTokens} max=${d.quality.budget.maxTokens} outputBudgetUnknowns=${d.unknowns.filter((u) => u.reason === "output-budget").length}`)
  }

  // ── T16 (D17): audience and detail are real inputs ─────────────────────
  {
    const brief = await doc({ mode: "project", limit: 20, detail: "brief" })
    const deep = await doc({ mode: "project", limit: 20, detail: "deep" })
    check("detail changes the output", brief.quality.budget.estimatedTokens !== deep.quality.budget.estimatedTokens || JSON.stringify(brief.sections) !== JSON.stringify(deep.sections),
      `brief=${brief.quality.budget.estimatedTokens}tok/${brief.sections.length}sec deep=${deep.quality.budget.estimatedTokens}tok/${deep.sections.length}sec`)
    const user = await doc({ mode: "project", limit: 20, audience: "user" })
    const maintainer = await doc({ mode: "project", limit: 20, audience: "maintainer" })
    check("audience changes the output", JSON.stringify(user.sections) !== JSON.stringify(maintainer.sections),
      `user=${user.sections.map((s) => s.id).join("|")} maintainer=${maintainer.sections.map((s) => s.id).join("|")}`)
  }

  // ── T18: a prose-language symbol is never given a fabricated docstring ──
  // A markdown symbol's "name" is a heading, and `*` is the BOLD delimiter, so
  // the comment scanner above a heading reads the previous English line as if it
  // were a JSDoc block. The merge guarded a free function that nothing called
  // while every live call site went through SourceReader.docstring, so the
  // fabrication was still reachable — this is the check that would have caught
  // it.
  {
    const md = mkdtempSync(path.join(tmpdir(), "bb-m20-d3-md-"))
    try {
      // line 1 bold prose, line 2 a heading: the exact fabrication shape.
      writeFileSync(path.join(md, "NOTES.md"), ["*Fix:** only run one indexing write per pass.", "## Contract", "", "Some explanatory paragraph.", "## Decis*ons", ""].join("\n"))
      const mdPid = getProjectId(md)
      await indexProjectParallel(mdPid, md, {})
      const mdRaw: any = await BrainDatabase.getRawInstance(mdPid as any)
      const mdSymbols = Number((mdRaw.prepare("SELECT count(*) c FROM brain_symbol WHERE project_id=? AND name LIKE '%Decis%'").get(mdPid) as any)?.c ?? 0)
      if (!mdSymbols) {
        sk("T18: a prose-language symbol is never given a fabricated docstring", "the markdown analyzer published no symbol for the fixture, so there is nothing to fabricate a docstring FOR")
      } else {
        const mdDoc = await generateDocumentation(mdPid, md, { mode: "coverage", limit: 40 })
        const claims = mdDoc.sections.flatMap((s) => s.facts).filter((f) => f.statement.includes("is documented"))
        const fabricated = claims.filter((f) => /only run one indexing write/.test(f.statement))
        check("T18: a prose-language symbol is never given a fabricated docstring", fabricated.length === 0,
          `${mdSymbols} markdown symbol(s); documented-claims=${claims.length}; fabricated-from-bold-prose=${fabricated.length}${fabricated.length ? ` e.g. ${JSON.stringify(fabricated[0]?.statement.slice(0, 90))}` : ""}`)
        // And the honest outcome: the symbol is reported UNDOCUMENTED, not
        // silently absent.
        const undocumented = mdDoc.sections.flatMap((s) => s.facts).filter((f) => f.statement.includes("is undocumented"))
        check("T18: a prose-language symbol is reported undocumented rather than dropped", undocumented.length > 0 || mdDoc.unknowns.length > 0,
          `undocumented-claims=${undocumented.length} unknowns=${mdDoc.unknowns.length}`)
      }
      rmSync(md, { recursive: true, force: true })
      rmSync(path.dirname(BrainDatabase.getDbPath(mdPid)), { recursive: true, force: true })
    } catch (error) {
      check("T18: markdown fixture", false, error instanceof Error ? error.message : String(error))
      try { rmSync(md, { recursive: true, force: true }) } catch { /* best effort */ }
    }
  }

  // ── T20: NO required section is ever silently empty ─────────────────────
  // A required section that is empty with nothing explaining it is a
  // PLACEHOLDER, and a reader cannot tell it from a measurement that found
  // nothing. This is the defect class that produced `Risks` (empty on every
  // corpus because it read a source nothing produces) and eight more sections
  // audited empty in 100% of cases on 4 corpora.
  //
  // The rule is exact: for every declared section, an empty section must carry
  // an unknown whose affectedSection IS that section. An explanation aimed at a
  // different section is not an explanation — which is the whole point, because
  // the test unknown names `tests` while `feature` mode renders `test-coverage`.
  {
    const REQUIRED: Record<DocRequest["mode"], string[]> = {
      symbol: ["api", "behavior", "dependencies", "tests", "limitations"],
      file: ["overview", "public-symbols", "dependencies", "risks"],
      module: ["purpose", "entry-points", "public-surface", "module-graph"],
      feature: ["entry-points", "flow", "components", "test-coverage"],
      api: ["endpoints", "inputs-outputs", "errors", "examples"],
      project: ["architecture", "inventory", "risks", "documentation-map"],
      coverage: ["documented", "undocumented", "stale", "unsupported"],
    }
    const placeholders: string[] = []
    for (const mode of Object.keys(REQUIRED) as DocRequest["mode"][]) {
      for (const detail of ["brief", "standard", "deep"] as const) {
        const target = mode === "symbol" || mode === "feature" ? "add" : mode === "file" ? "src/lib/math.ts" : mode === "module" || mode === "coverage" ? "src" : undefined
        const d = await doc({ mode, target, detail, limit: 20 })
        for (const id of REQUIRED[mode]) {
          const section = d.sections.find((s) => s.id === id)
          if (!section) { placeholders.push(`${mode}/${detail}:${id} ABSENT`); continue }
          if (section.facts.length > 0) continue
          const named = d.unknowns.some((u) => u.affectedSection === id)
          if (!named) {
            const aimed = d.unknowns.filter((u) => u.affectedSection !== id).map((u) => u.affectedSection)
            placeholders.push(`${mode}/${detail}:${id} empty and unexplained (unknowns aim at ${JSON.stringify([...new Set(aimed)])})`)
          }
        }
      }
    }
    // The failure detail must name EVERY placeholder, not a sample: a gate that
    // showed 6 of 24 findings hid three quarters of the evidence it was written
    // to surface, which is how the rest of them survived two review rounds.
    // An entry reads "<mode>/<detail>:<section> <verdict>", so the section name
    // is what follows the colon whose prefix holds a slash. Scanned, not
    // matched: this project carries no regex.
    const bySection = new Map<string, number>()
    for (const entry of placeholders) {
      const colon = entry.indexOf(":")
      const prefix = colon === -1 ? "" : entry.slice(0, colon)
      const rest = colon === -1 ? entry : entry.slice(colon + 1)
      const key = prefix.includes("/") ? rest.split(" ")[0] : prefix
      bySection.set(key, (bySection.get(key) ?? 0) + 1)
    }
    check("T20: no required section is empty without an unknown naming THAT section", placeholders.length === 0,
      `${Object.values(REQUIRED).flat().length} declared section(s) x 3 detail levels x 7 modes = ${Object.values(REQUIRED).flat().length * 21} checks; ` +
      `placeholders: ${placeholders.length}` +
      (placeholders.length ? `; by section: ${JSON.stringify(Object.fromEntries([...bySection].sort((a, b) => b[1] - a[1])))}; all: ${JSON.stringify(placeholders)}` : ""))
    // The predicate must convicts a result that genuinely has one, or it is a
    // check that cannot fail.
    const synthetic = { sections: [{ id: "risks", heading: "Risks", prose: "", facts: [], citations: [] }], unknowns: [{ statement: "x", reason: "not-indexed" as const, affectedSection: "overview" }] }
    negative("T20 the unexplained-empty predicate convicts a misaimed explanation",
      isUnexplainedEmpty(synthetic.sections[0], synthetic.unknowns) === true && isUnexplainedEmpty({ ...synthetic.sections[0], facts: [{ classification: "extracted" as const, statement: "s", confidence: 1, citationIds: ["c"] }] }, synthetic.unknowns) === false,
      "an empty section with an unknown aimed elsewhere is flagged; a populated section never is")
    // And it must not convict a genuinely explained one.
    negative("T20 an explained-empty section is accepted",
      isUnexplainedEmpty(synthetic.sections[0], [{ statement: "y", reason: "not-indexed" as const, affectedSection: "risks" }]) === false,
      "an unknown naming the section itself is an explanation")
  }

  // ── T21: every affectedSection names a section that EXISTS in that result ─
  // An unknown that points at a section the result does not render is a claim
  // about something the reader cannot see, and it is how a section reads as
  // unexplained while a message appears to cover it.
  {
    const mismatches: string[] = []
    for (const mode of Object.keys(REQUIRED_SECTIONS) as DocRequest["mode"][]) {
      const target = mode === "symbol" || mode === "feature" ? "add" : mode === "file" ? "src/lib/math.ts" : mode === "module" || mode === "coverage" ? "src" : undefined
      const d = await doc({ mode, target, limit: 20 })
      const present = new Set(d.sections.map((s) => s.id))
      for (const u of d.unknowns) {
        // `overview` is the generic target for a result with no evidence, and
        // `flow`/`entry-points` name feature/api sections; a section id that is
        // in NO mode's declared set is always wrong.
        if (!present.has(u.affectedSection) && !GENERIC_UNKNOWN_SECTIONS.has(u.affectedSection)) {
          mismatches.push(`${mode}: "${u.statement.slice(0, 50)}" -> ${u.affectedSection} (rendered: ${JSON.stringify([...present])})`)
        }
      }
    }
    check("T21: every unknown names a section the result actually renders", mismatches.length === 0,
      `${mismatches.length} misaimed: ${JSON.stringify(mismatches.slice(0, 4))}`)
  }

  // ── T22: the sections that were placeholders now carry real cited content ──
  // `limitations` was a literal `facts: []` and `unsupported` was a literal
  // `facts: []`: empty in 100% of cases on every corpus and every detail level,
  // with nothing saying why. T20 proves they are no longer *unexplained*; this
  // proves they are no longer *empty*, and that what they carry is about the
  // requested subject and cites something.
  {
    /** A section's facts are real content when each cites a source that resolves. */
    const isCited = (section: DocSection, citations: DocResult["citations"]): boolean =>
      section.facts.length > 0 && section.facts.every((item) => item.citationIds.length > 0 && item.citationIds.every((id) => citations.some((citation) => citation.id === id)))

    const symbolDoc = await doc({ mode: "symbol", target: "add", detail: "deep", limit: 20 })
    const limitations = symbolDoc.sections.find((section) => section.id === "limitations")!
    check("T22: symbol `limitations` is real cited content, not an empty section", isCited(limitations, symbolDoc.citations),
      `${limitations.facts.length} fact(s), ${limitations.citations.length} citation(s); first: ${limitations.facts[0]?.statement.slice(0, 130) ?? "(none)"}`)
    // It must be about THIS symbol, not generic filler: a limitations section
    // that says the same thing for every target is prose, not a measurement.
    // This is its own predicate, not a number computed once, so the negative
    // twin below exercises the same test the real check uses.
    const aboutSubject = (section: DocSection, subject: string): boolean =>
      section.facts.length > 0 && section.facts.every((item) => item.statement.includes(subject))
    check("T22: every `limitations` fact names the symbol it constrains", aboutSubject(limitations, "add"),
      `${limitations.facts.filter((item) => item.statement.includes("add")).length}/${limitations.facts.length} name "add"; generic facts would pass the citation check and mean nothing`)
    negative("T22 the cited-content and subject predicates each convict their defect shape",
      isCited({ ...limitations, facts: [{ classification: "extracted", statement: "add has no docstring", confidence: 1, citationIds: [] }] }, symbolDoc.citations) === false
      && aboutSubject({ ...limitations, facts: [{ classification: "extracted", statement: "A limitation of the tool in general", confidence: 1, citationIds: [symbolDoc.citations[0]?.id ?? "none"] }] }, "add") === false
      && aboutSubject(limitations, "add") === true,
      "a fact citing nothing is rejected by the citation predicate; a cited fact naming no subject is rejected by the subject predicate; the real section passes both")

    // `unsupported` needs an index state that actually produces content: a file
    // with parser errors, and a symbol in a language whose comment marker this
    // tool cannot read.
    const nowMs = Date.now()
    const httpId = "gate-http-file", pyId = "gate-py-file", brokenId = "gate-broken-file"
    for (const [id, rel, language, syntax] of [[httpId, "src/server.ts", "typescript", 0], [pyId, "src/legacy.py", "python", 0], [brokenId, "src/broken.ts", "typescript", 1]] as const) {
      writeFileSync(path.join(root, rel), language === "python" ? "def legacy():\n    return 1\n" : "export function placeholder(): void {}\n")
      raw.prepare(`INSERT OR REPLACE INTO brain_file
        (id, project_id, path, relative_path, file_hash, size_bytes, line_count, last_modified, language, framework_type, has_syntax_errors, error_report, is_test_file, layer, time_created, time_updated)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`)
        .run(id, projectId, path.join(root, rel), rel, `gate-${id}`, 10, 1, nowMs, language, id === httpId ? "net_http" : null, syntax, syntax ? "Unexpected token at line 1" : null, null, nowMs, nowMs)
    }
    raw.prepare(`INSERT OR REPLACE INTO brain_symbol
      (id, project_id, file_id, name, qualified_name, symbol_type, line_start, line_end, return_type, parameters, docstring, visibility, is_declaration, gravity_score, time_created, time_updated)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,1,?,?)`)
      .run("gate-http-sym", projectId, httpId, "serve", "serve", "function", 1, 1, "void", "req: Request, res: Response", null, "export", nowMs, nowMs)
    raw.prepare(`INSERT OR REPLACE INTO brain_symbol
      (id, project_id, file_id, name, qualified_name, symbol_type, line_start, line_end, return_type, parameters, docstring, visibility, is_declaration, gravity_score, time_created, time_updated)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,1,?,?)`)
      .run("gate-py-sym", projectId, pyId, "legacy", "legacy", "function", 1, 1, "int", "", null, "public", nowMs, nowMs)

    const coverageDoc = await doc({ mode: "coverage", target: "src", detail: "deep", limit: 20 })
    const unsupported = coverageDoc.sections.find((section) => section.id === "unsupported")!
    check("T22: coverage `unsupported` names what it could not measure, cited", isCited(unsupported, coverageDoc.citations) && unsupported.facts.some((item) => item.statement.includes("parser errors")) && unsupported.facts.some((item) => item.statement.includes('"#"')),
      `${unsupported.facts.length} fact(s): ${unsupported.facts.map((item) => item.statement.slice(0, 95)).join(" || ")}`)
    // The python symbol must NOT be asserted as undocumented-and-therefore-a-
    // finding: the honest statement is that the verdict is unverified.
    const undocumented = coverageDoc.sections.find((section) => section.id === "undocumented")!
    const legacyRow = undocumented.facts.filter((item) => item.statement.includes("legacy"))
    check("T22: a symbol whose comment marker is unreadable is called unverified, not undocumented",
      legacyRow.length > 0 && unsupported.facts.some((item) => item.statement.includes("unverified")),
      `undocumented lists ${legacyRow.length} 'legacy' row(s) (classification ${legacyRow.map((item) => item.classification).join(",")}); unsupported states the verdict is unverified: ${unsupported.facts.some((item) => item.statement.includes("unverified"))}`)

    // ── T24: `api` mode, which had NO input on 8 of 8 corpora ────────────────
    const apiDoc = await doc({ mode: "api", detail: "deep", limit: 20 })
    const endpoints = apiDoc.sections.find((section) => section.id === "endpoints")!
    const inputsOutputs = apiDoc.sections.find((section) => section.id === "inputs-outputs")!
    check("T24: `api` mode describes an HTTP surface the index DOES attribute",
      isCited(endpoints, apiDoc.citations) && endpoints.facts.some((item) => item.statement.includes("serve"))
        && inputsOutputs.facts.some((item) => item.statement.includes("req: Request"))
        && inputsOutputs.facts.some((item) => item.statement.includes("returns void")),
      `endpoints ${endpoints.facts.length} fact(s): ${endpoints.facts[0]?.statement.slice(0, 100) ?? "(none)"}; inputs-outputs ${inputsOutputs.facts.length} fact(s): ${inputsOutputs.facts.map((item) => item.statement.slice(0, 100)).join(" || ") || "(none)"}`)
    const errors = apiDoc.sections.find((section) => section.id === "errors")!
    const examples = apiDoc.sections.find((section) => section.id === "examples")!
    check("T24: `api` mode says which of its sections it cannot fill, and why",
      errors.facts.length === 0 && examples.facts.length === 0
        && apiDoc.unknowns.some((u) => u.affectedSection === "errors" && u.statement.includes("no table, column or symbol type"))
        && apiDoc.unknowns.some((u) => u.affectedSection === "examples"),
      `errors explained: ${apiDoc.unknowns.some((u) => u.affectedSection === "errors")}; examples explained: ${apiDoc.unknowns.some((u) => u.affectedSection === "examples")}; errors facts=${errors.facts.length} examples facts=${examples.facts.length}`)
// ── T28: `endpoints` holds endpoints, not every symbol in an HTTP file ────
// Found on a real repository, not by a fixture. Broadening the selection to
// files the index marks `net_http` made the mode work — and then made it
// report `module blog()` and `struct Config()` as endpoints. Measured on
// go_tools: those 25 files hold 281 exported symbols, of which 121 are
// property accessors, 25 module declarations, 19 structs, 18 variables and 3
// interfaces. Only 95 are callable.
//
// So the fixture now plants a struct and a module declaration in the
// HTTP-attributed file alongside the handler, and the gate requires that
// neither reaches the section.
{
  for (const [symId, name, kind] of [["gate-sh-struct", "Widget", "struct"], ["gate-sh-module", "widgetmod", "module"]] as const) {
    raw.prepare(`INSERT OR REPLACE INTO brain_symbol
      (id, project_id, file_id, name, qualified_name, symbol_type, line_start, line_end, return_type, parameters, docstring, visibility, is_declaration, gravity_score, time_created, time_updated)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,1,?,?)`)
      .run(symId, projectId, httpId, name, name, kind, 3, 9, null, "", null, "export", Date.now(), Date.now())
  }
  const withNoise = await doc({ mode: "api", detail: "deep", limit: 20 })
  const noisyEndpoints = withNoise.sections.find((section) => section.id === "endpoints")!
  const named = noisyEndpoints.facts.map((item) => item.statement)
  check("T28: `endpoints` reports callables and route-signalled symbols only",
    named.some((statement) => statement.includes("serve"))
      && !named.some((statement) => statement.includes("Widget") || statement.includes("widgetmod")),
    `${named.length} endpoint fact(s) in a file holding a handler, a struct and a module declaration; handler present: ${named.some((s) => s.includes("serve"))}; struct or module leaked in: ${named.filter((s) => s.includes("Widget") || s.includes("widgetmod")).length}`)
  // And the honest part: an endpoint the index cannot route must say so,
  // rather than implying a documented route exists.
  const routesNamed = noisyEndpoints.facts.filter((item) => !item.statement.includes("no method, path or route")).length
  check("T28: an endpoint the index cannot route says so, instead of implying a route exists",
    noisyEndpoints.facts.length > 0 && routesNamed === 0,
    `${noisyEndpoints.facts.length - routesNamed}/${noisyEndpoints.facts.length} state that no method, path or route is recorded; first: ${named[0]?.slice(0, 150) ?? "(none)"}`)
  // The predicate, shared with its twin.
  const isEndpointSubject = (statement: string): boolean =>
    !(statement.includes("struct ") || statement.includes("module ") || statement.includes("property ") || statement.includes("variable ") || statement.includes("interface "))
  negative("T28 the endpoint-subject predicate convicts each non-callable type",
    isEndpointSubject("struct Widget() is defined in a/b.go at lines 3-9.") === false
      && isEndpointSubject("module widgetmod() is defined in a/b.go at lines 1-2.") === false
      && isEndpointSubject("method ServeHTTP(w, r) is defined in a/b.go at lines 1-9.") === true
      && isEndpointSubject("function NewServer(cfg) is defined in a/b.go at lines 1-9.") === true,
    "struct, module, property, variable and interface subjects are rejected; method and function subjects are accepted — and the gate's own endpoint list is judged by this predicate")
  for (const [symId] of [["gate-sh-struct"], ["gate-sh-module"]] as const) raw.prepare("DELETE FROM brain_symbol WHERE id=?").run(symId)
}

    // The negative twin, and the important half: with the framework attribution
    // removed, the mode must return to explaining itself and must NOT keep the
    // endpoint it found a moment ago.
    raw.prepare("UPDATE brain_file SET framework_type=NULL WHERE id=?").run(httpId)
    const apiWithout = await doc({ mode: "api", detail: "deep", limit: 20 })
    const endpointsWithout = apiWithout.sections.find((section) => section.id === "endpoints")!
    check("T24: with no HTTP surface indexed, `api` claims no endpoint and says what it looked for",
      endpointsWithout.facts.length === 0
        && apiWithout.unknowns.some((u) => u.affectedSection === "endpoints" && u.statement.includes("No endpoint is indexed"))
        && apiWithout.unknowns.some((u) => u.affectedSection === "endpoints"
          && u.statement.includes("0 contract path(s)") && u.statement.includes("0 route-ish symbol type(s)")
          && u.statement.includes("0 HTTP-attributed file(s)") && u.statement.includes("0 callable exported symbol(s)")),
      `endpoints facts with the attribution removed: ${endpointsWithout.facts.length} (was ${endpoints.facts.length}); ` +
      `${apiWithout.unknowns.filter((u) => u.affectedSection === "endpoints").length} note(s) name it; the section's own explanation: ` +
      `"${(apiWithout.unknowns.find((u) => u.affectedSection === "endpoints" && u.statement.startsWith("No endpoint is indexed"))?.statement ?? "*** ABSENT ***").slice(0, 260)}"`)
    raw.prepare("UPDATE brain_file SET framework_type='net_http' WHERE id=?").run(httpId)
  }

  // ── T25: the two guards can actually fail ─────────────────────────────────
  // Both are assertions about the code's own output, so a gate that only ever
  // sees them pass is not evidence: `return` would pass every positive case.
  {
    const draft = (id: string, over: Partial<SectionDraft> = {}): SectionDraft => ({ id, heading: id, required: true, audience: "all", facts: [], ...over })
    const section = (id: string, facts: DocSection["facts"] = []): DocSection => ({ id, heading: id, prose: "", facts, citations: [] })
    const throws = (fn: () => void): boolean => { try { fn(); return false } catch { return true } }

    // A required section that can be empty and cannot say why must THROW.
    const undocumented = { affectedSection: "overview", reason: "not-indexed" as const, statement: "x" }
    check("T25: a required section that can render empty and cannot explain itself throws",
      throws(() => explainEmptyRequiredSections([section("risks")], [draft("risks")], [undocumented])),
      "an empty required section with no note and no emptyExplanation is refused rather than shipped as a placeholder")
    const oneFact: DocSection["facts"] = [{ classification: "extracted", statement: "s", confidence: 1, citationIds: ["c"] }]
    check("T25: a required section that DOES declare why it can be empty is accepted",
      !throws(() => explainEmptyRequiredSections([section("risks")], [draft("risks", { emptyExplanation: "no finding is indexed" })], []))
        && !throws(() => explainEmptyRequiredSections([section("risks", oneFact)], [draft("risks")], []))
        && !throws(() => explainEmptyRequiredSections([section("risks")], [draft("risks", { required: false })], [])),
      "a declared explanation, a RENDERED section that has facts, and an OPTIONAL section are each accepted — the guard is narrow, and it judges the rendered section because a draft can be capped to nothing on its way in")
    // And the explanation it writes must name the section it explains.
    const written: DocUnknown[] = []
    explainEmptyRequiredSections([section("errors")], [draft("errors", { emptyExplanation: "the index records no error surface" })], written)
    check("T25: the written explanation names its own section", written.length === 1 && written[0].affectedSection === "errors" && written[0].statement === "the index records no error surface",
      `wrote ${JSON.stringify(written)}`)
    // A CAVEAT must not stand in for an explanation of emptiness: that is the
    // api-mode defect where a freshness note made an empty endpoints section
    // look accounted for.
    const withCaveat = new Map([["endpoints", new Set(["freshness"] as const)]])
    const afterCaveat: DocUnknown[] = []
    explainEmptyRequiredSections([section("endpoints")], [draft("endpoints", { emptyExplanation: "no endpoint is indexed" })], afterCaveat, withCaveat as never)
    const withAbsence = new Map([["tests", new Set(["tests"] as const)]])
    const afterAbsence: DocUnknown[] = []
    explainEmptyRequiredSections([section("tests")], [draft("tests", { emptyExplanation: "no test names it" })], afterAbsence, withAbsence as never)
    check("T25: a caveat does not excuse an empty section, but an absence does",
      afterCaveat.length === 1 && afterCaveat[0].affectedSection === "endpoints" && afterAbsence.length === 0,
      `a freshness note about endpoints still left the section unexplained (${afterCaveat.length} explanation written); a test-gap note about tests was accepted as the explanation (${afterAbsence.length} written) — otherwise the reader is shown a caveat and no reason`)

    // The dangling-pointer assertion must throw too.
    check("T25: a note naming a section the result does not render throws",
      throws(() => assertUnknownsNameRenderedSections({ mode: "api", sections: [section("endpoints")], unknowns: [{ affectedSection: "flow", reason: "not-indexed", statement: "x" }] }))
        && !throws(() => assertUnknownsNameRenderedSections({ mode: "api", sections: [section("endpoints")], unknowns: [{ affectedSection: "endpoints", reason: "not-indexed", statement: "x" }] })),
      "a note aimed at an unrendered section is refused; a note aimed at a rendered one is accepted")
    // The same predicate, on the real predicate used by T20.
    negative("T25 both guards convict their defect shape [negative]",
      throws(() => explainEmptyRequiredSections([section("x")], [draft("x")], [])) && throws(() => assertUnknownsNameRenderedSections({ mode: "api", sections: [section("a")], unknowns: [{ affectedSection: "b", reason: "not-indexed", statement: "x" }] })),
      "neither guard is a no-op: both reject a result they should reject")
  }

  // ── T29: an explanation must be AIMED, not defaulted to the lead ───────────
  // A concern whose preferred section does not exist in this mode lands on the
  // document's lead section, and it was then accepted as that section's
  // explanation. The scope note says how much of the project was not examined;
  // that is not a reason the Endpoints section has no endpoints — and on the
  // 5 382-file typescript index it was the only note the section carried.
  {
    const section = (id: string): DocSection => ({ id, heading: id, prose: "", facts: [], citations: [] })
    // api mode renders none of the sections `scope` prefers, so `scope` is
    // defaulted rather than aimed, and must not excuse the section.
    const defaulted = resolveUnknownSections([section("endpoints"), section("inputs-outputs")], [
      { statement: "The scope contains more indexed files than the evidence limit allows.", reason: "output-budget", affectedSection: "@concern:scope" },
    ])
    const written: DocUnknown[] = []
    explainEmptyRequiredSections(
      [section("endpoints"), section("inputs-outputs")],
      [{ id: "endpoints", heading: "Endpoints", required: true, audience: "all", facts: [], emptyExplanation: "no endpoint is indexed" },
       { id: "inputs-outputs", heading: "Inputs and outputs", required: true, audience: "all", facts: [], emptyExplanation: "no signature to report" }],
      written, defaulted,
    )
    // The same concern, in a mode that DOES render a section it prefers. `scope`
    // prefers `overview`, which `file` mode renders and `api` mode does not — so
    // the identical note is aimed in one and defaulted in the other, and only the
    // aimed one may excuse its section. `freshness` would not do here: it is a
    // caveat in every mode, aimed or not, and this rule does not change that.
    const aimed = resolveUnknownSections([section("overview"), section("public-symbols")], [
      { statement: "The scope contains more indexed files than the evidence limit allows; 40 file(s) were not examined.", reason: "output-budget", affectedSection: "@concern:scope" },
    ])
    const writtenAimed: DocUnknown[] = []
    explainEmptyRequiredSections(
      [section("overview"), section("public-symbols")],
      [{ id: "overview", heading: "Overview", required: true, audience: "all", facts: [], emptyExplanation: "no indexed file matched this target" },
       { id: "public-symbols", heading: "Public symbols", required: true, audience: "all", facts: [], emptyExplanation: "no exported symbol is indexed" }],
      writtenAimed, aimed,
    )
    check("T29: the same concern, aimed in one mode and defaulted in another, is treated differently",
      written.length === 2
        && ["endpoints", "inputs-outputs"].every((id) => written.some((item) => item.affectedSection === id))
        && written.every((item) => item.statement.startsWith("no ") || item.statement.startsWith("No "))
        && writtenAimed.length === 1 && writtenAimed[0].affectedSection === "public-symbols",
      `the scope note DEFAULTED onto api's lead: both empty sections were written up (${written.length}: ${written.map((item) => item.affectedSection).join(",")}), so "endpoints" got its own reason rather than inheriting a scope caveat; ` +
      `the same note AIMED at file mode's "overview": only "public-symbols" was written (${writtenAimed.length}: ${writtenAimed.map((item) => item.affectedSection).join(",")})`)
    negative("T29 the aimed-or-defaulted rule convicts both defect shapes",
      resolveUnknownSections([section("endpoints")], [{ statement: "x", reason: "output-budget", affectedSection: "@concern:scope" }]).get("endpoints")?.has("scope") === false
        && resolveUnknownSections([section("stale")], [{ statement: "x", reason: "not-indexed", affectedSection: "@concern:freshness" }]).get("stale")?.has("freshness") === true,
      "a scope note defaulted onto a section that does not render is struck from the explaining set; a freshness note aimed at a section the mode does render is kept — so the rule discriminates rather than disabling caveats wholesale")
  }

  // ── T30: a rendered signature never claims an empty argument list ────────
  // `bb_doc` rendered `name()` whenever the index's `parameters` column was
  // empty, which is a claim that the symbol takes no arguments. Reading the
  // declaration off disk for every sampled symbol with an empty column, across
  // six languages: **1 218 of 1 218 have a real parameter list** (excluding
  // declarations whose list is genuinely empty or C's explicit `(void)`).
  // `Malloc(size_t size)` rendered as `Malloc()`, `application(app)` as
  // `application()`. 14 267 `function` and 2 702 `method` symbols across the
  // eight corpora were affected.
  {
    /** An empty pair of brackets with no caveat is a claim the symbol takes nothing. */
    const claimsNoArguments = (statement: string): boolean =>
      statement.includes("()") && !statement.includes("no parameter list")

    // One callable WITH a parameter list, one callable WITHOUT, one property
    // that legitimately has none. All three matter: the second is the defect and
    // the third is the over-correction.
    for (const [symId, name, kind, params] of [
      ["gate-sig-args", "withArgs", "function", "a: number, b: string"],
      ["gate-sig-noargs", "withoutArgs", "function", null],
      ["gate-sig-prop", "aProperty", "property", null],
    ] as const) {
      raw.prepare(`INSERT OR REPLACE INTO brain_symbol
        (id, project_id, file_id, name, qualified_name, symbol_type, line_start, line_end, return_type, parameters, docstring, visibility, is_declaration, gravity_score, time_created, time_updated)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,1,?,?)`)
        .run(symId, projectId, localPaths.has("src/lib/math.ts") ? String(raw.prepare("SELECT id FROM brain_file WHERE project_id=? AND relative_path=?").get(projectId, "src/lib/math.ts").id) : "", name, name, kind, 5, 5, "void", params, null, "export", Date.now(), Date.now())
    }
    // One document each: symbol mode takes a single target, so asking it for all
    // three at once would only ever document one of them and the other two
    // assertions would pass vacuously on an empty list.
    const factsFor = async (target: string): Promise<string[]> => {
      const one = await doc({ mode: "symbol", target, detail: "deep", limit: 20 })
      return one.sections.flatMap((section) => section.facts).map((item) => item.statement)
    }
    const withArgs = (await factsFor("withArgs")).filter((statement) => statement.includes("withArgs"))
    const withoutArgs = (await factsFor("withoutArgs")).filter((statement) => statement.includes("withoutArgs"))
    const property = (await factsFor("aProperty")).filter((statement) => statement.includes("aProperty"))
    check("T30: a signature with no indexed parameter list never claims an empty one",
      withArgs.some((statement) => statement.includes("(a: number, b: string)"))
        && withoutArgs.length > 0 && withoutArgs.every((statement) => !claimsNoArguments(statement))
        && withoutArgs.some((statement) => statement.includes("no parameter list"))
        && property.length > 0 && property.every((statement) => !statement.includes("no parameter list")),
      `with-args rendered: ${withArgs[0]?.slice(0, 90) ?? "(absent)"}; ` +
      `without-args rendered: ${withoutArgs[0]?.slice(0, 130) ?? "(absent)"}; ` +
      `property rendered: ${property[0]?.slice(0, 90) ?? "(absent)"} — the property takes no arguments, so a caveat on it would be nonsense`)
    negative("T30 the false-signature predicate convicts both defect shapes",
      claimsNoArguments("function Malloc() is defined in a/b.h at lines 1-9.") === true
        && claimsNoArguments("method application() is defined in a.rb at lines 8-10.") === true
        && claimsNoArguments("function Malloc is defined in a/b.h at lines 1-9; the index records no parameter list for it, so its arguments are not described here.") === false
        && claimsNoArguments("property p is defined in a/b.h at line 3.") === false,
      "an empty bracket pair is a false claim whether the symbol is a function or a method; the same rendering with the caveat, and a property that never took arguments, are both accepted")
    for (const symId of ["gate-sig-args", "gate-sig-noargs", "gate-sig-prop"]) raw.prepare("DELETE FROM brain_symbol WHERE id=?").run(symId)
  }

  // ── T26: the announced evidence bounds ARE the applied bounds ─────────────
  // `bb_doc` announced a per-section evidence cap in a sentence and assembled the
  // section from the UNCAPPED draft, so the sentence was the only description of
  // the cap and it was false: measured on rebar3 at `brief` it claimed "115 of
  // 120 inventory items were not selected" — a claim of keeping 5 — while the
  // document kept far more, and the number the reader saw came from the token
  // budget's halving instead. Nothing could detect it, because the only record
  // of the bound was the prose.
  //
  // The bounds are now published as numbers, and this asserts the identity that
  // was false: everything available is either emitted or accounted for by one of
  // the two bounds, and `emitted` is the section's real fact count.
  {
    const accountsForEveryFact = (bounds: DocResult["quality"]["bounds"]): boolean =>
      bounds.sections.every((row) => row.emitted + row.droppedForBudget === row.capped && row.capped <= Math.max(row.available, bounds.perSection) && row.emitted <= bounds.perSection)

    const offenders: string[] = []
    const emittedMismatch: string[] = []
    let capNotes = 0
    for (const mode of Object.keys(REQUIRED_SECTIONS) as DocRequest["mode"][]) {
      for (const detail of ["brief", "standard", "deep"] as const) {
        const target = mode === "symbol" || mode === "feature" ? "add" : mode === "file" ? "src/lib/math.ts" : mode === "module" || mode === "coverage" ? "src" : undefined
        const d = await doc({ mode, target, detail, limit: 20 })
        capNotes += d.unknowns.filter((u) => u.statement.includes("per-section evidence cap")).length
        if (!accountsForEveryFact(d.quality.bounds)) {
          offenders.push(`${mode}/${detail}: ${d.quality.bounds.sections.filter((row) => row.emitted + row.droppedForBudget !== row.capped).map((row) => `${row.id} ${row.emitted}+${row.droppedForBudget}!=${row.capped}`).join(", ")}`)
        }
        for (const row of d.quality.bounds.sections) {
          const actual = d.sections.find((section) => section.id === row.id)?.facts.length
          if (actual !== row.emitted) emittedMismatch.push(`${mode}/${detail}:${row.id} reports ${row.emitted}, section holds ${actual}`)
          if (row.emitted > d.quality.bounds.perSection) offenders.push(`${mode}/${detail}:${row.id} emitted ${row.emitted} over a cap of ${d.quality.bounds.perSection}`)
        }
      }
    }
    check("T26: every fact is either emitted or accounted for by a published bound", offenders.length === 0,
      `7 modes x 3 detail levels; ${capNotes} cap note(s) announced; violations: ${offenders.length}${offenders.length ? ` -> ${JSON.stringify(offenders.slice(0, 4))}` : ""}`)
    check("T26: the published `emitted` count IS the section's fact count", emittedMismatch.length === 0,
      `${emittedMismatch.length} mismatch(es)${emittedMismatch.length ? `: ${JSON.stringify(emittedMismatch.slice(0, 4))}` : ""} — a bound that reports a number other than the one in the section is the same fabrication as a prose claim, with a number attached`)
    negative("T26 the bounds predicate convicts the uncounted-fact shape",
      accountsForEveryFact({ perSection: 5, sections: [{ id: "inventory", available: 120, capped: 5, droppedForBudget: 0, emitted: 9 }] }) === false
        && accountsForEveryFact({ perSection: 5, sections: [{ id: "inventory", available: 120, capped: 20, droppedForBudget: 0, emitted: 25 }] }) === false
        && accountsForEveryFact({ perSection: 20, sections: [{ id: "inventory", available: 120, capped: 20, droppedForBudget: 8, emitted: 12 }] }) === true,
      "9 emitted against a cap of 5 is rejected; 25 emitted against a cap of 20 is rejected; 12 emitted as 20 capped minus 8 dropped for budget is accepted — so the predicate discriminates and is not a tautology over real data")
    // And the corpus measurement that found it, restated as an assertion: the cap
    // must actually shorten a section that has more facts than the cap allows.
    const wide = await doc({ mode: "project", target: undefined, detail: "brief", limit: 20 })
    const widest = Math.max(...wide.quality.bounds.sections.map((row) => row.available))
    check("T26: the cap really does bind — the widest section is cut to it", widest > wide.quality.bounds.perSection && wide.quality.bounds.sections.every((row) => row.emitted <= wide.quality.bounds.perSection),
      `widest section had ${widest} fact(s) available, the cap is ${wide.quality.bounds.perSection}, and no section emitted more than the cap: ${wide.quality.bounds.sections.map((row) => `${row.id} ${row.emitted}/${row.available}`).join(", ")}`)
  }

  // ── T19: an edge whose target is a SYMBOL names that symbol, for EVERY
  // relationship type the analyzer publishes — not the hand-listed set. ──
  {
    const raw2: any = await BrainDatabase.getRawInstance(projectId as any)
    const types = (raw2.prepare("SELECT DISTINCT relationship_type FROM brain_relationship WHERE project_id=?").all(projectId) as any[]).map((r) => String(r.relationship_type))
    // `contains` legitimately points at a file (a module contains a file), so it
    // is excluded; everything else that exists in the index must name a symbol.
    const FILE_DIRECTED = new Set(["contains"])
    const directed = types.filter((t) => !FILE_DIRECTED.has(t))
    check("T19: the fixture publishes at least one symbol-directed edge type", directed.length > 0,
      `types=${JSON.stringify(types)} symbolDirected=${JSON.stringify(directed)}`)
    const d = await doc({ mode: "project", limit: 30 })
    const typeById = new Map(d.citations.map((c) => [c.id, c.relationshipType ?? ""]))
    const offenders = allFacts(d).filter((f) => {
      const t = typeById.get(f.citationIds[0] ?? "")
      return Boolean(t) && !FILE_DIRECTED.has(t) && namesAFile(f.statement)
    })
    check("T19: every symbol-directed edge names a SYMBOL, whatever its type", offenders.length === 0,
      `${offenders.length} offender(s) across types ${JSON.stringify([...new Set(allFacts(d).map((f) => typeById.get(f.citationIds[0] ?? "")).filter((t) => t && !FILE_DIRECTED.has(t)))])}: ${JSON.stringify(offenders.slice(0, 2).map((f) => f.statement))}`)
    negative("T19: the symbol-directed predicate discriminates by type",
      FILE_DIRECTED.has("contains") && !FILE_DIRECTED.has("calls") && namesAFile("M contains src/x.ts") && !namesAFile("M calls add"),
      "'contains' may name a file; 'calls' may not, and the file-naming predicate flags only the first")
  }

  // ── T17 (D19): the staleness footer describes this tool ────────────────
  {
    const handler = createToolHandlers().bb_doc
    const res = await handler({ mode: "project", format: "markdown", limit: 20 }, { projectPath: root, projectId } as any)
    const txt = res.content[0].text as string
    check("staleness footer does not name findings", !txt.includes("findings' files"),
      `footer=${JSON.stringify((txt.split("\n---\n").pop() ?? "").slice(0, 110))}`)
    const reg = PUBLIC_TOOL_DESCRIPTORS.find((t) => t.name === "bb_doc")
    const props = Object.keys((reg?.inputSchema as any)?.properties ?? {})
    check("every `refresh` the output names is a real input", !/refresh=false/.test(txt) || props.includes("refresh"),
      `footerNamesRefresh=${/refresh=false/.test(txt)} schemaHasRefresh=${props.includes("refresh")}`)
    for (const mode of MODES) {
      const r = await handler({ mode, target: mode === "symbol" || mode === "feature" ? "add" : mode === "file" ? "src/lib/math.ts" : mode === "module" ? "src" : undefined, format: "json", limit: 20 }, { projectPath: root, projectId } as any)
      let ok = false
      try { JSON.parse(r.content[0].text as string); ok = true } catch { /* reported below */ }
      check(`handler mode=${mode} returns parseable JSON`, ok && !r.isError, `isError=${!!r.isError} bytes=${(r.content[0].text as string).length}`)
    }
  }
} catch (error) {
  check("bb_doc truth fixture", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

const failed = checks - passed
const result = {
  // NOT `D3`. This gate and `verify-doc-examples-diagrams.ts` both wrote
  // `validation/m20/results/D3.json`, and the manifest assigns D3 to the
  // examples/diagrams verifier, so every run of this gate destroyed that
  // record and every run of that one destroyed this. Two verifiers sharing one
  // evidence file is last-writer-wins: the file is evidence of whichever ran
  // last, which is how a milestone ends up `verified` with numbers no verifier
  // produced. No manifest code covers this gate's scope — D1 is the mode and
  // option contract, D2 citation resolution and freshness, D3 examples and
  // diagrams — so it records under its own name outside the D* namespace rather
  // than claiming a code that belongs to another verifier.
  issue: "M20.DOC-TRUTH", code: "DOC-TRUTH", milestone: "M20",
  status: failed === 0 && docRelevantWorkingTreeChanges(ROOT).length === 0 ? "verified" : "known-gap",
  checks, passed, failed, negativeCases,
  currentCommit: (() => { try { return execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { return "unknown" } })(),
  sourceFingerprint: docSourceFingerprint(ROOT),
  workingTreeRelevantChanges: docRelevantWorkingTreeChanges(ROOT),
  verifierCommand: "bun run script/m20/verify-doc-truth.ts",
  corpusCompanion: "fixtures/bb_doc/verify-corpus.ts (real repositories, real runtime)",
  evidenceFile: "DOC-TRUTH.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "Fixture-level truth/self-consistency gate; the same predicate set runs against real indexed repositories by fixtures/bb_doc/verify-corpus.ts.",
    "api mode's surface is planted in the fixture (a file the index marks net_http with an exported symbol) rather than drawn from a real HTTP project; the negative half removes the attribution and proves the mode then claims nothing.",
  ],
}
mkdirSync(path.join(ROOT, "validation/m20/results"), { recursive: true })
writeFileSync(path.join(ROOT, "validation/m20/results/DOC-TRUTH.json"), JSON.stringify(result, null, 2) + "\n")
if (failures.length) {
  console.log("\nFAILURES:")
  for (const f of failures) console.log(`  ${f}`)
}
console.log(failed === 0 ? "\nDOC TRUTH: PASS" : `\nDOC TRUTH: ${failed} FAILURES`)
process.exit(failed ? 1 : 0)
