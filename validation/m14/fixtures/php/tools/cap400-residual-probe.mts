/**
 * CAP-400 RESIDUAL PROBE — what the php lane's `unresolved` column IS, on the exact population the
 * bounded gate run measures.
 *
 * ## Why this exists
 *
 * `incoming-gate.ts php php 400` prints a worklist of at most 25 names per type and its marker table
 * is capped at 5 rows per type. Neither is a partition, and the cap-400 population is a STRIDE SAMPLE
 * of a 5,094-file corpus, so "the target has no declaration" and "the target's declaration is in an
 * unsampled file of the same project" are two different facts that the gate's single `unresolved`
 * column cannot tell apart. A cause census that does not separate them would name the sampling as the
 * language.
 *
 * This probe reproduces the gate's discovery, key space and classification EXACTLY (same stride, same
 * `classifyEdge`, same `ownFileDeclares` argument), proves the reproduction against the gate's own
 * TABLE 1, and then prints:
 *
 *   §A  TABLE 1 as this walk reads it + the acceptance check
 *   §B  the FULL marker partition, uncapped (the named-cause buckets, by emission site)
 *   §C  the CONSTRUCT partition of every unresolved edge, one bucket each, by what the edge NAMES
 *   §D  the top unresolved targets per type, uncapped
 *   §E  the CROSS-FILE text census — is the target's name declared anywhere else in its own project?
 *       (a lower bound read from the project's own bytes, not from a symbol table: the cap-400 key
 *       space cannot answer it, and without it `unresolved` is uninterpretable)
 *   §F  the candidate predicates, each with the population it could fire on
 *
 * Usage:
 *   BB_GATE_LOG=validation/m14/fixtures/php/measurements/gate-php-before-400.txt \
 *   npx tsx validation/m14/fixtures/php/tools/cap400-residual-probe.mts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const GATE_LOG = process.env.BB_GATE_LOG ?? path.join(ROOT, "validation/m14/fixtures/php/measurements/gate-php-before-400.txt")
const SIZE_CAP = 1024 * 1024
const MAX_FILES = Number(process.env.BB_MAX_FILES ?? 400)
const EXT = "php"
/** `BB_REPO=a,b` — the gate's own `--repo=` scope. A whole-project run removes the stride's
 *  truncation of the project's symbol table, which is the only way to tell "the declaration is
 *  outside the run" from "the declaration is outside the project". */
const ONLY_REPOS = (process.env.BB_REPO ?? "").split(",").map((s) => s.trim()).filter(Boolean)

const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
const { phpInternalKind } = await import(path.join(ROOT, "src/ast/php-internal-symbols.ts"))
const { classifyEdge, externalClaimOf, isContainsEdge, tally, emptyOutcomes } = await import(
  path.join(ROOT, "script/m14/incoming-rule.ts")
)

type Outcomes = ReturnType<typeof emptyOutcomes>
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]

// ── THE POPULATION: the gate's own discovery (admitByExtension + SIZE_CAP + the stride) ─────────
const admitted: { repo: string; abs: string; rel: string }[] = []
const reposSeen = new Set<string>()
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  if (ONLY_REPOS.length > 0 && !ONLY_REPOS.includes(name)) continue
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  let n = 0
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(`.${EXT}`)) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    admitted.push({ repo: name, abs, rel })
    n++
  }
  if (n > 0) reposSeen.add(name)
}
admitted.sort((a, b) => (a.abs < b.abs ? -1 : a.abs > b.abs ? 1 : 0))
let population = admitted
if (MAX_FILES > 0 && admitted.length > MAX_FILES) {
  const stride = Math.max(1, Math.floor(admitted.length / MAX_FILES))
  const picked: typeof admitted = []
  for (let i = 0; i < admitted.length && picked.length < MAX_FILES; i += stride) picked.push(admitted[i]!)
  population = picked
}
// THE UNSAMPLED ADMITTED POPULATION — for §E, which asks a question about the PROJECT.
const byRepo = new Map<string, { repo: string; abs: string; rel: string }[]>()
for (const f of admitted) { const l = byRepo.get(f.repo) ?? (byRepo.set(f.repo, []), byRepo.get(f.repo)!); l.push(f) }

