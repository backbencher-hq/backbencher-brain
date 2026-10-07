/**
 * PROBE (one-off measurement, /tmp only): what node types can be the PARENT of
 * a `parameters` node in the pinned tree-sitter-rust 0.24.0 wasm, and which of
 * them are declaration contexts whose parameter NAMES must not publish a `uses`
 * edge (the RUST-MR guard at real-rust-analyzer.ts:1986-2005).
 *
 * Question 1: do `bare_function_type` / `parenthesized_type` EVER occur? (they
 * are the two UNKNOWN literals the grammar audit reports.)
 * Question 2: what DOES occur, so the guard can name measured node types
 * instead of unreachable ones.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = "/tmp/opencode/wt/RUST"
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new P()
  parser.setLanguage(await L.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-rust.wasm"))))

  const files: { abs: string; label: string }[] = []
  for (const repo of readdirSync(CR)) {
    const dir = path.join(CR, repo)
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
      try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
      if (!rel.endsWith(".rs")) continue
      files.push({ abs, label: `${repo}/${rel}` })
    }
  }
  files.sort((a, b) => (a.label < b.label ? -1 : 1))
  console.log(`probe: ${files.length} tracked .rs files\n`)

  const holders = new Map<string, { n: number; files: Set<string>; sample: string }>()
  const allTypes = new Set<string>()
  const PROBES = ["bare_function_type", "parenthesized_type", "function_type", "parenthesized_expression", "closure_parameters"]
  const probeHits = new Map<string, number>()

  for (const f of files) {
    let tree: any
    try { tree = parser.parse(readFileSync(f.abs, "utf8")) } catch { continue }
    if (!tree) { tree?.delete?.(); continue }
    const stack: any[] = [tree.rootNode]
    while (stack.length) {
      const n = stack.pop()
      allTypes.add(n.type)
      if (PROBES.includes(n.type)) probeHits.set(n.type, (probeHits.get(n.type) ?? 0) + 1)
      if (n.type === "parameters") {
        // what is the parameters node's PARENT, and its GRANDPARENT chain?
        const h = n.parent
        const key = h ? h.type : "(none)"
        const rec = holders.get(key) ?? { n: 0, files: new Set<string>(), sample: "" }
        rec.n++
        rec.files.add(f.label)
        if (!rec.sample) {
          const p0 = h?.parent
          rec.sample = `${key} <- ${p0 ? p0.type : "(none)"} <- ${p0?.parent ? p0.parent.type : "(none)"}  [${n.namedChildCount} param(s)] ${f.label}`
        }
        holders.set(key, rec)
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
    tree.delete?.()
  }

  console.log(`distinct node types observed over the corpus: ${allTypes.size}\n`)
  console.log("PROBES (node types the guard names, plus the parenthesised forms):")
  for (const p of PROBES) console.log(`  ${p.padEnd(28)} ${probeHits.get(p) ?? 0}`)
  console.log("\nPARENT of every `parameters` node, by frequency:")
  for (const [k, v] of [...holders.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${k.padEnd(26)} ${String(v.n).padStart(6)} in ${v.files.size} files`)
    console.log(`      chain: ${v.sample}`)
  }
  const absent = PROBES.filter(p => !allTypes.has(p))
  console.log(`\nnode types NAMED BY THE GUARD BUT ABSENT from every parse: ${absent.length ? absent.join(", ") : "(none)"}`)
}
main().catch((e) => { console.error(e); process.exit(1) })