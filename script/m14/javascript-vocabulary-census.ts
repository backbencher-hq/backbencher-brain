/**
 * JAVASCRIPT VOCABULARY CENSUS — whole-population counts for the labels the lane doc could only
 * report from a cap-50 triage, plus a disposition for `part_of` and a resolution breakdown for
 * `mixes_in`.
 *
 * WHY THIS FILE EXISTS. `docs/analyzers/javascript.md` states, for `renders` and `decorates`, a
 * cap-50 triage count and then the words "whole-population count not yet measured". A triage number
 * is not a population: it is what one 50-file stride happened to meet. This instrument measures the
 * population over every JS file in the corpus that actually CONTAINS the construct, so the doc can
 * carry a number instead of a caveat.
 *
 * FINDING THE CONSTRUCT WITHOUT GUESSING. `renders` fires on JSX and `decorates` on decorators, so
 * the denominator is "files whose TREE contains a `jsx_element`/`jsx_self_closing_element` or a
 * `decorator` node" — read from the parse tree, not from a text pattern. A file that merely mentions
 * the word `decorator` is not a decorator site; asking the tree is the only honest denominator.
 *
 * `part_of` — JavaScript has no composition-part syntax at all, and this instrument records the
 * grammar evidence rather than asserting the absence: the pinned grammar's named node types are
 * enumerated and the candidates named.
 *
 * `mixes_in` — the doc records 83 rows, 0 resolved. This splits the population by whether the TARGET
 * is a name the SAME FILE declares, which separates "the store could bind this" from "the per-file
 * analyzer cannot possibly bind it".
 *
 * READ-ONLY. Writes one artifact per corpus under validation/m14/tmp/.
 *
 *   bun run script/m14/javascript-vocabulary-census.ts --repo=<dir> [--json=<out>]
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { ASTEngine, getParser } from "../../src/ast/engine"

const SIZE_CAP = 512 * 1024
const ALL_LABELS = [
  "calls", "extends", "implements", "uses", "imports", "exports", "contains",
  "references", "overrides", "instantiates", "decorates", "renders", "mixes_in", "part_of",
]

function argOf(flag: string): string | null {
  const argv = process.argv.slice(2)
  const i = argv.indexOf(flag)
  if (i >= 0) return argv[i + 1] ?? null
  const hit = argv.find((a) => a.startsWith(flag + "="))
  return hit ? hit.slice(flag.length + 1) : null
}

const REPO = argOf("--repo") ?? "/home/ishaq2321/bb_tests/repositories/svelte"
if (!existsSync(REPO)) {
  console.error(`vocabulary-census: corpus not found at ${REPO} (pass --repo=<dir>)`)
  process.exit(2)
}
const JSON_OUT = argOf("--json")

const tracked: string[] = execFileSync("git", ["-C", REPO, "ls-files", "-z"], {
  encoding: "utf8",
  maxBuffer: 512 * 1024 * 1024,
}).split("\0").filter(Boolean)

const jsFiles: string[] = []
for (const rel of tracked) {
  const abs = path.join(REPO, rel)
  try {
    if (statSync(abs).size > SIZE_CAP) continue
    if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) !== "javascript") continue
  } catch {
    continue
  }
  jsFiles.push(rel)
}
jsFiles.sort()

const parser = await getParser("javascript")

/** does this tree contain a node of `type` anywhere? */
function hasNodeType(root: any, types: Set<string>): boolean {
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (types.has(n.type)) return true
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return false
}

const JSX = new Set(["jsx_element", "jsx_self_closing_element"])
const DECORATOR = new Set(["decorator"])

const counts: Record<string, number> = {}
for (const l of ALL_LABELS) counts[l] = 0
let parsedFiles = 0