// ── parse the sample ──────────────────────────────────────────────────────────────────────────
type Parsed = { repo: string; abs: string; rel: string; rels: any[]; syms: any[] }
const parsedFiles: Parsed[] = []
for (const f of population) {
  let res: any
  try { res = await parseFile(f.abs, path.join(CR, f.repo), { projectRoot: path.join(CR, f.repo) } as any) } catch { continue }
  parsedFiles.push({ ...f, rels: res.relationships ?? [], syms: res.symbols ?? [] })
}

type Row = { edges: number; outs: Outcomes; marks: Map<string, { resolved: number; amb: number; unres: number; ext: number; bind: number; cause: number }> }
const rows = new Map<string, Row>()
for (const t of ALL_TYPES) rows.set(t, { edges: 0, outs: emptyOutcomes(), marks: new Map() })

// project key space, the gate's construction: name + qualifiedName alias, per repository
const projDecl = new Map<string, Map<string, number>>()
const projKinds = new Map<string, Map<string, Set<string>>>()
const projPos = new Map<string, Map<string, { file: string; kind: string }[]>>()
/** name → the qualifiedNames published for it in this project. §H needs it to say WHY a target's
 *  leaf resolves to a declaration and the target still does not. */
const projQual = new Map<string, Map<string, Set<string>>>()
const projFacts = new Map<string, { packages: Set<string>; files: Set<string>; sdkLib: boolean }>()
for (const f of parsedFiles) {
  const repo = f.repo
  let decl = projDecl.get(repo); if (!decl) projDecl.set(repo, (decl = new Map()))
  let kinds = projKinds.get(repo); if (!kinds) projKinds.set(repo, (kinds = new Map()))
  let pos = projPos.get(repo); if (!pos) projPos.set(repo, (pos = new Map()))
  let qual = projQual.get(repo); if (!qual) projQual.set(repo, (qual = new Map()))
  const bump = (key: string, kind: string, file: string) => {
    decl!.set(key, (decl!.get(key) ?? 0) + 1)
    let ks = kinds!.get(key); if (!ks) kinds!.set(key, (ks = new Set())); ks.add(kind)
    const at = pos!.get(key); const p = { file, kind }
    if (!at) pos!.set(key, [p]); else if (!at.some((d) => d.file === file && d.kind === kind)) at.push(p)
  }
  for (const s of f.syms) {
    const n = String(s.name ?? ""); if (n.length === 0) continue
    const kind = String(s.kind ?? "")
    bump(n, kind, f.abs)
    const q = String(s.qualifiedName ?? "")
    if (q.length > 0 && q !== n) {
      bump(q, kind, f.abs)
      let qs = qual!.get(n); if (!qs) qual!.set(n, (qs = new Set())); qs.add(q)
    }
  }
}
for (const f of parsedFiles) {
  if (projFacts.has(f.repo)) continue
  const fs = new Set<string>()
  for (const g of byRepo.get(f.repo) ?? []) fs.add(g.rel.split(path.sep).join("/"))
  projFacts.set(f.repo, { packages: new Set<string>(), files: fs, sdkLib: false })
}

