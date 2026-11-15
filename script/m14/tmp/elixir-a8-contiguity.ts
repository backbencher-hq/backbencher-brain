/**
 * EX-A8 evidence — how far apart are the clauses of a MERGED (multi-head) Elixir
 * definition, and would "span first clause .. last clause" swallow another
 * declaration? Pure tree measurement: no analyzer call, no oracle, no re-use of
 * the analyzer's own merge bookkeeping.
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/sano/ishaq/backbencher-brain"
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const REPO = arg("repo") ?? "elixir"
const DEF = new Set(["def", "defp", "defmacro", "defmacrop", "defdelegate", "defguard", "defguardp"])
const CONTAINER = new Set(["defmodule", "defprotocol", "defimpl"])

function walk(d: string, out: string[] = []): string[] {
  let e: fs.Dirent[]
  try { e = fs.readdirSync(d, { withFileTypes: true }) } catch { return out }
  for (const x of e) {
    if ([".git", "_build", "deps", "node_modules"].includes(x.name)) continue
    const p = path.join(d, x.name)
    if (x.isDirectory()) walk(p, out)
    else if (x.name.endsWith(".ex") || x.name.endsWith(".exs")) out.push(p)
  }
  return out
}

interface Head { n: string | null; ar: number; start: number; end: number; kind: string }

function heads(root: any): Head[] {
  const out: Head[] = []
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === "call") {
      let id: any = null
      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && c.type === "identifier") { id = c; break } }
      if (id && CONTAINER.has(id.text)) {
        out.push({ n: null, ar: 0, start: n.startPosition.row + 1, end: n.endPosition.row + 1, kind: id.text })
      } else if (id && DEF.has(id.text)) {
        let sig: any = null
        for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && c.type !== "identifier" && c.type !== "do_block") { sig = c; break } }
        if (sig) {
          if (sig.type === "arguments" && sig.namedChildCount > 0) sig = sig.namedChild(0)
          if (sig && sig.type === "binary_operator" && sig.child(1)?.text === "when") sig = sig.child(0)
          if (sig && sig.type === "call") {
            let nm: any = null
            for (let i = 0; i < sig.childCount; i++) { const c = sig.child(i); if (c && c.type === "identifier") { nm = c; break } }
            let ar = 0
            for (let i = 0; i < sig.childCount; i++) { const c = sig.child(i); if (c && c.type === "arguments") ar = c.namedChildCount }
            if (nm) out.push({ n: nm.text, ar, start: n.startPosition.row + 1, end: n.endPosition.row + 1, kind: id.text })
          } else if (sig && sig.type === "identifier") {
            out.push({ n: sig.text, ar: 0, start: n.startPosition.row + 1, end: n.endPosition.row + 1, kind: id.text })
          }
        }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return out
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-elixir.wasm")))
  const p = new P(); p.setLanguage(g)
  let groups = 0, contiguous = 0, groupsWithOtherDecls = 0, swallowed = 0, files = 0
  const examples: string[] = []
  for (const f of walk(path.join(CORPUS_ROOT, REPO))) {
    const text = fs.readFileSync(f, "utf8")
    const all = heads(p.parse(text).rootNode)
    files++
    const fm = new Map<string, Head[]>()
    for (const c of all) {
      if (c.n === null) continue
      const k = `${c.n}/${c.ar}`
      if (!fm.has(k)) fm.set(k, [])
      fm.get(k)!.push(c)
    }
    for (const [k, cs] of fm) {
      if (cs.length < 2) continue
      cs.sort((a, b) => a.start - b.start)
      groups++
      const first = cs[0]!.start
      const last = cs[cs.length - 1]!.end
      const members = new Set(cs.map((c) => `${c.start}:${c.end}`))
      let n = 0
      const names: string[] = []
      for (const c of all) {
        if (c.start <= first || c.start > last) continue
        if (members.has(`${c.start}:${c.end}`)) continue
        n++
        if (names.length < 3) names.push(`${c.kind}@${c.start}`)
      }
      if (n > 0) {
        groupsWithOtherDecls++
        swallowed += n
        if (examples.length < 8) examples.push(`${path.relative(CORPUS_ROOT, f)} ${k} clauses=${cs.length} span=${first}..${last} otherDeclsInside=${n} [${names.join(", ")}]`)
      } else contiguous++
    }
  }
  console.log(JSON.stringify({ REPO, files, mergedGroups: groups, contiguous, groupsWithOtherDeclsInside: groupsWithOtherDecls, swallowedDecls: swallowed, examples }, null, 1))
}
main().catch((e) => { console.error(e); process.exit(1) })
