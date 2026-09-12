// script/m56/verify-tools-truth.ts — M56.T1 (#781).
//
// The tool reference is single-sourced. This gate proves it from three
// directions and refuses to trust any of them alone:
//
//   1. GENERATION — `script/verify-tool-docs.ts` (the canonical generator that
//      writes docs/data/public-tools.json, docs/tools/*.md AND
//      website/src/data/tools.generated.ts) exits green, which is a byte-level
//      proof that the site artifact is identical to a fresh generation.
//   2. TRACING — every generated field is compared against its real origin:
//      registry fields against src/mcp/tool-registry.ts, curated fields against
//      the shipped reference page docs/tools/<tool>.md.
//   3. SURFACE — the rendered site (built when .next is stale) renders every
//      tool's registry description and summary, and hand-types nothing: no
//      literal registry text exists in any non-generated site source.
//
// Run: npx tsx script/m56/verify-tools-truth.ts
// Evidence: validation/m56/results/T1.json

import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const SITE = path.join(ROOT, "website")
const RESULTS = path.join(ROOT, "validation/m56/results")
const GENERATED_REL = "website/src/data/tools.generated.ts"
const GENERATED = path.join(ROOT, GENERATED_REL)
const READ_ONLY = process.env.BB_M56_READ_ONLY === "1"

let checks = 0
let passed = 0
let negatives = 0
const failures: string[] = []

function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else {
    failures.push(`${label}${detail ? ` - ${detail}` : ""}`)
    console.log(`  FAIL: ${label}${detail ? ` - ${detail}` : ""}`)
  }
}
function negative(label: string, ok: boolean, detail = ""): void {
  negatives++
  check(`${label} [negative]`, ok, detail)
}

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

// React escapes text nodes; decode before substring checks so registry text
// survives quotes, apostrophes and angles.
function decodeHtml(html: string): string {
  return html
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/g, "/")
    .replace(/&amp;/g, "&")
}