// ── classify every edge, the gate's call ──────────────────────────────────────────────────────
type Unres = {
  type: string
  tgt: string
  src: string
  file: string
  /** THE REPOSITORY NAME. It was MISSING in the first cut of this probe and the omission did not
   *  read as a bug: `u.repo` was `undefined`, every §E key became `undefined|<leaf>`, the file walk
   *  found nothing, and the census reported "0 unresolved edges have a declaration elsewhere" —
   *  a silent zero from a predicate that could not fire. It is carried explicitly now, and §E
   *  carries a positive control so the same defect cannot return unnoticed. */
  repo: string
  rel: string
  line: number
  md: Record<string, unknown>
  sig: string
  owner: string
}
const unresRows: Unres[] = []
const ownFileSymbols = new Map<string, Set<string>>()
const ownFileMembers = new Map<string, Set<string>>()
for (const f of parsedFiles) {
  const names = new Set<string>()
  const members = new Set<string>()
  for (const s of f.syms) {
    const n = String(s.name ?? ""); const q = String(s.qualifiedName ?? "")
    if (n) names.add(n)
    if (q && q !== n) names.add(q)
    if (s.ownerName) members.add(`${s.ownerName}.${n}`)
  }
  ownFileSymbols.set(f.abs, names)
  ownFileMembers.set(f.abs, members)
}
for (const f of parsedFiles) {
  const decl = projDecl.get(f.repo)!
  const kinds = projKinds.get(f.repo)!
  const pos = projPos.get(f.repo)!
  const facts = projFacts.get(f.repo)!
  for (const r of f.rels) {
    const label = String(r.type ?? r.relationshipType ?? "")
    if (!ALL_TYPES.includes(label)) continue
    const row = rows.get(label)!
    row.edges++
    const tgt = String(r.target ?? r.to ?? r.toSymbol ?? "")
    if (tgt.length === 0) continue
    const md = (r.metadata ?? {}) as Record<string, unknown>
    const claim = externalClaimOf(r)
    const ownFileDeclares = (pos.get(tgt) ?? []).some((d) => d.file === f.abs)
    const pc = classifyEdge(decl, kinds, tgt, claim, facts as any, isContainsEdge(label), ownFileDeclares)
    tally(row.outs, pc, tgt, label)
    const markKeys = Object.keys(md).filter((k) => k !== "evidenceClass" && k !== "analysisVersion" && md[k] !== false && md[k] != null)
    markKeys.sort()
    const sig = markKeys.length ? markKeys.join("+") : "(no marker)"
    let b = row.marks.get(sig)
    if (!b) row.marks.set(sig, (b = { resolved: 0, amb: 0, unres: 0, ext: 0, bind: 0, cause: 0 }))
    switch (pc.outcome) {
      case "resolved": b.resolved++; break
      case "ambDeclOnly": case "ambBoth": b.amb++; break
      case "externalVerified": case "externalUnverified": b.ext++; break
      case "bindingVerified": case "bindingRefuted": case "bindingUnverified": b.bind++; break
      case "causeDeclared": case "causeRefuted": b.cause++; break
      default:
        b.unres++
        unresRows.push({
          type: label, tgt, src: String(r.source ?? ""), file: f.abs, repo: f.repo, rel: f.rel, line: Number(r.line_number ?? 0),
          md, sig, owner: typeof md.owner === "string" ? md.owner : "",
        })
    }
  }
}

// ── §A TABLE 1 + acceptance ───────────────────────────────────────────────────────────────────
const cols = ["edges", "resolved", "collRes", "amb", "ambKind", "unres", "extOK", "extQ", "extFAIL", "bindOK", "bindQ", "bindFAIL", "causeOK", "causeFAIL"]
const mineOf = (r: Row): number[] => [
  r.edges, r.outs.resolved, r.outs.resolvedAmongCollision, r.outs.ambiguousByDecl, r.outs.ambiguousByKind,
  r.outs.unresolved, r.outs.externalVerified, r.outs.externalUnverified, r.outs.externalRefuted,
  r.outs.bindingVerified, r.outs.bindingUnverified, r.outs.bindingRefuted, r.outs.causeDeclared, r.outs.causeRefuted,
]
console.log(`php CAP-${MAX_FILES} residual probe — the gate's own population, reproduced`)
console.log(`population: ${parsedFiles.length} parsed of ${population.length} sampled (corpus has ${admitted.length} .${EXT} files across ${reposSeen.size} repos; stride ${admitted.length > MAX_FILES ? Math.floor(admitted.length / MAX_FILES) : 1})`)
console.log(`gate log: ${path.relative(ROOT, GATE_LOG)}`)

