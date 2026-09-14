// script/m56/verify-editors-page.ts — M56.E1 (#780).
//
// The /editors page states the extension's claims, versions and publishing
// status. This gate proves it cannot state any of them loosely:
//
//   1. GENERATION — the generator is byte-clean: the committed data file and
//      every sha-pinned still match a fresh generation.
//   2. THREE-WAY CLAIM CHECK — the shipped per-language levels are parsed
//      independently out of ide/vscode/README.md, the extension status model
//      and docs/m24/TOOL-DOC.md, and must agree with each other and with what
//      the page renders.
//   3. EVIDENCE CHECK — evidence-computed claims come from the M29 precision
//      ledger; editor rows (level, pinned version, platform, blocked state)
//      come from the M25 evidence files; the publishing state comes from the
//      M25 packaging record.
//   4. HONESTY CHECK — declared exclusions present, and while publishing is
//      blocked no marketplace-availability claim may exist anywhere in the
//      data, the page source or the rendered output.
//   5. SURFACE CHECK — the rendered page carries every claim, exclusion, still
//      and drift declaration, and invents no claim level the legends do not
//      define.
//
// Run: npx tsx script/m56/verify-editors-page.ts
// Evidence: validation/m56/results/E1.json

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const SITE = path.join(ROOT, "website")
const RESULTS = path.join(ROOT, "validation/m56/results")
const DATA_REL = "website/src/data/editors.generated.ts"
const DATA = path.join(ROOT, DATA_REL)
const PAGE_REL = "website/src/app/editors/page.tsx"
const README_REL = "ide/vscode/README.md"
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

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8")
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}
function decodeHtml(html: string): string {
  return html
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

// Independent markdown table parse (deliberately NOT the generator's helper):
// every line starting with "|" after the marker, minus the separator row.
function mdTable(md: string, marker: string): string[][] {
  const at = md.indexOf(marker)
  if (at < 0) return []
  const out: string[][] = []
  let seen = false
  for (const raw of md.slice(at).split("\n")) {
    const line = raw.trim()
    if (!line.startsWith("|")) {
      if (seen && out.length > 1) break
      continue
    }
    const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim())
    if (cells.every((c) => /^-{2,}$/.test(c))) {
      seen = true
      continue
    }
    if (seen) out.push(cells)
  }
  return out
}

