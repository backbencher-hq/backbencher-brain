/**
 * R7 ORIGIN PROBE — where does each placeholder-sourced edge actually come from?
 *
 * ## Why this exists
 *
 * `rust-r7-audit.ts` counted the problem: 1,280 of 29,660 ripgrep edges name a
 * placeholder literal on their SOURCE, and `global` is 1,169 of them. A count says
 * how much; it does not say WHY, and the fix differs completely by cause:
 *
 *   - an edge inside a `macro_rules!` RULE BODY has no enclosing declaration
 *     because the body is a template, not code — there is no honest name for it,
 *     and the fix is to refuse the edge;
 *   - an edge in a `const`/`static` initializer DOES have a nameable owner (the
 *     const), and the fix is to attribute it there;
 *   - an edge at file scope with no `mod` around it has no owner at all, and the
 *     family's answer is the FILE-level spelling, not a placeholder.
 *
 * Guessing between those three is how an analyzer ships a fabrication. So this
 * probe reads the tree at the edge's OWN line and reports the enclosing
 * declaration kind, which is a fact about the grammar rather than a guess.
 *
 * ## The instrument
 *
 * `getParser` -> `parser.parse` -> `analyze` over the same derived population as
 * `rust-r7-audit.ts`, which is the production path firing-check-v2 grades. This
 * probe needs the TREE and the EDGES from the same parse, and `ParseResult` does not
 * carry the tree (pool-worker drops it), so it takes them together here rather than
 * parsing twice and hoping the two trees agree. `rust-r7-audit.ts` independently
 * measures the same population through `parseFile` and its edge counts agree with
 * this probe's, which is the check that the two entries do not diverge.
 *
 * For every edge whose `source` or `target` is a declared placeholder literal, it
 * walks the tree down to the smallest node whose span contains that edge's
 * `line_number`, then walks UP to the nearest declaration, recording that node's
 * `type`. The histogram is over (edgeType, side, placeholderName,
 * enclosingDeclaration) tuples — the unit a fix acts on.
 *
 * ## NO REGULAR EXPRESSION
 *
 * Every classification is a Set membership test, `startsWith`, `endsWith`,
 * `charCodeAt`, or a tree walk. The `for` loop over declarations is bounded by the
 * node's own child count. There is no pattern matching over source text anywhere in
 * this file.
 *
 * READ-ONLY. Writes nothing.
 *
 * Run: npx tsx script/incoming-rust/rust-r7-origin.ts [--repo=ripgrep] [--json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { getParser } from "../../src/ast/engine"
import { RealRustAnalyzer } from "../../src/ast/real-rust-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const ARGS = process.argv.slice(2)
const WANT_JSON = ARGS.includes("--json")
const REPO_FILTER = ARGS.find((a) => a.startsWith("--repo="))?.slice(7)

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports",
  "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

/** The literals this lane declared as placeholders. Same list, same order. */
const PLACEHOLDERS = new Set([
  "unknown", "<unknown>", "*", "module", "global", "root", "program",
  "<unnamed>", "unnamed", "anonymous", "anonymous_impl", "<anonymous>",
  "self", "Self", "this", "super", "crate", "mod", "null", "nil",
  "undefined", "none", "None", "default", "placeholder", "<placeholder>",
  "n/a", "N/A", "<none>", "?", "-", "external", "External",
])

/** Node types that DECLARE a name and can therefore own an edge's source. */
const DECLARATION_NODES = new Set([
  "function_item", "function_signature_item", "mod_item", "struct_item",
  "union_item", "enum_item", "trait_item", "impl_item", "macro_definition",
  "const_item", "static_item", "type_item", "associated_type", "source_file",
])

interface Bucket { type: Type; side: "src" | "tgt"; name: string; owner: string; n: number; files: Set<string>; examples: string[] }
const buckets = new Map<string, Bucket>()

