/**
 * PYTHON SIX QUESTIONS — the Part-1 verification for every type this analyzer already emits.
 *
 * The workstream is explicit that source derivation answers ONE of six questions, and that
 * an aggregate agreement rate is not an answer to any of them:
 *
 *   1 EXISTS   — the analyzer can construct it. Source derivation, which is all it can say.
 *   2 FIRES    — production parseFile produces it on a real corpus, with a count. A branch
 *                that never matches is dead code and derivation cannot see it.
 *   3 CORRECT  — an INDEPENDENT derivation over the same grammar agrees. The oracle is a
 *                separate walker over the SAME tree-sitter grammar, so a grammar bug shared
 *                by both paths is INVISIBLE to this comparison. That is the harness's
 *                declared limitation and it is printed, not glossed.
 *   4 LABELLED — the edge carries the right type, not a neighbour. Measured here as
 *                PAIRWISE CO-OCCURRENCE: for every unordered type pair, how many
 *                (source,target) pairs the analyzer published under BOTH labels. A
 *                non-zero cell is either a genuine dual reading or a mislabel, and the
 *                cell is printed either way so the decision is visible.
 *   5 RESOLVED — both endpoints bind to a name this file or this file's imports can reach.
 *                Plus the standing R7 checks: no endpoint equal to the placeholder literal
 *                `unknown`, no empty name, and synthetic-scope sources counted by name.
 *   6 CONFIDENT— the confidence distribution, and the count under 0.7, which is a heuristic
 *                by the honesty contract and has to be countable as one.
 *
 * NO REGEX (programme rule 1). Every structural question is answered from a tree-sitter
 * node; the one text operation is a hand-written identifier tokeniser for Q1, because
 * "which enum members does this source name" is a question about tokens, not about shapes.
 *
 * The population is DERIVED and printed next to every number
 * (docs/M14-HONESTY-CONTRACT.md §"an instrument must declare the population it covered").
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join } from "node:path"
import { execFileSync } from "node:child_process"

const REPO = process.env.BB_REPO ?? "$HOME/backbencher-brain"
const CORPUS_ROOT = process.env.BB_CORPUS ?? "$HOME/fixtures/repositories"
const PY_CORPUS = process.env.BB_PY_CORPUS ?? join(CORPUS_ROOT, "python-corpus")
const LIMIT = Number(process.env.LIMIT ?? 0)
const EXTS = [".py", ".pyi"]

type N = any

/* ------------------------------------------------------------------ *
 * Q1 helper — an identifier tokeniser with no regex anywhere.
 * ------------------------------------------------------------------ */
function identifierTokens(src: string): string[] {
  const out: string[] = []
  let cur = ""
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i)
    const isWord = (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95
    if (isWord) { cur += src[i]; continue }
    if (cur.length) { out.push(cur); cur = "" }
  }
  if (cur.length) out.push(cur)
  return out
}

/* ------------------------------------------------------------------ *
 * Population.
 * ------------------------------------------------------------------ */
interface CorpusFile { repo: string; rel: string; abs: string }

function deriveCorpus(): { files: CorpusFile[]; sources: { name: string; admitted: number }[] } {
  if (!existsSync(PY_CORPUS)) {
    console.error(`\nSIX QUESTIONS: no python corpus at ${PY_CORPUS}. Refusing to score an empty population.\n`)
    process.exit(2)
  }
  const files: CorpusFile[] = []
  const sources: { name: string; admitted: number }[] = []
  const SKIP_DIR = new Set([".git", "node_modules", "__pycache__", ".tox", ".mypy_cache"])
  for (const e of readdirSync(PY_CORPUS, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === ".git") continue
    const dir = join(PY_CORPUS, e.name)
    let admitted = 0
    const stack: string[] = [dir]
    while (stack.length) {
      const d = stack.pop()!
      let ents
      try { ents = readdirSync(d, { withFileTypes: true }) } catch { continue }
      for (const x of ents) {
        if (x.isDirectory()) {
          if (SKIP_DIR.has(x.name)) continue
          stack.push(join(d, x.name))
        } else if (EXTS.some((t) => x.name.endsWith(t))) {
          const abs = join(d, x.name)
          let size = 0
          try { size = statSync(abs).size } catch { continue }
          if (size > 400_000) continue
          files.push({ repo: e.name, rel: abs.slice(dir.length + 1), abs })
          admitted++
        }
      }
    }
    sources.push({ name: e.name, admitted })
  }
  if (!files.length) {
    console.error(`\nSIX QUESTIONS: derived population is EMPTY. Refusing to print a count about nothing.\n`)
    process.exit(2)
  }
  return { files, sources }
}

