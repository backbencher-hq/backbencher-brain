// Adjudication probe for the haskell M12 drift (2026-09-25).
//
// INSTRUMENT NOTE (2026-09-26, recorded rather than quietly fixed): the
// `collisions` heuristic below matches a symbol name against the REGEX
// `(where|let)` + whitespace + NAME, which also matches INSTANCE/CLASS `where`
// clauses (their first member, e.g. `instance Show Account where showsPrec …`) —
// its "shadowing binder" count is INFLATED (it reported 282 files; the tree
// measurement is 16 files / 67 names). For that class use
// script/m14/tmp/hs-local-identity.ts (direct children of
// local_binds/let/let_in), which also carries the before/after artifacts; this
// probe's floating-endpoint counts remain valid.
//
// The analyzer attributes calls made inside a `where`/`let`-local body to the
// LOCAL itself (`go -> go`) and lets locals resolve as call targets
// (`helper -> go`) — deliberately, per the 2026-09-03 HSD6/HSD19 wave — while
// emitting NO symbol for the local. The M12 truth for Negative.hs (authored
// 2026-08-18, before that wave) still says "where-locals are scoped noise: no
// symbol, no calls from their bodies".
//
// Before trusting the rule, measure its risk at corpus scale: the endpoint name
// is BARE (`go`), not scoped. If a file has both a where-local `go` and a
// module-level `go`, the two callables share one node in the graph.
//
// Usage: bun script/m14/tmp/haskell-local-calls-collision.ts <repoRoot> [...]
import { Parser, Language } from "web-tree-sitter"
import { RealHaskellAnalyzer } from "../../../src/ast/real-haskell-analyzer"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const ROOTS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["<corpus-root>/bb_tests/repositories/hledger"]

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const e of entries) {
    if (e === ".git" || e === "dist-newstyle" || e === "node_modules" || e === ".stack-work") continue
    const p = join(dir, e)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(p, out)
    else if (e.endsWith(".hs") || e.endsWith(".lhs")) out.push(p)
  }
  return out
}

interface Row {
  file: string
  edgesTotal: number
  floatingSource: number
  floatingTarget: number
  floatingNames: string[]
  collisions: string[]
}

async function main() {
  await Parser.init()
  const parser = new Parser()
  parser.setLanguage(await Language.load(new URL("../../../wasm/tree-sitter-haskell.wasm", import.meta.url).pathname))

  const files = ROOTS.flatMap((r) => walk(r)).sort()
  console.log(`files=${files.length} roots=${ROOTS.join(",")}`)

  const rows: Row[] = []
  const nameHistogram = new Map<string, number>()
  let parseFailed = 0
  const started = Date.now()

  for (const file of files) {
    let src: string
    try {
      src = readFileSync(file, "utf8")
    } catch {
      continue
    }
    const tree = parser.parse(src)
    if (!tree) {
      parseFailed++
      continue
    }
    let res: any
    try {
      res = new RealHaskellAnalyzer().analyze(tree.rootNode, src, file)
    } catch {
      parseFailed++
      tree.delete()
      continue
    }
    tree.delete()

    const symbolNames = new Set<string>()
    for (const s of res.symbols ?? []) if (s?.name) symbolNames.add(String(s.name))

    const calls = (res.relationships ?? []).filter((r: any) => String(r.type) === "calls")
    const floatingNames = new Set<string>()
    const collisions = new Set<string>()
    let floatingSource = 0
    let floatingTarget = 0

    for (const r of calls) {
      const s = String(r.source ?? "")
      const t = String(r.target ?? "")
      const sFloats = !symbolNames.has(s)
      const tFloats = !symbolNames.has(t)
      if (sFloats) {
        floatingSource++
        floatingNames.add(s)
        if (symbolNames.has(s)) collisions.add(s)
      }
      if (tFloats) {
        floatingTarget++
        floatingNames.add(t)
        if (symbolNames.has(t)) collisions.add(t)
      }
      if (sFloats && s) nameHistogram.set(s, (nameHistogram.get(s) ?? 0) + 1)
      if (tFloats && t) nameHistogram.set(t, (nameHistogram.get(t) ?? 0) + 1)
    }

    // A collision needs the name to be BOTH a module-level symbol and a floating
    // endpoint. Because `symbolNames` is the module-level set, a floating name in
    // it cannot happen by construction — so detect collisions the other way:
    // a module-level symbol whose name appears as a floating endpoint elsewhere
    // is impossible too. The real collision is a local shadowing a module symbol,
    // which shows up as: name IS a module-level symbol name AND the file also has
    // a local of that name. We approximate by re-scanning the source text for a
    // `where`/`let` binder of that name.
    for (const name of symbolNames) {
      if (!floatingNames.has(name)) {
        const re = new RegExp(`(where|let)\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)
        if (re.test(src) && new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(src)) {
          // module-level symbol AND a where/let binder of the same name: the
          // floating endpoint (if any) and the symbol share one node.
          const floatingOfThatName = calls.some((r: any) => String(r.source) === name || String(r.target) === name)
          if (!floatingOfThatName) collisions.add(`${name} (shadowed binder, no edge)`)
          else collisions.add(`${name} (shadowed binder, edge present)`)
        }
      }
    }

    if (calls.length && (floatingSource || floatingTarget || collisions.size)) {
      rows.push({
        file,
        edgesTotal: calls.length,
        floatingSource,
        floatingTarget,
        floatingNames: [...floatingNames].sort(),
        collisions: [...collisions].sort(),
      })
    }
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  const totalCalls = rows.reduce((a, r) => a + r.edgesTotal, 0)
  const totalFS = rows.reduce((a, r) => a + r.floatingSource, 0)
  const totalFT = rows.reduce((a, r) => a + r.floatingTarget, 0)
  const withCollision = rows.filter((r) => r.collisions.length)

  console.log(`\nfiles with any floating endpoint: ${rows.length} / ${files.length}  (parse failures ${parseFailed})`)
  console.log(`calls edges in those files: ${totalCalls}`)
  console.log(`  floating SOURCE (call attributed to a local body): ${totalFS}`)
  console.log(`  floating TARGET (call INTO a local):              ${totalFT}`)
  console.log(`files with a shadowing binder collision: ${withCollision.length}`)
  console.log(`elapsed ${elapsed}s`)

  console.log(`\n--- most common floating names (top 25) ---`)
  const hist = [...nameHistogram.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
  for (const [n, c] of hist) console.log(`  ${String(c).padStart(5)}  ${n}`)

  console.log(`\n--- collision examples (up to 20) ---`)
  for (const r of withCollision.slice(0, 20)) {
    console.log(`  ${r.file.replace(/^.*repositories\//, "")}  ${r.collisions.join(", ")}  [calls=${r.edgesTotal} fsrc=${r.floatingSource} ftgt=${r.floatingTarget}]`)
  }

  console.log(`\n--- worst floating-endpoint files (top 12) ---`)
  for (const r of [...rows].sort((a, b) => b.floatingSource + b.floatingTarget - (a.floatingSource + a.floatingTarget)).slice(0, 12)) {
    console.log(`  ${String(r.floatingSource).padStart(3)}/${String(r.floatingTarget).padStart(3)} of ${String(r.edgesTotal).padStart(4)}  ${r.file.replace(/^.*repositories\//, "")}  locals=[${r.floatingNames.slice(0, 8).join(",")}]`)
  }

  parser.delete()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