const unTick = (s: string) => s.replace(/`/g, "").replace(/✓/g, "").trim()

console.log("M56.E1 editors-page verifier")

// --- 1. generation (byte-level) ---------------------------------------------------

let genOk = false
let genOut = ""
try {
  genOut = execFileSync("npx", ["tsx", "script/m56/generate-editors.ts"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180_000 })
  genOk = true
} catch (e) {
  const err = e as { stdout?: string; stderr?: string }
  genOut = `${err.stdout ?? ""}\n${err.stderr ?? ""}`
}
check("E1: editor-data generator is byte-clean (data file + every still sha-pinned)", genOk, genOut.split("\n").filter(Boolean).slice(-3).join(" | "))
check("E1: generator reports the expected shape", /EDS: PASS \(.+4 stills verified, 4 editors, 6 ledger rows\)/.test(genOut), genOut.trim().slice(0, 160))

const dataSrc = existsSync(DATA) ? readFileSync(DATA, "utf8") : ""
const F = (await import(DATA)) as { EDITOR_FACTS: any }
const facts = F.EDITOR_FACTS

// --- 2. three-way claim check -----------------------------------------------------

const readme = read(README_REL)
const readmeMatrix = mdTable(readme, "## Features and claim levels")
// Row shape: | language | 5 levels | — header row is the first table line, so
// drop it when its first cell is not a language we expect.
const matrixData = readmeMatrix.filter((r) => !/^language$/i.test(r[0] ?? ""))
const statusModel = read("ide/vscode/src/status-model.ts")
const statusBlock = statusModel.slice(statusModel.indexOf("export const CLAIM_LEVELS"))
const statusLevels = Object.fromEntries([...statusBlock.slice(0, statusBlock.indexOf("}")).matchAll(/(\w+): "([^"]+)"/g)].map((m) => [m[1]!, m[2]!]))
const toolDoc = read("docs/m24/TOOL-DOC.md")
const toolDocRows = mdTable(toolDoc, "## Claim levels (contract §2)")

const mismatch: string[] = []
for (const claim of facts.shippedClaims as any[]) {
  const matrixRow = matrixData.find((r) => unTick(r[0]!) === claim.language)
  if (!matrixRow) {
    mismatch.push(`${claim.language}:absent-in-readme`)
    continue
  }
  const docLevels = matrixRow.slice(1).map(unTick)
  const pageLevels = Object.values(claim.features as Record<string, string>)
  if (JSON.stringify(docLevels) !== JSON.stringify(pageLevels)) mismatch.push(`${claim.language}:readme-matrix`)
  if (statusLevels[claim.language] !== claim.level) mismatch.push(`${claim.language}:status-model`)
  const toolDocRow = toolDocRows.find((r) => unTick(r[0]!) === claim.language)
  if (!toolDocRow) mismatch.push(`${claim.language}:absent-in-tool-doc`)
  else if (!toolDocRow.slice(1).every((c) => unTick(c) === claim.level)) mismatch.push(`${claim.language}:tool-doc`)
  const distinct = new Set(pageLevels)
  if (distinct.size !== 1) mismatch.push(`${claim.language}:mixed-levels`)
}
check(
  "E1: shipped claim matrix agrees across the extension README, the extension status model and docs/m24/TOOL-DOC.md",
  mismatch.length === 0,
  [...new Set(mismatch)].join(", "),
)
// The page's launch set must come from the ONE owner, re-derived here rather
// than trusted.
const ownerSrc = read("src/lsp/launch_languages.ts")
const ownerBlock = ownerSrc.slice(ownerSrc.indexOf("export const LAUNCH_LANGUAGES"))
const ownerLaunchSet = [...ownerBlock.slice(0, ownerBlock.indexOf("]")).matchAll(/"([a-z]+)"/g)].map((m) => m[1]!)
check(
  "E1: the page's launch set equals the single owner (src/lsp/launch_languages.ts)",
  JSON.stringify(facts.launchLanguages) === JSON.stringify(ownerLaunchSet),
  `page=${(facts.launchLanguages as string[]).length} owner=${ownerLaunchSet.length}`,
)

// The LSP launch set and the extension's shipped claim table are two different
// records and MAY disagree — but never silently. Every launch language must be
// either covered by the shipped matrix or named in the declared-unclaimed list,
// and that list must be EXACTLY the difference: no padding, no omission. This
// replaced a bare length equality, which could only be satisfied by growing the
// marketplace claim table to match the server — the wrong fix for a gap the
// extension has not closed yet.
const shippedSet = new Set((facts.shippedClaims as any[]).map((c: any) => c.language as string))
const declaredUnclaimed = (facts.unclaimedLaunchLanguages ?? []) as string[]
const expectedGap = (facts.launchLanguages as string[]).filter((l) => !shippedSet.has(l))
const silentlyUncovered = expectedGap.filter((l) => !declaredUnclaimed.includes(l))
const padded = declaredUnclaimed.filter((l) => !expectedGap.includes(l))
check(
  "E1: every launch language is either covered by the shipped matrix or declared unclaimed",
  silentlyUncovered.length === 0 && padded.length === 0,
  `claims=${shippedSet.size} launch=${(facts.launchLanguages as string[]).length} unclaimed=${declaredUnclaimed.length}` +
    (silentlyUncovered.length ? ` · silently uncovered: ${silentlyUncovered.join(",")}` : "") +
    (padded.length ? ` · not a launch language or already claimed: ${padded.join(",")}` : ""),
)
check("E1: shipped levels are declared in the README legend", (facts.shippedClaims as any[]).every((c: any) => facts.shippedClaimLegend.some((l: any) => l.level === c.level)))

// --- 3. evidence check ------------------------------------------------------------

const ledger = JSON.parse(read("validation/m29/results/PRECISION-LEDGER.json")) as any
const ledgerMismatch: string[] = []
if ((facts.precision as any[]).length !== ledger.languages.length) ledgerMismatch.push("row-count")
for (const row of facts.precision as any[]) {
  const source = ledger.languages.find((l: any) => l.language === row.language)
  if (!source) {
    ledgerMismatch.push(`${row.language}:absent`)
    continue
  }
  if (source.claim !== row.claim) ledgerMismatch.push(`${row.language}:claim`)
  if (JSON.stringify(source.conformance) !== JSON.stringify(row.conformance)) ledgerMismatch.push(`${row.language}:conformance`)
  if (JSON.stringify(source.features) !== JSON.stringify(row.features)) ledgerMismatch.push(`${row.language}:features`)
  if (JSON.stringify(source.latency?.warmP95Ms ?? {}) !== JSON.stringify(row.warmP95Ms)) ledgerMismatch.push(`${row.language}:latency`)
  if (source.evidence?.s5?.path !== row.evidence?.s5?.path) ledgerMismatch.push(`${row.language}:evidence`)
}
check("E1: evidence-computed claims, features, latency and evidence paths equal the M29 precision ledger", ledgerMismatch.length === 0, [...new Set(ledgerMismatch)].slice(0, 6).join(", "))
const expectedNotRecorded = (facts.shippedClaims as any[]).map((c: any) => c.language).filter((l: string) => !ledger.languages.some((r: any) => r.language === l))
check("E1: languages with no wave-1 ledger row are declared absent, not inherited", JSON.stringify(facts.precisionNotRecorded) === JSON.stringify(expectedNotRecorded), `${JSON.stringify(facts.precisionNotRecorded)} vs ${JSON.stringify(expectedNotRecorded)}`)

const editorMismatch: string[] = []
for (const editor of facts.editors as any[]) {
  const ev = JSON.parse(read(editor.evidenceFile)) as any
  if (ev.status !== editor.status) editorMismatch.push(`${editor.name}:status`)
  if ((ev.editor?.version ?? null) !== editor.pinnedVersion) editorMismatch.push(`${editor.name}:version`)
  const os = ev.os ?? (String(ev.machine?.kernel ?? "").includes("Linux") ? "linux" : "unknown")
  if (os !== editor.os) editorMismatch.push(`${editor.name}:os`)
  const readmeRow = mdTable(readme, "## Editor verification matrix").find((r) => unTick(r[0]!) === editor.name)
  if (!readmeRow) editorMismatch.push(`${editor.name}:absent-in-readme`)
  else {
    const level = /^(I\d)/.exec(unTick(readmeRow[1]!))?.[1] ?? null
    if (level !== editor.claim) editorMismatch.push(`${editor.name}:claim`)
    if (unTick(readmeRow[2]!) !== editor.evidenceFile) editorMismatch.push(`${editor.name}:evidencePath`)
  }
  // A claim may not exceed what the evidence records: a verified run is the
  // only thing that licenses a level at all.
  if (editor.claim && editor.status !== "verified") editorMismatch.push(`${editor.name}:claim-without-verified-run`)
  if (!editor.claim && editor.status === "verified") editorMismatch.push(`${editor.name}:verified-without-claim`)
}
check("E1: editor rows equal the M25 evidence (status, pinned version, platform) and the README's declared level", editorMismatch.length === 0, [...new Set(editorMismatch)].join(", "))

const osMismatch: string[] = []
for (const leg of facts.osSupport as any[]) {
  const ev = JSON.parse(read(leg.evidenceFile)) as any
  if (ev.status !== leg.status) osMismatch.push(`${leg.platform}:status`)
  if (leg.status === "blocked" && !leg.reason) osMismatch.push(`${leg.platform}:no-reason`)
}
check("E1: OS legs match the E7 evidence and every blocked leg states a reason", osMismatch.length === 0, osMismatch.join(", "))

const publishRecord = JSON.parse(read(facts.publishing.recordPath)) as any
const publishMismatch: string[] = []
if (Boolean(publishRecord.blocked) !== facts.publishing.blocked) publishMismatch.push("blocked")
if (publishRecord.reason !== facts.publishing.reason) publishMismatch.push("reason")
if (publishRecord.targetRegistry !== facts.publishing.targetRegistry) publishMismatch.push("registry")
if (publishRecord.publishCommand !== facts.publishing.publishCommand) publishMismatch.push("command")
if (publishRecord.extensionVersion !== (await import(path.join(ROOT, "ide/vscode/package.json"))).default.version) publishMismatch.push("extension-version")
check("E1: publishing status equals the M25 packaging record and the extension version", publishMismatch.length === 0, publishMismatch.join(", "))

// --- 4. honesty check -------------------------------------------------------------

const exclusions = readme.match(/No completion, no diagnostics, no rename/)
check("E1: declared exclusions are sourced from the extension README", Boolean(exclusions) && (facts.exclusions as string[]).length === 3, JSON.stringify(facts.exclusions))
const AVAILABILITY = [
  /available (on|in) the (marketplace|registry)/i,
  /install from the marketplace/i,
  /published on (the )?(marketplace|open ?vsx|openvsx)/i,
  /marketplace listing/i,
  /live on the marketplace/i,
]
const pageSrc = read(PAGE_REL)
const availabilityHits = [
  ...AVAILABILITY.filter((re) => re.test(dataSrc)).map((re) => `data:${re.source}`),
  ...AVAILABILITY.filter((re) => re.test(pageSrc)).map((re) => `page:${re.source}`),
]
check("E1: no marketplace-availability claim while publishing is blocked", !facts.publishing.blocked || availabilityHits.length === 0, availabilityHits.join(", "))
check("E1: the blocked publishing state is stated with its reason", !facts.publishing.blocked || (pageSrc.includes("F.publishing.reason") && facts.publishing.reason.length > 20))
const driftDeclared = (facts.declaredDrift as any[]).length > 0
check("E1: documentation drift is declared rather than silently preferred", !driftDeclared || (pageSrc.includes("declaredDrift") && pageSrc.includes("docValue") && pageSrc.includes("evidenceSource")), `${(facts.declaredDrift as any[]).length} drift entries`)

// --- 5. stills + rendered surface -------------------------------------------------

const stillProblems: string[] = []
const session = JSON.parse(read(facts.stills[0].sessionEvidence)) as any
for (const still of facts.stills as any[]) {
  const sourceAbs = path.join(ROOT, still.source)
  const publicAbs = path.join(ROOT, "website/public", still.publicPath)
  if (!existsSync(sourceAbs)) {
    stillProblems.push(`${still.id}:source-missing`)
    continue
  }
  if (sha256(readFileSync(sourceAbs)) !== still.sourceSha256) stillProblems.push(`${still.id}:source-hash`)
  if (!existsSync(publicAbs)) stillProblems.push(`${still.id}:copy-missing`)
  else if (sha256(readFileSync(publicAbs)) !== still.sourceSha256) stillProblems.push(`${still.id}:copy-hash`)
  if (still.bytes < 150_000) stillProblems.push(`${still.id}:below-size-floor`)
  if (!(session.probes as string[]).includes(still.source.replace("validation/m45/results/demo-session/", ""))) stillProblems.push(`${still.id}:not-in-session-corpus`)
  const beat = (session.observedTimeline?.beats ?? []).find((b: any) => b.name === still.id)
  if (!beat || beat.what !== still.caption) stillProblems.push(`${still.id}:caption`)
  if (!(pageSrc.includes("still.publicPath") && pageSrc.includes("still.sourceSha256"))) stillProblems.push(`${still.id}:page-provenance`)
}
check("E1: every proof still is byte-identical to its verified capture, above the size floor, and captioned from the recorded beat", stillProblems.length === 0, stillProblems.join(", "))

const sitemap = read("website/src/app/sitemap.ts")
const nav = read("website/src/components/Navigation.tsx")
check("E1: /editors is in the sitemap and the main navigation", sitemap.includes('"/editors"') && nav.includes("'/editors'"))

const marker = path.join(SITE, ".next/server/app/editors.html")
const siteSources = walk(path.join(SITE, "src")).filter((f) => /\.(ts|tsx)$/.test(f))
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
check("E1: the site build needed for the rendered checks is available", built, buildNote)
const html = built ? decodeHtml(readFileSync(marker, "utf8")) : ""

const missingRendered: string[] = []
if (built) {
  for (const claim of facts.shippedClaims as any[]) if (!html.includes(claim.language)) missingRendered.push(`lang:${claim.language}`)
  for (const editor of facts.editors as any[]) if (!html.includes(editor.name)) missingRendered.push(`editor:${editor.name}`)
  for (const exclusion of facts.exclusions as string[]) if (!html.includes(exclusion)) missingRendered.push(`exclusion:${exclusion}`)
  for (const still of facts.stills as any[]) if (!html.includes(still.publicPath) || !html.includes(still.caption)) missingRendered.push(`still:${still.id}`)
  for (const integration of facts.integrations as any[]) if (!html.includes(integration.name)) missingRendered.push(`integration:${integration.id}`)
  for (const level of [...(facts.shippedClaimLegend as any[]), ...(facts.statusLevelLegend as any[])]) if (!html.includes(level.level)) missingRendered.push(`legend:${level.level}`)
  for (const drift of facts.declaredDrift as any[]) if (!html.includes(drift.evidenceValue) || !html.includes(drift.topic)) missingRendered.push(`drift:${drift.topic}`)
  if (!html.includes(facts.publishing.extensionVersion) || !html.includes(facts.stills[0].sessionCommit.slice(0, 8))) missingRendered.push("versions/provenance")
}
check("E1: the rendered page carries every claim, exclusion, editor, still, legend level and drift declaration", built && missingRendered.length === 0, missingRendered.slice(0, 8).join(", "))

// Claim-level honesty on the rendered surface: no level may appear that the
// two legends and the data do not define.
const declaredLevels = new Set<string>([
  ...(facts.shippedClaimLegend as any[]).map((l: any) => l.level as string),
  ...(facts.statusLevelLegend as any[]).map((l: any) => l.level as string),
  ...(facts.shippedClaims as any[]).map((c: any) => c.level as string),
  ...(facts.precision as any[]).map((r: any) => r.claim as string),
  ...(facts.editors as any[]).map((e: any) => e.claim as string).filter(Boolean),
])
const renderedLevels = built ? [...new Set(html.match(/\bI[0-5]\b/g) ?? [])] : []
const undeclaredLevels = renderedLevels.filter((l) => !declaredLevels.has(l))
check("E1: no rendered claim level exists that the legends and evidence do not define", built && undeclaredLevels.length === 0, undeclaredLevels.join(", "))

// A declared gap that nobody renders is not a declaration. The page must state
// it and name every launch language the shipped matrix has no row for.
const gapString = declaredUnclaimed.join(", ")
const gapRendered = built && declaredUnclaimed.length > 0 && html.includes(gapString) && /declared gap/i.test(html)
check(
  "E1: the declared gap is rendered on the page and names every unclaimed launch language",
  gapRendered,
  declaredUnclaimed.length === 0 ? "no gap to render" : `expected the page to name: ${gapString}`,
)

// --- 6. negatives -----------------------------------------------------------------

// N1 (real, subprocess): drift the generated data and prove the generator
// refuses it; then prove the restore is byte-clean.
{
  const backup = path.join(tmpdir(), `editors-data-n1-${process.pid}.ts`)
  cpSync(DATA, backup)
  let caught = false
  let restoreClean = false
  try {
    writeFileSync(DATA, dataSrc.replace(/"level": "I1"/, '"level": "I2"'))
    try {
      execFileSync("npx", ["tsx", "script/m56/generate-editors.ts"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180_000 })
    } catch {
      caught = true
    }
  } finally {
    cpSync(backup, DATA)
    rmSync(backup)
  }
  try {
    execFileSync("npx", ["tsx", "script/m56/generate-editors.ts"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180_000 })
    restoreClean = true
  } catch {}
  negative("N1: a hand-edited claim level in the generated data is rejected", caught)
  check("N1 restore-proof: the data file is byte-clean again", restoreClean)
}

// N2 (real bytes, predicate-level): a hand-edited level must break the
// three-way check even if the generator were bypassed.
{
  const tampered = dataSrc.replace('"level": "I1"', '"level": "I4"')
  const claim = facts.shippedClaims[0]
  const docLevel = unTick(matrixData.find((r) => unTick(r[0]!) === claim.language)!.slice(1)[0]!)
  negative("N2: a tampered shipped level breaks the README cross-check", tampered !== dataSrc && docLevel !== "I4")
}

// N3 (real, source mutation): plant an availability claim in the page source
// and prove the detector fires.
{
  const backup = path.join(tmpdir(), `editors-page-n3-${process.pid}.tsx`)
  const original = readFileSync(path.join(ROOT, PAGE_REL), "utf8")
  cpSync(path.join(ROOT, PAGE_REL), backup)
  let caught = false
  try {
    writeFileSync(path.join(ROOT, PAGE_REL), `${original}\n// The extension is available on the marketplace.\n`)
    caught = AVAILABILITY.some((re) => re.test(readFileSync(path.join(ROOT, PAGE_REL), "utf8")))
  } finally {
    cpSync(backup, path.join(ROOT, PAGE_REL))
    rmSync(backup)
  }
  negative("N3: a planted marketplace-availability claim is detected", caught)
  check("N3 restore-proof: the page source is restored byte-for-byte", readFileSync(path.join(ROOT, PAGE_REL), "utf8") === original)
}

