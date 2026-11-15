/**
 * MAGIC-CONSTANT INCLUDE PROBE — how many of php's refuting include paths are refuting ONLY because
 * `__DIR__`/`__FILE__` is kept as literal text, and how many of those the admitted list can confirm
 * once the constant is resolved?
 *
 * `__DIR__` is the directory of THE FILE BEING ANALYZED and `__FILE__` is that file — both are known
 * to a per-file analyzer, in pure String, with no filesystem. So a target spelled
 * `__DIR__/../vendor/autoload.php` is a path the project could confirm, while the literal string can
 * never match anything.
 *
 * Reports, for every include/require `imports` edge, the verdict BEFORE (literal, as emitted) and
 * AFTER resolving the magic constants, against the gate's admitted-file facts, plus the filesystem
 * test the analyzer would gate a claim on.
 *
 *   npx tsx validation/m14/fixtures/php/tools/magic-constant-include-probe.mts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))

const repos: { repo: string; files: string[]; admitted: Set<string> }[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  const files: string[] = []
  const admitted = new Set<string>()
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".php")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    files.push(abs)
    admitted.add(rel.split("/").join("/"))
  }
  files.sort()
  if (files.length > 0) repos.push({ repo: dir, files, admitted })
}

/** Fold a relative path against a base directory; null when it escapes the project or is not a path. */
function fold(base: string, written: string): string | null {
  const w = written.trim()
  if (w.length === 0 || w.length > 300) return null
  if (w.includes("://") || w.startsWith("/") || w.startsWith("~")) return null
  for (const ch of [" ", "\t", "*", "?", "<", ">", "|", "{", "}", "$"]) if (w.includes(ch)) return null
  const out: string[] = []
  for (const seg of (base + w).split("/")) {
    if (seg.length === 0 || seg === ".") continue
    if (seg === "..") { if (out.length === 0) return null; out.pop(); continue }
    out.push(seg)
  }
  return out.length > 0 ? out.join("/") : null
}
const dirOf = (rel: string): string => { const i = rel.lastIndexOf("/"); return i < 0 ? "" : rel.slice(0, i + 1) }
const isFile = (p: string): boolean => { try { return statSync(p).isFile() } catch { return false } }

/** The two spellings a claim may use, for a written path that may contain magic constants. */
function candidatesFor(written: string, fileRel: string, resolveMagic: boolean): string[] {
  let w = written
  if (resolveMagic) {
    const fileDir = path.dirname(fileRel).split(path.sep).join("/")
    // `dirname(__FILE__)` first, then the bare constants.
    w = w.split("dirname(__FILE__)").join(fileDir).split("dirname( __FILE__ )").join(fileDir)
    w = w.split("__DIR__").join(fileDir).split("__FILE__").join(fileRel)
  }
  const selfDir = dirOf(fileRel)
  const a = fold(selfDir, w)
  const b = fold("", w)
  return [...new Set([a, b].filter((x): x is string => x !== null))]
}

const tally = {
  edges: 0, magic: 0, nonMagic: 0,
  magicVerifyAfter: 0, magicRefuteAfter: 0, magicNoCandidateAfter: 0,
  magicVerifyBefore: 0,
  fsTrueAfter: 0, fsFalseAfter: 0, fsTrueRefuted: 0, fsFalseVerified: 0,
  nonPhpCandidates: 0, phpOnlyVerify: 0, phpOnlyFsTrueRefuted: 0,
}
const fsTrueRefutedExamples: string[] = []
const nonPhpExamples: string[] = []
const actionable: string[] = []
const stillRefuting: string[] = []

