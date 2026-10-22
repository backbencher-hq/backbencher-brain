/**
 * cpp-census-denominators — THE THREE DENOMINATORS, EACH WITH ITS RULE NAMED.
 *
 * The fleet keeps THREE counts apart, and a cell that quotes one where another reader computes
 * another is a cell that cannot be checked:
 *
 *   PATHS          the on-disk census counting a file ONCE PER PATH IT IS REACHABLE BY
 *                  (`find -L` semantics) — the farm's repos are SYMLINKS, so the census FOLLOWS
 *                  them (readdir's isDirectory() is FALSE for a symlink, and a census that did
 *                  not follow them would count only the farm's own files).
 *   DISTINCT FILES the same census counting each file ONCE, by its real path — a file reachable
 *                  by two paths is ONE file on disk.
 *   ADMITTED       what THE GATE admits: git-tracked paths, the lane's extension rule, and the
 *                  engine's 1 MB per-file cap — a PROJECT FACT (is this path in the population at
 *                  all?), and it must be answered from the UNSAMPLED list, never from a run's
 *                  budget. The gate prints its own number; this instrument re-derives it from the
 *                  same rule so the two can be compared, and it reports the ABSENT (tracked but
 *                  not on disk) and OVER-CAP counts, because a population that counts files it
 *                  cannot open is claiming files it never measured.
 *
 * The gap between the on-disk census and the admitted set is LANGUAGE-SHAPED, not slack: an
 * untracked file in a C++ repo is a `.cpp`/`.hpp`/… file, so the difference is a MEASURED
 * DIFFERENCE BETWEEN TWO RULES (untracked, or over the cap, or the extension map's own choice).
 *
 * USAGE
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/cpp-census-denominators.ts [--json=<path>]
 *
 * EXIT: 0 measured · 2 environment.
 */