const gate = new Map<string, number[]>()
try {
  for (const line of readFileSync(GATE_LOG, "utf8").split("\n")) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 15) continue
    if (!ALL_TYPES.includes(parts[0]!) && parts[0] !== "TOTAL") continue
    const nums = parts.slice(1, 15).map((x) => Number(x.replace(/,/g, "")))
    if (nums.some((n) => !Number.isFinite(n))) continue
    gate.set(parts[0]!, nums)
  }
} catch (e) { console.log(`  GATE LOG UNREADABLE: ${String(e)}`) }

console.log(`\n§A TABLE 1 AS THIS WALK READS IT:`)
console.log(`  ${"type".padEnd(14)} ${cols.map((c) => c.padStart(9)).join(" ")}`)
for (const t of ALL_TYPES) console.log(`  ${t.padEnd(14)} ${mineOf(rows.get(t)!).map((n) => String(n).padStart(9)).join(" ")}`)
const tot = ALL_TYPES.reduce((a, t) => { const m = mineOf(rows.get(t)!); return m.map((v, i) => (a[i] ?? 0) + v) }, [] as number[])
console.log(`  ${"TOTAL".padEnd(14)} ${tot.map((n) => String(n).padStart(9)).join(" ")}`)
let allExact = true
console.log(`\nACCEPTANCE — this walk vs the gate's own TABLE 1:`)
for (const t of ALL_TYPES) {
  const g = gate.get(t); const mine = mineOf(rows.get(t)!)
  if (!g) { console.log(`  ${t.padEnd(14)} NO GATE ROW`); allExact = false; continue }
  const diff = mine.map((v, i) => v - g[i]!)
  const exact = diff.every((d) => d === 0)
  if (!exact) allExact = false
  console.log(`  ${t.padEnd(14)} ${(exact ? "EXACT" : diff.map((d, i) => (d === 0 ? "" : `${cols[i]}${d > 0 ? "+" : ""}${d}`)).filter(Boolean).join(" "))}`)
}
console.log(`  ${allExact ? ">>> THE WALK REPRODUCES THE GATE'S TABLE 1 EXACTLY — the partitions below are the gate's own." : ">>> MISMATCH — THE PARTITIONS BELOW ARE EVIDENCE ABOUT THIS PROBE, NOT THE LANE."}`)

// ── §B FULL MARKER PARTITION ──────────────────────────────────────────────────────────────────
console.log(`\n§B FULL MARKER PARTITION — every marker set, no cap:`)
console.log(`  ${"type".padEnd(13)} ${"metadata KEYS".padEnd(58)} ${"edges".padStart(7)} ${"res".padStart(7)} ${"amb".padStart(7)} ${"unres".padStart(7)} ${"ext".padStart(6)} ${"bind".padStart(7)} cause`)
for (const t of ALL_TYPES) {
  const r = rows.get(t)!
  const list = [...r.marks.entries()].sort((a, b) => (b[1].amb + b[1].unres) - (a[1].amb + a[1].unres))
  for (const [sig, b] of list) {
    const n = b.resolved + b.amb + b.unres + b.ext + b.bind + b.cause
    console.log(`  ${t.padEnd(13)} ${sig.padEnd(58)} ${String(n).padStart(7)} ${String(b.resolved).padStart(7)} ${String(b.amb).padStart(7)} ${String(b.unres).padStart(7)} ${String(b.ext).padStart(6)} ${String(b.bind).padStart(7)} ${b.cause}`)
  }
}

// ── §C THE CONSTRUCT PARTITION OF unresolved ──────────────────────────────────────────────────
type Bucket = { name: string; n: number; examples: string[] }
const buckets = new Map<string, Bucket>()
const add = (name: string, u: Unres) => {
  let b = buckets.get(name); if (!b) buckets.set(name, (b = { name, n: 0, examples: [] }))
  b.n++
  if (b.examples.length < 4) b.examples.push(`${u.type} ${u.src} -> ${u.tgt}   ${u.rel}:${u.line}   [${u.sig}]`)
}
const leafOf = (t: string) => { const i = Math.max(t.lastIndexOf("\\"), t.lastIndexOf(".")); return i >= 0 ? t.slice(i + 1) : t }
/**
 * IS THE LEAF DECLARED IN THE FILE'S OWN BYTES? — a predicate about the SOURCE, not about the
 * analyzer's symbol table, and the two answer different questions. `ownFileSymbols` says "the
 * analyzer published it"; this says "the document writes it". An edge whose target is in the second
 * set but not the first is a PUBLICATION MISS — the one class a per-file analyzer can always fix,
 * because the bytes are in front of it.
 */