for (const { repo, files, admitted } of repos) {
  for (const abs of files) {
    let res: any
    try { res = await parseFile(abs, repo, { projectRoot: repo } as any) } catch { continue }
    const fileRel = path.relative(repo, abs).split(path.sep).join("/")
    for (const r of res.relationships ?? []) {
      if (String(r.type) !== "imports") continue
      const md = (r.metadata ?? {}) as any
      if (md.relationshipType !== "include_path") continue
      tally.edges++
      const tgt = String(r.target ?? "")
      const magic = tgt.includes("__DIR__") || tgt.includes("__FILE__") || tgt.includes("dirname(")
      if (magic) tally.magic++; else tally.nonMagic++
      const before = candidatesFor(tgt, fileRel, false)
      const after = candidatesFor(tgt, fileRel, true)
      const hitBefore = before.find((c) => admitted.has(c)) ?? null
      const hitAfter = after.find((c) => admitted.has(c)) ?? null
      if (magic) {
        if (hitBefore !== null) tally.magicVerifyBefore++
        if (hitAfter !== null) tally.magicVerifyAfter++
        else if (after.length === 0) tally.magicNoCandidateAfter++
        else tally.magicRefuteAfter++
        const fs = after.some((c) => isFile(path.join(repo, c)))
        if (fs) tally.fsTrueAfter++; else tally.fsFalseAfter++
        if (fs && hitAfter === null) {
          tally.fsTrueRefuted++
          if (fsTrueRefutedExamples.length < 8) fsTrueRefutedExamples.push(`${tgt.padEnd(46)} -> ${after.join(" | ")}   (${fileRel})`)
        }
        // THE GATE'S FACTS HOLD ONLY ADMITTED `.php` PATHS, so a claim about any other file can
        // never verify. Restricting the candidate set to `.php` is therefore required by the
        // arbiter's own key space rather than a convenience — and it is measured separately so a
        // disagreement that is a non-php file cannot be mistaken for an untracked one.
        const phpAfter = after.filter((c) => c.toLowerCase().endsWith(".php"))
        if (phpAfter.length !== after.length) {
          tally.nonPhpCandidates++
          if (nonPhpExamples.length < 8) nonPhpExamples.push(`${tgt.padEnd(46)} -> ${after.join(" | ")}   (${fileRel})`)
        }
        const hitPhp = phpAfter.find((c) => admitted.has(c)) ?? null
        if (hitPhp !== null) tally.phpOnlyVerify++
        const fsPhp = phpAfter.some((c) => isFile(path.join(repo, c)))
        if (fsPhp && hitPhp === null && phpAfter.length > 0) tally.phpOnlyFsTrueRefuted++
        if (!fs && hitAfter !== null) tally.fsFalseVerified++
        if (hitBefore === null && hitAfter !== null) {
          if (actionable.length < 12) actionable.push(`${tgt.padEnd(46)} -> ${hitAfter}   (${fileRel})`)
        } else if (hitBefore === null && hitAfter === null) {
          if (stillRefuting.length < 12) stillRefuting.push(`${tgt.padEnd(46)} -> ${after.join(" | ") || "(no candidate)"}   (${fileRel})`)
        }
      }
    }
  }
}

console.log(`php magic-constant include probe — whole admitted population`)
console.log(`include/require imports edges: ${tally.edges}`)
console.log(`  carrying __DIR__ / __FILE__ / dirname(: ${tally.magic}`)
console.log(`  not carrying one                  : ${tally.nonMagic}`)
console.log(`\nOF THE MAGIC-CONSTANT EDGES:`)
console.log(`  verify BEFORE resolution : ${tally.magicVerifyBefore}`)
console.log(`  verify AFTER resolution  : ${tally.magicVerifyAfter}`)
console.log(`  refute AFTER resolution  : ${tally.magicRefuteAfter}`)
console.log(`  no candidate after       : ${tally.magicNoCandidateAfter}`)
console.log(`  FS CROSS-TAB after resolution: fs true ${tally.fsTrueAfter} · false ${tally.fsFalseAfter} · fs TRUE but gate REFUTES ${tally.fsTrueRefuted} · fs FALSE but gate VERIFIES ${tally.fsFalseVerified}`)
console.log(`  .php-restricted candidates: verify ${tally.phpOnlyVerify} · fs TRUE but gate REFUTES ${tally.phpOnlyFsTrueRefuted} · edges with a non-.php candidate ${tally.nonPhpCandidates}`)
console.log(`\nFS-TRUE but gate-REFUTED examples:`)
for (const e of fsTrueRefutedExamples) console.log(`  ${e}`)
console.log(`\nNON-PHP candidate examples:`)
for (const e of nonPhpExamples) console.log(`  ${e}`)
console.log(`\nACTIONABLE (literal refutes, resolved VERIFIES) — ${tally.magicVerifyAfter}:`)
for (const e of actionable) console.log(`  ${e}`)
console.log(`\nSTILL REFUTING after resolution:`)
for (const e of stillRefuting) console.log(`  ${e}`)
