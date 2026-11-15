/**
 * SCALA UNRESOLVED CENSUS — what the 400-file gate residual is MADE OF, and what a
 * `qualifiedName` alias would do to it, priced BEFORE the analyzer is touched.
 *
 * ## Why this probe exists
 *
 * `bun run script/m14/incoming-gate.ts scala scala 400` reads 21,792 edges / 6,733 unresolved
 * against a 400-file stride of a 19,168-file corpus (≈2.1 % key space). The gate's marker table
 * partitions the residual by EMITTER, but two questions it cannot answer decide whether anything
 * is fixable:
 *
 *   1. Is an unresolved target declared SOMEWHERE in the project and merely outside the stride
 *      (an INSTRUMENT property), or declared NOWHERE in the corpus (an analyzer-facing gap)?
 *   2. The lane publishes ZERO `qualifiedName` aliases while its `overrides` emitter publishes
 *      targets spelled `Owner.member` (`real-scala-analyzer.ts:933,972,996`). If a member symbol
 *      carried `qualifiedName = "<owner>.<name>"`, which of those edges would bind — and would any
 *      bind CROSS-FILE, i.e. move into `arbitraryTwin`, the one class the task forbids growing?
 *
 * ## What it measures
 *
 *   A. the gate's own per-type columns reproduced under this probe's key-space model (sanity);
 *   B. the unresolved buckets by (type, target shape, in-corpus presence);
 *   C. the SIMULATED AFTER state with the alias published (scope-style `<owner>.<name>`), per type:
 *      unresolved -> resolved (same-file / cross-file), unresolved -> ambiguous, and any
 *      resolved -> anything movement (there must be none: an alias key is a NEW key);
 *   D. the exact binding-intent delta on the two axes the task judges (arbitraryTwin, intended);
 *   E. the newly-bound edges, printed with file:line, target, source and the answering declaration,
 *      so §5 of the report can hand-read them instead of trusting a count.
 *
 * POPULATION: the gate's own stride sample, discovered the same way (git ls-files, 1 MB cap,
 * sorted, stride = floor(total/maxFiles)), so every number is comparable to TABLE 1.
 *
 * Read-only: parses files and reads them; writes nothing.
 *
 * Run: bun run validation/m14/fixtures/scala/unresolved-census.mts
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const MAX_FILES = Number(process.env.MAX_FILES ?? 400)
const SIZE_CAP = 1024 * 1024

type Pos = { file: string; line: number }
type KeySpace = Map<string, Map<string, Pos[]>> // project -> key -> declaration positions

const PROJECTS = ["scala3", "cats-effect", "gql-sangria"]

/** The gate's admission test for this lane, spelled once. */
function isScala(rel: string): boolean {
  return rel.endsWith(".scala")
}

function discover(): { files: string[]; total: number; perRepo: Record<string, number> } {
  const found: string[] = []
  const perRepo: Record<string, number> = {}
  const all: string[] = []
  for (const name of readdirSync(CR).sort()) {
    const dir = path.join(CR, name)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0")
        .filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) {
      if (!isScala(rel)) continue
      const abs = path.join(dir, rel)
      try {
        if (statSync(abs).size > SIZE_CAP) continue
      } catch {
        continue
      }
      found.push(abs)
      perRepo[name] = (perRepo[name] ?? 0) + 1
    }
  }
  found.sort()
  all.push(...found)
  const total = found.length
  let files = found
  if (MAX_FILES > 0 && total > MAX_FILES) {
    const stride = Math.max(1, Math.floor(total / MAX_FILES))
    const picked: string[] = []
    for (let i = 0; i < found.length && picked.length < MAX_FILES; i += stride) picked.push(found[i])
    files = picked
  }
  return { files, total, perRepo }
}

const repoOf = (f: string): string => path.join(CR, (f.startsWith(CR) ? f.slice(CR.length + 1) : f).split(path.sep)[0])

