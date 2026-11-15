/**
 * CALL-QUALIFIER CENSUS — how much of the rust lane's `calls` residual is a call whose
 * receiver the analyzer ALREADY KNOWS (`self.x()` / `Self::x()`), and what the gate's
 * TABLE 1 would read if the qualifier were published on both ends.
 *
 * ## Why this probe exists
 *
 * `incoming-gate.ts rust rs 400` reads 42,930 edges / 23,637 unresolved, and the largest
 * unresolved bucket is the `qualified` marker set on `calls` (13,423). `handleCallExpression`
 * computes `metadata.qualified` (the receiver expression) on every call edge and then resolves
 * on the bare leaf, so a member call cannot bind: a member name is not identifying.
 *
 * The proposed fix is narrow and DECIDABLE: a call whose callee receiver is the `self` keyword
 * or the `Self::` path is a call on the ENCLOSING IMPL TYPE, which is the one receiver Rust
 * guarantees at parse time with no type inference. Publish that type on the declaration side
 * (`qualifiedName = "Type::member"`) and spell the call target the same way, and the edge has
 * an exact key to bind to — with NO dot in it, so production's strategy 3 (which reduces a
 * dotted target to everything after the first `.` and binds MIN(id)) can never re-open the
 * arbitrary-twin pick the task forbids.
 *
 * This probe measures the population BEFORE any analyzer change:
 *   - the call-edge spelling census (which receiver forms exist, and how many);
 *   - of the decidable forms, how many bind to a member the SAME FILE declares in `impl T`;
 *   - the simulated gate outcome (decl-count key space, per project, sample-scoped) BEFORE and
 *     AFTER, including the binding-intent class, so the fix is priced before it is written;
 *   - the duplicate-qualified-name risk: (T, member) keys declared in more than one place in a
 *     project, which is where an exact qualified binding could re-open a tie-break.
 *
 * POPULATION: the gate's own stride sample (400 of the corpus .rs files), discovered the same
 * way the gate discovers it, so the numbers are comparable to TABLE 1 rather than merely
 * adjacent to it.
 *
 * Run: bun run validation/m14/fixtures/rust/call-qualifier-census.mts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const MAX_FILES = Number(process.env.MAX_FILES ?? 400)
const SIZE_CAP = 1024 * 1024

type Sym = { name: string; kind: string; start: number; end: number; file: string; project: string }

function discover(): { files: string[]; total: number } {
  const found: string[] = []
  for (const name of readdirSync(CR)) {
    const dir = path.join(CR, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    try {
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
      if (!rel.toLowerCase().endsWith(".rs")) continue
      const abs = path.join(dir, rel)
      try {
        if (statSync(abs).size > SIZE_CAP) continue
      } catch {
        continue
      }
      found.push(abs)
    }
  }
  found.sort()
  const total = found.length
  if (MAX_FILES <= 0 || total <= MAX_FILES) return { files: found, total }
  const stride = Math.max(1, Math.floor(total / MAX_FILES))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < MAX_FILES; i += stride) picked.push(found[i])
  return { files: picked, total }
}

const norm = (p: string) => p.replace(/\\/g, "/")
const repoOf = (f: string) => {
  const rel = norm(f).slice(norm(CR).length + 1)
  return rel.split("/")[0] ?? rel
}

/** The analyzer's `implSelfTypeName` equivalent: the innermost nominal name behind wrappers/generics. */
function implLeaf(text: string): string | null {
  let t = text.trim()
  const strip = (s: string) => {
    let out = s.trim()
    let changed = true
    while (changed) {
      changed = false
      const before = out
      out = out.replace(/^&\s*(mut\s+)?/, "")
      out = out.replace(/^\*\s*(const\s+|mut\s+)?/, "")
      if (out !== before) changed = true
    }
    return out
  }
  t = strip(t)
  if (t.startsWith("(") || t.startsWith("[") || t.startsWith("<")) return null
  if (t.startsWith("dyn ") || t === "impl") return null
  // drop a turbofish / generic argument list
  const lt = t.indexOf("<")
  if (lt > 0) t = t.slice(0, lt)
  const segs = t.split("::").filter(Boolean)
  const leaf = segs.length > 0 ? segs[segs.length - 1].trim() : ""
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(leaf)) return null
  return leaf
}

