/**
 * F8 — the VB node-type census.
 *
 * The claim under test is narrow and checkable: **every node type the grammar
 * produces over a real corpus is accounted for.** The analyzer classifies types
 * into two sets, `DECLARATION_NODES` (a symbol is published) and
 * `SILENT_INTERNAL` (consumed structurally, nothing published). A type in
 * neither is an unclassified construct, and this counts them.
 *
 * Why this exists as a gate rather than a comment: the two worst defects this
 * lane has had were both *classification* errors, and neither was visible to
 * any other check.
 *
 *   - `array_creation_expression` is not a declaration and is not silent: it
 *     carries the constructed type in a `type` field, and the callee was being
 *     read from a `function` field the node does not have. Every
 *     `New Foo(a, b)` in the language therefore published no `calls` edge --
 *     15,577 of them. The symbol and relationship counts were healthy
 *     throughout; only a differential that derived `calls` independently could
 *     see it, and the first one did not, because its oracle made the same
 *     assumption.
 *   - `implements_member_clause` was filed under `SILENT_INTERNAL`, which is a
 *     declaration of fact: "this node carries nothing". It carries a
 *     relationship. The whole member-level heritage form was therefore
 *     uncollected on every member in the language, and 17 of the 23 rows a
 *     full-corpus sweep reported as missing were this one node type.
 *
 * Both were found by accident, by a sweep that happened to draw the right file.
 * A census turns "we looked" into a number.
 *
 * What it does NOT claim: that a classification is CORRECT, only that one
 * exists. `SILENT_INTERNAL` is a judgement, and the sharp version of this gate
 * is the hand triage of the unclassified list, which is why the report prints a
 * source line per type -- the reviewer has to look at the construct, not the
 * count.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join } from "node:path"
import { Parser, Language } from "web-tree-sitter"

/** The analyzer's own sets, read from source so the gate cannot drift from it. */
type Sets = Record<string, Set<string>>
const SET_NAMES = ["DECLARATION_NODES", "RELATIONSHIP_SOURCES", "RELATIONSHIP_CANDIDATES", "SILENT_INTERNAL"]

function readSetsFromAnalyzer(src: string): Sets {
  const grab = (name: string): Set<string> => {
    const i = src.indexOf(`static readonly ${name}`)
    if (i < 0) throw new Error(`could not find ${name} in the analyzer source`)
    const open = src.indexOf("[", i)
    const close = src.indexOf("])", open)
    if (open < 0 || close < 0) throw new Error(`could not find the body of ${name}`)
    return new Set([...src.slice(open, close).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]))
  }
  const out: Sets = {}
  for (const n of SET_NAMES) out[n] = grab(n)
  return out
}

/**
 * `ERROR` is not a node TYPE -- it is the parser's name for a span it could not
 * read, and the count is a parse-health number rather than a classification
 * question. Filing it as "unclassified" would have swamped the report (86,945 of
 * them, more than any real type) and would have been true in the way a
 * thermometer is true when it is in the oven.
 */
const NOT_A_TYPE = new Set(["ERROR"])

const ANALYZER_SRC = process.env.BB_VB_ANALYZER ?? "src/ast/real-vb-analyzer.ts"
const WASM = process.env.BB_VB_WASM ?? "wasm/tree-sitter-vbnet.wasm"
const CORE = process.env.BB_TS_CORE ?? "wasm/tree-sitter.wasm"
const ROOTS = (process.env.BB_VB_ROOTS ?? "$HOME/fixtures/vb-corpus").split(",").filter(Boolean)