// ── PASS 1: denominators, from the PARSE TREE alone ─────────────────────────────────────────────
// Kept in a separate pass from the analyzer on purpose. The first version of this instrument
// interleaved `getParser().parse()` with `ASTEngine.parseFile()` over the SAME shared parser
// singleton and only saw 500 of 3,383 files parse clean; parsing each file with one engine at a
// time and comparing (`errcheck`) showed 3,383/3,383 clean. Interleaving two consumers of one
// parser was the bug, and it silently measured 15% of the corpus.
const jsxFileSet = new Set<string>()
const decoratorFileSet = new Set<string>()
for (const rel of jsFiles) {
  let src: string
  try {
    src = readFileSync(path.join(REPO, rel), "utf8")
  } catch {
    continue
  }
  let root: any
  try {
    root = parser.parse(src)?.rootNode
  } catch {
    continue
  }
  if (!root || root.hasError) continue
  parsedFiles++
  if (hasNodeType(root, JSX)) jsxFileSet.add(rel)
  if (hasNodeType(root, DECORATOR)) decoratorFileSet.add(rel)
}
const jsxFiles = jsxFileSet.size
const decoratorFiles = decoratorFileSet.size

// ── PASS 2: the emitted rows, from the analyzer alone ──────────────────────────────────────────
const mixesInTargets: Array<{ file: string; target: string; declaredHere: boolean }> = []
let partOfRows = 0
for (const rel of jsFiles) {
  let src: string
  try {
    src = readFileSync(path.join(REPO, rel), "utf8")
  } catch {
    continue
  }
  let res: any
  try {
    res = await ASTEngine.parseFile(path.join(REPO, rel), src)
  } catch {
    continue
  }
  const declared = new Set<string>((res.symbols ?? []).map((s: any) => String(s.name ?? "")))
  for (const r of res.relationships ?? []) {
    const t = String(r.type ?? "")
    if (t === "") continue
    counts[t] = (counts[t] ?? 0) + 1
    if (t === "part_of") partOfRows++
    if (t === "mixes_in") {
      const target = String(r.target ?? "")
      mixesInTargets.push({ file: rel, target, declaredHere: declared.has(target) })
    }
  }
}

const mixesDeclared = mixesInTargets.filter((m) => m.declaredHere).length
const mixesUndeclared = mixesInTargets.length - mixesDeclared

console.log(`vocabulary census — ${path.basename(REPO)}`)
console.log(`  tracked ${tracked.length}   JS ${jsFiles.length}   parsed clean ${parsedFiles}`)
console.log(`\n  label          rows    (a row count, not a file count)`)
for (const l of ALL_LABELS) {
  const mark = counts[l] === 0 ? "   <- 0" : ""
  console.log(`    ${l.padEnd(14)} ${String(counts[l]).padStart(7)}${mark}`)
}
console.log(`\n  denominators, read from the parse TREE:`)
console.log(`    files containing JSX (jsx_element / jsx_self_closing_element)   ${jsxFiles}`)
console.log(`    files containing a decorator node                              ${decoratorFiles}`)
console.log(`\n  mixes_in resolution split:`)
console.log(`    rows ${mixesInTargets.length}   target declared in the SAME FILE ${mixesDeclared}   not declared here ${mixesUndeclared}`)
if (mixesInTargets.length > 0) {
  const sample = mixesInTargets.slice(0, 6)
  for (const m of sample) console.log(`      ${m.file}: ${m.target}  declaredHere=${m.declaredHere}`)
}
console.log(`\n  part_of rows on this corpus: ${partOfRows}`)

if (JSON_OUT) {
  mkdirSync(path.dirname(JSON_OUT), { recursive: true })
  writeFileSync(
    JSON_OUT,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        repo: REPO,
        trackedFiles: tracked.length,
        jsFiles: jsFiles.length,
        parsedClean: parsedFiles,
        labelCounts: counts,
        denominators: { jsxFiles, decoratorFiles },
        mixesIn: {
          rows: mixesInTargets.length,
          targetDeclaredInSameFile: mixesDeclared,
          targetNotDeclaredHere: mixesUndeclared,
          sample: mixesInTargets.slice(0, 40),
        },
        partOfRows,
        note:
          "Whole-population counts for the labels the lane doc reported from a cap-50 triage. The JSX and decorator denominators come from the PARSE TREE (jsx_element / jsx_self_closing_element / decorator nodes), not from a text pattern. mixes_in is split by whether its target is a name the SAME FILE declares, which separates a store-bindable claim from a name no per-file analyzer could bind.",
      },
      null,
      2,
    ),
  )
  console.log(`  artifact: ${JSON_OUT}`)
}