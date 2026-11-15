/**
 * RUBY LANE — bucket-1 decomposition and the PRICE of every candidate fix.
 *
 * READ-ONLY. It parses the SAME stride population the incoming gate parses
 * (`incoming-gate.ts:323-415`, cap 400) with the same call
 * (`parseFile(f, repoOf(f), { projectRoot: repoOf(f) })`, `:918`), builds the
 * same per-project key space (`name` + `qualifiedName` alias, `:1000-1043`), and
 * prices each candidate change under the gate's OWN decl-count model. The
 * unmodified population PREDICTS TABLE 1 exactly (resolved 9614 · collRes 2514 ·
 * amb 7667 · unresolved 14229), which is what makes the predictions below
 * comparable to the gate's printed table.
 *
 * VARIANT LADDER
 *   BASE  as shipped.
 *   A     publish `qualifiedName = Owner.method` on every owned declaration
 *         (additive; NO edge changes).
 *   B     A + retarget EVERY constant-receiver call to `Owner.method`
 *         (the naive "publish the qualifier" reading).
 *   C     A + retarget a constant-receiver call ONLY when the edge's OWN FILE
 *         declares that owner+method (so the key it retargets to provably exists).
 *   D     the oracle ceiling: A + retarget when the PROJECT's key space answers
 *         `Owner.method` with exactly one declaration (NOT implementable in a
 *         single-file analyzer; priced to show what is left on the table).
 *
 * Run:  bun run validation/m14/fixtures/ruby/receiver-census.mts
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const MAX_FILES = Number(process.env.BB_MAX ?? 400)

type Decl = { count: number; owners: string[] }
const bump = (m: Map<string, Decl>, k: string, owner: string) => {
  const d = m.get(k) ?? { count: 0, owners: [] }
  d.count++
  d.owners.push(owner)
  m.set(k, d)
}

function discover(): { files: string[]; total: number; repos: number } {
  const found: string[] = []
  const repos = new Set<string>()
  for (const name of readdirSync(CR).sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[] = []
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!rel.toLowerCase().endsWith(".rb")) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      found.push(abs); repos.add(name)
    }
  }
  found.sort()
  const total = found.length
  let files = found
  if (total > MAX_FILES) {
    const stride = Math.max(1, Math.floor(total / MAX_FILES))
    const picked: string[] = []
    for (let i = 0; i < found.length && picked.length < MAX_FILES; i += stride) picked.push(found[i])
    files = picked
  }
  return { files, total, repos: repos.size }
}

const repoOf = (f: string) => path.join(CR, (f.startsWith(CR) ? f.slice(CR.length + 1) : f).split(path.sep)[0])
const isConstant = (s: string) => { const c = s.charCodeAt(0); return c >= 65 && c <= 90 }
const leafName = (s: string) => { const i = s.lastIndexOf("::"); return i >= 0 ? s.slice(i + 2) : s }

type Edge = {
  repo: string; file: string; rel: string; line: number | null; label: string
  target: string; toSymbol: string; sig: string; md: Record<string, unknown>
  /** the qualified path the analyzer already computed, as `Owner.method` (leaf-owner spelling) */
  qLeaf: string | null
  /** `${owner}.${method}` keys declared by the edge's OWN FILE */
  fileDeclares: boolean
}

