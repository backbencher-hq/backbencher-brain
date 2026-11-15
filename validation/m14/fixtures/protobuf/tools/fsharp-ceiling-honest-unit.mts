/**
 * FSHARP'S NAME-CLAIM CEILING ON THE HONEST UNIT.
 *
 * The gate row on five WHOLE projects reads `imports 5,214 · resolved 973 (18.7%) · unresolved 2,862`,
 * against 2.9% on a 150-file stride — a 6.4x difference that vindicates measuring on the honest unit.
 * But that row says how many RESOLVE today; the CEILING is how many name something the project really
 * PUBLISHES. This measures the ceiling on the SAME five projects, parsing ALL their files, so the two
 * numbers share one population.
 *
 *   npx tsx validation/m14/fixtures/protobuf/tools/fsharp-ceiling-honest-unit.mts
 */
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
// The five WHOLE projects the Lead's honest-unit run used.
const REPOS = ["fantomas", "FSharpPlus", "FsToolkit.ErrorHandling", "FSharp.Data", "Paket"]
const EXTS = new Set(["fs", "fsi", "fsx"])
const SIZE_CAP = 1024 * 1024
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))

const isName = (t: string) => t.length > 0 && !t.includes("/") && !t.includes(" ") && !t.includes("://")

let files = 0, imports = 0, nameShaped = 0, published = 0, unresolvedNotPublished = 0
let publishedRes1 = 0, publishedAmb = 0, publishedNone = 0
let dotted = 0, dottedPublished = 0
const external = new Map<string, number>()
const publishedEx: string[] = []

for (const name of REPOS) {
  const repo = path.join(CR, name)
  try { if (!statSync(repo).isDirectory()) continue } catch { continue }
  const wanted: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      if (e === ".git" || e === "node_modules") continue
      const abs = path.join(d, e)
      let st: any
      try { st = statSync(abs) } catch { continue }
      if (st.isDirectory()) { walk(abs); continue }
      if (!EXTS.has(e.slice(e.lastIndexOf(".") + 1).toLowerCase())) continue
      if (st.size > SIZE_CAP) continue
      wanted.push(abs)
    }
  }
  walk(repo)
  if (wanted.length === 0) { process.stderr.write(`[skip] ${name}: no fsharp files\n`); continue }
  wanted.sort()
  const keys = new Set<string>()
  // declCount: the GATE'S OWN resolution predicate (1 -> resolved, >1 -> amb, 0 -> unresolved).
  const declCount = new Map<string, number>()
  const parsed: { rel: string; rels: any[] }[] = []
  for (const abs of wanted) {
    const rel = path.relative(repo, abs).split(path.sep).join("/")
    let res: any
    try { res = await parseFile(abs, repo, { projectRoot: repo } as any) } catch { continue }
    parsed.push({ rel, rels: res.relationships ?? [] })
    files++
    for (const s of res.symbols ?? []) {
      const n = String(s.name ?? ""); if (n.length > 0) { keys.add(n); declCount.set(n, (declCount.get(n) ?? 0) + 1) }
      const q = String(s.qualifiedName ?? ""); if (q.length > 0 && q !== n) { keys.add(q); declCount.set(q, (declCount.get(q) ?? 0) + 1) }
    }
  }
  let repoImports = 0
  for (const { rel, rels } of parsed) {
    for (const r of rels) {
      if (String(r.type) !== "imports") continue
      const t = String(r.target ?? "").trim()
      imports++; repoImports++
      if (!isName(t)) continue
      nameShaped++
      if (t.includes(".")) {
        dotted++
        if (keys.has(t)) dottedPublished++
      }
      const decls = declCount.get(t) ?? 0
      if (decls === 1) publishedRes1++
      else if (decls > 1) publishedAmb++
      else publishedNone++
      if (keys.has(t)) { published++; if (publishedEx.length < 6) publishedEx.push(`${t}   (${rel})`) }
      else {
        unresolvedNotPublished++
        const head = t.includes(".") ? t.slice(0, t.indexOf(".")) : t
        external.set(head, (external.get(head) ?? 0) + 1)
      }
    }
  }
  process.stderr.write(`[repo] ${name}: ${wanted.length} files, ${repoImports} imports, key space ${keys.size}\n`)
}
const pct = (n: number) => nameShaped > 0 ? `${((100 * n) / nameShaped).toFixed(1)}%` : "-"
console.log(`fsharp NAME-CLAIM CEILING — the HONEST UNIT (${REPOS.length} whole projects, ${files} files)`)
console.log(`  imports ${imports} · name-shaped ${nameShaped} (dotted ${dotted})`)
console.log(`  CEILING — name-shaped targets the project PUBLISHES: ${published} (${pct(published)})`)
console.log(`  not published (external/residue):                   ${unresolvedNotPublished} (${pct(unresolvedNotPublished)})`)
console.log(`  of the dotted, published:                           ${dottedPublished} of ${dotted}`)
console.log(`\ntop NOT-published prefixes:`)
console.log("  " + [...external].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}×${v}`).join("  "))
console.log(`\npublished examples:`)
for (const e of publishedEx) console.log(`  ${e}`)
console.log(`\nDECOMPOSED BY THE GATE'S OWN PREDICATE (declCount):`)
console.log(`  exactly ONE declaration  -> the gate's RESOLVED: ${publishedRes1}`)
console.log(`  MORE THAN ONE            -> the gate's AMBIGUOUS: ${publishedAmb}`)
console.log(`  none                     -> the gate's UNRESOLVED: ${publishedNone}`)
console.log(`\nTHE PAIR TO READ SIDE BY SIDE: gate row on this unit — imports 5,214 · resolved 973 (18.7%) · unresolved 2,862`)
