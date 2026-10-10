/**
 * CHUNKED WHOLE-POPULATION MEASUREMENT — one repository at a time, summed.
 *
 * WHY. `incoming-gate.ts <lang> <ext> 0` pools every symbol of the WHOLE population into four maps
 * before it classifies a single edge, so a large lane cannot be measured in one process: json dies
 * with exit 134 (OOM) at ~4,000 of its 14,009 files. The product does not do this — production
 * resolves PER PROJECT (`parallel-indexer.resolveRelationships` fills `target_symbol_id` from a
 * project-scoped key space) — so a repo-at-a-time walk is not a workaround for the gate's limit, it
 * is the SAME SCOPE the verdict is already defined over. What the single-process run adds is only a
 * convenience: one invocation instead of N.
 *
 * WHAT IT AGGREGATES. Every counter the gate's TOTAL row carries, summed across repos, plus the
 * population actually covered (files parsed / files admitted) so a partial run cannot be read as a
 * whole one. The exit code is the WORST repo verdict: any FAIL makes the run exit 1, and any repo
 * whose process died is reported as UNMEASURED and makes the run exit 2 — never silently dropped
 * from the sum.
 *
 * Usage: node script/m14/chunked-incoming.cjs <lang> <ext> [--min-files N] [--json]
 */
const { execFileSync } = require("node:child_process")
const { readdirSync, existsSync } = require("node:fs")
const path = require("node:path")

const ROOT = path.resolve(__dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT || "$HOME/fixtures/repositories"
const args = process.argv.slice(2)
const JSON_MODE = args.includes("--json")
const pos = args.filter((a) => !a.startsWith("--"))
const lang = pos[0]
const ext = pos[1]
const minFiles = Number(args.includes("--min-files") ? args[args.indexOf("--min-files") + 1] : 1)
if (!lang || !ext) { console.error("usage: chunked-incoming.cjs <lang> <ext> [--min-files N] [--json]"); process.exit(2) }

const exts = ext.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
const repos = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  if (!existsSync(path.join(dir, ".git"))) continue
  let files = []
  try {
    files = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  const n = files.filter((f) => exts.some((e) => f.toLowerCase().endsWith("." + e))).length
  if (n >= minFiles) repos.push({ name, files: n })
}

const TOTAL_KEYS = ["edges", "resolved", "amb", "ambKind", "unres", "extOK", "extQ", "extFAIL", "bindOK", "bindQ", "bindFAIL", "causeOK", "causeFAIL"]
const sum = Object.fromEntries(TOTAL_KEYS.map((k) => [k, 0]))
const perRepo = []
let failed = 0, unmeasured = 0
for (const r of repos) {
  let out = ""
  try {
    out = execFileSync("npx", ["tsx", "script/m14/incoming-gate.ts", lang, ext, "0", `--repo=${r.name}`], {
      cwd: ROOT, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
    })
  } catch (e) {
    out = typeof e?.stdout === "string" ? e.stdout : ""
  }
  const line = out.split("\n").find((l) => l.trim().startsWith("TOTAL"))
  const verdictLine = out.split("\n").find((l) => l.trim().startsWith("VERDICT"))
  const popLine = out.split("\n").find((l) => l.trim().startsWith("population:"))
  if (!line) {
    // NO TOTAL ROW: the process died or refused. Counted as UNMEASURED, never as zero.
    unmeasured++
    perRepo.push({ repo: r.name, files: r.files, measured: false, note: "NO TOTAL ROW — killed, OOM, or control refused" })
    continue
  }
  const nums = line.trim().split(/\s+/).slice(1).map((x) => Number(x.replace(/,/g, "")))
  const row = Object.fromEntries(TOTAL_KEYS.map((k, i) => [k, nums[i]]))
  for (const k of TOTAL_KEYS) sum[k] += row[k] || 0
  const isPass = (verdictLine || "").includes("PASS")
  if (!isPass) failed++
  perRepo.push({ repo: r.name, files: r.files, measured: true, pass: isPass, population: popLine || null, ...row })
}

const residualOf = (t) => t.amb + t.unres + t.extFAIL + t.bindFAIL + t.causeFAIL
if (JSON_MODE) {
  console.log(JSON.stringify({ instrument: "chunked-incoming.cjs", lang, ext, repos: repos.length, measured: perRepo.filter((r) => r.measured).length, unmeasured, failed, totals: sum, perRepo }, null, 2))
} else {
  const w = (s, n) => (String(s) + " ".repeat(n)).slice(0, n)
  console.log(`chunked incoming — ${lang} (.${ext}), ${repos.length} repo(s) with >= ${minFiles} file(s)`)
  console.log(`${w("repo", 28)} ${w("files", 7)} ${w("edges", 10)} ${w("resolved", 10)} ${w("amb", 9)} ${w("unres", 9)} ${w("extFAIL", 8)} verdict`)
  console.log("-".repeat(90))
  for (const r of perRepo) {
    if (!r.measured) { console.log(`${w(r.repo, 28)} ${w(r.files, 7)} ${w("-", 10)} ${w("-", 10)} ${w("-", 9)} ${w("-", 9)} ${w("-", 8)} UNMEASURED`); continue }
    console.log(`${w(r.repo, 28)} ${w(r.files, 7)} ${w(r.edges, 10)} ${w(r.resolved, 10)} ${w(r.amb, 9)} ${w(r.unres, 9)} ${w(r.extFAIL, 8)} ${r.pass ? "PASS" : "FAIL"}`)
  }
  console.log("-".repeat(90))
  const resid = residualOf(sum)
  console.log(`${w("TOTAL", 28)} ${w(perRepo.reduce((a, r) => a + r.files, 0), 7)} ${w(sum.edges, 10)} ${w(sum.resolved, 10)} ${w(sum.amb, 9)} ${w(sum.unres, 9)} ${w(sum.extFAIL, 8)} ${failed ? `${failed} FAIL` : "PASS"}`)
  console.log(`\nresolved ${sum.edges ? ((sum.resolved / sum.edges) * 100).toFixed(1) : "?"}%   residual ${resid} of ${sum.edges}   ` +
    `extFAIL ${sum.extFAIL}  bindFAIL ${sum.bindFAIL}  causeFAIL ${sum.causeFAIL}   UNMEASURED repos ${unmeasured}`)
  console.log(`SCOPE: per-project, which is the scope production resolves in. Each repo is one chunk; the sum is the lane's whole-population total.`)
}
process.exit(unmeasured > 0 ? 2 : failed > 0 ? 1 : 0)
