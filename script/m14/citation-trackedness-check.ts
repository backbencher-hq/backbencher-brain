#!/usr/bin/env bun
/**
 * THE CITATION-TRACKEDNESS CHECK (Lead, 2026-10-21).
 *
 * ★ WHY THIS EXISTS, AND IT IS A REAL DEFECT THE LEAD MEASURED. The csharp lane's spec cites
 * `validation/m14/measurements/csharp-emission-census-cap2000.json` as the evidence for FOUR
 * exclusions. The gate checked it and passed — because the gate checks the file EXISTS ON DISK.
 * The file DOES exist on disk. IT IS NOT IN GIT.
 *
 * ⇒ ⇒ ⇒ THAT IS THE HOLE, AND IT IS EXACTLY THE CLASS OF DEFECT THE CAMPAIGN KEEPS FINDING: A
 * CITATION TO A FILE THAT IS NOT IN THE REPOSITORY IS A CITATION NOBODY ELSE CAN CHECK. It is a
 * claim with a local witness and no durable evidence. The gate's existence check is a LOCAL check,
 * and the owner has said it directly: the code is local, a laptop failure destroys it, the work must
 * be pushed to the remote. A ruling resting on an untracked file is a ruling that dies with the
 * machine — while the SPEC, which cites it, is on the remote and looks settled.
 *
 * ★ THE CHECK IS STRICTLY STRONGER THAN THE GATE'S, AND IT IS THE RIGHT STRICTNESS: THE CITED PATH
 * MUST BE TRACKED BY GIT IN THE CURRENT HEAD. Not present on disk — PRESENT IN THE TREE. A file that
 * exists on disk and is untracked, or that is gitignored, or that was deleted and left behind as an
 * untracked leftover, ALL FAIL.
 *
 * ★ IT ALSO CHECKS THE OTHER DIRECTION, WHICH NOBODY HAS CHECKED: A CITATION THAT POINTS AT A
 * `.tmp-` DIRECTORY IS A CITATION TO A TEMPORARY PATH. The vue lane's `implements` exclusion cites
 * `.tmp-f48/cov/grammar-nodes.json` — a path under a temp directory, which is by construction
 * ephemeral and is not in the repository at any commit. That one is a REAL defect, and it is the
 * second kind of failure this tool finds: a citation that is not REPRODUCIBLE FROM THE REPOSITORY.
 *
 * RUN: bun script/m14/citation-trackedness-check.ts
 *
 * EXIT: 0 when every citation in every lane's spec resolves to a file that is TRACKED IN GIT at HEAD
 * and is not under a temporary path; 5 otherwise, because a citation that cannot be checked is a
 * claim that cannot be relied on.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve, join } from "node:path"

const ROOT = resolve(import.meta.dir, "../..")
const SPEC_DIR = resolve(ROOT, "script/m14/spec")

/** THE SPEC FILES, IN THE LANE ORDER, DISCOVERED FROM THE DIRECTORY — never from a hard-coded list,
 *  because a hard-coded list is a list that goes stale. */
const specFiles = readdirSync(SPEC_DIR)
  .filter((f) => f.endsWith("-completeness.json"))
  .sort()

/** THE FILES GIT TRACKS AT HEAD. ONE CALL, so the answer is a census and not a sample. */
const tracked = new Set<string>(
  execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean),
)

/** EVERY PATH MENTIONED AS A CITATION, IN ANY LANE'S SPEC. The patterns are the citation forms the
 *  specs actually use: a `from` field, a `source` field, an `evidence` field, and a `path` field. */
const CITATION_FIELDS = ["from", "source", "evidence", "path", "citation", "artifact"]

interface Finding {
  lane: string
  spec: string
  cited: string
  kind: "UNTRACKED" | "TEMP-PATH" | "ABSENT" | "NOT-A-FILE"
  detail: string
}

const findings: Finding[] = []
let checked = 0

