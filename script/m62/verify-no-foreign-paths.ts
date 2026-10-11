#!/usr/bin/env tsx
// script/m62/verify-no-foreign-paths.ts — no gate may hardcode ANOTHER MACHINE's
// absolute home path.
//
// FOUND 2026-10-11 while fixing the three gates that could not fail
// (script/m62/verify-gates-can-fail.ts). script/m15/verify-edit-e2e-docs.ts:37 reads:
//
//   const REPOS_DIR = path.resolve("$HOME/fixtures/repositories")
//
// `$HOME` is the OTHER laptop's home directory, hardcoded. On this machine
// the gate dies immediately:
//
//   Error: ENOENT: no such file or directory, scandir '$HOME/fixtures/repositories/graphql-js'
//
// — it never runs a single check. It was in `npm run verify`, so that leg contributed
// nothing while appearing to be part of the chain.
//
// This is NOT the bug script/m62/verify-path-encoding.ts looks for. That gate is about
// PERCENT-ENCODING (`new URL(import.meta.url).pathname` on a path containing a
// space, which is why this repository's own directory is the interesting case). It
// correctly reports PASS here, because none of these files encode anything — they just
// point at a filesystem that does not exist here. Two gates, two classes; this one is
// the second.
//
// WHY IT MATTERS MORE THAN A STYLE RULE. A hardcoded foreign path turns a gate into a
// no-op or a crash, and both read as "not our problem" once someone has seen them fail
// a few times. 54 files in the verify chain carry one. Some crash (as above); some
// silently resolve to nothing and pass vacuously, which is worse — a gate that cannot
// see its subject reports green.
//
// The convention already exists in this codebase: BB_SECURITY_CORPUS_ROOT and the
// like. A gate that needs a corpus says where it looked and why it could not find one,
// which is what script/m15/verify-security-deep.ts does today for exactly this reason
// ("no corpus found. Set BB_SECURITY_CORPUS_ROOT to a fixtures/repositories
// directory. Searched: …").
//
// THIS GATE FAILS while any such file exists. It reports the count and names them; it
// does not rewrite 54 files, because each needs to decide whether the corpus is
// required (and should then declare a block) or optional (and should then search a
// real, declared location).

import { readFileSync } from "node:fs"
import path from "node:path"

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? "ok  " : "FAIL"}: ${name} — ${detail}`)
}

// This gate stays red, and it is not in verify-suite.mts, until the files it names stop
// pointing at a filesystem that does not exist here. That is the declaration
// script/m62/verify-suite-coverage.ts looks for.

const ROOT = process.cwd()
const { walkSourceFiles } = await import("./path_encoding_scan.ts")

/** Another machine's home directory: an absolute /home/<name> that is not this
 *  machine's own user. Checked against the real HOME so the gate does not flag a
 *  legitimate `os.homedir()` default written out literally on a single-user machine. */
const THIS_HOME = process.env.HOME ?? ""
const FOREIGN = /["'`]\/home\/([A-Za-z0-9._-]+)\//g

const files = walkSourceFiles(ROOT)
  .filter((f) => f.endsWith(".ts") || f.endsWith(".mts") || f.endsWith(".js"))
  .map((f) => path.relative(ROOT, f))

const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
  scripts?: Record<string, string>
}
const chain = Object.values(pkg.scripts ?? {}).join("\n")
const suite = readFileSync(path.join(ROOT, "script/m62/verify-suite.mts"), "utf8")

type Hit = { file: string; user: string; count: number; inChain: boolean }
const hits: Hit[] = []

// SCAN CODE, NOT PROSE. A comment that QUOTES the old path to explain what it was
// replaced with is documentation, and must not count as a live defect — otherwise
// fixing a file makes the gate stay red, which teaches people to ignore it.
//
// Strings are KEPT, because a path in a string literal IS the defect. That is the same
// distinction script/m62/path_encoding_scan.ts draws and that
// script/m62/verify-indexer-option-contract.ts learned the hard way: it reported five
// of its own findings against the comment explaining a fix.
const { blankCommentsAndStrings } = await import("./path_encoding_scan.ts")

