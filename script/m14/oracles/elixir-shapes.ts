/**
 * ELIXIR_EXPORTS — shape dumper. Prints the tree-sitter node shapes of the
 * constructs the four silent types would be read from, so the extractor is
 * written against the grammar's real shape rather than a guess about it.
 *
 * NO REGEX: text tests are indexOf / charCode comparisons.
 *
 * CLI: npx tsx script/m14/oracles/elixir-shapes.ts <identifier> [maxHits]
 *      npx tsx script/m14/oracles/elixir-shapes.ts '*defmodule*'   (prefix)
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = process.env.BB_LANE_ROOT ?? path.resolve(process.cwd())
const CORPUS = process.env.BB_CORPUS ?? "$HOME/fixtures/repositories"
const WANT = process.argv[2] ?? "defoverridable"
const MAX = Number(process.argv[3] ?? 6)
const prefix = WANT.endsWith("*")
const needle = prefix ? WANT.slice(0, -1) : WANT

function walkFiles(dir: string, out: string[] = []): string[] {
  let ents: fs.Dirent[]
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of ents) {
    if ([".git", "_build", "deps", "node_modules"].indexOf(e.name) !== -1) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, out)
    else if (e.name.endsWith(".ex") || e.name.endsWith(".exs")) out.push(p)
  }
  return out
}

function render(n: any, depth: number, lines: string[]) {
  if (depth > 4) return
  const text = n.text.length > 46 ? n.text.slice(0, 46) + "…" : n.text
  lines.push(`${"  ".repeat(depth)}${n.type}${n.isNamed ? "" : " (anon)"} ${JSON.stringify(text)}`)
  for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) render(c, depth + 1, lines) }
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new ParserClass()
  parser.setLanguage(await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-elixir.wasm"))))

  const dir = path.join(CORPUS, "elixir")
  let hits = 0
  for (const f of walkFiles(dir).sort()) {
    if (hits >= MAX) break
    const src = fs.readFileSync(f, "utf8")
    const tree = parser.parse(src)
    const stack: any[] = [tree.rootNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      let match = false
      if (n.type === "call") {
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c && c.type === "identifier") {
            const t = c.text
            match = prefix ? t.indexOf(needle) === 0 : t === needle
            break
          }
        }
      }
      if (match) {
        hits++
        console.log(`\n--- ${path.relative(dir, f)}:${n.startPosition.row + 1} (hit ${hits})`)
        const lines: string[] = []
        render(n, 0, lines)
        console.log(lines.join("\n"))
        if (hits >= MAX) break
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
  }
  console.log(`\n${hits} hit(s) of ${WANT}`)
}
main().catch((e) => { console.error(String(e && e.stack ? e.stack : e)); process.exit(1) })