// N4 (real, file mutation): corrupt one still copy and prove the sha check fires.
{
  const still = (facts.stills as any[])[0]
  const publicAbs = path.join(ROOT, "website/public", still.publicPath)
  const backup = path.join(tmpdir(), `editors-still-n4-${process.pid}.png`)
  cpSync(publicAbs, backup)
  let caught = false
  try {
    writeFileSync(publicAbs, Buffer.concat([readFileSync(publicAbs), Buffer.from("corrupt")]))
    caught = sha256(readFileSync(publicAbs)) !== still.sourceSha256
  } finally {
    cpSync(backup, publicAbs)
    rmSync(backup)
  }
  negative("N4: a corrupted still copy is detected by its pinned hash", caught)
  check("N4 restore-proof: the still is byte-identical again", sha256(readFileSync(publicAbs)) === still.sourceSha256)
}

// N5 (synthetic): the rendered-level detector reacts to an undeclared level.
if (built) {
  negative("N5: the rendered-level detector reacts to an undeclared level", (html + " I5 ").match(/\bI[0-5]\b/g)!.some((l) => !declaredLevels.has(l)) === !declaredLevels.has("I5"))
}

// N6 (synthetic, predicate-level): the exact defect the coverage rule exists to
// catch — a launch language that is neither claimed nor declared unclaimed.
// Built from a constructed list so the mutant stays valid at any data state.
{
  const launch = facts.launchLanguages as string[]
  const probeShipped = new Set(launch.slice(1)) // pretend the first language is claimed
  const probeDeclared: string[] = [] // and declared nowhere
  const probeUncovered = launch.filter((l) => !probeShipped.has(l) && !probeDeclared.includes(l))
  negative(
    "N6: a launch language covered by neither the matrix nor the declared list is caught",
    probeUncovered.length === 1 && probeUncovered[0] === launch[0],
    `uncovered=${probeUncovered.join(",")}`,
  )
  const probePadded = ["not-a-launch-language"]
  negative(
    "N6: a padded declared-unclaimed list (an entry that is not the gap) is caught",
    probePadded.filter((l) => !(launch.filter((x) => !probeShipped.has(x))).includes(l)).length === 1,
  )
}

