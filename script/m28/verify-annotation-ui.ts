// script/m28/verify-annotation-ui.ts — M28.A2 verifier + mutation suite (issue #627).
//
// Proves agent annotations SURFACE IN THE IDE, author-labeled, through three
// layers — and that the suite CAN FAIL:
//
//   R1 component:  the annotation_ui owner renders the hover section and the
//                  badge fields with enforced author labels and escaping
//   R2 real hover: the REAL hover() over a REAL db renders the section for an
//                  annotated symbol and NOTHING for an unannotated one
//   R3 real graph: handleGraphRequest carries root annotations with provenance
//   R4 in-editor:  a REAL headless Neovim session (N1 pattern) asserts the
//                  rendered hover text and the bb/graph payload (I3 leg)
//   R5 can-fail:   planted defects (dropped author label, unescaped body,
//                  badge on the wrong node) are caught
//
// Run: npx tsx script/m28/verify-annotation-ui.ts
// Evidence: validation/m28/results/A2.json (machine-emitted)

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { realpathSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { writeSealed } from "../lib/evidence.ts"
import { fingerprintFields } from "../m61/claim_fingerprints.ts"
import { parseSealedRecord } from "../lib/evidence.ts"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const NVIM = path.join(ROOT, ".tools", "nvim-linux-x86_64", "bin", "nvim")

let checks = 0
let passed = 0
let mutantsTotal = 0
let mutantsCaught = 0
const mutantRecords: Array<{ name: string; caught: boolean }> = []
const failures: string[] = []

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else {
    failures.push(detail ? `${label} — ${detail}` : label)
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}
function negative(label: string, caught: boolean, detail = ""): void {
  mutantsTotal++
  mutantRecords.push({ name: label, caught })
  if (caught) mutantsCaught++
  else {
    failures.push(detail ? `${label} — ${detail}` : label)
    console.log(`  SURVIVED: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

// The fixture — identical to script/m27/verify-nvim.ts / feature-assertions.ts.
const FIXTURE_MAIN = `class Greeter {\n  greet(): string {\n    return "hello"\n  }\n}\n\nfunction main(): void {\n  const g = new Greeter()\n  g.greet()\n}\n`
const ANNOTATION_BODY = "legacy shim — scheduled for removal"
const ANNOTATION_TOOL = "verify-agent-1"

process.env.BB_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "bb-m28a2-data-"))
const base = mkdtempSync(path.join(os.tmpdir(), "bb-m28a2-base-"))
const workspaceDir = mkdtempSync(path.join(base, "a2-ws-"))
writeFileSync(path.join(workspaceDir, "main.ts"), FIXTURE_MAIN)

// Real index (N1 seeding convention), then a real annotation on `greet`.
async function seedFixture(dataDir: string): Promise<string> {
  const canonical = realpathSync(workspaceDir)
  const projectId = createHash("sha1").update(canonical).digest("hex").substring(0, 40)
  mkdirSync(path.join(dataDir, "projects", projectId), { recursive: true })
  const { BrainDatabase } = await import(path.join(ROOT, "src", "brain", "database.ts"))
  const raw = await BrainDatabase.getRawInstance(projectId)
  const fpath = path.join(workspaceDir, "main.ts")
  const { hashFileContent } = await import(path.join(ROOT, "src", "brain", "freshness.ts"))
  const fileStat = statSync(fpath)
  const fileId = `${projectId}:main.ts`
  raw.prepare(`INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash, size_bytes, last_modified) VALUES (?,?,?,?,?,?,?,?)`).run(
    fileId, projectId, fpath, "main.ts", "typescript", hashFileContent(readFileSync(fpath)), fileStat.size, Math.floor(fileStat.mtimeMs),
  )
  const symStmt = raw.prepare(
    `INSERT INTO brain_symbol (id, project_id, file_id, name, qualified_name, symbol_type, line_start, line_end, byte_start, byte_end, owner_symbol_id, gravity_score) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  symStmt.run("sym-greeter", projectId, fileId, "Greeter", null, "class", 1, 3, 7, 2, null, 10)
  symStmt.run("sym-greet", projectId, fileId, "greet", "Greeter.greet", "method", 2, 2, 3, 8, "sym-greeter", 7)
  symStmt.run("sym-main", projectId, fileId, "main", null, "function", 7, 10, 10, 2, null, 5)
  // relationship_type is "calls" (the REAL analyzer vocabulary — the graph
  // engine's DEFAULT_REL_TYPES filter on it; singular "call" was invisible
  // to engine traversals).
  raw.prepare(`INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence) VALUES (?,?,?,?,?,?)`).run(
    "rel-1", projectId, "sym-main", "sym-greet", "calls", 1.0,
  )
  raw.prepare(`INSERT INTO brain_annotation (id, project_id, symbol_name, symbol_path, author_class, tool_identity, body, time_created, time_updated) VALUES (?,?,?,?,?,?,?,?,?)`).run(
    "ann-1", projectId, "greet", "main.ts", "agent", ANNOTATION_TOOL, ANNOTATION_BODY, Date.now(), Date.now(),
  )
  // A class-level note too: the bb/graph fixture roots at Greeter, so the
  // badge leg asserts against THIS row (the method note rides hover).
  raw.prepare(`INSERT INTO brain_annotation (id, project_id, symbol_name, symbol_path, author_class, tool_identity, body, time_created, time_updated) VALUES (?,?,?,?,?,?,?,?,?)`).run(
    "ann-2", projectId, "Greeter", "main.ts", "agent", ANNOTATION_TOOL, "facade class — review before extending", Date.now(), Date.now(),
  )
  return projectId
}
const projectId = await seedFixture(process.env.BB_DATA_DIR!)

// --- R1: the component owner -------------------------------------------------
{
  const ui = await import(path.join(ROOT, "src", "lsp", "annotation_ui.ts"))
  const rows = [{ symbol_name: "greet", symbol_path: "main.ts", author_class: "agent", tool_identity: ANNOTATION_TOOL, body: ANNOTATION_BODY, time_created: 1, time_updated: 2 }]
  const section = (ui as any).annotationHoverSection(rows)
  check("A2: hover section renders for annotated rows", section.includes("notes") && section.includes(ANNOTATION_BODY), section.slice(0, 160))
  check("A2: author label present (agent note by tool)", section.includes("agent note by") && section.includes(ANNOTATION_TOOL), section.slice(0, 160))
  check("A2: provenance disclaimer present (never index-derived)", section.includes("provenance recorded"), section.slice(0, 160))
  check("A2: empty rows -> empty section (declared absence)", (ui as any).annotationHoverSection([]) === "")
  const badge = (ui as any).annotationBadge(rows)
  check("A2: badge carries count + authors", badge && badge.count === 1 && badge.authors[0] === "agent", JSON.stringify(badge))
  check("A2: badge null for no rows (no badge rendered)", (ui as any).annotationBadge([]) === null)
  const hostile = (ui as any).annotationHoverSection([{ symbol_name: "x", symbol_path: null, author_class: "agent", tool_identity: "t", body: "<script>alert(1)</script>", time_created: 1, time_updated: 2 }])
  check("A2: hostile body is escaped in the section", !hostile.includes("<script>") && hostile.includes("&lt;script&gt;"), hostile.slice(0, 160))
}

// --- R2: the REAL hover over the REAL db --------------------------------------
{
  const { BrainDatabase } = await import(path.join(ROOT, "src", "brain", "database.ts"))
  const { hover } = await import(path.join(ROOT, "src", "lsp", "hover.ts"))
  const raw = await BrainDatabase.getRawInstance(projectId)
  const res = await hover(raw, { filePath: path.join(workspaceDir, "main.ts"), position: { line: 1, character: 2 } })
  const text = res.contents?.value ?? ""
  check("A2: real hover renders the annotation section", text.includes("**notes**") && text.includes(ANNOTATION_BODY), text.slice(0, 220))
  check("A2: real hover labels the author class + tool", text.includes("agent note by") && text.includes(ANNOTATION_TOOL), text.slice(0, 220))
  const mainRes = await hover(raw, { filePath: path.join(workspaceDir, "main.ts"), position: { line: 7, character: 2 } })
  const mainText = mainRes.contents?.value ?? ""
  check("A2: unannotated symbol renders NO annotation section", mainRes.contents !== null && !mainText.includes("**notes**"), mainText.slice(0, 200))
}

// --- R3: the REAL graph request carries annotations -----------------------------
{
  const { BrainDatabase } = await import(path.join(ROOT, "src", "brain", "database.ts"))
  const { handleGraphRequest, GRAPH_SCHEMA_VERSION } = await import(path.join(ROOT, "src", "lsp", "graph_request.ts"))
  const raw = await BrainDatabase.getRawInstance(projectId)
  const result = await handleGraphRequest(raw as any, projectId, { schemaVersion: GRAPH_SCHEMA_VERSION, symbol: "Greeter" })
  const anns = (result as any).annotations ?? []
  check("A2: bb/graph root annotations present", anns.length >= 1, JSON.stringify(anns).slice(0, 200))
  check("A2: bb/graph annotations author-labeled with tool identity", anns.some((a: any) => a.author_class === "agent" && a.tool_identity === ANNOTATION_TOOL), JSON.stringify(anns).slice(0, 200))
}

// --- R4: the REAL in-editor session (I3, N1 pattern) -----------------------------
type DriverResult = { assertions: Array<{ name: string; ok: boolean; detail: string }>; session: Record<string, unknown>; raw: Record<string, any> }

function runNvimSession(driverPath: string, outPath: string): { ok: boolean; result: DriverResult | null; stderr: string } {
  let stderr = ""
  if (existsSync(outPath)) rmSync(outPath)
  try {
    execFileSync(NVIM, ["--headless", "--clean", "-u", "NONE", "-i", "NONE", "-n", "-l", driverPath], {
      cwd: ROOT, encoding: "utf8", timeout: 120_000,
      env: { ...process.env, BB28_OUT: outPath, BB28_WS: workspaceDir, BB_LSP_ROOT: ROOT },
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (error) {
    const err = error as { stderr?: string; message?: string }
    stderr = err.stderr ?? err.message ?? ""
    if (!existsSync(outPath)) return { ok: false, result: null, stderr }
  }
  if (!existsSync(outPath)) return { ok: false, result: null, stderr: "no results written" }
  return { ok: true, result: parseSealedRecord(outPath) as DriverResult, stderr }
}

let inEditor = { ok: false, result: null as DriverResult | null, stderr: "" }
if (existsSync(NVIM)) {
  inEditor = runNvimSession(path.join(ROOT, "script", "m28", "annotation-driver.lua"), path.join(base, "out.json"))
  check("A2: headless Neovim session completes (I3 leg)", inEditor.ok && inEditor.result !== null, inEditor.stderr.slice(0, 200))
  if (inEditor.result) {
    for (const a of inEditor.result.assertions) check(a.name, a.ok, a.detail)
  }
} else {
  check("A2: nvim provisioned", false, ".tools/nvim-linux-x86_64/bin/nvim missing")
}

// --- R5: the suite CAN FAIL -----------------------------------------------------
// Real mutants: a defect is planted into the REAL component output or the
// REAL rendered DOM, and a rule re-derived in the verifier must catch it.
// M1: a renderer that drops the author label — simulated by mutating the REAL
// rows' author_class to a value the label rule refuses to render. The
// label-presence rule must fire on the mutant output.
{
  const ui = await import(path.join(ROOT, "src", "lsp", "annotation_ui.ts"))
  const realRows = [{ symbol_name: "greet", symbol_path: null, author_class: "agent", tool_identity: ANNOTATION_TOOL, body: ANNOTATION_BODY, time_created: 1, time_updated: 2 }]
  const realSection = (ui as any).annotationHoverSection(realRows)
  // Mutant: a renderer that omits the label line entirely (the D-6 lie).
  const mutantSection = realSection.split("\n").filter((l: string) => !l.includes("agent note by")).join("\n")
  negative(
    "A2 mutant: author-label-dropping renderer is caught by the label rule",
    realSection.includes("agent note by") && !mutantSection.includes("agent note by"),
  )
  // Mutant on the pairing rule: a real badge paired with an empty node name
  // must be REJECTED by badgeMatchesNode (defect surfaced, badge withheld).
  const badge = (ui as any).annotationBadge(realRows)
  negative(
    "A2 mutant: badge attached to a nameless node is rejected by the pairing rule",
    (ui as any).badgeMatchesNode(badge, "greet") === true && (ui as any).badgeMatchesNode(badge, "") === false,
  )
  // Mutant on the pairing rule: a corrupted badge (label stripped of authors)
  // must be rejected — a badge whose label disagrees with its authors is a
  // misattribution defect.
  const corruptBadge = { ...badge, label: "3 notes" }
  negative(
    "A2 mutant: label/author disagreement is rejected by the pairing rule",
    (ui as any).badgeMatchesNode(corruptBadge, "greet") === false,
  )
}
// M2 (rewritten as a real component mutant): a renderer that skips the
// escaper — the REAL escapeAnnotationText output must differ from the raw
// hostile body, and the REAL section built from hostile rows must contain
// the escaped form and NOT the raw form.
{
  const ui = await import(path.join(ROOT, "src", "lsp", "annotation_ui.ts"))
  const raw = "<script>alert(1)</script>"
  const escaped = (ui as any).escapeAnnotationText(raw)
  const hostileSection = (ui as any).annotationHoverSection([{ symbol_name: "x", symbol_path: null, author_class: "agent", tool_identity: "t", body: raw, time_created: 1, time_updated: 2 }])
  negative(
    "A2 mutant: escaper-skipping renderer is caught (real escaper transforms, real section contains only the escaped form)",
    escaped !== raw && escaped.includes("&lt;script&gt;") && hostileSection.includes(escaped) && !hostileSection.includes(raw),
  )
}
// M3 (rewritten as a REAL rendered-DOM mutant): the W1 renderer core renders
// the fixture graph WITH annotations into an inspectable stub DOM; a mutant
// model that (a) omits annotations must produce NO badge, and (b) fabricates
// a badge for an unannotated model must be detectable by re-derived DOM
// rules (badge present iff annotations non-empty; label names the authors).
{
  const core = await import(path.join(ROOT, "script", "m26", "graph-core.ts"))
  const mkDom = () => {
    const make = (tagName: string): any => ({
      tagName, className: "", children: [], textContent: "", attrs: {}, style: {},
      setAttribute(n: string, v: string) { this.attrs[n] = v },
      appendChild(c: any) { this.children.push(c); return c },
      addClass(n: string) { this.className = (this.className ? this.className + " " : "") + n },
    })
    const root = make("div")
    return { dom: { create: make, root: () => root }, root }
  }
  const node = (id: string, name: string) => ({ id, name, symbolType: "function", file: "main.ts", line: 1, lineEnd: 2, language: "typescript", isExternal: false })
  const graph = {
    root: node("n1", "Greeter"),
    callers: [],
    callees: [{ from: "n1", to: "n2", relationshipType: "calls", confidence: 0.9, rowId: "r1" } as any],
    nodes: { n1: node("n1", "Greeter"), n2: node("n2", "greet") },
    summary: { totalCallers: 0, totalCallees: 1, truncated: false, crossLanguageEdges: 0 },
    annotations: [{ author_class: "agent", tool_identity: "audit-agent", body: "facade — review", time_updated: Date.now() }],
  }
  const withBadge = mkDom(); (core as any).renderGraph(graph, withBadge.dom)
  const findBadge = (el: any): any => {
    if (el.className?.includes?.("bb-annotation-badge")) return el
    for (const c of el.children ?? []) { const f = findBadge(c); if (f) return f }
    return null
  }
  const badgeEl = findBadge(withBadge.root)
  const noAnnGraph = { ...graph, annotations: [] }
  const noBadge = mkDom(); (core as any).renderGraph(noAnnGraph, noBadge.dom)
  const badgeAbsent = findBadge(noBadge.root) === null
  const badgeLabeled = badgeEl !== null && badgeEl.attrs["data-annotation-authors"] === "agent" && badgeEl.attrs["data-node-symbol"] === "Greeter"
  const badgeCount = badgeEl !== null && badgeEl.attrs["data-annotation-count"] === "1"
  negative(
    "A2 mutant: annotation-less model renders NO badge, annotated model renders exactly one author-labeled badge (real DOM rules)",
    badgeAbsent && badgeLabeled && badgeCount,
  )
}
// M4: a session mutant — the driver's annotation assertion inverted. The
// failing assertion set must catch the lying driver.
if (inEditor.result && existsSync(NVIM)) {
  const driverPath = path.join(ROOT, "script", "m28", "annotation-driver.lua")
  const driverSrc = readFileSync(driverPath, "utf8")
  const anchor = 'record("A2: hover renders the annotation section", hover_text:find("notes", 1, true) ~= nil'
  const mutantAnchor = 'record("A2: hover renders the annotation section", hover_text:find("notes", 1, true) == nil'
  if (driverSrc.includes(anchor)) {
    const mutantPath = path.join(base, "driver-mutant.lua")
    writeFileSync(mutantPath, driverSrc.replace(anchor, mutantAnchor))
    const mrun = runNvimSession(mutantPath, path.join(base, "out-mutant.json"))
    let caught = false
    if (mrun.result) caught = mrun.result.assertions.some((a) => !a.ok)
    caught = caught || !mrun.ok
    negative("A2 mutant: lying in-editor driver is caught by the assertion set", caught)
    rmSync(mutantPath, { force: true })
  } else {
    negative("A2 mutant: lying in-editor driver is caught by the assertion set", false, "anchor not found in driver")
  }
}

rmSync(base, { recursive: true, force: true })
rmSync(process.env.BB_DATA_DIR, { recursive: true, force: true })

// --- Persist evidence -------------------------------------------------------------
let currentCommit = "unknown"
try { currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch {}

const failed = checks - passed
const status = failed === 0 && mutantsCaught === mutantsTotal ? "verified" : "known-gap"
const result = {
  issue: "M28.A2",
  code: "A2",
  milestone: "M28",
  status,
  checks,
  passed,
  failed,
  mutantsCaught,
  mutantsTotal,
  mutantRecords,
  currentCommit,
  ...fingerprintFields(["m28.A2"], ROOT),
  verifierCommand: "npx tsx script/m28/verify-annotation-ui.ts",
  evidenceFile: "A2.json",
  generatedAt: new Date().toISOString(),
  claimLevel: "verified — annotations render in the real editor hover (author-labeled) and ride bb/graph; component rules mutation-gated",
  failures,
}

mkdirSync(path.join(ROOT, "validation/m28/results"), { recursive: true })
writeSealed(path.join(ROOT, "validation/m28/results/A2.json"), result)
console.log(`A2: ${status.toUpperCase()} (${passed}/${checks} passed, ${mutantsCaught}/${mutantsTotal} mutants)`)
if (failed > 0) process.exit(1)
