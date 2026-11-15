/**
 * CSS-D18 FALSIFIER — would resolving a basename specifier against the importing file's OWN
 * directory actually resolve the 51 ambiguous `imports` edges?
 *
 * WHY THIS EXACT MEASUREMENT. CSS-D18 declines the "resolve the relative specifier" fix on the
 * ground that it would have to GUESS a sibling whose admission a per-file analyzer cannot check,
 * risking the 47 basenames that resolve today for 51 it would often miss. That reasoning has a
 * testable premise, and this file tests it rather than resting on it: for every import edge whose
 * specifier is a bare basename, compute the sibling the language's own rule names
 * (`dir(importer)/specifier`) and ask whether that sibling is an ADMITTED file.
 *
 *   sibling admitted for most of the ambiguous 51 -> the fix HAS a beneficiary and CSS-D18's
 *                                                    premise is falsified; revisit the ruling
 *   sibling admitted for few of them              -> the guess would trade resolved edges for
 *                                                    unresolved ones, and the ruling stands
 *
 * WHY ADMISSION IS THE WHOLE ANSWER: a file the population admits is walked, and this lane
 * publishes its module symbol with the project-unique `qualifiedName` CSS-D15 gives every symbol
 * — so an admitted sibling is exactly the key a resolved target would name, and the edge would
 * resolve to ONE declaration. No second parse is needed to know that.
 *
 * ONLY files whose text contains `@import` are parsed — the populations' 1,228 files are read as
 * text, and the parse is spent on the minority that can emit the edge being tested.
 *
 * CONTROL: a specifier whose sibling cannot exist must be reported as "no sibling", or the check
 * is measuring the file set rather than the rule.
 *
 * Usage: npx tsx validation/m14/fixtures/css/imports-sibling-falsifier.ts
 */
import { readFileSync, statSync, readdirSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANE_EXTS = (process.env.BB_CSS_EXTS ?? "css,less").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)

const files: string[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!LANE_EXTS.some((x) => rel.toLowerCase().endsWith("." + x))) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 1024 * 1024) continue } catch { continue }
    files.push(abs)
  }
}
files.sort()
const admittedSet = new Set(files)

const isBasename = (t: string): boolean =>
  !t.includes("://") && !t.startsWith("@") && !t.includes("/") && !t.includes("\\") && t.includes(".") && !t.startsWith(".")

let scanned = 0, parsed = 0, studied = 0
let ambiguousWithSibling = 0, ambiguousWithoutSibling = 0, uniqueWithSibling = 0, uniqueWithoutSibling = 0
let ambiguousOnDiskNotAdmitted = 0, uniqueOnDiskNotAdmitted = 0
let qualifiedTargets = 0, bareTargets = 0
const noSiblingExamples: string[] = []
for (const f of files) {
  let text: string
  try { text = readFileSync(f, "utf8") } catch { continue }
  scanned++
  if (!text.includes("@import")) continue
  parsed++
  let res: any
  try { res = await parseFile(f, text) } catch { continue }
  const imports = (res.relationships ?? []).filter((r: any) => String(r.relationshipType ?? r.type ?? "") === "imports")
  // THE SPECIFIER, from the edge's own metadata — NOT the target, which the sibling fix may have
  // already resolved to `<sibling-scope>::<basename>`. Reading the target would silently drop the
  // very edges this instrument exists to count.
  const basenames = imports
    .map((r: any) => String(r.metadata?.importSpecifier ?? r.target ?? ""))
    .filter(isBasename)
  const qualifiedEmitted = imports.filter((r: any) => String(r.target ?? "").includes("::")).length
  const bareEmitted = imports.length - qualifiedEmitted
  if (qualifiedEmitted) qualifiedTargets += qualifiedEmitted
  else bareTargets += bareEmitted
  if (basenames.length === 0) continue
  const repo = f.slice(CR.length + 1).split(path.sep)[0]
  for (const target of basenames) {
    studied++
    const sibling = path.join(path.dirname(f), target)
    const siblingAdmitted = admittedSet.has(sibling)
    // AMBIGUITY IS A PROJECT PROPERTY and is computable WITHOUT parsing: this lane publishes a
    // module symbol per file, named by the file's own basename, so the number of declarations
    // answering a basename target is the number of ADMITTED FILES with that basename IN THE SAME
    // REPOSITORY. The first version of this file used "repeated within the importing file" as the
    // proxy — a different question, which read 0/0 and answered nothing.
    const decls = files.filter((g) => g.slice(CR.length + 1).split(path.sep)[0] === repo && path.basename(g) === target).length
    const ambiguousHere = decls > 1
    const siblingOnDisk = existsSync(sibling)
    if (ambiguousHere) {
      if (siblingAdmitted) ambiguousWithSibling++
      else { ambiguousWithoutSibling++; if (siblingOnDisk) ambiguousOnDiskNotAdmitted++ }
    } else {
      if (siblingAdmitted) uniqueWithSibling++
      else {
        uniqueWithoutSibling++
        if (siblingOnDisk) uniqueOnDiskNotAdmitted++
        if (noSiblingExamples.length < 5) noSiblingExamples.push(`${path.relative(CR, f)} -> ${target}${siblingOnDisk ? "  [ON DISK, NOT ADMITTED]" : "  [not on disk]"}`)
      }
    }
  }
}

const controlSibling = path.join(path.dirname(files[0]), "definitely-not-a-real-file-xyz.css")
const controlFires = !admittedSet.has(controlSibling)

console.log("css imports — CSS-D18's falsifier, measured")
console.log(`population ${files.length} admitted files (${LANE_EXTS.join(",")}); text-scanned ${scanned}; parsed (contain '@import') ${parsed}`)
console.log(`basename-specifier import edges studied ${studied}`)
console.log(`emitted targets: qualified (sibling resolved) ${qualifiedTargets}, bare ${bareTargets}`)
console.log(`  AMBIGUOUS targets (2+ admitted files in the repo publish the basename): sibling ADMITTED ${ambiguousWithSibling}, not admitted ${ambiguousWithoutSibling} (of those, on disk but untracked ${ambiguousOnDiskNotAdmitted})`)
console.log(`  single occurrence: sibling ADMITTED ${uniqueWithSibling}, not admitted ${uniqueWithoutSibling} (of those, on disk but untracked ${uniqueOnDiskNotAdmitted})`)
if (noSiblingExamples.length) for (const x of noSiblingExamples) console.log(`    no sibling: ${x}`)
console.log(`control (a sibling that cannot exist is reported absent): ${controlFires ? "FIRES" : "DID NOT FIRE"}`)
console.log("")
const verdict = controlFires && studied > 0
console.log(`READING: ${!verdict ? "CONTROL DID NOT FIRE — the counts prove nothing" : `an existence-gated sibling resolution would fix ${ambiguousWithSibling} ambiguous edges and put ${uniqueOnDiskNotAdmitted + ambiguousOnDiskNotAdmitted} currently-resolving edges at risk (sibling on disk but untracked) — a STRICT improvement iff that risk is 0`}`)
process.exitCode = verdict ? 0 : 1
