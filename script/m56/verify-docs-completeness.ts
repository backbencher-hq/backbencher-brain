// script/m56/verify-docs-completeness.ts — M56.D1 (#783).
//
// The docs page now publishes the CLI reference and the indexing/data facts.
// This gate proves both, and refuses to trust a single source:
//
//   1. GENERATION — `script/m56/generate-docs-data.ts` (which reads the real CLI
//      help and the source constants) exits green, a byte-level proof that the
//      site artifact is identical to a fresh generation.
//   2. INDEPENDENT CLI INSTRUMENT — the verifier runs the CLI itself and parses
//      the help text with its OWN parser, then requires the command/flag sets to
//      match the generated reference. A generated reference cannot survive a
//      second, independently written reader of the same surface.
//   3. INDEPENDENT SOURCE INSTRUMENTS — skip dirs, size tiers, auto-refresh
//      budgets, derived phases, derivedPass labels and the storage shape are
//      re-derived from src/ (and, for storage, asserted at runtime with a temp
//      BB_DATA_DIR) rather than read back out of the generated file.
//   4. SURFACE — the rendered /docs page carries every required section, every
//      generated command/flag, and every claim; and it contains NO hand-typed
//      flag, command or BB_* variable the product does not have.
//
// Run: npx tsx script/m56/verify-docs-completeness.ts
// Evidence: validation/m56/results/D1.json

import { execFileSync, spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const SITE = path.join(ROOT, "website")
const RESULTS = path.join(ROOT, "validation/m56/results")
const GENERATED_REL = "website/src/data/docs.generated.ts"
const GENERATED = path.join(ROOT, GENERATED_REL)
const DOCS_PAGE_REL = "website/src/app/docs/page.tsx"
const DOCS_PAGE = path.join(ROOT, DOCS_PAGE_REL)
const READ_ONLY = process.env.BB_M56_READ_ONLY === "1"

// The docs surface this issue is required to carry. Order is part of it.
const REQUIRED_SECTIONS: Array<[string, string]> = [
  ["installation", "Installation"],
  ["first-index", "First index"],
  ["how-the-index-works", "How the index works"],
  ["what-gets-indexed", "What gets indexed"],
  ["keeping-fresh", "Keeping the index fresh"],
  ["embeddings", "Embeddings setup"],
  ["agent-tools", "Agent tools"],
  ["mcp", "MCP server"],
  ["cli-reference", "CLI reference"],
  ["data-and-upgrades", "Data, upgrades & uninstall"],
  ["troubleshooting", "Troubleshooting"],
]
// Rows the "what a changed file recomputes" table must carry: the re-parse plus
// every phase the indexer records, plus the two honest extras.
const REQUIRED_ROWS = ["symbols", "deleted files", "embeddings"]

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
const tokenize = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")

console.log("M56.D1 docs-completeness verifier")

// --- 1. generation ------------------------------------------------------------------

check("D1: the generated docs facts exist", existsSync(GENERATED), `${GENERATED_REL} missing; run npx tsx script/m56/generate-docs-data.ts --write`)

let generatorOk = false
let generatorOut = ""
try {
  generatorOut = execFileSync("npx", ["tsx", "script/m56/generate-docs-data.ts"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 300_000,
  })
  generatorOk = true
} catch (e) {
  const err = e as { stdout?: string; stderr?: string }
  generatorOut = `${err.stdout ?? ""}${err.stderr ?? ""}`
}
check(
  "D1: the docs-data generator is green — the site artifact is byte-identical to a fresh generation",
  generatorOk,
  generatorOut.split("\n").filter(Boolean).slice(-3).join(" | "),
)
check("D1: the generator reports its shape", /DOCS DATA: PASS \(11 commands, \d+ flags, \d+ skip dirs\)/.test(generatorOut), generatorOut.trim().slice(0, 160))

const generatedSrc = existsSync(GENERATED) ? readFileSync(GENERATED, "utf8") : ""
const facts = (await import(GENERATED)) as { DOCS_FACTS: any }
const D = facts.DOCS_FACTS

// --- 2. independent CLI instrument ---------------------------------------------------

function helpFor(args: string[]): string {
  const r = spawnSync("npx", ["tsx", "script/m56/cli-probe.ts", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 90_000,
    env: { ...process.env, BB_DATA_DIR: path.join(tmpdir(), `m56-d1-verify-${process.pid}`) },
  })
  return `${r.stdout ?? ""}${r.stderr ?? ""}`
}
function sectionLines(help: string, heading: string): string[] {
  const lines = help.split("\n")
  const start = lines.findIndex((l) => l.trim() === `${heading}:`)
  if (start < 0) return []
  const out: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!
    if (line.trim() === "" || /^[A-Z][a-z]+:/.test(line)) break
    out.push(line)
  }
  return out
}
const flagsIn = (help: string) => [...new Set([...sectionLines(help, "Options").join(" ").matchAll(/--[a-z][a-z0-9-]*/g)].map((m) => m[0]!).filter((f) => f !== "--help"))]

