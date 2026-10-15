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

  /**
   * THE COMMIT RULE REJECTED THE REPO'S OWN SHORTHAND, AND `{8}` WAS THE BUG.
   *
   * This was `/\b[0-9a-f]{8}\b/`. A hex run of exactly eight characters has a boundary on both sides,
   * but a NINE-character run does not: the ninth hex character is a word character, so there is no
   * `\b` after the eighth. The rule therefore refused every hash longer than eight, which is every
   * hash this repo prints — `git log --oneline` abbreviates to NINE by default and a full hash is
   * FORTY. Measured on the old pattern: `ce54f5b2` MATCH · `ce54f5b27` NO MATCH ·
   * `1aad2e4a7b3c` NO MATCH.
   *
   * So a document that cited the commit EXACTLY — the most precise citation available, and the one a
   * reader can paste into `git show` — FAILED the check whose entire purpose is to require a commit
   * citation, and could only pass by truncating to a length `git` does not print by default. Found by
   * two independent lanes in the same session: `coverage-a` reported it while repairing R1 and met it
   * three times in eight failures, and the Lead hit it writing `reviews/toml/master-review.md`, where
   * four correct citations failed until each also carried an eight-character prefix.
   *
   * `{8,40}` bounds the run at both ends and is therefore correct for every length git emits. The
   * boundaries still do their job: prose has no 8-40 hex run, and a hex run embedded in a LONGER word
   * has no boundary and is still refused.
   */
  const commitRe = /\b[0-9a-f]{8,40}\b/
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
  // AND THE RULE MUST ACCEPT WHAT GIT ACTUALLY PRINTS, which is the half that was missing. A negative
  // control that only proves the rule REFUSES things cannot tell a working rule from an over-strict
  // one, and an over-strict one is exactly what shipped here.
  negative("the commit rule accepts git's DEFAULT nine-character abbreviation", commitRe.test("ce54f5b27"))
  // A REAL full hash, not a synthetic one: the first draft of this control used a hand-typed string that
  // was 41 hex characters, and the rule correctly refused it — a hex run with no closing boundary is not
  // a hash. The control was wrong, not the rule, which is worth recording because it is the same
  // direction of error this whole fix is about.
  negative("the commit rule accepts a full forty-character hash",
    commitRe.test("f5e870584b9dbe30319e3fbeee60573625422f25"))
  negative("the commit rule accepts an eight-character hash", commitRe.test("ce54f5b2"))
  negative("the commit rule still refuses a hex run glued to a longer word", !commitRe.test("zzz1aad2e4a7b3c"))

  console.log(`M49.R1: ${passed}/${checks} checks passed, ${negatives} negative(s) exercised, ${langDirs.length} review folder(s) tracked`)
  if (failed > 0) process.exitCode = 1
}

main()