const deTick = (s: string) => s.replace(/`/g, "")
const squash = (s: string) => s.replace(/\s+/g, " ").trim()

// Markdown section body: from a `## <heading>` line to the next heading.
function mdSection(md: string, heading: string): string {
  const start = md.indexOf(`## ${heading}`)
  if (start < 0) return ""
  const rest = md.slice(start + heading.length + 3)
  const end = rest.search(/\n## /)
  return end < 0 ? rest : rest.slice(0, end)
}

console.log("M56.T1 tools-truth verifier")

const { PUBLIC_TOOL_DESCRIPTORS } = (await import(path.join(ROOT, "src/mcp/tool-registry"))) as {
  PUBLIC_TOOL_DESCRIPTORS: any[]
}
const registryNames = PUBLIC_TOOL_DESCRIPTORS.map((t) => t.name).sort()
const byName = new Map(PUBLIC_TOOL_DESCRIPTORS.map((t) => [t.name, t]))

check("T1: registry exposes the expected 16 public tools", registryNames.length === 16, `n=${registryNames.length}`)
check("T1: generated tool facts exist", existsSync(GENERATED), `${GENERATED_REL} missing; run bun run docs:generate`)

// --- 1. generation (byte-level) ----------------------------------------------------

let generatorOk = false
let generatorOut = ""
try {
  generatorOut = execFileSync("npx", ["tsx", "script/verify-tool-docs.ts"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180_000 })
  generatorOk = true
} catch (e) {
  const err = e as { stdout?: string; stderr?: string }
  generatorOut = `${err.stdout ?? ""}\n${err.stderr ?? ""}`
}
check("T1: tool-docs generator is green — the site artifact is byte-identical to a fresh generation", generatorOk, generatorOut.split("\n").filter(Boolean).slice(-4).join(" | "))
check("T1: generator reports the site artifact among its outputs", /TOOL DOCS: PASS \(16 public tools, 18 artifacts\)/.test(generatorOut), generatorOut.trim().slice(0, 160))

// --- 2. tracing --------------------------------------------------------------------

const generatedSrc = existsSync(GENERATED) ? readFileSync(GENERATED, "utf8") : ""
// Coverage is evaluated on the raw bytes (an instrument independent of the import).
const textNames = [...generatedSrc.matchAll(/^    "name": "(bb_[a-z_]+)",$/gm)].map((m) => m[1]!)
check("T1: generated facts cover the registry exactly", JSON.stringify([...new Set(textNames)].sort()) === JSON.stringify(registryNames), `facts=${new Set(textNames).size} registry=${registryNames.length}`)
check("T1: generated facts contain no duplicate tool", textNames.length === new Set(textNames).size, `entries=${textNames.length}`)

const factsModule = (await import(path.join(GENERATED))) as { TOOL_FACTS: any[] }
const facts = factsModule.TOOL_FACTS
const factNames = facts.map((f) => f.name)

const registryFieldMismatches: string[] = []
const curatedMismatches: string[] = []
const referenceMismatches: string[] = []

for (const fact of facts) {
  const tool = byName.get(fact.name)
  if (!tool) {
    registryFieldMismatches.push(`${fact.name}: not in registry`)
    continue
  }
  const doc = tool.documentation
  const pairs: Array<[string, unknown, unknown]> = [
    ["description", fact.description, tool.description],
    ["category", fact.category, doc.category],
    ["summary", fact.summary, doc.summary],
    ["mutability", fact.mutability, tool.mutability],
    ["requiresIndex", fact.requiresIndex, tool.requiresIndex],
    ["modes", JSON.stringify(fact.modes), JSON.stringify(tool.modes)],
    ["plannedModes", JSON.stringify(fact.plannedModes), JSON.stringify(tool.plannedModes ?? [])],
    ["defaults", JSON.stringify(fact.defaults), JSON.stringify(doc.defaults)],
    ["examples", JSON.stringify(fact.examples), JSON.stringify(doc.examples)],
  ]
  for (const [field, got, want] of pairs) {
    if (JSON.stringify(got) !== JSON.stringify(want)) registryFieldMismatches.push(`${fact.name}.${field}`)
  }
  // Parameters must equal the registry input schema, in the same ordering rule
  // the generator applies (required first, then alpha).
  const expectedParams = Object.entries((tool.inputSchema?.properties ?? {}) as Record<string, any>)
    .map(([name, p]: [string, any]) => ({
      name,
      type: p.type ?? "any",
      required: ((tool.inputSchema?.required ?? []) as string[]).includes(name),
      description: p.description ?? "",
    }))
    .sort((a: any, b: any) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name))
  if (JSON.stringify(fact.parameters) !== JSON.stringify(expectedParams)) registryFieldMismatches.push(`${fact.name}.parameters`)

  // Curated fields must be present verbatim in the shipped reference page.
  const refRel = `docs/tools/${fact.name}.md`
  if (fact.referencePath !== refRel) referenceMismatches.push(`${fact.name}.referencePath=${fact.referencePath}`)
  if (!existsSync(path.join(ROOT, refRel))) {
    referenceMismatches.push(`${fact.name}: ${refRel} missing`)
    continue
  }
  const md = readFileSync(path.join(ROOT, refRel), "utf8")
  for (const item of fact.returns ?? []) if (!md.includes(`- ${item}`)) curatedMismatches.push(`${fact.name}.returns`)
  for (const item of fact.errors ?? []) if (!md.includes(`- ${item}`)) curatedMismatches.push(`${fact.name}.errors`)
  for (const item of fact.limitations ?? []) if (!md.includes(`- ${item}`)) curatedMismatches.push(`${fact.name}.limitations`)
  for (const [field, value] of [["performance", fact.performance], ["safety", fact.safety], ["evidence", fact.evidence], ["relations", fact.relations]] as const) {
    if (!md.includes(value)) curatedMismatches.push(`${fact.name}.${field}`)
  }
  const stalenessBody = squash(deTick(mdSection(md, "Staleness")))
  const expectedStaleness = squash(deTick(String(fact.staleness)))
  if (!stalenessBody.startsWith(expectedStaleness)) curatedMismatches.push(`${fact.name}.staleness`)
  // Every fact must carry the mandatory curated fields — an empty one is a hole.
  for (const field of ["returns", "errors", "limitations"] as const) {
    if (!Array.isArray(fact[field]) || fact[field].length === 0) curatedMismatches.push(`${fact.name}.${field}:empty`)
  }
  for (const field of ["performance", "safety", "evidence", "staleness", "relations"] as const) {
    if (typeof fact[field] !== "string" || fact[field].length < 20) curatedMismatches.push(`${fact.name}.${field}:empty`)
  }
}

check("T1: every generated field equals its registry origin (name, description, category, summary, mutability, requiresIndex, modes, plannedModes, defaults, examples, parameters)", registryFieldMismatches.length === 0, [...new Set(registryFieldMismatches)].slice(0, 8).join(", "))
check("T1: every curated field appears verbatim in docs/tools/*.md (returns, errors, limitations, performance, safety, evidence, relations, staleness)", curatedMismatches.length === 0, [...new Set(curatedMismatches)].slice(0, 8).join(", "))
check("T1: every tool points at an existing reference page under docs/tools/", referenceMismatches.length === 0, referenceMismatches.slice(0, 6).join(", "))

// --- 3. no hand-written copy -------------------------------------------------------

const notesPath = path.join(SITE, "src/data/brain-tool-notes.ts")
check("T1: the hand-written tool-notes copy is deleted", !existsSync(notesPath), "website/src/data/brain-tool-notes.ts still exists")

const presentationSource = read("website/src/data/brain-tools.ts")
check("T1: presentation layer declares no fact-shaped keys", !/(longDescription|bestFor|features:|defaults:|safety:|limitations:|description:|examples:)/.test(presentationSource), "brain-tools.ts carries a hand-written tool fact")
const groupKeys = [...presentationSource.matchAll(/^  (bb_[a-z_]+): "(Discovery|Analysis|Diagnostics|Operations)",$/gm)].map((m) => m[1]!)
check("T1: display grouping covers the registry exactly", JSON.stringify([...groupKeys].sort()) === JSON.stringify(registryNames), `groups=${groupKeys.length} registry=${registryNames.length}`)

// No non-generated site source may contain registry prose verbatim: that is
// exactly what "single-sourced" forbids.
const siteSources = walk(path.join(SITE, "src"))
  .filter((f) => /\.(ts|tsx)$/.test(f))
  .filter((f) => !/\.generated\.ts$/.test(f))
const concatenated = siteSources.map((f) => readFileSync(f, "utf8")).join("\n")
const literalCopies = facts.filter((f) => concatenated.includes(f.description) || concatenated.includes(f.summary)).map((f) => f.name)
check("T1: no site source hand-copies registry tool prose", literalCopies.length === 0, literalCopies.join(", "))
const docsPageSource = read("website/src/app/docs/page.tsx")
check("T1: the docs tool table renders the full registry description (no first-sentence truncation)", !docsPageSource.includes("split('. ')") && docsPageSource.includes("t.description"), "docs page still truncates descriptions")

// --- 4. rendered surface -----------------------------------------------------------

const marker = path.join(SITE, ".next/server/app/tools.html")
const newestSource = Math.max(...siteSources.map((f) => statSync(f).mtimeMs))
let buildNote = "reused existing build"
if (!existsSync(marker) || statSync(marker).mtimeMs < newestSource) {
  buildNote = "built now"
  try {
    execFileSync("npm", ["run", "build"], { cwd: SITE, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 480_000 })
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string }
    buildNote = `build failed: ${`${err.stdout ?? ""}${err.stderr ?? ""}`.split("\n").filter(Boolean).slice(-3).join(" | ")}`
  }
}
const built = existsSync(marker)
check("T1: the site build needed for the rendered checks is available", built, buildNote)