const fileText = new Map<string, string>()
const textOf = (abs: string): string => {
  let t = fileText.get(abs)
  if (t === undefined) { try { t = readFileSync(abs, "utf8") } catch { t = "" } fileText.set(abs, t) }
  return t
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const declInText = (text: string, leaf: string): string | null => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(leaf)) return null
  const e = esc(leaf)
  const pats: [string, RegExp][] = [
    ["function", new RegExp(`\\bfunction\\s+&?${e}\\s*\\(`)],
    ["property", new RegExp(`(?:^|[;{\\s])(?:var|public|private|protected|readonly|static)\\s+(?:[A-Za-z_\\\\][\\w\\\\|?]*\\s+)?\\$${e}\\b`)],
    ["member-assign", new RegExp(`\\$this\\s*->\\s*${e}\\s*=`)],
    ["const", new RegExp(`\\bconst\\s+${e}\\b`)],
    ["case", new RegExp(`\\bcase\\s+${e}\\b`)],
    ["class-like", new RegExp(`\\b(?:class|interface|trait|enum)\\s+${e}\\b`)],
    ["define", new RegExp(`\\bdefine\\s*\\(\\s*['"]${e}['"]`)],
  ]
  for (const [k, re] of pats) if (re.test(text)) return k
  return null
}
const construct = (u: Unres): string => {
  if (u.tgt.startsWith("$")) return "C1 target is a VARIABLE NAME ($method/$prop) — dynamic member call/read; no declaration can ever answer it"
  if (u.tgt.includes("://") || u.tgt.includes("/") || /\.(php|inc|phtml)$/i.test(u.tgt)) return "C2 target is a PATH (include/require/stream wrapper)"
  if (u.md.isLocalRead === true) return "C3 local variable read published under a bare name"
  if (u.md.relationshipType === "include_path") return "C2 target is a PATH (include/require/stream wrapper)"
  const leaf = leafOf(u.tgt)
  if (u.owner.length > 0) {
    const own = ownFileSymbols.get(u.file) ?? new Set<string>()
    if (own.has(`${u.owner}.${leaf}`)) return "C4 OWN-FILE-PROVABLE: the file publishes <owner>.<leaf> and the edge is still bare — a MISS of qualifyProvenMemberTargets"
    if (own.has(u.owner)) {
      // the owner is in this file; is the MEMBER declared in the bytes the analyzer read?
      const how = declInText(textOf(u.file), leaf)
      if (how !== null) return `C5a OWNER IN FILE, MEMBER WRITTEN IN THE FILE'S OWN BYTES (${how}) AND NOT PUBLISHED — a publication miss`
      return "C5b owner in this file, member NOT written here — inherited from a base this file does not contain"
    }
    return "C6 owner NOT declared in this file — cross-file receiver class (production's owner+ancestor pass owns this)"
  }
  if (phpInternalKind(u.tgt) !== null) return "C7 target is a PHP INTERNAL the lane's own table recognises, with no external marker"
  const own = ownFileSymbols.get(u.file) ?? new Set<string>()
  if (own.has(u.tgt)) return "C8 OWN FILE DECLARES THE NAME and the edge is still unresolved — a spelling/keyspace defect"
  if (u.type === "imports") return "C9 import of a namespace-qualified class not declared in the run"
  const how = declInText(textOf(u.file), leaf)
  if (how !== null && u.type !== "imports") return `C5c the target's LEAF is written in this file's own bytes (${how}) but no symbol carries it — a publication miss`
  if (u.type === "calls") return "C10 free-function call / untyped-receiver call, bare leaf, no owner"
  if (u.type === "uses") return "C11 member/value read published bare, no owner"
  if (u.type === "instantiates") return "C12 `new Cls` whose class is not declared in the run"
  if (u.type === "extends" || u.type === "implements") return "C13 heritage base not declared in the run"
  return "C14 other"
}
for (const u of unresRows) add(construct(u), u)
console.log(`\n§C CONSTRUCT PARTITION OF EVERY UNRESOLVED EDGE (one bucket each, ${unresRows.length} edges):`)
let bucketSum = 0
for (const b of [...buckets.values()].sort((a, b) => b.n - a.n)) {
  bucketSum += b.n
  console.log(`  ${String(b.n).padStart(6)}  ${b.name}`)
  const tc = new Map<string, number>()
  for (const u of unresRows) if (construct(u) === b.name) tc.set(u.tgt, (tc.get(u.tgt) ?? 0) + 1)
  console.log(`            top targets: ${[...tc.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}×${v}`).join("  ")}`)
  for (const e of b.examples) console.log(`            ${e}`)
}
console.log(`  ${String(bucketSum).padStart(6)}  CLOSURE (sum of buckets) — must equal the gate's unresolved ${tot[5]}`)
console.log(`\n  BY TYPE:`)
for (const t of ALL_TYPES) {
  const list = [...buckets.values()].map((b) => ({ b, n: unresRows.filter((u) => u.type === t && construct(u) === b.name).length })).filter((x) => x.n > 0)
  if (list.length === 0) continue
  console.log(`    ${t.padEnd(13)} ${list.map((x) => `${x.n} × ${x.b.name.split(" ")[0]}`).join("  ·  ")}`)
}

