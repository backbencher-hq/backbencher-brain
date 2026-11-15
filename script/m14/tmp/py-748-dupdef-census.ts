// script/m14/tmp/py-748-dupdef-census.ts — how often does a duplicate `def` in one
// owner scope actually occur across python's two pinned corpora? The ruling for #748
// (runtime binding = LAST wins) changes both the analyzer and the differential's
// oracle, so the blast radius has to be measured before the change, not discovered
// on the F5 re-run. Also prints the count of extra symbols/edges the current
// keep-both reading publishes per site, so the delta is attributable.
//
// Reads only; writes nothing.
import * as fs from "fs"
import * as path from "path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const PY_WASM = path.join(ROOT, "wasm", "tree-sitter-python.wasm")
const REPOS = ["cython", "requests"].map((r) => path.join("/home/ishaq2321/bb_tests/repositories", r))

function filesUnder(dir: string, out: string[] = []): string[] {
  let entries: any[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!/^(\.|node_modules|dist|build|__pycache__)/.test(e.name)) filesUnder(p, out) }
    else if (e.name.endsWith(".py")) out.push(p)
  }
  return out
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(PY_WASM))
  const mod: any = await import(path.join(ROOT, "src/ast/real-python-analyzer"))

  const sites: string[] = []
  let files = 0
  const perRepo: Record<string, { files: number; dupSites: number; dupFiles: number }> = {}

  for (const repo of REPOS) {
    const name = path.basename(repo)
    perRepo[name] = { files: 0, dupSites: 0, dupFiles: 0 }
    for (const f of filesUnder(repo)) {
      files++
      perRepo[name].files++
      const content = fs.readFileSync(f, "utf8")
      const p = new P()
      p.setLanguage(LANG)
      const root = p.parse(content).rootNode
      // Container -> name -> [def nodes in document order]. KEYED BY BYTE
      // RANGE: web-tree-sitter wrappers are per-access, so a Map keyed by the
      // node object silently gives every def its own bucket and reports ZERO
      // duplicates on a corpus that has them (the first version of this probe
      // did exactly that — the same trap the analyzer's own phantom set hit).
      // The scope model is the analyzer's: a class opens a container and clears
      // the function scope, a def inside a def is not a symbol.
      const scopes = new Map<string, Map<string, any[]>>()
      const ckey = (n: any) => `${n.type}:${n.startIndex}:${n.endIndex}`
      const frames: { n: any; container: string; inFn: boolean }[] = [{ n: root, container: ckey(root), inFn: false }]
      while (frames.length > 0) {
        const { n, container, inFn } = frames.pop()!
        let nextContainer = container
        let nextInFn = inFn
        if (n.type === "class_definition" || n.type === "module") { nextContainer = ckey(n); nextInFn = false }
        else if (n.type === "function_definition") {
          if (!inFn) {
            const nm = n.namedChildren.find((c: any) => c.type === "identifier")?.text
            if (nm) {
              const m = scopes.get(container) ?? new Map<string, any[]>()
              m.set(nm, [...(m.get(nm) ?? []), n])
              scopes.set(container, m)
            }
          }
          nextInFn = true
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) frames.push({ n: n.namedChild(i), container: nextContainer, inFn: nextInFn })
      }
      for (const [, m] of scopes)
        for (const [nm, nodes] of m)
          if (nodes.length > 1) {
            const cls = (() => { let c: any = nodes[0].parent; while (c && c.type !== "class_definition" && c.type !== "module") c = c.parent; return c?.type === "class_definition" ? c.namedChildren.find((x: any) => x.type === "identifier")?.text : "<module>" })()
            const decs = nodes.map((n: any) => {
              const dd = n.parent?.type === "decorated_definition" ? n.parent : undefined
              const list: string[] = []
              if (dd) for (let i = 0; i < dd.namedChildCount; i++) { const c = dd.namedChild(i); if (c.type === "decorator") list.push(c.text.replace(/^@/, "").trim()) }
              return `${n.startPosition.row + 1}:[${list.join("|")}]`
            })
            sites.push(`${name}/${path.relative(repo, f)} ${cls}.${nm} x${nodes.length} ${decs.join(" ")}`)
            perRepo[name].dupSites += nodes.length - 1
          }
      if ([...scopes.values()].some((m) => [...m.values()].some((v) => v.length > 1))) perRepo[name].dupFiles++
    }
  }

  console.log(`files=${files}`)
  for (const [k, v] of Object.entries(perRepo)) console.log(`${k}: files=${v.files} dupFiles=${v.dupFiles} extraDuplicateDefs=${v.dupSites}`)
  console.log(`\n--- ${sites.length} duplicate-name scopes ---`)
  for (const s of sites.sort()) console.log("  " + s)

  // Analyzer-side reading of a duplicated class body: how many symbols does the
  // CURRENT (keep-both) reading publish for the name?
  const sample = path.join("/home/ishaq2321/bb_tests/repositories", "cython", "Cython", "Compiler", "PyrexTypes.py")
  const content = fs.readFileSync(sample, "utf8")
  const p2 = new P()
  p2.setLanguage(LANG)
  const r: any = await new mod.RealPythonAnalyzer().analyze(p2.parse(content).rootNode, content, "PyrexTypes.py")
  const dupNames = new Set(["<none>"])
  for (const s of sites) if (s.includes("PyrexTypes.py")) dupNames.add(s.split(".").pop()!.split(" ")[0])
  console.log(`\nanalyzer symbols for PyrexTypes.py duplicated names (${[...dupNames].join(",")}): ` +
    JSON.stringify((r.symbols ?? []).filter((s: any) => dupNames.has(s.name)).map((s: any) => `${s.ownerName ?? "<module>"}.${s.name}@${s.range?.startLine}`)))
}
main()
