// script/m60/emit-lang-open-issues.ts — regenerate the tracker snapshot.
//
// WHY: `validation/m49/lang-open-issues.json` is what the language-completion
// matrix reads for its `tracker` cell ("open issue(s) 743, 795"), and it was
// hand-copied from a `gh issue list`. A hand-copied list of OPEN issues rots in
// the worst direction — it keeps claiming issues are open after they are closed,
// which is exactly the column that decides whether a language can be ticked. It is
// also the only artifact in the M60 chain whose content comes from outside the
// repository, so it must name how it was captured.
//
// Run: npx tsx script/m60/emit-lang-open-issues.ts
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..")
const OUT = path.join(ROOT, "validation", "m49", "lang-open-issues.json")
const LIMIT = process.env.BB_ISSUE_LIMIT ?? "300"

let raw: string
try {
  raw = execFileSync(
    "gh",
    ["issue", "list", "--state", "open", "--limit", LIMIT, "--json", "number,title,labels"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
} catch (e) {
  console.error(`emit-lang-open-issues: gh issue list failed (${(e as Error).message.split("\n")[0]}). Not writing an artifact.`)
  process.exit(2)
}

const issues = (JSON.parse(raw) as Array<{ number: number; title: string; labels: Array<{ name: string }> }>)
  .map((i) => ({ number: i.number, title: i.title, labels: (i.labels ?? []).map((l) => l.name).sort() }))
  .sort((a, b) => a.number - b.number)

const artifact = {
  snapshotAt: new Date().toISOString(),
  source: `gh issue list --state open --limit ${LIMIT}`,
  rule: "a snapshot of OPEN issues at snapshotAt; the matrix's tracker cell reads only this list, so a closed issue that lingers here keeps a language red past its resolution",
  count: issues.length,
  issues,
}

writeFileSync(OUT, JSON.stringify(artifact, null, 2) + "\n")
console.log(`emit-lang-open-issues: ${issues.length} open issue(s) → validation/m49/lang-open-issues.json at ${artifact.snapshotAt}`)