// ---------------------------------------------------------------- population
const files: { repo: string; dir: string; rel: string; abs: string }[] = []
for (const e of readdirSync(CR)) {
  if (REPO_FILTER && e !== REPO_FILTER) continue
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
    try { if (statSync(abs).size > 2 * 1024 * 1024) continue } catch { continue }
    if (detectLanguageFromPath(abs, "") !== "rust") continue
    files.push({ repo: e, dir, rel, abs })
  }
}
files.sort((a, b) => (a.repo + a.rel < b.repo + b.rel ? -1 : 1))

// ---------------------------------------------------------------- per-file
let edgesTotal = 0, placeholderEdges = 0, noLineCount = 0
const filesWithPlaceholder = new Set<string>()
let idx = 0
const failures: string[] = []

const parser = await getParser("rust")
const analyzer = new RealRustAnalyzer()

/** Byte offset of the START of 1-based `line`, or -1. A line is a RANGE of
 *  offsets and the analyzer recorded only its number, so the line's first byte
 *  is the only unambiguous point available.
 *
 *  The loop runs `line - 1` times, not `line`: line 1 starts at byte 0, so
 *  reaching line 5 means skipping FOUR newlines. Running it five times landed on
 *  the start of line 6, which moved every attribution forward by one line — and
 *  at a declaration BOUNDARY that is the difference between "inside this const"
 *  and "the whitespace after it", which is what made 359 call edges read as
 *  `source_file` when they are all `static`/`const` initializers. A probe that
 *  reports a plausible histogram built on a wrong offset is worse than one that
 *  reports nothing. */
function lineStartOffset(content: string, line: number): number {
  if (!line || line < 1) return -1
  let acc = 0
  for (let k = 1; k < line; k++) {
    const nl = content.indexOf("\n", acc)
    if (nl < 0) return -1
    acc = nl + 1
  }
  return acc
}

/** Smallest node whose byte span contains `offset`, by walking children. */
function smallestAt(root: any, offset: number): any {
  if (!root || offset < 0) return null
  let n = root
  let guard = 0
  while (guard++ < 4096) {
    let next: any = null
    for (let k = 0; k < n.childCount; k++) {
      const c = n.child(k)
      if (c && c.startIndex <= offset && offset < c.endIndex) { next = c; break }
    }
    if (!next || next === n) break
    n = next
  }
  return n
}

/** The smallest node on 1-based `line`, or null when the line cannot be located. */
function smallestNodeAtLine(root: any, content: string, line: number): any {
  const off = lineStartOffset(content, line)
  if (off < 0) return null
  return smallestAt(root, off)
}

