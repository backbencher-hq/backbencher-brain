/**
 * MARKDOWN `overrides` PROBE — is a repeated heading a redefinition, or two sites?
 *
 * ## Why this probe exists separately
 *
 * The ruling table's `overrides` row needs an instrument B, and instrument B is for a
 * construct the language CAN express. The bash precedent's probe for `overrides` is "a
 * SECOND declaration of a name already declared in the same file", and applying it to
 * markdown verbatim returns a large non-zero number, because `## Example` appears in
 * every section of most documents. A large non-zero number on the wrong probe is worse
 * than no probe: it would FALSIFY a ruling that is correct and send the supervisor after
 * a defect that does not exist.
 *
 * So the probe has to ask the question the TYPE asks, which is not "is the name
 * repeated" but "does the second declaration REPLACE the first". Three measurements
 * separate those, and all three are reported:
 *
 *   A. same parent + same level + same display text, second occurrence — the shape a
 *      genuine redefinition has, because a redefinition is a second declaration in the
 *      SAME scope. A repeat under a DIFFERENT parent is a different section that
 *      happens to share a title, which is what most of the corpus has.
 *   B. same display text ANYWHERE in the file — the shape the naive probe counts.
 *   C. same ANCHOR — what a `#fragment` link resolves to. The renderer's own rule gives
 *      every repeat a distinct anchor (`slug`, `slug-1`, `slug-2`), so a repeat never
 *      takes the first holder's address and nothing becomes unreachable.
 *
 * A is the ruling's probe. B is reported beside it so the size of the mistake the naive
 * probe would make is a number rather than an adjective.
 *
 * Usage: npx tsx validation/m14/fixtures/markdown/overrides-probe.ts [--sample 1200]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const argOf = (name: string, dflt: string): string => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const SAMPLE = Number(argOf("sample", "1200"))
const SEED = argOf("seed", "markdown-construct-probe-v1")
const OUT = argOf("out", "")

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-markdown.wasm"))))

const population: { repo: string; rel: string; abs: string; text: string }[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split(String.fromCharCode(0)).filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!/\.(md|markdown)$/i.test(rel)) continue
    const abs = path.join(dir, rel)
    try {
      if (statSync(abs).size > 512 * 1024) continue
      population.push({ repo: e, rel, abs, text: readFileSync(abs, "utf8") })
    } catch { /* unreadable */ }
  }
}
const keyOf = (f: { repo: string; rel: string }) => `${f.repo}/${f.rel}`
const draw = (SAMPLE > 0 && SAMPLE < population.length
  ? population
      .map((f) => ({ f, h: createHash("sha256").update(`${SEED}|${keyOf(f)}`).digest("hex") }))
      .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0))
      .slice(0, SAMPLE)
      .map((x) => x.f)
  : population)

/** GitHub's slug, by character code — the renderer's rule, not this lane's. */
const slug = (s: string): string => {
  let out = ""
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const ch = s[i]
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57)) out += ch.toLowerCase()
    else if (c === 32 || c === 9 || c === 45) out += "-"
  }
  return out
}

let a_sameParentRedeclaration = 0
let a_files = 0
let b_sameTextAnywhere = 0
let b_files = 0
let c_anchorHeldByMoreThanOne = 0
let c_files = 0
const aExamples: string[] = []
const cExamples: string[] = []
const anchorsHeld = new Map<string, number>()