async function main() {
  const sets = readSetsFromAnalyzer(readFileSync(ANALYZER_SRC, "utf8"))
  await Parser.init({ locateFile: () => CORE, wasmBinary: readFileSync(CORE) })
  const lang = await Language.load(WASM)
  const parser = new Parser()
  parser.setLanguage(lang as any)

  const files: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else if (p.endsWith(".vb")) files.push(p)
    }
  }
  for (const r of ROOTS) if (existsSync(r)) walk(r)
  files.sort()

  const counts = new Map<string, number>()
  const example = new Map<string, { file: string; line: number; text: string }>()
  let errored = 0
  for (const f of files) {
    let tree: any
    try {
      tree = parser.parse(readFileSync(f, "utf8"))
    } catch {
      errored++
      continue
    }
    if (!tree) { errored++; continue }
    const stack: any[] = [tree.rootNode]
    const seen = new Set<any>()
    while (stack.length) {
      const n = stack.pop()
      if (!n || seen.has(n)) continue
      seen.add(n)
      // NAMED nodes only. Anonymous tokens are punctuation and keywords, and
      // counting them would make every grammar's census meaningless.
      if (n.isNamed) {
        const t = n.type
        counts.set(t, (counts.get(t) ?? 0) + 1)
        if (!example.has(t)) {
          const line = n.startPosition.row + 1
          example.set(t, {
            file: f,
            line,
            text: (readFileSync(f, "utf8").split("\n")[line - 1] ?? "").trim().slice(0, 110),
          })
        }
      }
      for (let i = n.childCount - 1; i >= 0; i--) {
        const c = n.child(i)
        if (c) stack.push(c)
      }
    }
    tree.delete?.()
  }

  const total = [...counts.values()].reduce((a, b) => a + b, 0)
  const errors = counts.get("ERROR") ?? 0
  const buckets: Record<string, string[]> = { DECLARATION_NODES: [], RELATIONSHIP_SOURCES: [], RELATIONSHIP_CANDIDATES: [], SILENT_INTERNAL: [], UNCLASSIFIED: [] }
  for (const t of [...counts.keys()].sort()) {
    if (NOT_A_TYPE.has(t)) continue
    const set = SET_NAMES.find((n) => sets[n].has(t))
    buckets[set ?? "UNCLASSIFIED"].push(t)
  }
  const declared = buckets.DECLARATION_NODES
  const silent = buckets.SILENT_INTERNAL
  const unclassified = buckets.UNCLASSIFIED

  console.log(`F8 vb node-type census`)
  console.log(`  files                    ${files.length}${errored ? ` (${errored} unreadable)` : ""}`)
  console.log(`  named nodes              ${total.toLocaleString()}`)
  console.log(`  distinct named types     ${counts.size - NOT_A_TYPE.size} (excluding ${[...NOT_A_TYPE].join(",")})`)
  console.log(`  parse ERROR nodes        ${errors.toLocaleString()}  <- parse health, not a classification`)
  console.log(`  classified               ${declared.length} declaration + ${buckets.RELATIONSHIP_SOURCES.length} relationship source + ${buckets.RELATIONSHIP_CANDIDATES.length} candidate + ${silent.length} silent = ${declared.length + buckets.RELATIONSHIP_SOURCES.length + buckets.RELATIONSHIP_CANDIDATES.length + silent.length}`)
  console.log(`  UNCLASSIFIED             ${unclassified.length}`)
  console.log("")
  if (unclassified.length) {
    console.log(`UNCLASSIFIED node types — each needs a hand decision, not a count:`)
    console.log("")
    for (const t of unclassified) {
      const e = example.get(t)!
      console.log(`  ${String(counts.get(t)).padStart(9)}  ${t}`)
      console.log(`             ${e.file}:${e.line}`)
      console.log(`             | ${e.text}`)
    }
  }
  console.log("")
  console.log(`RELATIONSHIP SOURCES (a relationship is derived from these): ${buckets.RELATIONSHIP_SOURCES.join(", ") || "none"}`)
  console.log(`RELATIONSHIP CANDIDATES (classified silent; a real relationship a future wave could derive): ${buckets.RELATIONSHIP_CANDIDATES.join(", ") || "none"}`)
  console.log("")
  console.log(`DECLARATION nodes that the corpus never produced (dead classification):`)
  const dead = [...sets.DECLARATION_NODES].filter((t) => !counts.has(t) && !NOT_A_TYPE.has(t)).sort()
  console.log(dead.length ? `  ${dead.join(", ")}` : "  none")
  console.log("")
  console.log(`SILENT_INTERNAL entries the corpus never produced: `)
  const deadSilent = [...sets.SILENT_INTERNAL].filter((t) => !counts.has(t)).sort()
  console.log(deadSilent.length ? `  ${deadSilent.join(", ")}` : "  none")

  // A gate that can pass on an empty corpus is not a gate. The first run of
  // this script found 0 files (a wrong default path) and printed
  // "all 0 node types in the corpus are classified" -- a vacuous pass, exit 0,
  // on the strength of having measured nothing. Refuse to conclude anything
  // without a corpus.
  if (files.length === 0) {
    console.error("\n0 files read: nothing was measured, so nothing can be concluded.")
    console.error(`Set BB_VB_ROOTS to a directory containing .vb files (tried: ${ROOTS.join(", ")}).`)
    process.exit(3)
  }

  if (unclassified.length > 0) {
    console.error(`\n${unclassified.length} UNCLASSIFIED node type(s). Every construct in the corpus must be declared or explicitly silent.`)
    process.exit(2)
  }
  console.log(`\nall ${counts.size - NOT_A_TYPE.size} node types in the corpus are classified (${counts.size - NOT_A_TYPE.size - unclassified.length} classified, ${unclassified.length} unclassified)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
