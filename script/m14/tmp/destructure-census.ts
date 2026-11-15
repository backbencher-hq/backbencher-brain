// How much does destructuring actually cost, per lane?
//
// The stated estimate was "~1,000 across the lanes I patched", from a count of
// `as X` / `as ns.X` binding forms found while reading tree-sitter import
// grammars — a filename-level grep, not a measurement. This measures it properly:
// parse real files, find every destructuring clause the grammar actually produces,
// and ask the only question that matters for the graph: is the binding site still
// present in the source after the alias was stripped?
//
// That last part is the cost. `import { type X as Y } from "m"` is a binding site
// in the file — Y is declared there, so `contains`/`references` should be able to
// reach it, and cross-file resolution should be able to name it. If the alias
// rewrite replaces the clause text with the leaf, that site disappears from the
// source while the symbol may still be published.
//
// Reports per lane: destructuring sites found, sites whose binding name survives
// the rewrite, and sites that vanish — plus one worked example per lane so a
// number can be read against real source.

import fs from "node:fs"
import path from "node:path"
import { LANGS, LANG_REPOS } from "../differential"

const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS = "/home/ishaq2321/bb_tests/repositories"

function walk(dir: string, exts: string[], cap: number): string[] {
  const out: string[] = []
  const stack = [dir]
  while (stack.length && out.length <= cap) {
    const cur = stack.pop()!
    let es: fs.Dirent[]
    try { es = fs.readdirSync(cur, { withFileTypes: true }) } catch { continue }
    for (const e of es) {
      if ([".git", "node_modules", "dist", "build", "target"].includes(e.name)) continue
      const p = path.join(cur, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (exts.some((x) => e.name.endsWith(x))) out.push(p)
    }
  }
  return out.sort().slice(0, cap)
}

// per grammar: the node types that carry a destructuring clause, and how to read
// the bound name out of one specifier
const GRAMMAR: Record<string, { clause: string[]; spec: string[]; alias: RegExp }> = {
  scala: { clause: ["import_specifier"], spec: ["identifier", "type_identifier", "wildcard_import", "given_import", "stable_identifier"], alias: /\bas\s+([A-Za-z_$][\w$]*)/ },
  kotlin: { clause: ["import_header", "import_list_entry"], spec: ["identifier", "type_identifier", "simple_identifier", "import_alias"], alias: /\bas\s+([A-Za-z_$][\w$]*)/ },
  java: { clause: [], spec: [], alias: /$/ },
  typescript: { clause: ["import_specifier", "namespace_import"], spec: ["identifier", "type_identifier", "shorthand_property_identifier_pattern"], alias: /\bas\s+([A-Za-z_$][\w$]*)/ },
  javascript: { clause: ["import_specifier", "namespace_import"], spec: ["identifier", "shorthand_property_identifier_pattern"], alias: /\bas\s+([A-Za-z_$][\w$]*)/ },
  python: { clause: ["import_from_statement", "aliased_import"], spec: ["dotted_name", "aliased_import", "identifier"], alias: /\bas\s+([A-Za-z_][\w]*)/ },
  rust: { clause: ["use_clause", "use_as_clause", "use_list", "scoped_use_list", "use_wildcard"], spec: ["use_as_clause", "scoped_identifier", "identifier", "use_as_clause"], alias: /\bas\s+([A-Za-z_][\w]*)/ },
  go: { clause: ["import_spec"], spec: ["import_spec", "interpreted_string_literal", "raw_string_literal"], alias: /$/ },
  ruby: { clause: [], spec: [], alias: /$/ },
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const only = argv[0] && argv[0] !== "all" ? argv[0] : null
  const per = Number(argv[1] ?? 60)
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

  const langs = Object.keys(GRAMMAR).filter((l) => !only || l === only).sort()
  console.log(`# destructured-import binding sites — ${per} files per lane\n`)
  console.log("| lane | files | destructuring sites | plain specifiers | **ALIASED (`A as B`)** | share |")
  console.log("|---|---:|---:|---:|---:|---:|")
  const grand = { sites: 0, lost: 0 }
  for (const lang of langs) {
    const cfg: any = (LANGS as any)[lang]
    const corpus = (LANG_REPOS as any)[lang]
    if (!cfg || !corpus || GRAMMAR[lang].clause.length === 0) continue
    const wasmPath = path.join(ROOT, "wasm", cfg.wasm)
    if (!fs.existsSync(wasmPath)) continue
    const exts = String(cfg.ext).split(",").map((e) => `.${e.trim()}`)
    const files = walk(path.join(CORPUS, corpus), exts, per)
    if (!files.length) continue
    const gl = await L.load(fs.readFileSync(wasmPath))
    const parser = new P()
    parser.setLanguage(gl)
    const g = GRAMMAR[lang]
    let sites = 0
    let present = 0
    let lost = 0
    const examples: string[] = []
    for (const f of files) {
      let src: string
      try { src = fs.readFileSync(f, "utf8") } catch { continue }
      let root: any
      try { root = parser.parse(src).rootNode } catch { continue }
      const walkNode = (n: any): void => {
        if (g.clause.includes(n.type)) {
          sites++
          const m = n.text.match(g.alias)
          if (m?.[1]) {
            // an aliased specifier: `A as B`. This is the population the alias
            // handling affects — the local binding name differs from the imported
            // name, and brain_import.imported_as is never written to record it.
            lost++
            if (examples.length < 2) examples.push(`${path.relative(path.join(CORPUS, corpus), f)}: ${JSON.stringify(n.text.slice(0, 70))}`)
          } else present++
        }
        for (const c of n.namedChildren ?? []) walkNode(c)
      }
      walkNode(root)
    }
    grand.sites += sites
    grand.lost += lost
    console.log(`| **${lang}** | ${files.length} | ${sites} | ${present} | **${lost}** | ${sites ? ((lost / sites) * 100).toFixed(1) + "%" : "·"} |`)
    for (const e of examples) console.log(`|  |  |  |  | _${e}_ |  |`)
  }
  console.log(`\n- total import specifiers: ${grand.sites}, ALIASED: **${grand.lost}** (${grand.sites ? ((grand.lost / grand.sites) * 100).toFixed(1) : "0"}%)`)
}
main().catch((e) => { console.error(e); process.exit(1) })