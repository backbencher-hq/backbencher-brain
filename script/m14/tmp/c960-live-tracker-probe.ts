// c960-live-tracker-probe — measure the LCM `tracker` cell against the LIVE issue
// list instead of the frozen snapshot, without writing any artifact.
//
// The matrix's own rule says a snapshot "keeps a language red past its resolution".
// `gh` answers again, so this asks the cell's own function (trackerHits) both ways.
//
// Run: bun script/m14/tmp/c960-live-tracker-probe.ts
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { trackerHits } from "../../m60/lang-completion-matrix.ts"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const frozen = JSON.parse(readFileSync(path.join(ROOT, "validation/m49/lang-open-issues.json"), "utf8"))
const lcm = JSON.parse(readFileSync(path.join(ROOT, "validation/m60/results/LCM.json"), "utf8"))

const raw = execFileSync("gh", ["issue", "list", "--state", "open", "--limit", "500", "--json", "number,title"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})
const liveIssues = JSON.parse(raw)
const live = { snapshotAt: new Date().toISOString(), count: liveIssues.length, issues: liveIssues }

console.log(`frozen snapshot: ${frozen.count} open @ ${frozen.snapshotAt}`)
console.log(`live  gh query : ${live.count} open @ ${live.snapshotAt}`)
console.log("")

const langs: string[] = lcm.rows.map((r: any) => r.lang)
const flip: string[] = []
const stillRed: string[] = []
for (const lang of langs) {
  const before = trackerHits(lang, frozen)
  const after = trackerHits(lang, live)
  if (before.length && !after.length) flip.push(lang)
  else if (after.length) stillRed.push(`${lang}(${after.join(",")})`)
}

console.log(`tracker cell flips red -> pass on the live list (${flip.length}): ${flip.join(" ")}`)
console.log(`still red on the live list (${stillRed.length}):`)
for (const s of stillRed) console.log(`   ${s}`)

// Languages the detector names but no analyzer covers — reported separately by the matrix.
for (const l of ["nim", "protobuf", "vb"]) {
  const b = trackerHits(l, frozen)
  const a = trackerHits(l, live)
  console.log(`nonAnalyzerDetected ${l}: frozen=${b.join(",") || "none"} live=${a.join(",") || "none"}`)
}

// Which of the frozen snapshot's issues are no longer open (so the snapshot is provably stale).
const liveNums = new Set(liveIssues.map((i: any) => i.number))
const gone = frozen.issues.filter((i: any) => !liveNums.has(i.number)).map((i: any) => i.number)
const added = liveIssues.filter((i: any) => !frozen.issues.some((f: any) => f.number === i.number)).map((i: any) => i.number)
console.log("")
console.log(`closed since the snapshot (${gone.length}): ${gone.join(" ")}`)
console.log(`opened since the snapshot (${added.length}): ${added.join(" ")}`)
