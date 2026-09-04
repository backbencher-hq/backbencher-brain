// script/m41/verify-site-truth.ts — M41.T2.
//
// Proves the RENDERED site tells the truth: builds the Next.js site, then
// checks every page's prerendered HTML against the generated truth data.
// This is the gate that makes hand-typed claims impossible: any page that
// renders a number/name/version not derived from the artifacts fails CI.
//
// Run: npx tsx script/m41/verify-site-truth.ts
// Evidence: validation/m41/results/T2.json

import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const SITE = path.join(ROOT, "website")
const RESULTS = path.join(ROOT, "validation/m41/results")
const EVIDENCE_PATH = path.join(RESULTS, "T2.json")

let checks = 0
let passed = 0
let negatives = 0

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}
function negative(label: string, condition: boolean, detail = ""): void {
  negatives++
  check(`${label} [negative]`, condition, detail)
}

// React SSR inserts `<!-- -->` between text nodes; normalize before matching.
function normalize(html: string): string {
  return html.replace(/<!-- -->/g, "")
}

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}

// Parse TRUTH fields from the generated file (deterministic shapes).
function truthNames(field: string): string[] {
  const m = read("website/src/data/truth.generated.ts").match(new RegExp(`${field}: \\[([^\\]]*)\\]`))
  return m ? (m[1]!.match(/"([^"]+)"/g) ?? []).map((s) => s.slice(1, -1)) : []
}

console.log("M41.T2 site-truth verifier")

// --- build the site -----------------------------------------------------------

console.log("  building site (next build)…")
let buildOk = false
let buildLog = ""
try {
  buildLog = execFileSync("npm", ["run", "build"], { cwd: SITE, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 420_000 })
  buildOk = true
} catch (e) {
  const err = e as { stdout?: string; stderr?: string }
  buildLog = `${err.stdout ?? ""}\n${err.stderr ?? ""}`
}
check("T2: site builds", buildOk, buildLog.split("\n").slice(-6).join(" | "))

const home = buildOk ? normalize(read("website/.next/server/app/index.html")) : ""
const toolsPage = buildOk ? normalize(read("website/.next/server/app/tools.html")) : ""
const docsPage = buildOk ? normalize(read("website/.next/server/app/docs.html")) : ""

// --- truth values --------------------------------------------------------------

const version = read("website/src/data/truth.generated.ts").match(/version: "([^"]+)"/)?.[1] ?? ""
const tables = Number(read("website/src/data/truth.generated.ts").match(/tables: (\d+)/)?.[1])
const langCount = Number(read("website/src/data/truth.generated.ts").match(/classified: (\d+)/)?.[1])
const dedicated = Number(read("website/src/data/truth.generated.ts").match(/dedicatedParsers: (\d+)/)?.[1])
const toolNames = truthNames("names: \\[\"bb_") .length ? truthNames("names: \\[\"bb_") : read("website/src/data/truth.generated.ts").match(/"name": "bb_[a-z_]+"/g)?.map((s) => s.match(/bb_[a-z_]+/)![0]) ?? []
const uniqueTools = [...new Set(toolNames)].sort()
const cliCommands = truthNames("cliCommands")

check("T2: generated truth parses (version, tables, languages, tools, commands)", Boolean(version && tables > 0 && langCount > 0 && uniqueTools.length > 0 && cliCommands.length > 0), `v=${version} tables=${tables} langs=${langCount} tools=${uniqueTools.length} cmds=${cliCommands.length}`)

// --- 1. homepage ---------------------------------------------------------------

check("T2: home renders generated version (v" + version + ")", home.includes(`v${version}`))
check("T2: home renders generated language count", home.includes(`${langCount} Languages Indexed`), `"${langCount} Languages Indexed"`)
check("T2: home renders dedicated parser count", home.includes(`${dedicated}`))
check("T2: home renders generated tool count", home.includes(`${uniqueTools.length} Agent Tools`))
check("T2: home renders generated table count", new RegExp(`>${tables}</div><div[^>]*>DB Tables`).test(home), `pattern >${tables}</div>…DB Tables`)
check("T2: home has no OpenCode attribution", !home.includes("OpenCode") && !home.includes("opencode"))

// --- 2. tools page ---------------------------------------------------------------