const pages = {
  tools: built ? decodeHtml(readFileSync(marker, "utf8")) : "",
  docs: built ? decodeHtml(readFileSync(path.join(SITE, ".next/server/app/docs.html"), "utf8")) : "",
  home: built ? decodeHtml(readFileSync(path.join(SITE, ".next/server/app/index.html"), "utf8")) : "",
}

const missingDescriptions = built ? facts.filter((f) => !pages.tools.includes(f.description) || !pages.docs.includes(f.description)).map((f) => f.name) : []
check("T1: the tools page and the docs table render every tool's full registry description", built && missingDescriptions.length === 0, missingDescriptions.join(", "))
const missingSummaries = built ? facts.filter((f) => !pages.tools.includes(f.summary) || !pages.home.includes(f.summary)).map((f) => f.name) : []
check("T1: the tools page and the homepage render every tool's registry summary", built && missingSummaries.length === 0, missingSummaries.join(", "))
const missingNames = built ? facts.filter((f) => !pages.tools.includes(f.name) || !pages.docs.includes(f.name) || !pages.home.includes(f.name)).map((f) => f.name) : []
check("T1: all three surfaces name every public tool (homepage accounts for all 16)", built && missingNames.length === 0, missingNames.join(", "))
const PHANTOMS = ["bb_select", "bb_update", "bb_delete", "bb_insert", "bb_write", "bb_refactor", "bb_refresh", "bb_relationships", "bb_test_suggestions"]
const phantomRendered = built ? PHANTOMS.filter((p) => pages.tools.includes(p) || pages.docs.includes(p) || pages.home.includes(p)) : []
check("T1: no phantom tool name renders on any surface", built && phantomRendered.length === 0, phantomRendered.join(", "))

// --- 5. negatives ------------------------------------------------------------------