for (const specFile of specFiles) {
  const lane = specFile.replace(/-completeness\.json$/, "")
  const raw = readFileSync(join(SPEC_DIR, specFile), "utf8")
  // THE CITED PATHS ARE COLLECTED BY SCANNING FOR ANY STRING THAT LOOKS LIKE A REPOSITORY PATH, in
  // the fields the specs use, AND in free text. A citation can be in a prose note as easily as in a
  // field, and a prose citation is still a citation.
  const seen = new Set<string>()
  const push = (p: string) => {
    const s = p.trim().replace(/^["'`]|["'`]$/g, "")
    if (!s || seen.has(s)) return
    // A citation to a FILE, not a bare directory or a URL.
    if (!/\.[a-z0-9]+$/i.test(s)) return
    if (/^https?:/i.test(s)) return
    seen.add(s)
  }
  for (const field of CITATION_FIELDS) {
    const re = new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`, "g")
    let m: RegExpExecArray | null
    while ((m = re.exec(raw)) !== null) {
      const value = m[1]!
      // A FIELD MAY BE A BARE PATH, or it may be PROSE that names one or more paths. Both are
      // citations, and a field that names three paths cites all three — so the path-shaped tokens
      // are extracted individually.
      const whole = value.trim()
      if (/^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)+$/.test(whole)) { push(whole); continue }
      const tokenRe = /[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+/g
      let t: RegExpExecArray | null
      while ((t = tokenRe.exec(value)) !== null) push(t[0])
    }
  }
  // ★ AND THE PROSE SCAN WAS REMOVED, BECAUSE IT MEASURED THE WRONG THING. It matched any
  // `path/with/extension.ext` in the prose, and the prose is FULL of CORPUS paths — `eng/common/
  // tools.sh` is a file in a CORPUS REPOSITORY, not an artifact in this repository, and it was
  // reported as an ABSENT citation. 124 false findings, all of them corpus file paths quoted while
  // explaining what the analyzer emits.
  //
  // ⇒ THE DISTINCTION THAT MATTERS: A CITATION IS A CLAIM ABOUT AN ARTIFACT IN THIS REPOSITORY. A
  // CORPUS PATH IN PROSE IS A CLAIM ABOUT THE POPULATION, and the population is not version-controlled
  // here — it is 199 absolute symlinks into a local repository store. ⇒ THE CITATION FIELDS ARE THE
  // CITATIONS; THE PROSE IS NOT SCANNED FOR PATHS.

  // ★ THE FILTTER THAT MAKES THE TOOL RIGHT: A CITATION TO AN ARTIFACT IN THIS REPOSITORY BEGINS
  // WITH ONE OF THE REPOSITORY'S OWN TOP-LEVEL DIRECTORIES. Everything else — a corpus file path
  // (`eng/common/tools.sh`), a prose phrase, a bare symbol name — is not a citation to an artifact
  // and is not this tool's business. The directories are READ FROM THE REPOSITORY, not hard-coded,
  // because a hard-coded list is a list that goes stale the moment a lane adds a top-level directory.
  const REPO_DIRS = new Set(
    readdirSync(ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name),
  )

  for (const cited of seen) {
    // A PATH IN THE REPOSITORY IS A PATH UNDER ONE OF ITS TOP-LEVEL DIRECTORIES. A citation that
    // starts anywhere else is not a citation to an artifact here.
    const top = cited.split("/")[0] ?? ""
    if (!REPO_DIRS.has(top)) continue
    checked++
    const abs = resolve(ROOT, cited)
    // A CITATION TO A TEMPORARY PATH IS NOT REPRODUCIBLE FROM THE REPOSITORY, whatever git says.
    if (/(^|\/)\.tmp[-/]/.test(cited) || /(^|\/)(tmp|scratch|working)[-/]/.test(cited)) {
      findings.push({ lane, spec: specFile, cited, kind: "TEMP-PATH",
        detail: "a temporary path is ephemeral by construction and is in no commit" })
      continue
    }
    if (!existsSync(abs)) {
      findings.push({ lane, spec: specFile, cited, kind: "ABSENT",
        detail: "the file does not exist on disk" })
      continue
    }
    if (!tracked.has(cited)) {
      // IS IT GITIGNORED? That is a DIFFERENT defect from "never added", and the remedy differs:
      // an ignored file needs a NEGATION rule, an untracked file needs `git add`.
      let ignored = false
      try {
        execFileSync("git", ["check-ignore", "-q", cited], { cwd: ROOT, stdio: "ignore" })
        ignored = true
      } catch {
        ignored = false
      }
      findings.push({ lane, spec: specFile, cited, kind: "UNTRACKED",
        detail: ignored
          ? "the file exists and is GITIGNORED — it needs a negation rule"
          : "the file exists on disk and was never added to the repository" })
      continue
    }
  }
}

console.log("CITATION-TRACKEDNESS CHECK — every citation in every lane's spec")
console.log()
console.log("THE GATE CHECKS THAT A CITED FILE EXISTS ON DISK. THIS CHECKS THAT IT IS TRACKED IN GIT")
console.log("AT HEAD. THE SECOND IS STRICTLY STRONGER, AND THE DIFFERENCE IS THE WHOLE POINT: A CITATION")
console.log("TO A FILE THAT IS NOT IN THE REPOSITORY IS A CITATION NOBODY ELSE CAN CHECK — a claim with a")
console.log("local witness and no durable evidence.")
console.log()
console.log(`  ${specFiles.length} lane spec(s) · ${checked} citation path(s) checked · ${tracked.size} file(s) tracked in HEAD`)
console.log()

if (findings.length === 0) {
  console.log("⇒ EVERY CITATION RESOLVES TO A FILE THAT IS TRACKED IN GIT AT HEAD, AND NONE POINTS AT A")
  console.log("  TEMPORARY PATH. Every exclusion in the fleet is checkable by anyone who clones the repo.")
  process.exit(0)
}

const byKind = new Map<string, Finding[]>()
for (const f of findings) {
  const list = byKind.get(f.kind) ?? []
  list.push(f)
  byKind.set(f.kind, list)
}
for (const [kind, list] of [...byKind.entries()].sort()) {
  console.log(`★ ${kind} — ${list.length} citation(s)`)
  for (const f of list) {
    console.log(`    ${f.lane.padEnd(12)} ${f.cited}`)
    console.log(`    ${"".padEnd(12)} ${f.detail}`)
  }
  console.log()
}
console.log("⇒ THE REMEDY IS THE LANE'S, AND IT DIFFERS BY KIND: an UNTRACKED file needs `git add`; a")
console.log("  GITIGNORED one needs a NEGATION RULE; a TEMP-PATH citation needs a RE-CITATION to a")
console.log("  durable artifact; an ABSENT one is a citation to nothing at all.")
process.exit(5)