const main = async () => {
  const t0 = Date.now()
  const { files, total } = discover()
  console.log(`call-qualifier census — rust`)
  console.log(`population: ${files.length} of ${total} corpus .rs files (gate's stride shape, MAX_FILES=${MAX_FILES})`)

  const symsByProject = new Map<string, Sym[]>()
  /** every edge we care about: calls edges from this file, with the resolved enclosing impl type */
  type Edge = {
    file: string
    project: string
    line: number | null
    target: string
    qualified: string
    /** enclosing impl type leaf at the call site, when the analyzer can know it */
    implType: string | null
    /** the call site's receiver form */
    form: string
  }
  const edges: Edge[] = []
  const allEdges: Array<{ type: string; target: string; file: string; project: string }> = []
  let callEdges = 0
  const formCount = new Map<string, number>()
  let debugLeft = Number(process.env.DEBUG_SELF ?? 0)

  for (const f of files) {
    const project = repoOf(f)
    let content: string
    try {
      content = readFileSync(f, "utf8")
    } catch {
      continue
    }
    let r: any
    try {
      r = await parseFile(f, project, { projectRoot: path.join(CR, project) } as any)
    } catch {
      continue
    }
    const symbols: any[] = Array.isArray(r?.symbols) ? r.symbols : []
    const lineOf = (s: any) => Number(s?.startLine ?? s?.range?.startLine ?? s?.range?.start_line ?? s?.line_start ?? s?.lineStart ?? s?.line ?? 0) || 0
    const endOf = (s: any) => Number(s?.endLine ?? s?.range?.endLine ?? s?.range?.end_line ?? s?.line_end ?? s?.lineEnd ?? lineOf(s)) || lineOf(s)
    const list = symsByProject.get(project) ?? []
    for (const s of symbols) {
      if (!s?.name) continue
      list.push({ name: String(s.name), kind: String(s.kind ?? ""), start: lineOf(s), end: endOf(s), file: f, project })
    }
    symsByProject.set(project, list)

    // impl blocks and functions from the analyzer's OWN symbol table (no second tree walk):
    // the enclosing impl of a call site is the innermost impl containing the innermost
    // function symbol containing the edge's line.
    const impls = list.filter((s) => s.file === f && s.kind.toLowerCase() === "impl")
    const fns = list.filter((s) => s.file === f && /function|method/i.test(s.kind))
    const enclosingImplOf = (line: number): string | null => {
      const fn = fns
        .filter((s) => s.start <= line && line <= s.end)
        .sort((a, b) => b.start - a.start)[0]
      if (!fn) return null
      const impl = impls
        .filter((s) => s.start <= fn.start && fn.start <= s.end)
        .sort((a, b) => b.start - a.start)[0]
      return impl ? implLeaf(impl.name) : null
    }

    for (const rel of Array.isArray(r?.relationships) ? r.relationships : []) {
      const rt = String(rel?.type ?? "")
      const tgt = String(rel?.target ?? "")
      if (rt && tgt) allEdges.push({ type: rt, target: tgt, file: f, project })
      if (rt !== "calls") continue
      callEdges++
      const target = String(rel?.target ?? "")
      const md = rel?.metadata ?? {}
      const qualified = String(md?.qualified ?? "")
      const line = Number(rel?.line_number ?? 0) || null
      let form = "other"
      if (!qualified || qualified === target) form = "bare-identifier"
      else if (qualified === `self.${target}`) form = "self"
      else if (qualified === `Self::${target}`) form = "Self::"
      else if (qualified.startsWith("self.")) form = "self-chain"
      else if (qualified.includes("::")) form = "scoped-path"
      else if (qualified.includes(".")) form = "field-chain"
      formCount.set(form, (formCount.get(form) ?? 0) + 1)
      if (process.env.DEBUG_SELF && form === "self" && debugLeft > 0) {
        debugLeft--
        console.log(`DEBUG ${norm(f).replace(norm(CR) + "/", "")}:${line} target=${target} qualified=${qualified}`)
        const first = list.find((x) => x.file === f && x.kind.toLowerCase() === "impl")
        if (first) console.log(`   raw impl symbol = ${JSON.stringify(symbols.find((s: any) => String(s.kind) === "impl"))}`)
        for (const s of list.filter((x) => x.file === f)) {
          console.log(`   sym kind=${JSON.stringify(s.kind)} name=${s.name} ${s.start}-${s.end}`)
        }
      }
      edges.push({
        file: f,
        project,
        line,
        target,
        qualified,
        implType: form === "self" || form === "Self::" ? enclosingImplOf(line ?? 0) : null,
        form,
      })
    }
  }

  console.log(`\nSAMPLE: ${files.length} files parsed · ${callEdges} calls edges · ${edges.length} classified`)
  console.log(`\nCALL-EDGE RECEIVER FORMS`)
  for (const [k, v] of [...formCount.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(16)} ${String(v).padStart(6)}`)
  }

  // ---- simulated key spaces, per project, exactly the gate's shape -------------------------
  const nameCount = new Map<string, Map<string, number>>()
  const qualCount = new Map<string, Map<string, number>>()
  const qualSites = new Map<string, Map<string, Set<string>>>() // project -> key -> declaration sites
  const ownFileDecl = new Map<string, Set<string>>() // "file\u0000name" -> declared
  for (const [project, list] of symsByProject) {
    const nc = nameCount.get(project) ?? new Map<string, number>()
    const qc = qualCount.get(project) ?? new Map<string, number>()
    const qs = qualSites.get(project) ?? new Map<string, Set<string>>()
    const impls = list.filter((s) => s.kind.toLowerCase() === "impl")
    for (const s of list) {
      nc.set(s.name, (nc.get(s.name) ?? 0) + 1)
      const key = `${s.file}\u0000${s.name}`
      const set = ownFileDecl.get(key) ?? new Set<string>()
      set.add(s.name)
      ownFileDecl.set(key, set)
      // the DECLARATION side of the proposed fix: a member declared inside an impl gains
      // qualifiedName "<ImplTypeLeaf>::<member>" (the same leaf `Self` resolves to).
      if (!/function|method|constructor/i.test(s.kind)) continue
      const impl = impls.filter((i) => i.start <= s.start && s.start <= i.end).sort((a, b) => b.start - a.start)[0]
      if (!impl) continue
      const t = implLeaf(impl.name)
      if (!t) continue
      const qk = `${t}::${s.name}`
      qc.set(qk, (qc.get(qk) ?? 0) + 1)
      const sites = qs.get(qk) ?? new Set<string>()
      sites.add(`${s.file}:${s.start}`)
      qs.set(qk, sites)
    }
    nameCount.set(project, nc)
    qualCount.set(project, qc)
    qualSites.set(project, qs)
  }

  const outcome = (n: number) => (n === 1 ? "resolved" : n === 0 ? "unresolved" : "amb")
  const intent = (file: string, name: string, decls: number) =>
    ownFileDecl.get(`${file}\u0000${name}`)?.has(name) ? "sameFileUnproven" : decls > 0 ? "arbitraryTwin" : "nothingAnywhere"

  type Row = { before: Record<string, number>; after: Record<string, number>; intentBefore: Record<string, number>; intentAfter: Record<string, number>; changed: number; afterResolvedDiff: number }
  const emptyRow = (): Row => ({ before: {}, after: {}, intentBefore: {}, intentAfter: {}, changed: 0, afterResolvedDiff: 0 })
  const rows = new Map<string, Row>()
  const row = (form: string) => {
    let r = rows.get(form)
    if (!r) rows.set(form, (r = emptyRow()))
    return r
  }

  let dupQualKeys = 0
  let dupQualDecls = 0
  for (const [, qs] of qualSites) {
    for (const [, sites] of qs) {
      if (sites.size > 1) {
        dupQualKeys++
        dupQualDecls += sites.size
      }
    }
  }

  let decidable = 0
  let decidableOwnFile = 0
  let decidableMoved = 0
  let scoped2 = 0
  let scoped2OwnFile = 0
  const sampleMoves: Array<{ file: string; line: number | null; from: string; to: string; implType: string; form: string }> = []

  for (const e of edges) {
    const nc = nameCount.get(e.project) ?? new Map()
    const qc = qualCount.get(e.project) ?? new Map()
    const beforeN = nc.get(e.target) ?? 0
    const r = row(e.form)
    const b = outcome(beforeN)
    r.before[b] = (r.before[b] ?? 0) + 1
    r.intentBefore[intent(e.file, e.target, beforeN)] = (r.intentBefore[intent(e.file, e.target, beforeN)] ?? 0) + 1

    // THE CANDIDATE TARGET. Only a call whose receiver is `self` or `Self::` — the one
    // receiver Rust guarantees without inference — and only when the enclosing impl type
    // is known and the SAME FILE declares that member inside that impl.
    let newTarget: string | null = null
    const ownSites = qualSites.get(e.project)
    const ownFileSiteOf = (key: string) => {
      const sites = ownSites?.get(key)
      return sites ? [...sites].some((s) => s.startsWith(`${e.file}:`)) : false
    }
    if (e.implType && (e.form === "self" || e.form === "Self::")) {
      decidable++
      const cand = `${e.implType}::${e.target}`
      if (ownFileSiteOf(cand)) {
        decidableOwnFile++
        newTarget = cand
      }
    }
    // RULE 2 — a two-segment path call `T::member(...)` whose qualified spelling is EXACTLY a
    // member the SAME FILE declares in an `impl T`. `target` is already the leaf, so the whole
    // candidate is the analyzer's own `metadata.qualified`.
    if (!newTarget && e.form === "scoped-path" && e.qualified.split("::").filter(Boolean).length === 2) {
      scoped2++
      if (ownFileSiteOf(e.qualified)) {
        scoped2OwnFile++
        newTarget = e.qualified
      }
    }
    if (newTarget) {
      const afterN = qc.get(newTarget) ?? 0
      const a = outcome(afterN)
      r.after[a] = (r.after[a] ?? 0) + 1
      r.intentAfter[intent(e.file, newTarget, afterN)] = (r.intentAfter[intent(e.file, newTarget, afterN)] ?? 0) + 1
      r.changed++
      if (b !== "resolved" && a === "resolved") r.afterResolvedDiff++
        ; (r as any).beforeMoved = ((r as any).beforeMoved ?? 0) + (b !== "resolved" ? 1 : 0)
      if (b !== "resolved" && a === "resolved") {
        decidableMoved++
        if (sampleMoves.length < 400) sampleMoves.push({ file: e.file, line: e.line, from: e.target, to: newTarget, implType: e.implType!, form: e.form })
      }
    } else {
      r.after[b] = (r.after[b] ?? 0) + 1
      r.intentAfter[intent(e.file, e.target, beforeN)] = (r.intentAfter[intent(e.file, e.target, beforeN)] ?? 0) + 1
    }
  }

  const keys = ["bare-identifier", "self", "Self::", "self-chain", "scoped-path", "field-chain", "other"]
  console.log(`\nSIMULATED GATE OUTCOME per receiver form (sample-scoped key space, no claims)`)
  console.log(`  ${"form".padEnd(16)} ${"edges".padStart(6)} ${"resolved".padStart(8)} ${"amb".padStart(6)} ${"unres".padStart(6)}  ->  ${"resolved".padStart(8)} ${"amb".padStart(6)} ${"unres".padStart(6)}   ${"movedUnres->res".padStart(14)}`)
  const tot = emptyRow()
  for (const k of keys) {
    const r = rows.get(k)
    if (!r) continue
    const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0)
    const g = (o: Record<string, number>, k2: string) => o[k2] ?? 0
    console.log(
      `  ${k.padEnd(16)} ${String(sum(r.before)).padStart(6)} ${String(g(r.before, "resolved")).padStart(8)} ${String(g(r.before, "amb")).padStart(6)} ${String(g(r.before, "unresolved")).padStart(6)}  ->  ${String(g(r.after, "resolved")).padStart(8)} ${String(g(r.after, "amb")).padStart(6)} ${String(g(r.after, "unresolved")).padStart(6)}   ${String((r as any).beforeMoved ?? 0).padStart(14)}`,
    )
    for (const kk of ["before", "after", "intentBefore", "intentAfter"] as const) {
      for (const [a, b] of Object.entries(r[kk])) (tot[kk] as Record<string, number>)[a] = ((tot[kk] as Record<string, number>)[a] ?? 0) + b
    }
    ; (tot as any).beforeMoved = ((tot as any).beforeMoved ?? 0) + ((r as any).beforeMoved ?? 0)
  }
  const sumTot = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0)
  const gTot = (o: Record<string, number>, k2: string) => o[k2] ?? 0
  console.log(
    `  ${"TOTAL".padEnd(16)} ${String(sumTot(tot.before)).padStart(6)} ${String(gTot(tot.before, "resolved")).padStart(8)} ${String(gTot(tot.before, "amb")).padStart(6)} ${String(gTot(tot.before, "unresolved")).padStart(6)}  ->  ${String(gTot(tot.after, "resolved")).padStart(8)} ${String(gTot(tot.after, "amb")).padStart(6)} ${String(gTot(tot.after, "unresolved")).padStart(6)}   ${String((tot as any).beforeMoved ?? 0).padStart(14)}`,
  )

  console.log(`\nBINDING INTENT (calls only, this sample)`)
  for (const k of ["intentBefore", "intentAfter"] as const) {
    const o = tot[k]
    console.log(`  ${k.padEnd(14)} ${Object.entries(o).sort((a, b) => b[1] - a[1]).map(([a, b]) => `${a}=${b}`).join("  ")}`)
  }

  console.log(`\nDECIDABLE SUBCLASS`)
  console.log(`  RULE 1  self.x()/Self::x() calls with a known enclosing impl type ... ${decidable}`)
  console.log(`  RULE 1  ... and the SAME FILE declares that member in that impl ...... ${decidableOwnFile}`)
  console.log(`  RULE 2  two-segment path calls T::m() ............................... ${scoped2}`)
  console.log(`  RULE 2  ... and the SAME FILE declares T::m in an impl T ............ ${scoped2OwnFile}`)
  console.log(`  ... of both rules, unresolved/amb before, resolved after ............ ${decidableMoved}`)
  console.log(`duplicate "<ImplType>::<member>" keys in one project (the exact-match tie risk): ${dupQualKeys} key(s), ${dupQualDecls} declaration site(s)`)

  console.log(`\nSAMPLE OF MOVED EDGES (up to 12, from the edges the fix resolves — not the easy ones)`)
  for (const m of sampleMoves.slice(0, 12)) {
    console.log(`  ${norm(m.file).replace(norm(CR) + "/", "")}:${m.line ?? "?"}  ${m.form === "Self::" ? "Self::" : "self."}${m.from}() -> ${m.to}`)
  }

  // ------------------------------------------------------------------------------------------
  // WHERE COULD `unresolved` ACTUALLY FALL? A re-spelled target that keeps the LEAF cannot help:
  // a qualified declaration IS a declaration of its leaf, so any edge a qualifier could bind was
  // already a key under its bare leaf (resolved or ambiguous) and was never `unresolved`. The
  // census below prices the two routes that CAN move `unresolved`: publishing a declaration the
  // analyzer does not publish, and a declared claim the gate can verify.
  // ------------------------------------------------------------------------------------------
  console.log(`\nALL-EDGE RESIDUAL CENSUS (sample-scoped project key space, all relationship types)`)
  console.log(`  ${"type".padEnd(13)} ${"edges".padStart(6)} ${"resolved".padStart(8)} ${"amb".padStart(6)} ${"unres".padStart(6)}   ${"unres:bare".padStart(10)} ${"unres:path".padStart(10)} ${"unres:other".padStart(11)}   ${"claimOK".padStart(7)} ${"claim?".padStart(7)} ${"claimFAIL".padStart(9)}`)
  const byType = new Map<string, { edges: number; resolved: number; amb: number; unres: number; bare: number; pathish: number; other: number; claimOK: number; claimQ: number; claimFail: number }>()
  const targetOwner = (t: string) => {
    const dot = t.lastIndexOf(".")
    return dot > 0 ? t.slice(0, dot) : t
  }
  for (const e of allEdges) {
    const nc = nameCount.get(e.project) ?? new Map()
    const n = nc.get(e.target) ?? 0
    const b = byType.get(e.type) ?? { edges: 0, resolved: 0, amb: 0, unres: 0, bare: 0, pathish: 0, other: 0, claimOK: 0, claimQ: 0, claimFail: 0 }
    b.edges++
    if (n === 1) b.resolved++
    else if (n > 1) b.amb++
    else {
      b.unres++
      const bare = !e.target.includes(".") && !e.target.includes("::") && !e.target.includes("/")
      if (bare) b.bare++
      else if (e.target.includes("::") || e.target.includes("/")) b.pathish++
      else b.other++
      // the gate's `owner` claim test, exactly: owner = everything before the LAST dot; a
      // non-identifier owner cannot be checked at all (ext?), a declared owner REFUTES the
      // claim (counted against the lane), an absent owner verifies it.
      const owner = targetOwner(e.target)
      if (/[:/\s]/.test(owner) || owner.length === 0) b.claimQ++
      else if ((nc.get(owner) ?? 0) > 0) b.claimFail++
      else b.claimOK++
    }
    byType.set(e.type, b)
  }
  const t2 = { edges: 0, resolved: 0, amb: 0, unres: 0, bare: 0, pathish: 0, other: 0, claimOK: 0, claimQ: 0, claimFail: 0 }
  for (const [ty, b] of [...byType.entries()].sort((a, b) => b[1].unres - a[1].unres)) {
    console.log(
      `  ${ty.padEnd(13)} ${String(b.edges).padStart(6)} ${String(b.resolved).padStart(8)} ${String(b.amb).padStart(6)} ${String(b.unres).padStart(6)}   ${String(b.bare).padStart(10)} ${String(b.pathish).padStart(10)} ${String(b.other).padStart(11)}   ${String(b.claimOK).padStart(7)} ${String(b.claimQ).padStart(7)} ${String(b.claimFail).padStart(9)}`,
    )
    for (const k of Object.keys(t2) as Array<keyof typeof t2>) (t2 as any)[k] += (b as any)[k]
  }
  console.log(
    `  ${"TOTAL".padEnd(13)} ${String(t2.edges).padStart(6)} ${String(t2.resolved).padStart(8)} ${String(t2.amb).padStart(6)} ${String(t2.unres).padStart(6)}   ${String(t2.bare).padStart(10)} ${String(t2.pathish).padStart(10)} ${String(t2.other).padStart(11)}   ${String(t2.claimOK).padStart(7)} ${String(t2.claimQ).padStart(7)} ${String(t2.claimFail).padStart(9)}`,
  )
  console.log(`  claimOK = an owner-shaped unresolved target whose owner the project does NOT declare (an `)
  console.log(`            external claim would be VERIFIED) · claimFAIL = the owner IS declared (the claim`)
  console.log(`            would be REFUTED and counted against the lane) · claim? = owner not identifier-shaped.`)

  console.log(`\nelapsed ${Math.round((Date.now() - t0) / 1000)}s`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
