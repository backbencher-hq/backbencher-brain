/**
 * Why 84.7% of `@extend` edges have an unresolved target — separated into the two
 * explanations, because they are not the same finding.
 *
 *   CROSS-FILE   the extended selector is declared in ANOTHER partial. `.btn-group-sm
 *                > .btn { @extend .btn-sm; }` in bootstrap's `_button-group.scss`
 *                extends `.btn-sm`, which lives in `_buttons.scss`. There is no
 *                symbol for it here and there must not be: publishing one would be
 *                inventing a declaration (SCSS-L7).
 *   MIS-SPELLED   the file DOES declare that selector and the lane published it under a
 *                DIFFERENT name. That is a defect in this lane, and it is the only one
 *                of the two an implementation can fix.
 *
 * Measured per edge: is the target name present among the file's own `rule_set`
 * selector texts (a name the grammar can produce) even though no published symbol
 * carries it?
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { parseFile } from "../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "scss") continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}
files.sort((a, b) => `${a.repo}/${a.rel}`.localeCompare(`${b.repo}/${b.rel}`))

const stats = {
  extendTotal: 0, extendResolved: 0,
  extendCrossFile: 0, extendMisSpelled: 0,
  placeholderTotal: 0, placeholderCrossFile: 0, placeholderMisSpelled: 0,
  otherTotal: 0, otherCrossFile: 0, otherMisSpelled: 0,
}
const misSpelled: string[] = []
let idx = 0
async function worker() {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { continue }
    const names = new Set<string>()
    for (const s of (r.symbols ?? []) as any[]) names.add(String(s?.name ?? ""))
    // every selector-shaped string the FILE writes, straight out of the text, used ONLY
    // as the witness for "this file mentions this selector". Not a resolution mechanism.
    const mentioned = new Set<string>()
    for (const m of f.text.matchAll(/(^|[\s,>+~}])([.%#]?[-\w]+(?:__[-\w]+)?(?:[-_][-\w]+)*)/g)) mentioned.add(m[2])
    for (const x of (r.relationships ?? []) as any[]) {
      if (x.metadata?.isScssExtend !== true) continue
      const t = String(x.target ?? "")
      stats.extendTotal++
      if (names.has(t)) { stats.extendResolved++; continue }
      const bucket = t.startsWith("%") ? "placeholder" : "other"
      if (bucket === "placeholder") stats.placeholderTotal++
      else stats.otherTotal++
      // the witness: the file writes this selector SOMEWHERE
      const mentionedHere = mentioned.has(t)
      if (mentionedHere) {
        stats.extendMisSpelled++
        if (bucket === "placeholder") stats.placeholderMisSpelled++
        else stats.otherMisSpelled++
        if (misSpelled.length < 15) misSpelled.push(`${f.repo}/${f.rel}: ${JSON.stringify(x.source)} -> ${t}`)
      } else {
        stats.extendCrossFile++
        if (bucket === "placeholder") stats.placeholderCrossFile++
        else stats.otherCrossFile++
      }
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))
console.log(JSON.stringify(stats, null, 1))
for (const m of misSpelled) console.log("  declared-here-but-unpublished:", m)
