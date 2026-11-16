// Review instrument (NOT a gate): the CSS lane's parse-success floor, in the
// shape `script/m14/verify-parse-success.ts` pins.
//
//   bun script/m14/tmp/css-parse-success.ts [--sample N] [--out <path>]
//
// Why an instrument and not the gate: F10 derives its lanes from
// `differential.ts`'s LANGS/LANG_REPOS/SECOND_CORPUS, and adding `css` there
// also enrolls the lane in the F5 differential — which would emit a `css` check
// whose truth is `deriveTreeEdges` ALONE, i.e. a vacuous green for a lane with
// no oracle. So the floor is measured here first, and the official lane lands
// together with `deriveCssEdges`.
//
// The discriminant F10 uses and this mirrors: `rootNode.hasError` (which
// subsumes MISSING) for the verdict, and the two signals split for the
// diagnosis. A hand-rolled `type === "ERROR"` walk is NOT the criterion — it
// misses zero-width unnamed EOF phantoms that `hasError` correctly ignores
// (the groovy W21 lesson: an instrument that disagreed with the product by 114
// files on 200).

import { loadWebTreeSitter, Language, Parser } from "web-tree-sitter"
import { readFileSync, readdirSync, statSync, writeFileSync } from "fs"
import { createHash } from "crypto"
import { join } from "path"
import { spawnSync } from "child_process"

const ROOT = "<corpus-root>/bb_tests/repositories"
const argv = process.argv.slice(2)
const SAMPLE = Number(argv[argv.indexOf("--sample") + 1] || 400)
const OUT = argv[argv.indexOf("--out") + 1]

// Primary = the M12 pinned target. Second = an independent codebase with a
// different CSS dialect (a Java framework's stylesheets, not a Svelte
// compiler's expected-output fixtures). Dimension 4 of
// reviews/LANE-AUDIT-FORMULA.md wants >= 3 independent corpora; this lane's
// third is recorded in css-lane-census (13 repos), and the routing census
// carries the extension-level truth.
const LANES = [
  { lane: "svelte:css", repo: "svelte", primary: true },
  { lane: "grails-core:css", repo: "grails-core", primary: false },
]

function walk(dir: string, out: string[], d = 0): void {
  if (d > 10) return
  let es: string[]
  try { es = readdirSync(dir) } catch { return }
  for (const e of es) {
    if (e === "node_modules" || e === ".git" || e === "target" || e === "dist") continue
    const p = join(dir, e)
    let st: import("fs").Stats
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out, d + 1)
    else if (e.endsWith(".css") && st.size > 0) out.push(p)
  }
}

/** Hash-ordered then capped — a sorted-path cap on a repo that happens to
 *  alphabet its directories into one style directory would draw a
 *  unrepresentative sample. This is F10's own sampling rule. */
function hashOrder(files: string[], cap: number): string[] {
  if (cap <= 0 || files.length <= cap) return files.slice().sort()
  const keyed = files
    .map((f) => ({ f, h: createHash("sha256").update(f).digest("hex") }))
    .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0))
  return keyed.slice(0, cap).map((k) => k.f).sort()
}

/** The corpus pin, read from git itself rather than by walking .git by hand:
 *  a hand-rolled HEAD walk is exactly the kind of instrument that is wrong in a
 *  way nobody notices (the first version of this line prefixed `refs/heads/`
 *  onto a string that already carried it, and read ENOENT). */
function repoPin(dir: string): string {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" })
  return r.status === 0 ? r.stdout.trim() : "UNRESOLVED"
}

async function main() {
  await Parser.init()
  // ONE fresh wasm module per lane (F10's rule: a single module degrades after
  // ~19-31 lanes and then returns empty trees before it aborts, which is how a
  // dead parser becomes a clean 0% lane).
  const rows: any[] = []
  for (const l of LANES) {
    const lang = await Language.load(readFileSync("wasm/tree-sitter-css.wasm"))
    const parser = new Parser()
    parser.setLanguage(lang)
    const all: string[] = []
    walk(join(ROOT, l.repo), all)
    all.sort()
    const files = hashOrder(all, SAMPLE)
    const digest = createHash("sha256").update(files.join("\n")).digest("hex").slice(0, 16)

    let errFiles = 0, missFiles = 0, bothFiles = 0
    const errLineCounts: number[] = []
    const signatures: Record<string, number> = {}
    for (const f of files) {
      const tree = parser.parse(readFileSync(f, "utf8"))
      const r = tree.rootNode
      const hasError = r.hasError
      let hasMissing = false
      let errNodes = 0
      let firstErrLine = -1
      const w = (n: any) => {
        if (n.isMissing) hasMissing = true
        if (n.type === "ERROR" || (n.hasError && n.type !== "stylesheet")) {
          if (n.type === "ERROR") {
            errNodes++
            if (firstErrLine === -1) firstErrLine = n.startPosition.row + 1
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) w(c) }
      }
      w(r)
      if (hasError) errFiles++
      if (hasMissing) missFiles++
      if (hasError && hasMissing) bothFiles++
      if (errNodes > 0) {
        errLineCounts.push(errNodes)
        const src = readFileSync(f, "utf8").split("\n")[firstErrLine - 1] ?? ""
        const sig = src.trim().slice(0, 90)
        if (sig) signatures[sig] = (signatures[sig] ?? 0) + 1
      }
      tree.delete?.()
    }
    parser.delete?.()

    const n = files.length
    const pct = (x: number) => (n === 0 ? 0 : Math.round((x / n) * 10000) / 100)
    errLineCounts.sort((a, b) => a - b)
    rows.push({
      lane: l.lane,
      repo: l.repo,
      repoPin: repoPin(join(ROOT, l.repo)),
      corpusFiles: all.length,
      sampleLimit: SAMPLE,
      files: n,
      sampleDigest: digest,
      eitherPct: pct(errFiles),
      errPct: pct(errFiles),
      missPct: pct(missFiles),
      bothPct: pct(bothFiles),
      errorNodesMedian: errLineCounts.length ? errLineCounts[Math.floor(errLineCounts.length / 2)] : 0,
      errorNodesMax: errLineCounts.length ? errLineCounts[errLineCounts.length - 1] : 0,
      topFirstErrorLineSignatures: Object.entries(signatures).sort((a, b) => b[1] - a[1]).slice(0, 12),
    })
  }

  const artifact = {
    instrument: "css-parse-success",
    purpose:
      "The CSS lane's parse-success floor, in the shape script/m14/verify-parse-success.ts pins. Measured with an instrument rather than the gate so the F5 lane is not enrolled before deriveCssEdges exists — a css F5 check whose only truth is deriveTreeEdges would be a vacuous green.",
    wasm: "wasm/tree-sitter-css.wasm",
    wasmSha256: createHash("sha256").update(readFileSync("wasm/tree-sitter-css.wasm")).digest("hex"),
    sampling: "hash-ordered then capped, per lane, one fresh wasm module per lane",
    discriminant: "rootNode.hasError (subsumes MISSING). A hand-rolled `type === \"ERROR\"` walk is NOT the criterion.",
    lanes: rows,
  }
  const text = JSON.stringify(artifact, null, 2)
  if (OUT && OUT !== "undefined") { writeFileSync(OUT, text + "\n"); process.stderr.write(`wrote ${OUT}\n`) }
  console.log(text)
}
main().catch((e) => { console.error(e); process.exit(1) })
