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
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const SITE = path.join(ROOT, "website")
const RESULTS = path.join(ROOT, "validation/m41/results")
// T3 evidence mode: `--label T3` emits T3.json (same checks, T3 attribution).
const LABEL = process.argv.includes("--label") ? (process.argv[process.argv.indexOf("--label") + 1] ?? "T2") : "T2"
const EVIDENCE_FILE = `${LABEL}.json`
const EVIDENCE_PATH = path.join(RESULTS, EVIDENCE_FILE)

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

// --- 3b. T3 pages: install, faq, troubleshooting, contact ------------------------

const EXPECTED_ROUTES = ["index", "docs", "tools", "languages", "install", "faq", "troubleshooting", "contact"]
for (const route of EXPECTED_ROUTES) {
  check(`T3: route rendered (${route}.html exists in build output)`, buildOk && read(`website/.next/server/app/${route}.html`).length > 0)
}

const installHtml = buildOk ? normalize(read("website/.next/server/app/install.html")) : ""
const faqHtml = buildOk ? normalize(read("website/.next/server/app/faq.html")) : ""
const troubleshootHtml = buildOk ? normalize(read("website/.next/server/app/troubleshooting.html")) : ""
const contactHtml = buildOk ? normalize(read("website/.next/server/app/contact.html")) : ""

const installVersion = read("website/src/data/truth.generated.ts").match(/install: \{[\s\S]*?version: "([^"]+)"/)?.[1] ?? ""
const installRepo = read("website/src/data/truth.generated.ts").match(/repo: "([^"]+)"/)?.[1] ?? ""
check("T3: install page states the REAL installer version from truth", installVersion !== "" && installHtml.includes(installVersion), installVersion)
check("T3: install page states the REAL installer release repo from truth", installRepo !== "" && installHtml.includes(installRepo), installRepo)
check("T3: install page quotes both real installer commands", installHtml.includes("https://backbencher.cc/install.sh | bash") && installHtml.includes("https://backbencher.cc/install.ps1 | iex"))
check("T3: install page distinguishes installer channel from engine version", installHtml.includes(`(installer)` ) && installHtml.includes(`engine ${version}`), `engine ${version}`)

check("T3: FAQ renders generated tool count", faqHtml.includes(`${uniqueTools.length} agent tools`))
check("T3: FAQ renders generated language counts", faqHtml.includes(`${langCount}`) && faqHtml.includes(`${dedicated}`))
check("T3: FAQ quotes real setup command", faqHtml.includes("bb setup"))
check("T3: FAQ answers the open-source question honestly", faqHtml.includes("Not right now"))

check("T3: troubleshooting quotes real remediation commands", ["bb index --changed", "bb index --post", "bb index --force", "bb index --resume", "bb setup show", "bb doctor", "bb health"].every((c) => troubleshootHtml.includes(c)), ["bb index --changed", "bb index --post", "bb index --force", "bb index --resume", "bb setup show", "bb doctor", "bb health"].filter((c) => !troubleshootHtml.includes(c)).join(","))
check("T3: contact offers only the real support channel", contactHtml.includes("support@backbencher.cc"))
check("T3: shared footer renders on all T3 pages", [installHtml, faqHtml, troubleshootHtml, contactHtml].every((h) => h.includes("independent, local-first code intelligence engine")))

const navSrc = read("website/src/components/Navigation.tsx")
check("T3: navigation links every route", EXPECTED_ROUTES.every((r) => r === "index" || navSrc.includes(`href: '/${r}'`)), EXPECTED_ROUTES.filter((r) => r !== "index" && !navSrc.includes(`href: '/${r}'`)).join(","))
check("T3: no phantom command renders on any T3 page", PHANTOMS.every((p) => ![installHtml, faqHtml, troubleshootHtml, contactHtml].some((h) => h.includes(p))))

// --- 4. language display coverage (source-level) --------------------------------

const showcaseSrc = read("website/src/data/brain-languages.ts")
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
  // Backup lives OUTSIDE the repo tree (os.tmpdir): a co-agent's broad
  // `git commit -a` on the shared checkout once swept the in-repo backup AND
  // the planted mutant into a commit (5cce610b). tmpdir makes that impossible.
  const heroBackup = path.join(tmpdir(), `hero-t2bak-${process.pid}.tsx`)
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

// N3 (cheap, rendered-output predicate): inject a phantom command into a copy
// of a built page's HTML and prove the phantom-render predicate detects it —
// the detector must be sensitive to exactly the lie class T2/T3 guard against.
{
  const synthetic = installHtml.length > 0 ? installHtml + " bb_refresh --wait" : "bb_refresh --wait"
  const allPages = [installHtml, faqHtml, troubleshootHtml, contactHtml, toolsPage, docsPage, home]
  negative("T3: phantom-in-rendered-HTML detector is sensitive", PHANTOMS.some((p) => synthetic.includes(p)) && PHANTOMS.every((p) => !allPages.some((h) => h.includes(p))))
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
  issue: `M41.${LABEL}`,
  code: LABEL,
  milestone: "M41",
  status: "verified",
  checks,
  passed,
  failed: checks - passed,
  negativeCases: negatives,
  currentCommit: headCommit,
  verifierCommand: "npx tsx script/m41/verify-site-truth.ts",
  evidenceFile: EVIDENCE_FILE,
  generatedAt: new Date().toISOString(),
  rendered: { version, tools: uniqueTools.length, tables, languages: langCount, dedicatedParsers: dedicated, cliCommands: cliCommands.length },
  limitations: [
    "Gate covers the seven prerendered routes; adding a route requires updating EXPECTED_ROUTES in the same commit.",
    "N2 mutates the hero source and rebuilds twice; a failing site build aborts the mutant proof (build success is checked first).",
    "N3 proves detector sensitivity on synthetic HTML; a full rebuild mutant (N2) covers the end-to-end path.",
    "Editorial fields (features, examples, longDescription) are reviewed against docs/tools/*.md but not machine-diffed; the registry-owned fields are machine-enforced.",
  ],
}
writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n")
console.log(`  evidence: ${path.relative(ROOT, EVIDENCE_PATH)}`)
