/*
 * probe-bash-wasm-tree-lifetime.mts — WHY a probe reported 87.9% of the bash
 * corpus as unparseable, measured in a controlled A/B.
 *
 * Round 8 of this lane published a table whose second row read "files the pinned
 * wasm could not parse: 3,634 (87.9%)" and concluded from it that a whole-corpus
 * bash measurement cannot be taken in one process (limitation 25). That
 * conclusion was wrong, and the mechanism is one missing method call.
 *
 * A web-tree-sitter `Tree` lives in the wasm heap. Nothing reclaims it except
 * `tree.delete()`. A probe that parses N files and drops the trees therefore grows
 * the heap by one whole parse tree per file; when the heap is exhausted every
 * subsequent parse throws `memory access out of bounds`, and because the failure
 * is a heap condition rather than a property of any file, it hits every file from
 * that point on — including files the grammar reads perfectly well.
 *
 * `probe-bash-arithmetic-operands.mts` called `parser.parse(f.text)` once per file
 * and never deleted the result. It read 499 of 4,133 files and reported the other
 * 3,634 as unparseable. Its 400-file sample sits UNDER the exhaustion point, which
 * is why every sample-based figure that probe produced was correct and only the
 * whole-corpus run broke — a shape that reads exactly like a corpus property.
 *
 * This probe is the A/B that settles it: the same admitted files, the same
 * grammar, the same process count, run twice, differing in ONE line.
 *
 *   npx tsx validation/m14/fixtures/bash/probe-bash-wasm-tree-lifetime.mts --files 900
 *   npx tsx validation/m14/fixtures/bash/probe-bash-wasm-tree-lifetime.mts --files 900 --delete
 *
 * Both modes must be run to have a comparison; the script exits non-zero if
 * `--delete` does NOT improve on the mode without it, so a regression in tree
 * lifetime cannot pass silently.
 *
 * No regex: this file matches nothing by pattern. File admission is the
 * production `detectLanguageFromPath`, and the walk is an explicit stack.
 */

import { readdirSync, statSync, readFileSync } from "fs"
import { createHash } from "crypto"
import path from "path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const N = Number(flag("files") ?? "900")
const DELETE = argv.includes("--delete")
const REPO_ROOT = path.resolve(process.cwd())

type Admitted = { abs: string; text: string }
const admitted: Admitted[] = []
let scanned = 0
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  let st
  try {
    st = statSync(dir)
  } catch {
    continue
  }
  if (!st.isDirectory() || e === ".git") continue
  const stack = [""]
  while (stack.length > 0) {
    const rel = stack.pop()!
    let ents: string[]
    try {
      ents = readdirSync(path.join(dir, rel))
    } catch {
      continue
    }
    for (const f of ents) {
      if (f === ".git") continue
      const r2 = rel ? `${rel}/${f}` : f
      const abs = path.join(dir, r2)
      let s2
      try {
        s2 = statSync(abs)
      } catch {
        continue
      }
      if (s2.isDirectory()) {
        stack.push(r2)
        continue
      }
      scanned++
      // The census this falsifies used a 512 KB ceiling; matched here so the two
      // instruments are admitted over the same file set.
      if (s2.size > 512 * 1024) continue
      let text = ""
      try {
        text = readFileSync(abs, "utf8")
      } catch {
        continue
      }
      if (detectLanguageFromPath(abs, text) !== "bash") continue
      admitted.push({ abs, text })
    }
  }
}
// Hash order, so both modes walk an IDENTICAL file set and the comparison is the
// lifetime of a tree rather than the luck of the draw.
admitted.sort((a, b) => (createHash("sha256").update(a.abs).digest("hex") < createHash("sha256").update(b.abs).digest("hex") ? -1 : 1))
const files = admitted.slice(0, N)

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(REPO_ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(REPO_ROOT, "wasm", "tree-sitter-bash.wasm"))))

let ok = 0
let threw = 0
let firstThrow = -1
const rss = (): number => Math.round(process.memoryUsage().rss / 1048576)

for (let i = 0; i < files.length; i++) {
  try {
    const t = parser.parse(files[i].text)
    // THE LINE UNDER TEST. Everything else in this file is identical between runs.
    if (DELETE) t.delete()
    ok++
  } catch {
    threw++
    if (firstThrow < 0) firstThrow = i
  }
  // The heap grows without `delete()`, so report it where a reader can watch it
  // cross the threshold rather than only at the end.
  if ((i + 1) % 200 === 0) console.log(`  i=${i + 1}  parsed=${ok}  threw=${threw}  rss=${rss()}MB`)
}

console.log(`\nmode                     : ${DELETE ? "tree.delete() CALLED" : "trees DROPPED (no delete)"}`)
console.log(`admitted as bash         : ${admitted.length}`)
console.log(`files walked             : ${files.length}`)
console.log(`parsed without throwing  : ${ok}`)
console.log(`THREW memory fault       : ${threw}`)
console.log(`first throw at index     : ${firstThrow}`)
console.log(`rss at end (MB)          : ${rss()}`)

if (DELETE) {
  // The falsification is only meaningful if `--delete` is BETTER. A run where it
  // is not is a regression this probe must not report as a pass.
  const okNoDelete = Number(process.env.BASELINE_THREW ?? "NaN")
  if (Number.isFinite(okNoDelete)) {
    const improved = threw < okNoDelete
    console.log(`\nbaseline (no delete) threw: ${okNoDelete}`)
    console.log(`VERDICT: delete() ${improved ? "IMPROVES" : "DOES NOT IMPROVE ON"} the baseline — ${improved ? "the leak is the cause" : "the leak is NOT the cause and this probe's premise is wrong"}`)
    process.exit(improved ? 0 : 1)
  }
  console.log(`\nrun the no-delete mode first and pass its THREW count as BASELINE_THREW to adjudicate`)
}