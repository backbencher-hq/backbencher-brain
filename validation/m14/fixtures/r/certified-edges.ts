/**
 * r LANE — THE CERTIFIED EDGES, WITH THEIR SOURCE LINES, AND THE EDGES THE CLAIM RECLASSIFIED.
 *
 * STEP 5's evidence. The claim this lane now attaches is NOT a resolution, so the honest
 * hand-check is over the edges it makes ANSWERABLE (`unresolved -> externalVerified`) and over the
 * edges it takes away from `resolved`/`amb(decl)` — both are printed here from the REAL analyzer
 * through production `parseFile`, with the source line each edge sits on, so a reader can open the
 * file and check what the code actually means.
 *
 * READ-ONLY. `bun run validation/m14/fixtures/r/certified-edges.ts [maxFiles] [--all]`.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { classifyEdge, externalClaimOf, isContainsEdge } from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const MAX_FILES = Number(process.argv[2] ?? 400)
const SHOW_ALL = process.argv.includes("--all")
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

type Cert = { file: string; rel: string; line: number; label: string; sub: string; tgt: string; src: string; before: string; after: string }

async function main(): Promise<void> {
  const { files, total } = discover(["r"], MAX_FILES)
  const repoOf = (f: string) => path.join(CR, (f.startsWith(CR) ? f.slice(CR.length + 1) : f).split(path.sep)[0])
  const decl = new Map<string, Map<string, number>>()
  const kinds = new Map<string, Map<string, Set<string>>>()
  /** project -> target -> the files that declare it (for naming what a reclassified edge loses) */
  const declWhere = new Map<string, Map<string, Set<string>>>()
  const certs: Cert[] = []

  // TWO PASSES. Pass 1 builds the project key space; pass 2 classifies each edge TWICE — once with
  // the claim the analyzer attached and once with it removed — so the reclassification is measured
  // rather than inferred from the two gate runs.
  type Raw = { file: string; rel: string; line: number; label: string; tgt: string; md: Record<string, any> }
  const raw: Raw[] = []
  for (const f of files) {
    let r: any
    try { r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any) } catch { continue }
    if (!r) continue
    const repo = repoOf(f)
    let d = decl.get(repo); if (!d) decl.set(repo, (d = new Map()))
    let k = kinds.get(repo); if (!k) kinds.set(repo, (k = new Map()))
    let w = declWhere.get(repo); if (!w) declWhere.set(repo, (w = new Map()))
    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      const name = String(s?.name ?? "")
      if (!name) continue
      d!.set(name, (d!.get(name) ?? 0) + 1)
      let ks = k!.get(name); if (!ks) k!.set(name, (ks = new Set())); ks.add(String(s?.kind ?? ""))
      let ws = w!.get(name); if (!ws) w!.set(name, (ws = new Set())); ws.add(path.relative(CR, f))
      const q = String(s?.qualifiedName ?? "")
      if (q && q !== name) { d!.set(q, (d!.get(q) ?? 0) + 1); let qs = k!.get(q); if (!qs) k!.set(q, (qs = new Set())); qs.add(String(s?.kind ?? "")) }
    }
    let text = ""
    try { text = readFileSync(f, "utf8") } catch { /* a missing file is not a measurement */ }
    const lines = text.split("\n")
    for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
      const md = ((rel as any)?.metadata ?? {}) as Record<string, any>
      const tgt = String((rel as any)?.target ?? "")
      if (md.languageNamespace === undefined) continue
      const ln = Number((rel as any)?.line_number ?? (rel as any)?.line ?? 0) || 0
      certs.push({
        file: f, rel: path.relative(CR, f), line: ln, label: String(rel?.type ?? ""),
        sub: String(md.relationshipSubType ?? ""), tgt, src: (lines[ln - 1] ?? "").trim().slice(0, 120),
        before: "", after: "",
      })
      raw.push({ file: f, rel: path.relative(CR, f), line: ln, label: String(rel?.type ?? ""), tgt, md })
    }
  }

  const outcomeOf = (e: Raw, dropClaim: boolean): string => {
    const md = { ...e.md }
    if (dropClaim) delete md.languageNamespace
    const repo = repoOf(e.file)
    const claim = externalClaimOf({ type: e.label, target: e.tgt, metadata: md })
    return classifyEdge(decl.get(repo)!, kinds.get(repo)!, e.tgt, claim, undefined, isContainsEdge(e.label)).outcome
  }
  const reclassified: { e: Raw; before: string }[] = []
  for (let i = 0; i < certs.length; i++) {
    const e = raw[i]
    certs[i].after = outcomeOf(e, false)
    certs[i].before = outcomeOf(e, true)
    if (certs[i].before !== "unresolved") reclassified.push({ e, before: certs[i].before })
  }

  const byTarget = new Map<string, number>()
  for (const c of certs) byTarget.set(c.tgt, (byTarget.get(c.tgt) ?? 0) + 1)
  const gained = certs.filter((c) => c.before === "unresolved").length
  console.log(`r CERTIFIED EDGES — ${files.length} of ${total} .r files (stride); ${certs.length} edges carry metadata.languageNamespace`)
  console.log(`  outcome before the claim -> after :  unresolved -> externalVerified  : ${gained}`)
  console.log(`  reclassified (the claim took the outcome away from something else):  ${reclassified.length}`)
  for (const r of reclassified) {
    const w = declWhere.get(repoOf(r.e.file))?.get(r.e.tgt)
    console.log(`      ${r.before.padEnd(12)} -> externalVerified   ${r.e.tgt} @ ${r.e.rel}:${r.e.line}   [${r.e.label}/${r.e.md.relationshipSubType}]   declared in: ${[...(w ?? [])].join(", ")}`)
  }
  console.log(`\n  TOP TARGETS: ${[...byTarget.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([t, n]) => `${t}(${n})`).join(" | ")}`)
  console.log(`\n  SAMPLE (file:line · subtype · target · the source line the edge sits on)${SHOW_ALL ? " — ALL" : ""}:`)
  const shown = SHOW_ALL ? gained : 12
  let n = 0
  for (const c of certs) {
    if (c.before !== "unresolved") continue
    console.log(`    ${c.rel}:${c.line}  [${c.label}/${c.sub}] -> ${c.tgt}`)
    console.log(`        ${c.src}`)
    if (++n >= shown) break
  }
}

main().catch((e) => { console.error(e); process.exit(2) })
