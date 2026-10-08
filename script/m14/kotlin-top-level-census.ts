/**
 * KOTLIN TOP-LEVEL DECLARATION CENSUS — the enumeration behind the `exports`
 * set definition.
 *
 * Before an `exports` edge can be specified, "what is a top-level declaration
 * in Kotlin" has to be an ENUMERATED set of grammar node types, not a
 * remembered list. The first version of the kotlin exports array used
 * class/interface/enum + top-level function + top-level property; if the
 * grammar has a fourth top-level declaration form and it is missing, the edge
 * is systematically blind to real API surface and no count will ever say so.
 *
 * So this enumerates the DISTRIBUTION of `source_file`'s named children over
 * the corpus, plus the distribution of parents for each declaration-ish node
 * type. It is a census, not a filter: it prints what it finds, and the verdict
 * is read off the print.
 *
 * NO REGEX — node.type and named-child inspection only.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.env.BB_ROOT || join(import.meta.dir, "..", "..")
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"
const REPOS = process.argv.slice(2).length ? process.argv.slice(2) : ["kotlin"]
const NFILES = Number(process.env.NFILES || 200)

const SIGNAL = ["fun ", "class ", "val ", "object "]

function pickFiles(dir: string, want: number): string[] {
  const all: string[] = []
  const walk = (d: string, depth: number) => {
    if (depth > 20) return
    let ents: any[]
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of [...ents].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const p = join(d, e.name)
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git" || e.name === "build") continue
        walk(p, depth + 1)
      } else if (e.name.endsWith(".kt") || e.name.endsWith(".kts")) {
        try {
          const st = statSync(p)
          if (st.size > 400_000 || st.size < 40) continue
          const src = readFileSync(p, "utf8")
          let hit = false
          for (const s of SIGNAL) if (src.includes(s)) { hit = true; break }
          if (hit) all.push(p)
        } catch {}
      }
    }
  }
  walk(dir, 0)
  if (all.length <= want) return all
  const stride = all.length / want
  const out: string[] = []
  for (let i = 0; i < want; i++) out.push(all[Math.floor(i * stride)])
  return out
}

const { getParser } = await import(`${ROOT}/src/ast/engine.ts`)
const parser = await getParser("kotlin")

/** Named children of a `source_file`, by node type. */
const topLevelTypes = new Map<string, number>()
/** For each node type that can be a declaration, the parent type it sits under. */
const parentOf = new Map<string, Map<string, number>>()
/** Nodes whose FIRST name-bearing identifier child is missing — a name the
 *  grammar does not carry. Any export rule keyed on a name must know these. */
const unnamed: Map<string, number> = new Map()
const perTypeVis = new Map<string, Map<string, number>>()
let files = 0
let decls = 0

const nameTypes = ["simple_identifier", "type_identifier", "identifier"]

function firstName(n: any): string | undefined {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && nameTypes.includes(c.type)) return c.text
  }
  return undefined
}

function visibilityOf(n: any): string {
  const stack: any[] = [n]
  let vis = "public"
  while (stack.length) {
    const x = stack.pop()
    if (x.type === "modifiers") {
      for (let i = 0; i < x.namedChildCount; i++) {
        const c = x.namedChild(i)
        const t = String(c?.text ?? "").trim()
        if (t === "private" || t === "protected" || t === "internal" || t === "public") { vis = t; break }
      }
    }
    for (let i = 0; i < x.namedChildCount; i++) {
      const c = x.namedChild(i)
      if (c && c.type !== "modifiers") stack.push(c)
    }
  }
  return vis
}

for (const repo of REPOS) {
  for (const f of pickFiles(join(CORPUS, repo), NFILES)) {
    const content = readFileSync(f, "utf8")
    let root: any
    try { root = (await parser.parse(content, f)).rootNode } catch { continue }
    files++
    const src = root
    for (let i = 0; i < src.namedChildCount; i++) {
      const c = src.namedChild(i)
      if (!c) continue
      topLevelTypes.set(c.type, (topLevelTypes.get(c.type) || 0) + 1)
    }
    // parent-of census + visibility per declaration type
    const stack: any[] = [root]
    while (stack.length) {
      const n = stack.pop()
      if (n.type !== "source_file" && n.type !== "ERROR") {
        decls++
        const pt = n.parent ? n.parent.type : "(root)"
        if (!parentOf.has(n.type)) parentOf.set(n.type, new Map())
        const m = parentOf.get(n.type)!
        m.set(pt, (m.get(pt) || 0) + 1)
        if (!firstName(n)) unnamed.set(n.type, (unnamed.get(n.type) || 0) + 1)
      }
      if (n.parent && n.parent.type === "source_file"
        && ["class_declaration", "object_declaration", "function_declaration", "property_declaration"].includes(n.type)) {
        if (!perTypeVis.has(n.type)) perTypeVis.set(n.type, new Map())
        const m = perTypeVis.get(n.type)!
        const v = visibilityOf(n)
        m.set(v, (m.get(v) || 0) + 1)
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }
}

const L: string[] = []
L.push("KOTLIN TOP-LEVEL DECLARATION CENSUS")
L.push(`corpus=${CORPUS} repos=${REPOS.join(",")} NFILES=${NFILES} files=${files} nodes visited=${decls}`)
L.push("")
L.push("source_file named children, by node type (the whole top-level vocabulary):")
for (const [t, n] of [...topLevelTypes.entries()].sort((a, b) => b[1] - a[1])) {
  L.push(`   ${t.padEnd(34)} ${String(n).padStart(7)}`)
}
L.push("")
L.push("declaration-shaped node types and the parents they sit under:")
const interesting = [...parentOf.entries()]
  .filter(([t, m]) => m.has("source_file") || t.includes("declaration") || t.includes("literal") || t.includes("alias"))
  .sort((a, b) => (b[1].get("source_file") || 0) - (a[1].get("source_file") || 0))
for (const [t, m] of interesting) {
  const tl = m.get("source_file") || 0
  const others = [...m.entries()].filter(([p]) => p !== "source_file").sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([p, n]) => `${p}:${n}`).join(" ")
  L.push(`   ${t.padEnd(34)} top-level=${String(tl).padStart(6)}  nested=${[...m.values()].reduce((a, b) => a + b, 0) - tl}   ${others}`)
}
L.push("")
L.push("declaration node types with NO name-bearing child (an export rule keyed on a name must skip or handle these):")
if (unnamed.size === 0) L.push("   (none)")
for (const [t, n] of [...unnamed.entries()].sort((a, b) => b[1] - a[1])) L.push(`   ${t.padEnd(34)} ${String(n).padStart(7)}`)
L.push("")
L.push("visibility of TOP-LEVEL declarations, per node type:")
for (const [t, m] of [...perTypeVis.entries()].sort((a, b) => b[1].size - a[1].size)) {
  const parts = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v}=${n}`).join(" ")
  L.push(`   ${t.padEnd(26)} ${parts}`)
}
console.log(L.join("\n"))