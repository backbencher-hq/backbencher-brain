/**
 * BD11's `isAssignedInFile` — is the ANSWER a function of where the read sits?
 *
 * ## The claim under test
 *
 * `docs/analyzers/bash.md` states BD11's contract as file-level:
 *
 *   Targets are trimmed, and `metadata.isAssignedInFile` is set when the file
 *   assigns the name **under any owner** (`BD11`).
 *
 * Nothing in that sentence mentions position. The implementation, however,
 * evaluates the predicate MID-WALK: `assignedInFile` indexes `declaredSymbols`,
 * which is still being filled as the walk proceeds, and the memo is keyed on the
 * set's size so it refreshes — which makes the answer correct only for the
 * prefix of the file already walked. Two lines are the whole demonstration:
 *
 *     echo "before: $LATE"
 *     LATE=1
 *     echo "after: $LATE"
 *
 *   uses -> "LATE" @1  isAssignedInFile ABSENT
 *   uses -> "LATE" @3  isAssignedInFile TRUE
 *
 * One file, one name, one declaration, two different answers. That is a
 * self-contradiction inside a single `parseFile` result, so it needs no oracle
 * and no second instrument to be a finding.
 *
 * ## Why it is a SEPARATE defect from the array-element binding
 *
 * `probe-bash-array-element-binding.mts` finds reads of a name bound only by
 * `name[index]=value` that carry no flag. Publishing that binding fixes those.
 * It does NOT fix a file that assigns the name with a plain `NAME=` after the
 * read, and this probe measures that population, which is the one a consumer
 * reading the documented contract is actually misled by.
 *
 * ## WHAT THIS PROBE MEASURES
 *
 *   read edges                        every `uses` edge production published
 *   flagged / unflagged               the split, with the 400% denominator
 *   SELF-CONTRADICTORY pairs           (file, target) pairs carrying BOTH
 *                                     answers — the finding, zero oracle needed
 *   of those: unflagged edges         how many edges say "not assigned here"
 *                                     about a file that DOES publish the name
 *   SILENT-WRONG pairs                no contradiction, but the name is published
 *                                     and an edge still says false
 *   correctly-false pairs             name absent from the symbol table, so
 *                                     "absent" is the right answer — the control
 *                                     population that shows the probe can return
 *                                     a clean answer
 *
 * ## PER (file, target), NOT PER EDGE
 *
 * The contradiction is a property of a (file, name) pair; the edges are how many
 * wrong answers it produced. Counting per edge would weight a name read forty
 * times forty times and call the population bigger than it is.
 *
 * ## INSTRUMENT
 *
 * Production `parseFile` only. NO REGEX — a target is compared with `===`
 * against the published `Symbol.name`, never matched as text.
 *
 * CLI: npx tsx validation/m14/fixtures/bash/probe-bash-assigned-flag-order.mts
 *      [--sample 400 | --all] [--examples 15]
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const num = (n: string, d: number): number => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? Number(argv[i + 1]) : d
}
const ALL = argv.includes("--all")
const SAMPLE = ALL ? Number.MAX_SAFE_INTEGER : num("sample", 400)
const EXAMPLES = num("examples", 15)

interface F {
  repo: string
  rel: string
  abs: string
  text: string
  hash: string
}
const files: F[] = []
let scanned = 0
let degraded = 0
/**
 * Files carrying at least one tree-sitter ERROR node. This is NOT the census's
 * `parse fail`, which counts a thrown parse or `success: false` — the two are
 * different instruments and the doc quotes the census's. Naming this one
 * `parse-error` too would make 400-file and whole-corpus runs look
 * contradictory when they are counting different things.
 */
let errorNodeFiles = 0
let errorNodes = 0
const repoNames = new Set<string>()
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    scanned++
    if (detectLanguageFromPath(abs, text) !== "bash") continue
    repoNames.add(e)
    files.push({ repo: e, rel, abs, text, hash: createHash("sha256").update(`${e}/${rel}`).digest("hex") })
  }
}
files.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
const sample = ALL ? files : files.slice(0, SAMPLE)

console.log(
  `bash isAssignedInFile order probe — production parseFile, ${sample.length} files${ALL ? " (--all)" : ""}`,
)
console.log(`admitted ${files.length} / scanned ${scanned} / repos ${repoNames.size}\n`)

interface Pair {
  file: string
  target: string
  flagged: number
  unflagged: number
  firstFlagged: number
  firstUnflagged: number
  publishedKinds: string[]
  declLines: number[]
}
const pairs = new Map<string, Pair>()

for (const f of sample) {
  const r: any = await parseFile(f.abs)
  if (r?.fallback) degraded++
  if ((r?.errors ?? []).length > 0) {
    errorNodeFiles++
    errorNodes += r.errors.length
  }

  const key = `${f.repo}/${f.rel}`
  /** Every name the file publishes, with the lines it published it on. The
   *  file-level truth BD11 claims to report. */
  const published = new Map<string, { kind: string; line: number }[]>()
  for (const s of r.symbols ?? []) {
    const name = String(s?.name ?? "")
    if (name.length === 0) continue
    const line = Number(s?.startLine ?? 0)
    const list = published.get(name)
    const entry = { kind: String(s?.kind ?? ""), line }
    if (list) list.push(entry)
    else published.set(name, [entry])
  }

  for (const rel of r.relationships ?? []) {
    if (rel.type !== "uses") continue
    const target = String(rel.target)
    const pk = `${key}\u0000${target}`
    let p = pairs.get(pk)
    if (!p) {
      p = {
        file: key,
        target,
        flagged: 0,
        unflagged: 0,
        firstFlagged: 0,
        firstUnflagged: 0,
        publishedKinds: [],
        declLines: [],
      }
      pairs.set(pk, p)
    }
    const line = Number(rel.line_number ?? 0)
    if (rel.metadata?.isAssignedInFile === true) {
      p.flagged++
      if (p.firstFlagged === 0) p.firstFlagged = line
    } else {
      p.unflagged++
      if (p.firstUnflagged === 0) p.firstUnflagged = line
    }
  }
  for (const p of pairs.values()) {
    if (p.file !== key) continue
    const decls = published.get(p.target)
    if (decls) {
      p.publishedKinds = [...new Set(decls.map((d) => d.kind))]
      p.declLines = decls.map((d) => d.line).sort((a, b) => a - b)
    }
  }
}

