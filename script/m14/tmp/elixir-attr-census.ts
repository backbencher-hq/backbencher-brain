/**
 * ELIXIR lane — Master Review census for two gaps the per-site audit exposed:
 *
 *   GAP A  `alias Mod.{lower, case_members}` — the multi-alias expander only
 *          accepts `alias`/`dot` members, so LOWERCASE members (function and
 *          atom aliases) yield zero dependency edges.
 *   GAP B  module attribute VALUES are compile-time CODE in Elixir, but every
 *          extraction site is gated by `isInAttribute`, so a struct literal or
 *          a call inside `@foo ...` is silent. Categorised by attribute name so
 *          the declared-silence attributes (doc/spec/type/callback/behaviour/
 *          derive) are counted separately from real code.
 *
 * Usage: npx tsx script/m14/tmp/elixir-attr-census.ts --repo=ecto_sql --sample=60
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/sano/ishaq/backbencher-brain"
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const REPO = arg("repo") ?? "ecto_sql"
const SAMPLE = Number(arg("sample") ?? "60")
const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"

// Attributes whose VALUE is a declaration, not a call site.
const DECL_ATTRS = new Set(["moduledoc", "doc", "spec", "type", "typep", "opaque", "callback", "macrocallback", "optional_callbacks", "behaviour", "behavior", "derive", "deprecated"])

const childOfType = (n: any, t: string) => { for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && c.type === t) return c } return null }

interface File { path: string; text: string }
function walkFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name === "_build" || e.name === "deps" || e.name === ".git" || e.name === "node_modules") continue; walkFiles(p, out) }
    else if (/\.(ex|exs)$/.test(e.name)) out.push(p)
  }
  return out
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts, L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-elixir.wasm")))
  const parser = new P(); parser.setLanguage(g)

  const files = walkFiles(path.join(CORPUS, REPO)).sort()
  const take = files.slice(0, SAMPLE)
  let gapA = 0, gapAUpper = 0
  const gapBByAttr = new Map<string, number>()
  let gapBSites = 0, structSites = 0, callSites = 0
  const examples: string[] = []

  for (const file of take) {
    const text = fs.readFileSync(file, "utf8")
    const root = parser.parse(text).rootNode
    const rel = path.relative(path.join(CORPUS, REPO), file)
    // GAP A
    const stackA: any[] = [root]
    while (stackA.length) {
      const n = stackA.pop()
      if (n.type === "call") {
        const id = childOfType(n, "identifier")
        if (id?.text === "alias") {
          const args = childOfType(n, "arguments")
          const dot = args ? childOfType(args, "dot") : null
          const tuple = dot ? childOfType(dot, "tuple") : null
          if (tuple) {
            const lower: string[] = [], upper: string[] = []
            for (let i = 0; i < tuple.namedChildCount; i++) {
              const k = tuple.namedChild(i); if (!k) continue
              if (k.type === "alias" || k.type === "identifier") (k.type === "alias" ? upper : lower).push(k.text)
              else if (k.type === "dot") upper.push(k.text)
            }
            if (lower.length > 0) { gapA++; if (examples.length < 12) examples.push(`A ${rel}:${n.startPosition.row + 1} alias ${dot!.text}`) }
            gapAUpper += upper.length
          }
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stackA.push(c) }
    }
    // GAP B: value of a module attribute
    const stackB: any[] = [root]
    while (stackB.length) {
      const n = stackB.pop()
      if (n.type === "unary_operator" && n.child(0)?.text === "@" && n.child(1)) {
        const inner = n.child(1)
        let attrName = inner.type === "call" ? (childOfType(inner, "identifier")?.text ?? "") : (inner.type === "identifier" ? inner.text : "")
        if (attrName === "moduledoc" || attrName === "doc") attrName = childOfType(inner, "call")?.text ?? attrName
        if (!DECL_ATTRS.has(attrName)) {
          // walk the VALUE subtree only
          const vstack: any[] = []
          if (inner.type === "call") { const args = childOfType(inner, "arguments"); if (args) for (let i = 0; i < args.namedChildCount; i++) { const c = args.namedChild(i); if (c) vstack.push(c) } }
          else vstack.push(inner)
          let structs = 0, calls = 0
          while (vstack.length) {
            const v = vstack.pop()
            if (v.type === "map" && childOfType(v, "struct")) structs++
            if (v.type === "call") { const id = childOfType(v, "identifier"); const t = v.child(1)?.type === "dot" ? v.child(1).text : (id?.text ?? ""); if (t && t[0] >= "A" && t[0] <= "Z") calls++ }
            for (let i = v.namedChildCount - 1; i >= 0; i--) { const c = v.namedChild(i); if (c) vstack.push(c) }
          }
          if (structs > 0 || calls > 0) {
            gapBSites++
            structSites += structs; callSites += calls
            const k = attrName || "(bare @x)"
            gapBByAttr.set(k, (gapBByAttr.get(k) ?? 0) + 1)
            if (examples.length < 20) examples.push(`B ${rel}:${n.startPosition.row + 1} @${k} structs=${structs} calls=${calls}`)
          }
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stackB.push(c) }
    }
  }
  const top = [...gapBByAttr.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18)
  console.log(`\n######## ATTRIBUTE/ALIAS CENSUS — repo=${REPO} files=${take.length}`)
  console.log(`GAP A  multi-alias with LOWERCASE members (zero dep edges today): ${gapA}   [uppercase members already covered: ${gapAUpper}]`)
  console.log(`GAP B  module attributes whose VALUE is compile-time code: ${gapBByAttr.size ? [...gapBByAttr.values()].reduce((a, b) => a + b, 0) : 0} attributes, ${structSites} struct literals, ${callSites} qualified calls`)
  console.log(`      by attribute name:`)
  for (const [k, v] of top) console.log(`        ${String(v).padStart(4)}  @${k}`)
  for (const e of examples) console.log(`      ${e}`)
}
main()
