/**
 * MEASURE limitation 8: does the `&` joiner in a `class_context` cost real edges?
 *
 *   npx tsx validation/m14/fixtures/clean/ampersand-context-probe.mts [--limit N]
 *
 * `readClassContext` in `src/ast/real-clean-analyzer.ts` resets `expectName` on a `,`
 * child and on nothing else. So a constraint list joined by `&` yields only its first
 * constraint. That is a FALSE NEGATIVE only when the conjuncts name DIFFERENT classes;
 * `| Eq a & Eq b` names `Eq` twice and the one published edge is the whole answer.
 *
 * The previous round declined to ship a fix and named the reason: reading `&` as a
 * second separator emits two identical `references` edges on one line, and whether that
 * is a duplicate or a multiplicity is a naming decision. That reasoning only blocks the
 * case where the conjuncts COLLIDE. This probe separates the two, because the count
 * that decides the question is "contexts whose conjuncts name different classes", not
 * "contexts containing an ampersand".
 *
 * Two populations, never mixed (see extends-construct-probe.mts for the same contract):
 *   TRACKED  the 312 files `git ls-files` admits — what the arbiter walks.
 *   WIDE     TRACKED plus script/m14/clean-wide-manifest.txt, content-deduplicated.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const ROOT = path.resolve(process.cwd())
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const WIDE = path.join(ROOT, "script", "m14", "clean-wide-manifest.txt")
const OUT = path.join(ROOT, "validation", "m14", "fixtures", "clean", "ampersand-context-probe.json")
const argv = process.argv.slice(2)
const li = argv.indexOf("--limit")
const LIMIT = li >= 0 ? Number(argv[li + 1]) : 0

function gitTrackedCleanFiles(): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const e of fs.readdirSync(CR)) {
    const dir = path.join(CR, e)
    try {
      if (!fs.statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      const abs = path.join(dir, rel)
      let text: string
      try { if (fs.statSync(abs).size > 512 * 1024) continue; text = fs.readFileSync(abs, "utf8") } catch { continue }
      if (detectLanguageFromPath(abs, text) !== "clean") continue
      if (seen.has(abs)) continue
      seen.add(abs); out.push(abs)
    }
  }
  return out.sort()
}

const tracked = gitTrackedCleanFiles()
const wide = new Set(tracked)
if (fs.existsSync(WIDE)) {
  for (const l of fs.readFileSync(WIDE, "utf8").split("\n")) {
    const abs = l.trim()
    if (!abs || wide.has(abs) || !fs.existsSync(abs)) continue
    if (fs.statSync(abs).size > 512 * 1024) continue
    if (detectLanguageFromPath(abs, fs.readFileSync(abs, "utf8")) !== "clean") continue
    wide.add(abs)
  }
}
const wideList = [...wide].sort()
const sample = (list: string[]) => (LIMIT > 0 ? list.slice(0, LIMIT) : list)

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const wasmPath = path.join(ROOT, "wasm", "tree-sitter-clean.wasm")
const grammar: any = await L.load(fs.readFileSync(wasmPath))
const parser = new P()
parser.setLanguage(grammar)

/** The class a constraint node names — same vocabulary the analyzer's `constraintName` accepts. */
function constraintName(n: any): string | null {
  if (!n?.isNamed) return null
  if (n.type === "constructor" || n.type === "identifier") return n.text
  if (n.type.startsWith("operator_")) return n.text
  return null
}

