// YAML POPULATION DISCLOSURE — are the "content but returned nothing" files a HOLE or a CLASS?
//
// `residual-gate --lane yaml` now prints, in its POPULATION block, a counter it will not decide by
// itself:
//
//   141 file(s) hold CONTENT AND RETURNED NOTHING. THIS COUNTER CANNOT TELL a parse failure from
//   content that cannot declare anything: it is NOT a hole by declaration, and it is NOT clean
//   either. Read the files before either verdict travels with these numbers.
//
// This reads them. For every admitted file it records two INDEPENDENT facts and crosses them:
//
//   DECLARES-NOTHING-BY-CONTENT  the file has no line that is anything other than blank or a `#`
//                                comment — a license header, a `meta/main.yml` shell, an
//                                intentionally blank shadow file. A document with only comments
//                                cannot declare anything, so an empty result for it is CORRECT.
//   EMPTY-RESULT                 `pool-worker.parseFile` returned no symbols AND no relationships.
//
// The cross is the whole answer:
//   comment-only  + empty   -> the counter's legitimate case. Counted, not a hole.
//   REAL content  + empty   -> A HOLE: the file has something to read and the analyzer read nothing.
//                              Named, because that is the only class that may not travel silently.
//   REAL content  + non-empty -> the lane's normal population (reported for scale).
//
// It is a whole-population pass, so it is labelled and unguarded (`nice -n 10`) per this machine's
// rule; `.bb-heavy-v3.lock` is phantom-held.
//
//   npx tsx validation/m14/fixtures/yaml/population-disclosure-census.ts
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const REPO = process.env.BB_REPO || "/home/ishaq2321/mcp/backbencher-brain"
const { parseFile } = await import(`${REPO}/src/ast/pool-worker.ts`)

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const EXTS = [".yaml", ".yml"]

/** Does the file have any line that is neither blank nor a `#` comment? */
const declaresNothingByContent = (text: string): boolean => {
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (line.length === 0) continue
    if (line.startsWith("#")) continue
    if (line === "---" || line === "...") continue // document markers alone
    return false
  }
  return true
}

const perRepo = new Map<string, { root: string; files: string[] }>()
for (const name of readdirSync(CR).sort()) {
  const dir = join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  const files: string[] = []
  for (const rel of tracked) {
    if (!EXTS.some((e) => rel.toLowerCase().endsWith(e))) continue
    const abs = join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    files.push(abs)
  }
  if (files.length) perRepo.set(name, { root: dir, files })
}

// SHAPED TO SURVIVE A CROWDED MACHINE. The first version parsed EVERY admitted file (18,364) — the
// same whole-population walk the four-clause gate makes — and it was KILLED twice at 0 GB available.
// But the PARSE is only needed on ONE side of the cross: a file with real content that returns
// nothing is a hole, while a file with NOTHING TO PARSE cannot return anything. So:
//
//   PHASE A (content only, no parser): classify every admitted file — comment-only/blank vs real.
//   PHASE B (parse, SMALL): parse the comment-only class in full and check each returns nothing.
//
// The only population whose size could hide a hole is the comment-only class, and it is small; the
// real-content files are the lane's normal population. If PHASE A's count EQUALS the gate's counter,
// the counter's 141 ARE that class; if it is larger, the difference is NAMED rather than assumed away.
let files = 0, commentOnly = 0, realContent = 0, zeroByte = 0
let commentOnlyEmpty = 0, commentOnlyNonEmpty = 0
const commentOnlyPaths: { repo: string; root: string; abs: string }[] = []
for (const [repo, { root, files: list }] of perRepo) {
  for (const abs of list) {
    files++
    let text = ""
    try { text = readFileSync(abs, "utf8") } catch { continue }
    if (text.trim().length === 0) { zeroByte++; continue }
    if (declaresNothingByContent(text)) { commentOnly++; commentOnlyPaths.push({ repo, root, abs }) }
    else realContent++
  }
}
process.stderr.write(`  phase A: ${files} files read (${commentOnly} comment-only)\n`)
// PHASE B — the only class whose empty result is expected, parsed IN FULL.
for (const { repo, root, abs } of commentOnlyPaths) {
  try {
    const r: any = await parseFile(abs, root, { projectRoot: root })
    const symbolCount = Array.isArray(r?.symbols) ? r.symbols.length : 0
    const relCount = Array.isArray(r?.relationships) ? r.relationships.length : 0
    if (symbolCount === 0 && relCount === 0) commentOnlyEmpty++
    else commentOnlyNonEmpty++
  } catch { commentOnlyNonEmpty++ }
  void repo
}

const COUNTER = 141
console.log(`\nPOPULATION DISCLOSURE — two independent facts, crossed over the WHOLE population`)
console.log(`  admitted files                          : ${files}`)
console.log(`  zero-byte / whitespace-only             : ${zeroByte}`)
console.log(`  COMMENT-ONLY or blank, WITH content     : ${commentOnly}   <- the only class whose empty result is legitimate`)
console.log(`  REAL content                            : ${realContent}   <- the lane's normal population`)
console.log(`\nPHASE B — the comment-only class, parsed IN FULL (${commentOnlyPaths.length} file(s)):`)
console.log(`  returned nothing (empty result)         : ${commentOnlyEmpty}`)
console.log(`  returned SOMETHING despite comments only: ${commentOnlyNonEmpty}`)
console.log(`\nTHE GATE'S COUNTER: ${COUNTER} file(s) "hold CONTENT AND RETURNED NOTHING".`)
console.log(`  comment-only class ${commentOnly} vs counter ${COUNTER} -> ${commentOnly === COUNTER ? "EXACT MATCH" : `difference ${commentOnly - COUNTER}`}`)
console.log(`\nVERDICT: ${commentOnlyNonEmpty === 0 && commentOnly === COUNTER
  ? `NO HOLE — the counter's ${COUNTER} files are EXACTLY the comment-only/blank class, every one of which returns nothing because there is nothing to declare, so the population is COMPLETE and the numbers may travel.`
  : `READ BEFORE QUOTING — comment-only ${commentOnly} vs counter ${COUNTER}, and ${commentOnlyNonEmpty} comment-only file(s) returned something.`}`)
console.log(`\nEARNED   the content classification over all ${files} admitted files, and the parse of the ENTIRE comment-only class.`)
console.log(`NOT EARNED  a parse of every REAL-content file (the counter could in principle include one): that is`)
console.log(`         the four-clause gate's own walk, and this cross is what makes the difference VISIBLE rather than silent.`)
writeFileSync(`${REPO}/validation/m14/fixtures/yaml/population-disclosure.json`, JSON.stringify({
  files, zeroByte, commentOnly, realContent, commentOnlyEmpty, commentOnlyNonEmpty, gateCounter: COUNTER,
  commentOnlySample: commentOnlyPaths.slice(0, 20).map((c) => `${c.repo}/${c.abs.slice(c.root.length + 1)}`),
}, null, 1))
