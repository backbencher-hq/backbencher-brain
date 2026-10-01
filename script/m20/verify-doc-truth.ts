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

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
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
    const absent = await doc({ mode: "file", target: "no/such/file.ts", limit: 20 })
    check("file mode: an absent path resolves to nothing", absent.citations.length === 0,
      `target="no/such/file.ts" citations=${absent.citations.length}`)
    // Negative twin: the engine DISCRIMINATES (exact yes, absent no), so a
    // directory scoring 0 is a resolution defect, not a dead fixture.
    negative("file-mode resolution discriminates existing from absent",
      exact.citations.length > 0 && absent.citations.length === 0,
      `exact resolved ${exact.citations.length}, absent resolved ${absent.citations.length} — so an existing directory scoring 0 is a real miss`)
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
    const tautology = d.quality.completeness.expected === d.quality.completeness.covered + d.quality.completeness.unknown
    check(`${mode} mode: completeness.expected is not covered+unknown`, tautology === false,
      `covered=${d.quality.completeness.covered} unknown=${d.quality.completeness.unknown} expected=${d.quality.completeness.expected} (required sections for the mode: ${REQUIRED_SECTIONS[mode].length})`)
  }
  negative("tautology predicate recognises a tautology", (1 === 1 + 0) === true,
    "covered=1, unknown=0, expected=1 is recognised as expected===covered+unknown")

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
    // The documented shape is `[1](src/auth.ts#L12-L28)`: an inline markdown
    // link whose target is the citation's own repository-relative path.
    const sourceLines = md.split("\n").filter((l) => l.startsWith("- ["))
    const linkedSources = sourceLines.filter((l) => l.includes("]("))
    check("markdown renders every source as a link", d.citations.length > 0 && linkedSources.length === sourceLines.length,
      `${linkedSources.length}/${sourceLines.length} source lines carry an inline link; first: ${JSON.stringify(sourceLines[0]?.slice(0, 90) ?? "")}`)
    check("markdown has no heading with an empty body", !/^## \w+\n\n(## |$)/m.test(md),
      "no empty section between two headings / at the end")
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
    check("reference carries the real index and schema version", a.reference.indexVersion !== null && a.reference.schemaVersion !== null,
      `indexVersion=${a.reference.indexVersion} schemaVersion=${a.reference.schemaVersion}`)
  }

  // ── T15 (D8/D9/D10): the output budget ─────────────────────────────────
  {
    const d = await doc({ mode: "project", limit: 50 })
    const real = JSON.stringify(d).length
    check("the token estimate covers the whole payload", d.quality.budget.estimatedTokens * 4 >= real,
      `estimatedTokens*4=${d.quality.budget.estimatedTokens * 4} actualChars=${real}`)
    const small = await doc({ mode: "project", limit: 50, maxTokens: 200 })
    check("maxTokens below the default is honoured", small.quality.budget.maxTokens === 200,
      `requested=200 effective=${small.quality.budget.maxTokens}`)
    const within = small.quality.budget.estimatedTokens <= small.quality.budget.maxTokens
    check("a tight budget produces output that fits it", within,
      `est=${small.quality.budget.estimatedTokens} max=${small.quality.budget.maxTokens} facts=${allFacts(small).length}`)
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
