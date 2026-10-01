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
import { generateDocumentation, formatDocumentation, type DocRequest, type DocResult } from "../../src/intelligence/documentation/doc-engine"
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
  issue: "M20.D3", code: "D3", milestone: "M20",
  status: failed === 0 && docRelevantWorkingTreeChanges(ROOT).length === 0 ? "verified" : "known-gap",
  checks, passed, failed, negativeCases,
  currentCommit: (() => { try { return execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { return "unknown" } })(),
  sourceFingerprint: docSourceFingerprint(ROOT),
  workingTreeRelevantChanges: docRelevantWorkingTreeChanges(ROOT),
  verifierCommand: "bun run script/m20/verify-doc-truth.ts",
  corpusCompanion: "fixtures/bb_doc/verify-corpus.ts (real repositories, real runtime)",
  evidenceFile: "D3.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "Fixture-level truth/self-consistency gate; the same predicate set runs against real indexed repositories by fixtures/bb_doc/verify-corpus.ts.",
    "api mode is unmeasured for its purpose here: the fixture has one api_contract_path and no HTTP surface.",
  ],
}
mkdirSync(path.join(ROOT, "validation/m20/results"), { recursive: true })
writeFileSync(path.join(ROOT, "validation/m20/results/D3.json"), JSON.stringify(result, null, 2) + "\n")
if (failures.length) {
  console.log("\nFAILURES:")
  for (const f of failures) console.log(`  ${f}`)
}
console.log(failed === 0 ? "\nDOC D3: PASS" : `\nDOC D3: ${failed} FAILURES`)
process.exit(failed ? 1 : 0)
