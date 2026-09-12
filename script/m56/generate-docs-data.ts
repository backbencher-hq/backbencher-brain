// script/m56/generate-docs-data.ts — M56.D1 (#783).
//
// The docs page publishes two kinds of fact that must never be typed by hand:
// the CLI reference (commands, arguments, flags — the shipped surface) and the
// indexing/data constants (skip dirs, size tiers, auto-refresh budgets, storage
// paths, derived phases). Both have exactly one authoring source:
//
//   CLI help        <- the real CLI, run from source through script/m56/cli-probe.ts
//   src constants   <- src/ast/parallel-indexer.ts, src/ast/auto-refresh.ts,
//                      src/util/bb-data-dir.ts
//
// This generator reads them and writes website/src/data/docs.generated.ts. Two
// independent instruments keep it honest:
//   1. the help text is parsed AND cross-checked against the `.command()` /
//      `.option()` declarations in src/cli/index.ts, so a parser that drops an
//      entry (or a hidden flag) fails instead of quietly shrinking the docs;
//   2. the derived storage shape is proven at runtime against bb-data-dir with a
//      temp BB_DATA_DIR, not read out of a comment.
//
// Deterministic output (no timestamps), so --check can diff byte-wise.
//
// Run: npx tsx script/m56/generate-docs-data.ts          # verify byte-identity
//      npx tsx script/m56/generate-docs-data.ts --write  # regenerate

import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const OUT_REL = "website/src/data/docs.generated.ts"
const WRITE = process.argv.includes("--write")

const problems: string[] = []
const fail = (msg: string): never => {
  console.log(`DOCS DATA: FAIL - ${msg}`)
  process.exit(1)
}

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}

// --- 1. CLI surface, from the real CLI --------------------------------------------

