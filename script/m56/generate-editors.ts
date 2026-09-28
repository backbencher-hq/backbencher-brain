// script/m56/generate-editors.ts — M56.E1 (#780).
//
// The /editors page is DERIVED, never hand-written. This generator reads the
// real claim chain and emits website/src/data/editors.generated.ts:
//
//   ide/vscode/README.md                      -> shipped feature/claim matrix,
//                                                legend, exclusions, settings,
//                                                version matrix, limitations,
//                                                complement stance, hover actions,
//                                                install commands
//   ide/vscode/src/status-model.ts            -> the extension's shipped claim
//                                                levels + level legend
//   src/lsp/launch_languages.ts               -> the LSP launch set (the single
//                                                owner). The extension's shipped
//                                                claim table is a DIFFERENT record
//                                                and may cover fewer languages —
//                                                the page labels both and declares
//                                                the gap instead of merging them.
//   docs/m24/TOOL-DOC.md                      -> protocol-level claim table
//                                                (third independent source)
//   validation/m29/results/PRECISION-LEDGER.json -> evidence-computed claims,
//                                                feature availability, measured
//                                                warm latency, analyzer precision
//   validation/m25/results/{E5,F-*,E7-*,E4-openvsx}.json -> editor and OS runs,
//                                                publishing state
//   ide/vscode/package.json                   -> version, commands, settings,
//                                                activation languages
//   ide/{zed,helix,lsp4ij}/*                  -> per-editor launch facts
//   validation/m45/results/demo-session/*     -> real capture stills (copied
//                                                byte-identically, sha-pinned)
//
// Usage:
//   npx tsx script/m56/generate-editors.ts            # verify (drift check)
//   npx tsx script/m56/generate-editors.ts --write    # regenerate
//
// The verifier (script/m56/verify-editors-page.ts) proves the committed file is
// byte-identical to a fresh generation, cross-checks the three claim sources,
// and fails on any marketplace-availability claim.

import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const OUT_REL = "website/src/data/editors.generated.ts"
const OUT = path.join(ROOT, OUT_REL)
const STILLS_REL = "website/public/editors"
const STILLS_DIR = path.join(ROOT, STILLS_REL)
const WRITE = process.argv.includes("--write")

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}
function readJson<T>(rel: string): T {
  return JSON.parse(read(rel)) as T
}
function must(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`EDS: ${message}`)
}
function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex")
}

// --- markdown parsing helpers -------------------------------------------------

type Row = string[]

/** Header + data rows of the first markdown table that appears after `marker`. */
function tableWithHeader(md: string, marker: string): { header: Row; rows: Row[] } {
  const at = md.indexOf(marker)
  must(at >= 0, `marker not found in document: ${marker}`)
  const lines = md.slice(at).split("\n")
  let header: Row | null = null
  const rows: Row[] = []
  let started = false
  for (const line of lines) {
    if (!line.trim().startsWith("|")) {
      if (started) break
      continue
    }
    const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim())
    if (cells.every((c) => /^-{2,}$/.test(c) || c === "")) {
      started = true
      continue
    }
    started = true
    if (header === null) header = cells
    else rows.push(cells)
  }
  must(header !== null && rows.length > 0, `table after "${marker}" has no data rows`)
  return { header, rows }
}

function headingTable(md: string, heading: string): Row[] {
  return tableWithHeader(md, heading).rows
}

function headingTableHeader(md: string, heading: string): Row {
  return tableWithHeader(md, heading).header
}

/** Bullet lines directly under a heading (until the next heading). */
function bullets(md: string, heading: string): string[] {
  const at = md.indexOf(heading)
  must(at >= 0, `heading not found: ${heading}`)
  const body = md.slice(at + heading.length)
  const end = body.search(/\n#{2,3} /)
  const section = end < 0 ? body : body.slice(0, end)
  return section
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim())
}
function numbered(md: string, heading: string): string[] {
  const at = md.indexOf(heading)
  must(at >= 0, `heading not found: ${heading}`)
  const body = md.slice(at + heading.length)
  const end = body.search(/\n#{2,3} /)
  const section = end < 0 ? body : body.slice(0, end)
  return section
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d+\.\s/.test(l))
    .map((l) => l.replace(/^\d+\.\s*/, ""))
}