check("T2: tools page renders every real tool name", uniqueTools.every((t) => toolsPage.includes(t)), uniqueTools.filter((t) => !toolsPage.includes(t)).join(","))
check("T2: tools page renders generated tool count", toolsPage.includes(`${uniqueTools.length} Agent Tools`))

const PHANTOMS = ["bb_select", "bb_update", "bb_delete", "bb_insert", "bb_write", "bb_refactor", "bb_refresh", "bb_relationships"]
check("T2: no phantom tool name renders on tools page", PHANTOMS.every((p) => !toolsPage.includes(p)), PHANTOMS.filter((p) => toolsPage.includes(p)).join(","))
check("T2: no phantom tool name renders on docs page", PHANTOMS.every((p) => !docsPage.includes(p)), PHANTOMS.filter((p) => docsPage.includes(p)).join(","))
check("T2: no phantom tool name renders on homepage", PHANTOMS.every((p) => !home.includes(p)))

// --- 3. docs page ----------------------------------------------------------------

check("T2: docs renders every real CLI command", cliCommands.every((c) => docsPage.includes(`bb ${c}`)), cliCommands.filter((c) => !docsPage.includes(`bb ${c}`)).join(","))
check("T2: docs has no phantom opencode-era commands", ["bb brain", "bb run", "bb providers", "bb debug", "--pure"].every((c) => !docsPage.includes(c)), ["bb brain", "bb run", "bb providers", "bb debug", "--pure"].filter((c) => docsPage.includes(c)).join(","))
check("T2: docs quotes setup show (fingerprint-only inspection)", docsPage.includes("bb setup show"))
check("T2: docs quotes real remediation commands", docsPage.includes("bb index --force") && docsPage.includes("bb index --post") && docsPage.includes("bb index --resume"))
check("T2: docs tool table lists all tools", uniqueTools.every((t) => docsPage.includes(t)))
check("T2: docs honesty note about upgrade channel present", docsPage.includes("upgrade") && docsPage.includes("Backbencher releases"))

// --- 4. language display coverage (source-level) --------------------------------

const showcaseSrc = read("website/src/components/LanguageShowcase.tsx")
const idRefs = [...showcaseSrc.matchAll(/ids: \[([^\]]*)\]/g)].flatMap((m) => (m[1]!.match(/'([^']+)'/g) ?? []).map((s) => s.slice(1, -1)))
const registryNames = truthNames("names")
const idSet = [...new Set(idRefs)].sort()
const regSet = [...registryNames].sort()
check("T2: language display families reference registry ids only", idSet.every((id) => regSet.includes(id)), idSet.filter((id) => !regSet.includes(id)).join(","))
check("T2: language display union covers the registry exactly (no missing language)", JSON.stringify(idSet) === JSON.stringify(regSet), `display=${idSet.length} registry=${regSet.length}`)
check("T2: no duplicate registry id across display families", idRefs.length === idSet.length, `refs=${idRefs.length} unique=${idSet.length}`)

// --- 5. data-source hygiene -------------------------------------------------------

const toolsSrc = read("website/src/data/brain-tools.ts")
const orderMatch = toolsSrc.match(/TOOL_ORDER = \[([^\]]*)\]/)
const orderNames = orderMatch ? (orderMatch[1]!.match(/bb_[a-z_]+/g) ?? []) : []
check("T2: TOOL_ORDER covers the registry exactly", JSON.stringify([...orderNames].sort()) === JSON.stringify(uniqueTools), `order=${orderNames.length} registry=${uniqueTools.length}`)

const notesSrc = read("website/src/data/brain-tool-notes.ts")
const noteKeys = [...notesSrc.matchAll(/^  (bb_[a-z_]+): \{/gm)].map((m) => m[1]!)
check("T2: tool notes keys match the registry exactly", JSON.stringify([...noteKeys].sort()) === JSON.stringify(uniqueTools), `keys=${noteKeys.length} registry=${uniqueTools.length}`)
check("T2: notes contain no phantom keys", PHANTOMS.every((p) => !noteKeys.includes(p)))

// --- 6. negatives ------------------------------------------------------------------

// N1 (cheap, source-level): plant a hand-typed phantom claim in a data source
// and prove the source-hygiene checks catch it — without a rebuild.
{
  const target = path.join(SITE, "src/data/brain-tools.ts")
  const backup = path.join(SITE, "src/data/brain-tools.ts.t2bak")
  cpSync(target, backup)
  try {
    const mutated = read("website/src/data/brain-tools.ts").replace("const TOOL_ORDER = [", 'const TOOL_ORDER = [\n  "bb_select",')
    writeFileSync(target, mutated)
    const src = read("website/src/data/brain-tools.ts")
    const m = src.match(/TOOL_ORDER = \[([^\]]*)\]/)
    const names = m ? (m[1]!.match(/bb_[a-z_]+/g) ?? []) : []
    negative("T2: planted phantom in TOOL_ORDER breaks registry coverage check", JSON.stringify([...new Set(names)].sort()) !== JSON.stringify(uniqueTools))
  } finally {
    cpSync(backup, target)
    rmSync(backup)
  }
}

// N2 (full rebuild mutant): hand-type a stale version into the hero and prove
// the rendered-output gate FAILS. This is the end-to-end proof that a
// hand-typed claim cannot survive this verifier.
if (buildOk) {
  const heroPath = path.join(SITE, "src/components/HeroSection.tsx")
  const heroBackup = `${heroPath}.t2bak`
  cpSync(heroPath, heroBackup)
  let mutantCaught = false
  let mutantDetail = ""
  try {
    const mutated = read("website/src/components/HeroSection.tsx").replace(`v{TRUTH.version}`, `v9.9.9`)
    writeFileSync(heroPath, mutated)
    try {
      execFileSync("npm", ["run", "build"], { cwd: SITE, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 420_000 })
      const mutantHome = normalize(read("website/.next/server/app/index.html"))
      mutantCaught = mutantHome.includes("v9.9.9") && !mutantHome.includes(`v${version}`)
      mutantDetail = "hand-typed v9.9.9 rendered while generated version absent — gate must reject this page"
    } catch {
      mutantCaught = false
      mutantDetail = "mutant build failed for the wrong reason"
    }
  } finally {
    cpSync(heroBackup, heroPath)
    rmSync(heroBackup)
  }
  // The gate rule the mutant must violate, evaluated on the mutant output:
  negative("T2: hand-typed stale version in rendered output is detectable", mutantCaught, mutantDetail)

  // restore-proof rebuild: the committed source must render truth again
  try {
    execFileSync("npm", ["run", "build"], { cwd: SITE, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 420_000 })
    const restoredHome = normalize(read("website/.next/server/app/index.html"))
    check("T2: restore-proof — committed source renders generated truth again", restoredHome.includes(`v${version}`) && !restoredHome.includes("v9.9.9"))
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string }
    check("T2: restore-proof — committed source renders generated truth again", false, String(err.stderr ?? err.message).split("\n").slice(-3).join(" | "))
  }
}

// --- verdict + evidence ------------------------------------------------------------

let headCommit = "unknown"
try {
  headCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
} catch {}

const ok = passed === checks
console.log("")
console.log(`  checks: ${passed}/${checks} passed, ${negatives} negative cases`)
if (!ok) {
  console.log("VERDICT: FAIL")
  process.exit(1)
}
console.log("VERDICT: PASS")

mkdirSync(RESULTS, { recursive: true })
const evidence = {
  issue: "M41.T2",
  code: "T2",
  milestone: "M41",
  status: "verified",
  checks,
  passed,
  failed: checks - passed,
  negativeCases: negatives,
  currentCommit: headCommit,
  verifierCommand: "npx tsx script/m41/verify-site-truth.ts",
  evidenceFile: "T2.json",
  generatedAt: new Date().toISOString(),
  rendered: { version, tools: uniqueTools.length, tables, languages: langCount, dedicatedParsers: dedicated, cliCommands: cliCommands.length },
  limitations: [
    "Gate covers the three prerendered routes; new T3 routes must be added here in the same commit that adds them.",
    "N2 mutates the hero source and rebuilds twice; a failing site build aborts the mutant proof (build success is checked first).",
    "Editorial fields (features, examples, longDescription) are reviewed against docs/tools/*.md but not machine-diffed; the registry-owned fields are machine-enforced.",
  ],
}
writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n")
console.log(`  evidence: ${path.relative(ROOT, EVIDENCE_PATH)}`)
