/**
 * M14 corpus presence — the check a corpus restore owes, as a committed instrument.
 *
 * ## Why this exists
 *
 * `docs/analyzers/M14-CORPUS-RESTORE.md` records two waves of corpus work, and both times the
 * measurement behind its presence claim was taken by a scratch script
 * (`script/m14/tmp/corpus-presence.ts`, which `script/m14/tmp/` excludes, so it is not in the
 * repository) or inline. That is the shape this repository keeps paying for: a number whose
 * instrument is not committed cannot be re-earned by the next reader, and the second wave is
 * exactly what a re-run would have caught earlier — `perl` was re-registered, the presence
 * check said "present" for the corpus ROOT while the two names behind it did not exist, and a
 * differential for that lane threw `corpus repo missing` for as long as nobody re-ran it.
 *
 * ## What it measures, and what it deliberately does not
 *
 * It enumerates the repositories `script/m14/differential.ts` DECLARES — `LANG_REPOS` and
 * `SECOND_CORPUS`, read from that file as text — and reports, per repository: absent, present
 * but not a git checkout, present with ZERO tracked files, or present with a HEAD and a tracked
 * count. The three bad states are the whole point and they are different failures:
 *
 *   - **absent** throws the differential for the lane whose PRIMARY corpus it is (`if
 *     (requiredRepos.includes(rp)) throw new Error('corpus repo missing: …')`, and
 *     `requiredRepos` is built from `LANG_REPOS`). Measured 2026-10-12 against the working tree:
 *     `--lang nim` / `--lang vb` / `--lang make` each exit 1 at that line, while `--lang hcl`
 *     RUNS — `terraform` is its primary and `hcl`'s absent second corpus (`tf-aws-components`)
 *     costs the lane its second opinion, not its measurement. So an absent name is a per-lane
 *     block, and which lanes it blocks is exactly what this instrument is for. The same working
 *     tree carries an IN-FLIGHT change to an unscoped sweep (absent checkout becomes a recorded
 *     `unmeasuredLanes` row rather than a whole-sweep abort) — that branch is the master file's
 *     and this instrument does not measure it in either direction;
 *   - **not a git checkout** passes `fs.existsSync` and then fails the `git ls-files` /
 *     `git rev-parse HEAD` calls a corpus is actually read with;
 *   - **zero tracked files** is the first wave's `plack`: a faithful clone of an upstream that
 *     holds nothing, which passes every existence check and admits 0 files to the draw
 *     (`[cold-pool] plack:perl: 0/0 fresh (corpus 0)`).
 *
 * It does NOT adjudicate `LANG_REPOS` entries that name the wrong repository, and it does not
 * guess an upstream for an absent name — a name is not a pin, and `pixie` (registered as the NIM
 * lane's second corpus) is the standing example: the obvious upstream by that name is a Go
 * project. Naming an absent repository is this instrument's job; deciding which tree it means
 * belongs to the lane that declared it.
 *
 * ## Usage
 *
 *   bun run script/m14/corpus-presence.ts [--emit]
 *
 * `--emit` writes `validation/m14/measurements/corpus-presence.log`; without it the report is
 * printed only. Exit status is 1 when any declared repository is absent, not a git checkout, or
 * empty, and 0 otherwise, so the file is usable as a precheck rather than a report.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..")
const DIFFERENTIAL = path.join(ROOT, "script", "m14", "differential.ts")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const EMIT = process.argv.includes("--emit")

/** `lang: "repo"` pairs inside one `const NAME ... = {` literal. The terminator is the first
 *  line that is exactly `}` at column 0 — the maps are top-level literals, and a terminator
 *  that fired on a nested brace would silently under-report, which is the failure mode this
 *  whole instrument exists to prevent.
 *
 *  The declaration match is ANCHORED, and that is the second thing this wave learned the hard
 *  way: `script/m14/differential.ts` holds BOTH `LANG_REPOS_SECOND` and `LANG_REPOS`, and a
 *  substring search for `const LANG_REPOS` finds the former — which reads 35 of the 47 primary
 *  lanes, labels every second-corpus entry `(primary)`, and reports a corpus count that is short
 *  by the twelve primary lanes it never looked at. A presence check that silently under-counts
 *  is the same class of defect it is written to catch.
 *
 *  A trailing `//` comment after the entry is stripped before matching, because an entry whose
 *  value is followed by a note would otherwise be invisible to the same silent under-count. */