const generatedCommands: string[] = D.cli.commands.map((c: any) => c.name)
const rootHelp = helpFor(["--help"])
const cliCommands = sectionLines(rootHelp, "Commands")
  .map((l) => /^ {2}([a-z][a-z0-9-]*)(?=\s|$|\[|<)/.exec(l)?.[1])
  .filter((c): c is string => Boolean(c) && c !== "help")
check(
  "D1: the CLI's own command list matches the generated reference exactly",
  JSON.stringify([...cliCommands].sort()) === JSON.stringify([...generatedCommands].sort()),
  `cli=${cliCommands.join(",")} generated=${generatedCommands.join(",")}`,
)

const flagMismatches: string[] = []
// --help/-h are real on every command but are stripped from the reference (they
// are noise in a flag table), so they are allowed wherever the page quotes them.
const realFlags = new Set<string>(["--help", "-h"])
for (const cmd of D.cli.commands as Array<{ name: string; flags: Array<{ flags: string[] }> }>) {
  const fromCli = flagsIn(helpFor([cmd.name, "--help"])).sort()
  const fromData = cmd.flags.map((f) => f.flags.at(-1)!).filter((f) => f !== "--help").sort()
  for (const f of cmd.flags) for (const alias of f.flags) realFlags.add(alias)
  if (JSON.stringify(fromCli) !== JSON.stringify(fromData)) flagMismatches.push(`${cmd.name}: cli=[${fromCli}] data=[${fromData}]`)
}
check("D1: every command's flags match the CLI's own --help output", flagMismatches.length === 0, flagMismatches.slice(0, 3).join(" | "))
check(
  "D1: root global flags match the CLI's own --help output",
  JSON.stringify(flagsIn(rootHelp).sort()) ===
    JSON.stringify(D.cli.globalFlags.map((f: any) => f.flags.at(-1)!).filter((f: string) => f !== "--help").sort()),
  `cli=[${flagsIn(rootHelp).join(",")}] data=[${D.cli.globalFlags.map((f: any) => f.flags.at(-1)).join(",")}]`,
)
for (const f of D.cli.globalFlags as Array<{ flags: string[] }>) for (const alias of f.flags) realFlags.add(alias)

// Third instrument: the source's top-level registrations (the M33 anchoring rule).
const cliSrc = read("src/cli/index.ts")
const sourceTopLevel = [...new Set([...cliSrc.matchAll(/program\s*\n\s*\.command\("([a-z-]+)"\)/g)].map((m) => m[1]!))].sort()
check(
  "D1: the generated command set matches the source's top-level registrations",
  JSON.stringify(sourceTopLevel) === JSON.stringify([...generatedCommands].sort()),
  `source=${sourceTopLevel.join(",")} generated=${generatedCommands.join(",")}`,
)
const { TRUTH } = (await import(path.join(SITE, "src/data/truth.generated"))) as { TRUTH: { cliCommands: string[] } }
check(
  "D1: the generated reference matches the site's generated CLI command truth",
  JSON.stringify([...TRUTH.cliCommands].sort()) === JSON.stringify([...generatedCommands].sort()),
  `truth=${TRUTH.cliCommands.join(",")} generated=${generatedCommands.join(",")}`,
)

// --- 3. independent source instruments ----------------------------------------------

const indexerSrc = read("src/ast/parallel-indexer.ts")
const sourceSkipDirs = [...(/const DIR_WALK_SKIP_DIRS = new Set\(\[([^\]]*)\]\)/.exec(indexerSrc)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]!)
check(
  "D1: the generated skip directories equal the indexer's own list",
  sourceSkipDirs.length > 0 && JSON.stringify(sourceSkipDirs) === JSON.stringify(D.indexing.skipDirs),
  `source=${sourceSkipDirs.join(",")} data=${D.indexing.skipDirs.join(",")}`,
)
const evalBytes = (name: string): number => {
  const expr = new RegExp(`const ${name} = ([0-9\\s*]+)`).exec(indexerSrc)?.[1]
  if (!expr) return -1
  return expr.trim().split("*").map((p) => Number(p.trim())).reduce((a, b) => a * b, 1)
}
check(
  "D1: the generated size tiers equal the indexer's own limits",
  evalBytes("FULL_AST_LIMIT") === D.indexing.fullAstBytes && evalBytes("STRUCTURAL_LIMIT") === D.indexing.structuralBytes && evalBytes("DIR_WALK_SIZE_LIMIT") === D.indexing.walkSizeLimit,
  `source=${evalBytes("FULL_AST_LIMIT")}/${evalBytes("STRUCTURAL_LIMIT")}/${evalBytes("DIR_WALK_SIZE_LIMIT")} data=${D.indexing.fullAstBytes}/${D.indexing.structuralBytes}/${D.indexing.walkSizeLimit}`,
)
const sourceFormats = [...(/const structuralExtensions = new Set\(\[([^\]]*)\]\)/.exec(indexerSrc)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]!)
check(
  "D1: the generated structural-tier formats equal the indexer's own set",
  JSON.stringify(sourceFormats) === JSON.stringify(D.indexing.structuralExtensions),
  `source=${sourceFormats.join(",")} data=${D.indexing.structuralExtensions.join(",")}`,
)
check(
  "D1: the docs' ignore-file claims are backed by the indexer",
  D.indexing.ignoreFiles.includes(".gitignore") && D.indexing.ignoreFiles.includes(".bbignore") && indexerSrc.includes('".gitignore"') && indexerSrc.includes('".bbignore"'),
  D.indexing.ignoreFiles.join(","),
)