function unbacktick(s: string): string {
  return s.replace(/`/g, "").trim()
}

// --- sources ------------------------------------------------------------------

const README_REL = "ide/vscode/README.md"
const readme = read(README_REL)
const pkg = readJson<any>("ide/vscode/package.json")
const statusModelSrc = read("ide/vscode/src/status-model.ts")

// Shipped claim matrix: language x feature level, straight from the README.
const matrixFeatures = headingTableHeader(readme, "## Features and claim levels").slice(1)
must(matrixFeatures.length === 5, `expected 5 feature columns, got ${matrixFeatures.length}`)
const shippedClaims = headingTable(readme, "## Features and claim levels").map((row) => {
  const language = unbacktick(row[0]!)
  const levels = row.slice(1).map((c) => unbacktick(c))
  const features: Record<string, string> = {}
  matrixFeatures.forEach((feature, i) => {
    features[feature] = levels[i]!
  })
  const distinct = [...new Set(Object.values(features))]
  must(distinct.length === 1, `${language} declares mixed feature levels: ${distinct.join(",")}`)
  return { language, level: distinct[0]!, features }
})

// The extension's own shipped levels (drift-gated to docs/m24/TOOL-DOC.md).
const claimBlock = statusModelSrc.slice(statusModelSrc.indexOf("export const CLAIM_LEVELS"))
const extensionClaims = [...claimBlock.slice(0, claimBlock.indexOf("}")).matchAll(/(\w+): "([^"]+)"/g)].map((m) => ({
  language: m[1]!,
  level: m[2]!,
}))

// The LSP launch set has ONE owner (src/lsp/launch_languages.ts — its own header
// says so) and it is read from there, never inferred: the set used to live
// duplicated in hover.ts/server.ts and M29.R2 recorded that as a drift hazard.
const launchOwnerSrc = read("src/lsp/launch_languages.ts")
const launchOwnerBlock = launchOwnerSrc.slice(launchOwnerSrc.indexOf("export const LAUNCH_LANGUAGES"))
const launchLanguages = [...launchOwnerBlock.slice(0, launchOwnerBlock.indexOf("]")).matchAll(/"([a-z]+)"/g)].map((m) => m[1]!)
must(launchLanguages.length > 0, "src/lsp/launch_languages.ts: LAUNCH_LANGUAGES not parsed")

// Two records describe the same set (the extension's status model and the LSP
// owner). They agree today; if they ever diverge, fail loudly rather than let
// the page pick a winner silently.
const statusLanguages = extensionClaims.map((c) => c.language)
must(
  JSON.stringify(statusLanguages) === JSON.stringify(launchLanguages),
  `extension status model has ${statusLanguages.length} languages, the LSP launch-set owner has ${launchLanguages.length}`,
)

// The extension's shipped claim table is a different record and may legitimately
// cover fewer languages than the LSP launches. The gap is declared on the page.
const unclaimedLaunchLanguages = launchLanguages.filter((l) => !shippedClaims.some((c) => c.language === l))

// Both level ladders, rendered verbatim with their sources: they are defined
// differently by the two documents, so the site shows each one as recorded.
const shippedClaimLegend = headingTable(readme, "**Claim-level legend**").map((row) => ({
  level: unbacktick(row[0]!),
  meaning: unbacktick(row[1]!),
}))
const statusLevelLegend = [...statusModelSrc.slice(statusModelSrc.indexOf("function describeLevel")).matchAll(/^\s+(I\d): "([^"]+)"/gm)].map((m) => ({
  level: m[1]!,
  meaning: m[2]!,
}))

// Evidence-computed precision (M29.R4, machine-regenerated + drift-gated).
const ledger = readJson<any>("validation/m29/results/PRECISION-LEDGER.json")
const precision = ledger.languages.map((row: any) => ({
  language: row.language,
  claim: row.claim,
  conformance: row.conformance,
  features: row.features,
  warmP95Ms: row.latency?.warmP95Ms ?? {},
  budgetViolations: row.latency?.budgetViolations ?? [],
  analyzerPrecision: row.analyzerPrecision,
  evidence: row.evidence,
}))
const precisionLanguages = precision.map((r: any) => r.language)
const ledgerSource = "validation/m29/results/PRECISION-LEDGER.json"
const precisionNotRecorded = shippedClaims.map((c) => c.language).filter((l) => !precisionLanguages.includes(l))

// Editor runs and OS legs.
const editorEvidence: { file: string; label: string }[] = [
  { file: "E5.json", label: "VS Code" },
  { file: "F-CURSOR.json", label: "Cursor" },
  { file: "F-ANTIGRAVITY.json", label: "Antigravity" },
  { file: "F-WINDSURF.json", label: "Windsurf" },
]
const readmeEditorRows = headingTable(readme, "## Editor verification matrix").map((row) => ({
  name: unbacktick(row[0]!),
  claimText: unbacktick(row[1]!),
  evidenceFile: unbacktick(row[2]!),
}))
const editors = editorEvidence.map(({ file, label }) => {
  const rel = `validation/m25/results/${file}`
  const ev = readJson<any>(rel)
  const docRow = readmeEditorRows.find((r) => r.name === label)
  must(docRow, `README editor matrix has no row for ${label}`)
  const pinnedVersion: string | null = ev.editor?.version ?? null
  const os: string = ev.os ?? (ev.machine?.kernel?.includes("Linux") ? "linux" : "unknown")
  const status: string = ev.status ?? "unknown"
  const claimMatch = /^(I\d)/.exec(docRow.claimText)
  return {
    id: label.toLowerCase().replace(/\s+/g, "-"),
    name: label,
    status,
    claim: claimMatch ? claimMatch[1]! : null,
    claimText: docRow.claimText,
    pinnedVersion,
    os,
    evidenceFile: rel,
    evidenceVerifier: ev.verifierCommand ?? null,
    blockedReason: ev.blockedReason ?? ev.reason ?? null,
    runsRecorded: ev.checksPassed ?? ev.passed ?? null,
  }
})
const OS_LEGS: { platform: string; file: string }[] = [
  { platform: "linux", file: "E7-linux.json" },
  { platform: "darwin", file: "E7-darwin.json" },
  { platform: "win32", file: "E7-windows.json" },
]
const osSupport = OS_LEGS.map(({ platform, file }) => {
  const ev = readJson<any>(`validation/m25/results/${file}`)
  return {
    platform,
    status: ev.status,
    passes: ev.passed ?? null,
    mutantsCaught: ev.mutantsCaught ?? null,
    evidenceFile: `validation/m25/results/${file}`,
    reason: ev.blockedReason ?? null,
  }
})

// Publishing state (M25.E4): a real packaging run, publish blocked on credentials.
const publish = readJson<any>("validation/m25/results/E4-openvsx.json")
const installBlock = readme.slice(readme.indexOf("## Install and verify"))
const installCommand = (installBlock.match(/^code --install-extension .+$/m) ?? [])[0] ?? ""
const freshProfileCommand = (installBlock.match(/^code --user-data-dir .+$/m) ?? [])[0] ?? ""
must(installCommand.length > 0 && freshProfileCommand.length > 0, "README install commands not found")

// Declared drifts: documentation statements that disagree with the recorded
// evidence. Rendered on the page, never hidden, and machine-checked.
const declaredDrift: { topic: string; docValue: string; docSource: string; evidenceValue: string; evidenceSource: string }[] = []
for (const editor of editors) {
  const docRow = readmeEditorRows.find((r) => r.name === editor.name)!
  if (editor.pinnedVersion && !docRow.claimText.includes(editor.pinnedVersion)) {
    const documented = /pinned ([0-9][^,)]*)/.exec(docRow.claimText)?.[1] ?? "(none)"
    declaredDrift.push({
      topic: `${editor.name} pinned version`,
      docValue: documented,
      docSource: README_REL,
      evidenceValue: editor.pinnedVersion,
      evidenceSource: editor.evidenceFile,
    })
  }
}

// Integrations (Zed / Helix / JetBrains) — launch facts from their own configs.
const zedToml = read("ide/zed/bb-lsp/extension.toml")
const zedLanguages = (/(?<=languages = \[)[^\]]+/.exec(zedToml) ?? [""])[0]
  .split(",")
  .map((s) => s.trim().replace(/"/g, ""))
  .filter(Boolean)
const helixToml = read("ide/helix/languages.toml")
const helixLanguages = [...helixToml.matchAll(/\[\[language\]\]\nname = "([^"]+)"/g)].map((m) => m[1]!)
const helixCommand = /\[language-server\.bb-lsp\]\ncommand = "([^"]+)"\nargs = \[ ([^\]]+) \]/.exec(helixToml)
const lsp4ij = readJson<any>("ide/lsp4ij/bb-lsp/template.json")

const integrations = [
  {
    id: "vscode",
    name: "VS Code (and VS Code forks)",
    kind: "bundled extension",
    languages: (pkg.activationEvents as string[]).map((e: string) => e.replace("onLanguage:", "")),
    configFile: "ide/vscode/package.json",
    launch: "bundled server, resolved at activation (dist-bundled; a source fallback is declared, never silent)",
    install: installCommand,
  },
  {
    id: "zed",
    name: "Zed",
    kind: "wasm shim extension",
    languages: zedLanguages,
    configFile: "ide/zed/bb-lsp/extension.toml",
    launch: numbered(read("ide/zed/bb-lsp/README.md"), "## Resolution order").join(" "),
    install: "zed --install-extension <checkout>/ide/zed/bb-lsp",
  },
  {
    id: "helix",
    name: "Helix",
    kind: "languages.toml entry",
    languages: helixLanguages,
    configFile: "ide/helix/languages.toml",
    launch: helixCommand ? `${helixCommand[1]} ${unbacktick(helixCommand[2]!)}` : "",
    install: "append ide/helix/languages.toml to ~/.config/helix/languages.toml (edit the server path)",
  },
  {
    id: "jetbrains",
    name: "JetBrains via LSP4IJ",
    kind: "user-defined server template",
    languages: (lsp4ij.fileTypeMappings as any[]).map((m) => m.languageId),
    configFile: "ide/lsp4ij/bb-lsp/template.json",
    launch: unbacktick(lsp4ij.programArgs.default),
    install: "LSP4IJ → Language Servers → Import from custom template (ide/lsp4ij/bb-lsp/)",
  },
]
for (const integration of integrations) must(integration.languages.length > 0, `${integration.id} declares no languages`)

// Stills: real probes from the verified M45 capture corpus, copied verbatim.
const sessionRel = "validation/m45/results/demo-session/D1-session-raw.json"
const session = readJson<any>(sessionRel)
const beatOf = (name: string) => (session.observedTimeline?.beats ?? []).find((b: any) => b.name === name)
// The take records the desktop it was grabbed from (2560x1600 at scale 2, i.e.
// a 1280x800 logical window). The /editors viewer renders each frame at 1x
// logical scale; it can only say that honestly if it knows the ratio, so the
// capture geometry travels with the still instead of being hard-coded in copy.
const takeGrab = String(session.take?.grab ?? "")
const takeScale = Number(session.take?.scale ?? 0)
const captureGeometry = (() => {
  const m = /^(\d+)x(\d+)$/.exec(takeGrab)
  must(m && takeScale > 0, `session take grab/scale unreadable: grab=${takeGrab} scale=${takeScale}`)
  return {
    device: `${m![1]}x${m![2]}`,
    scale: takeScale,
    logical: `${Number(m![1]) / takeScale}x${Number(m![2]) / takeScale}`,
  }
})()

const STILL_SPECS: { file: string; title: string; beat: string }[] = [
  { file: "probes/01-establish.png", title: "The index, attached", beat: "establish" },
  { file: "probes/02-hover-place.png", title: "Hover with evidence tier", beat: "hover-place" },
  { file: "probes/03-goto-def.png", title: "Go to definition", beat: "goto-def" },
  { file: "probes/05-references.png", title: "Find references", beat: "references" },
]
const stills = STILL_SPECS.map((spec) => {
  const sourceRel = `validation/m45/results/demo-session/${spec.file}`
  const sourceAbs = path.join(ROOT, sourceRel)
  must(existsSync(sourceAbs), `still source missing: ${sourceRel}`)
  const bytes = readFileSync(sourceAbs)
  const beat = beatOf(spec.beat)
  must(beat, `no observed beat named ${spec.beat} in ${sessionRel}`)
  const name = path.basename(spec.file)
  return {
    id: spec.beat,
    title: spec.title,
    caption: beat.what as string,
    observed: beat.observed as string,
    source: sourceRel,
    sourceSha256: sha256(bytes),
    sourceBytes: bytes.length,
    publicPath: `/editors/${name}`,
    bytes: bytes.length,
    sessionEvidence: sessionRel,
    sessionCommit: session.currentCommit as string,
    take: `${session.take?.grab ?? "?"} @ ${session.take?.fps ?? "?"}fps, ${session.take?.seconds ?? "?"}s`,
    capture: captureGeometry,
  }
})

// --- assembled facts ----------------------------------------------------------

const extension = {
  name: pkg.name as string,
  displayName: pkg.displayName as string,
  description: pkg.description as string,
  version: pkg.version as string,
  engineVscode: (pkg.engines?.vscode ?? "") as string,
  activationLanguages: integrations[0]!.languages,
  commands: (pkg.contributes?.commands ?? []).map((c: any) => ({ id: c.command as string, title: c.title as string })),
  settings: Object.entries(pkg.contributes?.configuration?.properties ?? {}).map(([key, value]: [string, any]) => ({
    key,
    type: (value.type ?? "") as string,
    default: value.default === undefined ? "" : String(value.default),
    meaning: (value.description ?? "") as string,
  })),
  minServerVersion: String(pkg.contributes?.configuration?.properties?.["bbLsp.minServerVersion"]?.default ?? ""),
}

const facts = {
  schemaVersion: 1,
  generatedBy: "npx tsx script/m56/generate-editors.ts --write",
  generatedFrom: [
    README_REL,
    "ide/vscode/src/status-model.ts",
    "src/lsp/launch_languages.ts",
    "ide/vscode/package.json",
    "docs/m24/TOOL-DOC.md",
    ledgerSource,
    "validation/m25/results/{E5,F-CURSOR,F-ANTIGRAVITY,F-WINDSURF,E7-linux,E7-darwin,E7-windows,E4-openvsx}.json",
    "ide/zed/bb-lsp/extension.toml",
    "ide/helix/languages.toml",
    "ide/lsp4ij/bb-lsp/template.json",
    sessionRel,
  ],
  extension,
  launchLanguages,
  launchLanguagesSource: "src/lsp/launch_languages.ts",
  unclaimedLaunchLanguages,
  shippedClaims,
  shippedClaimSources: [README_REL, "ide/vscode/src/status-model.ts", "docs/m24/TOOL-DOC.md"],
  extensionClaims,
  shippedClaimLegend,
  statusLevelLegend,
  precision,
  precisionSource: ledgerSource,
  precisionNotRecorded,
  giantScale: ledger.giantScale,
  editors,
  osSupport,
  publishing: {
    recordPath: "validation/m25/results/E4-openvsx.json",
    artifactPath: publish.artifact as string,
    extensionVersion: publish.extensionVersion as string,
    targetRegistry: publish.targetRegistry as string,
    blocked: Boolean(publish.blocked),
    reason: publish.reason as string,
    publishCommand: publish.publishCommand as string,
    installCommand,
    freshProfileCommand,
  },
  exclusions: (() => {
    const m = /No completion, no diagnostics, no rename/.exec(readme)
    must(m, "README exclusion sentence not found")
    return ["no completion", "no diagnostics", "no rename"]
  })(),
  complementStance: bullets(readme, "## Complement stance (contract §7)"),
  hoverActions: bullets(readme, "### Hover actions (M42.H4)"),
  versionMatrix: headingTable(readme, "## Version compatibility matrix (extension ↔ server)").map((row) => ({
    extension: unbacktick(row[0]!),
    minServer: unbacktick(row[1]!),
    notes: unbacktick(row[2]!),
  })),
  settingsDocRows: headingTable(readme, "## Settings").map((row) => ({
    key: unbacktick(row[0]!),
    default: unbacktick(row[1]!),
    meaning: unbacktick(row[2]!),
  })),
  integrations,
  stills,
  limitations: bullets(readme, "## Limitations (declared, contract §1)"),
  declaredDrift,
}

// --- emit ---------------------------------------------------------------------

const header = `// AUTO-GENERATED by script/m56/generate-editors.ts - DO NOT EDIT BY HAND.
//
// The /editors page is derived from the real claim chain: the extension README
// and status model, the M24 tool doc, the M29 precision ledger, the M25 editor
// and OS evidence files, the per-editor integration configs, and the verified
// M45 capture corpus (stills are copied byte-identically and sha-pinned here).
// Every field below traces to one of the sources listed in generatedFrom.

export const EDITOR_FACTS = ${JSON.stringify(facts, null, 2)}

export type EditorFacts = typeof EDITOR_FACTS
`
const emitted = header

// Stills are copied byte-identically so the sha recorded above stays true.
mkdirSync(STILLS_DIR, { recursive: true })
for (const still of stills) {
  const target = path.join(ROOT, STILLS_REL, path.basename(still.publicPath))
  const needsCopy = !existsSync(target) || sha256(readFileSync(target)) !== still.sourceSha256
  if (WRITE && needsCopy) copyFileSync(path.join(ROOT, still.source), target)
}

const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : ""
const missingStills = stills.filter((s) => {
  const target = path.join(ROOT, STILLS_REL, path.basename(s.publicPath))
  return !existsSync(target) || sha256(readFileSync(target)) !== s.sourceSha256
})

if (WRITE) {
  writeFileSync(OUT, emitted)
  console.log(`EDS: wrote ${OUT_REL} (${facts.stills.length} stills, ${facts.editors.length} editors)`)
  process.exit(0)
}

const problems: string[] = []
if (current !== emitted) problems.push(`${OUT_REL} is stale - run npx tsx script/m56/generate-editors.ts --write`)
for (const s of missingStills) problems.push(`still missing or corrupted: ${STILLS_REL}/${path.basename(s.publicPath)}`)
if (problems.length > 0) {
  for (const p of problems) console.error(`FAIL: ${p}`)
  process.exit(1)
}
console.log(`EDS: PASS (${OUT_REL} in sync, ${stills.length} stills verified, ${editors.length} editors, ${precision.length} ledger rows)`)