import { execFileSync } from "node:child_process"
import { extensionsFor } from "./language-extensions"
import * as fs from "node:fs"
import { readdirSync, realpathSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = path.resolve(process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus"))
const argOf = (f: string): string | null => {
  const j = process.argv.find((a) => a.startsWith(`${f}=`))
  return j ? j.slice(f.length + 1) : null
}
const JSON_OUT = argOf("--json")

/** THE LANE'S OWN EXTENSION MAP — the one the gate is given on the command line. */
// ★ THE POPULATION IS THE ONE TABLE'S, NOT THIS FILE'S (2026-10-22, cpp lane).
//
// MEASURED, NOT INHERITED: `bun script/m14/shape-agreement-scan.ts --shape=hand-written-extension-map`
// reports that the ONE TABLE at `script/m14/language-extensions.ts:142` holds ELEVEN cpp spellings
// (.c++ .cc .cpp .cu .cxx .h .hh .hpp .hxx .inl .ipp) while this lane's hand-written list held NINE —
// it OMITTED `.h` and `.hh`. Over the farm root's 31 repos that is 18,370 tracked header files that
// were never in the lane's population, so EVERY count measured before this change — 7,435 admitted
// files, and the four-types census's 2,843 / 51,874 / 310,252 / 4,279 / 1,262 — is a LOWER BOUND over
// the source spellings, NOT a whole-population number.
//
// ⇒ THE INSTRUMENT AND THE DENOMINATOR MUST COUNT THE SAME POPULATION. A table duplicated in two
// places is one table that will diverge, and this one had already diverged.
// ⇒ AND ONE FACT THE RE-MEASUREMENT MUST STATE RATHER THAN ASSUME: `.h` is ALSO claimed by the `c`
// entry of the SAME table, so adopting the eleven makes the population the ROUTER'S assignment rather
// than an extension's, and a `.h` file may be the c lane's by content.
const ADMITTED_EXTS = extensionsFor("cpp").map((e) => (e.startsWith(".") ? e.slice(1) : e))
/** THE ENGINE'S PER-FILE CAP — the gate's SIZE_CAP, the line above which the analyzer cannot
 *  build a full AST, so the file is never measured. */
const SIZE_CAP = 1024 * 1024

// ── PATHS and DISTINCT FILES: the on-disk census ────────────────────────────────────────────────
const census = (): { byPath: number; distinct: number; perExt: Record<string, number> } => {
  let byPath = 0
  const seenFiles = new Set<string>()
  const seenDirs = new Set<string>()
  const perExt: Record<string, number> = {}
  const stack = [CR]
  while (stack.length) {
    const d = stack.pop()!
    let real = d
    try { real = realpathSync(d) } catch { /* unreadable — counted as nothing */ }
    if (seenDirs.has(real)) continue // a symlinked dir reached twice is ONE directory
    seenDirs.add(real)
    let entries: any[]
    try { entries = readdirSync(d, { withFileTypes: true }) as any } catch { continue }
    for (const e of entries) {
      const full = path.join(d, e.name)
      let isDir = e.isDirectory()
      let isFile = e.isFile()
      if (e.isSymbolicLink()) {
        try { const st = statSync(full); isDir = st.isDirectory(); isFile = st.isFile() } catch { continue }
      }
      if (isDir) { stack.push(full); continue }
      if (!isFile) continue
      const dot = e.name.lastIndexOf(".")
      if (dot < 0) continue
      const ext = e.name.slice(dot + 1).toLowerCase()
      if (!ADMITTED_EXTS.includes(ext)) continue
      byPath++
      perExt[ext] = (perExt[ext] ?? 0) + 1
      let freal = full
      try { freal = realpathSync(full) } catch { /* keep the path */ }
      if (seenFiles.has(freal)) continue
      seenFiles.add(freal)
    }
  }
  return { byPath, distinct: seenFiles.size, perExt }
}
const onDisk = census()

// ── ADMITTED: the gate's own rule, re-derived ───────────────────────────────────────────────────
let trackedAdmitted = 0
let absent = 0
let overCap = 0
let overCapLargest = 0
const repos = new Set<string>()
const admittedFiles: string[] = []
for (const name of fs.readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try {
    if (!statSync(dir).isDirectory()) continue
  } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const dot = rel.lastIndexOf(".")
    if (dot < 0) continue
    const ext = rel.slice(dot + 1).toLowerCase()
    if (!ADMITTED_EXTS.includes(ext)) continue
    trackedAdmitted++
    const abs = path.join(dir, rel)
    let size = 0
    try {
      size = statSync(abs).size
    } catch {
      absent++ // a path git lists and the working tree does not have
      trackedAdmitted--
      continue
    }
    if (size > SIZE_CAP) {
      overCap++
      overCapLargest = Math.max(overCapLargest, size)
      trackedAdmitted--
      continue
    }
    admittedFiles.push(abs)
    repos.add(name)
  }
}

const report = {
  schemaVersion: 1,
  instrument: "script/m14/cpp-census-denominators.ts",
  measuredAt: new Date().toISOString(),
  corpusRoot: CR,
  corpusRootIsAbsolute: CR.startsWith("/"),
  denominators: {
    PATHS: {
      count: onDisk.byPath,
      rule: "the ON-DISK census counting a file ONCE PER PATH IT IS REACHABLE BY (`find -L` semantics); the farm's repos are SYMLINKS and the census FOLLOWS them",
    },
    DISTINCT_FILES: {
      count: onDisk.distinct,
      rule: "the same census counting each file ONCE by its REAL path — a file reachable by two paths is ONE file on disk",
    },
    ADMITTED: {
      count: admittedFiles.length,
      rule: "the GATE's own rule: git-tracked paths + the lane's extension map + the engine's 1 MB per-file cap, counted from the UNSAMPLED list (a project fact, never a run's budget). THE GATE PRINTS ITS OWN NUMBER IN ITS HEADER — the two must agree.",
      trackedAdmittedBeforeSizeAndPresence: trackedAdmitted,
      absentTrackedButNotOnDisk: absent,
      overCap: overCap,
      overCapLargest,
    },
    perExtensionOnDisk: onDisk.perExt,
    gapDistinctMinusAdmitted: onDisk.distinct - admittedFiles.length,
    gapNote: "the gap is LANGUAGE-SHAPED, not slack: an untracked file in a C++ repo is a .cpp/.hpp/... file, so the difference is a MEASURED DIFFERENCE BETWEEN TWO RULES (untracked, absent, or over the cap), not a count of slack",
  },
  repos: repos.size,
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2) + "\n")
console.log("cpp-census-denominators — PATHS · DISTINCT FILES · ADMITTED")
console.log(`  corpus root : ${CR}`)
console.log(`  PATHS          : ${onDisk.byPath}`)
console.log(`  DISTINCT FILES : ${onDisk.distinct}`)
console.log(`  ADMITTED       : ${admittedFiles.length}  (tracked-but-absent ${absent} · over the 1 MB cap ${overCap}, largest ${overCapLargest} bytes)`)
console.log(`  repos          : ${repos.size}`)
console.log(`  gap (distinct - admitted): ${onDisk.distinct - admittedFiles.length}`)
process.exit(0)