function helpFor(args: string[]): string {
  const r = spawnSync("npx", ["tsx", "script/m56/cli-probe.ts", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 90_000,
    env: { ...process.env, BB_DATA_DIR: path.join(tmpdir(), `m56-d1-probe-${process.pid}`) },
  })
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`
  if (!out.includes("Usage:")) fail(`no help output for: bb ${args.join(" ")} - ${out.trim().slice(0, 120)}`)
  return out
}

type Flag = { flags: string[]; argument: string | null; description: string }
type CliCommand = {
  name: string
  usage: string
  summary: string
  args: Array<{ name: string; description: string }>
  flags: Flag[]
  subcommands: Array<{ name: string; summary: string }>
  examples: string[]
}

function blockOf(help: string, heading: string): string[] {
  const lines = help.split("\n")
  const start = lines.findIndex((l) => l.trim() === `${heading}:`)
  if (start < 0) return []
  const out: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!
    if (line.trim() === "") break
    if (/^[A-Z][a-z]+:/.test(line)) break
    out.push(line)
  }
  return out
}

function parseFlags(help: string): Flag[] {
  const flags: Flag[] = []
  let current: Flag | null = null
  for (const line of blockOf(help, "Options")) {
    if (/^ {2}\S/.test(line)) {
      const parts = line.trim().split(/\s{2,}/)
      const spec = parts[0]!
      const description = parts.slice(1).join(" ").trim()
      const names = [...spec.matchAll(/-{1,2}[a-z][a-z0-9-]*/g)].map((m) => m[0])
      if (names.length === 0) continue
      if (names.includes("--help") || names.includes("-h")) {
        current = null
        continue
      }
      current = { flags: names, argument: spec.match(/<([^>]+)>/)?.[1] ?? null, description }
      flags.push(current)
      continue
    }
    if (current && /^ {4,}\S/.test(line)) current.description = `${current.description} ${line.trim()}`.trim()
  }
  return flags
}

function parseEntries(help: string, heading: string): Array<[string, string]> {
  const entries: Array<[string, string]> = []
  let last: [string, string] | null = null
  for (const line of blockOf(help, heading)) {
    if (/^ {2}\S/.test(line)) {
      const parts = line.trim().split(/\s{2,}/)
      // The name column is a single token; argument/command placeholders keep
      // their brackets ("dir", "query", "show").
      const name = parts[0]!.trim().split(/\s+/)[0]!
      last = [name, parts.slice(1).join(" ").trim()]
      entries.push(last)
      continue
    }
    if (last && /^ {4,}\S/.test(line)) last[1] = `${last[1]} ${line.trim()}`.trim()
  }
  return entries
}

function parseExamples(help: string): string[] {
  return blockOf(help, "Examples")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("$ "))
    .map((l) => l.slice(2).trim())
}

function parseRootHelp(help: string): { commands: string[]; summary: string; globalFlags: Flag[] } {
  const commands = blockOf(help, "Commands")
    .map((l) => /^ {2}([a-z][a-z0-9-]*)(?=\s|$|\[|<)/.exec(l)?.[1])
    .filter((c): c is string => Boolean(c) && c !== "help")
  const usageIdx = help.split("\n").findIndex((l) => l.startsWith("Usage:"))
  const summary = (help.split("\n")[usageIdx + 2] ?? "").trim()
  return { commands, summary, globalFlags: parseFlags(help) }
}

const rootHelp = helpFor(["--help"])
const root = parseRootHelp(rootHelp)

const commands: CliCommand[] = []
for (const name of root.commands) {
  const help = helpFor([name, "--help"])
  const usageLine = help.split("\n").find((l) => l.startsWith("Usage:")) ?? ""
  const lines = help.split("\n")
  const usageIdx = lines.findIndex((l) => l.startsWith("Usage:"))
  const summary = (lines[usageIdx + 2] ?? "").trim()
  commands.push({
    name,
    usage: usageLine.replace(/^Usage:\s*/, "").trim(),
    summary,
    args: parseEntries(help, "Arguments").map(([n, d]) => ({ name: n, description: d })),
    flags: parseFlags(help),
    subcommands: parseEntries(help, "Commands").map(([n, d]) => ({ name: n, summary: d })),
    examples: parseExamples(help),
  })
}

// --- 1b. instrument: the help text must agree with the source declarations --------

// Command declarations are statement-scoped: a top-level command is registered
// on `program` (either as a bare `program` statement or as
// `const xCmd = program.command(...)`), while subcommands are registered on the
// parent variable (`setupCmd.command("show")`). Anchoring on the statement —
// never on the bare `.command(` text — is what keeps `setup show` from being
// counted as a top-level command.

const cliSrc = read("src/cli/index.ts")
const declaredFlags = new Map<string, Set<string>>()
const declaredSubcommands = new Map<string, Set<string>>()
const declaredCommands: string[] = []
const rootFlags = new Set<string>()
const varToCommand = new Map<string, string>()
{
  let owner = "program"
  let currentCmd: string | null = null
  let pendingTop = false
  let pendingVar: string | null = null
  for (const line of cliSrc.split("\n")) {
    if (/^\s*program\s*$/.test(line)) {
      owner = "program"
      currentCmd = null
      continue
    }
    const decl = /^\s*const\s+(\w+)\s*=\s*program\b/.exec(line)
    if (decl) {
      owner = decl[1]!
      currentCmd = null
      pendingTop = true
      pendingVar = decl[1]!
    }
    const cmd = /\.command\("([^"]+)"\)/.exec(line)
    if (cmd) {
      const name = cmd[1]!
      if (owner === "program" || pendingTop) {
        declaredCommands.push(name)
        declaredFlags.set(name, new Set())
        if (pendingVar) varToCommand.set(pendingVar, name)
      } else {
        const parent = varToCommand.get(owner) ?? owner
        if (!declaredSubcommands.has(parent)) declaredSubcommands.set(parent, new Set())
        declaredSubcommands.get(parent)!.add(name)
        declaredFlags.set(name, new Set())
      }
      currentCmd = name
      pendingTop = false
      pendingVar = null
      continue
    }
    const opt = /\.option\("([^"]+)"/.exec(line)
    if (opt) {
      const flag = opt[1]!.split(/[ <]/)[0]!
      if (currentCmd) declaredFlags.get(currentCmd)!.add(flag)
      else rootFlags.add(flag)
    }
  }
  // --version is registered through .version(), not .option().
  if (/\.version\([^)]*"-v,\s*--version"/.test(cliSrc)) rootFlags.add("--version")
}
const declaredSorted = [...declaredCommands].sort()
const helpCommands = commands.map((c) => c.name).sort()
if (JSON.stringify(declaredSorted) !== JSON.stringify(helpCommands)) {
  fail(`commands differ between declarations and help: declared=${declaredSorted.join(",")} help=${helpCommands.join(",")}`)
}
{
  const fromSource = [...rootFlags].filter((f) => f !== "--help" && f !== "-h").sort()
  const fromHelp = root.globalFlags.map((f) => f.flags.at(-1)!).filter((f) => f !== "--help").sort()
  if (JSON.stringify(fromSource) !== JSON.stringify(fromHelp)) {
    fail(`root: global flags differ between declarations and help: declared=${fromSource.join(",")} help=${fromHelp.join(",")}`)
  }
}
for (const cmd of commands) {
  const fromSource = [...(declaredFlags.get(cmd.name) ?? new Set<string>())].filter((f) => f !== "--help" && f !== "-h").sort()
  const fromHelp = cmd.flags.map((f) => f.flags.at(-1)!).filter((f) => f !== "--help").sort()
  if (JSON.stringify(fromSource) !== JSON.stringify(fromHelp)) {
    fail(`${cmd.name}: flags differ between declarations and help: declared=${fromSource.join(",")} help=${fromHelp.join(",")}`)
  }
  const subFromSource = [...(declaredSubcommands.get(cmd.name) ?? new Set<string>())].sort()
  const subFromHelp = cmd.subcommands.map((s) => s.name).sort()
  if (JSON.stringify(subFromSource) !== JSON.stringify(subFromHelp)) {
    fail(`${cmd.name}: subcommands differ between declarations and help: declared=${subFromSource.join(",")} help=${subFromHelp.join(",")}`)
  }
}
const { TRUTH } = (await import(path.join(ROOT, "website/src/data/truth.generated"))) as {
  TRUTH: { cliCommands: string[] }
}
if (JSON.stringify([...TRUTH.cliCommands].sort()) !== JSON.stringify(helpCommands)) {
  fail(`the CLI command list disagrees with generated site truth: truth=${TRUTH.cliCommands.join(",")} cli=${helpCommands.join(",")}`)
}

// --- 2. indexing constants, from src ----------------------------------------------

const indexerSrc = read("src/ast/parallel-indexer.ts")

const skipMatch = /const DIR_WALK_SKIP_DIRS = new Set\(\[([^\]]*)\]\)/.exec(indexerSrc)
if (!skipMatch) fail("DIR_WALK_SKIP_DIRS not found in src/ast/parallel-indexer.ts")
const skipDirs = [...skipMatch[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!)
if (skipDirs.length === 0) fail("DIR_WALK_SKIP_DIRS parsed to zero entries")

const bytesOf = (name: string): number => {
  const m = new RegExp(`const ${name} = ([0-9\\s*]+)`).exec(indexerSrc)
  if (!m) fail(`${name} not found in src/ast/parallel-indexer.ts`)
  const expr = m[1]!.trim()
  if (!/^[0-9*\s]+$/.test(expr)) fail(`${name} expression not understood: ${expr}`)
  const value = expr.split("*").map((p) => Number(p.trim())).reduce((a, b) => a * b, 1)
  if (!Number.isFinite(value) || value <= 0) fail(`${name} did not evaluate: ${expr}`)
  return value
}
const fullAstBytes = bytesOf("FULL_AST_LIMIT")
const structuralBytes = bytesOf("STRUCTURAL_LIMIT")
const walkSizeLimit = bytesOf("DIR_WALK_SIZE_LIMIT")

const structExtMatch = /const structuralExtensions = new Set\(\[([^\]]*)\]\)/.exec(indexerSrc)
if (!structExtMatch) fail("structuralExtensions not found in src/ast/parallel-indexer.ts")
const structuralExtensions = [...structExtMatch[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!)

const configMaxMatch = /maxFileSizeBytes: ([0-9\s*]+),/.exec(indexerSrc)
if (!configMaxMatch) fail("maxFileSizeBytes not found in src/ast/parallel-indexer.ts")
const defaultMaxFileBytes = configMaxMatch[1]!
  .trim()
  .split("*")
  .map((p) => Number(p.trim()))
  .reduce((a, b) => a * b, 1)
if (!Number.isFinite(defaultMaxFileBytes)) fail("maxFileSizeBytes did not evaluate")

for (const needle of ['".gitignore"', '".bbignore"', "loaded .bbignore rules"]) {
  if (!indexerSrc.includes(needle)) fail(`indexer source does not mention ${needle} — the docs claim would be unbacked`)
}

const phases: string[] = []
for (const m of indexerSrc.matchAll(/recordPhase\("([a-z]+)"/g)) if (!phases.includes(m[1]!)) phases.push(m[1]!)
if (phases.length === 0) fail("no recordPhase() names found")
const NON_DERIVED_PHASES = new Set(["integrity"])
const derivedPhases = phases.filter((p) => !NON_DERIVED_PHASES.has(p))
const extraPhases = phases.filter((p) => NON_DERIVED_PHASES.has(p))

const passMatch = /derivedPass\?: "([^"]+)" \| "([^"]+)" \| "([^"]+)" \| "([^"]+)"/
const passUnion = passMatch.exec(indexerSrc)
if (!passUnion) fail("derivedPass union not found in src/ast/parallel-indexer.ts")
const derivedPassLabels = [passUnion[1]!, passUnion[2]!, passUnion[3]!, passUnion[4]!]

// --- 3. freshness budgets, from the exported module --------------------------------

const { AUTO_REFRESH_DEFAULTS, AUTO_REFRESH_ENV_ALLOWLIST } = (await import(
  path.join(ROOT, "src/ast/auto-refresh.ts")
)) as { AUTO_REFRESH_DEFAULTS: { maxFiles: number; maxBytes: number }; AUTO_REFRESH_ENV_ALLOWLIST: readonly string[] }

// --- 4. storage shape, proven at runtime -------------------------------------------

const probeDir = path.join(tmpdir(), `m56-d1-datadir-${process.pid}`)
process.env.BB_DATA_DIR = probeDir
const { bbDataDir, bbProjectsDir, bbWasmDir } = (await import(path.join(ROOT, "src/util/bb-data-dir.ts"))) as {
  bbDataDir: () => string
  bbProjectsDir: () => string
  bbWasmDir: () => string
}
if (bbDataDir() !== path.resolve(probeDir)) fail(`bbDataDir() does not honor BB_DATA_DIR: ${bbDataDir()}`)
if (bbProjectsDir() !== path.join(path.resolve(probeDir), "projects")) fail(`projects dir shape changed: ${bbProjectsDir()}`)
if (bbWasmDir() !== path.join(path.resolve(probeDir), "wasm")) fail(`wasm dir shape changed: ${bbWasmDir()}`)
delete process.env.BB_DATA_DIR
const defaultDataDir = bbDataDir()
const dataDirHomeRelative = path.relative(path.dirname(defaultDataDir), defaultDataDir) === ".bb" ? "~/.bb" : defaultDataDir
if (dataDirHomeRelative !== "~/.bb") fail(`default data dir is no longer ~/.bb: ${defaultDataDir}`)
const dataDirSrc = read("src/util/bb-data-dir.ts")
const projectIdNote = /<sha1-of-project>/.test(dataDirSrc) ? "sha1 of the project's absolute path" : ""
if (!projectIdNote) fail("bb-data-dir.ts no longer documents the project-id shape")

// --- 5. emit ------------------------------------------------------------------------

const data = {
  schemaVersion: 1,
  generatedBy: "npx tsx script/m56/generate-docs-data.ts --write",
  generatedFrom: [
    "the real CLI help (run from source via script/m56/cli-probe.ts)",
    "src/cli/index.ts (.command/.option declarations — parity instrument)",
    "src/ast/parallel-indexer.ts (skip dirs, size tiers, derived phases, derivedPass)",
    "src/ast/auto-refresh.ts (auto-refresh budgets and the env allowlist)",
    "src/util/bb-data-dir.ts (storage shape, proven with a temp BB_DATA_DIR)",
  ],
  indexing: {
    skipDirs,
    structuralExtensions,
    fullAstBytes,
    structuralBytes,
    walkSizeLimit,
    defaultMaxFileBytes,
    structuralFormatsNote: structuralExtensions.join(", "),
    ignoreFiles: [".gitignore", ".bbignore"],
  },
  freshness: {
    autoRefresh: { maxFiles: AUTO_REFRESH_DEFAULTS.maxFiles, maxBytes: AUTO_REFRESH_DEFAULTS.maxBytes },
    env: [...AUTO_REFRESH_ENV_ALLOWLIST],
    derivedPhases,
    extraPhases,
    derivedPassLabels,
  },
  storage: {
    dataDir: dataDirHomeRelative,
    envOverride: "BB_DATA_DIR",
    indexFile: "<data-dir>/projects/<project-id>/brain.db",
    parserCache: "<data-dir>/wasm",
    projectIdNote,
  },
  cli: {
    summary: root.summary,
    globalFlags: root.globalFlags,
    commands,
  },
}

function emit(value: unknown): string {
  return `// GENERATED FILE — do not edit by hand.
// ${data.generatedBy}
//
// Sources (all machine-read; see script/m56/generate-docs-data.ts):
${data.generatedFrom.map((s) => `//   - ${s}`).join("\n")}
//
// Verified byte-for-byte by script/m56/verify-docs-completeness.ts.

export const DOCS_FACTS = ${JSON.stringify(value, null, 2)} as const

export type DocsFacts = typeof DOCS_FACTS
`
}

const OUT = path.join(ROOT, OUT_REL)
const emitted = emit(data)
const current = (() => {
  try {
    return readFileSync(OUT, "utf8")
  } catch {
    return ""
  }
})()

if (WRITE) {
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, emitted)
  console.log(`DOCS DATA: WROTE ${OUT_REL}`)
} else if (current !== emitted) {
  problems.push(`${OUT_REL} is stale - run npx tsx script/m56/generate-docs-data.ts --write`)
} else {
  console.log(`DOCS DATA: PASS (${commands.length} commands, ${commands.flatMap((c) => c.flags).length} flags, ${skipDirs.length} skip dirs)`)
}

if (problems.length > 0) {
  console.log("DOCS DATA: FAIL")
  for (const p of problems) console.log(`  - ${p}`)
  process.exit(1)
}