/** Synthetic scope names the indexer recognises — a source endpoint equal to one is legal
 *  but has to be COUNTED, which is exactly what rule R7 asks for. Derived from the indexer
 *  at read time rather than copied, so it cannot drift. */
function genericSourceNames(): string[] {
  const p = join(REPO, "src", "ast", "parallel-indexer.ts")
  if (!existsSync(p)) return []
  const lines = readFileSync(p, "utf8").split("\n")
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes("GENERIC_SOURCE_NAMES")) continue
    // The literal spans lines (`new Set([` then the names), so accumulate from the first
    // "[" until the first "]". An earlier version required both on one line and picked up
    // the WRONG literal — `INTRA_CLASS_RECEIVERS = new Set(["self","this","me","Self"])` on
    // the line below — which would have declared `self` a synthetic scope.
    let window = ""
    let started = false
    for (let j = i; j < Math.min(lines.length, i + 8); j++) {
      window += lines[j] + "\n"
      if (!started) { if (window.indexOf("[") < 0) continue; started = true }
      const rb = window.indexOf("]")
      if (rb < 0) continue
      const body = window.slice(0, rb)
      const out: string[] = []
      let k = 0
      for (;;) {
        const q = body.indexOf('"', k)
        if (q < 0) break
        const q2 = body.indexOf('"', q + 1)
        if (q2 < 0) break
        out.push(body.slice(q + 1, q2))
        k = q2 + 1
      }
      if (out.length) return out
    }
  }
  return []
}

const { getParser, ASTEngine } = await import(`${REPO}/src/ast/engine.ts`)
const { RealPythonAnalyzer } = await import(`${REPO}/src/ast/real-python-analyzer.ts`)
const { derivePythonTruth } = await import(`${REPO}/script/m14/oracles/python-truth.ts`)

const PROD = [...new Set(Object.values(ASTEngine.RelationshipType))]
const GENERIC_SOURCES = genericSourceNames()

/* ------------------------------------------------------------------ *
 * Q1 — EXISTS (source derivation)
 * ------------------------------------------------------------------ */
const analyzerSrc = readFileSync(join(REPO, "src", "ast", "real-python-analyzer.ts"), "utf8")
const toks = identifierTokens(analyzerSrc)
const derived = new Map<string, number>()
for (let i = 0; i < toks.length; i++) {
  if (toks[i] !== "RelationshipType") continue
  const member = toks[i + 1]
  if (!member) continue
  derived.set(member, (derived.get(member) ?? 0) + 1)
}
// Map each production type to the enum member name(s) that spell it. No regex: the
// vocabulary is read out of engine.ts, so a type added upstream shows up as unmapped.
const engineSrc = readFileSync(join(REPO, "src", "ast", "engine.ts"), "utf8")
/** Map each production type value to the enum member(s) that spell it, read out of
 *  engine.ts line by line so a type added upstream cannot be silently unmapped. */
const memberOfType = new Map<string, string[]>()
{
  const lines = engineSrc.split("\n")
  let inBlock = false
  for (const l of lines) {
    const t = l.trim()
    if (t.startsWith("export enum RelationshipType")) { inBlock = true; continue }
    if (inBlock && t.startsWith("}")) { inBlock = false; continue }
    if (!inBlock) continue
    const eq = t.indexOf("=")
    if (eq < 0) continue
    const member = t.slice(0, eq).trim()
    const rest = t.slice(eq + 1)
    const q1 = rest.indexOf('"')
    if (q1 < 0) continue
    const q2 = rest.indexOf('"', q1 + 1)
    if (q2 < 0) continue
    const value = rest.slice(q1 + 1, q2)
    let arr = memberOfType.get(value)
    if (!arr) { arr = []; memberOfType.set(value, arr) }
    if (!arr.includes(member)) arr.push(member)
  }
}

/**
 * The analyzer's module-scope name, re-derived here from its DOCUMENTED rule rather than
 * imported, so a change to the analyzer's derivation shows up as a disagreement instead of
 * being copied silently into the instrument.
 *
 * Rule (real-python-analyzer.ts PY-13): take the basename, drop the extension, replace every
 * character that cannot appear in a python identifier with `_`, empty becomes `module`, and
 * a leading digit gets an `_` prefix.
 *
 * INSTRUMENT DEFECT, and the largest one in this file. The first version passed the
 * ABSOLUTE PATH to `derivePythonTruth`, so the oracle named the module
 * `$HOME/.../conversion_table` while the analyzer named it `conversion_table`.
 * That single disagreement produced 5830 phantom `imports` misses, 673 phantom `exports`
 * misses, 429 phantom `instantiates` misses, 394 `calls` misses and 445 phantom
 * `unexplained` edges — every one of them an artifact of the instrument, none of them a
 * finding. An aggregate agreement rate computed over a known-buggy key is worse than no
 * number, because every one of those rows points at analyzer code that was fine.
 */
function moduleNameOf(absPath: string): string {
  const slash = absPath.lastIndexOf("/")
  const base = slash >= 0 ? absPath.slice(slash + 1) : absPath
  const dot = base.lastIndexOf(".")
  const stem = dot > 0 ? base.slice(0, dot) : base
  let out = ""
  for (let i = 0; i < stem.length; i++) {
    const c = stem.charCodeAt(i)
    const ok = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95
    out += ok ? stem[i] : "_"
  }
  if (out.length === 0) return "module"
  const first = out.charCodeAt(0)
  return first >= 48 && first <= 57 ? `_${out}` : out
}

/* ------------------------------------------------------------------ *
 * Q2..Q6 — measured over the derived population.
 * ------------------------------------------------------------------ */
interface TypeStat {
  edges: number
  files: Set<string>
  confBelow: number
  noConf: number
  reasonCodes: Map<string, number>
  srcResolveInFile: number
  srcResolveImport: number
  srcSyntheticScope: number
  srcUnresolved: number
  tgtResolveInFile: number
  tgtResolveImport: number
  tgtUnresolved: number
  r7Unknown: number
  r7Empty: number
  lines: Set<number>
  srcUnresolvedSamples: string[]
  r7Samples: string[]
}
const blank = (): TypeStat => ({
  edges: 0, files: new Set(), confBelow: 0, noConf: 0, reasonCodes: new Map(),
  srcResolveInFile: 0, srcResolveImport: 0, srcSyntheticScope: 0, srcUnresolved: 0,
  tgtResolveInFile: 0, tgtResolveImport: 0, tgtUnresolved: 0,
  r7Unknown: 0, r7Empty: 0, lines: new Set(),
  srcUnresolvedSamples: [], r7Samples: [],
})
const stats = new Map<string, TypeStat>()
for (const t of PROD) stats.set(t, blank())

/** Q3 buckets, per type. The oracle derives per-site; the analyzer dedupes some types per
 *  kind, so BOTH a strict (type,from,to) and a kind-level comparison are recorded and the
 *  looser one is labelled as such rather than silently applied. */
interface Agree { agreed: number; missing: number; unexplained: number; oracleEdges: number; missingSamples: string[]; extraSamples: string[] }
const agree = new Map<string, Agree>()
for (const t of PROD) agree.set(t, { agreed: 0, missing: 0, unexplained: 0, oracleEdges: 0, missingSamples: [], extraSamples: [] })

/** Q4 pairwise co-occurrence: (source,target) published under two labels. */
const pairSeen = new Map<string, Set<string>>() // `${src}\0${tgt}` -> set of types
const pairMatrix = new Map<string, number>()   // `${t1}|${t2}` -> count

const oracleTypeCounts = new Map<string, number>()

let parsed = 0, failed = 0, oracleFail = 0
let scopeMismatches = 0
const { files: ALL, sources } = deriveCorpus()
const FILES = LIMIT > 0 ? ALL.slice(0, LIMIT) : ALL

for (const f of FILES) {
  let content: string
  try { content = readFileSync(f.abs, "utf8") } catch { failed++; continue }
  let pr: N
  try {
    const parser = await getParser("python")
    pr = await parser.parse(content, f.abs)
  } catch { failed++; continue }
  parsed++

  const res: any = new RealPythonAnalyzer().analyze(pr.rootNode as any, content, f.abs)
  const label = `${f.repo}/${f.rel}`

  // ---- the vocabulary this file can actually reach (for Q5) -----------------
  const symNames = new Set<string>()
  const symQualified = new Set<string>()
  for (const s of (res.symbols ?? []) as any[]) {
    if (!s?.name) continue
    symNames.add(s.name)
    if (s.ownerName) symQualified.add(`${s.ownerName}.${s.name}`)
  }
  const importedNames = new Set<string>()   // things this file imported, by local name
  const importedModules = new Set<string>() // module leaves
  for (const im of (res.imports ?? []) as any[]) {
    for (const it of (im?.items ?? []) as any[]) {
      const nm = typeof it === "string" ? it : it?.name
      if (nm) importedNames.add(nm)
    }
    if (im?.localName) importedNames.add(im.localName)
    const mod = im?.module
    if (mod) {
      const leaf = String(mod).split(".").pop()
      if (leaf) { importedModules.add(leaf); importedNames.add(leaf) }
    }
  }
  for (const r of (res.relationships ?? []) as any[]) {
    if ((r.type ?? r.relationshipType) === "imports") {
      const tgt = String(r.target ?? "")
      const colon = tgt.lastIndexOf(":")
      if (colon >= 0) {
        const leaf = tgt.slice(colon + 1)
        if (leaf && leaf !== "*") importedNames.add(leaf)
        const mod = tgt.slice(0, colon)
        const mleaf = mod.split(".").pop()
        if (mleaf) importedNames.add(mleaf)
      } else importedNames.add(tgt)
    }
  }
  const isSyntheticScope = (s: string): boolean => GENERIC_SOURCES.includes(s)
  const resolvesSource = (s: string): "file" | "import" | "synthetic" | "none" => {
    if (symNames.has(s) || symQualified.has(s)) return "file"
    if (importedNames.has(s)) return "import"
    if (isSyntheticScope(s)) return "synthetic"
    return "none"
  }
  // `imports` publishes a COMPOSITE target, `${module}:${item}` (real-python-analyzer.ts
  // line 1050). Splitting on the last colon is how the indexer reads it, and without the
  // split every imports target read as unresolved and the type scored 0.0% resolved —
  // an artifact of the instrument that looked exactly like a defect.
  const splitComposite = (s: string): [string, string] => {
    const colon = s.lastIndexOf(":")
    if (colon <= 0) return [s, ""]
    return [s.slice(0, colon), s.slice(colon + 1)]
  }
  const resolvesTarget = (s: string): "file" | "import" | "none" => {
    if (symNames.has(s) || symQualified.has(s)) return "file"
    if (importedNames.has(s) || importedModules.has(s)) return "import"
    const [mod, item] = splitComposite(s)
    if (item && (importedNames.has(item) || symNames.has(item))) return "import"
    if (mod && importedModules.has(mod.split(".").pop() ?? "")) return "import"
    return "none"
  }
  // The analyzer's own module scope (real-python-analyzer.ts PY-4/PY-13) is the source of
  // every `imports` and `exports` edge. It is not a symbol name, so it read as unresolved
  // and put imports at 84.4% / exports at 72.0% unresolved-source — again the instrument,
  // not the lane. It IS a navigable scope: the indexer knows the file stem as the file's
  // identity. Counted as its own bucket so the number is not quietly folded into "resolves".
  const SCOPE = moduleNameOf(f.abs)
  const resolvesSourceScoped = (s: string): "file" | "import" | "scope" | "none" => {
    if (s === SCOPE) return "scope"
    const r = resolvesSource(s)
    return r
  }

  // ---- Q2/Q4/Q5/Q6 over the emitted edges ---------------------------------
  for (const r of (res.relationships ?? []) as any[]) {
    const t: string | undefined = r.relationshipType ?? r.type
    if (!t) continue
    const st = stats.get(t)
    if (!st) continue
    st.edges++
    st.files.add(label)
    if (typeof r.line_number === "number") st.lines.add(r.line_number)

    const c = r.confidence
    if (typeof c !== "number") st.noConf++
    else if (c < 0.7) st.confBelow++
    const rc = r.metadata?.reasonCode
    if (typeof rc === "string") st.reasonCodes.set(rc, (st.reasonCodes.get(rc) ?? 0) + 1)

    const src = String(r.source ?? "")
    const tgt = String(r.target ?? "")
    if (src === "unknown" || tgt === "unknown") { st.r7Unknown++; if (st.r7Samples.length < 8) st.r7Samples.push(`${label} ${t}: source=${src} target=${tgt}`) }
    if (src.length === 0) st.r7Empty++
    if (tgt.length === 0) st.r7Empty++

    const sr = resolvesSourceScoped(src)
    if (sr === "file") st.srcResolveInFile++
    else if (sr === "import") st.srcResolveImport++
    else if (sr === "synthetic") st.srcSyntheticScope++
    else if (sr === "scope") st.srcResolveInFile++
    else { st.srcUnresolved++; if (st.srcUnresolvedSamples.length < 8) st.srcUnresolvedSamples.push(`${label} ${t}: ${src}`) }
    const tr = resolvesTarget(tgt)
    if (tr === "file") st.tgtResolveInFile++
    else if (tr === "import") st.tgtResolveImport++
    else st.tgtUnresolved++

    const pk = `${src}\u0000${tgt}`
    let set = pairSeen.get(pk)
    if (!set) { set = new Set(); pairSeen.set(pk, set) }
    // Only DIFFERENT labels are a co-occurrence. Two edges of the SAME type on one
    // (source,target) is multiplicity (PY-6), which the differential measures on its own
    // axis; counting it here would have filled the diagonal with 11,069 phantom "cells".
    if (set.size > 0) {
      for (const prev of set) {
        if (prev === t) continue
        const key = [prev, t].sort().join("|")
        pairMatrix.set(key, (pairMatrix.get(key) ?? 0) + 1)
      }
    }
    set.add(t)
  }

  // ---- Q3 the independent oracle -------------------------------------------
  try {
    const truth = derivePythonTruth(pr.rootNode as any, moduleNameOf(f.abs)) as { type: string; from: string; to: string; line: number }[]
    const scope = moduleNameOf(f.abs)
    const analyzerScope = new Set<string>()
    for (const r of (res.relationships ?? []) as any[]) {
      const sc = r.source
      if (typeof sc === "string" && sc === scope) analyzerScope.add(sc)
    }
    const analyzerKeys = new Set<string>()
    for (const r of (res.relationships ?? []) as any[]) {
      const t: string | undefined = r.relationshipType ?? r.type
      if (!t) continue
      analyzerKeys.add(`${t}\u0000${r.source ?? ""}\u0000${r.target ?? ""}`)
    }
    const truthKeys = new Set<string>()
    for (const e of truth) {
      truthKeys.add(`${e.type}\u0000${e.from}\u0000${e.to}`)
      oracleTypeCounts.set(e.type, (oracleTypeCounts.get(e.type) ?? 0) + 1)
    }
    for (const k of truthKeys) {
      const parts = k.split("\u0000")
      const a = agree.get(parts[0])
      if (!a) continue
      a.oracleEdges++
      if (analyzerKeys.has(k)) a.agreed++
      else { a.missing++; if (a.missingSamples.length < 6) a.missingSamples.push(`${label}: ${parts[0]} ${parts[1]} -> ${parts[2]}`) }
    }
    // If the analyzer never used this module's scope name as a source, the two sides are
    // comparing under different keys for this file and every row would be an artifact.
    if (analyzerScope.size === 0) scopeMismatches++
    for (const k of analyzerKeys) {
      if (truthKeys.has(k)) continue
      const parts = k.split("\u0000")
      const a = agree.get(parts[0])
      if (!a) continue
      a.unexplained++
      if (a.extraSamples.length < 6) a.extraSamples.push(`${label}: ${parts[0]} ${parts[1]} -> ${parts[2]}`)
    }
  } catch { oracleFail++ }
}

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */
const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
const pct = (a: number, b: number) => (b === 0 ? "  n/a" : `${((a / b) * 100).toFixed(1)}%`)

console.log(`python six questions   repo=${REPO}`)
console.log(`population, DERIVED (filesystem walk, ${EXTS.join("/")}, <=400000 B): ${ALL.length} files across ${sources.length} source(s)`)
for (const s of sources) console.log(`  ${s.name.padEnd(14)} ${String(s.admitted).padStart(5)}`)
console.log(`MEASURED OVER: ${FILES.length} parsed files${FILES.length !== ALL.length ? ` (LIMIT=${LIMIT}, a SAMPLE of ${ALL.length})` : " (the whole derived population)"}`)
console.log(`parsed ${parsed}, analyzer failures ${failed}, oracle failures ${oracleFail}, files whose analyzer scope never matched the derived module name: ${scopeMismatches}`)
console.log(`production vocabulary (${PROD.length}): ${PROD.join(" ")}`)
console.log(`GENERIC_SOURCE_NAMES read from parallel-indexer at run time (${GENERIC_SOURCES.length}): ${GENERIC_SOURCES.join(" ") || "(none found)"}`)

console.log(`\n=== Q1 EXISTS — source derivation. This is the ONLY question derivation can answer. ===`)
console.log(`${pad("type", 16)}${pad("enum member(s)", 30)}sites in analyzer source`)
for (const t of PROD) {
  const members = memberOfType.get(t) ?? []
  const sites = members.reduce((a, m) => a + (derived.get(m) ?? 0), 0)
  console.log(`${pad(t, 16)}${pad(members.join(",") || "(unmapped)", 30)}${sites}${sites === 0 ? "   <- CONSTRUCTIBLE? no" : ""}`)
}
console.log(`Types present in the analyzer source: ${[...derived.keys()].sort().join(" ")}`)
console.log(`Types in the production vocabulary with NO source site: ${PROD.filter((t) => (memberOfType.get(t) ?? []).reduce((a, m) => a + (derived.get(m) ?? 0), 0) === 0).join(" ") || "(none)"}`)

console.log(`\n=== Q2 FIRES / Q3 CORRECT / Q5 RESOLVED / Q6 CONFIDENT, per type ===`)
console.log(`${pad("type", 15)}${pad("edges", 10)}${pad("files", 8)}${pad("agree", 10)}${pad("missing", 9)}${pad("unexpl", 8)}${pad("oracle", 9)}${pad("<0.7", 7)}${pad("noConf", 8)}${pad("src:file", 10)}${pad("tgt:file", 10)}${pad("tgt:imp", 9)}${pad("tgt:none", 9)}`)
console.log("-".repeat(140))
for (const t of PROD) {
  const st = stats.get(t)!
  const a = agree.get(t)!
  console.log(
    `${pad(t, 15)}${pad(String(st.edges), 10)}${pad(String(st.files.size), 8)}` +
    `${pad(String(a.agreed), 10)}${pad(String(a.missing), 9)}${pad(String(a.unexplained), 8)}${pad(String(a.oracleEdges), 9)}` +
    `${pad(String(st.confBelow), 7)}${pad(String(st.noConf), 8)}` +
    `${pad(String(st.srcResolveInFile), 10)}${pad(String(st.tgtResolveInFile), 10)}${pad(String(st.tgtResolveImport), 9)}${pad(String(st.tgtUnresolved), 9)}`,
  )
}

console.log(`\n--- Q3 detail: what the oracle derives vs what the analyzer emits ---`)
for (const t of PROD) {
  const a = agree.get(t)!
  if (a.oracleEdges === 0 && a.unexplained === 0 && a.agreed === 0) {
    console.log(`  ${pad(t, 14)} NO ORACLE DERIVATION — this type is UNAUDITED. It is compared against nothing.`)
    continue
  }
  const rate = a.agreed + a.missing > 0 ? pct(a.agreed, a.agreed + a.missing) : "  n/a"
  console.log(`  ${pad(t, 14)} oracle ${a.oracleEdges} · agreed ${a.agreed} (${rate} of derived) · missing ${a.missing} · unexplained ${a.unexplained}`)
  for (const s of a.missingSamples) console.log(`      missing:     ${s}`)
  for (const s of a.extraSamples) console.log(`      unexplained: ${s}`)
}
console.log(`  Oracle types it derives: ${[...oracleTypeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`)
console.log(`  THE HARNESS'S DECLARED LIMITATION: derivePythonTruth and RealPythonAnalyzer are two walkers`)
console.log(`  over the SAME tree-sitter grammar. They disagree when either is wrong. They CANNOT disagree`)
console.log(`  about a construct the grammar does not produce, so a shared grammar defect is invisible here.`)
console.log(`  Agreement below is therefore LOWER-BOUNDED evidence of correctness, not proof.`)

console.log(`\n--- Q4 LABELLED: pairwise co-occurrence of the same (source,target) under two labels ---`)
if (pairMatrix.size === 0) console.log(`  no (source,target) pair carries two labels anywhere in the corpus`)
else {
  const rows = [...pairMatrix.entries()].sort((a, b) => b[1] - a[1])
  for (const [k, n] of rows.slice(0, 30)) console.log(`  ${pad(k, 34)} ${n} edges`)
  console.log(`  non-empty cells: ${rows.length}. A non-zero cell is a (source,target) the analyzer`)
  console.log(`  published under two type labels; whether that is a genuine dual reading or a`)
  console.log(`  mislabel is decided per type in docs/analyzers/python.md, not here.`)
}

console.log(`\n--- Q5 RESOLVED detail + standing rule R7 ---`)
for (const t of PROD) {
  const st = stats.get(t)!
  if (st.edges === 0) continue
  const either = st.tgtResolveInFile + st.tgtResolveImport
  console.log(`  ${pad(t, 14)} target resolves ${pct(either, st.edges)} (in-file ${pct(st.tgtResolveInFile, st.edges)}, via an import this file makes ${pct(st.tgtResolveImport, st.edges)}, neither ${pct(st.tgtUnresolved, st.edges)})`)
  console.log(`                 source resolves ${pct(st.srcResolveInFile + st.srcResolveImport + st.srcSyntheticScope, st.edges)} (in-file ${pct(st.srcResolveInFile, st.edges)}, import ${pct(st.srcResolveImport, st.edges)}, synthetic scope ${pct(st.srcSyntheticScope, st.edges)}, neither ${pct(st.srcUnresolved, st.edges)})`)
  const rc: string[] = []
  if (st.r7Unknown) rc.push(`R7 placeholder-literal endpoint "unknown": ${st.r7Unknown}`)
  if (st.r7Empty) rc.push(`empty endpoint: ${st.r7Empty}`)
  console.log(`                 R7: ${rc.join("; ") || "no placeholder-literal and no empty endpoint"}`)
  for (const smp of st.r7Samples) console.log(`                 R7 site: ${smp}`)
  for (const smp of st.srcUnresolvedSamples) console.log(`                 unresolved source: ${smp}`)
}

console.log(`\n--- Q6 CONFIDENT: distribution and the sub-0.7 heuristic count ---`)
for (const t of PROD) {
  const st = stats.get(t)!
  if (st.edges === 0) continue
  const codes = [...st.reasonCodes.entries()].map(([k, v]) => `${k}:${v}`).join(" ")
  console.log(`  ${pad(t, 14)} <0.7: ${String(st.confBelow).padStart(6)} (${pct(st.confBelow, st.edges)}) · no confidence field: ${st.noConf}${codes ? ` · reasonCodes: ${codes}` : ""}`)
}
console.log(`\nA confidence below 0.7 is a heuristic by docs/M14-HONESTY-CONTRACT.md §4 and is reported as a count, not a vibe.`)
console.log(`Every number above is over ${parsed} parsed files of a derived population of ${ALL.length}; both are printed.`)