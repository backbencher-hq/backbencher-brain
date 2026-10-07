/**
 * verify-rust-ontology-residual — the lane's own two-sided check on the four
 * relationship kinds whose DERIVATION this wave depends on.
 *
 * ## Why this exists
 *
 * The differential can only compare a label whose truth an oracle derives, and
 * for `contains` and `overrides` it compares them against NOTHING (the harness
 * prints `COMPARED WITH NO TRUTH` on every run; see the lane doc's DERIVATION
 * section). So the two sides are compared HERE, on the production analyzer and
 * on the lane's own oracle modules, over the whole admitted corpus rather than
 * one 60-file draw — in BOTH directions, because the two failure modes are
 * different defects:
 *
 *   - an analyzer edge with no oracle row  = the oracle is too narrow, and the
 *     differential would have counted a correct edge as a confident fabrication.
 *     That is what 29 of 3,809 `contains` rows were before the oracle was
 *     repaired (26 function-local `const`/`static`, 1 function-local
 *     `macro_rules!`, 2 under the `anonymous_impl` owner).
 *   - an oracle row with no analyzer edge  = the oracle is too WIDE, and every
 *     such row would read as MISSING while inflating the coverage percentage —
 *     the direction that looks like success.
 *
 * ## What it is not
 *
 * The oracle and the analyzer read the same grammar, so this check cannot
 * adjudicate a shared RULE — only disagreement. The independent evidence for the
 * rules is the fixtures (`rust/trait-impl-overrides`, `rust/use-import-edges`,
 * `rust/function-local-consts`, `rust/contains`-shaped rows elsewhere) and the
 * mutants in `rust-lane-mutants.ts`.
 *
 * The match rule is the harness's own: `label + normTarget(target)`, source
 * ignored, because that is what `differential.ts` compares.
 *
 * READ-ONLY. Writes nothing.
 *
 * CLI: npx tsx script/m14/verify-rust-ontology-residual.ts [repo ...]
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { ASTEngine } from "../../src/ast/engine"
import { deriveRustContainsTruth } from "./oracles/rust-contains"
import { deriveRustOverridesTruth } from "./oracles/rust-overrides"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPOS = process.argv.slice(2).filter((a) => !a.startsWith("-"))
const MAX_BYTES = 512 * 1024

/** `differential.ts`'s own normalisation: strip a trailing type-argument list,
 *  then take the last path segment. `MemStore.flush` and `flush` are the same
 *  target to that matcher, which is why an override edge's BASE OWNER does not
 *  affect coverage and is therefore pinned by fixture instead. */
const norm = (t: string): string => {
  const s = String(t ?? "").trim()
  const cut = s.search(/[[<]/)
  const head = cut > 0 ? s.slice(0, cut) : s
  const parts = head.split(/::|\./).filter(Boolean)
  return parts[parts.length - 1] ?? head
}

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new P()
  parser.setLanguage(await L.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-rust.wasm"))))

  const files: { abs: string; label: string }[] = []
  for (const repo of REPOS.length ? REPOS : readdirSync(CR)) {
    const dir = path.join(CR, repo)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch { continue }
    let tracked: string[]
    try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
    for (const rel of tracked) {
      const abs = path.join(dir, rel)
      try { if (!statSync(abs).isFile() || statSync(abs).size > MAX_BYTES) continue } catch { continue }
      if (!rel.endsWith(".rs")) continue
      files.push({ abs, label: `${repo}/${rel}` })
    }
  }
  files.sort((a, b) => (a.label < b.label ? -1 : 1))
  console.log(`# verify-rust-ontology-residual\ncorpus: ${files.length} tracked .rs files${REPOS.length ? ` in ${REPOS.join(",")}` : " (every admitted repo)"}\n`)

  let parseFail = 0
  let analyzerEdges = 0
  const counts: Record<string, number> = { "contains:analyzer": 0, "overrides:analyzer": 0 }
  const residual: string[] = []
  const truthOnly: string[] = []

  for (const f of files) {
    const content = readFileSync(f.abs, "utf8")
    const tree = parser.parse(content)
    if (!tree) { parseFail++; continue }
    const truthC = deriveRustContainsTruth(tree.rootNode)
    const truthO = deriveRustOverridesTruth(tree.rootNode)
    tree.delete?.()
    let res: any
    try { res = await ASTEngine.parseFile(f.abs, content) } catch { parseFail++; continue }

    const truthKeys = new Set<string>()
    for (const e of truthC) truthKeys.add(`contains|${norm(e.target)}`)
    for (const e of truthO) truthKeys.add(`overrides|${norm(e.target)}`)
    const analyzerKeys = new Set<string>()
    for (const r of res.relationships ?? []) {
      const kind = String(r.type ?? "")
      if (kind !== "contains" && kind !== "overrides") continue
      analyzerEdges++
      counts[`${kind}:analyzer`] = (counts[`${kind}:analyzer`] ?? 0) + 1
      const k = `${kind}|${norm(r.target)}`
      if (analyzerKeys.has(k)) continue
      analyzerKeys.add(k)
      if (!truthKeys.has(k) && residual.length < 40) residual.push(`${f.label}: ANALYZER-ONLY ${kind} ${r.source} -> ${r.target}`)
    }
    for (const k of truthKeys) {
      if (!analyzerKeys.has(k) && truthOnly.length < 40) truthOnly.push(`${f.label}: TRUTH-ONLY ${k}`)
    }
  }

  console.log(`parsed ${files.length - parseFail}/${files.length} (${parseFail} failures)`)
  console.log(`analyzer edges compared: ${analyzerEdges}  (${JSON.stringify(counts)})`)
  console.log(`analyzer rows with no oracle row (a confident fabrication if the label were compared): ${residual.length}`)
  for (const r of residual) console.log(`   ${r}`)
  console.log(`oracle rows with no analyzer edge (MISSING, and coverage inflated): ${truthOnly.length}`)
  for (const r of truthOnly) console.log(`   ${r}`)
  const ok = residual.length === 0 && truthOnly.length === 0
  console.log("")
  console.log(ok
    ? "the analyzer and the lane's contains/overrides oracles agree on every file, in both directions"
    : `${residual.length + truthOnly.length} disagreement(s) — the analyzer and its oracles do NOT agree over this corpus`)
  process.exit(ok ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
