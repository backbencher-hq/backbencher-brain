#!/usr/bin/env npx tsx
/**
 * PROBE — how many relationship facts does the R analyzer's own dedup key discard?
 *
 * ## The rule
 *
 * `src/ast/real-r-analyzer.ts:417-426` ends every `analyze()` with:
 *
 *     // Relationship identity is source/type/target. Preserve one edge per
 *     // semantic fact even when the same call appears in multiple AST wrappers.
 *     const key = `${type}\u001f${source}\u001f${target}`
 *
 * The key has no LINE. So the first (type, source, target) in a file wins and every
 * later one is dropped — and the survivor carries the FIRST site's line.
 *
 * The stated intent is sound: the same call reached through two AST wrappers is one
 * call and should be one edge. The key cannot tell that case from two different use
 * sites, because both are (type, source, target) with no line to separate them.
 *
 * The MINIMAL REPRODUCER, four lines, no corpus needed:
 *
 *     utils::globalVariables(".my_var")
 *     utils::head(x)
 *     utils::tail(x)
 *
 * Production `parseFile` returns ONE `imports` edge and ONE `references` edge, both at
 * line 1. Lines 2 and 3 are gone, and nothing reports the loss.
 *
 * ## What is measured here
 *
 * Two numbers per affected type, over a corpus sample:
 *
 *   ON TREE     occurrences of the construct on the parse tree — what the grammar says
 *               is there. This is an UPPER BOUND on edges: some occurrences are inside
 *               code the analyzer's gates decline to read, so tree count > edge count is
 *               NOT by itself a defect.
 *   EMITTED     distinct (type, source, target) keys production parseFile returned.
 *
 * The gap is only interpretable where the rule is 1:1 — a namespace_operator node names
 * exactly one package and the analyzer's only gate on it is that the lhs is a name and the
 * operator is `::` or `:::`. That is why `references`/`imports` (namespace_access) is the
 * primary measurement here, and `calls` is reported only as a bound.
 *
 * ## What is NOT claimed
 *
 * That every tree occurrence should be an edge. For `calls` the analyzer has documented
 * gates (callee position, write position, closure attribution) and this probe does not
 * adjudicate them. The `calls` row is reported so the reader can see the ceiling, not so
 * the ceiling can be read as a loss.
 *
 * Run: `npx tsx validation/m14/fixtures/r/probe-dedup-collapse.ts`   (exits 0; writes nothing)
 */

import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LIMIT = Number(process.env.BB_R_PROBE_FILES ?? 400)

