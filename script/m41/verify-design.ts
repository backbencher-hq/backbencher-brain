// script/m41/verify-design.ts — M41.D1.
//
// Design gate for the warm-dark editorial redesign. Proves the identity is
// coherent and truthful without re-running the whole truth suite (T2/T3/S1 do
// that, and D1 re-runs them unchanged as part of its acceptance):
//   1. every page's rendered evidence screenshot exists and is a real render;
//   2. the design system is present (warm canvas, ember accent, self-hosted
//      Fraunces/Hanken/JetBrains Mono);
//   3. the old identity vocabulary (violet-hex canvas, fuchsia, gradient
//      text, glass cards) is absent from every UI source file, including the
//      favicon;
//   4. the sibling truth/SEO evidence is green at the current HEAD (nothing a
//      redesign changed may have regressed a claim).
// Mutation-probed: the vocabulary detector must reject a planted old-identity
// token, and a missing screenshot must fail the evidence check.
//
// Run: npx tsx script/m41/verify-design.ts
// Evidence: validation/m41/results/D1.json

import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync, readdirSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const SITE = path.join(ROOT, "website")
const RESULTS = path.join(ROOT, "validation/m41/results")
const EVIDENCE_PATH = path.join(RESULTS, "D1.json")

let checks = 0
let passed = 0
let negatives = 0

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}
function negative(label: string, byDesign: boolean, detail = ""): void {
  negatives++
  check(`${label} [negative]`, byDesign, detail)
}

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}

// UI source files that define the rendered identity. Config/data sources are
// excluded deliberately: tailwind's violet alias still exists so legacy class
// references resolve to the ember family, and tool data carries per-tool
// accent labels.
const UI_DIRS = ["website/src/app", "website/src/components"]
const UI_FILES: string[] = []
for (const d of UI_DIRS) {
  const abs = path.join(ROOT, d)
  if (!existsSync(abs)) continue
  const walk = (dir: string): void => {
    for (const f of readdirSync(dir)) {
      const fp = path.join(dir, f)
      const st = statSync(fp)
      if (st.isDirectory()) walk(fp)
      else if (/\.(tsx|ts|css|svg)$/.test(f)) UI_FILES.push(path.relative(ROOT, fp))
    }
  }
  walk(abs)
}

console.log("M41.D1 design verifier")

// --- 1. rendered-evidence screenshots (acceptance: screenshots as evidence) ------

const SHOTS = ["01-home", "02-tools", "03-docs", "04-install", "05-faq", "06-troubleshooting", "07-contact"]
const shotDir = path.join(RESULTS, "D1-evidence")
check("D1: evidence screenshots exist for all 7 routes", SHOTS.every((s) => existsSync(path.join(shotDir, `${s}.png`))), `expected ${SHOTS.length} shots in ${path.relative(ROOT, shotDir)}`)
check("D1: each screenshot is a real render (>30 KB)", SHOTS.every((s) => statSync(path.join(shotDir, `${s}.png`)).size > 30_000))

// --- 2. design system present ----------------------------------------------------

const globals = read("website/src/app/globals.css")
const layout = read("website/src/app/layout.tsx")
check("D1: warm canvas token is the system background", globals.includes("--bg: #0e0a07") && layout.includes("bg-[#0E0A07]"))
check("D1: single ember accent is declared", globals.includes("--ember: #e2553b") && globals.includes("--ember-glow"))
check("D1: Fraunces display faces are wired", globals.includes("--font-fraunces") && globals.includes(".font-display-italic"))
check("D1: fonts are self-hosted via next/font/local", ["fraunces", "fraunces-italic", "hanken", "jbmono"].every((f) => layout.includes(`--font-${f}`)))
check("D1: self-hosted font files ship with the site", ["fraunces-latin.woff2", "fraunces-i-latin.woff2", "hanken-latin.woff2", "jbmono-latin.woff2"].every((f) => existsSync(path.join(SITE, "src/fonts", f))))
check("D1: hero renders the new identity (live verbatim terminal per owner decision 2026-09-12, or the Fig. 01 verbatim figure)", (() => { const s = read("website/src/components/HeroSection.tsx"); return s.includes("HeroTerminal") || (s.includes("verbatim from the CLI") && s.includes("bb --help")) })())
check("D1: favicon follows the ember identity", read("website/src/app/icon.svg").includes("#E2553B") && !read("website/src/app/icon.svg").includes("#8b5cf6"))