async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    const label = `${f.repo}/${f.rel}`
    let content: string
    try { content = readFileSync(f.abs, "utf8") } catch { failures.push(label); continue }
    let tree: any
    let res: any
    try {
      tree = await parser.parse(content, f.abs)
      res = analyzer.analyze(tree.rootNode, content, f.abs)
    } catch { failures.push(label); continue }

    const root = tree?.rootNode as any
    /** The nearest DECLARATION ancestor of the smallest node at `line`. */
    const ownerAt = (line: number): string => {
      const n = smallestNodeAtLine(root, content, line)
      if (!n) return "no-tree-or-line"
      let cur: any = n
      let guard = 0
      while (cur && guard++ < 1024) {
        if (DECLARATION_NODES.has(cur.type)) return cur.type
        cur = cur.parent
      }
      return "unowned"
    }
    /** `smallestNodeAtOffset:enclosingDeclaration`, for an addressable example. */
    const describeAt = (r: any, line: number): string => {
      const n = smallestNodeAtLine(r, content, line)
      if (!n) return "?"
      const owner = ownerAt(line)
      return `${n.type}<-${owner}`
    }

    for (const rel of res?.relationships ?? []) {
      const t = String(rel?.type ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) continue
      edgesTotal++
      const line = typeof rel?.line_number === "number" ? rel.line_number : undefined
      const sides: Array<["src" | "tgt", string]> = [
        ["src", String(rel?.source ?? "")],
        ["tgt", String(rel?.target ?? "")],
      ]
      let anyHit = false
      for (const [side, name] of sides) {
        if (!PLACEHOLDERS.has(name)) continue
        anyHit = true
        const owner = ownerAt(line as number)
        if (!line) noLineCount++
        const key = `${t}|${side}|${name}|${owner}`
        let b = buckets.get(key)
        if (!b) { b = { type: t, side, name, owner, n: 0, files: new Set(), examples: [] }; buckets.set(key, b) }
        b.n++
        b.files.add(label)
        // Up to 3 concrete sites per bucket. A histogram without an addressable
        // example forces the next reader to re-derive the cause by hand, and the
        // whole point of this probe is to make the cause readable.
        if (b.examples.length < 3) {
          b.examples.push(`${label}:${line ?? 0} in ${tree?.rootNode ? describeAt(root, line as number) : "?"} | ${name}`)
        }
      }
      if (anyHit) { placeholderEdges++; filesWithPlaceholder.add(label) }
    }
    // RUST-D21: the wasm tree is NOT freed without an explicit delete, so one
    // retained tree per file exhausts the heap and a census that prints at the END
    // produces no output at all. It is released HERE, after the last read of it —
    // an earlier shape deleted it before walking, and every attribution came back
    // `no-tree-or-line`, which is a number about a freed tree and not about Rust.
    tree?.delete?.()
  }
}
await Promise.all(Array.from({ length: 1 }, () => worker()))

const rows = [...buckets.values()].sort((a, b) => b.n - a.n)
const byType = new Map<Type, number>()
const byOwner = new Map<string, number>()
for (const b of rows) {
  byType.set(b.type, (byType.get(b.type) ?? 0) + b.n)
  byOwner.set(b.owner, (byOwner.get(b.owner) ?? 0) + b.n)
}

const report = {
  population: { root: CR, repos: [...new Set(files.map((f) => f.repo))], files: files.length },
  edgesTotal,
  placeholderEdges,
  filesWithPlaceholder: filesWithPlaceholder.size,
  edgesWithNoLine: noLineCount,
  parseFailures: failures,
  byType: Object.fromEntries(byType),
  byOwner: Object.fromEntries(byOwner),
  buckets: rows.map((b) => ({ type: b.type, side: b.side, name: b.name, owner: b.owner, edges: b.n, files: [...b.files].slice(0, 5), examples: b.examples })),
}

if (WANT_JSON) {
  console.log(JSON.stringify(report, null, 1))
} else {
  console.log(`R7 origin — ${files.length} files in [${report.population.repos.join(", ")}]`)
  console.log(`  edges ${edgesTotal} · with a placeholder endpoint ${placeholderEdges} in ${filesWithPlaceholder.size} files · parse failures ${failures.length}`)
  console.log(`  placeholder edges carrying no line_number: ${noLineCount}\n`)
  console.log(`${"type".padEnd(13)}${"edges".padStart(8)}  (edges having >=1 placeholder endpoint)`)
  console.log("-".repeat(60))
  for (const [t, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) console.log(`${t.padEnd(13)}${String(n).padStart(8)}`)
  console.log(`\n${"enclosing declaration at the edge's own line".padEnd(46)}${"edges".padStart(8)}`)
  console.log("-".repeat(60))
  for (const [o, n] of [...byOwner.entries()].sort((a, b) => b[1] - a[1])) console.log(`${o.padEnd(46)}${String(n).padStart(8)}`)
  console.log(`\n${"type".padEnd(13)}${"side".padEnd(5)}${"name".padEnd(15)}${"owner".padEnd(20)}${"edges".padStart(8)}${"files".padStart(7)}`)
  console.log("-".repeat(76))
  for (const b of rows) console.log(`${b.type.padEnd(13)}${b.side.padEnd(5)}${b.name.padEnd(15)}${b.owner.padEnd(20)}${String(b.n).padStart(8)}${String(b.files.size).padStart(7)}`)
}