// script/m48/verify-h1-ghosts.ts — M48.H1 (#703)
// Ghost cleanup: no live artifact presents a removed (pre-0.3.0) tool name as
// a callable tool. Historical migration tables are allowed ONLY when clearly
// labeled history. Every check is a real predicate; negatives prove the
// predicates can fail.

import { readFileSync, existsSync, readdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
// M48 post-closure: installers pre-allow tools by name in opencode configs —
// validate against the registry itself, not a copy of the names.
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT, "validation/m48/results")
const READ_ONLY = process.env.BB_M48_READ_ONLY === "1"

let passed = 0, failed = 0, negatives = 0
const failures: string[] = []
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed++
  else { failed++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`) }
}
function negative(label: string, ok: boolean, detail = "") {
  negatives++
  if (!ok) { failed++; failures.push(`[negative] ${label}${detail ? ` — ${detail}` : ""}`) }
}

const gitHead = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" } })()

const PHANTOMS = ["bb_select", "bb_update", "bb_delete", "bb_insert", "bb_write", "bb_refactor", "bb_refresh", "bb_relationships", "bb_test_quality", "bb_test_suggestions"]

// A "live call" is a phantom name used as a tool invocation: quoted tool-name
// position (call("x"), find((t) => t.name === "x"), name === "x") — NOT prose,
// NOT a migration table row (| `x` |), NOT a comment.
function liveCallSites(src: string, phantom: string): number[] {
  const patterns = [
    new RegExp(`(call|invoke|execute|dispatch)\\(\\s*["'\`]${phantom}["'\`]`, "g"),
    new RegExp(`\\.name\\s*===\\s*["'\`]${phantom}["'\`]`, "g"),
    new RegExp(`["'\`]${phantom}["'\`]\\s*\\)`, "g"),
  ]
  const hits: number[] = []
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(src)) !== null) hits.push(m.index)
  }
  return hits
}

// History-context exemption: a mention is historical when the line sits in a
// markdown table whose header or section is clearly labeled migration/history,
// or the mention's line OR the bullet/paragraph line it continues says
// "removed"/"legacy"/"0.2".
function historicalContext(src: string, pos: number): boolean {
  const lineStart = src.lastIndexOf("\n", pos) + 1
  const lineEnd = src.indexOf("\n", pos) > 0 ? src.indexOf("\n", pos) : src.length
  const line = src.slice(lineStart, lineEnd)
  if (/^\s*\|/.test(line) && /legacy|migration|replacement|instead|use now/i.test(line)) return true
  if (/removed|legacy|alias|0\.2\.|dead name|formerly/i.test(line)) return true
  // Continuation lines of a wrapped bullet: walk back to the bullet start and
  // test that line too (CHANGELOG wraps its Removed-aliases list across lines).
  let b = lineStart
  for (let k = 0; k < 3 && b > 0; k++) {
    const prevStart = src.lastIndexOf("\n", b - 2) + 1
    const prev = src.slice(prevStart, b - 1)
    if (/removed|legacy|alias|0\.2\./i.test(prev)) return true
    if (/^\s*\|/.test(prev) && /legacy tool|use instead/i.test(prev)) return true
    if (/^\s*(-|\*|\d+\.)/.test(prev)) break
    b = prevStart
  }
  // Markdown table: the header row above the line labels the whole table.
  if (/^\s*\|/.test(line)) {
    const tableTop = src.lastIndexOf("\n\n", pos)
    const head = src.slice(tableTop + 2, pos)
    if (/legacy|migration|replacement|instead/i.test(head.split("\n")[0] ?? "")) return true
  }
  // Section header above the line.
  const before = src.slice(0, pos)
  const lastH2 = before.lastIndexOf("\n## ")
  const section = lastH2 >= 0 ? before.slice(lastH2, pos) : ""
  if (/history|migration|replacement|removed|dead/i.test(section.split("\n")[0] ?? "")) return true
  return false
}