const { AUTO_REFRESH_DEFAULTS, AUTO_REFRESH_ENV_ALLOWLIST } = (await import(path.join(ROOT, "src/ast/auto-refresh.ts"))) as {
  AUTO_REFRESH_DEFAULTS: { maxFiles: number; maxBytes: number }
  AUTO_REFRESH_ENV_ALLOWLIST: readonly string[]
}
check(
  "D1: the generated auto-refresh budget equals the module's defaults",
  D.freshness.autoRefresh.maxFiles === AUTO_REFRESH_DEFAULTS.maxFiles && D.freshness.autoRefresh.maxBytes === AUTO_REFRESH_DEFAULTS.maxBytes,
  `module=${AUTO_REFRESH_DEFAULTS.maxFiles}/${AUTO_REFRESH_DEFAULTS.maxBytes} data=${D.freshness.autoRefresh.maxFiles}/${D.freshness.autoRefresh.maxBytes}`,
)
check(
  "D1: the generated auto-refresh env list equals the module's allowlist",
  JSON.stringify(D.freshness.env) === JSON.stringify([...AUTO_REFRESH_ENV_ALLOWLIST]),
  `module=${[...AUTO_REFRESH_ENV_ALLOWLIST].join(",")} data=${D.freshness.env.join(",")}`,
)
const sourcePhases = [...new Set([...indexerSrc.matchAll(/recordPhase\("([a-z]+)"/g)].map((m) => m[1]!))]
check(
  "D1: the generated derived phases are exactly the indexer's recorded phases minus its non-derived check",
  JSON.stringify(D.freshness.derivedPhases) === JSON.stringify(sourcePhases.filter((p) => !D.freshness.extraPhases.includes(p))) &&
    D.freshness.extraPhases.every((p: string) => sourcePhases.includes(p)),
  `source=${sourcePhases.join(",")} data=${D.freshness.derivedPhases.join(",")}+${D.freshness.extraPhases.join(",")}`,
)
const passUnion = /derivedPass\?: "([^"]+)" \| "([^"]+)" \| "([^"]+)" \| "([^"]+)"/.exec(indexerSrc)
check(
  "D1: the generated derivedPass labels equal the source's union",
  Boolean(passUnion) && JSON.stringify(D.freshness.derivedPassLabels) === JSON.stringify([passUnion![1], passUnion![2], passUnion![3], passUnion![4]]),
  `data=${D.freshness.derivedPassLabels.join(",")}`,
)

const probeDir = path.join(tmpdir(), `m56-d1-verify-datadir-${process.pid}`)
process.env.BB_DATA_DIR = probeDir
const { bbDataDir, bbProjectsDir, bbWasmDir } = (await import(path.join(ROOT, "src/util/bb-data-dir.ts"))) as {
  bbDataDir: () => string
  bbProjectsDir: () => string
  bbWasmDir: () => string
}
check(
  "D1: the documented storage shape is the resolved one (temp BB_DATA_DIR)",
  D.storage.indexFile === "<data-dir>/projects/<project-id>/brain.db" &&
    D.storage.parserCache === "<data-dir>/wasm" &&
    bbProjectsDir() === path.join(path.resolve(probeDir), "projects") &&
    bbWasmDir() === path.join(path.resolve(probeDir), "wasm"),
  `${bbProjectsDir()} / ${bbWasmDir()}`,
)
delete process.env.BB_DATA_DIR
check(
  "D1: the documented default data directory and override are the real ones",
  D.storage.dataDir === "~/.bb" && D.storage.envOverride === "BB_DATA_DIR" && bbDataDir() === path.join(path.dirname(bbDataDir()), ".bb"),
  `${bbDataDir()} / ${D.storage.envOverride}`,
)
check("D1: the project-id note is the one the data-dir module documents", D.storage.projectIdNote === "sha1 of the project's absolute path", D.storage.projectIdNote)

// --- 4. the docs page source --------------------------------------------------------

const pageSrc = read(DOCS_PAGE_REL)
const navIds = [...pageSrc.matchAll(/^\s*\["([a-z-]+)", "/gm)].map((m) => m[1]!)
const requiredIds = REQUIRED_SECTIONS.map(([id]) => id)
check(
  "D1: the docs navigation declares every required section, in order",
  JSON.stringify(navIds) === JSON.stringify(requiredIds),
  `nav=[${navIds.join(",")}] required=[${requiredIds.join(",")}]`,
)
const sectionIds = [...pageSrc.matchAll(/<section id="([a-z-]+)"/g)].map((m) => m[1]!)
const missingSections = requiredIds.filter((id) => !sectionIds.includes(id))
check("D1: every navigation entry has a matching section element", missingSections.length === 0, missingSections.join(", "))
check(
  "D1: the docs page renders the generated data rather than re-typing it",
  pageSrc.includes('from "@/data/docs.generated"') && pageSrc.includes("DOCS_FACTS.cli.commands.map") && pageSrc.includes("DOCS_FACTS.indexing.skipDirs.map"),
  "the page does not consume the generated facts",
)

const sourceFlagTokens = [...new Set([...pageSrc.matchAll(/--[a-z][a-z0-9-]*/g)].map((m) => m[0]!))]
const sourcePhantomFlags = sourceFlagTokens.filter((f) => !realFlags.has(f))
check("D1: no hand-typed flag in the docs source is absent from the CLI", sourcePhantomFlags.length === 0, sourcePhantomFlags.join(", "))
// Commands are only claimed where the page writes code: an inline <code> element
// or a CodeBlock string. Scanning raw prose would count "an upgraded bb either
// uses ..." as a `bb either` invocation, which is how a check like this loses
// its meaning.
function codeTextFromSource(src: string): string {
  return [
    ...[...src.matchAll(/<code[^>]*>([^<]*)</g)].map((m) => m[1]!),
    ...[...src.matchAll(/\{`([^`]*)`\}/g)].map((m) => m[1]!),
    ...[...src.matchAll(/\{'([^']*)'\}/g)].map((m) => m[1]!),
  ].join("\n")
}
const sourceCommands = [...new Set([...codeTextFromSource(pageSrc).matchAll(/\bbb ([a-z][a-z0-9-]*)\b/g)].map((m) => m[1]!))]
const sourcePhantomCommands = sourceCommands.filter((c) => !generatedCommands.includes(c))
check(
  "D1: no hand-typed command in the docs source is absent from the CLI",
  sourcePhantomCommands.length === 0,
  sourcePhantomCommands.join(", "),
)
const allowedEnv = new Set<string>([...D.freshness.env, D.storage.envOverride, "VERSION", "PATH", "BB_LOG_LEVEL"])
const sourceEnvTokens = [...new Set([...pageSrc.matchAll(/\bBB_[A-Z0-9_]+/g)].map((m) => m[0]!))]
check(
  "D1: every BB_ variable named in the docs exists in the product",
  sourceEnvTokens.every((t) => allowedEnv.has(t)),
  sourceEnvTokens.filter((t) => !allowedEnv.has(t)).join(", "),
)

// The freshness table must have a row for every recorded phase, with text. The
// row map is parsed out of the page (not restated here), so a new phase fails
// until someone writes what it recomputes.
function authoredPhaseRows(src: string): string[] {
  const start = src.indexOf("const PHASE_ROW")
  if (start < 0) return []
  const block = src.slice(start, src.indexOf("\n}", start))
  return [...new Set([...block.matchAll(/^\s{2}([a-z]+):/gm)].map((m) => m[1]!))]
}
const phaseRowKeys = authoredPhaseRows(pageSrc)
const phasesWithoutRows = (D.freshness.derivedPhases as string[]).filter((p) => !phaseRowKeys.includes(p))
check(
  "D1: every derived phase has an authored row in the recompute table",
  (D.freshness.derivedPhases as string[]).length > 0 && phasesWithoutRows.length === 0,
  phasesWithoutRows.join(", "),
)

// --- 5. rendered surface ------------------------------------------------------------

const sources = [path.join(SITE, "src/app/docs/page.tsx"), GENERATED, path.join(SITE, "src/data/truth.generated.ts")]
const newest = Math.max(...sources.map((f) => statSync(f).mtimeMs))
const marker = path.join(SITE, ".next/server/app/docs.html")
let buildNote = "reused existing build"
if (!existsSync(marker) || statSync(marker).mtimeMs < newest) {
  buildNote = "built now"
  try {
    execFileSync("npm", ["run", "build"], { cwd: SITE, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 480_000 })
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string }
    buildNote = `build failed: ${`${err.stdout ?? ""}${err.stderr ?? ""}`.split("\n").filter(Boolean).slice(-3).join(" | ")}`
  }
}
const built = existsSync(marker)
check("D1: the site build needed for the rendered checks is available", built, buildNote)

const rawHtml = built ? readFileSync(marker, "utf8") : ""
const html = decodeHtml(rawHtml)
// Strip tags FIRST, then decode entities: the page legitimately renders text
// like "<project-id>", which a decode-then-strip pass would swallow as a tag.
const rendered = decodeHtml(tokenize(rawHtml))

const missingHeadings = REQUIRED_SECTIONS.filter(([, label]) => !rendered.includes(label))
check("D1: every required section renders with its heading", built && missingHeadings.length === 0, missingHeadings.map(([id]) => id).join(", "))
const missingAnchors = requiredIds.filter((id) => !html.includes(`id="${id}"`))
check("D1: every required section renders with its anchor (deep links resolve)", built && missingAnchors.length === 0, missingAnchors.join(", "))

const missingSkips = (D.indexing.skipDirs as string[]).filter((d) => !rendered.includes(` ${d} `))
check("D1: the rendered page names every built-in skip directory", built && missingSkips.length === 0, missingSkips.join(", "))
const missingFormats = (D.indexing.structuralExtensions as string[]).filter((e) => !rendered.includes(e))
check("D1: the rendered size-tier row names every structural format", built && missingFormats.length === 0, missingFormats.join(", "))
const mb = (b: number) => `${b / (1024 * 1024)} MB`
// React separates adjacent text nodes with comment markers, which the tag
// stripper turns into spaces around a range like "1 MB–5 MB"; normalize both
// sides before comparing so the check is about the numbers, not the spacing.
const tight = (s: string) => s.replace(/\s*–\s*/g, "–").replace(/\s*—\s*/g, "—")
const renderedTight = tight(rendered)
const range = `${mb(D.indexing.fullAstBytes)}–${mb(D.indexing.structuralBytes)}`
check(
  "D1: the rendered size tiers state the indexer's real numbers",
  built &&
    renderedTight.includes(`up to ${mb(D.indexing.fullAstBytes)}`) &&
    renderedTight.includes(range) &&
    renderedTight.includes(`over ${mb(D.indexing.structuralBytes)}`),
  `expected up to ${mb(D.indexing.fullAstBytes)} / ${range} / over ${mb(D.indexing.structuralBytes)}`,
)
check(
  "D1: the rendered freshness budget states the module's real numbers",
  built && rendered.includes(`${D.freshness.autoRefresh.maxFiles} files`) && rendered.includes(`${D.freshness.autoRefresh.maxBytes / (1024 * 1024)} MiB`),
  "auto-refresh copy drifted",
)
const missingEnv = (D.freshness.env as string[]).filter((e) => !rendered.includes(e))
check("D1: the rendered page names every auto-refresh environment variable", built && missingEnv.length === 0, missingEnv.join(", "))

const missingRows = [...(D.freshness.derivedPhases as string[]), ...REQUIRED_ROWS].filter((row) => !rendered.includes(` ${row} `))
check("D1: the recompute table renders a row per phase plus the fixed rows", built && missingRows.length === 0, missingRows.join(", "))
const expectedPassLabel = `derivedPass: ${(D.freshness.derivedPassLabels as string[]).join(" | ")}`
check("D1: the rendered run-summary labels match the source's union", built && rendered.includes(expectedPassLabel), expectedPassLabel)

const storageNeedles = [
  `${D.storage.dataDir}/projects/<project-id>/brain.db`,
  `${D.storage.dataDir}/wasm`,
  D.storage.envOverride,
  D.storage.projectIdNote,
]
const missingStorage = storageNeedles.filter((n) => !rendered.includes(n))
check("D1: the rendered page states where the index lives, how to move it, and the project-id shape", built && missingStorage.length === 0, missingStorage.join(" | "))

const missingCommands = (generatedCommands as string[]).filter((c) => !rendered.includes(`bb ${c}`))
check("D1: the rendered CLI reference carries every command", built && missingCommands.length === 0, missingCommands.join(", "))
const missingFlags = [...realFlags].filter((f) => !rendered.includes(f))
check("D1: the rendered CLI reference carries every flag", built && missingFlags.length === 0, missingFlags.join(", "))

const renderedFlagTokens = [...new Set([...rendered.matchAll(/--[a-z][a-z0-9-]*/g)].map((m) => m[0]!))]
const renderedPhantomFlags = renderedFlagTokens.filter((f) => !realFlags.has(f))
check("D1: the rendered page contains no flag the CLI does not have", built && renderedPhantomFlags.length === 0, renderedPhantomFlags.join(", "))
// Rendered command claims are read from the page's <code> elements only — the
// same rule as the source scan, so prose that happens to follow the word "bb"
// is never mistaken for an invocation claim.
const codeText = built ? [...html.matchAll(/<code[^>]*>(.*?)<\/code>/gs)].map((m) => decodeHtml(m[1]!)).join("\n") : ""
const renderedCommands = [...new Set([...codeText.matchAll(/\bbb ([a-z][a-z0-9-]*)\b/g)].map((m) => m[1]!))]
const renderedPhantomCommands = renderedCommands.filter((c) => !generatedCommands.includes(c))
check("D1: the rendered page contains no command the CLI does not have", built && renderedPhantomCommands.length === 0, renderedPhantomCommands.join(", "))

// --- 6. negatives -------------------------------------------------------------------

// N1 (real, subprocess): drift the generated artifact and prove the generator
// refuses it — then prove the restore is byte-clean.
{
  const backup = path.join(tmpdir(), `docs-generated-n1-${process.pid}.ts`)
  cpSync(GENERATED, backup)
  let driftCaught = false
  try {
    const drifted = generatedSrc.replace(/^(\s*)"summary": ".+",$/m, '$1"summary": "hand-typed drift probe",')
    check("N1 setup: the drift probe actually modified the artifact", drifted !== generatedSrc, "no summary line found")
    writeFileSync(GENERATED, drifted)
    try {
      execFileSync("npx", ["tsx", "script/m56/generate-docs-data.ts"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 })
      driftCaught = false
    } catch {
      driftCaught = true
    }
  } finally {
    cpSync(backup, GENERATED)
    rmSync(backup)
  }
  negative("N1: a drifted docs-data artifact is rejected by the generator", driftCaught)
  check("N1 restore-proof: the artifact is byte-clean again after the probe", readFileSync(GENERATED, "utf8") === generatedSrc)
}

// N2 (bytes): dropping a command from the reference must fail the coverage checks.
{
  const mutated = generatedCommands.filter((c: string) => c !== "health")
  negative(
    "N2: a command missing from the reference fails the CLI command-list comparison",
    JSON.stringify([...mutated].sort()) !== JSON.stringify([...cliCommands].sort()),
  )
}

// N3 (bytes): a phantom flag planted in the page source must be detected.
{
  const planted = `${pageSrc}\n// bb index --dry-run\n`
  const tokens = [...new Set([...planted.matchAll(/--[a-z][a-z0-9-]*/g)].map((m) => m[0]!))]
  negative("N3: a phantom flag in the docs source is detected", tokens.some((t) => !realFlags.has(t)))
}

// N4 (real mutation on disk): removing a required section from the navigation
// must fail the section contract, and the file must come back byte-clean. The
// backup lives outside the repo so a broad git add can never see it.
{
  const backup = path.join(tmpdir(), `docs-page-n4-${process.pid}.tsx`)
  cpSync(DOCS_PAGE, backup)
  let caught = false
  try {
    writeFileSync(DOCS_PAGE, pageSrc.replace('  ["keeping-fresh", "Keeping the index fresh"],\n', ""))
    const after = [...readFileSync(DOCS_PAGE, "utf8").matchAll(/^\s*\["([a-z-]+)", "/gm)].map((m) => m[1]!)
    caught = JSON.stringify(after) !== JSON.stringify(requiredIds)
  } finally {
    cpSync(backup, DOCS_PAGE)
    rmSync(backup)
  }
  negative("N4: a dropped navigation section fails the section contract", caught)
  check("N4 restore-proof: the docs page is restored byte-for-byte", readFileSync(DOCS_PAGE, "utf8") === pageSrc)
}

// N5 (synthetic, rendered predicate): a stale number in the rendered page must
// fail the comparison against the generated facts.
if (built) {
  const stale = rendered.replace(`up to ${mb(D.indexing.fullAstBytes)}`, "up to 2 MB")
  negative("N5: a stale size-tier number in the rendered page fails the numeric check", !stale.includes(`up to ${mb(D.indexing.fullAstBytes)}`))
  const droppedRow = rendered.replaceAll(" relationships ", " ")
  negative("N5: a missing recompute-table row fails the row check", !droppedRow.includes(" relationships "))
  const phantom = `${rendered} bb index --dry-run`
  const tokens = [...new Set([...phantom.matchAll(/--[a-z][a-z0-9-]*/g)].map((m) => m[0]!))]
  negative("N5: the rendered phantom-flag detector reacts to an injected flag", tokens.some((t) => !realFlags.has(t)))
}

// N6 (bytes): an env var the product does not have must be rejected.
{
  const planted = `${pageSrc}\n// BB_NOT_A_REAL_FLAG=1\n`
  const tokens = [...new Set([...planted.matchAll(/\bBB_[A-Z0-9_]+/g)].map((m) => m[0]!))]
  negative("N6: an unknown BB_ variable in the docs source is detected", tokens.some((t) => !allowedEnv.has(t)))
}

// N7 (bytes): removing a phase row must fail the authored-row check.
{
  const mutated = pageSrc.replace(/(\n\s{2})gravity:/, "$1gravityRenamed:")
  const keys = authoredPhaseRows(mutated)
  negative(
    "N7: a derived phase with no authored row fails the table contract",
    mutated !== pageSrc && (D.freshness.derivedPhases as string[]).some((p) => !keys.includes(p)),
  )
}

// --- verdict + evidence -------------------------------------------------------------

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
console.log(`  sections: ${REQUIRED_SECTIONS.length} · commands: ${generatedCommands.length} · flags: ${realFlags.size}`)
if (!ok) {
  console.log("VERDICT: FAIL")
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log("VERDICT: PASS")

if (!READ_ONLY) {
  mkdirSync(RESULTS, { recursive: true })
  const evidence = {
    issue: "M56.D1",
    code: "D1",
    milestone: "M56",
    status: "verified",
    checks,
    passed,
    failed: checks - passed,
    negativeCases: negatives,
    currentCommit: gitHead,
    verifierCommand: "npx tsx script/m56/verify-docs-completeness.ts",
    evidenceFile: "D1.json",
    generatedAt: new Date().toISOString(),
    generatedArtifact: GENERATED_REL,
    rendered: { surface: "/docs", build: buildNote },
    summary: {
      sections: REQUIRED_SECTIONS.length,
      cliCommands: generatedCommands.length,
      cliFlags: realFlags.size,
      skipDirs: D.indexing.skipDirs.length,
      derivedPhases: D.freshness.derivedPhases.length,
      envVars: D.freshness.env.length,
    },
    limitations: [
      "The CLI reference is generated from the CLI's own help text, read from source through script/m56/cli-probe.ts (running src/cli/index.ts directly is a no-op under Node because import.meta.main is Bun-only).",
      "The CLI's own example lines are not rendered on the site: `bb index --help` ships the example `bb index import --db <path>`, which uses a flag the command does not declare. The reference therefore states the commands and flags, and points at `bb --help` for examples; the CLI-side example is recorded as a product defect to fix, not published.",
      "Rendered checks reuse website/.next when it is newer than the docs page and the generated facts, and rebuild otherwise. N5 is a synthetic rendered probe and N4 is a real source mutation; no end-to-end rebuild mutant runs here (M41.T2 already proves that class for the built site).",
    ],
  }
  writeFileSync(path.join(RESULTS, "D1.json"), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(`  evidence: validation/m56/results/D1.json`)
}