for (const rel of files) {
  const raw = readFileSync(path.join(ROOT, rel), "utf8")
  const src = /\.ts$|\.mts$|\.js$/.test(rel)
    ? blankCommentsAndStrings(raw, { keepStrings: true })
    : raw
  FOREIGN.lastIndex = 0
  const users = new Set<string>()
  let count = 0
  let m: RegExpExecArray | null
  while ((m = FOREIGN.exec(src)) !== null) {
    users.add(m[1]!)
    count++
  }
  if (users.size === 0) continue
  // Exclude this machine's own home, written literally.
  const foreign = [...users].filter((u) => !THIS_HOME.endsWith(`/${u}`))
  if (foreign.length === 0) continue
  hits.push({
    file: rel,
    user: foreign.join(","),
    count,
    inChain: chain.includes(rel) || suite.includes(rel),
  })
}

check(
  "the sweep was readable (zero files scanned means the walk failed, not that the tree is clean)",
  files.length > 500,
  `${files.length} file(s) scanned for a hardcoded foreign home directory`,
)

check(
  "no file hardcodes ANOTHER machine's absolute home path",
  hits.length === 0,
  hits.length === 0
    ? "no foreign absolute home path found"
    : `*** ${hits.length} file(s) hardcode another machine's home directory ` +
      `(${hits.reduce((n, h) => n + h.count, 0)} occurrence(s)); ` +
      `${hits.filter((h) => h.inChain).length} of them are in the verify chain or the suite ***`,
)

if (hits.length > 0) {
  const chainHits = hits.filter((h) => h.inChain)
  console.log(`\n  in the verify chain or the suite (${chainHits.length}):`)
  for (const h of chainHits) console.log(`    ${h.file}  —  /home/${h.user}  x${h.count}`)
  // NAMED, not just counted. A first version listed only the chain files and
  // summarised the rest as "2628 file(s) — probes and scratch", which made the
  // remainder un-actionable: nobody can fix a count. A canary planted in a scratch file
  // raised the count 2679 -> 2680, so detection worked while the report stayed silent
  // about which file, which is the reporting half of the same failure.
  const other = hits.filter((h) => !h.inChain)
  const byDir = new Map<string, number>()
  for (const h of other) {
    const top = h.file.split("/").slice(0, 2).join("/")
    byDir.set(top, (byDir.get(top) ?? 0) + 1)
  }
  console.log(`\n  not in a chain (${other.length}) — by directory:`)
  for (const [d, n] of [...byDir].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(5)}  ${d}/`)
  console.log(`\n  the largest of those, named:`)
  for (const h of other.slice(0, 12)) console.log(`    ${h.file}  —  /home/${h.user}  x${h.count}`)
  if (other.length > 12) console.log(`    … and ${other.length - 12} more; every one is in the count above.`)
  console.log(
    "\n  Two outcomes per file, and which one applies is a judgement about that gate:\n" +
      "    - the corpus is REQUIRED: resolve it from a declared env var, and when it is\n" +
      "      absent record a DECLARED BLOCK naming every path searched. That is the\n" +
      "      convention already used by script/m15/verify-security-deep.ts.\n" +
      "    - the corpus is OPTIONAL: search a real location and say so, rather than\n" +
      "      resolving a path that cannot exist here.\n\n" +
      "  Note that $HOME is the other laptop. A gate pointing at it either CRASHES\n" +
      "  (ENOENT, as script/m15/verify-edit-e2e-docs.ts does) or silently exercises nothing\n" +
      "  and passes vacuously. The second is worse: a gate that cannot see its subject\n" +
      "  reports green.",
  )
}

const failed = checks.filter((c) => !c.ok).length
console.log(`\nNO FOREIGN PATHS: ${failed === 0 ? "PASS" : `FAILED (${failed}) — see above`}`)
process.exit(failed === 0 ? 0 : 1)