for (const f of draw) {
  let tree: any = null
  try { tree = parser.parse(f.text) } catch { continue }
  if (!tree) continue
  const stack: { name: string; level: number }[] = []
  const seenSameParent = new Set<string>()
  const seenText = new Set<string>()
  let a = 0
  let b = 0
  const heldHere = new Map<string, number>()
  const w = (n: any) => {
    if (n.type === "atx_heading" || n.type === "setext_heading") {
      let level = 1
      let text = ""
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        // `atx_h3_marker` puts the digit at index 5 and `setext_h2_underline` at index 7.
        // The first version sliced at 4 and 7 for both, which read the `h` of `atx_h3`,
        // made every ATX level `NaN`, and left the level stack never popping — so the
        // "parent" in probe A was the nearest heading of ANY level and the count was
        // measuring a different question. `hNaN` in the first run's own example output
        // is what gave it away.
        if (c.type.startsWith("atx_h")) level = Number(c.type.slice(5, 6))
        if (c.type.startsWith("setext_h")) level = Number(c.type.slice(7, 8))
        if (c.type === "inline" && text === "") text = c.text.trim()
      }
      if (n.type === "setext_heading") {
        const raw = n.text.trim()
        const nl = raw.indexOf("\n")
        text = (nl >= 0 ? raw.slice(0, nl) : raw).trim()
      }
      while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop()
      const parent = stack.length > 0 ? stack[stack.length - 1].name : "(document)"
      const scopeKey = `${parent}|${level}|${text}`
      if (seenSameParent.has(scopeKey)) {
        a++
        if (aExamples.length < 8) aExamples.push(`${keyOf(f)}:${n.startPosition.row + 1} under "${parent}" h${level} "${text}"`)
      }
      seenSameParent.add(scopeKey)
      const textKey = `|${level}|${text}`
      if (seenText.has(textKey)) b++
      seenText.add(textKey)
      const s = slug(text)
      if (s) heldHere.set(s, (heldHere.get(s) ?? 0) + 1)
      stack.push({ name: text || "(empty)", level })
    }
    for (let i = 0; i < n.childCount; i++) w(n.child(i))
  }
  w(tree.rootNode)
  tree.delete?.()
  let c = 0
  for (const [s, n] of heldHere) {
    if (n > 1) {
      c++
      anchorsHeld.set(s, n)
      if (cExamples.length < 8) cExamples.push(`${keyOf(f)}: #${s} held by ${n} headings`)
    }
  }
  if (a) { a_sameParentRedeclaration += a; a_files++ }
  if (b) { b_sameTextAnywhere += b; b_files++ }
  if (c) { c_anchorHeldByMoreThanOne += c; c_files++ }
}

const report = {
  instrument: "markdown overrides probe (validation/m14/fixtures/markdown/overrides-probe.ts)",
  corpusRoot: CR,
  seed: SEED,
  admittedMarkdownFiles: population.length,
  drawn: draw.length,
  drawHash: createHash("sha256").update(draw.map(keyOf).sort().join("\n")).digest("hex"),
  A_sameParentSameLevelSameText_secondOccurrence: {
    what: "the ruling's probe: a second declaration of a heading in the SAME scope, which is the shape a redefinition has because a redefinition replaces the prior one",
    occurrences: a_sameParentRedeclaration,
    files: a_files,
    examples: aExamples,
  },
  B_sameLevelSameText_anywhere: {
    what: "the NAIVE probe — every repeated heading text, including repeats under a different parent, which are two sections that share a title rather than one replacing the other",
    occurrences: b_sameTextAnywhere,
    files: b_files,
  },
  C_anchorHeldByMoreThanOneHeading: {
    what: "what a `#fragment` link has to choose between. Non-zero here is expected and is NOT an override: the renderer's rule gives every holder a distinct anchor (`slug`, `slug-1`, …), so no heading loses its address and nothing becomes unreachable.",
    anchors: c_anchorHeldByMoreThanOne,
    files: c_files,
    examples: cExamples,
  },
}
if (OUT) { writeFileSync(OUT, JSON.stringify(report, null, 2)); console.log(`wrote ${OUT}`) }
console.log(JSON.stringify({ drawn: draw.length, A: a_sameParentRedeclaration, aFiles: a_files, B: b_sameTextAnywhere, bFiles: b_files, C: c_anchorHeldByMoreThanOne, cFiles: c_files, aExamples, cExamples }, null, 2))