function declared(name: "LANG_REPOS" | "SECOND_CORPUS"): Array<{ lang: string; repo: string }> {
  const lines = fs.readFileSync(DIFFERENTIAL, "utf8").split("\n")
  const decl = new RegExp(`^(?:export\\s+)?const ${name}(\\s*:[^=]*)?\\s*=`)
  const start = lines.findIndex((l) => decl.test(l))
  if (start < 0) return []
  const out: Array<{ lang: string; repo: string }> = []
  for (let i = start; i < lines.length; i++) {
    if (i > start && lines[i] === "}") break
    const code = lines[i].replace(/\/\/.*$/, "")
    const m = /^\s*([A-Za-z_][\w-]*):\s*"([^"]+)"\s*,?\s*$/.exec(code)
    if (m) out.push({ lang: m[1], repo: m[2] })
  }
  return out
}

const primaries = declared("LANG_REPOS")
const seconds = declared("SECOND_CORPUS")

// Declaration counts and distinct-name counts are DIFFERENT numbers, and the difference is the
// whole story of one name (`tf-aws-components`) declared by two lanes. Reporting only the union
// would hide a second corpus registered to a name another lane already failed on.
const declaredNames = new Map<string, string[]>()
for (const { lang, repo } of primaries) {
  declaredNames.set(repo, [...(declaredNames.get(repo) ?? []), `${lang}(primary)`])
}
for (const { lang, repo } of seconds) {
  declaredNames.set(repo, [...(declaredNames.get(repo) ?? []), `${lang}(second)`])
}

const lines: string[] = []
const say = (s: string) => { lines.push(s) }
say(`M14 corpus presence — read from ${path.relative(ROOT, DIFFERENTIAL)}'s own LANG_REPOS and SECOND_CORPUS maps`)
say(`read at ${new Date().toISOString()}   corpus root: ${CORPUS_ROOT}`)
say(`differential.ts working-tree state: ${gitStatusOf(DIFFERENTIAL)}`)
say("")
say(`LANG_REPOS: ${primaries.length} lanes   SECOND_CORPUS: ${seconds.length} lanes   distinct repo names: ${declaredNames.size}`)
const multi = [...declaredNames.entries()].filter(([, who]) => who.length > 1).sort((a, b) => a[0].localeCompare(b[0]))
say(multi.length === 0
  ? "no repository is declared by more than one lane"
  : `declared by more than one lane: ${multi.map(([r, who]) => `${r} (${who.join(", ")})`).join("; ")}`)
say("")

let bad = 0
for (const repo of [...declaredNames.keys()].sort()) {
  const who = (declaredNames.get(repo) ?? []).join(", ")
  const dir = path.join(CORPUS_ROOT, repo)
  if (!fs.existsSync(dir)) { say(`  ABSENT            ${repo.padEnd(24)} ${who}`); bad++; continue }
  let head = ""
  try {
    head = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
  } catch { /* not a checkout */ }
  if (!head) { say(`  NOT A GIT CHECKOUT ${repo.padEnd(23)} ${who}`); bad++; continue }
  let tracked = 0
  try { tracked = execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean).length } catch { /* treat as empty */ }
  if (tracked === 0) { say(`  ZERO TRACKED FILES ${repo.padEnd(23)} ${who}  head=${head.slice(0, 10)}`); bad++; continue }
  say(`  ok                ${repo.padEnd(24)} ${who}  head=${head.slice(0, 10)}  tracked=${tracked}`)
}

say("")
say(bad === 0
  ? "verdict: every declared corpus is present, a git checkout, and non-empty"
  : `verdict: ${bad} declared corpus name(s) unusable — an ABSENT primary throws that lane via ` +
    `requiredRepos (a scoped --lang runs for a lane whose primary is present and loses only its second ` +
    `opinion), NOT A GIT CHECKOUT passes fs.existsSync and then fails the reads, ZERO TRACKED FILES ` +
    `admits no files to a draw`)
say("")
say("NOT measured here, deliberately: whether a present repository is the tree its name means. A name")
say("is not a pin, and the upstream a name suggests can be a different project entirely (see the header).")

const text = lines.join("\n") + "\n"
process.stdout.write(text)
if (EMIT) {
  const out = path.join(ROOT, "validation", "m14", "measurements", "corpus-presence.log")
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, text)
  process.stdout.write(`\nwritten: ${path.relative(ROOT, out)}\n`)
}
process.exit(bad === 0 ? 0 : 1)

/** `clean` or `modified`, so a reader can tell whether the maps read are committed. */
function gitStatusOf(file: string): string {
  try {
    const out = execFileSync("git", ["-C", ROOT, "status", "--porcelain", "--", path.relative(ROOT, file)], { encoding: "utf8" })
    return out.trim().length > 0 ? "MODIFIED (uncommitted — these maps are a working tree, not a commit)" : "clean (committed)"
  } catch { return "unknown" }
}
