// script/m41/generate-site-truth.ts — M41.T1.
//
// Generates website/src/data/truth.generated.ts from the same artifacts the
// closure gates pin. The site may render these values; it may never hand-type
// them. Deterministic output (no timestamps, stable sorts) so `--check` can
// diff byte-wise and CI fails on drift.
//
// Sources of truth (all enforced by existing gates):
//   package.json                -> version
//   docs/data/public-tools.json -> public MCP tools (contract authority, M13)
//   src/mcp/tool-registry.ts    -> cross-reference: every public name must exist there
//   src/brain/schema-ddl.ts     -> table count (CREATE TABLE statements)
//   src/ast/engine.ts           -> SUPPORTED_LANGUAGES map (classified + dedicated parsers)
//   src/cli/index.ts            -> CLI command names (.command("...") registrations)
//
// Fail-closed: any missing or empty source aborts with a non-zero exit —
// never a partial or stale write. Run `--check` to verify the committed file
// is current (byte-identical to a fresh generation).

import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const OUT_PATH = path.join(ROOT, "website/src/data/truth.generated.ts")
const CHECK_MODE = process.argv.includes("--check")

function fail(msg: string): never {
  console.error(`generate-site-truth: FAIL — ${msg}`)
  process.exit(1)
}

function read(rel: string): string {
  try {
    return readFileSync(path.join(ROOT, rel), "utf8")
  } catch (e) {
    fail(`source artifact missing/unreadable: ${rel} (${(e as Error).message})`)
  }
}

// --- version ---------------------------------------------------------------

const pkgRaw = read("package.json")
const pkgVersion: unknown = JSON.parse(pkgRaw).version
if (typeof pkgVersion !== "string" || !/^\d+\.\d+\.\d+/.test(pkgVersion)) {
  fail(`package.json version missing or malformed: ${String(pkgVersion)}`)
}
const version = pkgVersion as string

// --- public MCP tools -------------------------------------------------------

const toolsRaw = read("docs/data/public-tools.json")
const toolsJson = JSON.parse(toolsRaw) as {
  tools?: Array<{
    name?: string
    description?: string
    inputSchema?: { properties?: Record<string, { type?: string; description?: string }>; required?: string[] }
  }>
}
const toolList = toolsJson.tools ?? []
if (toolList.length === 0) fail("public-tools.json has no tools")
for (const t of toolList) {
  if (typeof t.name !== "string" || !t.name.startsWith("bb_")) fail(`bad tool name: ${String(t.name)}`)
  if (typeof t.description !== "string" || t.description.length < 10) fail(`bad description for ${t.name}`)
}
const tools = toolList
  .map((t) => ({
    name: t.name as string,
    description: t.description as string,
    parameters: Object.entries(t.inputSchema?.properties ?? {})
      .map(([pname, p]) => ({
        name: pname,
        type: p.type ?? "any",
        required: (t.inputSchema?.required ?? []).includes(pname),
        description: p.description ?? "",
      }))
      .sort((a, b) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name)),
  }))
  .sort((a, b) => a.name.localeCompare(b.name))

// Cross-reference: every public tool name must appear in the executable
// registry layer (the JSON is the contract authority; the registry is the
// implementation it must match).
const registrySrc = read("src/mcp/tool-registry.ts")
for (const t of tools) {
  if (!registrySrc.includes(`"${t.name}"`)) {
    fail(`public tool ${t.name} not found in src/mcp/tool-registry.ts — JSON and registry disagree`)
  }
}

// --- table count ------------------------------------------------------------

const schemaSrc = read("src/brain/schema-ddl.ts")
const tableCount = (schemaSrc.match(/CREATE TABLE/g) ?? []).length
if (tableCount <= 0) fail("no CREATE TABLE statements found in schema-ddl.ts")

// --- languages ---------------------------------------------------------------

const engineSrc = read("src/ast/engine.ts")
const startMatch = engineSrc.match(/const SUPPORTED_LANGUAGES = \{/)
if (!startMatch || startMatch.index === undefined) fail("SUPPORTED_LANGUAGES block not found in engine.ts")
const blockStart = startMatch.index + startMatch[0].length
const blockEndRel = engineSrc.slice(blockStart).search(/^  \}/m)
if (blockEndRel < 0) fail("SUPPORTED_LANGUAGES block has no closing brace")
const block = engineSrc.slice(blockStart, blockStart + blockEndRel)

