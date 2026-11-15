/**
 * r LANE — THE MISSING-DECLARATION PROBE.
 *
 * WHY THIS EXISTS. Every unresolved edge's target has ZERO declarations in its project, BY
 * CONSTRUCTION (`classifyEdge` reaches `unresolved` only on `decls === 0`). So there are exactly
 * three ways an analyzer can answer one:
 *
 *   (1) DECLARE MORE — the analyzer failed to publish a symbol the file really declares, so the
 *       call to it has nothing to bind to. THIS PROBE MEASURES THAT, and it measures it WITHOUT
 *       the analyzer's own symbol table: it re-reads the SOURCE TEXT and looks for the
 *       declaration form by regex. A check that used the analyzer's symbols could not see this
 *       gap at all — which is why the lane's own whole-population line ("0 of 24,021 unresolved
 *       targets have their bare name published in ANY repository") cannot rule it out.
 *   (2) RE-SPELL THE TARGET to a spelling that IS declared (the leaf rebase — priced in
 *       cause-census.ts, and the reason the brief warns about collRes).
 *   (3) CLAIM IT — an external/namespace claim the arbiter verifies.
 *
 * READ-ONLY. `bun run validation/m14/fixtures/r/undeclared-probe.ts [maxFiles]`.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { classifyEdge, externalClaimOf, isContainsEdge } from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const MAX_FILES = Number(process.argv[2] ?? 400)
const SIZE_CAP = 1024 * 1024

function admit(rel: string, exts: string[], lang: string): boolean {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (exts.some((e) => low.endsWith(`.${e}`))) return true
  return exts.some((e) => base === e) && detectLanguageFromPath(rel) === lang
}

function discover(exts: string[], maxFiles: number): { files: string[]; total: number } {
  const found: string[] = []
  for (const name of readdirSync(CR).sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!admit(rel, exts, "r")) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      found.push(abs)
    }
  }
  found.sort()
  const total = found.length
  if (maxFiles <= 0 || total <= maxFiles) return { files: found, total }
  const stride = Math.max(1, Math.floor(total / maxFiles))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < maxFiles; i += stride) picked.push(found[i])
  return { files: picked, total }
}

/** R's own ways of giving a name a definition, as SOURCE TEXT rather than as a tree. */
function declarationForms(name: string): RegExp[] {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return [
    new RegExp(`(^|[^A-Za-z0-9._$])${n}\\s*(<<-|<-|=)\\s*function`, "m"),
    new RegExp(`(^|[^A-Za-z0-9._$])${n}\\s*(<<-|<-|=)\\s*[(]`, "m"),
    new RegExp(`(^|[^A-Za-z0-9._$])${n}\\s*(<<-|<-|=)`, "m"),
    new RegExp(`["']${n}["']\\s*(<<-|<-|=)`, "m"),
    new RegExp(`setMethod\\s*\\(\\s*["']${n}["']`, "m"),
    new RegExp(`setGeneric\\s*\\(\\s*["']${n}["']`, "m"),
    new RegExp(`(^|[^A-Za-z0-9._$])${n}\\s*<-\\s*(R6Class|setClass|setRefClass|new_class|S7::new_class)`, "m"),
    new RegExp(`(^|[^A-Za-z0-9._$])${n}\\s*=\\s*(R6Class|setClass|new_class)`, "m"),
  ]
}

async function main(): Promise<void> {
  const { files, total } = discover(["r"], MAX_FILES)
  const text = new Map<string, string>()
  const decl = new Map<string, Map<string, number>>()
  const kinds = new Map<string, Map<string, Set<string>>>()
  const repoOf = (f: string) => path.join(CR, (f.startsWith(CR) ? f.slice(CR.length + 1) : f).split(path.sep)[0])

  type Edge = { label: string; tgt: string; file: string; repo: string; outcome: string; md: any }
  const edges: Edge[] = []

  for (const f of files) {
    let r: any
    try { r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any) } catch { continue }
    if (!r) continue
    try { text.set(f, readFileSync(f, "utf8")) } catch { text.set(f, "") }
    const repo = repoOf(f)
    let d = decl.get(repo); if (!d) decl.set(repo, (d = new Map()))
    let k = kinds.get(repo); if (!k) kinds.set(repo, (k = new Map()))
    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      const name = String(s?.name ?? "")
      if (!name) continue
      d!.set(name, (d!.get(name) ?? 0) + 1)
      let ks = k!.get(name); if (!ks) k!.set(name, (ks = new Set())); ks.add(String(s?.kind ?? ""))
      const q = String(s?.qualifiedName ?? "")
      if (q && q !== name) { d!.set(q, (d!.get(q) ?? 0) + 1); let qs = k!.get(q); if (!qs) k!.set(q, (qs = new Set())); qs.add(String(s?.kind ?? "")) }
    }
    for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
      const label = String(rel?.type ?? "")
      const tgt = String((rel as any)?.target ?? "")
      if (!tgt) continue
      edges.push({ label, tgt, file: f, repo, outcome: "", md: (rel as any)?.metadata ?? {} })
    }
  }

  for (const e of edges) {
    const claim = externalClaimOf({ type: e.label, target: e.tgt, metadata: e.md })
    e.outcome = classifyEdge(decl.get(e.repo)!, kinds.get(e.repo)!, e.tgt, claim, undefined, isContainsEdge(e.label)).outcome
  }

  // ---- (1) DID THE ANALYZER MISS A DECLARATION THE SOURCE TEXT HAS?
  const rows = new Map<string, { n: number; undeclared: number; examples: string[] }>()
  let unresTotal = 0
  for (const e of edges) {
    if (e.outcome !== "unresolved") continue
    unresTotal++
    const name = e.tgt
    // Only a BARE or DOT-NAMED target can be a same-file declaration spelling: a qualified target
    // (`pkg::fn`, `obj$m`) is not the name an R assignment writes.
    if (/::|:::|[$@]/.test(name)) continue
    const src = text.get(e.file) ?? ""
    let hit = false
    for (const re of declarationForms(name)) { if (re.test(src)) { hit = true; break } }
    let row = rows.get(e.label)
    if (!row) rows.set(e.label, (row = { n: 0, undeclared: 0, examples: [] }))
    row.n++
    if (hit) {
      row.undeclared++
      if (row.examples.length < 8) row.examples.push(`${name} @ ${path.relative(CR, e.file)}`)
    }
  }
  console.log(`r MISSING-DECLARATION PROBE — ${files.length} of ${total} .r files (stride); unresolved edges ${unresTotal}`)
  console.log(`a hit = the target's name IS written as a declaration IN THE EDGE'S OWN FILE, by source text,`)
  console.log(`while the project key space holds ZERO declarations of it.`)
  console.log(`type          unresolved(bare/dot)   text-declares-it   share`)
  for (const [label, row] of [...rows.entries()].sort((a, b) => b[1].undeclared - a[1].undeclared)) {
    console.log(`  ${label.padEnd(12)} ${String(row.n).padStart(8)} ${String(row.undeclared).padStart(18)}   ${(100 * row.undeclared / Math.max(1, row.n)).toFixed(1)}%`)
    for (const ex of row.examples) console.log(`        ${ex}`)
  }
}

main().catch((e) => { console.error(e); process.exit(2) })
