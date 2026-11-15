/**
 * THE FIVE ERROR-NAMED `function_definition`s — is declining them correct, and
 * does the analyzer decline rather than fabricate?
 *
 * ## The population
 *
 * `probe-bash-grammar-position-shapes.mts --all` censused every grammar position
 * the analyzer reads by shape, and found **0 unread shapes at 4 of 5 positions**
 * across 4,133 files. The fifth is `function_definition`, and it holds **5 nodes
 * of 6,773** whose name sits inside a tree-sitter `ERROR` node:
 *
 *   ohmyzsh/lib/clipboard.zsh:103              function clipcopy clippaste {
 *   ohmyzsh/lib/functions.zsh:49               function mkcd takedir() {
 *   ohmyzsh/lib/prompt_info_functions.zsh:13   (same shape)
 *   ohmyzsh/plugins/battery/battery.plugin.zsh:262
 *   ohmyzsh/plugins/macos/music:3
 *
 * Every one is the **zsh multi-name extension** `function a b { … }`, which is a
 * syntax error in bash: bash's `function_definition` takes exactly one name, so
 * the pinned grammar puts the extra names in an ERROR node. The question this
 * probe answers is not "are these missed" — in bash they are not constructs —
 * but the one the shape census cannot answer:
 *
 *   does the analyzer publish a name it read out of ERROR RECOVERY?
 *
 * A name lifted from an ERROR node is structure the source does not have, and
 * the lane has already deleted two fabrications of exactly that kind (round 2's
 * arithmetic operands, round 3's case-arm dependency edges). So this is measured
 * three ways and the three answers are different questions:
 *
 *   ADMITTED     does the production router `detectLanguageFromPath` route the
 *                file at all? A site in a file bash never claims to read is not
 *                a lane finding.
 *   PUBLISHED    what does production `parseFile` put in `symbols` for the
 *                names on that line? The honest answer is "nothing".
 *   WHAT-THE-WORD
 *                what the source line actually says, read from the tree, so a
 *                reader can check the grammar's complaint against the file.
 *
 * ## INSTRUMENT
 *
 * Production `parseFile` for ADMITTED and PUBLISHED; this probe's OWN
 * `web-tree-sitter` handle for WHAT-THE-WORD. Two handles, never shared — two
 * owners of one parser handle is what makes the coverage gate's per-type totals
 * wobble run to run (limitation 15).
 *
 * **NO REGEX.** Sites are located by walking to `function_definition` nodes whose
 * first named child is an `ERROR` node, and the line is the node's own
 * `startPosition`. Names are the ERROR node's `word` children, read through the
 * node API.
 *
 * CLI: npx tsx validation/m14/fixtures/bash/probe-bash-error-named-functions.mts
 *      [--all | --sample 400]
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

interface F {
  repo: string
  rel: string
  abs: string
  text: string
  hash: string
}

const files: F[] = []
let scanned = 0
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
    files.push({ repo: e, rel, abs, text, hash: createHash("sha256").update(`${e}/${rel}`).digest("hex") })
  }
}
files.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
const sample = ALL ? files : files.slice(0, SAMPLE)

console.log(
  `bash ERROR-named function probe — production parseFile + private tree handle, ${sample.length} files${ALL ? " (--all)" : ""}`,
)
console.log(`admitted ${files.length} / scanned ${scanned}\n`)

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({
  locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
})
const parser = new WSP()
parser.setLanguage(
  await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-bash.wasm"))),
)

interface Site {
  repo: string
  rel: string
  line: number
  words: string[]
}
const sites: Site[] = []
let defs = 0

for (const f of sample) {
  let tree: any
  try {
    tree = parser.parse(f.text)
  } catch {
    continue
  }
  const root = tree?.rootNode
  if (!root) continue
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "function_definition") {
      defs++
      const first = n.namedChildCount > 0 ? n.namedChild(0) : null
      if (first && first.type === "ERROR") {
        // Every `word` under the ERROR node is a NAME the grammar could not
        // place. Read them through the node API, in order.
        const words: string[] = []
        const wstack: any[] = [first]
        while (wstack.length > 0) {
          const w = wstack.pop()!
          if (w.type === "word" && w.text.length > 0) words.push(w.text)
          for (let j = w.childCount - 1; j >= 0; j--) {
            const c = w.child(j)
            if (c) wstack.push(c)
          }
        }
        sites.push({
          repo: f.repo,
          rel: f.rel,
          line: n.startPosition.row + 1,
          words,
        })
      }
    }
    for (let j = n.childCount - 1; j >= 0; j--) {
      const c = n.child(j)
      if (c) stack.push(c)
    }
  }
  tree.delete?.()
}

console.log(`function_definition nodes ${defs}`)
console.log(`of which the NAME sits inside an ERROR node: ${sites.length}\n`)

if (sites.length === 0) {
  console.log("no ERROR-named function on this sample — the position is clean here")
  process.exit(0)
}

// Group by file so `parseFile` is called once per file, not once per site.
const byFile = new Map<string, { f: F; lines: Site[] }>()
for (const s of sites) {
  const k = `${s.repo}/${s.rel}`
  let e = byFile.get(k)
  if (!e) {
    e = { f: files.find(x => `${x.repo}/${x.rel}` === k)!, lines: [] }
    byFile.set(k, e)
  }
  e.lines.push(s)
}

let published = 0
let totalWords = 0
console.log("ADMITTED / PUBLISHED — does the analyzer emit a name the grammar could not place?\n")
for (const [k, { f, lines }] of byFile) {
  const admitted = detectLanguageFromPath(f.abs, f.text) === "bash"
  let names: string[] = []
  let ok = false
  try {
    const res: any = await parseFile(f.abs)
    names = (res?.symbols ?? []).map((s: any) => s.name)
    ok = true
  } catch {
    ok = false
  }
  for (const s of lines) {
    for (const w of s.words) {
      totalWords++
      const hit = names.includes(w)
      if (hit) published++
      console.log(
        `  ${k}:${s.line}  name "${w}"  admitted=${admitted}  parseFile=${ok ? "ok" : "THREW"}  published=${hit ? "YES" : "no"}`,
      )
    }
  }
}
console.log(
  `\nwords the grammar could not place: ${totalWords}   of those PUBLISHED as a symbol: ${published}`,
)
console.log(
  published === 0
    ? "→ the analyzer declines every one: 0 names read out of error recovery"
    : `→ ${published} names were read out of ERROR nodes, which is the fabrication class round 2 and round 3 removed`,
)

function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex")
}