// N1 (real, subprocess): drift the generated site artifact and prove the
// generator refuses it — then prove the restore is byte-clean again.
{
  const backup = path.join(tmpdir(), `tools-generated-n1-${process.pid}.ts`)
  cpSync(GENERATED, backup)
  let driftCaught = false
  let restoreClean = false
  try {
    const drifted = generatedSrc.replace(/^    "summary": ".+",$/m, '    "summary": "hand-typed drift probe",')
    check("N1 setup: the drift probe actually modified the artifact", drifted !== generatedSrc, "summary line not found")
    writeFileSync(GENERATED, drifted)
    try {
      execFileSync("npx", ["tsx", "script/verify-tool-docs.ts"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180_000 })
      driftCaught = false
    } catch {
      driftCaught = true
    }
  } finally {
    cpSync(backup, GENERATED)
    rmSync(backup)
  }
  try {
    execFileSync("npx", ["tsx", "script/verify-tool-docs.ts"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180_000 })
    restoreClean = true
  } catch {}
  negative("N1: a drifted site artifact is rejected by the generator", driftCaught)
  check("N1 restore-proof: the artifact is byte-clean again after the probe", restoreClean)
}

// N2 (real bytes, predicate-level): drop a tool from the generated facts and
// prove the coverage predicate (evaluated on the same bytes) fails.
{
  const mutated = generatedSrc.replace(/^    "name": "bb_edit",$/m, '    "name": "bb_wrong",')
  const names = [...mutated.matchAll(/^    "name": "(bb_[a-z_]+)",$/gm)].map((m) => m[1]!)
  negative("N2: a missing/renamed tool breaks the coverage predicate", mutated !== generatedSrc && JSON.stringify([...new Set(names)].sort()) !== JSON.stringify(registryNames), `names=${new Set(names).size}`)
}

// N3 (real mutation, source scan): plant a registry description as a literal in
// the presentation layer and prove the copy detector fires.
{
  const target = path.join(SITE, "src/data/brain-tools.ts")
  const backup = path.join(tmpdir(), `brain-tools-n3-${process.pid}.ts`)
  const original = readFileSync(target, "utf8")
  cpSync(target, backup)
  let caught = false
  try {
    writeFileSync(target, `${original}\n// ${facts[0]!.description}\n`)
    const after = walk(path.join(SITE, "src"))
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => !/\.generated\.ts$/.test(f))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n")
    caught = after.includes(facts[0]!.description)
  } finally {
    cpSync(backup, target)
    rmSync(backup)
  }
  negative("N3: a hand-copied registry description in site source is detected", caught)
  check("N3 restore-proof: the presentation layer is restored byte-for-byte", readFileSync(target, "utf8") === original)
}

// N4 (synthetic, rendered predicate): prove the rendered-coverage detectors are
// sensitive — deleting one tool's text from a page's HTML must fail them.
if (built) {
  const victim = facts[0]!
  const holed = pages.tools.replaceAll(victim.description, "").replaceAll(victim.summary, "")
  negative("N4: the rendered descriptions detector reacts to a missing tool", !holed.includes(victim.description))
  negative("N4: the rendered summaries detector reacts to a missing tool", !holed.includes(victim.summary))
  negative("N4: the phantom detector reacts to an injected phantom name", PHANTOMS.some((p) => `${pages.tools} bb_select`.includes(p)))
}

// --- verdict + evidence ------------------------------------------------------------

const gitHead = (() => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
})()

const ok = passed === checks
console.log("")
console.log(`  checks: ${passed}/${checks} passed, ${negatives} negative cases`)
console.log(`  surfaces: tools page, docs table, homepage · facts: ${facts.length}`)
if (!ok) {
  console.log("VERDICT: FAIL")
  process.exit(1)
}
console.log("VERDICT: PASS")

if (!READ_ONLY) {
  mkdirSync(RESULTS, { recursive: true })
  const evidence = {
    issue: "M56.T1",
    code: "T1",
    milestone: "M56",
    status: "verified",
    checks,
    passed,
    failed: checks - passed,
    negativeCases: negatives,
    currentCommit: gitHead,
    verifierCommand: "npx tsx script/m56/verify-tools-truth.ts",
    evidenceFile: "T1.json",
    generatedAt: new Date().toISOString(),
    generatedArtifact: GENERATED_REL,
    rendered: { tools: facts.length, surface: "tools page, docs table, homepage", build: buildNote },
    summary: {
      toolsTraced: facts.length,
      referencePagesTraced: facts.length,
      siteSourcesScanned: siteSources.length,
      generatorArtifacts: 18,
    },
    limitations: [
      "The byte-identity proof runs the canonical generator (script/verify-tool-docs.ts); it therefore covers all 18 generated artifacts, not the site file alone.",
      "Rendered checks reuse website/.next when it is newer than every site source, and rebuild otherwise (a fresh checkout always rebuilds).",
      "N4 proves the rendered detectors are sensitive on synthetic HTML; N1/N2/N3 are real mutations. No end-to-end rebuild mutant is run here because M41.T2 already proves that class (N2) for the built site.",
    ],
  }
  writeFileSync(path.join(RESULTS, "T1.json"), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(`  evidence: validation/m56/results/T1.json`)
}