let readEdges = 0
let flaggedEdges = 0
let unflaggedEdges = 0
let selfContradictory = 0
let contradictoryUnflagged = 0
let contradictoryFlagged = 0
let contradictoryFiles = new Set<string>()
let silentWrong = 0
let silentWrongUnflagged = 0
let silentWrongFunctionOnly = 0
let silentWrongVariable = 0
const silentWrongVarEx: string[] = []
let correctlyFalse = 0
let correctlyFalseUnflagged = 0
let neither = 0
const examples: string[] = []

for (const p of pairs.values()) {
  readEdges += p.flagged + p.unflagged
  flaggedEdges += p.flagged
  unflaggedEdges += p.unflagged
  const isPublished = p.publishedKinds.length > 0
  if (p.flagged > 0 && p.unflagged > 0) {
    selfContradictory++
    contradictoryFiles.add(p.file)
    contradictoryUnflagged += p.unflagged
    contradictoryFlagged += p.flagged
    if (examples.length < EXAMPLES) {
      examples.push(
        `  SELF-CONTRADICTORY ${p.file}  ${p.target}\n` +
          `      ${p.unflagged} edge(s) say NOT assigned (first @${p.firstUnflagged}), ` +
          `${p.flagged} say assigned (first @${p.firstFlagged})\n` +
          `      the file publishes ${p.publishedKinds.join("/") || "(nothing)"} at ${p.declLines.join(", ") || "-"}`,
      )
    }
  } else if (p.unflagged > 0 && isPublished) {
    silentWrong++
    silentWrongUnflagged += p.unflagged
    /** bash keeps functions and variables in separate namespaces, and `uses`
     *  edges are variable reads (`$name` cannot denote a function). So a name the
     *  file declares ONLY as a function is one BD11 is right to leave unflagged,
     *  and a probe that asks "does the file publish this NAME" cannot tell that
     *  case from a real defect. The kinds are therefore printed on every row and
     *  the split is counted, rather than the residual being reported as damage. */
    const functionOnly = p.publishedKinds.every((k) => k === "function")
    if (functionOnly) silentWrongFunctionOnly++
    else {
      silentWrongVariable++
      if (silentWrongVarEx.length < EXAMPLES) {
        silentWrongVarEx.push(
          `  SILENT-WRONG (not function-only) ${p.file}  ${p.target}  ` +
            `${p.unflagged} edge(s) say NOT assigned; the file publishes ${p.publishedKinds.join("/")} at ${p.declLines.join(", ")}`,
        )
      }
    }
    if (examples.length < EXAMPLES * 2) {
      examples.push(
        `  SILENT-WRONG ${p.file}  ${p.target}  ${p.unflagged} edge(s) say NOT assigned; ` +
          `the file publishes ${p.publishedKinds.join("/") || "(nothing)"} at ${p.declLines.join(", ") || "-"}` +
          (functionOnly ? "  — FUNCTION-ONLY name: absent is CORRECT, a $name read cannot denote a function" : ""),
      )
    }
  } else if (p.unflagged > 0 && !isPublished) {
    correctlyFalse++
    correctlyFalseUnflagged += p.unflagged
  } else {
    neither++
  }
}

const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`)
console.log(`files                              : ${sample.length}`)
console.log(`degraded files (extractFallback)  : ${degraded}`)
console.log(`files with tree-sitter ERROR nodes: ${errorNodeFiles}  (${errorNodes} nodes) — not the census's parse-fail count, which counts a throw or success:false`)
console.log(`"uses" read edges                 : ${readEdges}`)
console.log(`  carrying isAssignedInFile       : ${flaggedEdges}  (${pct(flaggedEdges, readEdges)})`)
console.log(`  ABSENT (the contract says false): ${unflaggedEdges}  (${pct(unflaggedEdges, readEdges)})`)
console.log(`distinct (file, target) pairs     : ${pairs.size}\n`)
console.log(`SELF-CONTRADICTORY pairs          : ${selfContradictory}  in ${contradictoryFiles.size} files`)
console.log(`  edges saying NOT assigned       : ${contradictoryUnflagged}   (of those ${contradictoryUnflagged}, all wrong under the file-level contract)`)
console.log(`  edges saying assigned           : ${contradictoryFlagged}`)
console.log(`SILENT-WRONG pairs                : ${silentWrong}  (${silentWrongUnflagged} edges) — no contradiction in-file, but the file DOES publish the name`)
console.log(`  published ONLY as a function      : ${silentWrongFunctionOnly}  (absent is CORRECT: a $name read cannot denote a function)`)
console.log(`  published as a variable too      : ${silentWrongVariable}  (the residual that is actually wrong)`)
if (silentWrongVarEx.length > 0) console.log(`\n  the ${silentWrongVariable} that are actually wrong:\n${silentWrongVarEx.join("\n")}`)
console.log(`CORRECTLY-FALSE pairs (control)   : ${correctlyFalse}  (${correctlyFalseUnflagged} edges) — the name is absent from the symbol table, so absent is right`)
console.log(`pairs flagged on every edge       : ${neither}`)
if (examples.length > 0) console.log(`\nexamples:\n${examples.join("\n")}`)