// A JS object literal keeps the LAST value for a repeated key, so this parser
// must do the same or it counts a language the engine never resolves.
// `SUPPORTED_LANGUAGES` currently declares `nim` twice — `tree-sitter-nim` at
// src/ast/engine.ts:282 under the heading "a real parser each", then
// `__generic__` at :301 — so a line-counting parser published 51 languages and
// 50 dedicated parsers while the engine resolves 50 keys and 49 grammars, and
// put `nim` in TRUTH.languages.names twice. Counting a shadowed declaration is
// the same failure as reading the first of two CSS custom properties: it
// certifies a value nothing actually uses.
const languageGrammar = new Map<string, string>()
for (const line of block.split("\n")) {
  const m = line.match(/^\s{4}(?:"([a-z-]+)"|([a-z-]+)):\s*"(.+)",\s*$/)
  if (!m) continue
  const name = m[1] ?? m[2]
  if (!name) continue
  languageGrammar.set(name, m[3]!)
}
const languageNames: string[] = [...languageGrammar.keys()]
let dedicated = 0
for (const grammar of languageGrammar.values()) if (grammar !== "__generic__") dedicated++
if (languageNames.length === 0) fail("SUPPORTED_LANGUAGES parsed to zero languages")
languageNames.sort((a, b) => a.localeCompare(b))

// --- CLI commands ------------------------------------------------------------
// Top-level commands only: every top-level registration follows `program\n    .command(...)`;
// subcommands (e.g. `bb setup show`) follow their parent command variable
// (e.g. `setupCmd`), so anchoring on `program` excludes them.
const cliSrc = read("src/cli/index.ts")
const cliCommands = [...new Set([...cliSrc.matchAll(/program\s*\n\s*\.command\("([a-z-]+)"\)/g)].map((m) => m[1]))].sort((a, b) =>
  a.localeCompare(b),
)

// --- installer facts (what the install scripts ACTUALLY serve) -----------------
// Parsed from the shipped install.sh so the install page states reality.
const installSh = read("website/public/install.sh")
const installerVersion = installSh.match(/VERSION="\$\{VERSION:-([0-9][0-9.]*)\}"/)?.[1]
const installerRepo = installSh.match(/REPO="([^"]+)"/)?.[1]
if (!installerVersion || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(installerVersion)) {
  fail(`install.sh default VERSION missing or malformed: ${String(installerVersion)}`)
}
if (!installerRepo || !/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(installerRepo)) {
  fail(`install.sh REPO missing or malformed: ${String(installerRepo)}`)
}
if (cliCommands.length === 0) fail("no .command() registrations found in cli/index.ts")

// --- emit --------------------------------------------------------------------

const generated = `// AUTO-GENERATED by script/m41/generate-site-truth.ts — DO NOT EDIT BY HAND.
// Every value below is derived from the artifacts the M41 gates pin:
//   version         <- package.json
//   tools           <- docs/data/public-tools.json (cross-checked vs src/mcp/tool-registry.ts)
//   tables          <- src/brain/schema-ddl.ts (CREATE TABLE count)
//   languages       <- src/ast/engine.ts SUPPORTED_LANGUAGES
//   cliCommands     <- src/cli/index.ts .command() registrations
// Regenerate: npx tsx script/m41/generate-site-truth.ts
// Verify:     npx tsx script/m41/generate-site-truth.ts --check

export const TRUTH = {
  schemaVersion: 1,
  version: ${JSON.stringify(version)},
  tables: ${tableCount},
  languages: {
    classified: ${languageNames.length},
    dedicatedParsers: ${dedicated},
    names: ${JSON.stringify(languageNames)},
  },
  cliCommands: ${JSON.stringify(cliCommands)},
  install: {
    version: ${JSON.stringify(installerVersion)},
    repo: ${JSON.stringify(installerRepo)},
  },
  tools: ${JSON.stringify(tools, null, 2).split("\n").join("\n  ")},
} as const

export type SiteTruth = typeof TRUTH
`

if (CHECK_MODE) {
  let current: string
  try {
    current = readFileSync(OUT_PATH, "utf8")
  } catch {
    fail(`${path.relative(ROOT, OUT_PATH)} missing — run the generator and commit the output`)
  }
  if (current !== generated) {
    console.error("generate-site-truth: DRIFT — committed truth.generated.ts is stale:")
    console.error("  the artifacts changed but the site data was not regenerated.")
    console.error("  Fix: npx tsx script/m41/generate-site-truth.ts  (then commit)")
    process.exit(1)
  }
  console.log(`generate-site-truth: CHECK OK — ${path.relative(ROOT, OUT_PATH)} matches artifacts`)
  console.log(`  version=${version} tools=${tools.length} tables=${tableCount} languages=${languageNames.length} (dedicated ${dedicated}) cliCommands=${cliCommands.length}`)
} else {
  writeFileSync(OUT_PATH, generated)
  console.log(`generate-site-truth: wrote ${path.relative(ROOT, OUT_PATH)}`)
  console.log(`  version=${version} tools=${tools.length} tables=${tableCount} languages=${languageNames.length} (dedicated ${dedicated}) cliCommands=${cliCommands.length}`)
  console.log("  NOTE: output is deterministic — re-run is a no-op unless artifacts changed.")
}
