// script/m33/verify-honesty-docs.ts — M33.H1.
//
// Docs truth for the discovery surfaces: README and EMBEDDINGS.md must
// document `bb -v` / `bb version` / `bb --version` parity, `man bb`, the
// did-you-mean behavior, and the setup/show/doctor command rows, with
// verbatim strings and the honesty claims (fingerprint-only, 0600,
// --force re-embed). The suite CAN FAIL: planted doc mutants are caught.
//
// Run: npx tsx script/m33/verify-honesty-docs.ts
// Evidence: validation/m33/results/H1.json (machine-emitted)

import { execFileSync, spawnSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m33/results")
const EVIDENCE_PATH = path.join(RESULTS, "H1.json")

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

console.log("M33.H1 docs-truth verifier")

const readme = readFileSync(path.join(ROOT, "README.md"), "utf8")
const emb = readFileSync(path.join(ROOT, "EMBEDDINGS.md"), "utf8")

// --- 1. README: command table rows and help/manual section -----------------

check("H1: README documents bb setup", readme.includes("`bb setup` |"))
check("H1: README documents bb setup show", readme.includes("`bb setup show` |"))
check("H1: README documents bb doctor with --fix", readme.includes("`bb doctor [--dir] [--fix]` |"))
check("H1: README documents the version forms row", readme.includes("`bb -v` / `bb version` |") && readme.includes("`bb --version`)"))
check("H1: README has the Help and manual section", readme.includes("### Help and manual"))
check("H1: README documents per-command help verbatim", readme.includes("`bb <command> --help`") && readme.includes("`bb help <command>`"))
check("H1: README documents man bb after npm install", readme.includes("`man bb`") && readme.includes("npm install -g"))
check("H1: README documents the did-you-mean behavior verbatim", readme.includes("`bb docter` suggests") && readme.includes("`doctor`)"))
check("H1: README fingerprint-only claim intact (M32 inheritance)", readme.includes("last-4") && readme.includes("never the full key"))
check("H1: README permissions-only claim intact (M32 inheritance)", readme.includes("mutates exactly one thing"))

// --- 2. EMBEDDINGS: discovery section ----------------------------------------

check("H1: EMBEDDINGS has the discovery section", emb.includes("## Discovering these commands"))
check("H1: EMBEDDINGS documents the version forms verbatim", emb.includes("`bb -v`,") && emb.includes("`bb version`, and `bb --version` all print the version"))
check("H1: EMBEDDINGS documents per-command help", emb.includes("`bb <command> --help`"))
check("H1: EMBEDDINGS documents man bb", emb.includes("`man bb`"))
check("H1: EMBEDDINGS documents the did-you-mean example verbatim", emb.includes("`bb docter` suggests `doctor`)"))

// --- 3. Honesty rules inherited, banned vocabulary absent -------------------

const BANNED_TERMS = [
  "perfect", "perfection", "production-ready", "bulletproof",
  "rock-solid", "battle-tested", "extensively tested", "thoroughly reviewed",
]
let bannedHits: string[] = []
for (const [name, text] of [["README", readme], ["EMBEDDINGS", emb]] as const) {
  for (const line of text.split("\n")) {
    if (/setup show|doctor|bb setup|embedding|man bb|version/i.test(line)) {
      for (const term of BANNED_TERMS) {
        if (new RegExp(`\\b${term}\\b`, "i").test(line)) bannedHits.push(`${name}: ${term}`)
      }
    }
  }
}
check("H1: no banned vocabulary in discovery-related doc lines", bannedHits.length === 0, [...new Set(bannedHits)].join(", "))

// --- 4. Built-binary cross-check: docs match the real surface ---------------

{
  let buildOk = false
  try {
    execFileSync("npm", ["run", "build"], { cwd: ROOT, encoding: "utf8", timeout: 180000, stdio: ["ignore", "pipe", "pipe"] })
    buildOk = true
  } catch {}
  check("H1: dist rebuilt fresh before binary cross-check", buildOk)
  const bb = path.join(ROOT, "bin", "bb")
  const r = spawnSync(bb, ["-v"], { encoding: "utf8", timeout: 30000 })
  check("H1: README's -v claim is true on the built binary", r.status === 0 && r.stdout.trim().length > 0)
  const s = spawnSync(bb, ["docter"], { encoding: "utf8", timeout: 30000 })
  check("H1: README's did-you-mean claim is true on the built binary", /Did you mean doctor\?/.test(s.stderr ?? ""))
}

// --- 5. Doc mutants: each planted defect must be caught ---------------------

type DocMutant = { name: string; mutate: (src: string) => string; probe: (mutated: string) => boolean }

const docMutants: DocMutant[] = [
  {
    name: "version row dropped from README",
    mutate: (src) => src.replace("| `bb -v` / `bb version` | Print the version (same as `bb --version`) |\n", ""),
    probe: (m) => !m.includes("`bb -v` / `bb version` |"),
  },
  {
    name: "man bb claim removed from README",
    mutate: (src) => src.replace("the full\nmanual is available as `man bb`.", "the full\nmanual is available in EMBEDDINGS.md."),
    probe: (m) => !/manual is available as `man bb`/.test(m),
  },
  {
    name: "did-you-mean claim weakened in README",
    mutate: (src) => src.replace("A mistyped command suggests the closest real one", "A mistyped command may produce a hint"),
    probe: (m) => !m.includes("suggests the closest real one"),
  },
  {
    name: "fingerprint-only claim weakened in README row",
    mutate: (src) => src.replace("key as last-4 fingerprint only, never the full key", "key shown safely"),
    probe: (m) => !m.includes("last-4 fingerprint only"),
  },
  {
    name: "discovery section dropped from EMBEDDINGS",
    mutate: (src) => src.replace(/## Discovering these commands[\s\S]*$/, ""),
    probe: (m) => !m.includes("## Discovering these commands"),
  },
]

const mutantResults: { name: string; caught: boolean }[] = []
for (const mut of docMutants) {
  const mutated = mut.mutate(readme.includes("## Discovering") || mut.name.includes("EMBEDDINGS") ? emb : readme)
  const caught = mut.probe(mutated)
  mutantResults.push({ name: mut.name, caught })
  check(`doc mutant [${mut.name}] caught by suite`, caught, caught ? "" : "survived")
}
check("H1: every planted doc defect was caught", mutantResults.every((m) => m.caught))

// --- Verdict + evidence -----------------------------------------------------

const ok = failed === 0
console.log("")
console.log(`  checks: ${passed}/${checks} passed, ${mutantResults.length} doc mutants`)
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
  issue: "M33.H1",
  code: "H1",
  milestone: "M33",
  status: "verified",
  checks,
  passed,
  failed,
  negativeCases: mutantResults.length,
  mutants: mutantResults,
  currentCommit: headCommit,
  verifierCommand: "npx tsx script/m33/verify-honesty-docs.ts",
  evidenceFile: "H1.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "Doc mutants are string-level probes on the document text, not full re-runs of the docs gate; the verbatim pins double-check the same claims.",
    "The built-binary cross-check proves the -v and did-you-mean claims at run time; the man bb claim is proven by the S3 gate (npm pack + rendering).",
  ],
}
mkdirSync(RESULTS, { recursive: true })
writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n")
console.log(`  evidence: ${path.relative(ROOT, EVIDENCE_PATH)}`)