const main = async () => {
  const { files, total, repos } = discover()
  console.log(`population: ${files.length} parsed of ${files.length} sampled (corpus has ${total} .rb files across ${repos} repos; stride sample)`)

  const A = new Map<string, Map<string, Decl>>()   // current key space: name + qualifiedName alias
  const B = new Map<string, Map<string, Decl>>()   // A + `ownerName.name` on every owned declaration
  const edges: Edge[] = []

  for (const f of files) {
    const repo = repoOf(f)
    const parsed: any = await parseFile(f, repo, { projectRoot: repo } as any)
    const a = A.get(repo) ?? new Map<string, Decl>()
    const b = B.get(repo) ?? new Map<string, Decl>()
    A.set(repo, a); B.set(repo, b)
    const fileKeys = new Set<string>()          // `${owner}.${method}` declared by THIS file
    const fileClasses = new Set<string>()       // class/module names declared by THIS file
    for (const s of Array.isArray(parsed?.symbols) ? parsed.symbols : []) {
      const name = String(s?.name ?? "")
      if (!name) continue
      const qual = String(s?.qualifiedName ?? "")
      const owner = String(s?.ownerName ?? "")
      const kind = String(s?.kind ?? "")
      bump(a, name, owner); bump(b, name, owner)
      if (qual && qual !== name) { bump(a, qual, owner); bump(b, qual, owner) }
      if (owner) { bump(b, `${owner}.${name}`, owner); fileKeys.add(`${owner}.${name}`) }
      if (kind === "class" || kind === "module") fileClasses.add(name)
    }
    for (const r of Array.isArray(parsed?.relationships) ? parsed.relationships : []) {
      const label = String(r?.type ?? r?.relationshipType ?? "")
      if (!label) continue
      const md: any = (r as any)?.metadata ?? {}
      const ks = Object.keys(md).filter((k) => k !== "evidenceClass" && k !== "analysisVersion" && md[k] !== false && md[k] != null).sort()
      const target = String((r as any)?.target ?? "")
      const toSymbol = String((r as any)?.toSymbol ?? "")
      const hasRecv = toSymbol !== "" && toSymbol !== target
      const recv = hasRecv ? toSymbol.slice(0, toSymbol.length - target.length - 1) : ""
      const qLeaf = hasRecv && isConstant(recv) ? `${leafName(recv)}.${target}` : null
      edges.push({
        repo, file: f, rel: path.relative(CR, f), line: Number((r as any)?.line_number ?? 0) || null,
        label, target, toSymbol, sig: ks.length ? ks.join("+") : "(no marker)", md, qLeaf,
        fileDeclares: qLeaf !== null && fileKeys.has(qLeaf) && fileClasses.has(leafName(qLeaf.split(".")[0])),
      })
    }
  }

  const declsOf = (space: Map<string, Map<string, Decl>>, repo: string, tgt: string) => space.get(repo)?.get(tgt)?.count ?? 0
  const ownersOf = (space: Map<string, Map<string, Decl>>, repo: string, tgt: string) => space.get(repo)?.get(tgt)?.owners ?? []

  type Tally = { resolved: number; collRes: number; amb: number; unres: number }
  const empty = (): Tally => ({ resolved: 0, collRes: 0, amb: 0, unres: 0 })

  /** variant: which key space, and which retarget rule */
  const run = (space: "A" | "B", retarget: "none" | "allConst" | "ownFileConst" | "projectUniqueConst"): Tally & { callsOnly: Tally } => {
    const S = space === "A" ? A : B
    const out = empty(); const calls = empty()
    for (const e of edges) {
      let tgt = e.target
      if (e.label === "calls" && e.qLeaf !== null) {
        if (retarget === "allConst") tgt = e.qLeaf
        else if (retarget === "ownFileConst" && e.fileDeclares) tgt = e.qLeaf
        else if (retarget === "projectUniqueConst" && declsOf(S, e.repo, e.qLeaf) === 1) tgt = e.qLeaf
      }
      const d = declsOf(S, e.repo, tgt)
      if (e.label === "contains") {
        if (d >= 1) { out.resolved++; if (d > 1) out.collRes++ } else out.unres++
        calls.resolved++; if (d > 1) calls.collRes++
        continue
      }
      const x = d === 0 ? "unres" : d > 1 ? "amb" : "resolved"
      out[x]++
      if (e.label === "calls") calls[x]++
    }
    return { ...out, callsOnly: calls }
  }

  const show = (name: string, t: Tally & { callsOnly: Tally }) => {
    console.log(`${name.padEnd(46)} resolved ${String(t.resolved).padStart(5)} · collRes ${String(t.collRes).padStart(4)} · amb ${String(t.amb).padStart(5)} · unresolved ${String(t.unres).padStart(5)}   | calls: res ${t.callsOnly.resolved} amb ${t.callsOnly.amb} unres ${t.callsOnly.unres}`)
  }

  const base = run("A", "none")
  console.log(`\nPREDICTED TABLE 1 — the gate's own decl-count model over all ${edges.length} edges`)
  show("BASE (shipped)", base)
  show("A  alias keys only, no target change", run("B", "none"))
  show("B  A + ALL constant receivers retargeted", run("B", "allConst"))
  show("C  A + own-file-declared receivers only", run("B", "ownFileConst"))
  show("D  A + project-unique receivers (ceiling)", run("B", "projectUniqueConst"))
  console.log(`   (BASE reproduces the gate's printed table exactly: resolved 9614 · collRes 2514 · amb 7667 · unresolved 14229)`)
  if (base.resolved !== 9614 || base.unres !== 14229) console.log(`   !! PROBE DOES NOT REPRODUCE THE GATE — treat every prediction below as unusable`)

  // ---- the calls bucket by receiver form, and what each variant does to it ----
  const calls = edges.filter((e) => e.label === "calls")
  const nm = calls.filter((e) => e.sig === "(no marker)")
  const formOf = (e: Edge): string => {
    if (e.qLeaf === null) {
      const hasRecv = e.toSymbol !== "" && e.toSymbol !== e.target
      if (!hasRecv) return "receiverless"
      const recv = e.toSymbol.slice(0, e.toSymbol.length - e.target.length - 1)
      if (recv.startsWith("@") || recv.startsWith("$")) return "variable-receiver"
      if (/^[a-z_][A-Za-z0-9_]*$/.test(recv)) return "lower-receiver"
      return "expr-receiver"
    }
    return "CONSTANT-receiver"
  }
  const byForm = new Map<string, { edges: number; resolved: number; amb: number; unres: number }>()
  for (const e of nm) {
    const k = formOf(e)
    const r = byForm.get(k) ?? { edges: 0, resolved: 0, amb: 0, unres: 0 }
    r.edges++
    const d = declsOf(A, e.repo, e.target)
    if (d === 0) r.unres++; else if (d > 1) r.amb++; else r.resolved++
    byForm.set(k, r)
  }
  console.log(`\nBUCKET 1 (calls, no marker, ${nm.length} edges) BY RECEIVER FORM — current outcome:`)
  for (const [k, r] of [...byForm].sort((x, y) => y[1].unres - x[1].unres)) {
    console.log(`  ${k.padEnd(19)} edges ${String(r.edges).padStart(5)} · resolved ${String(r.resolved).padStart(4)} · amb ${String(r.amb).padStart(4)} · unresolved ${String(r.unres).padStart(5)}`)
  }

  // constant-receiver detail
  const constN = nm.filter((e) => e.qLeaf !== null)
  let aliasResolve = 0, aliasAmb = 0, aliasNone = 0, ownFile = 0
  for (const e of constN) {
    const d = declsOf(B, e.repo, e.qLeaf!)
    if (d === 0) aliasNone++; else if (d === 1) aliasResolve++; else aliasAmb++
    if (e.fileDeclares) ownFile++
  }
  console.log(`\nCONSTANT-receiver no-marker calls: ${constN.length}`)
  console.log(`  the alias key \`Owner.method\` answers exactly 1 declaration: ${aliasResolve}   (in the edge's OWN file: ${ownFile})`)
  console.log(`  answers more than 1 (would be amb)                        : ${aliasAmb}`)
  console.log(`  answers nothing (no spelling change can resolve it)       : ${aliasNone}`)

  // the trap: resolved-today constant-receiver calls whose answering declaration has a DIFFERENT owner
  let ownerMatch = 0, ownerMismatch = 0
  const samples: Edge[] = []
  for (const e of constN) {
    const d = declsOf(A, e.repo, e.target)
    if (d !== 1) continue
    const rl = leafName(e.toSymbol.slice(0, e.toSymbol.length - e.target.length - 1))
    if (ownersOf(A, e.repo, e.target).includes(rl)) ownerMatch++
    else { ownerMismatch++; if (samples.length < 8) samples.push(e) }
  }
  console.log(`\nTHE TRAP, priced — constant-receiver calls that RESOLVE today by bare leaf: owner matches ${ownerMatch} · OWNER MISMATCH ${ownerMismatch}`)
  console.log(`  (a naive retarget sends all ${ownerMismatch} to unresolved — the wrong picks this would stop making)`)
  for (const e of samples) console.log(`   e.g. ${e.rel}:${e.line} target=${e.target} toSymbol=${e.toSymbol} answers=[owner ${JSON.stringify(ownersOf(A, e.repo, e.target).slice(0, 3))}]`)

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION 2 — THE PRODUCTION-STORE MODEL (`parallel-indexer.ts:5385-5545`).
  //
  // The gate's decl-count model cannot see one effect of publishing an owner-qualified
  // `qualifiedName`: strategy 1 matches `target_external = qualified_name`, and TODAY every
  // ruby member symbol's `qualified_name` IS its bare `name`, so a bare target binds to the
  // project's `MIN(id)` row for that name even when fifty declarations share it. The model
  // replays the passes in production's order:
  //   1 own-file qualified-name exact   2 own-file name   3 project qualified-name exact
  //   4 project bare name only when UNIQUE   5 dotted-suffix (strategy 3)
  // per regime: BEFORE = shipped, AFTER = method symbols publish `Owner.method`.
  //
  // LIMITS, declared: `MIN(id)` is not reproduced (only WHETHER the pass binds, and how many
  // candidates it picked among); strategy 4 (structural) is not modelled; only the 400-file
  // sampled population is consulted, so a binding whose candidate lives in an unsampled file
  // of the same project reads UNBOUND here.
  // ───────────────────────────────────────────────────────────────────────────
  const storeKeys = new Map<string, { q: Map<string, number>; ownQ: Map<string, Set<string>>; ownN: Map<string, Set<string>>; n: Map<string, number> }>()
  const addSym = (k: any, file: string, name: string, qual: string) => {
    k.q.set(qual, (k.q.get(qual) ?? 0) + 1)
    k.n.set(name, (k.n.get(name) ?? 0) + 1)
    let oq = k.ownQ.get(file); if (!oq) { oq = new Set(); k.ownQ.set(file, oq) }
    oq.add(qual)
    let on = k.ownN.get(file); if (!on) { on = new Set(); k.ownN.set(file, on) }
    on.add(name)
  }
  for (const f of files) {
    const repo = repoOf(f)
    const parsed: any = await parseFile(f, repo, { projectRoot: repo } as any)
    for (const regime of ["before", "after"] as const) {
      const key = `${repo}\u0000${regime}`
      const k = storeKeys.get(key) ?? { q: new Map(), ownQ: new Map(), ownN: new Map(), n: new Map() }
      storeKeys.set(key, k)
      for (const s of Array.isArray(parsed?.symbols) ? parsed.symbols : []) {
        const name = String(s?.name ?? "")
        if (!name) continue
        const owner = String(s?.ownerName ?? "")
        const kind = String(s?.kind ?? "")
        const declared = String(s?.qualifiedName ?? "") || String(s?.metadata?.fqn ?? "")
        // pool-worker.ts:1268's normalization: qualifiedName || fqn || (scope ? scope.name : name)
        const shipped = declared || name
        const qualified = regime === "after" && kind === "method" && owner ? `${owner}.${name}` : shipped
        addSym(k, f, name, qualified)
      }
    }
  }
  const suffixSetOf = (k: any): Set<string> => {
    const all = new Set<string>()
    for (const [q] of k.q) {
      if (q.includes(".")) all.add(q)
      let rest = q
      while (true) {
        const i = rest.indexOf(".")
        if (i < 0) break
        rest = rest.slice(i + 1)
        if (rest.includes(".")) all.add(rest)
      }
    }
    return all
  }
  const bindOf = (k: any, suffixes: Set<string>, file: string, text: string): string => {
    if (k.ownQ.get(file)?.has(text)) return "own-file-qname"
    if (k.ownN.get(file)?.has(text)) return "own-file-name"
    const qn = k.q.get(text)
    if (qn !== undefined) return qn > 1 ? "project-qname(ARBITRARY)" : "project-qname"
    if ((k.n.get(text) ?? 0) === 1) return "bare-unique"
    if (text.includes(".") && suffixes.has(text)) return "dotted-suffix"
    return "UNBOUND"
  }
  const tallyStore = (regime: "before" | "after") => {
    const out = { bound: 0, unbound: 0, arbitrary: 0, mech: new Map<string, number>() }
    for (const e of edges) {
      const k: any = storeKeys.get(`${e.repo}\u0000${regime}`)!
      k._suffixes ??= suffixSetOf(k)
      const mech = bindOf(k, k._suffixes, e.file, e.target)
      if (mech === "UNBOUND") out.unbound++
      else {
        out.bound++
        if (mech.startsWith("project-qname(ARBITRARY")) out.arbitrary++
      }
      out.mech.set(mech, (out.mech.get(mech) ?? 0) + 1)
    }
    return out
  }
  const sb = tallyStore("before"), sa = tallyStore("after")
  console.log(`\nPRODUCTION-STORE MODEL (strategy passes 1-4 + dotted suffix) over ${edges.length} edges:`)
  for (const [regime, t] of [["BEFORE", sb], ["AFTER", sa]] as const) {
    console.log(`  ${regime}: bound ${t.bound} · UNBOUND ${t.unbound} · of the bound, ARBITRARY picks ${t.arbitrary}`)
    for (const [m, n] of [...t.mech].sort((x, y) => y[1] - x[1])) console.log(`      ${m.padEnd(30)} ${n}`)
  }
  console.log(`  DELTA: bound ${sa.bound - sb.bound >= 0 ? "+" : ""}${sa.bound - sb.bound} · unbound ${sa.unbound - sb.unbound >= 0 ? "+" : ""}${sa.unbound - sb.unbound} · arbitrary ${sa.arbitrary - sb.arbitrary >= 0 ? "+" : ""}${sa.arbitrary - sb.arbitrary}`)
  // WHICH BINDINGS ARE LOST, and were they arbitrary? A lost ARBITRARY pick is a wrong
  // pick removed; a lost DETERMINED pick is coverage genuinely lost.
  const beforeMech = new Map<string, string>()
  for (const e of edges) {
    const k: any = storeKeys.get(`${e.repo}\u0000before`)!
    k._suffixes ??= suffixSetOf(k)
    beforeMech.set(`${e.file}:${e.line}:${e.target}:${e.label}`, bindOf(k, k._suffixes, e.file, e.target))
  }
  let lostArbitrary = 0, lostDetermined = 0, gainedFromArbitrary = 0
  const lostByType = new Map<string, number>()
  const lostSamples: string[] = []
  for (const e of edges) {
    const kb: any = storeKeys.get(`${e.repo}\u0000before`)!
    const ka: any = storeKeys.get(`${e.repo}\u0000after`)!
    kb._suffixes ??= suffixSetOf(kb); ka._suffixes ??= suffixSetOf(ka)
    const b = bindOf(kb, kb._suffixes, e.file, e.target)
    const a = bindOf(ka, ka._suffixes, e.file, e.target)
    const wasArb = b.startsWith("project-qname(ARBITRARY")
    const isArb = a.startsWith("project-qname(ARBITRARY")
    if (b !== "UNBOUND" && a === "UNBOUND") {
      if (wasArb) lostArbitrary++; else {
        lostDetermined++
        lostByType.set(e.label, (lostByType.get(e.label) ?? 0) + 1)
        if (lostSamples.length < 10) lostSamples.push(`${e.rel}:${e.line} ${e.label} target=${JSON.stringify(e.target)} was=${b}`)
      }
    }
    if (wasArb && !isArb && a !== "UNBOUND") gainedFromArbitrary++
  }
  console.log(`\nBINDINGS LOST BY PUBLISHING Owner.method — were they arbitrary?`)
  console.log(`   lost ARBITRARY picks (a mostly-wrong pick removed, ~75% per the indexer's census): ${lostArbitrary}`)
  console.log(`   lost DETERMINED bindings (coverage genuinely lost)                          : ${lostDetermined}`)
  for (const [t, n] of [...lostByType].sort((x, y) => y[1] - x[1])) console.log(`      ${t.padEnd(14)} ${n}`)
  for (const s of lostSamples) console.log(`      e.g. ${s}`)
  console.log(`   arbitrary picks REPLACED by a determined binding: ${gainedFromArbitrary}`)

}

main().catch((e) => { console.error(e); process.exit(1) })