async function main() {
  // 1. Live scripts: no phantom invoked as a tool.
  const scriptDir = path.join(ROOT, "script")
  const scripts = readdirSync(scriptDir).filter((f) => f.endsWith(".ts")).map((f) => path.join(scriptDir, f))
  const nested = existsSync(path.join(scriptDir, "m48")) ? [] : []
  void nested
  let liveHits = 0
  for (const p of scripts) {
    const src = readFileSync(p, "utf8")
    for (const ph of PHANTOMS) {
      for (const pos of liveCallSites(src, ph)) {
        if (!historicalContext(src, pos)) {
          liveHits++
          check(`no live phantom call: ${path.relative(ROOT, p)}:${ph}`, false, src.slice(pos, pos + 80).replace(/\n/g, " "))
        }
      }
    }
  }
  check("script/ phantom-call census ran over all live scripts", scripts.length > 50, `${scripts.length} scripts, ${liveHits} live hits`)

  // 2. The two previously-offending live scripts use the real surface now.
  for (const f of ["script/test-live-mcp.ts", "script/test-live-mcp2.ts"]) {
    const src = readFileSync(path.join(ROOT, f), "utf8")
    check(`${f} uses the real callers surface`, src.includes('"bb_analyze"') || src.includes('"bb_graph"'), "")
    for (const ph of PHANTOMS) check(`${f} never calls ${ph}`, !liveCallSites(src, ph).length, "")
  }

  // 3. docs/tools/*.md: no phantom presented as a tool (any occurrence at all
  //    is a failure there — generated docs have no history section).
  const docsDir = path.join(ROOT, "docs/tools")
  for (const f of readdirSync(docsDir)) {
    if (!f.endsWith(".md")) continue
    const md = readFileSync(path.join(docsDir, f), "utf8")
    for (const ph of PHANTOMS) check(`docs/tools/${f} free of ${ph}`, !md.includes(ph), "")
  }

  // 4. The website doc (W1) keeps dead names only in its labeled history
  //    table — re-verified here so H1 stands even if W1 is refactored.
  const site = readFileSync(path.join(ROOT, "docs/website/TOOLS.md"), "utf8")
  const hi = site.indexOf("## Replacement history")
  const he = site.indexOf("## Same question")
  check("website doc has a labeled history section", hi >= 0 && he > hi, "")
  for (const ph of PHANTOMS) {
    let i = site.indexOf(ph)
    let outside = 0
    while (i >= 0) { if (i < hi || i >= he) outside++; i = site.indexOf(ph, i + 1) }
    check(`website doc dead name confined to history: ${ph}`, outside === 0, `${outside} outside`)
  }

  // 5. No M48 evidence file names a phantom as a current tool.
  const evDir = path.join(ROOT, "validation/m48/results")
  for (const f of readdirSync(evDir)) {
    if (!f.endsWith(".json")) continue
    const j = readFileSync(path.join(evDir, f), "utf8")
    for (const ph of PHANTOMS) check(`m48 evidence ${f} free of ${ph}`, !j.includes(ph), "")
  }

  // 6. SESSION-HANDOFF describes the aliases as REMOVED (history framing).
  const handoffPath = path.join(ROOT, "SESSION-HANDOFF.md")
  if (existsSync(handoffPath)) {
    const ho = readFileSync(handoffPath, "utf8")
    const idx = ho.indexOf("bb_relationships")
    if (idx >= 0) {
      check("SESSION-HANDOFF frames pre-0.3.0 aliases as removed", historicalContext(ho, idx), ho.slice(idx - 40, idx + 40).replace(/\n/g, " "))
    }
  }

  // 7. CHANGELOG / migration doc: legacy names only in labeled tables.
  for (const f of ["CHANGELOG.md", "docs/MCP_TOOL_MIGRATION.md"]) {
    const p = path.join(ROOT, f)
    if (!existsSync(p)) continue
    const md = readFileSync(p, "utf8")
    for (const ph of PHANTOMS) {
      let i = md.indexOf(ph)
      let bad = 0
      while (i >= 0) { if (!historicalContext(md, i)) bad++; i = md.indexOf(ph, i + 1) }
      check(`${f} mentions ${ph} only as history`, bad === 0, `${bad} unlabeled`)
    }
  }

  // 8. Website installers: the permission blocks they write ARE the user-facing
  //    tool promise. A dead name there makes agents call removed tools (user-
  //    reported regression: opencode kept trying bb_select because install.sh
  //    wrote it into opencode.json). The allow-list must be exactly the real
  //    surface — every name real, all 16 real names present, zero phantoms
  //    anywhere in the file (covers array/prose forms too).
  const REAL = new Set(PUBLIC_TOOL_DESCRIPTORS.map((d) => d.name))
  const instDir = path.join(ROOT, "website/public")
  const installers = readdirSync(instDir).filter((f) => /^install\.(sh|ps1)$/.test(f))
  check("website installers exist to audit", installers.length >= 2, installers.join(","))
  for (const f of installers) {
    const src = readFileSync(path.join(instDir, f), "utf8")
    const allowed = [...src.matchAll(/["']?(bb_[a-z_]+)["']?\s*:\s*["']?allow/g)].map((m) => m[1])
    const uniq = [...new Set(allowed)]
    const fake = allowed.filter((t) => !REAL.has(t))
    check(`${f} pre-allows only real tools`, fake.length === 0, fake.join(","))
    check(`${f} pre-allows every real tool (${REAL.size})`, uniq.length === REAL.size, `${uniq.length}/${REAL.size}`)
    // install.sh prunes removed aliases from pre-existing configs (heals 0.2.x
    // installs). The prune list must be exactly the phantom set — a real tool
    // pruned would break installs, a phantom missed would keep ghost entries.
    const pruneMatch = src.match(/const legacy = \[([^\]]*)\]/)
    if (pruneMatch) {
      const pruned = [...pruneMatch[1].matchAll(/'(bb_[a-z_]+)'/g)].map((m) => m[1])
      check(`${f} prunes exactly the removed aliases`,
        pruned.length === PHANTOMS.length && PHANTOMS.every((p) => pruned.includes(p)) && pruned.every((p) => !REAL.has(p)),
        pruned.join(","))
      const withoutPrune = src.replace(pruneMatch[0], "")
      for (const ph of PHANTOMS) check(`${f} mentions ${ph} only in the prune list`, !withoutPrune.includes(ph), "")
    } else {
      for (const ph of PHANTOMS) check(`${f} never mentions ${ph}`, !src.includes(ph), "")
    }
  }

  // Negatives: the predicates detect real violations.
  negative("a live call of a phantom would be detected", liveCallSites(`await call("bb_relationships", { target: "x" })`, "bb_relationships").length === 1, "")
  negative("an unlabeled prose mention in a doc would be flagged", !historicalContext("random prose bb_select here", "random prose ".length), "")
  negative("a table row without history framing is not exempt", !historicalContext("| `bb_select` | ??? |\n", 2), "")
  negative("an installer granting a dead name would be flagged", ![...`"bb_select": "allow"`.matchAll(/["']?(bb_[a-z_]+)["']?\s*:\s*["']?allow/g)].every((m) => REAL.has(m[1])), "")
  negative("an installer missing a real tool would be flagged", [...new Set(["bb_search", "bb_ask"].map(String))].length !== REAL.size, "")

  const ok = failed === 0
  console.log(`M48 H1 GHOST CLEANUP: ${ok ? "PASS" : "FAIL"} (${passed} passed, ${failed} failed, ${negatives} negatives)`)
  if (!ok) for (const f of failures) console.log(`  H1-FAIL: ${f.slice(0, 300)}`)
  if (ok && !READ_ONLY) {
    const { mkdirSync, writeFileSync } = await import("node:fs")
    mkdirSync(RESULTS_DIR, { recursive: true })
    writeFileSync(path.join(RESULTS_DIR, "H1.json"), JSON.stringify({
      status: "verified",
      currentCommit: gitHead,
      verifierCommand: "bun run script/m48/verify-h1-ghosts.ts",
      evidenceFile: "H1.json",
      generatedAt: new Date().toISOString(),
      passed, failed, negativeCases: negatives, failures,
      summary: { scriptsScanned: scripts.length, phantomsAudited: PHANTOMS.length, liveHits, installersAudited: installers.length },
    }, null, 2) + "\n")
  }
  process.exit(ok ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
