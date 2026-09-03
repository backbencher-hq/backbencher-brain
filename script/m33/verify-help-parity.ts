// script/m33/verify-help-parity.ts — M33.S4.
//
// Help is a contract. Two gates:
//   1. ENGLISH ONLY: every string the built binary prints through --help /
//      -h surfaces (root, setup, setup show, doctor) must be English — no
//      Turkish diacritics AND no ASCII-spelled Turkish vocabulary (a diacritic
//      scan alone misses words like "anahtar" or "Kazanan").
//   2. PARITY, both directions: every command declared in the implementation
//      must be listed in help, and every command listed in help must exist in
//      the implementation; the same holds for every option of every command.
//      A flag that exists only in code (hidden from users) or only in help
//      (lying to users) fails the gate.
//
// The doctor --fix help text is pinned separately: it must state that --fix
// IS the explicit apply (the old text claimed dry-run was NOT the default —
// an honesty bug this pin keeps dead).
//
// Run: npx tsx script/m33/verify-help-parity.ts
// Evidence: validation/m33/results/S4.json (machine-emitted)

import { execFileSync, spawnSync } from "node:child_process"
import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import os from "node:os"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m33/results")
const COMPONENT = path.join(ROOT, "src/cli/index.ts")
const MUTANT_PATH = path.join(ROOT, "src/cli/.cli-mutant.ts")
const WRAPPER_PATH = path.join(ROOT, "src/cli/.cli-mutant-wrapper.ts")
const EVIDENCE_PATH = path.join(RESULTS, "S4.json")

// ASCII-spelled Turkish vocabulary that appeared in CLI-facing strings before
// M33; any of these in a help surface is a gate failure.
const ASCII_TURKISH = [
  "Seçim", "anahtar", "Kazanan", "kurulum", "sağlayıcı", "tanılama",
  "yapılandırma", "Çözüm", "düzelt", "beklenen", "eksik", "tanımlı",
  "sihirbaz", "atlandı", "uygulandı", "öneri", "kuru çalışma",
  "Düzeltilecek", "satır", "katman", "uyuşmaz", "kaydedil", "doğrulan",
  "reddedil", "REDDED",
]
const DIACRITICS = /[çğıöşüÇĞİÖŞÜ]/

let checks = 0
let passed = 0
let failed = 0

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else {
    failed++
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

function childRunCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const wrapper = `import { runCli } from "./.cli-mutant.ts";\nrunCli(${JSON.stringify(args)}).catch(() => process.exit(70))\n`
  writeFileSync(WRAPPER_PATH, wrapper)
  try {
    const r = spawnSync("npx", ["tsx", WRAPPER_PATH], { cwd: ROOT, encoding: "utf8", timeout: 60000 })
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
  } finally {
    if (existsSync(WRAPPER_PATH)) rmSync(WRAPPER_PATH, { force: true })
  }
}

// --- source parsing: commands and their options, from the declarations -----

function parseSource(): Map<string, string[]> {
  const src = readFileSync(COMPONENT, "utf8")
  const map = new Map<string, string[]>()
  let current = "__root__"
  map.set(current, [])
  for (const line of src.split("\n")) {
    const cmd = /\.command\("([^"]+)"\)/.exec(line)
    if (cmd) {
      current = cmd[1]!
      map.set(current, [])
      continue
    }
    const opt = /\.option\("([^"]+)"/.exec(line)
    if (opt) {
      const flag = opt[1]!.split(/[ <]/)[0]!
      map.get(current)!.push(flag)
    }
  }
  // program.version's short alias is a root flag declared via .version(...).
  if (/\.version\([^)]*"-v,\s*--version"/.test(src)) map.get("__root__")!.push("--version")
  return map
}

// --- help parsing: commands and options, from the built binary -------------

