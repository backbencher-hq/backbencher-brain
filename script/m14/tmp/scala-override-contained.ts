// Can `overrides` be improved WITHOUT a project-wide prepass?
//
// The measured prize: a corpus-wide companion + hierarchy index resolves 459 of
// 677 blind first-supertype guesses, and 308 of the 677 (45.5%) are demonstrably
// wrong today. But `indexProjectParallel` streams files independently with no
// prepass, so that index is an architectural change (a second parse pass, an
// incremental order-dependent index, or a relationship re-pass) — not a patch.
//
// So this measures the CONTAINED alternative: what can be improved using only what
// the analyzer can see inside one file? Three candidate rules, each evaluated on
// the same draw with the same harness semantics:
//
//   R0  current    — take parents[0] blindly
//   R1  verify-1st  — keep parents[0] only if it DECLARES the method (in-file);
//                     otherwise fall through to the remaining parents, first match
//   R2  verify-all  — walk the in-file ancestry from every parent; nearest
//                     declaring ancestor wins; emit nothing if none declares
//
// R1/R2 can only ever IMPROVE accuracy: they never invent an edge, they decline or
// retarget an unverified one. The question is how much they recover, and what they
// cost in suppressed rows — because declining is not free, an override that is
// real but unverifiable in-file becomes invisible, and invisible is worse than
// wrong if nothing says so.

import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"

const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const repo = process.argv[2] ?? "scala3"
const drawFile = process.argv[3]
const LIMIT = Number(process.argv[4] ?? 400)
const MAX_DEPTH = 12

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P()
  parser.setLanguage(gl)
  const analyzer = new RealScalaAnalyzer()

  const files = fs.readFileSync(drawFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, LIMIT)

  let guesses = 0
  const r0 = { firstDeclares: 0, firstSilent: 0 }
  const r1 = { retargeted: 0, declined: 0, kept: 0 }
  const r2 = { retargeted: 0, declined: 0, kept: 0, viaDepth: new Map<number, number>() }
  const examples: string[] = []

  for (const f of files) {
    const fp = path.join(CORPUS, repo, f)
    if (!fs.existsSync(fp)) continue
    const src = fs.readFileSync(fp, "utf8")
    let res: any
    try { res = analyzer.analyze(parser.parse(src).rootNode, src, fp) } catch { continue }

    // in-file knowledge only: owner -> supertypes, owner -> declared method names
    const sup = new Map<string, string[]>()
    const methods = new Map<string, Set<string>>()
    for (const s of res.symbols ?? []) {
      const owner = s.ownerName ?? s.name
      if (!owner) continue
      const st = (s.metadata?.superTypes ?? []).map(String)
      if (st.length) sup.set(s.name, [...(sup.get(s.name) ?? []), ...st])
      if (String(s.kind) === "method" && s.name) {
        if (!methods.has(owner)) methods.set(owner, new Set())
        methods.get(owner)!.add(s.name)
      }
    }
    const declares = (t: string, m: string): boolean => methods.get(t)?.has(m) ?? false
    const hier = (t: string): string[] => sup.get(t) ?? []

    for (const r of (res.relationships ?? [])) {
      if (String(r.type) !== "overrides" || r.metadata?.reasonCode !== "first-supertype-guess") continue
      guesses++
      const full = String(r.source)
      const method = full.split(".").pop() ?? ""
      const owner = full.slice(0, full.length - method.length - 1)
      const parents = sup.get(owner) ?? []
      if (!parents.length) continue
      const first = parents[0]

      // R0 — what happens today
      if (declares(first, method)) r0.firstDeclares++
      else r0.firstSilent++

      // R1 — keep first if it declares, else try the rest in order
      if (declares(first, method)) r1.kept++
      else {
        const alt = parents.slice(1).find((p) => declares(p, method))
        if (alt) { r1.retargeted++; if (examples.length < 10) examples.push(`R1 ${full}: ${first} -> ${alt}`) }
        else r1.declined++
      }

      // R2 — walk in-file ancestry from every parent, nearest declaring wins
      const seen = new Set<string>()
      let frontier = [...parents]
      let found = ""
      let d = 0
      while (frontier.length && d < MAX_DEPTH && !found) {
        const next: string[] = []
        for (const t of frontier) {
          if (!t || seen.has(t)) continue
          seen.add(t)
          if (declares(t, method)) { found = t; break }
          next.push(...hier(t))
        }
        frontier = [...new Set(next)]
        d++
      }
      if (!found) r2.declined++
      else if (found === first) r2.kept++
      else { r2.retargeted++; r2.viaDepth.set(d, (r2.viaDepth.get(d) ?? 0) + 1); if (examples.length < 20) examples.push(`R2 ${full}: ${first} -> ${found} (depth ${d})`) }
    }
  }

  console.log(`# contained overrides improvements (in-file knowledge only) — ${LIMIT} files from ${repo}\n`)
  console.log(`- first-supertype guesses examined: ${guesses}`)
  console.log(`\n## R0 — today`)
  console.log(`- first supertype DOES declare the method (guess accidentally right): ${r0.firstDeclares} (${((r0.firstDeclares / guesses) * 100).toFixed(1)}%)`)
  console.log(`- first supertype does NOT declare it (guess is UNVERIFIABLE in-file): ${r0.firstSilent} (${((r0.firstSilent / guesses) * 100).toFixed(1)}%)`)
  console.log(`\n## R1 — verify parents[0], else try the rest`)
  console.log(`- kept unchanged: ${r1.kept}`)
  console.log(`- **retargeted to a parent that verifiably declares it: ${r1.retargeted}**`)
  console.log(`- declined (no in-file parent declares it): ${r1.declined}`)
  console.log(`\n## R2 — walk in-file ancestry from every parent`)
  console.log(`- kept unchanged: ${r2.kept}`)
  console.log(`- **retargeted: ${r2.retargeted}**  at depths ${[...r2.viaDepth].sort((a, b) => a[0] - b[0]).map(([d, n]) => `d${d}=${n}`).join(" ") || "—"}`)
  console.log(`- declined: ${r2.declined}`)
  const improve = Math.max(r1.retargeted, r2.retargeted)
  console.log(`\n## verdict`)
  console.log(`- a contained rule retargets at most ${improve} of ${guesses} guesses (${((improve / guesses) * 100).toFixed(1)}%), against 459 (67.8%) for a corpus-wide index`)
  console.log(`- and it DECLINES ${Math.max(r1.declined, r2.declined)} rows that today are published at confidence 0.5.`)
  console.log(`  Those are the same rows, so the trade is: fewer wrong edges, more invisible ones.`)
  console.log(`  The harness already buckets confidence < 0.7 as heuristic (declared suspicion), so the`)
  console.log(`  honest question is whether a declined row should vanish or become an explicit "unverified".`)
  if (examples.length) {
    console.log(`\n## examples`)
    for (const e of examples.slice(0, 12)) console.log(`  ${e}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })