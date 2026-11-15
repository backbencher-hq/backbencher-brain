/**
 * probe-cs-residual-causes — WHAT the csharp lane's 14,621 unresolved edges ARE, by NAMED CAUSE,
 * and what the CANDIDATE FIX would do to them.
 *
 * WHY IT EXISTS. `script/m14/incoming-gate.ts csharp cs 400` reports `unresolved 14621` and a
 * 25-name-capped worklist. A number a lane cannot take apart is not a worklist, and this programme
 * has already paid twice for classifying from a sample of names instead of the population (php's
 * "silent overrides" verdict, kotlin's capped worklist). So this file walks the SAME population the
 * gate walks, applies the SAME RULE — `classifyEdge` is IMPORTED from `script/m14/incoming-rule.ts`,
 * never copied — and REFUSES TO PRINT unless every per-type number equals a fresh gate run's JSON.
 * The equality assert is the control: if this walk drifts from the gate's, it exits 3 instead of
 * publishing a family table about a population nobody else can see.
 *
 * WHAT IT ADDS OVER THE GATE:
 *   1  CAUSES, by construct, over the FULL unresolved population (the gate caps names at 25).
 *   2  the RECEIVER the calls pass already computes and discards — `metadata.csharpCallExpression`
 *      is the full member path (`StringComparison.OrdinalIgnoreCase`), while the published target is
 *      the bare leaf (`OrdinalIgnoreCase`). This counts that class exactly, split by receiver shape.
 *   3  THE TRAP, measured before it is walked into: for each candidate rewrite `leaf` ->
 *      `<base>.<leaf>` this reports how many edges would resolve to EXACTLY ONE declaration
 *      (good), to MORE THAN ONE (a tie-break the indexer measures ~75% wrong), to NONE (a stated
 *      cause at best), and — separately — how many CURRENT RESOLUTIONS the rewrite would destroy.
 *      A rewrite that trades a resolution for a better-looking `unresolved` column is a regression,
 *      and this is the number that says so before the edit, not after.
 *
 * USAGE  bun validation/m14/fixtures/csharp/probe-cs-residual-causes.ts [--json] [--max=400]
 * EXIT   0 census printed · 3 the population is not the gate's (or the gate's control did not fire)
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { classifyEdge, externalClaimOf } from "../../../../script/m14/incoming-rule"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..", "..", "..")
const GATE = path.join(ROOT, "script/m14/incoming-gate.ts")

// Copied from incoming-gate.ts:257 — same corpus root, same env override.
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

const LABEL_ALIASES: Record<string, Type> = {
  calls: "calls", call: "calls", uses: "uses", contains: "contains", composition: "contains",
  part_of: "contains", imports: "imports", brain_import: "imports", exports: "exports",
  export: "exports", references: "references", reference: "references", ref: "references",
  depends_on: "references", related: "references", extends: "extends", implements: "implements",
  overrides: "overrides", override: "overrides", instantiates: "instantiates",
  instantiate: "instantiates", creates: "instantiates",
}
const ontologyName = (raw: string): Type | null => LABEL_ALIASES[raw] ?? null

/** Copied from incoming-gate.ts:323-416 — the discovery, so the population is the same set. */
function discoverFiles(lang: string, exts: string[], maxFiles: number): { files: string[]; total: number; repos: number } {
  const found: string[] = []
  const repos = new Set<string>()
  let entries: string[]
  try {
    entries = readdirSync(CR)
  } catch {
    return { files: [], total: 0, repos: 0 }
  }
  for (const name of entries.sort()) {
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
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) {
      const low = rel.toLowerCase()
      const base = low.slice(low.lastIndexOf("/") + 1)
      const admitted = exts.some((e) => low.endsWith(`.${e}`)) ||
        (exts.some((e) => base === e) && lang === "csharp")
      if (!admitted) continue
      const abs = path.join(dir, rel)
      try {
        if (statSync(abs).size > SIZE_CAP) continue
      } catch {
        continue
      }
      found.push(abs)
      repos.add(name)
    }
  }
  found.sort()
  const total = found.length
  let files = found
  if (maxFiles > 0 && total > maxFiles) {
    const stride = Math.max(1, Math.floor(total / maxFiles))
    const picked: string[] = []
    for (let i = 0; i < found.length && picked.length < maxFiles; i += stride) picked.push(found[i])
    files = picked
  }
  return { files, total, repos: repos.size }
}

const isIdent = (s: string): boolean => {
  if (s.length === 0) return false
  const c0 = s.charCodeAt(0)
  const first = (c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || c0 === 95
  if (!first) return false
  for (let i = 1; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95)) return false
  }
  return true
}
const isUpperInitial = (s: string): boolean => s.length > 0 && s.charCodeAt(0) >= 65 && s.charCodeAt(0) <= 90

type Cause = string
const mkCauseMap = (): Map<Cause, { occurrences: number; names: Set<string>; examples: string[] }> => new Map()
const addCause = (m: Map<Cause, { occurrences: number; names: Set<string>; examples: string[] }>, c: Cause, tgt: string) => {
  let e = m.get(c)
  if (!e) { e = { occurrences: 0, names: new Set(), examples: [] }; m.set(c, e) }
  e.occurrences++
  e.names.add(tgt)
  if (e.examples.length < 8) e.examples.push(tgt)
}

/** THE NAMED CAUSE of an edge the rule left unresolved. Derived only from what the EDGE carries. */
function causeOf(t: Type, tgt: string, md: Record<string, unknown>): Cause {
  if (t === "calls") {
    if (md.isConstructorInitializer === true) return "calls/constructor-initializer (: base()/: this())"
    const call = typeof md.csharpCallExpression === "string" ? md.csharpCallExpression : ""
    if (call.length === 0) return "calls/no-callee-path-recorded"
    if (!call.includes(".")) return "calls/bare-name-no-receiver"
    const dot = call.lastIndexOf(".")
    const owner = call.slice(0, dot)
    const root = owner.split(".")[0]
    const segs = owner.split(".").length
    const multi = segs > 1 ? " (multi-segment receiver)" : ""
    if (root === "this" || root === "base") return `calls/receiver-rooted-at-${root}${multi}`
    if (isUpperInitial(root)) return `calls/receiver-written-type-like${multi}`
    return `calls/receiver-is-value-or-field${multi}`
  }
  if (t === "uses") {
    // The field-pass reads the receiver (`node.childForFieldName("expression")`, :3165) but the
    // published target is the member NAME only, and metadata.fieldAccess is the READ-SITE key
    // (`<containingFunction>.<member>`), not the receiver — so the receiver is discarded here.
    if (md.relationshipType === "csharp_field_access") return "uses/member-read-on-a-receiver-not-published"
    return "uses/other"
  }
  if (t === "references") {
    if (md.isUsingDirective === true) {
      return tgt.includes(".") ? "references/using-directive-namespace (dotted)" : "references/using-directive-namespace (single segment)"
    }
    if (typeof md.declaredOn === "string") return `references/declared-type-not-in-key-space (declaredOn=${md.declaredOn})`
    if (md.relationshipType === "using_type_argument") return "references/using-type-argument"
    return "references/other"
  }
  if (t === "instantiates") {
    if (md.isNew === true) return "instantiates/new-on-a-type-not-in-key-space"
    if (md.isImplicit === true) return "instantiates/implicit-new-on-a-type-not-in-key-space"
    return "instantiates/other"
  }
  if (t === "extends") return "extends/base-type-not-in-key-space"
  if (t === "implements") return "implements/interface-not-in-key-space"
  if (t === "imports") return "imports/using-module-path"
  if (t === "overrides") return "overrides/parent-member-not-in-key-space"
  if (t === "contains") return "contains/target-not-in-key-space"
  if (t === "exports") return "exports/export-name-not-in-key-space"
  return `${t}/other`
}

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes("--json")
const maxArg = argv.find((a) => a.startsWith("--max="))
const MAX = Number(maxArg ? maxArg.split("=")[1] : 400)

/** THE GATE'S OWN NUMBERS, for the equality assert. A FAIL verdict exits 1 but still prints JSON. */
function gateJson(): any {
  try {
    const out = execFileSync("bun", ["run", GATE, "csharp", "cs", String(MAX), "--json"],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 128 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] })
    return JSON.parse(out)
  } catch (e) {
    const status = (e as { status?: number })?.status
    const stdout = String((e as { stdout?: string | Buffer })?.stdout ?? "")
    if (status === 3 || stdout.trim().length === 0) {
      console.error("the fleet gate refused to measure (see its message above); refusing to census a population that was not measured")
      process.exit(3)
    }
    return JSON.parse(stdout)
  }
}

const gate = gateJson()
if (!gate?.instrumentSelfTest?.ok) {
  console.error("FATAL: the fleet gate's own self-test did not fire; its numbers cannot anchor this census.")
  process.exit(3)
}

const { files, total, repos } = discoverFiles("csharp", ["cs"], MAX)

async function main(): Promise<void> {
  // per REPO, exactly as the gate does: `countKey` over name + qualifiedName alias.
  const declByRepo = new Map<string, Map<string, number>>()
  const kindsByRepo = new Map<string, Map<string, Set<string>>>()
  const perType = new Map<Type, { edges: number; resolved: number; ambiguousByDecl: number; unresolved: number }>()
  for (const t of ALL_TYPES) perType.set(t, { edges: 0, resolved: 0, ambiguousByDecl: 0, unresolved: 0 })

  const repoOf = (f: string): string => {
    const rel = f.startsWith(CR) ? f.slice(CR.length + 1) : f
    return path.join(CR, rel.split(path.sep)[0])
  }

  const causes = mkCauseMap()
  const causesByType = new Map<Type, Map<Cause, { occurrences: number; names: Set<string>; examples: string[] }>>()
  for (const t of ALL_TYPES) causesByType.set(t, mkCauseMap())

  // THE TRAP, per candidate rewrite class.
  type Rewrite = { edges: number; toNone: number; toOne: number; toMany: number; examples: string[] }
  const mkRewrite = (): Rewrite => ({ edges: 0, toNone: 0, toOne: 0, toMany: 0, examples: [] })
  const rewrite = {
    unresolvedCalls_typeLikeReceiver: mkRewrite(),
    unresolvedCalls_valueOrFieldReceiver: mkRewrite(),
    currentlyResolvedCalls_wouldLoseResolution: mkRewrite(),
    currentlyAmbiguousCalls_wouldMove: mkRewrite(),
  }
  // R1 — the fixture-safe narrowing: `<Type>.<leaf>` only when the receiver is ONE identifier,
  // upper-initial, and NOT a type declared in the edge's own FILE. R2 — the ZERO-RETARGET class:
  // targets that are ALREADY dotted with an identifier-shaped owner, so a declared cause can be
  // attached with no spelling change at all.
  const R1 = { edges: 0, unresolved: mkRewrite(), resolved: mkRewrite(), ambiguous: mkRewrite() }
  const R2 = mkCauseMap()
  const R2rootAbsent = mkCauseMap()
  const R2rootDeclared = mkCauseMap()
  const R1baseAbsent = mkCauseMap()
  const R1baseDeclared = mkCauseMap()
  const R1samples: { file: string; line: number; target: string; qualified: string; bareOutcome: string; baseDeclared: boolean }[] = []

  const unresolved: { type: Type; target: string; md: Record<string, unknown>; repo: string }[] = []

  // ── PASS 1 — THE WHOLE KEY SPACE, THEN THE EDGES. The gate DEFERS classification until every
  // sampled file's symbols are in (`PendingEdge`), and a census that classifies while it walks
  // reads a half-built key space: the first attempt reported calls.unresolved 6892 against the
  // gate's 6152 for exactly this reason. Structure, not arithmetic, is what makes them agree.
  const pending: { label: Type; tgt: string; claim: ReturnType<typeof externalClaimOf>; md: Record<string, unknown>; repo: string; file: string; line: number }[] = []
  /** the TYPE names a single FILE declares (the only cross-declaration knowledge the analyzer has
   *  in a per-file run: `context.typeKinds` is undefined unless the gate runs with --index). */
  const fileTypes = new Map<string, Set<string>>()
  const TYPE_KINDS = new Set(["class", "interface", "struct", "enum", "type"])
  let parsed = 0
  for (const f of files) {
    let r: any
    try {
      r = await parseFile(f, repoOf(f))
    } catch {
      continue
    }
    if (!r || r.fallback === true) continue
    parsed++
    const repo = repoOf(f)
    let decl = declByRepo.get(repo)
    if (!decl) { decl = new Map(); declByRepo.set(repo, decl) }
    let kinds = kindsByRepo.get(repo)
    if (!kinds) { kinds = new Map(); kindsByRepo.set(repo, kinds) }
    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      const name = String(s?.name ?? "")
      if (name.length === 0) continue
      const kind = String(s?.kind ?? "")
      const bump = (k: string) => {
        decl!.set(k, (decl!.get(k) ?? 0) + 1)
        let ks = kinds!.get(k)
        if (!ks) { ks = new Set(); kinds!.set(k, ks) }
        ks.add(kind)
      }
      bump(name)
      const q = String(s?.qualifiedName ?? "")
      if (q.length > 0 && q !== name) bump(q)
      if (TYPE_KINDS.has(kind)) {
        let ft = fileTypes.get(f)
        if (!ft) { ft = new Set(); fileTypes.set(f, ft) }
        ft.add(name)
      }
    }
    for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
      const label = ontologyName(String(rel?.type ?? rel?.relationshipType ?? ""))
      if (!label) continue
      const row = perType.get(label)!
      row.edges++
      const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
      if (tgt.length === 0) continue
      const md = (rel?.metadata ?? {}) as Record<string, unknown>
      pending.push({ label, tgt, claim: externalClaimOf(rel), md, repo, file: f, line: Number(rel?.line_number ?? rel?.lineNumber ?? rel?.line ?? 0) || 0 })
    }
  }

  // ── PASS 2 — classify every edge against the finished key space, with the gate's own rule.
  for (const e of pending) {
    const label = e.label
    const tgt = e.tgt
    const repo = e.repo
    const md = e.md
    const rel_line = e.line
    const decl = declByRepo.get(repo) ?? new Map<string, number>()
    const kinds = kindsByRepo.get(repo) ?? new Map<string, Set<string>>()
    {
      const row = perType.get(label)!
      const claim = e.claim
      const pc = classifyEdge(decl, kinds, tgt, claim, undefined, label === "contains", false)
      if (pc.outcome === "resolved") row.resolved++
      else if (pc.outcome === "ambDeclOnly" || pc.outcome === "ambBoth") row.ambiguousByDecl++
      else if (pc.outcome === "unresolved") {
        row.unresolved++
        unresolved.push({ type: label, target: tgt, md, repo })
        const c = causeOf(label, tgt, md)
        addCause(causes, c, tgt)
        addCause(causesByType.get(label)!, c, tgt)
      }

      // ── R2 — ZERO-RETARGET CAUSE ELIGIBILITY: the target is ALREADY dotted with exactly one dot
      // and an identifier-shaped owner, so `baseBeyondRunScope: <owner>` can be attached with NO
      // spelling change. The arbiter reads a cause ONLY where the target names nothing, so this
      // class cannot move a resolution or an ambiguity by construction — the largest safe win.
      if (pc.outcome === "unresolved") {
        const dot = tgt.indexOf(".")
        if (dot > 0 && dot === tgt.lastIndexOf(".") && isIdent(tgt.slice(0, dot))) {
          const root = tgt.slice(0, dot)
          addCause(R2, `${label}/claimable-base:${root}`, tgt)
          // IS THE CLAIM TRUE? A cause says the BASE is beyond the run's reach. The target names
          // nothing (that is this branch), but the ROOT could still be a declared symbol — then the
          // stated reason would be FALSE and no arbiter check would catch it (the arbiter checks the
          // reason is the target's own owner, not that the base is absent). Measured, not assumed.
          const rootDecls = decl.get(root) ?? 0
          addCause(rootDecls > 0 ? R2rootDeclared : R2rootAbsent, `${label}/claimable-base:${root}`, tgt)
        }
      }

      // ── R1 — THE NARROWED QUALIFIER PUBLISH: receiver = ONE upper-initial identifier that this
      // FILE does not declare as a type (a same-file type keeps its bare leaf: no qualifiedName
      // alias is published, so retargeting an internal call would DESTROY its resolution).
      if (label === "calls") {
        const call = typeof md.csharpCallExpression === "string" ? md.csharpCallExpression : ""
        const segs = call.split(".")
        if (segs.length === 2 && isIdent(segs[0]) && isUpperInitial(segs[0]) &&
            segs[0] !== "this" && segs[0] !== "base" && !(fileTypes.get(e.file)?.has(segs[0]) ?? false)) {
          const h = decl.get(`${segs[0]}.${tgt}`) ?? 0
          const into = (rw: Rewrite, ex: string) => {
            rw.edges++
            if (h === 0) rw.toNone++
            else if (h === 1) rw.toOne++
            else rw.toMany++
            if (rw.examples.length < 6) rw.examples.push(`${tgt} -> ${segs[0]}.${tgt} (decls ${h}) [${ex}]`)
          }
          R1.edges++
          if (pc.outcome === "unresolved") {
            into(R1.unresolved, repo.split(path.sep).pop() ?? "")
            // IS THE STATED REASON TRUE? `baseBeyondRunScope: <receiver>` says the RECEIVER is
            // beyond the run's reach. If the key space publishes the receiver, the claim is FALSE
            // and NO arbiter check catches it (the arbiter checks the reason is the target's own
            // owner, never that the base is absent). Measured here, because a cause claim that the
            // population refutes is the one thing this programme treats as a false statement.
            addCause((decl.get(segs[0]) ?? 0) > 0 ? R1baseDeclared : R1baseAbsent, `base:${segs[0]}`, `${tgt} -> ${segs[0]}.${tgt}`)
            if (R1samples.length < 12) {
              R1samples.push({ file: e.file, line: Number(rel_line), target: tgt, qualified: `${segs[0]}.${tgt}`,
                bareOutcome: "unresolved", baseDeclared: (decl.get(segs[0]) ?? 0) > 0 })
            }
          } else if (pc.outcome === "resolved") into(R1.resolved, "currently RESOLVED")
          else if (pc.outcome === "ambDeclOnly" || pc.outcome === "ambBoth") into(R1.ambiguous, "currently AMBIGUOUS")
        }
      }

      // ── THE CANDIDATE REWRITE: `leaf` -> `<base>.<leaf>` for member calls ──────────────────
      if (label === "calls") {
        const call = typeof md.csharpCallExpression === "string" ? md.csharpCallExpression : ""
        if (call.includes(".")) {
          const dot = call.lastIndexOf(".")
          const owner = call.slice(0, dot)
          const base = owner.split(".").pop() ?? ""
          const root = owner.split(".")[0]
          if (base !== "this" && base !== "base" && isIdent(base)) {
            const hypo = `${base}.${tgt}`
            const h = decl.get(hypo) ?? 0
            const typeLike = isUpperInitial(root)
            const into = (rw: Rewrite, ex: string) => {
              rw.edges++
              if (h === 0) rw.toNone++
              else if (h === 1) rw.toOne++
              else rw.toMany++
              if (rw.examples.length < 6) rw.examples.push(`${tgt} -> ${hypo} (decls ${h}) [${ex}]`)
            }
            if (pc.outcome === "unresolved") {
              into(typeLike ? rewrite.unresolvedCalls_typeLikeReceiver : rewrite.unresolvedCalls_valueOrFieldReceiver, `${repo.split(path.sep).pop()}`)
            } else if (pc.outcome === "resolved") {
              into(rewrite.currentlyResolvedCalls_wouldLoseResolution, "currently RESOLVED")
            } else if (pc.outcome === "ambDeclOnly" || pc.outcome === "ambBoth") {
              into(rewrite.currentlyAmbiguousCalls_wouldMove, "currently AMBIGUOUS")
            }
          }
        }
      }
    }
  }

  // THE CONTROL — every per-type number must equal the gate's, or this census is about another walk.
  const diffs: string[] = []
  for (const t of ALL_TYPES) {
    const mine = perType.get(t)!
    const theirs = gate.perType?.[t]
    if (!theirs) { diffs.push(`${t}: gate has no row`); continue }
    const gp = theirs.project ?? {}
    const pairs: [string, number, number][] = [
      ["edges", mine.edges, theirs.edges],
      ["resolved", mine.resolved, gp.resolved],
      ["ambiguousByDecl", mine.ambiguousByDecl, gp.ambiguousByDecl],
      ["unresolved", mine.unresolved, gp.unresolved],
    ]
    for (const [k, a, b] of pairs) if (a !== b) diffs.push(`${t}.${k}: census ${a} != gate ${b}`)
  }
  if (parsed !== gate.population.parsed) diffs.push(`parsed: census ${parsed} != gate ${gate.population.parsed}`)
  if (diffs.length > 0) {
    console.error("FATAL: the census population is not the gate's population — refusing to report causes.")
    for (const d of diffs.slice(0, 25)) console.error(`  ${d}`)
    console.error("A cause table over a different walk is a number about nothing. Fix the copied walk.")
    process.exit(3)
  }

  const sorted = <T,>(m: Map<string, T & { occurrences: number }>) =>
    [...m.entries()].sort((a, b) => b[1].occurrences - a[1].occurrences)

  if (JSON_OUT) {
    console.log(JSON.stringify({
      population: { sampled: files.length, parsed, corpusTotal: total, repos, maxFiles: MAX },
      equalityControl: { ok: true, checkedAgainst: "script/m14/incoming-gate.ts csharp cs " + MAX + " --json" },
      perType: Object.fromEntries([...perType.entries()].map(([t, v]) => [t, v])),
      causes: Object.fromEntries(sorted(causes).map(([c, v]) => [c, { occurrences: v.occurrences, distinctNames: v.names.size, examples: v.examples }])),
      causesByType: Object.fromEntries([...causesByType.entries()].map(([t, m]) => [t,
        Object.fromEntries(sorted(m).map(([c, v]) => [c, { occurrences: v.occurrences, distinctNames: v.names.size, examples: v.examples }]))])),
      rewrite: rewrite,
      R1_typeLikeSingleSegmentReceiver: R1,
      R2_claimableBase_occurrences: [...R2.values()].reduce((a, v) => a + v.occurrences, 0),
    }, null, 2))
  } else {
    const w = (s: string | number, n: number) => String(s).padEnd(n)
    console.log(`csharp residual-cause census — ${parsed} parsed of ${files.length} sampled (corpus ${total} .cs across ${repos} repos)`)
    console.log(`equality control: PASS — every per-type count equals incoming-gate.ts --json on the same walk (maxFiles ${MAX})`)
    console.log()
    console.log("UNRESOLVED BY NAMED CAUSE (occurrences / distinct names) — the FULL population, not the gate's 25-name cap")
    console.log("-".repeat(120))
    for (const [c, v] of sorted(causes)) {
      console.log(`${w(c, 62)} ${w(v.occurrences, 8)} / ${v.names.size}`)
      const byType = [...causesByType.entries()]
        .map(([t, m]) => [t, m.get(c)?.occurrences ?? 0] as [Type, number])
        .filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 5)
      console.log(`${" ".repeat(64)}by type: ${byType.map(([t, n]) => `${t} ${n}`).join(", ")}`)
      console.log(`${" ".repeat(64)}e.g. ${v.examples.slice(0, 5).join(" · ")}`)
    }
    console.log()
    console.log("TOTAL unresolved (all causes):", [...causes.values()].reduce((a, v) => a + v.occurrences, 0))
    console.log()
    console.log("THE TRAP — what `leaf` -> `<base>.<leaf>` would do, measured on this key space")
    console.log("(decls = declarations in the edge's own project answering the REWRITTEN target)")
    console.log("-".repeat(120))
    console.log(`${w("candidate rewrite class", 52)} ${w("edges", 8)} ${w("->none", 8)} ${w("->ONE", 8)} ${w("->MANY", 8)}`)
    for (const [k, rw] of Object.entries(rewrite)) {
      console.log(`${w(k, 52)} ${w(rw.edges, 8)} ${w(rw.toNone, 8)} ${w(rw.toOne, 8)} ${w(rw.toMany, 8)}`)
      for (const ex of rw.examples.slice(0, 4)) console.log(`${" ".repeat(54)}${ex}`)
    }
    console.log()
    console.log("R1 — NARROWED QUALIFIER PUBLISH: `calls` with a ONE-segment upper-initial receiver")
    console.log("that the edge's own FILE does not declare as a type (fixture-safe: value receivers and")
    console.log("same-file types keep their bare leaf, so `c.Describe`, `_items.Clear`, `Registry.Report`,")
    console.log("`helper.Strip`, `System.Console.WriteLine` and `System.IO.Path.GetDirectoryName` are untouched)")
    console.log("-".repeat(120))
    console.log(`edges in scope: ${R1.edges}`)
    for (const s2 of R1samples) console.log(`  SAMPLE ${s2.file}:${s2.line}  target=${s2.target} -> ${s2.qualified}  bareOutcome=${s2.bareOutcome} baseDeclaredInProject=${s2.baseDeclared}`)
    console.log(`  R1 stated-reason TRUTH: base ABSENT from the project key space (claim TRUE) ${[...R1baseAbsent.values()].reduce((a, v) => a + v.occurrences, 0)}` +
      ` · base IS a declared symbol (claim would be FALSE) ${[...R1baseDeclared.values()].reduce((a, v) => a + v.occurrences, 0)}`)
    for (const [c, v] of sorted(R1baseDeclared).slice(0, 8)) console.log(`    FALSE-CLAIM RISK ${c} ${v.occurrences} e.g. ${v.examples.slice(0, 3).join(" · ")}`)
    for (const [k, rw] of [["unresolved", R1.unresolved], ["resolved", R1.resolved], ["ambiguous", R1.ambiguous]] as [string, Rewrite][]) {
      console.log(`  ${w(k, 12)} ${w(rw.edges, 8)}  ->none ${w(rw.toNone, 6)}  ->ONE ${w(rw.toOne, 6)}  ->MANY ${rw.toMany}`)
      for (const ex of rw.examples.slice(0, 3)) console.log(`${" ".repeat(16)}${ex}`)
    }
    console.log()
    console.log("R2 — ZERO-RETARGET CAUSE ELIGIBILITY: unresolved targets ALREADY dotted with a")
    console.log("single identifier-shaped owner (a stated cause, no spelling change, cannot move a resolution)")
    console.log("-".repeat(120))
    for (const [c, v] of sorted(R2)) {
      console.log(`${w(c, 62)} ${w(v.occurrences, 8)} / ${v.names.size}  e.g. ${v.examples.slice(0, 4).join(" · ")}`)
    }
    console.log(`R2 TOTAL (all base keys): ${[...R2.values()].reduce((a, v) => a + v.occurrences, 0)}`)
    console.log(`  of those, the stated base is ABSENT from the project key space (claim TRUE): ${[...R2rootAbsent.values()].reduce((a, v) => a + v.occurrences, 0)}`)
    console.log(`  of those, the stated base IS a declared symbol (claim would be FALSE): ${[...R2rootDeclared.values()].reduce((a, v) => a + v.occurrences, 0)}`)
    for (const [c, v] of sorted(R2rootDeclared)) console.log(`    FALSE-CLAIM RISK ${c} ${v.occurrences} e.g. ${v.examples.slice(0, 4).join(" · ")}`)
  }
  process.exit(0)
}

await main()