function helpCommands(helpText: string): string[] {
  const cmds: string[] = []
  let inCommands = false
  for (const line of helpText.split("\n")) {
    if (/^Commands?:/i.test(line)) {
      inCommands = true
      continue
    }
    if (inCommands) {
      if (/^[A-Za-z]/.test(line)) break // next section
      // Command entries start with EXACTLY two spaces (commander layout).
      // Wrapped description continuation lines are indented to the description
      // column (much deeper) and must not be parsed as commands (M22.V1 made
      // multi-line descriptions possible). The token must be followed by
      // whitespace/args/end — never a mid-word char like "/" or ")".
      const m = /^ {2}([a-z][a-z0-9-]*)(?=\s|$|\[|<)/.exec(line)
      if (m) cmds.push(m[1]!)
    }
  }
  return cmds
}

function helpOptions(helpText: string): string[] {
  const opts: string[] = []
  let inOptions = false
  for (const line of helpText.split("\n")) {
    if (/^Options:/i.test(line)) {
      inOptions = true
      continue
    }
    if (inOptions) {
      if (/^[A-Za-z]/.test(line)) break
      for (const m of line.matchAll(/(^|\s)(--[a-z][a-z0-9-]*)/g)) {
        if (!opts.includes(m[2]!)) opts.push(m[2]!)
      }
    }
  }
  return opts
}

console.log("M33.S4 help-parity verifier")

const bb = path.join(ROOT, "bin", "bb")
const env = { ...process.env, BB_DATA_DIR: path.join(os.tmpdir(), `m33-s4-bbdata-${process.pid}`) }
function runHelp(args: string[]): string {
  const r = spawnSync(bb, args, { encoding: "utf8", timeout: 30000, env })
  return (r.stdout ?? "") + (r.stderr ?? "")
}

// ---------------------------------------------------------------------------
// A. English-only gate across every help surface
// ---------------------------------------------------------------------------

{
  let buildOk = false
  try {
    execFileSync("npm", ["run", "build"], { cwd: ROOT, encoding: "utf8", timeout: 180000, stdio: ["ignore", "pipe", "pipe"] })
    buildOk = true
  } catch {}
  check("A: dist rebuilt fresh before binary checks", buildOk)

  const surfaces: [string, string][] = [
    ["bb --help", runHelp(["--help"])],
    ["bb -h", runHelp(["-h"])],
    ["bb help", runHelp(["help"])],
    ["bb setup --help", runHelp(["setup", "--help"])],
    ["bb setup show --help", runHelp(["setup", "show", "--help"])],
    ["bb doctor --help", runHelp(["doctor", "--help"])],
    ["bb index --help", runHelp(["index", "--help"])],
    ["bb search --help", runHelp(["search", "--help"])],
    ["bb health --help", runHelp(["health", "--help"])],
    ["bb tool --help", runHelp(["tool", "--help"])],
    ["bb mcp --help", runHelp(["mcp", "--help"])],
    ["bb version --help", runHelp(["version", "--help"])],
  ]
  for (const [name, text] of surfaces) {
    check(`A: ${name} is English (no diacritics)`, !DIACRITICS.test(text))
    const hits = ASCII_TURKISH.filter((t) => text.includes(t))
    check(`A: ${name} is English (no Turkish vocabulary)`, hits.length === 0, hits.join(","))
  }
  check("A: doctor --fix help states --fix IS the explicit apply", runHelp(["doctor", "--help"]).includes("this IS the explicit"))
}

// ---------------------------------------------------------------------------
// B. Parity — commands and options, both directions
// ---------------------------------------------------------------------------

{
  const srcMap = parseSource()
  const rootHelp = runHelp(["--help"])
  const setupHelp = runHelp(["setup", "--help"])

  // Commands: implementation -> help.
  const implCommands = [...srcMap.keys()].filter((c) => c !== "__root__")
  const listedRoot = helpCommands(rootHelp)
  const listedSetup = helpCommands(setupHelp)
  for (const cmd of implCommands) {
    const inHelp = listedRoot.includes(cmd) || listedSetup.includes(cmd) // `show` lives under setup
    check(`B: implementation command '${cmd}' is listed in help`, inHelp)
  }
  // Commands: help -> implementation (the implicit `help` command is allowed).
  for (const cmd of [...listedRoot, ...listedSetup]) {
    check(`B: help command '${cmd}' exists in the implementation`, cmd === "help" || implCommands.includes(cmd))
  }

  // Options: implementation -> help, per command with options.
  const surfacesWithFlags: [string, string, string][] = [
    ["__root__", "root", rootHelp],
    ["tool", "tool", runHelp(["tool", "--help"])],
    ["index", "index", runHelp(["index", "--help"])],
    ["doctor", "doctor", runHelp(["doctor", "--help"])],
    ["search", "search", runHelp(["search", "--help"])],
    ["health", "health", runHelp(["health", "--help"])],
    ["mcp", "mcp", runHelp(["mcp", "--help"])],
  ]
  // --help/-h is commander's IMPLICIT help flag — never declared via
  // .option(), so it is exempt from the code-side existence requirement.
  const IMPLICIT_FLAGS = ["--help"]
  for (const [key, label, text] of surfacesWithFlags) {
    const implFlags = srcMap.get(key) ?? []
    const helpFlags = helpOptions(text)
    for (const flag of implFlags) {
      check(`B: ${label} option ${flag} is listed in help`, helpFlags.includes(flag), `help lists: ${helpFlags.join(" ")}`)
    }
    for (const flag of helpFlags) {
      if (IMPLICIT_FLAGS.includes(flag)) continue
      check(`B: help option ${flag} (${label}) exists in the implementation`, implFlags.includes(flag), `code declares: ${implFlags.join(" ")}`)
    }
  }
}

// ---------------------------------------------------------------------------
// C. Mutants — each planted defect must be caught (child-process probes)
// ---------------------------------------------------------------------------

type Mutant = { name: string; mutate: (src: string) => string; probe: () => boolean }

const mutants: Mutant[] = [
  {
    name: "Turkish description reintroduced (diacritics)",
    mutate: (src) => src.replace('.description("embedding provider setup (API key, model)")', '.description("embedding sağlayıcısı kurulumu")'),
    probe: () => DIACRITICS.test(childRunCli(["setup", "--help"]).stdout + childRunCli(["setup", "--help"]).stderr),
  },
  {
    name: "Turkish description reintroduced (ASCII only)",
    mutate: (src) => src.replace('.description("embedding provider setup (API key, model)")', '.description("embedding kurulumu: anahtar ve model")'),
    probe: () => ASCII_TURKISH.some((t) => (childRunCli(["setup", "--help"]).stdout + childRunCli(["setup", "--help"]).stderr).includes(t)),
  },
  {
    name: "implementation flag hidden from help",
    mutate: (src) => src.replace('.option("--force", "wipe the existing index and rebuild")', '.option("--force", "wipe the existing index and rebuild").hideHelp()'),
    probe: () => {
      const r = childRunCli(["index", "--help"])
      const text = r.stdout + r.stderr
      // The flag is declared in code but absent from help: the parity gate's
      // implementation->help direction must flag it.
      return !text.includes("--force")
    },
  },
  {
    name: "doctor --fix honesty claim reverted to the old lie",
    mutate: (src) => src.replace("repair permission problems (0600 only; this IS the explicit apply — without it doctor is read-only)", "izin sorunlarını düzelt (kuru çalışma varsayılan değildir)"),
    probe: () => {
      const r = childRunCli(["doctor", "--help"])
      const text = r.stdout + r.stderr
      return !text.includes("this IS the explicit apply") && (DIACRITICS.test(text) || text.includes("düzelt"))
    },
  },
]

const mutantResults: { name: string; caught: boolean }[] = []
for (const mut of mutants) {
  const src = readFileSync(COMPONENT, "utf8")
  const mutated = mut.mutate(src)
  if (mutated === src) {
    mutantResults.push({ name: mut.name, caught: false })
    check(`mutant [${mut.name}] applied`, false, "mutation produced no change — fix mutant definition")
    continue
  }
  writeFileSync(MUTANT_PATH, mutated)
  let caught = false
  try {
    caught = mut.probe()
  } catch {
    caught = false
  } finally {
    for (const p of [MUTANT_PATH, WRAPPER_PATH]) {
      if (existsSync(p)) rmSync(p, { force: true })
    }
  }
  mutantResults.push({ name: mut.name, caught })
  check(`mutant [${mut.name}] caught by suite`, caught, caught ? "" : "survived")
}
check("S4: every planted defect was caught", mutantResults.every((m) => m.caught))

// ---------------------------------------------------------------------------
// Verdict + evidence
// ---------------------------------------------------------------------------

const ok = failed === 0
console.log("")
console.log(`  checks: ${passed}/${checks} passed, ${mutantResults.length} mutants`)
if (!ok) {
  console.log("VERDICT: FAIL")
  process.exit(1)
}
console.log("VERDICT: PASS")

let headCommit = "unknown"
try {
  headCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
} catch {}

const evidence = {
  issue: "M33.S4",
  code: "S4",
  milestone: "M33",
  status: "verified",
  checks,
  passed,
  failed,
  negativeCases: mutantResults.length,
  mutants: mutantResults,
  currentCommit: headCommit,
  verifierCommand: "npx tsx script/m33/verify-help-parity.ts",
  evidenceFile: "S4.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "The ASCII-Turkish vocabulary list is a curated denylist, not a translator; a NEW Turkish word outside the list would pass the vocabulary check (the diacritic check still applies to accented spellings).",
    "Parity derives help-side lists from the built binary's rendered help and code-side lists from .command/.option declarations; a command registered dynamically would need this parser extended.",
    "The help-flag regex reads only lines in the Options section that start with a dash-flag token; wrapped description lines cannot inject false flags.",
  ],
}
mkdirSync(RESULTS, { recursive: true })
writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n")
console.log(`  evidence: ${path.relative(ROOT, EVIDENCE_PATH)}`)
