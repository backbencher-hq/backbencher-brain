// Direct, draw-independent comparison for the go `references` surface.
//
// The F5 harness ROTATES its sample (`rot 2`, `rot 7` in the same evidence run),
// so a MISSING count is a property of which files were drawn. That is not a
// criticism of the harness — the rotation is deliberate, to stop a lane reading
// the same 200 files forever — but it does mean a green count is not a stable
// claim, and a class can sit at 0 for a run and 3 for the next one.
//
// This script has no rotation: it walks a corpus in sorted order and reports
// every disagreement, so a class is found or it is not. It compares the
// derivation THAT IS WIRED INTO THE GATE (deriveGoDeclaredTypeRefs from
// differential.ts) against the analyzer, which is also how the two latent
// ReferenceErrors committed in 8b0e2113 were found: that copy of the
// derivation was never executed until a rotating draw happened to reach the
// embedded-field branch.
import * as fs from "node:fs"
import * as path from "node:path"
import { deriveGoDeclaredTypeRefs } from "../differential"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const arg = (k: string, d: string): string => {
  const i = process.argv.indexOf(k)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d
}

async function main() {
  const repos = process.argv.slice(2).filter((a) => !a.startsWith("--"))
  const want = Number(arg("--files", "0"))
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-go.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-go-analyzer.ts"))

  for (const repo of repos) {
    const dir = path.join("<corpus-root>/bb_tests/repositories", repo)
    if (!fs.existsSync(dir)) { console.log(`[SKIP] ${repo}`); continue }
    const files: string[] = []
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === "vendor" || e.name === ".git") continue
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p); else if (e.name.endsWith(".go")) files.push(p)
      }
    }
    walk(dir)
    files.sort()
    const take = want > 0 ? files.slice(0, want) : files

    const parser = new P()
    parser.setLanguage(g)
    const truth = new Set<string>()
    const got = new Set<string>()
    const shapes: Record<string, { t: number; a: number }> = {}
    const missing: string[] = []
    const extra: string[] = []
    let read = 0
    let threw: string[] = []

    for (const abs of take) {
      const content = fs.readFileSync(abs, "utf8")
      const rel = path.relative(dir, abs)
      const tree = parser.parse(content)
      read++
      let t: any[]
      try { t = deriveGoDeclaredTypeRefs(tree.rootNode) } catch (e: any) {
        threw.push(`${repo}/${rel}: ${e?.message ?? e}`)
        continue
      }
      let res: any
      try { res = await new mod.RealGoAnalyzer().analyze(tree.rootNode, content, rel) } catch { continue }
      const perFile = new Set<string>()
      for (const e of t) {
        const k = String(e.target)
        truth.add(k); perFile.add(k)
        const sh = e.rt === "return_type" ? "return_type" : "declared_type"
        shapes[sh] ??= { t: 0, a: 0 }; shapes[sh].t++
      }
      for (const r of res.relationships ?? []) {
        const rt = String((r.metadata ?? {}).relationshipType ?? "")
        if (String(r.type) !== "references" || (rt !== "declared_type" && rt !== "return_type")) continue
        const k = String(r.target ?? "")
        got.add(k)
        shapes[rt] ??= { t: 0, a: 0 }; shapes[rt].a++
        if (!perFile.has(k)) extra.push(`${repo}/${rel} | ${k} [${rt}] src=${r.source}`)
      }
      for (const e of t) if (!got.has(String(e.target))) missing.push(`${repo}/${rel} | ${e.target} [${e.rt}] src=${e.from}`)
    }
    for (const t of truth) if (!got.has(t)) missing.push(`(file-level) | ${t}`)

    console.log(`===== ${repo} =====`)
    console.log(JSON.stringify({
      repo, filesRead: read,
      truthDistinct: truth.size, analyzerDistinct: got.size,
      MISSING: missing.length, UNEXPLAINED: extra.length,
      oracleThrew: threw.length,
      byMarker: shapes,
      oracleThrewSamples: threw.slice(0, 5),
      missingSamples: missing.slice(0, 10),
      extraSamples: extra.slice(0, 10),
    }, null, 2))
  }
}
main()