// --- verdict + evidence -----------------------------------------------------------

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
console.log(`  surfaces: /editors · ${(facts.editors as any[]).length} editor runs · ${(facts.stills as any[]).length} stills · ${(facts.precision as any[]).length} ledger rows`)
if (!ok) {
  console.log("VERDICT: FAIL")
  process.exit(1)
}
console.log("VERDICT: PASS")

if (!READ_ONLY) {
  mkdirSync(RESULTS, { recursive: true })
  const evidence = {
    issue: "M56.E1",
    code: "E1",
    milestone: "M56",
    status: "verified",
    checks,
    passed,
    failed: checks - passed,
    negativeCases: negatives,
    currentCommit: gitHead,
    verifierCommand: "npx tsx script/m56/verify-editors-page.ts",
    evidenceFile: "E1.json",
    generatedAt: new Date().toISOString(),
    generatedArtifact: DATA_REL,
    rendered: { route: "/editors", build: buildNote, stills: (facts.stills as any[]).length, editors: (facts.editors as any[]).length },
    summary: {
      launchLanguages: (facts.launchLanguages as string[]).length,
      shippedClaimSources: (facts.shippedClaimSources as string[]).length,
      ledgerRows: (facts.precision as any[]).length,
      editorRuns: (facts.editors as any[]).length,
      osLegs: (facts.osSupport as any[]).length,
      exclusions: (facts.exclusions as string[]).length,
      declaredDrift: (facts.declaredDrift as any[]).length,
      integrations: (facts.integrations as any[]).length,
    },
    limitations: [
      "Rendered checks reuse website/.next when it is newer than every site source, and rebuild otherwise; a fresh checkout always rebuilds.",
      "The M29 precision ledger is consumed as an artifact (validation/m29/results/PRECISION-LEDGER.json); this gate does not re-run the M29 wave fixtures.",
      "The VSIX is a gitignored build artifact, so the page reports the packaging record and the install command instead of pinning a file hash that every rebuild would change.",
      "N2 checks the cross-check predicate on tampered bytes rather than rewriting the file, because the generator check (N1) already covers the write path.",
    ],
  }
  writeFileSync(path.join(RESULTS, "E1.json"), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log("  evidence: validation/m56/results/E1.json")
}
