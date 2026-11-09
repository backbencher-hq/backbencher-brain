/**
 * verify-skills.ts — the gate for the agent-skills package (skills/).
 *
 * The canonical strings checked here are defined ONCE, in this file:
 *   SHARED  one line every skill carries, pointing at the package README's rules
 *   REPORT  the optional-report line every SKILL.md ends with
 * Editing a skill's wording means editing it here too — that is the intended coupling,
 * because these two paragraphs must be identical across all nine skills.
 *
 * Checks:
 *   S1  package metadata: name/version/files/bin of @backbencher/skills
 *   S2  exactly the expected nine skills, each with SKILL.md
 *   S3  frontmatter: name == dir, description starts "use when", unique, <=300 chars,
 *       license MIT, metadata.version == package version, owner-tools valid
 *   S4  ownership: each public bb tool is owned by EXACTLY ONE skill (no duplication, no gap)
 *   S5  body budget: <=120 lines, <=7000 chars; references docs instead of copying them
 *   S6  canonical lines present verbatim; attribution/retry blacklist absent
 *   S7  every owner tool name appears in its skill's body
 *   S8  README + skills mention every public CLI command
 *   S9  installer test in a temp dir: install -> idempotent re-run -> verify -> conflict skip
 *
 * Run: npx tsx script/verify-skills.ts
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ROOT = process.cwd()
const SK = join(ROOT, "skills")
const SKILLS = join(SK, "skills")
const pkg = JSON.parse(readFileSync(join(SK, "package.json"), "utf8")) as {
  name: string
  version: string
  files: string[]
  bin: Record<string, string>
  license: string
}
const rawTools = JSON.parse(readFileSync(join(ROOT, "docs/data/public-tools.json"), "utf8")) as
  | unknown[]
  | { tools?: unknown[] }
const toolList: unknown[] = Array.isArray(rawTools) ? rawTools : (rawTools.tools ?? [])
const tools = toolList
  .map((t) => (t as { name?: string }).name)
  .filter((n): n is string => typeof n === "string")
  .sort()

const EXPECTED = [
  "bb-code-audit",
  "bb-code-navigation",
  "bb-doc-writing",
  "bb-edit-safety",
  "bb-evidence-reading",
  "bb-index-onboarding",
  "bb-install-and-connect",
  "bb-migration-planning",
  "bb-report-writing",
].sort()

const CLI = ["doctor", "health", "help", "index", "mcp", "onboard", "projects", "search", "setup", "stats", "status", "tool", "upgrade", "version"]

const SHARED =
  "Shared rules: freshness, truncation, declared absence and attribution are defined once in the package README (`README.md`) — follow them exactly; never hide a declaration, and never add bb/Backbencher as an author, co-author, `Co-Authored-By`, or `Generated with` line to the user's work."
const REPORT =
  "Optional report: if a `bb` tool returns something wrong or misleading, open the **Agent report** issue form — https://github.com/backbencher-hq/backbencher-brain/issues/new?template=agent-report.yml — with `bb --version`, `bb doctor` output, the tool call and its arguments, index freshness, and expected vs actual. Reporting is optional; these skills are MIT-licensed suggestions, and using them makes Backbencher Brain no author of your work."
const BLACKLIST = [
  "ignore the freshness",
  "ignore the staleness",
  "retry until",
  "assume it is fresh",
  "assume fresh",
  "no need to reindex",
  "Co-Authored-By: bb",
  "Generated with bb",
  "Generated with Backbencher",
]

let pass = 0
let fail = 0
const failures: string[] = []
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass++
    console.log(`  PASS: ${name}`)
  } else {
    fail++
    failures.push(`${name} — ${detail}`)
    console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

console.log("skills gate — @backbencher/skills")

// S1 — package metadata
check("S1: package is @backbencher/skills, MIT, with a bin", pkg.name === "@backbencher/skills" && pkg.license === "MIT" && Object.keys(pkg.bin).length === 1, JSON.stringify({ name: pkg.name, license: pkg.license, bin: pkg.bin }))
check("S1: package files include skills/ and bin/", pkg.files.includes("skills/") && pkg.files.includes("bin/"), JSON.stringify(pkg.files))
check("S1: installer exists", existsSync(join(SK, pkg.bin["bb-skills"] ?? "bin/bb-skills.mjs")), "bin path")

// S2 — exact skill set
const dirs = readdirSync(SKILLS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
check("S2: exactly the expected nine skills", JSON.stringify(dirs) === JSON.stringify(EXPECTED), `found ${dirs.length}: ${dirs.join(",")}`)
const docs = dirs.filter((d) => existsSync(join(SKILLS, d, "SKILL.md")))
check("S2: every skill has SKILL.md", docs.length === dirs.length, `${docs.length}/${dirs.length}`)

// S3/S5/S6/S7 — per skill
interface Parsed {
  name: string
  description: string
  ownerTools: string[]
  version: string
  license: string
  body: string
}
const parsed = new Map<string, Parsed>()
for (const dir of dirs) {
  const file = join(SKILLS, dir, "SKILL.md")
  if (!existsSync(file)) continue
  const text = readFileSync(file, "utf8")
  const fm = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  check(`S3 ${dir}: frontmatter parses`, Boolean(fm), "no --- block")
  if (!fm) continue
  const [, head, body] = fm
  const name = head.match(/^name:\s*(\S+)$/m)?.[1] ?? ""
  const description = head.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? ""
  const license = head.match(/^license:\s*(\S+)$/m)?.[1] ?? ""
  const version = head.match(/^\s+version:\s*(\S+)$/m)?.[1] ?? ""
  const ownerRaw = head.match(/^\s+owner-tools:\s*(\[[^\]]*\])$/m)?.[1] ?? "[]"
  let ownerTools: string[] = []
  try {
    ownerTools = JSON.parse(ownerRaw) as string[]
  } catch {
    ownerTools = []
  }
  parsed.set(dir, { name, description, ownerTools, version, license, body })
  check(`S3 ${dir}: name matches directory`, name === dir, `name=${name}`)
  check(`S3 ${dir}: description is a "use when" line`, description.toLowerCase().startsWith("use when"), description.slice(0, 80))
  check(`S3 ${dir}: description <= 300 chars`, description.length <= 300, String(description.length))
  check(`S3 ${dir}: license MIT`, license === "MIT", license)
  check(`S3 ${dir}: version matches package`, version === pkg.version, `${version} != ${pkg.version}`)
  check(`S3 ${dir}: owner-tools are real bb tools`, ownerTools.every((t) => tools.includes(t)), ownerTools.filter((t) => !tools.includes(t)).join(","))
  const lines = body.split("\n").length
  check(`S5 ${dir}: body <= 120 lines`, lines <= 120, `${lines} lines`)
  check(`S5 ${dir}: body <= 7000 chars`, body.length <= 7000, `${body.length} chars`)
  check(`S6 ${dir}: shared-rules line present verbatim`, body.includes(SHARED), "canonical line missing")
  check(`S6 ${dir}: report line is the last paragraph`, body.trimEnd().endsWith(REPORT), "report line must END the file, verbatim")
  const bad = BLACKLIST.filter((b) => body.includes(b))
  check(`S6 ${dir}: no attribution/retry-around-declaration phrases`, bad.length === 0, bad.join(","))
  check(`S7 ${dir}: body names every owner tool`, ownerTools.every((t) => body.includes(t)), ownerTools.filter((t) => !body.includes(t)).join(","))
}

// S3 — descriptions unique, triggers not colliding
const descs = [...parsed.values()].map((p) => p.description.toLowerCase())
check("S3: descriptions are unique", new Set(descs).size === descs.length, `${descs.length - new Set(descs).size} duplicate(s)`)
for (let i = 0; i < descs.length; i++) {
  for (let j = i + 1; j < descs.length; j++) {
    const words = (s: string) => new Set(s.replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3))
    const a = words(descs[i])
    const b = words(descs[j])
    const inter = [...a].filter((w) => b.has(w)).length
    const union = new Set([...a, ...b]).size
    const jac = inter / union
    check(`S3: description trigger overlap ${i}/${j} <= 0.5`, jac <= 0.5, `jaccard=${jac.toFixed(2)}`)
  }
}

// S4 — single ownership of every tool
const owned = new Map<string, string[]>()
for (const [dir, p] of parsed) {
  for (const t of p.ownerTools) {
    owned.set(t, [...(owned.get(t) ?? []), dir])
  }
}
const missing = tools.filter((t) => !owned.has(t))
const doubled = [...owned.entries()].filter(([, owners]) => owners.length > 1)
check("S4: every public bb tool is owned (16/16)", missing.length === 0, missing.join(","))
check("S4: no tool is owned twice", doubled.length === 0, doubled.map(([t, o]) => `${t}:${o.join("+")}`).join(","))

// S8 — CLI command coverage in README + skills
const corpus = readFileSync(join(SK, "README.md"), "utf8") + "\n" + [...parsed.values()].map((p) => p.body).join("\n")
const missingCli = CLI.filter((c) => !new RegExp(`\\b${c}\\b`).test(corpus))
check("S8: README+skills mention every public CLI command", missingCli.length === 0, missingCli.join(","))

// S9 — installer test (temp dirs; never touches the repo)
{
  const tmp = mkdtempSync(join(tmpdir(), "bb-skills-gate-"))
  const bin = join(SK, pkg.bin["bb-skills"] ?? "bin/bb-skills.mjs")
  const target = join(tmp, "agents-skills")
  try {
    const run = (args: string[]) => execFileSync(process.execPath, [bin, ...args], { encoding: "utf8", timeout: 120_000 })
    const first = run(["install", "--dir", target, "--json"])
    const installed = JSON.parse(first) as { actions: { action: string }[]; version: string }
    check("S9: install writes every skill", installed.actions.filter((a) => a.action === "installed").length === EXPECTED.length, JSON.stringify(installed.actions.map((a) => a.action)))
    check("S9: manifest written with package version", existsSync(join(target, ".bb-skills.json")) && JSON.parse(readFileSync(join(target, ".bb-skills.json"), "utf8")).version === pkg.version, "manifest")
    const second = run(["install", "--dir", target, "--json"])
    const rerun = JSON.parse(second) as { actions: { action: string }[] }
    check("S9: re-run is idempotent (all unchanged)", rerun.actions.every((a) => a.action === "unchanged"), JSON.stringify(rerun.actions.map((a) => a.action)))
    const ver = run(["verify", "--dir", target])
    check("S9: verify accepts the installed copy", ver.includes(`OK ${target}: ${EXPECTED.length}/${EXPECTED.length}`), ver.slice(0, 160))
    const foreign = join(tmp, "foreign")
    mkdirSync(join(foreign, EXPECTED[0]!), { recursive: true })
    writeFileSync(join(foreign, EXPECTED[0]!, "SKILL.md"), "---\nname: not-ours\n---\n")
    const third = run(["install", "--dir", foreign, "--json"])
    const skips = (JSON.parse(third) as { actions: { action: string }[] }).actions.filter((a) => a.action.startsWith("skipped"))
    check("S9: never overwrites a directory it did not install", skips.length === 1, JSON.stringify(skips))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

console.log("")
console.log(`checks: ${pass}/${pass + fail} passed`)
if (fail) {
  console.log("VERDICT: FAIL")
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log("VERDICT: PASS")
