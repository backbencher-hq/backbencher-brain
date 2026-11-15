// MATERIALIZED-ACTION PRICE — the price of re-routing a local `uses:` target to what the run will
// ACTUALLY put at that path, MEASURED before the analyzer is touched.
//
// WHY IT EXISTS. The lane's EXT-Q INVENTORY carries `imports yaml_action_use` edges whose target is
// a `./…` path that does not exist in the repository — and it does not, because it is not supposed
// to: the job's EARLIER STEP puts something there. Two families, both named by the analyzer's own
// `actionUseClaim` doc comment and both mis-claimed as `isExternal` today:
//
//   1. `uses: actions/checkout@…` with `with: {repository: R, path: D, ref: F}` in an earlier step
//      of the SAME job, then `uses: ./D`. The referent is the repository R at ref F — a remoteRef
//      the arbiter can read (`externalVerified`) instead of a path it can only call unverifiable.
//      Sites: `./security-scanner` (boundary, consul ×4, nomad, vault) and `./integration-release-
//      action` (waypoint).
//   2. `uses: actions/checkout@…` with `with: {path: D}` and NO `repository:` in an earlier step of
//      the same job, then `uses: ./D/<rest>`. That checkout materializes the CALLING repository at
//      D, so `./D/<rest>` is the project's OWN `<rest>` — a file claim the arbiter can verify
//      against the project's admitted files. Sites: `./ci-actions/.github/actions/setup` (nimony
//      ×2, whose own comment says the checkout exists so the local `uses:` has its file on disk).
//
// WHAT IT COUNTS, INDEPENDENTLY OF THE ANALYZER. A line-based text oracle over the admitted
// `.yaml`/`.yml` population (`git ls-files`, 1 MiB cap, the gate's own admission rules):
//   * a STEP whose `uses:` value is `actions/checkout@…` and whose `with:` block carries `path:`;
//   * a LATER step in the SAME `steps:` block (the runner's scope; a checkout in another job runs on
//     another machine and cannot materialize anything for this one) whose `uses:` value is `./…`,
//     matched either exactly to the checkout's `path` or as a SUBPATH of it;
// and the emitted target for each family is then run through the SHARED `verifyRemoteRefClaim`
// (family 1) or the project's own tracked-file list at the stripped path (family 2), so the verdict
// this prices and the verdict the gate would give cannot drift.
//
// The oracle is deliberately NOT the analyzer: a price taken with the same code the fix changes
// cannot fail independently. Cross-check: after the fix, the analyzer's own gate run must move the
// same count out of `ext?`.
//
// USAGE: npx tsx validation/m14/fixtures/yaml/materialized-action-price.ts

import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const REPO = process.env.BB_REPO || "/home/ishaq2321/mcp/backbencher-brain"
// The arbiter's OWN rule for a remote reference, imported rather than restated: it is what decides
// that `repo@main` verifies and a repo with NO ref does not — `verifyRemoteRefClaim` refuses a
// target with no `@`.
const { verifyRemoteRefClaim } = await import(`${REPO}/script/m14/incoming-rule.ts`)

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const EXTS = ["yaml", "yml"]
const SIZE_CAP = 1024 * 1024

