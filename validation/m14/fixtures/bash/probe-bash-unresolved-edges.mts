/**
 * THE AMBIGUOUS `calls` EDGES THAT PUBLISH NOTHING — whole corpus, and what closes them.
 *
 * ## The question
 *
 * `probe-bash-published-resolvability.mts --all` reports, per relationship type, how
 * many edges leave the candidate set at >1 after every published discriminator has been
 * applied, split into two cells that are different facts:
 *
 *   of which said so   `targetResolution` is a string, no line published. The analyzer
 *                      saw several and declined to pick. A correct answer to a question
 *                      the edge cannot answer.
 *   bare               `targetResolution` is ABSENT. The edge names one target and
 *                      publishes nothing about which. The two outcomes are
 *                      indistinguishable to a consumer unless the field is read.
 *
 * Rounds 11-14 drove the first cell to a small number on every type, and round 15
 * re-measured it and found **`calls` bare = 5**. This file takes those 5 apart and asks,
 * for the SHAPE each one is:
 *
 *   A  the `command` node is a DESCENDANT of an ERROR node. The grammar could not close
 *      a construct and handed back the fragment inside it; the word read as a command
 *      name is a word from the middle of a broken statement.
 *   B  the `command` node's command_name is NOT the node's first named child and an
 *      ERROR or MISSING sibling precedes it — the shape round 3's guard E declined
 *      because `V=2 kube::log::status` in gubernator.sh has the same shape.
 *   C  neither: the command is cleanly parsed, and the ambiguity is a real local
 *      declaration of the same name as an EXTERNAL command.
 *
 * Shapes A and B are FABRICATION candidates — an edge naming a program the source does
 * not run. Shape C is not a fabrication at all: the edge is right and the ambiguity is
 * a name collision, so the fix there is to publish the fact rather than remove the
 * edge.
 *
 * ## Why these three and not "commands in a damaged region"
 *
 * Round 3 measured guard B ("any damaged region, subtree or ancestor chain") at 96 of
 * 2,945 calls and rejected it, because a MISSING token anywhere in a file condemns
 * every command under it and the removal set was 15 real `kube::log::status` calls plus
 * real `print`/`autoload`/`setopt` work. Round 13 then measured the converse for
 * DECLARATIONS and found 427 function names whose `name:` field sits inside an ERROR
 * span, every one of them a real declaration, the span reaching back over intact code.
 *
 * So "inside an ERROR span" is a statement about a node's SPAN, not about whether the
 * node is structure the source has. This probe therefore reports each shape with the
 * EXAMPLES it removes and the examples it keeps, and the verdict is read off those
 * lists rather than off the count.
 *
 * ## INSTRUMENT
 *
 * Production `parseFile` from `src/ast/pool-worker.ts` for every published edge, and
 * THIS FILE'S OWN `web-tree-sitter` handle over the pinned
 * `wasm/tree-sitter-bash.wasm` for the shape. Two handles, never shared — two owners of
 * one parser handle is what makes the shared coverage gate's per-type totals wobble
 * between runs (limitation 15).
 *
 * **NO REGEX.** Every shape is `node.type`, `node.isMissing`, integer child indices and
 * `startPosition`, read through the node API. Nothing here inspects source text.
 *
 * CLI: npx tsx validation/m14/fixtures/bash/probe-bash-unresolved-edges.mts
 *      [--sample 400 | --all] [--examples 12]
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
const EXAMPLES = num("examples", 12)

interface F {
  repo: string
  rel: string
  abs: string
  /** the repository root, which production `parseFile` takes as its projectPath */
  dir: string
  text: string
  hash: string
}

const files: F[] = []
let scanned = 0
const repoNames = new Set<string>()
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
    repoNames.add(e)
    files.push({ repo: e, rel, abs, dir, text, hash: createHash("sha256").update(`${e}/${rel}`).digest("hex") })
  }
}
files.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
const sample = ALL ? files : files.slice(0, SAMPLE)

console.log(
  `bash unresolved-edge probe — production parseFile + private tree handle, ${sample.length} files${ALL ? " (--all)" : ""}`,
)
console.log(`admitted ${files.length} / scanned ${scanned} / repos ${repoNames.size}\n`)

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