function run(list: string[], label: string) {
  const totals = { files: 0, parsed: 0, unparsed: 0, classContexts: 0, withComma: 0, withAmpersand: 0, withOtherJoiner: 0 }
  const joinerTypes: Record<string, number> = {}
  /** conjuncts a `,`/`&`-unaware reader did not publish, by whether a row would be ADDED or DUPLICATED */
  const droppedDistinct: { file: string; line: number; text: string; published: string[]; unread: string[] }[] = []
  const repeating: { file: string; line: number; text: string; alreadyPublished: string[]; conjunctThatWouldRepeat: string }[] = []
  let droppedDistinctCount = 0
  let droppedRepeatingCount = 0
  const examples: string[] = []

  for (const f of list) {
    totals.files++
    let t: any
    try { t = parser.parse(fs.readFileSync(f, "utf8")) } catch { t = null }
    if (!t) { totals.unparsed++; continue }
    totals.parsed++

    const visit = (n: any) => {
      if (n.type === "class_context") {
        totals.classContexts++
        const unnamed: string[] = []
        const published: string[] = []
        const all: string[] = []
        // Reproduce the analyzer's walk EXACTLY, and alongside it the walk a
        // `&`-aware reader would do, so the two are compared and not asserted.
        let expectName = true
        const naive: string[] = []
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (!c) continue
          if (!c.isNamed) {
            unnamed.push(c.type)
            joinerTypes[c.type] = (joinerTypes[c.type] ?? 0) + 1
            if (c.type === ",") expectName = true
            continue
          }
          const cn = constraintName(c)
          if (cn) all.push(cn)
          if (!expectName) continue
          expectName = false
          if (cn) naive.push(cn)
        }
        published.push(...naive)
        if (unnamed.includes(",")) totals.withComma++
        if (unnamed.includes("&") || unnamed.includes("&&")) totals.withAmpersand++
        const other = unnamed.filter((u) => u !== "," && u !== "&" && u !== "&&")
        if (other.length) totals.withOtherJoiner++

        if (naive.length && all.length > naive.length) {
          // Every conjunct the `,`-only reader did not publish, split by whether its
          // class is ALREADY published somewhere in this same context. These are two
          // different defects and must not be summed:
          //
          //   NOT already published -> the edge is simply ABSENT. Fixing it adds a row.
          //   ALREADY published     -> fixing it would append a SECOND, IDENTICAL
          //                           `references` edge on one line. That is the
          //                           duplicate-vs-multiplicity question, and it is a
          //                           real cost of the fix, not a hypothetical.
          //
          // The first version of this probe reported 0 for the second category and
          // that was an ARTEFACT: it computed `unread = all.filter(not in naive)` and
          // then tested `distinct = unread.filter(not in naive)` — the same predicate
          // twice, so the "repeats" branch was unreachable and could only ever print 0.
          for (const nm of all.slice(naive.length)) {
            if (naive.includes(nm)) {
              droppedRepeatingCount++
              if (repeating.length < 25) {
                repeating.push({
                  file: path.relative(CR, f),
                  line: n.startPosition.row + 1,
                  text: n.text.replace(/\s+/g, " ").slice(0, 160),
                  alreadyPublished: naive,
                  conjunctThatWouldRepeat: nm,
                })
              }
            } else {
              droppedDistinctCount++
              if (droppedDistinct.length < 25) {
                droppedDistinct.push({
                  file: path.relative(CR, f),
                  line: n.startPosition.row + 1,
                  text: n.text.replace(/\s+/g, " ").slice(0, 160),
                  published: naive,
                  unread: [nm],
                })
              }
            }
          }
        }
        if (examples.length < 25 && unnamed.some((u) => u !== ",")) {
          examples.push(`${path.relative(CR, f)}:${n.startPosition.row + 1} [${unnamed.join(" ")}] ${n.text.replace(/\s+/g, " ").slice(0, 120)}`)
        }
      }
      for (let i = 0; i < n.childCount; i++) visit(n.child(i))
    }
    visit(t.rootNode)
    t.delete?.()
  }

  return {
    population: label,
    files: totals.files,
    filesParsed: totals.parsed,
    filesUnparsed: totals.unparsed,
    classContexts: totals.classContexts,
    contextsWithComma: totals.withComma,
    contextsWithAmpersand: totals.withAmpersand,
    contextsWithOtherUnnamedChild: totals.withOtherJoiner,
    unnamedChildTypeInventory: Object.fromEntries(Object.entries(joinerTypes).sort()),
    contextsWhereAConjunctIsUnreadAndNamesADifferentClass: droppedDistinctCount,
    conjunctsWhereTheRowWouldBeDistinct: droppedDistinctCount,
    conjunctsWhereTheRowWouldDuplicateAnExistingOne: droppedRepeatingCount,
    duplicateRisk: droppedRepeatingCount,
    examplesOfUnreadDistinctConjunct: droppedDistinct,
    examplesOfConjunctThatWouldDuplicate: repeating,
    examplesOfNonCommaUnnamedChild: examples,
  }
}

const result = {
  question:
    "Does treating `&` as a constraint separator in `readClassContext` add `references` edges, or only duplicates?",
  instrument: "class_context child sequence, read twice: as the analyzer reads it, and as a `,`/`&`-separated read",
  populations: [run(sample(tracked), "TRACKED"), run(sample(wideList), "WIDE")],
}
fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n")
for (const p of result.populations) {
  console.log(
    `${p.population}: files ${p.files} parsed ${p.filesParsed} | class_contexts ${p.classContexts} ` +
      `| comma ${p.contextsWithComma} ampersand ${p.contextsWithAmpersand} other-unnamed ${p.contextsWithOtherUnnamedChild} ` +
      `| conjuncts a fix would ADD ${p.conjunctsWhereTheRowWouldBeDistinct} ` +
      `| conjuncts a fix would DUPLICATE ${p.conjunctsWhereTheRowWouldDuplicateAnExistingOne}`,
  )
  console.log(`  unnamed child types: ${JSON.stringify(p.unnamedChildTypeInventory)}`)
  for (const e of p.examplesOfUnreadDistinctConjunct.slice(0, 6)) {
    console.log(`  ADD ${e.file}:${e.line} published=${JSON.stringify(e.published)} unread=${JSON.stringify(e.unread)} | ${e.text}`)
  }
  for (const e of p.examplesOfConjunctThatWouldDuplicate.slice(0, 6)) {
    console.log(`  DUP ${e.file}:${e.line} alreadyPublished=${JSON.stringify(e.alreadyPublished)} wouldRepeat=${JSON.stringify(e.conjunctThatWouldRepeat)} | ${e.text}`)
  }
}
console.log(`wrote ${path.relative(ROOT, OUT)}`)