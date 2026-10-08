/**
 * GO LANE — `overrides` DISCREPANCY PROBE.
 *
 * The census counts the construct on the parse tree (probe B2) and counts what
 * the analyzer emits, and on a 2,000-file draw the two DISAGREED: 18 same-file
 * shadowing sites on the tree, 17 `overrides` edges from the production entry.
 * A one-edge gap is exactly the shape nobody looks at, so this prints both sets
 * from the same file list and diffs them.
 *
 * The tree side is the Go spec's selector rule re-implemented here, deliberately
 * NOT by calling the analyzer: a comparison that shares the analyzer's code
 * proves nothing about the analyzer.
 *
 * CLI: npx tsx script/m14/go-overrides-diff.ts <file> [<file> ...]
 */
import * as path from "node:path"
import { readFileSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO_OF = (rel: string): string => rel.slice(0, rel.indexOf("/"))
const files = process.argv.slice(2).map((f) => {
  const repo = f.slice(0, f.indexOf("/"))
  return path.join(CR, repo, f.slice(repo.length + 1))
})

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-go.wasm"))))

const firstNamed = (n: any, types: string[]): any => {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && types.indexOf(c.type) !== -1) return c
  }
  return undefined
}
const leafOf = (raw: string): string => {
  const d = raw.lastIndexOf(".")
  return d === -1 ? raw : raw.slice(d + 1)
}
function recvLeaf(recv: any): string {
  if (!recv) return ""
  let cur: any =
    recv.type === "parameter_list"
      ? (recv.childForFieldName?.("type") ?? (recv.namedChildCount > 0 ? recv.namedChild(0) : undefined)?.childForFieldName?.("type"))
      : recv
  for (let g = 0; g < 8 && cur; g++) {
    if (cur.type === "pointer_type" || cur.type === "generic_type") {
      cur = cur.childForFieldName?.("type") ?? (cur.namedChildCount > 0 ? cur.namedChild(0) : undefined) ?? null
      if (!cur) return ""
      continue
    }
    break
  }
  if (!cur) return ""
  return leafOf(String(cur.text ?? ""))
}
function typeLeafOf(tn: any): string {
  let cur = tn
  for (let g = 0; g < 8 && cur; g++) {
    if (cur.type === "pointer_type" || cur.type === "generic_type") {
      cur = cur.namedChildCount > 0 ? cur.namedChild(0) : undefined
      continue
    }
    break
  }
  if (!cur) return ""
  if (cur.type !== "type_identifier" && cur.type !== "qualified_type") return ""
  return leafOf(String(cur.text ?? ""))
}