type Shape = "clean" | "errorDescendant" | "errorSiblingBefore" | "both"

/**
 * Classify ONE `command` node by where its damage is, in the node API only.
 *
 * `errorDescendant`    this command node sits INSIDE an ERROR node. The construct the
 *                       source wrote was not closed, so everything under the ERROR is a
 *                       fragment of it.
 * `errorSiblingBefore` the command's own subtree is clean, but an ERROR or MISSING
 *                       sibling PRECEDES its command_name inside the same command node.
 *                       This is round 3's guard E, and the shape `V=2 kube::log::status`
 *                       has, which is why it is measured separately and never applied
 *                       blind.
 */
function commandNameNodeOf(node: any): any {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (child && child.type === "command_name") return child
  }
  return null
}

function classify(node: any): Shape {
  let insideError = false
  for (let a = node.parent; a; a = a.parent) {
    if (a.type === "ERROR") {
      insideError = true
      break
    }
  }
  let siblingBefore = false
  const cn = commandNameNodeOf(node)
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (!c) continue
    if (c === cn) break // only what comes BEFORE the command name
    if (c.type === "ERROR" || c.isMissing) {
      siblingBefore = true
      break
    }
  }
  if (insideError && siblingBefore) return "both"
  if (insideError) return "errorDescendant"
  if (siblingBefore) return "errorSiblingBefore"
  return "clean"
}

interface Site {
  line: number
  name: string
  shape: Shape
  /** the raw command text, for the reader adjudicating by hand */
  text: string
}

const sites = new Map<string, Site[]>()
let commands = 0
let parseFailures = 0
for (const f of sample) {
  let tree: any
  try {
    tree = parser.parse(f.text)
  } catch {
    continue
  }
  const root = tree?.rootNode
  if (!root) continue
  const list: Site[] = []
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "command") {
      commands++
      // The SAME selection the analyzer makes. `commandNameNode`
      // (src/ast/real-bash-analyzer.ts:1227) scans ALL named children for the first
      // `command_name`, not just namedChild(0) — and the two differ on exactly the
      // shapes this round is about:
      //
      //   V=2 kube::log::status "..."   -> [variable_assignment, ERROR, command_name, string]
      //   entries[x]=${${(%):-%x}:A}    -> [variable_assignment, ERROR, command_name]
      //          local key
      //
      // The first version of this probe read `namedChild(0)` and so saw NEITHER,
      // which is why its first run reported `errorSiblingBefore 2` and missed the
      // shape round 3 already named. An instrument that walks a different population
      // than the code under test measures nothing; the analyzer's own selector is the
      // only defensible one, and it is copied here rather than re-derived.
      const cn = commandNameNodeOf(n)
      if (cn) {
        const name = cn.text
        list.push({
          line: cn.startPosition.row + 1,
          name,
          shape: classify(n),
          text: n.text.length > 120 ? n.text.slice(0, 120) + "..." : n.text,
        })
      }
    }
    for (let j = n.childCount - 1; j >= 0; j--) {
      const c = n.child(j)
      if (c) stack.push(c)
    }
  }
  sites.set(`${f.repo}/${f.rel}`, list)
  tree.delete?.()
}
console.log(`command nodes carrying a command_name among their named children: ${commands}`)

/**
 * Every published `calls` edge whose target NAME is ambiguous in its own file and which
 * publishes no `targetResolution`, with the shape of the command it came from.
 *
 * The candidate set is the file's own published symbols — the condition
 * `probe-bash-published-resolvability.mts` applies — and the shape is looked up by
 * (line, name), which is what the analyzer itself keys its own attribution on.
 */
type Row = { shape: Shape; examples: string[]; external: number; local: number }
const rows = new Map<Shape, Row>()
const get = (s: Shape): Row => {
  let r = rows.get(s)
  if (!r) {
    r = { shape: s, examples: [], external: 0, local: 0 }
    rows.set(s, r)
  }
  return r
}

