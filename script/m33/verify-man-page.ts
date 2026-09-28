// script/m33/verify-man-page.ts — M33.S3.
//
// The bb(1) manual: docs/man/bb.1 must exist, be valid roff that groff/man
// render without warnings, document every real command and the version/help
// flags (so it can never silently drift from the CLI — S4's parity gate
// cross-checks the same list), carry the honesty rules (fingerprint-only,
// 0600, --force re-embed, exit-code contract), and actually SHIP: package.json
// wires `man`, docs/man/ is in the npm files list, and `npm pack` includes it.
//
// Run: npx tsx script/m33/verify-man-page.ts
// Evidence: validation/m33/results/S3.json (machine-emitted)

import { execFileSync, spawnSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import path from "node:path"
import os from "node:os"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m33/results")
const MAN_PAGE = path.join(ROOT, "docs/man/bb.1")
const PKG_PATH = path.join(ROOT, "package.json")
const EVIDENCE_PATH = path.join(RESULTS, "S3.json")

// The real CLI command list (must match src/cli/index.ts; S4's parity gate
// derives its list from the built binary, so drift fails one of the two).
const REQUIRED_COMMANDS = [
  "tool",
  "index",
  "setup",
  "setup show",
  "doctor",
  "doctor \\-\\-fix",
  "search",
  "health",
  "onboard",
  "mcp",
  "version",
  "help",
]

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

function manWired(pkgText: string): { man: boolean; files: boolean } {
  let man = false
  let files = false
  try {
    const pkg = JSON.parse(pkgText)
    man = Array.isArray(pkg.man) && pkg.man.some((m: string) => m.endsWith("docs/man/bb.1"))
    files = Array.isArray(pkg.files) && pkg.files.includes("docs/man/")
  } catch {}
  return { man, files }
}

console.log("M33.S3 man-page verifier")

// ---------------------------------------------------------------------------
// A. Content + npm wiring
// ---------------------------------------------------------------------------

const page = readFileSync(MAN_PAGE, "utf8")
const pkgText = readFileSync(PKG_PATH, "utf8")

for (const section of ["NAME", "SYNOPSIS", "DESCRIPTION", "COMMANDS", "OPTIONS", "EMBEDDING SETUP", "EXIT STATUS"]) {
  check(`A: page has .SH ${section}`, page.includes(`.SH ${section}`))
}
// roff escapes dashes as \- in the page; when embedding those in a RegExp,
// the backslash itself must be escaped (\\- matches a literal backslash-dash).
function commandDocumented(p: string, cmd: string): boolean {
  const esc = cmd.replace(/\\/g, "\\\\")
  return new RegExp(`^\\.(?:B|BI) ${esc}(\\s|$)`, "m").test(p)
}

for (const cmd of REQUIRED_COMMANDS) {
  // .B cmd, .BI cmd "args", or bold-with-args variants all count as documented.
  check(`A: page documents the ${cmd.replace("\\-\\-", "--")} command`, commandDocumented(page, cmd))
}
check("A: page documents -v/--version", page.includes("\\-v") && page.includes("\\-\\-version"))
check("A: page documents -h/--help", page.includes("\\-h") && page.includes("\\-\\-help"))
check("A: fingerprint-only rule stated", page.includes("last-four fingerprint"))
check("A: 0600 rule stated", page.includes("0600"))
check("A: --force re-embed rule stated", page.includes("\\-\\-force"))
check("A: vector-space honesty stated", page.includes("never compared"))
check("A: exit-code contract stated", page.includes("Exits 1"))
check("A: no Turkish residue in the page", !/[çğıöşüÇĞİÖŞÜ]/.test(page) && !/anahtar|Kazanan|sihirbaz/.test(page))

const wiring = manWired(pkgText)
check("A: package.json man field points at docs/man/bb.1", wiring.man)
check("A: docs/man/ is in the npm files list", wiring.files)

// The ship proof: npm pack must actually include the page (npm prints the
// notice on stderr, so merge streams).
const pack = spawnSync("npm pack --dry-run 2>&1", { cwd: ROOT, encoding: "utf8", timeout: 120000, shell: true })
check("A: npm pack includes docs/man/bb.1", pack.status === 0 && pack.stdout.includes("docs/man/bb.1"), pack.stdout.split("\n").find((l) => l.includes("man")) ?? "")

// ---------------------------------------------------------------------------
// B. Real rendering: groff must process the page with zero warnings and
//    man -l must produce a readable page.
// ---------------------------------------------------------------------------

// groff's raw -Tascii stream contains backspace-bold overprints (e.g.
// `i\bin\bnd…` for bold "index"); `col -b` strips them to readable text.
const col = spawnSync("sh", ["-c", `groff -man -Tascii -ww '${MAN_PAGE}' | col -b`], { encoding: "utf8", timeout: 60000 })
check("B: groff renders the page with exit 0", col.status === 0, String(col.status))
check("B: groff emits zero warnings (valid roff)", (col.stderr ?? "").trim() === "", (col.stderr ?? "").slice(0, 200))
const rendered = col.stdout ?? ""
check("B: rendered page shows the NAME line", rendered.includes("bb - Backbencher Brain"))
check("B: rendered page shows COMMANDS and EXIT STATUS", rendered.includes("COMMANDS") && rendered.includes("EXIT STATUS"))
const manRender = spawnSync("man", ["-l", MAN_PAGE], { encoding: "utf8", timeout: 60000 })
check("B: man -l renders the page", manRender.status === 0 && manRender.stdout.includes("SYNOPSIS"))

// ---------------------------------------------------------------------------
// C. Mutants — each planted defect must be caught
// ---------------------------------------------------------------------------

type Mutant = { name: string; plant: () => { probe: () => boolean; cleanup: () => void } }

const mutants: Mutant[] = [
  {
    name: "EXIT STATUS section removed",
    plant: () => {
      const mutated = page.replace(".SH EXIT STATUS\n", "")
      writeFileSync(MAN_PAGE, mutated)
      return {
        probe: () => !readFileSync(MAN_PAGE, "utf8").includes(".SH EXIT STATUS"),
        cleanup: () => writeFileSync(MAN_PAGE, page),
      }
    },
  },
  {
    name: "broken roff (unknown macro)",
    plant: () => {
      writeFileSync(MAN_PAGE, page + ".BBLORUM\n")
      return {
        probe: () => {
          const g = spawnSync("groff", ["-man", "-Tascii", "-ww", MAN_PAGE], { encoding: "utf8", timeout: 60000 })
          return (g.stderr ?? "").trim().length > 0
        },
        cleanup: () => writeFileSync(MAN_PAGE, page),
      }
    },
  },
  {
    name: "version command undocumented",
    plant: () => {
      const mutated = page.replace(".B version\nPrint the bb version", ".B versi0n\nPrint the bb versi0n")
      writeFileSync(MAN_PAGE, mutated)
      return {
        probe: () => {
          const p = readFileSync(MAN_PAGE, "utf8")
          return !REQUIRED_COMMANDS.every((cmd) => commandDocumented(p, cmd))
        },
        cleanup: () => writeFileSync(MAN_PAGE, page),
      }
    },
  },
  {
    name: "npm man wiring removed",
    plant: () => {
      return {
        // Mutate semantics, not bytes: parse → delete the man field →
        // re-serialize. A literal string replace went stale when package.json
        // was reformatted (multi-line arrays) — the mutation became a no-op
        // and the mutant "survived" vacuously. JSON-level mutation is
        // formatting-robust.
        probe: () => {
          try {
            const pkg = JSON.parse(pkgText)
            delete pkg.man
            return !manWired(JSON.stringify(pkg)).man
          } catch {
            return false
          }
        },
        cleanup: () => {},
      }
    },
  },
]

const mutantResults: { name: string; caught: boolean }[] = []
for (const mut of mutants) {
  let caught = false
  let handle: { probe: () => boolean; cleanup: () => void } | null = null
  try {
    handle = mut.plant()
    caught = handle.probe()
  } catch {
    caught = false
  } finally {
    handle?.cleanup()
  }
  mutantResults.push({ name: mut.name, caught })
  check(`mutant [${mut.name}] caught by suite`, caught, caught ? "" : "survived")
}
check("S3: every planted defect was caught", mutantResults.every((m) => m.caught))

// Safety: the real page must be byte-identical to what we started with.
check("S3: man page restored byte-identical after mutants", readFileSync(MAN_PAGE, "utf8") === page)

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
  issue: "M33.S3",
  code: "S3",
  milestone: "M33",
  status: "verified",
  checks,
  passed,
  failed,
  negativeCases: mutantResults.length,
  mutants: mutantResults,
  currentCommit: headCommit,
  verifierCommand: "npx tsx script/m33/verify-man-page.ts",
  evidenceFile: "S3.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "Rendering is checked with groff -man -Tascii -ww and man -l (both present in this environment); a CI host without groff would surface the B checks as failures, not silent passes.",
    "The command list pinned here is duplicated from src/cli/index.ts by hand; S4's parity gate derives the list from the built binary, so drift between page, help, and code fails at least one gate.",
    "npm-installed man availability depends on the user's MANPATH; the gate proves the page ships in the tarball and is wired via the man field.",
  ],
}
mkdirSync(RESULTS, { recursive: true })
writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n")
console.log(`  evidence: ${path.relative(ROOT, EVIDENCE_PATH)}`)