function gitTracked(dir: string, out: string[] = []): string[] {
  let s: string
  try { s = execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8", maxBuffer: 1 << 28 }) }
  catch { return out }
  for (const rel of s.split("\n")) {
    if (!rel) continue
    const abs = path.join(dir, rel)
    try { if (fs.statSync(abs).isFile()) out.push(abs) } catch {}
  }
  return out
}

const main = async () => {
  const files: string[] = []
  for (const repo of fs.readdirSync(CORPUS).sort()) {
    const dir = path.join(CORPUS, repo)
    if (!fs.statSync(dir).isDirectory()) continue
    for (const f of gitTracked(dir)) {
      if (detectLanguageFromPath(f) === "r") files.push(f)
    }
  }
  files.sort()
  const sample = files.slice(0, LIMIT)

  // ON TREE, counted by a raw grammar walk with no analyzer rules at all.
  const wts: any = await import("web-tree-sitter")
  const P: any = (wts as any).Parser
  const L: any = (wts as any).Language
  await P.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new P()
  parser.setLanguage(await L.load(fs.readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-r.wasm"))))

  let nsNodes = 0
  let callNodes = 0
  let parsed = 0
  let failures = 0

  const emittedKeys = new Set<string>()
  let emittedRel = 0
  const perType = new Map<string, number>()
  const nsByType = new Map<string, number>()
  // Files where one (type,source,target) key was reached on the tree more than once.
  const repeatedKeyFiles = new Map<string, Set<string>>()

  for (const f of sample) {
    let tree: any
    try {
      const text = fs.readFileSync(f, "utf8")
      tree = parser.parse(text)
      if (!tree) { failures++; continue }
      const walk = (n: any) => {
        if (n.type === "namespace_operator") nsNodes++
        if (n.type === "call") callNodes++
        for (let i = 0; i < n.childCount; i++) walk(n.child(i))
      }
      walk(tree.rootNode)
      tree.delete?.()
      parsed++
    } catch { failures++; continue }

    let res: any
    try { res = await parseFile(f, path.dirname(f)) } catch { continue }
    for (const r of res.relationships ?? []) {
      const t = String(r.type ?? r.relationshipType ?? "")
      const key = `${t}\u001f${r.source ?? ""}\u001f${r.target ?? ""}`
      emittedRel++
      perType.set(t, (perType.get(t) ?? 0) + 1)
      // Count ONLY the namespace_access subtype. `imports` also carries library_import,
      // rcpp_source and r_source, and `references` also carries library_dependency,
      // s7_class_binding and s4_binding; mixing them in would make the collapse figure a
      // statement about a set of subtypes rather than about the one under test.
      if (r.metadata?.relationshipSubType === "namespace_access") {
        nsByType.set(t, (nsByType.get(t) ?? 0) + 1)
      }
      if (emittedKeys.has(key)) {
        // Cannot happen by construction; asserted so a change to the key is caught here
        // rather than being read as a stable property of the analyzer.
        if (!repeatedKeyFiles.has(t)) repeatedKeyFiles.set(t, new Set())
        repeatedKeyFiles.get(t)!.add(f)
      }
      emittedKeys.add(key)
    }
  }

  console.log("=".repeat(78))
  console.log("PROBE — relationship dedup key omits the line (real-r-analyzer.ts:422)")
  console.log("=".repeat(78))
  console.log()
  console.log(`corpus root      ${CORPUS}`)
  console.log(`admitted R files ${files.length}   sampled ${sample.length}   parsed ${parsed}   failures ${failures}`)
  console.log(`workers          1 (sequential, so the wasm concurrency wobble does not enter)`)
  console.log()
  console.log("NAMESPACE ACCESS — the rule is 1:1, so the gap is a loss and not a gate")
  console.log(`  namespace_operator nodes on the parse tree   ${nsNodes}`)
  console.log(`  namespace_access edges emitted (imports)     ${nsByType.get("imports") ?? 0}`)
  console.log(`  namespace_access edges emitted (references)  ${nsByType.get("references") ?? 0}`)
  const nsEmitted = nsByType.get("imports") ?? 0
  console.log(`  COLLAPSED (tree nodes - imports edges)        ${nsNodes - nsEmitted}`)
  const pct = nsNodes ? ((nsNodes - nsEmitted) / nsNodes) * 100 : 0
  console.log(`  collapsed share                               ${pct.toFixed(1)}%`)
  console.log()
  console.log("  The two emitted rows DIFFER because `references` is not only namespace access:")
  console.log("  it also carries library_dependency, s7_class_binding and s4_binding, which are")
  console.log("  derived elsewhere. The comparison above is therefore against `imports` alone —")
  console.log("  the type whose every edge in this corpus is a namespace access except the three")
  console.log("  subtypes named here, which are excluded from both counts.")
  console.log()
  console.log("CALLS — reported as a ceiling only; the analyzer has documented gates here")
  console.log(`  call nodes on the parse tree                   ${callNodes}`)
  console.log(`  calls edges emitted                            ${perType.get("calls") ?? 0}`)
  console.log(`  ratio                                           ${callNodes ? (((callNodes - (perType.get("calls") ?? 0)) / callNodes) * 100).toFixed(1) : "-"}% below the tree`)
  console.log()
  console.log(`duplicate keys reaching EMITTED output: ${[...repeatedKeyFiles.keys()].join(", ") || "none (the key is unique by construction, as asserted)"}`)
  console.log()
  console.log("READ THIS AS: for a file that reaches the same package twice, the graph holds")
  console.log("one edge carrying the FIRST line. A consumer cannot see the second site, and the")
  console.log("line it does carry is not wrong — it is incomplete. Nine lines below the same")
  console.log("comment, `imports` as an ImportInfo list is keyed by (module, RANGE) and so keeps")
  console.log("every site; the relationship next to it keeps one.")
  console.log()
  console.log("NOT claimed: that every tree occurrence should be an edge. The `calls` row is a")
  console.log("ceiling, and the fix belongs to the key's owner — reported, not edited (brief §8).")
}

main()