/**
 * THE COST OF EACH GUARD, over EVERY published `calls` edge rather than over the 5 that
 * are ambiguous. This is the number that decides a guard: a rule is only worth having
 * if what it removes is dominated by fabrications. Round 3 rejected guard B on exactly
 * this arithmetic (96 removals of which 15 were real `kube::log::status` calls), and a
 * count of the ambiguous population alone cannot see a guard's cost at all.
 *
 * `removed` counts edges the guard would suppress. `fabrication` is a READ of the
 * command text by a reader, not an automated verdict: the examples are printed so the
 * claim can be checked by hand, which is what round 3's table did.
 */
const cost = new Map<Shape, { total: number; removed: number; examples: string[] }>()
const getCost = (s: Shape) => {
  let r = cost.get(s)
  if (!r) {
    r = { total: 0, removed: 0, examples: [] }
    cost.set(s, r)
  }
  return r
}

let bareTotal = 0
for (const f of sample) {
  let p: any
  try {
    p = await parseFile(f.abs, f.dir)
  } catch {
    parseFailures++
    continue
  }
  if (!p || p.success === false || !Array.isArray(p.symbols)) continue
  const byName = new Map<string, any[]>()
  for (const s of p.symbols) {
    const n = String(s?.name ?? "")
    if (!n) continue
    const l = byName.get(n) ?? []
    l.push({ line: Number(s.startLine ?? 0), kind: String(s.kind ?? "") })
    byName.set(n, l)
  }
  const fileSites = sites.get(`${f.repo}/${f.rel}`) ?? []
  for (const r of p.relationships ?? []) {
    if (String(r.type ?? "") !== "calls") continue
    const meta = (r.metadata ?? {}) as Record<string, unknown>
    const tgt = String(r.target ?? "")
    const line0 = Number(r.line_number ?? 0)
    const site0 = fileSites.find((s) => s.line === line0 && s.name === tgt)

    // ---- cost of each candidate guard, over EVERY published calls edge ----
    if (site0 && site0.shape !== "clean") {
      const c = getCost(site0.shape)
      c.total++
      c.removed++
      if (c.examples.length < EXAMPLES) {
        c.examples.push(`${f.repo}/${f.rel}:${line0} -> ${tgt}  ${JSON.stringify(site0.text)}`)
      }
    } else {
      getCost("clean").total++
    }

    if (typeof meta.targetResolution === "string" && meta.targetResolution.length > 0) continue
    const cands = byName.get(tgt)
    if (!cands || cands.length < 2) continue // not ambiguous: not this population
    bareTotal++
    const line = Number(r.line_number ?? 0)
    const site = fileSites.find((s) => s.line === line && s.name === tgt)
    const shape: Shape = site ? site.shape : "clean"
    const row = get(shape)
    if (meta.isFunctionCall === true) row.local++
    else row.external++
    if (row.examples.length < EXAMPLES) {
      row.examples.push(
        `${f.repo}/${f.rel}:${line} -> ${tgt} against ${cands.map((c) => `${c.kind}@${c.line}`).join(" ")}` +
          (site ? `\n        cmd ${JSON.stringify(site.text)}` : "\n        (no command node at this line/name)"),
      )
    }
  }
}

console.log(`\n=== COST OF EACH CANDIDATE GUARD, over EVERY published \`calls\` edge ===`)
console.log(`A guard is only worth having if what it removes is dominated by fabrications.`)
console.log(`shape                 calls edges   a guard would remove   examples`)
console.log("-".repeat(110))
for (const s of ["clean", "errorDescendant", "errorSiblingBefore", "both"] as Shape[]) {
  const c = cost.get(s)
  if (!c) continue
  console.log(`${s.padEnd(22)}${String(c.total).padStart(11)}${String(c.removed).padStart(23)}`)
  for (const e of c.examples) console.log(`      ${e}`)
}

console.log(`\nbare ambiguous \`calls\` edges: ${bareTotal}\n`)
for (const s of ["errorDescendant", "both", "errorSiblingBefore", "clean"] as Shape[]) {
  const r = rows.get(s)
  if (!r) continue
  console.log(`--- shape ${s}: ${r.external + r.local} edges  (isFunctionCall true ${r.local} / false ${r.external})`)
  for (const e of r.examples) console.log(`    ${e}`)
  console.log()
}
console.log(`parse failures: ${parseFailures}`)