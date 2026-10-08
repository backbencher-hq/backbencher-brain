/**
 * ELIXIR_EXPORTS — dump every `defoverridable` site on the corpus with its form
 * and its source line, so the 26-site tally can be read by a human rather than
 * trusted. Also reports, per marked name/arity, whether the marked function is
 * actually DEFINED in the same file — which is the precondition for the
 * `overrides` edge (an override needs a prior declaration to override).
 *
 * NO REGEX. CLI: npx tsx script/m14/oracles/elixir-defoverridable-sites.ts
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = process.env.BB_LANE_ROOT ?? path.resolve(process.cwd())
const DIR = path.join(process.env.BB_CORPUS ?? "$HOME/fixtures/repositories", "elixir")

function walk(dir: string, out: string[] = []): string[] {
  let e: fs.Dirent[]
  try { e = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const x of e) {
    if ([".git", "_build", "deps", "node_modules"].indexOf(x.name) !== -1) continue
    const p = path.join(dir, x.name)
    if (x.isDirectory()) walk(p, out)
    else if (x.name.endsWith(".ex") || x.name.endsWith(".exs")) out.push(p)
  }
  return out
}
function childOfType(n: any, t: string): any {
  for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && c.type === t) return c }
  return null
}
function idOf(call: any): string { const i = childOfType(call, "identifier"); return i ? i.text : "" }

/** Collapse runs of whitespace with a char scan — no regex (rule 1). */
function squeeze(s: string): string {
  let out = ""
  let space = false
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const ws = c === 32 || c === 9 || c === 10 || c === 13
    if (ws) { space = true; continue }
    if (space && out.length > 0) out += " "
    space = false
    out += s[i]
  }
  return out
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new ParserClass()
  parser.setLanguage(await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-elixir.wasm"))))

  let sites = 0, markedPairs = 0, moduleForms = 0, otherForms = 0
  const rows: string[] = []
  for (const f of walk(DIR).sort()) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser.parse(src)
    // Pass 1: every def name/arity declared in the file, with its line.
    const declared = new Map<string, number>()
    const stack: any[] = [tree.rootNode]
    const overridables: { line: number; kind: string; entries: string[]; text: string }[] = []
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "call") {
        const id = idOf(n)
        if (id === "def" || id === "defp" || id === "defmacro" || id === "defmacrop" || id === "defguard" || id === "defguardp" || id === "defdelegate") {
          const args = childOfType(n, "arguments")
          if (args) {
            const first = args.namedChildCount > 0 ? args.namedChild(0) : null
            const sig = first ?? args
            let nm = ""
            let arity = 0
            if (sig && sig.type === "call") {
              const iid = childOfType(sig, "identifier"); nm = iid ? iid.text : ""
              const a = childOfType(sig, "arguments"); if (a) arity = a.namedChildCount
            } else if (sig && sig.type === "identifier") nm = sig.text
            if (nm && !declared.has(`${nm}/${arity}`)) declared.set(`${nm}/${arity}`, n.startPosition.row + 1)
          }
        } else if (id === "defoverridable") {
          const args = childOfType(n, "arguments")
          const inner = args && args.namedChildCount > 0 ? args.namedChild(0) : null
          const entries: string[] = []
          let kind = "other"
          if (inner && inner.type === "alias") { kind = "module"; moduleForms++; entries.push(inner.text) }
          else if (inner && inner.type === "keywords") {
            kind = "keywords"
            for (let i = 0; i < inner.namedChildCount; i++) {
              const pair = inner.namedChild(i)
              if (!pair || pair.type !== "pair") continue
              const kw = childOfType(pair, "keyword")
              const colon = kw ? kw.text.indexOf(":") : -1
              const nm = kw ? (colon >= 0 ? kw.text.slice(0, colon) : kw.text) : ""
              let ar = -1
              for (let j = 0; j < pair.namedChildCount; j++) { const v = pair.namedChild(j); if (v && v.type === "integer") { ar = Number(v.text); break } }
              if (nm) entries.push(`${nm}/${ar}`)
            }
            markedPairs += entries.length
          } else { otherForms++; entries.push(inner ? `${inner.type}:${inner.text.slice(0, 30)}` : "empty") }
          overridables.push({ line: n.startPosition.row + 1, kind, entries, text: squeeze(n.text).slice(0, 60) })
          sites++
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
    for (const o of overridables) {
      const local = o.entries.map((e) => `${e}${declared.has(e) ? "" : " (NOT DEFINED HERE)"}`)
      rows.push(`${path.relative(DIR, f)}:${o.line} [${o.kind}] ${local.join(" ")}  | ${o.text}`)
    }
  }
  console.log(rows.join("\n"))
  console.log(`\nsites=${sites}  name/arity pairs marked=${markedPairs}  module forms=${moduleForms}  other forms=${otherForms}`)
  const notDefined = rows.filter((r) => r.indexOf("NOT DEFINED HERE") !== -1).length
  console.log(`rows whose marked name/arity has no same-file definition: ${notDefined}`)
}
main().catch((e) => { console.error(String(e && e.stack ? e.stack : e)); process.exit(1) })