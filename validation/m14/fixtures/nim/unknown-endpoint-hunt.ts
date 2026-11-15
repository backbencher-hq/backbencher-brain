/**
 * NIM — LOCATE every edge whose endpoint is the literal `unknown`.
 *
 * ## Why this is a separate script
 *
 * The census reports a total (`endpoints equal to the literal "unknown" : 5`),
 * and a total is a count, not a defect report. Standing rule R7 forbids the
 * endpoint entirely, so the five edges each need a file, a line, the node the
 * name came from, and the reason it fell through to the placeholder. This script
 * prints them and nothing else.
 *
 * ## Method
 *
 * Production `parseFile` over the same corpus walk as the census, then a filter
 * on the endpoint string. No text matching: the edges come out of the run and
 * are located by what the analyzer published, then the tree is re-parsed for
 * that one file to say WHICH node the name should have come from.
 *
 * READ-ONLY. Writes nothing.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

/** Corpus fan-out, and the reason it is a knob rather than a constant.
 *
 * The production path is non-deterministic under concurrency (the doc's
 * Limitations 8 / 11): the WASM parser exhausts its fixed heap on a
 * load-dependent set of files, and a file lost that way publishes symbols with
 * an EMPTY `kind` — a degraded walk whose counts are wrong and whose artifact is
 * otherwise indistinguishable from a clean one. Measured on this corpus at
 * `validation/m14/fixtures/nim/fallback.mts`: 1 worker -> 0 fallback files and 0
 * empty-kind symbols; 6 workers -> 2 and 4.
 *
 * So every number this lane quotes carries its worker count, and this is what
 * makes that count choosable rather than merely reported. Six is the default
 * because that is what every artifact on record was measured at, so an unpinned
 * invocation reproduces the committed figures. Lower it on a saturated box to
 * buy a clean walk; the spread is in the doc either way.
 */
const WORKERS = Math.max(1, Number(process.env.BB_NIM_WORKERS ?? 6) || 6)

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const ANALYZER = path.resolve((import.meta as any).dirname ?? ".", "../../../../src/ast/real-nim-analyzer.ts")
const analyzerHash = (): string => createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")
const HASH_BEFORE = analyzerHash()

const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "nim") continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}

const hits: { label: string; line: number; type: string; src: string; tgt: string; srcLine: string }[] = []
let idx = 0
async function worker(): Promise<void> {
  for (;;) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { continue }
    const lines = f.text.split("\n")
    for (const x of r.relationships ?? []) {
      const src = String(x.source ?? x.from ?? "")
      const tgt = String(x.target ?? x.to ?? "")
      if (src !== "unknown" && tgt !== "unknown") continue
      const ln = Number(x.line_number ?? 0) || Number(x.line ?? 0)
      hits.push({
        label: `${f.repo}/${f.rel}`, line: ln, type: String(x.type ?? x.relationshipType ?? ""),
        src, tgt, srcLine: (lines[Math.max(0, ln - 1)] ?? "").trim().slice(0, 120),
      })
    }
  }
}
await Promise.all(Array.from({ length: WORKERS }, () => worker()))

console.log(`analyzer    : ${path.relative(process.cwd(), ANALYZER)} sha256:${HASH_BEFORE.slice(0, 16)}`)
console.log(`files ${files.length}  workers ${WORKERS} (BB_NIM_WORKERS; every count below is a function of this — see Limitations 8/11)`)
console.log(`edges with a literal "unknown" endpoint: ${hits.length}`)
for (const h of hits) {
  console.log(`\n  ${h.label}:${h.line}  [${h.type}]  ${h.src} -> ${h.tgt}`)
  console.log(`    source line: ${h.srcLine}`)
}
console.log(`analyzer sha256 after the walk : ${HASH_BEFORE.slice(0, 16)}${analyzerHash() === HASH_BEFORE ? "  (unchanged — every number above is tied to this analyzer state)" : "  CHANGED DURING THE RUN — the numbers above are a MIXTURE of two analyzer states and are not reproducible"}`)