/** `- uses: value` / `uses: value`, at any indent, with an optional inline comment. */
const USES_LINE = /^(\s*)(?:-\s+)?uses:[ \t]*([^\s#][^\n#]*?)[ \t]*(?:#.*)?$/
/** A key inside a step's `with:` block. Only the three keys this question needs. */
const WITH_KEY = /^\s*(repository|ref|path):[ \t]*["']?([^"'\n#]*?)["']?[ \t]*(?:#.*)?$/
/** `steps:` — the block that scopes one job's step list. */
const STEPS_LINE = /^(\s*)steps:[ \t]*$/

const stripQuotes = (v: string): string => {
  let s = v.trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1)
  return s
}

/** `./X` / `./X/Y` — a relative action directory. Returns the normalized relative path. */
const localDirOf = (value: string): string | null => {
  const m = /^\.\/([A-Za-z0-9._/-]+?)\/?$/.exec(value.trim())
  return m ? m[1] : null
}

/** `path:` as the runner resolves it: workspace-relative, no leading `./`, no trailing `/`. */
const normalizePath = (value: string): string => value.trim().replace(/^\.\//, "").replace(/\/+$/, "")

type Kind = "exact-repo" | "exact-norepo" | "sub-repo" | "sub-norepo"
type Row = {
  repo: string; file: string
  coLine: number; repository: string; ref: string; coPath: string
  useLine: number; target: string; kind: Kind; rest: string
  emitted: string; verdict: "externalVerified" | "externalUnverified"
}

const rows: Row[] = []
let localUseSites = 0
let unmatched = 0

for (const name of readdirSync(CR).sort()) {
  const dir = join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  const trackedSet = new Set(tracked)

  for (const rel of tracked) {
    if (!EXTS.some((e) => rel.toLowerCase().endsWith("." + e))) continue
    let size: number
    try { size = statSync(join(dir, rel)).size } catch { continue }
    if (size > SIZE_CAP) continue
    let text: string
    try { text = readFileSync(join(dir, rel), "utf8") } catch { continue }
    const lines = text.split("\n")

    // ---- pass 1: every `steps:` block start, so a lookup can be scoped to ONE job -----------------
    const stepsStarts: number[] = []
    for (let i = 0; i < lines.length; i++) if (STEPS_LINE.test(lines[i])) stepsStarts.push(i)
    // `steps:` and its list items are written at the SAME indent by the HashiCorp-style files this
    // corpus is full of (`    steps:` / `    - uses: …`), so containment is `sIndent <= indent`.
    const jobOf = (lineIdx: number): number => {
      const indent = lines[lineIdx].length - lines[lineIdx].trimStart().length
      let best = -1
      for (const s of stepsStarts) {
        if (s >= lineIdx) break
        const sIndent = lines[s].length - lines[s].trimStart().length
        if (sIndent <= indent) best = s
      }
      return best
    }

    // ---- pass 2: every step, in order; a checkout's `with:` block is its indented continuation ---
    type Step = { line: number; indent: number; value: string; repository?: string; ref?: string; path?: string; job: number }
    const steps: Step[] = []
    for (let i = 0; i < lines.length; i++) {
      const m = USES_LINE.exec(lines[i])
      if (m === null) continue
      const indent = m[1].length
      const value = stripQuotes(m[2])
      const step: Step = { line: i, indent, value, job: jobOf(i) }
      if (/^actions\/checkout(@|$)/.test(value)) {
        // `with:` sits at the SAME indent as `uses:` when the step is written the HashiCorp way, so
        // the block ends at a DEDENT or at the next list item — not at the first equal-indent line.
        for (let j = i + 1; j < lines.length; j++) {
          const l = lines[j]
          if (l.trim().length === 0) continue
          const lIndent = l.length - l.trimStart().length
          if (lIndent < indent) break
          if (lIndent === indent && l.trimStart().startsWith("-")) break
          const w = WITH_KEY.exec(l)
          if (w === null) continue
          const key = w[1], val = stripQuotes(w[2])
          if (key === "repository" && step.repository === undefined) step.repository = val
          else if (key === "ref" && step.ref === undefined) step.ref = val
          else if (key === "path" && step.path === undefined) step.path = val
        }
      }
      steps.push(step)
    }

    for (const step of steps) {
      const target = localDirOf(step.value)
      if (target === null) continue
      localUseSites++
      // Nearest EARLIER checkout in the SAME job wins; a longer `path:` is the more specific claim.
      let best: { step: Step; rest: string } | undefined
      for (const earlier of steps) {
        if (earlier.line >= step.line) break
        if (earlier.job !== step.job) continue
        if (earlier.path === undefined) continue
        const cp = normalizePath(earlier.path)
        if (cp.length === 0) continue
        const rest = target === cp ? "" : target.startsWith(cp + "/") ? target.slice(cp.length + 1) : null
        if (rest === null) continue
        const better = best === undefined || earlier.line > best.step.line || (earlier.line === best.step.line && cp.length > normalizePath(best.step.path!).length)
        if (better) best = { step: earlier, rest }
      }
      if (best === undefined) { unmatched++; continue }
      const hasRepo = best.step.repository !== undefined && best.step.repository.length > 0
      const kind: Kind = `${best.rest === "" ? "exact" : "sub"}-${hasRepo ? "repo" : "norepo"}` as Kind
      let emitted: string
      let verdict: Row["verdict"]
      if (hasRepo) {
        emitted = best.step.ref !== undefined && best.step.ref.length > 0
          ? `${best.step.repository}@${best.step.ref}`
          : best.step.repository!
        verdict = verifyRemoteRefClaim(emitted)
      } else {
        // The calling repository materialized at `path:` — so `./D/<rest>` IS the project path
        // `<rest>`, and the claim is a FILE claim the project's own file list answers. The
        // stripped path is WORKSPACE-relative (a checkout `path:` is), so the candidate is
        // looked up from the repo ROOT, never from the referring file's directory.
        const manifest = best.rest.length > 0
          ? [`${best.rest}/action.yml`, `${best.rest}/action.yaml`].find((c) => trackedSet.has(c))
          : undefined
        emitted = manifest ?? `${best.rest}  (no manifest in the repo)`
        verdict = manifest !== undefined ? "externalVerified" : "externalUnverified"
      }
      rows.push({
        repo: name, file: rel,
        coLine: best.step.line + 1, repository: best.step.repository ?? "", ref: best.step.ref ?? "", coPath: best.step.path!,
        useLine: step.line + 1, target: step.value, kind, rest: best.rest, emitted, verdict,
      })
    }
  }
}

// ---- report ------------------------------------------------------------------------------------
const byKind = new Map<Kind, Row[]>()
for (const r of rows) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r])
const verified = rows.filter((r) => r.verdict === "externalVerified").length
const stay = rows.length - verified

console.log("MATERIALIZED-ACTION PRICE — local `uses: ./…` whose path a PRIOR SAME-JOB checkout")
console.log("materializes, and the claim each matched site's referent can actually support.")
console.log("Measured from the text over the whole admitted yaml corpus, independent of the analyzer")
console.log("this fix will touch; each verdict is the SHARED arbiter's own rule.")
console.log("")
console.log(`local \`uses: ./…\` sites (all shapes)   : ${localUseSites}`)
console.log(`  no prior same-job checkout for the path: ${unmatched}`)
console.log(`  MATCHED                                : ${rows.length}`)
for (const [kind, list] of [...byKind].sort()) {
  console.log(`    ${kind.padEnd(13)}: ${list.length}`)
}
console.log("")
console.log(`  moves ext? -> extOK : ${verified}`)
console.log(`  still ext?          : ${stay}`)
console.log("")
for (const r of rows) {
  console.log(`${r.verdict === "externalVerified" ? "OK " : "EXT"} ${r.kind}  ${r.target}`)
  console.log(`      @ ${r.repo}/${r.file}:${r.useLine}`)
  console.log(`      <- step ${r.coLine}: repository: ${r.repository || "(the calling repo)"}${r.ref ? "  ref: " + r.ref : ""}  path: ${r.coPath}`)
  console.log(`      => emitted target: ${r.emitted.length > 0 ? r.emitted : "(the project root — NOT implemented)"}`)
}
