#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────────────
// BRANCH REVIEW — a read-only census of every branch ref, so the repository can be
// reduced to ONE branch without losing a commit.
//
// WHY IT EXISTS: 587 refs (39 local, 548 remote) name only 358 distinct commits, because
// lanes, agents and merges left names for the same snapshots behind them. The cleanup plan
// is "merge what is unmerged, delete the rest", and that plan is only safe if every ref has
// been classified against the two lines that matter: `origin/main` (the canonical line) and
// the campaign line (this branch, or whatever the Lead names with CAMPAIGN_REF).
//
// THE RULE THIS TOOL ENFORCES: A REF IS DELETABLE ONLY WHEN ITS TIP IS AN ANCESTOR OF A
// SURVIVING LINE, OR WHEN IT IS A DUPLICATE OF A TIP THAT IS. Anything else is UNIQUE WORK
// and is listed for a human decision — the tool never deletes, it only classifies.
//
// USAGE
//   bun script/m14/branch-review.mjs                 # human table
//   bun script/m14/branch-review.mjs --markdown      # markdown for docs/
//   MAIN_REF=origin/main CAMPAIGN_REF=HEAD bun script/m14/branch-review.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { execSync } from "node:child_process"

const g = (cmd) => execSync(cmd, { encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 }).trim()
const MAIN = process.env.MAIN_REF || "origin/main"
const CAMP = process.env.CAMPAIGN_REF || "HEAD"
const MARKDOWN = process.argv.includes("--markdown")

