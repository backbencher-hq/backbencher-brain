/**
 * INCOMING_RUST oracle probe — LANE-OWNED diagnostic instrument.
 *
 * WHY IT EXISTS
 *
 * The differential harness answers per-LANE numbers ("13 MISSING") and prints
 * samples. When a MISSING row appears, the first question is which of the two
 * walkers produced it — the lane's dedicated oracle (`deriveRustEdges` +
 * `deriveRustBareUses` + `deriveRustDeclaredTypeRefs` + the M60 contains oracle)
 * or the GENERIC walker every language gets (`deriveTreeEdges`), which for a
 * grammar it was not written against can derive edges from constructs that mean
 * something else in Rust. Those two answers need different fixes, one of them in
 * a file this lane does not own, and the harness does not separate them. This
 * probe does, per file, per oracle, per label.
 *
 * It also prints the analyzer's own edges per label for the same file, so the
 * three-way comparison (analyzer / dedicated oracle / generic walker) is
 * readable in one place.
 *
 * NO REGEX. Grammar-node types and exact string equality only.
 *
 * Usage: bun script/lanes/incoming-rust/oracle-probe.ts <file.rs> [more.rs ...]
 *        with BB_PROBE_LABEL to restrict the printed labels (exact string).
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"

const REPO_ROOT = path.resolve(path.join(import.meta.dir, "..", "..", ".."))
const files = process.argv.slice(2).filter((a) => !a.startsWith("--"))
if (files.length === 0) {
  console.error("usage: oracle-probe.ts <file.rs> [...]")
  process.exit(2)
}

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(REPO_ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(REPO_ROOT, "wasm", "tree-sitter-rust.wasm"))))

const diff: any = await import(path.join(REPO_ROOT, "script", "m14", "differential.ts"))
const oracles: any = await import(path.join(REPO_ROOT, "script", "m14", "oracles", "rust-contains.ts"))
const { ASTEngine } = await import(path.join(REPO_ROOT, "src", "ast", "engine.ts"))

const only = process.env.BB_PROBE_LABEL
const wanted = (label: string): boolean => !only || label === only

for (const file of files) {
  const content = readFileSync(file, "utf8")
  const tree = parser.parse(content)
  console.log(`\n=== ${file}`)
  const producers: { who: string; label: string; from: string; target: string }[] = []
  const add = (who: string, arr: any[]): void => {
    for (const e of arr ?? []) producers.push({ who, label: String(e.label ?? ""), from: String(e.from ?? e.source ?? ""), target: String(e.target ?? "") })
  }
  add("generic:deriveTreeEdges", diff.deriveTreeEdges(tree.rootNode, "rust"))
  add("rust:deriveRustEdges", diff.deriveRustEdges(tree.rootNode))
  add("rust:deriveRustBareUses", diff.deriveRustBareUses(tree.rootNode))
  add("rust:deriveRustDeclaredTypeRefs", diff.deriveRustDeclaredTypeRefs(tree.rootNode))
  add("rust:deriveRustContainsTruth", oracles.deriveRustContainsTruth(tree.rootNode))

  let rels: any[] = []
  try {
    const res = await ASTEngine.parseFile(file, content)
    rels = res.relationships ?? []
  } catch (e) {
    console.log(`  analyzer threw: ${String(e).slice(0, 120)}`)
  }

  const labels = [...new Set([...producers.map((p) => p.label), ...rels.map((r) => String(r.type ?? r.relationshipType ?? ""))])].sort()
  for (const label of labels) {
    if (!wanted(label)) continue
    const truth = producers.filter((p) => p.label === label)
    const mine = rels.filter((r) => String(r.type ?? r.relationshipType ?? "") === label)
    console.log(`\n  [${label}] oracle=${truth.length} analyzer=${mine.length}`)
    const byWho = new Map<string, number>()
    for (const p of truth) byWho.set(p.who, (byWho.get(p.who) ?? 0) + 1)
    for (const [w, n] of [...byWho.entries()].sort()) console.log(`    truth by ${w}: ${n}`)
    const truthTargets = new Set(truth.map((p) => p.target))
    const mineTargets = new Set(mine.map((r) => String(r.target ?? r.to ?? r.toSymbol ?? "")))
    const onlyTruth = [...truthTargets].filter((t) => !mineTargets.has(t)).slice(0, 12)
    const onlyMine = [...mineTargets].filter((t) => !truthTargets.has(t)).slice(0, 12)
    if (onlyTruth.length) console.log(`    truth-only targets: ${onlyTruth.join(" ")}`)
    if (onlyMine.length) console.log(`    analyzer-only targets: ${onlyMine.join(" ")}`)
    if (!onlyTruth.length && !onlyMine.length) console.log(`    target sets agree`)
  }
  tree.delete?.()
}