function countKey(ks: KeySpace, project: string, key: string, file: string, line: number): void {
  if (!key) return
  let m = ks.get(project)
  if (!m) ks.set(project, (m = new Map()))
  let at = m.get(key)
  if (!at) m.set(key, (at = []))
  at.push({ file, line })
}

function declsOf(ks: KeySpace, project: string, tgt: string): Pos[] {
  return ks.get(project)?.get(tgt) ?? []
}

/** The gate's own three-way outcome, minus claims (scala carries none on these types). */
function outcome(ks: KeySpace, project: string, tgt: string): "resolved" | "amb" | "unresolved" {
  const n = new Set(declsOf(ks, project, tgt).map((p) => `${p.file}|${p.line}`)).size
  if (n === 0) return "unresolved"
  if (n === 1) return "resolved"
  return "amb"
}

/** The gate's `classifyIntent` over the POOLED key space (declPos is global in the gate too). */
const pooledOf = (ks: KeySpace): Map<string, Pos[]> => {
  const out = new Map<string, Pos[]>()
  for (const m of ks.values()) for (const [k, v] of m) {
    let at = out.get(k)
    if (!at) out.set(k, (at = []))
    at.push(...v)
  }
  return out
}
const LINE_IS_TARGET_LINE = new Set(["contains", "exports"])
function intentOf(tgt: string, srcFile: string, line: number | null, label: string, pooled: Map<string, Pos[]>): string {
  const decls = pooled.get(tgt)
  if (!decls || decls.length === 0) return "nothingAnywhere"
  const sameFile = decls.filter((d) => d.file === srcFile)
  if (sameFile.length === 0) return "arbitraryTwin"
  if (LINE_IS_TARGET_LINE.has(label) && line !== null && sameFile.some((d) => d.line === line)) return "intended"
  return "sameFileUnproven"
}

const TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]