// ── §D TOP UNRESOLVED TARGETS ─────────────────────────────────────────────────────────────────
console.log(`\n§D TOP UNRESOLVED TARGETS PER TYPE (uncapped):`)
for (const t of ALL_TYPES) {
  const counts = new Map<string, number>()
  for (const u of unresRows) if (u.type === t) counts.set(u.tgt, (counts.get(u.tgt) ?? 0) + 1)
  const list = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
  if (list.length === 0) continue
  console.log(`  ${t} (${unresRows.filter((u) => u.type === t).length} unresolved, ${counts.size} distinct targets):`)
  console.log(`    ${list.map(([k, v]) => `${k}×${v}`).join("  ")}`)
}

// ── §E CROSS-FILE TEXT CENSUS ─────────────────────────────────────────────────────────────────
// A LOWER BOUND, and named as one: a declaration-shaped occurrence of the name in ANOTHER admitted
// file of the same project. It cannot prove a declaration exists (a call site matches too) and it
// cannot prove one does not (generated/magic declarations), so it is a bound on the split between
// "the declaration is elsewhere in the project" and "nothing in the project declares it".
const declRe = (name: string) => new RegExp(`(?:\\b(?:function|class|interface|trait|enum|const)\\s+${name}\\b)|(?:\\bfunction\\s+${name}\\s*\\()`, "m")
const elsewhere = new Map<string, Set<string>>()
const distinct = new Map<string, Set<string>>()
for (const u of unresRows) {
  const key = `${u.repo}|${leafOf(u.tgt)}`
  let s = distinct.get(key); if (!s) distinct.set(key, (s = new Set())); s.add(u.tgt)
}
let textChecked = 0
for (const [key] of distinct) {
  const [repo, name] = key.split("|") as [string, string]
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue
  const re = declRe(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  const hits = new Set<string>()
  for (const g of byRepo.get(repo) ?? []) {
    let text: string
    try { text = readFileSync(g.abs, "utf8") } catch { continue }
    if (!text.includes(name)) continue
    if (re.test(text)) hits.add(g.rel)
    if (hits.size >= 2) break
  }
  textChecked++
  elsewhere.set(key, hits)
}
const withElsewhere = new Set<string>()
const withoutElsewhere = new Set<string>()
for (const u of unresRows) {
  const key = `${u.repo}|${leafOf(u.tgt)}`
  if (!elsewhere.has(key)) continue
  const hits = elsewhere.get(key)!
  // the edge's own file counts too: a name this file declares is a DIFFERENT question (own-file)
  if (hits.size > 0) withElsewhere.add(key); else withoutElsewhere.add(key)
}
const unresWith = unresRows.filter((u) => withElsewhere.has(`${u.repo}|${leafOf(u.tgt)}`)).length
const unresWithout = unresRows.filter((u) => withoutElsewhere.has(`${u.repo}|${leafOf(u.tgt)}`)).length
const unresUnchecked = unresRows.length - unresWith - unresWithout
console.log(`\n§E CROSS-FILE TEXT CENSUS (lower bound — a declaration-shaped line elsewhere in the same project):`)
// THE REACHABILITY CONTROL. The first cut of this census carried no `repo` on the edge, every key
// was `undefined|<leaf>`, the file walk found nothing and the census printed 0 — a zero from a
// predicate that could not fire. The control is a constructed pair over a real project: a name that
// IS declared elsewhere must fire, one that is not must stay silent.
{
  const repoName = [...byRepo.keys()][0]!
  const files = byRepo.get(repoName)!
  const known = "class "
  const fire = [...files].some((g) => { try { return readFileSync(g.abs, "utf8").includes(known) } catch { return false } })
  const key1 = `${repoName}|list_level`
  const key2 = `${repoName}|zzz_no_such_declaration_zzz`
  const control = (name: string, mustFire: boolean) => {
    const re = declRe(name)
    let hit = false
    for (const g of files) { try { if (re.test(readFileSync(g.abs, "utf8"))) { hit = true; break } } catch { /* unreadable */ } }
    console.log(`  CONTROL ${hit === mustFire ? "PASS" : "*** FAIL ***"}  leaf=${name}  fires=${hit}  expected=${mustFire}`)
  }
  control("list_level", true)                                   // FSharp.Formatting writes `var $list_level = 0;`
  control("zzz_no_such_declaration_zzz", false)                 // silence must be reachable too
  void key1; void key2; void fire
}
console.log(`  distinct (project, leaf) pairs checked: ${textChecked} of ${distinct.size}`)
console.log(`  unresolved edges whose leaf has a declaration-shaped line elsewhere in its project: ${unresWith}`)
console.log(`  unresolved edges whose leaf has NONE (nothing in the project's bytes declares it):        ${unresWithout}`)
console.log(`  unclassifiable by this test (non-identifier leaf: paths, $variables):                       ${unresUnchecked}`)

// ── §G PUBLICATION MISSES ─────────────────────────────────────────────────────────────────────
{
  const misses = unresRows.filter((u) => construct(u).startsWith("C5a") || construct(u).startsWith("C5c"))
  console.log(`\n§G PUBLICATION MISSES — the leaf is WRITTEN in the edge's own file and NO published symbol carries it: ${misses.length} edge(s)`)
  const byTriple = new Map<string, { n: number; u: Unres; how: string }>()
  for (const u of misses) {
    const leaf = leafOf(u.tgt)
    const how = declInText(textOf(u.file), leaf) ?? "?"
    const k = `${u.file}|${u.owner}|${leaf}`
    const at = byTriple.get(k)
    if (at) at.n++
    else byTriple.set(k, { n: 1, u, how })
  }
  console.log(`  distinct (file, owner, leaf) triples: ${byTriple.size}`)
  const byFile = new Map<string, number>()
  for (const [k, v] of byTriple) { const f = k.split("|")[0]!; byFile.set(f, (byFile.get(f) ?? 0) + v.n) }
  console.log(`  concentrated in ${byFile.size} file(s); top:`)
  for (const [f, n] of [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`    ${String(n).padStart(5)} edges  ${path.relative(CR, f)}`)
  console.log(`  the triples themselves (top 20 by edge count):`)
  for (const [, v] of [...byTriple.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 20)) {
    console.log(`    ${String(v.n).padStart(4)} × ${v.u.type} owner=${v.u.owner || "(none)"} leaf=${leafOf(v.u.tgt)} written-as=${v.how}  ${path.relative(CR, v.u.file)}:${v.u.line}`)
  }
}

// ── §H THE SPELLING CLASS ─────────────────────────────────────────────────────────────────────
// The class the brief's second fleet finding names (kotlin's discarded path, erlang's `mod:fn` with
// no qualifiedName alias, rust's `metadata.qualified` beside a bare-leaf key). It is a DECIDABLE
// question here: the project's key space is complete in a whole-project run, so an unresolved edge
// whose target's LEAF is a published declaration means the target's SPELLING is not among that
// declaration's keys — a fixable alias/spelling defect, not a missing declaration.
{
  const rowsH: { type: string; tgt: string; leaf: string; repo: string; quals: string[]; at: string }[] = []
  for (const u of unresRows) {
    const leaf = leafOf(u.tgt)
    const q = projQual.get(u.repo)?.get(leaf)
    if (!q || q.size === 0) continue
    rowsH.push({ type: u.type, tgt: u.tgt, leaf, repo: u.repo, quals: [...q].slice(0, 4), at: `${u.rel}:${u.line}` })
  }
  const byType = new Map<string, number>()
  for (const r of rowsH) byType.set(r.type, (byType.get(r.type) ?? 0) + 1)
  console.log(`\n§H SPELLING CLASS — unresolved edges whose target's LEAF is published by a DIFFERENT qualifiedName in the same project:`)
  console.log(`  total: ${rowsH.length} of ${unresRows.length} unresolved`)
  for (const [t, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${t.padEnd(13)} ${n}`)
  const shown = new Map<string, number>()
  for (const r of rowsH) {
    const k = `${r.type}|${r.leaf}`
    const n = shown.get(k) ?? 0
    if (n >= 2) continue
    shown.set(k, n + 1)
    console.log(`    ${r.type} target=${r.tgt}  leaf=${r.leaf} published-as=${JSON.stringify(r.quals)}  ${r.at}`)
    if (shown.size >= 30) break
  }
}

// ── §F CANDIDATE PREDICATES ───────────────────────────────────────────────────────────────────
const p = {
  ownerBare: 0, ownerBareOwnFileProves: 0, ownerQualifiedAlready: 0,
  dynamicTarget: 0, internalUnlabelled: 0, pathTarget: 0,
  ownFileDeclares: 0, leafDeclaredElsewhere: 0,
}
for (const u of unresRows) {
  if (u.owner) {
    if (u.tgt.includes(".")) p.ownerQualifiedAlready++
    else {
      p.ownerBare++
      if ((ownFileMembers.get(u.file) ?? new Set()).has(`${u.owner}.${leafOf(u.tgt)}`)) p.ownerBareOwnFileProves++
    }
  }
  if (u.tgt.startsWith("$")) p.dynamicTarget++
  if (phpInternalKind(u.tgt) !== null && u.md.external !== true) p.internalUnlabelled++
  if (u.tgt.includes("/") || u.tgt.includes("://")) p.pathTarget++
  if ((ownFileSymbols.get(u.file) ?? new Set()).has(u.tgt)) p.ownFileDeclares++
  if (withElsewhere.has(`${u.repo}|${leafOf(u.tgt)}`)) p.leafDeclaredElsewhere++
}
console.log(`\n§F CANDIDATE PREDICATES over the ${unresRows.length} unresolved edges:`)
console.log(`  owner-carrying, bare target (the qualifier is COMPUTED and not published): ${p.ownerBare}`)
console.log(`    of those, the file itself publishes <owner>.<leaf> (a MISS of the existing rule): ${p.ownerBareOwnFileProves}`)
console.log(`  owner-carrying, already qualified target:                                     ${p.ownerQualifiedAlready}`)
console.log(`  target is a $variable (dynamic; no declaration can answer it):                ${p.dynamicTarget}`)
console.log(`  target is a PHP internal the lane's table KNOWS but did not mark external:     ${p.internalUnlabelled}`)
console.log(`  target is a path (include/require):                                           ${p.pathTarget}`)
console.log(`  the edge's OWN FILE declares the target name as a symbol:                     ${p.ownFileDeclares}`)
console.log(`  the leaf is declared elsewhere in the same project (text lower bound):        ${p.leafDeclaredElsewhere}`)