const expected = new Set<string>()
const produced = new Set<string>()
for (const abs of files) {
  const rel = abs.slice(CR.length + 1)
  const text = readFileSync(abs, "utf8")
  const t = parser.parse(text)
  if (!t) continue
  const root = t.rootNode
  const embeds = new Map<string, string[]>()
  const methodsByRecv = new Map<string, Set<string>>()
  /** Type names DECLARED in this file. The embed walk below is scoped to them,
   *  and the scoping is not a convenience: `src/cmd/go/internal/lockedfile`
   *  declares `type File struct{ *os.File }` and declares its own
   *  `func (f *File) Close()`. A leaf-only walk reads the embed as the local
   *  type `File` promoting its own `Close` and reports `File.Close -> File.Close`
   *  — a self-edge whose target is really `os.File`'s method. The analyzer skips
   *  it (a type is not embedded in itself) and is right; the probe was counting
   *  a stdlib method set it cannot see. B3 and B4 are where the cross-file and
   *  external surfaces are measured, separately and on purpose. */
  const declaredTypes = new Set<string>()
  // PASS 1 — declarations and method sets only. The embed filter in pass 2 asks
  // whether the embedded type has methods IN THIS FILE, and a single walk reads
  // a `type_spec` before the methods that follow it in the file, so one pass
  // cannot answer its own question. The first version did, and under-counted
  // every type whose methods are declared after the struct that embeds it —
  // 8 sites across 5 corpus files, every one of them a real edge the analyzer
  // emitted and this probe called an extra.
  const collectDeclarations = (n: any) => {
    if (n.type === "type_spec" || n.type === "type_alias") {
      const nm = n.childForFieldName?.("name")
      if (nm) declaredTypes.add(String(nm.text))
    }
    if (n.type === "method_declaration") {
      const nm = n.childForFieldName?.("name")
      const rl = recvLeaf(n.childForFieldName?.("receiver"))
      if (rl && nm) {
        let s = methodsByRecv.get(rl)
        if (!s) { s = new Set(); methodsByRecv.set(rl, s) }
        s.add(String(nm.text))
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) collectDeclarations(c) }
  }
  collectDeclarations(root)
  // PASS 2 — the embedding edges, filtered to the same-file surface.
  const walk = (n: any) => {
    if (n.type === "type_spec" || n.type === "type_alias") {
      const nm = n.childForFieldName?.("name")
      const tname = nm ? String(nm.text) : undefined
      const target = firstNamed(n, ["struct_type", "interface_type"])
      if (tname && target) {
        const fdl = firstNamed(target, ["field_declaration_list"])
        const list: string[] = []
        if (fdl) {
          for (let k = 0; k < fdl.namedChildCount; k++) {
            const fd = fdl.namedChild(k)
            if (!fd || fd.type !== "field_declaration") continue
            if (fd.childForFieldName?.("name")) continue
            const tn = fd.childForFieldName?.("type")
            if (!tn) continue
            // A QUALIFIED embed (`*os.File`, `sync.Mutex`) names a type in
            // another PACKAGE. Its method set is not in this file and this
            // analyzer does not resolve another package, so it belongs to the
            // external sub-surface (measured separately), not to the same-file
            // one. The leaf-only reading of `*os.File` is the local type `File`
            // whenever the file happens to declare one — which is how the first
            // version of this probe produced a `File.Close -> File.Close`
            // self-edge and looked, for one file, like the analyzer were
            // dropping an edge.
            const raw = String(tn.text ?? "")
            if (raw.includes(".")) continue
            const leaf = typeLeafOf(tn)
            if (leaf && (declaredTypes.has(leaf) || methodsByRecv.has(leaf))) list.push(leaf)
          }
        }
        if (list.length) embeds.set(tname, list)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
  }
  walk(root)
  const promotedIn = (tname: string, depth: number, seen: Set<string>): string[] => {
    const out: string[] = []
    if (depth > 4) return out
    for (const e of embeds.get(tname) ?? []) {
      const key = `${tname}>${e}`
      if (seen.has(key)) continue
      const s2 = new Set(seen); s2.add(key)
      for (const m of methodsByRecv.get(e) ?? []) out.push(`${e}.${m}`)
      for (const m of promotedIn(e, depth + 1, s2)) out.push(m)
    }
    return out
  }
  for (const [tname, ms] of methodsByRecv) {
    for (const m of ms) {
      for (const p of promotedIn(tname, 0, new Set())) {
        if (p.slice(p.lastIndexOf(".") + 1) !== m) continue
        expected.add(`${rel} ${tname}.${m} -> ${p}`)
      }
    }
  }
  t.delete?.()
  const r: any = await parseFile(abs, path.dirname(abs))
  for (const x of r?.relationships ?? []) {
    if (String(x.type ?? "").toLowerCase() !== "overrides") continue
    produced.add(`${rel} ${x.source} -> ${x.target}`)
  }
}
console.log(`expected on the tree: ${expected.size}`)
console.log(`produced by the analyzer: ${produced.size}`)
const missing = [...expected].filter((x) => !produced.has(x))
const extra = [...produced].filter((x) => !expected.has(x))
console.log(`\nMISSING (on the tree, not emitted): ${missing.length}`)
for (const m of missing) console.log(`  ${m}`)
console.log(`\nEXTRA (emitted, not on the tree): ${extra.length}`)
for (const m of extra) console.log(`  ${m}`)
process.exit(0)