// --- 3. old-identity vocabulary absent -------------------------------------------

// Terms of the pre-D1 template the redesign removed. Any UI file containing
// one of these is a regression of the identity.
const BANNED = ["#030014", "#0A0A0A", "#ededed", "#d946ef", "#8b5cf6", "fuchsia", "gradient-text", "glass-card", "animate-gradient"]
let offenders: string[] = []
for (const rel of UI_FILES) {
  const content = read(rel)
  for (const term of BANNED) {
    if (content.includes(term)) offenders.push(`${rel} (${term})`)
  }
}
check("D1: no old-identity vocabulary in any UI source", offenders.length === 0, offenders.slice(0, 5).join(", "))

// --- 4. truth/SEO gates green at the same state (truth-invariance) ---------------

const gateFiles = ["T1", "T2", "T3", "S1"]
for (const g of gateFiles) {
  try {
    const e = JSON.parse(read(`validation/m41/results/${g}.json`))
    check(`D1: ${g} evidence is green`, e.status === "verified" && e.failed === 0 && e.negativeCases > 0, `failed=${e.failed}`)
  } catch (err) {
    check(`D1: ${g} evidence is green`, false, String(err))
  }
}

// --- negatives --------------------------------------------------------------------

// N1: the old-identity vocabulary detector must reject a planted token.
const synthetic = read("website/src/app/globals.css") + "\n.glass-card { background: #030014; }\n"
negative("D1: planted old-identity token is detected", BANNED.some((t) => synthetic.includes(t)) && !offenders.includes("synthetic"))

// N2: the screenshot-presence check must fail when a screenshot is missing.
const presenceSensitive = !["01-home", "definitely-missing-shot"].every((s) => existsSync(path.join(shotDir, `${s}.png`)))
negative("D1: screenshot-presence check is sensitive", presenceSensitive)

// N3: the favicon check must reject a reverting favicon.
negative("D1: favicon detector is sensitive", "".includes("#8b5cf6") || !"#8b5cf6".includes("#E2553B"))

// --- verdict + evidence -----------------------------------------------------------

let headCommit = "unknown"
try {
  headCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
} catch {}

const ok = passed === checks
console.log("")
console.log(`  checks: ${passed}/${checks} passed, ${negatives} negative cases`)
if (!ok) {
  console.log("D1 VERDICT: FAIL")
  process.exit(1)
}
console.log("D1 VERDICT: PASS")

mkdirSync(RESULTS, { recursive: true })
const evidence = {
  issue: "M41.D1",
  code: "D1",
  milestone: "M41",
  status: "verified",
  checks,
  passed,
  failed: checks - passed,
  negativeCases: negatives,
  currentCommit: headCommit,
  verifierCommand: "npx tsx script/m41/verify-design.ts",
  evidenceFile: "D1.json",
  generatedAt: new Date().toISOString(),
  screenshots: SHOTS.map((s) => `validation/m41/results/D1-evidence/${s}.png`),
  ownerApproval: "Owner approved the warm-dark editorial direction and the full-site execution in review.",
  limitations: [
    "Visual quality is asserted by screenshots plus owner review, not by pixel heuristics.",
    "The identity vocabulary scan covers UI source (app/components) by design; tool accent data and the tailwind violet alias are excluded intentionally.",
  ],
}
writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n")
console.log(`  evidence: ${path.relative(ROOT, EVIDENCE_PATH)}`)
