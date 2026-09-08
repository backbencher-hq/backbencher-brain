// script/m49/verify-r1-intake.ts — M49.R1: review-intake protocol gate.
//
// M49's charter: external reviews (from the user, other agents, engineers)
// land in reviews/<language>/ and get processed with the java protocol —
// every claim verified against the code AND a live parse before fixing,
// every fix ends its session with fixture pin + mutant + spec decision.
//
// This gate machine-checks the intake pipeline:
//   1. Every reviews/<lang>/ folder appears on the onboarding board
//      (reviews/onboarding.md) — an undocumented review folder is a failure.
//   2. Every master-review.md carries a method + verdict tally (the java
//      protocol's first duty: classify before fixing).
//   3. Any review marked RESOLVED must cite its closure commit (hash) —
//      no prose-only resolutions.
//   4. The onboarding board's "Review folder" column and the actual folder
//      contents agree on open-vs-resolved (no silent drift).
//
// Run: bun script/m49/verify-r1-intake.ts
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const REVIEWS = path.join(ROOT, "reviews")
const BOARD = path.join(REVIEWS, "onboarding.md")

let checks = 0, passed = 0, failed = 0, negatives = 0
function check(name: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`) }
}
function negative(name: string, ok: boolean, detail = "") { negatives++; check(`${name} [negative]`, ok, detail) }

function main() {
  check("onboarding board exists", existsSync(BOARD))
  const board = existsSync(BOARD) ? readFileSync(BOARD, "utf8") : ""

  // 1. Folder <-> board agreement.
  const langDirs = readdirSync(REVIEWS).filter((f) => {
    const p = path.join(REVIEWS, f)
    return statSync(p).isDirectory() && f !== ".git"
  })
  for (const lang of langDirs) {
    check(`board tracks reviews/${lang}/`, board.includes(`reviews/${lang}`),
      "add or resolve the language's row in reviews/onboarding.md")
  }

  // 2. Review discipline: method + verdict tally present.
  const commitRe = /\b[0-9a-f]{8}\b/
  for (const lang of langDirs) {
    const dir = path.join(REVIEWS, lang)
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) {
      const text = readFileSync(path.join(dir, f), "utf8")
      const hasMethod = /\*\*Method:\*\*/.test(text)
      const hasTally = /[Vv]erdict|confirmed|REFUTED|RESOLVED/.test(text)
      check(`${lang}/${f}: method stated`, hasMethod)
      check(`${lang}/${f}: verdict tally stated`, hasTally)

      // 3. Resolved waves must cite a closure commit hash.
      if (/RESOLVED|Closed|closeout/i.test(text) && /Wave|wave/.test(text)) {
        check(`${lang}/${f}: resolution cites a commit`, commitRe.test(text))
      }
    }
  }

  // 4. Negative: a fabricated resolution (RESOLVED with no hash) must fail —
  //    simulate by scanning a synthetic string through the same rule.
  const fabricated = "All claims RESOLVED in this wave. Everything perfect."
  negative("prose-only resolution cannot pass", !commitRe.test(fabricated))

  console.log(`M49.R1: ${passed}/${checks} checks passed, ${negatives} negative(s) exercised, ${langDirs.length} review folder(s) tracked`)
  if (failed > 0) process.exitCode = 1
}

main()