const FIELDS = ["%(refname:short)", "%(objectname)", "%(committerdate:short)", "%(subject)"]
const raw = g(`git for-each-ref --format='${FIELDS.join("%09")}' refs/heads/ refs/remotes/origin/`)
const refs = []
for (const line of raw.split("\n")) {
  if (!line.trim()) continue
  const [name, sha, date, subject = ""] = line.split("\t")
  refs.push({ name, sha, date, subject })
}
const mainSet = new Set(g(`git rev-list ${MAIN}`).split("\n"))
const campSet = new Set(g(`git rev-list ${CAMP}`).split("\n"))
const byTip = new Map()
for (const r of refs) {
  if (!byTip.has(r.sha)) byTip.set(r.sha, { sha: r.sha, date: r.date, subject: r.subject, refs: [] })
  byTip.get(r.sha).refs.push(r.name)
}
const count = (range) => { try { return Number(g(`git rev-list --count ${range}`)) } catch { return -1 } }
const shortstat = (range, paths) => {
  try {
    const s = g(`git diff --shortstat ${range} -- ${paths}`)
    const m = s.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/)
    return m ? { files: Number(m[1]), ins: Number(m[2] || 0), del: Number(m[3] || 0) } : { files: 0, ins: 0, del: 0 }
  } catch { return null }
}
const rows = []
for (const tip of byTip.values()) {
  const inMain = mainSet.has(tip.sha)
  const inCamp = campSet.has(tip.sha)
  let cls, aheadMain = 0, code = null, added = [], addedCode = []
  if (tip.refs.length > 1) cls = "DUPLICATE-TIP"
  else if (inMain) cls = "MERGED-INTO-MAIN"
  else if (inCamp) cls = "MERGED-INTO-CAMPAIGN"
  else {
    aheadMain = count(`${MAIN}..${tip.sha}`)
    code = shortstat(`${MAIN} ${tip.sha}`, "src script docs packages apps")
    // ⇒⇒⇒ **ANCESTRY IS NOT THE TEST — CONTENT IS.** This history was rewritten three times
    // (squash re-commits, author rewrites), so a branch whose work IS in main can still show commits
    // "ahead" of it. The only question that decides a deletion is: does the branch carry CODE that the
    // surviving line does not have? `code.ins` is exactly that (lines only on the branch);
    // `code.del` is what the branch LACKS from main (it is behind). A branch whose additions are a
    // rounding error beside its deletions is a superseded snapshot, not unmerged work.
    // ⇒⇒⇒ THE SHARPEST CONTENT TEST AVAILABLE WITHOUT APPLYING PATCHES: files that exist ONLY on
    // the branch (`--diff-filter=A`). Every other "insertion" in a branch-vs-main diff is a rewrite of
    // a file main also has — and after three history rewrites those rewrites are stale versions, not
    // unmerged work. A branch that ADDS NO FILE cannot carry work the surviving line lacks; a branch
    // that adds files is the list a human must read before anything is deleted.
    try {
      added = g(`git diff --diff-filter=A --name-only ${MAIN} ${tip.sha} -- src script docs packages apps`)
        .split("\n").filter(Boolean)
    } catch { added = [] }
    // THE FILES THAT MATTER ARE CODE, AND NOT THE PROBE SCRATCH. A branch whose only extra files are
    // `*.superseded-<sha>.md` (the residue of the three history rewrites) or `script/m14/tmp/*` probes
    // carries no product work; a branch that ADDS a `src/` or `script/` file outside the scratch dir is
    // the list that must be read before deletion.
    const addedCode = added.filter((f) => (f.startsWith("src/") || f.startsWith("script/")) && !f.startsWith("script/m14/tmp/"))
    cls = addedCode.length > 0 ? "UNIQUE-CODE" : added.length > 0 ? "ADDS-DOCS-ONLY" : "SUPERSEDED-BEHIND"
  }
  rows.push({ ...tip, inMain, inCamp, cls, aheadMain, code, added, addedCode })
}
const order = ["UNIQUE-CODE", "ADDS-DOCS-ONLY", "SUPERSEDED-BEHIND", "MERGED-INTO-CAMPAIGN", "MERGED-INTO-MAIN", "DUPLICATE-TIP"]
rows.sort((a, b) => order.indexOf(a.cls) - order.indexOf(b.cls) || (a.date < b.date ? 1 : -1) || a.refs[0].localeCompare(b.refs[0]))
const summary = Object.fromEntries(order.map((c) => [c, rows.filter((r) => r.cls === c).length]))
const refCount = Object.fromEntries(order.map((c) => [c, rows.filter((r) => r.cls === c).reduce((n, r) => n + r.refs.length, 0)]))
const fmt = (r) => `${r.date}  ${r.refs[0]}${r.refs.length > 1 ? ` (+${r.refs.length - 1} refs)` : ""}  ${r.aheadMain >= 0 ? `${r.aheadMain} ahead` : ""}${r.code ? ` · code ${r.code.files}f +${r.code.ins}/-${r.code.del}` : ""}${r.addedCode?.length ? ` · ${r.addedCode.length} CODE file(s) ADDED` : r.added?.length ? ` · ${r.added.length} docs-only ADDED` : ""}`
if (!MARKDOWN) {
  console.log(`branch review — MAIN=${MAIN} CAMPAIGN=${CAMP}`)
  console.log(`refs: ${refs.length} · unique tips: ${rows.length}`)
  for (const c of order) console.log(`  ${c.padEnd(22)} ${String(summary[c]).padStart(3)} tips / ${String(refCount[c]).padStart(3)} refs`)
  for (const c of order) {
    const group = rows.filter((r) => r.cls === c)
    if (!group.length) continue
    console.log(`\n=== ${c} (${group.length} tips) ===`)
    for (const r of group.slice(0, 60)) {
      console.log("  " + fmt(r) + (r.subject ? `  — ${r.subject.slice(0, 60)}` : ""))
      for (const f of (r.addedCode || []).slice(0, 6)) console.log(`        + ${f}`)
      if ((r.addedCode || []).length > 6) console.log(`        + … ${r.addedCode.length - 6} more code files`)
    }
    if (group.length > 60) console.log(`  … and ${group.length - 60} more`)
  }
} else {
  console.log(`| class | tips | refs |`)
  console.log(`|---|---|---|`)
  for (const c of order) console.log(`| ${c} | ${summary[c]} | ${refCount[c]} |`)
  const unique = rows.filter((r) => r.cls === "UNIQUE-CODE")
  console.log(`\n### tips that ADD CODE files the surviving line lacks (${unique.length}) — a human decision each, never a blind delete\n`)
  console.log(`| date | ref | ahead of ${MAIN} | code diff vs ${MAIN} | files main lacks | subject |`)
  console.log(`|---|---|---|---|---|---|`)
  for (const r of unique) console.log(`| ${r.date} | \`${r.refs[0]}\`${r.refs.length > 1 ? ` (+${r.refs.length - 1})` : ""} | ${r.aheadMain} | ${r.code ? `${r.code.files}f +${r.code.ins}/-${r.code.del}` : "—"} | ${r.addedCode?.length || 0} | ${String(r.subject).replace(/\|/g, "\\|").slice(0, 70)} |`)
}