async function main(): Promise<void> {
  const { files, total, perRepo } = discover()
  console.log(`population: ${files.length} sampled of ${total} .scala files (cap ${MAX_FILES})`)
  console.log(`corpus per repo: ${PROJECTS.map((p) => `${p} ${perRepo[p] ?? 0}`).join(" · ")}`)
  const samplePerRepo: Record<string, number> = {}
  for (const f of files) samplePerRepo[repoOf(f)] = (samplePerRepo[repoOf(f)] ?? 0) + 1
  console.log(`sampled per repo: ${Object.entries(samplePerRepo).map(([k, v]) => `${path.basename(k)} ${v}`).join(" · ")}`)

  const base: KeySpace = new Map()
  const after: KeySpace = new Map()
  type Edge = {
    label: string; tgt: string; src: string; file: string; line: number | null
    md: Record<string, unknown>; project: string
  }
  const edges: Edge[] = []
  let parsed = 0
  let failed = 0
  let aliasesBase = 0
  let aliasesAfter = 0
  let nestedOwner = 0

  for (const f of files) {
    const project = repoOf(f)
    let r: any
    try {
      r = await parseFile(f, project, { projectRoot: project } as any)
    } catch {
      failed++
      continue
    }
    if (!r) {
      failed++
      continue
    }
    parsed++
    for (const s of r.symbols ?? []) {
      const name = String(s?.name ?? "")
      if (!name) continue
      const line = Number(s?.startLine ?? 0)
      const qual = String(s?.qualifiedName ?? "")
      const owner = String(s?.ownerName ?? "")
      countKey(base, project, name, f, line)
      countKey(after, project, name, f, line)
      if (qual && qual !== name) {
        countKey(base, project, qual, f, line)
        countKey(after, project, qual, f, line)
        aliasesBase++
      }
      if (owner && owner !== name) {
        // THE SIMULATED FIX: `scope = owner` -> pool-worker yields `<owner>.<name>`.
        const proposed = `${owner}.${name}`
        if (proposed !== qual) { countKey(after, project, proposed, f, line); aliasesAfter++ }
        if (owner.includes(".")) nestedOwner++
      }
    }
    for (const rel of r.relationships ?? []) {
      const label = String(rel?.type ?? rel?.relationshipType ?? "")
      if (!TYPES.includes(label)) continue
      const tgt = String(rel?.target ?? rel?.to ?? "")
      if (!tgt) continue
      edges.push({
        label, tgt,
        src: String(rel?.source ?? ""),
        file: f, line: rel?.line_number ?? null,
        md: (rel?.metadata ?? {}) as Record<string, unknown>,
        project,
      })
    }
  }
  console.log(`parsed ${parsed} · failed ${failed} · edges ${edges.length} · baseline qualifiedName aliases ${aliasesBase} · proposed aliases ${aliasesAfter} (of which owner is dotted: ${nestedOwner})`)

  // ---------- A. reproduction of the gate's per-type columns under this model ----------
  console.log(`\nA. REPRODUCTION (this probe's key space, claims ignored — the gate's extOK/ext? rows are unresolved here)`)
  console.log(`type          edges    resolved  amb       unresolved`)
  const repro: Record<string, { e: number; r: number; a: number; u: number }> = {}
  for (const t of TYPES) repro[t] = { e: 0, r: 0, a: 0, u: 0 }
  for (const e of edges) {
    const o = outcome(base, e.project, e.tgt)
    const row = repro[e.label]
    row.e++
    if (o === "resolved") row.r++
    else if (o === "amb") row.a++
    else row.u++
  }
  let tE = 0, tR = 0, tA = 0, tU = 0
  for (const t of TYPES) {
    const r = repro[t]
    tE += r.e; tR += r.r; tA += r.a; tU += r.u
    console.log(`${t.padEnd(13)} ${String(r.e).padEnd(8)} ${String(r.r).padEnd(9)} ${String(r.a).padEnd(9)} ${r.u}`)
  }
  console.log(`${"TOTAL".padEnd(13)} ${String(tE).padEnd(8)} ${String(tR).padEnd(9)} ${String(tA).padEnd(9)} ${tU}`)

  // ---------- B. unresolved buckets by (type, shape, in-corpus presence) ----------
  const unres = edges.filter((e) => outcome(base, e.project, e.tgt) === "unresolved")
  const distinct = [...new Set(unres.map((e) => e.tgt))]
  console.log(`\nB. UNRESOLVED ${unres.length} edges · ${distinct.length} distinct targets — in-corpus presence via rg (TEXT presence, an over-approximation of "declared")`)
  const patternFile = path.join(os.tmpdir(), `scala-census-names-${process.pid}.txt`)
  writeFileSync(patternFile, distinct.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\n"))
  const present = new Set<string>()
  for (const repo of PROJECTS) {
    const dir = path.join(CR, repo)
    try {
      statSync(dir)
    } catch {
      continue
    }
    try {
      const out = execFileSync("rg", ["--no-config", "--no-filename", "-w", "-o", "-F", "-f", patternFile, dir], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      })
      for (const line of out.split("\n")) {
        const t = line.trim()
        if (t) present.add(t)
      }
    } catch {
      /* rg exits 1 when a repo has no match at all */
    }
  }
  const buckets = new Map<string, number>()
  const examples = new Map<string, string[]>()
  for (const e of unres) {
    const shape = e.tgt.includes(".") ? "DOTTED" : "BARE"
    const where = present.has(e.tgt) ? "IN-CORPUS (declared somewhere in the project; the stride hid it)" : "NOWHERE in the corpus (analyzer-facing)"
    const key = `${e.label.padEnd(13)} ${shape.padEnd(6)} ${where}`
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
    let ex = examples.get(key)
    if (!ex) { ex = []; examples.set(key, ex) }
    if (ex.length < 6 && !ex.includes(e.tgt)) ex.push(`${e.tgt} (${path.basename(path.dirname(path.dirname(e.file)))}/${path.basename(e.file)}:${e.line})`)
  }
  const sorted = [...buckets.entries()].sort((a, b) => b[1] - a[1])
  for (const [k, v] of sorted) console.log(`${String(v).padStart(6)}  ${k}\n        e.g. ${(examples.get(k) ?? []).join(", ")}`)
  console.log(`  -----\n${String([...buckets.values()].reduce((a, b) => a + b, 0)).padStart(6)}  = every unresolved edge (EXACT)`)

  // ---------- C. SIMULATED AFTER ----------
  console.log(`\nC. SIMULATED AFTER (alias <owner>.<name> published as a symbol key) — movement per type`)
  console.log(`type          edges    res->res  unres->res(samefile)  unres->res(crossfile)  unres->amb  res->LOST  amb->res`)
  const pooledBase = pooledOf(base)
  const pooledAfter = pooledOf(after)
  const moved: Edge[] = []
  const intentBefore: Record<string, number> = { intended: 0, sameFileUnproven: 0, arbitraryTwin: 0, nothingAnywhere: 0 }
  const intentAfter: Record<string, number> = { intended: 0, sameFileUnproven: 0, arbitraryTwin: 0, nothingAnywhere: 0 }
  const perType: Record<string, { e: number; rr: number; urs: number; urc: number; ura: number; lost: number; ar: number }> = {}
  for (const t of TYPES) perType[t] = { e: 0, rr: 0, urs: 0, urc: 0, ura: 0, lost: 0, ar: 0 }
  for (const e of edges) {
    const o0 = outcome(base, e.project, e.tgt)
    const o1 = outcome(after, e.project, e.tgt)
    const row = perType[e.label]
    row.e++
    if (o0 === "resolved" && o1 === "resolved") row.rr++
    if (o0 === "resolved" && o1 !== "resolved") row.lost++
    if (o0 === "amb" && o1 === "resolved") row.ar++
    if (o0 === "unresolved" && o1 === "resolved") {
      const sameFile = declsOf(after, e.project, e.tgt).some((p) => p.file === e.file)
      if (sameFile) row.urs++
      else { row.urc++; moved.push(e) }
    }
    if (o0 === "unresolved" && o1 === "amb") row.ura++
    intentBefore[intentOf(e.tgt, e.file, e.line, e.label, pooledBase)]++
    intentAfter[intentOf(e.tgt, e.file, e.line, e.label, pooledAfter)]++
  }
  let s = { e: 0, rr: 0, urs: 0, urc: 0, ura: 0, lost: 0, ar: 0 }
  for (const t of TYPES) {
    const r = perType[t]
    for (const k of Object.keys(s) as (keyof typeof s)[]) s[k] += r[k]
    console.log(`${t.padEnd(13)} ${String(r.e).padEnd(8)} ${String(r.rr).padEnd(9)} ${String(r.urs).padEnd(21)} ${String(r.urc).padEnd(22)} ${String(r.ura).padEnd(11)} ${String(r.lost).padEnd(10)} ${r.ar}`)
  }
  console.log(`${"TOTAL".padEnd(13)} ${String(s.e).padEnd(8)} ${String(s.rr).padEnd(9)} ${String(s.urs).padEnd(21)} ${String(s.urc).padEnd(22)} ${String(s.ura).padEnd(11)} ${String(s.lost).padEnd(10)} ${s.ar}`)
  console.log(`\nD. BINDING INTENT`)
  console.log(`   before  intended ${intentBefore.intended} · sameFileUnproven ${intentBefore.sameFileUnproven} · arbitraryTwin ${intentBefore.arbitraryTwin} · nothingAnywhere ${intentBefore.nothingAnywhere}`)
  console.log(`   after   intended ${intentAfter.intended} · sameFileUnproven ${intentAfter.sameFileUnproven} · arbitraryTwin ${intentAfter.arbitraryTwin} · nothingAnywhere ${intentAfter.nothingAnywhere}`)
  console.log(`   DELTA   arbitraryTwin ${intentAfter.arbitraryTwin - intentBefore.arbitraryTwin >= 0 ? "+" : ""}${intentAfter.arbitraryTwin - intentBefore.arbitraryTwin} · intended ${intentAfter.intended - intentBefore.intended >= 0 ? "+" : ""}${intentAfter.intended - intentBefore.intended}`)

  // ---------- E. the CROSS-FILE edges the alias would bind (the arbitraryTwin class) ----------
  console.log(`\nE. NEWLY BOUND, CROSS-FILE (these would move into arbitraryTwin — the forbidden outcome): ${moved.length}`)
  for (const e of moved.slice(0, 15)) {
    console.log(`   ${e.label} ${e.file}:${e.line} target=${e.tgt} <- ${e.src}`)
  }
  console.log(`\nE2. SAME-FILE BOUND edges (arbitraryTwin-safe) by type:`)
  const sameFileByType: Record<string, number> = {}
  for (const e of edges) {
    const o0 = outcome(base, e.project, e.tgt)
    const o1 = outcome(after, e.project, e.tgt)
    if (o0 === "unresolved" && o1 === "resolved" && declsOf(after, e.project, e.tgt).some((p) => p.file === e.file)) {
      sameFileByType[e.label] = (sameFileByType[e.label] ?? 0) + 1
    }
  }
  console.log(`   ${Object.entries(sameFileByType).map(([k, v]) => `${k} ${v}`).join(" · ") || "(none)"}`)

  // ---------- F. overrides decomposed (the structural defect) ----------
  console.log(`\nF. OVERRIDES — 314 edges, all unresolved; decomposed by reasonCode and by what an alias would answer`)
  const ov = edges.filter((e) => e.label === "overrides")
  const byReason = new Map<string, { n: number; base: number; after: number; sameFile: number; crossFile: number; amb: number }>()
  for (const e of ov) {
    const rc = String(e.md.reasonCode ?? "(none)")
    let r = byReason.get(rc)
    if (!r) byReason.set(rc, (r = { n: 0, base: 0, after: 0, sameFile: 0, crossFile: 0, amb: 0 }))
    r.n++
    const o0 = outcome(base, e.project, e.tgt)
    const o1 = outcome(after, e.project, e.tgt)
    if (o0 === "resolved") r.base++
    if (o1 === "resolved") {
      r.after++
      if (declsOf(after, e.project, e.tgt).some((p) => p.file === e.file)) r.sameFile++
      else r.crossFile++
    }
    if (o1 === "amb") r.amb++
  }
  for (const [rc, r] of [...byReason.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`   reasonCode=${rc.padEnd(24)} n=${String(r.n).padEnd(5)} baseline resolved=${String(r.base).padEnd(4)} after resolved=${String(r.after).padEnd(5)} (same-file ${r.sameFile} / cross-file ${r.crossFile}) after amb=${r.amb}`)
  }
  console.log(`   distinct override targets: ${new Set(ov.map((e) => e.tgt)).size}`)
  const ovEx = ov.slice(0, 10).map((e) => `${path.basename(e.file)}:${e.line} ${e.src} -> ${e.tgt}`)
  for (const x of ovEx) console.log(`     ${x}`)

  // ---------- G. hand-read pool ----------
  console.log(`\nG. HAND-READ POOL — same-file bound edges, with the answering declaration`)
  const handPool = edges.filter((e) => {
    const o0 = outcome(base, e.project, e.tgt)
    const o1 = outcome(after, e.project, e.tgt)
    return o0 === "unresolved" && o1 === "resolved" && declsOf(after, e.project, e.tgt).some((p) => p.file === e.file)
  })
  console.log(`   total ${handPool.length}`)
  for (const e of handPool.slice(0, 25)) {
    const d = declsOf(after, e.project, e.tgt).filter((p) => p.file === e.file)[0]
    const rel = path.relative(CR, e.file)
    console.log(`   ${e.label.padEnd(10)} ${rel}:${e.line}  target=${e.tgt}  source=${e.src}  declared at line ${d?.line}`)
  }
  // ---------- H. THE JVM-PLATFORM NAMESPACE CLAIM, PRICED ----------
  // `languageNamespace` (NAMESPACE_CLAIM_KEY) certifies a target whose LEADING SEGMENTS match a
  // declared namespace on segment boundaries, and is read ONLY where decls === 0 — so it can only
  // re-label an edge that is already a gap, and can never move a resolution or the intent tally.
  const JVM_ROOTS = ["java", "javax", "jdk", "sun"]
  // The claim spellings the arbiter reads, so a second claim is never stacked on an edge.
  const CLAIM_KEYS_PRESENT_ON_EDGE = ["localBinding", "remoteRef", "importProjectFile", "languageNamespace", "sourcePathClaim", "importOutsideProject", "baseBeyondRunScope", "isExternal", "isExternalTarget", "isStdlib", "isExternalBase", "external", "externalRef"]
  const nsMove = new Map<string, number>()
  let nsTotal = 0
  let nsIntentRise = 0
  // THE NON-HIDING PROOF: the namespace branch of `classifyEdge` returns BEFORE the count, so a
  // claim on an edge whose target IS a project declaration would relabel a resolution as
  // `externalVerified`. Count those edges here — they must be 0 in this population.
  const jvmOutcome = new Map<string, number>()
  const jvmResolved: string[] = []
  for (const e of edges) {
    const segs = e.tgt.split(".")
    let hit: string | null = null
    for (let n = segs.length; n >= 1; n--) {
      const cand = segs.slice(0, n).join(".")
      if (JVM_ROOTS.includes(cand)) { hit = cand; break }
    }
    if (hit === null) continue
    const o = outcome(base, e.project, e.tgt)
    jvmOutcome.set(o, (jvmOutcome.get(o) ?? 0) + 1)
    if (o !== "unresolved" && jvmResolved.length < 10) jvmResolved.push(`${e.label} ${path.relative(CR, e.file)}:${e.line} ${e.tgt} (${o})`)
    if (o !== "unresolved") continue
    nsTotal++
    nsMove.set(e.label, (nsMove.get(e.label) ?? 0) + 1)
    const before = intentOf(e.tgt, e.file, e.line, e.label, pooledBase)
    const afterI = intentOf(e.tgt, e.file, e.line, e.label, pooledAfter)
    if (afterI === "arbitraryTwin" && before !== "arbitraryTwin") nsIntentRise++
  }
  console.log(`\nH. JVM-PLATFORM NAMESPACE CLAIM (languageNamespace roots ${JSON.stringify(JVM_ROOTS)}) — unresolved -> declared-external`)
  console.log(`   JVM-root targets by BASELINE outcome: ${[...jvmOutcome.entries()].map(([k, v]) => `${k} ${v}`).join(" · ")}  <- resolved/amb MUST be 0 (a claim there would hide a resolution)`)
  for (const x of jvmResolved) console.log(`     HIDING RISK: ${x}`)
  console.log(`   would declare ${nsTotal} edge(s) external: ${[...nsMove.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ") || "(none)"}`)
  // per-root split, and the SHIPPED RULE's guards applied
  const rootSplit = new Map<string, number>()
  const guardDrop = new Map<string, number>()
  const declaredHereAll = new Set<string>()
  for (const m of base.values()) for (const k of m.keys()) declaredHereAll.add(k)
  let shipped = 0
  for (const e of edges) {
    if (outcome(base, e.project, e.tgt) !== "unresolved") continue
    if (!e.tgt.includes(".")) continue
    const root = e.tgt.split(".")[0]
    if (!JVM_ROOTS.includes(root)) continue
    rootSplit.set(root, (rootSplit.get(root) ?? 0) + 1)
    if (!["java", "javax", "sun"].includes(root)) { guardDrop.set("root-not-shipped", (guardDrop.get("root-not-shipped") ?? 0) + 1); continue }
    if (declaredHereAll.has(e.tgt)) { guardDrop.set("declared-in-own-file", (guardDrop.get("declared-in-own-file") ?? 0) + 1); continue }
    for (const k of CLAIM_KEYS_PRESENT_ON_EDGE) if (e.md[k] !== undefined) { guardDrop.set(`already-claimed:${k}`, (guardDrop.get(`already-claimed:${k}`) ?? 0) + 1); break }
    shipped++
  }
  console.log(`   per root (dotted, unresolved only): ${[...rootSplit.entries()].map(([k, v]) => `${k} ${v}`).join(" · ")}`)
  console.log(`   SHIPPED RULE (roots java/javax/sun + dot + not declared here + no existing claim) would declare: ${shipped}; guarded out: ${[...guardDrop.entries()].map(([k, v]) => `${k} ${v}`).join(" · ") || "0"}`)
  console.log(`   intent edges that would newly read arbitraryTwin: ${nsIntentRise} (must be 0: the claim adds no declaration)`)
  // A DOTTED `imports` TARGET IS ALREADY CERTIFIED BY THE FLEET RULE when it ends in a TYPE NAME
  // (`incoming-rule.ts:451-453`, DOTTED_MODULE_TYPE) — those edges read extOK BEFORE this fix, so the
  // VISIBLE movement is only the rest. Reproduce that rule here, or the prediction overshoots.
  const DOTTED_MODULE_TYPE = /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*\.[A-Z][A-Za-z0-9_$]*$/
  let alreadyExtOk = 0
  const newEdges: typeof edges = []
  for (const e of edges) {
    // READ THE ANALYZER'S OWN OUTPUT: this probe is run against the post-fix analyzer, so an edge
    // the fix certified carries the claim. (The pre-fix run of this same probe is the 19:56 record in
    // scala-census.txt; it measured 103 candidates with 0 guarded out.)
    if (e.md.languageNamespace === undefined) continue
    const owner = e.tgt.slice(0, e.tgt.lastIndexOf("."))
    const preCertified = e.label === "imports" && DOTTED_MODULE_TYPE.test(e.tgt) && declsOf(base, e.project, owner).length === 0
    if (preCertified) alreadyExtOk++
    else newEdges.push(e)
  }
  console.log(`   CLAIMED BY THE ANALYZER NOW: ${alreadyExtOk + newEdges.length} (${alreadyExtOk} already read extOK through the fleet's DOTTED_MODULE_TYPE import rule; ${newEdges.length} moved out of unresolved)`)
  console.log(`   THE ${newEdges.length} EDGES THIS FIX MOVES (file:line · type · source -> target):`)
  for (const e of newEdges) console.log(`     ${path.relative(CR, e.file)}:${e.line} · ${e.label} · ${e.src} -> ${e.tgt}`)

  // ---------- I. WHAT IS LEFT — the roots of the DOTTED unresolved targets ----------
  const rootHist = new Map<string, number>()
  for (const e of unres) {
    if (!e.tgt.includes(".")) continue
    const root = e.tgt.split(".")[0]
    rootHist.set(root, (rootHist.get(root) ?? 0) + 1)
  }
  console.log(`\nI. DOTTED unresolved targets by ROOT (top 15 of ${rootHist.size} roots)`)
  for (const [r, n] of [...rootHist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    const inCorpus = present.has(r)
    console.log(`   ${String(n).padStart(5)}  ${r.padEnd(28)} root ${inCorpus ? "PRESENT as a whole word in the corpus text" : "absent from the corpus text"}`)
  }

  try {
    execFileSync("rm", ["-f", patternFile])
  } catch { /* tmp file */ }
}

await main()
