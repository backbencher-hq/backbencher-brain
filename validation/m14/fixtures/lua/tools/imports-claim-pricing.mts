/**
 * LUA `imports` CLAIM PRICING — how many `require(...)` edges name a MODULE FILE the lane's ADMITTED
 * population actually carries, and by WHICH base spelling.
 *
 * ## Why this file exists
 *
 * Lua is the eighth lane in the programme's repeated cause: **a module/package path is not a
 * declaration**. `require("pl.utils")` names a MODULE, the gate's key space holds declarations, and
 * 5,645 of this lane's `imports` edges therefore read `unresolved`. The gate now has a bucket for
 * exactly this shape — `metadata.importProjectFile`, the shared guard in `src/ast/file-claim.ts` — and
 * the programme's rule (§5jj) is that the claim is **PRICED BEFORE IT IS EMITTED**, because a file
 * claim that misses is REFUTED and `extFAIL` must stay 0.
 *
 * This is the lua sibling of the programme's shared pricing tool
 * (`validation/m14/fixtures/toml/tools/imports-claim-pricing.mts`, which priced protobuf, graphql,
 * clean, scss and zig). It is a SIBLING and not a copy for the reason the guard's own docstring gives:
 * the GUARD is shared, the CANDIDATE ARITHMETIC is per lane and must not be. Lua's arithmetic is not
 * any of the five:
 *
 *   `a.b.c`   dots are DIRECTORY SEPARATORS — `a/b/c.lua`
 *   `X`       a package-root file — `X.lua`, or a package directory — `X/init.lua`
 *   `a/b`     a path already spelled with slashes — `a/b.lua`
 *
 * and a module name is resolved against a `package.path` the ANALYZER CANNOT READ. Four bases are
 * live in this corpus and every one of them is measured here rather than assumed:
 *
 *   fileDir        the requiring file's own directory — busted puts the spec dir on `package.path`,
 *                  which is how `spec/*_spec.lua` writes `require("helpers")`
 *   root           the project root — `lua main.lua` from the checkout root, the commonest layout
 *   luaRoot        the FIRST `lua/` segment on the file's own path — Neovim's runtimepath and the
 *                  OpenResty plugin layout, where `require("lazy.state")` is
 *                  `<plugin>/lua/lazy/state.lua` and NOT `<plugin>/lazy/state.lua`
 *   fileDir+lua    `<fileDir>/lua/` — a nested module root
 *
 * ## What it measures, and the three arms of the cross-tab
 *
 *   verify        an ADMITTED file carries the candidate -> a claim here is CONFIRMED
 *   would-refute  the candidate exists on disk but is NOT admitted -> a claim here would be REFUTED
 *   residue       no candidate on disk at all -> a ruled class with a count
 *
 * `--compare-guard` runs the SAME edge through the LANDED module (`fileClaimForTarget`) and reports
 * where the probe's own arithmetic and the module disagree. The probe and the module are two
 * instruments and this programme has five recorded cases of a number being about the instrument
 * rather than the corpus; the comparison is what stops this file from being a sixth.
 *
 * ## The population
 *
 * The gate's own discovery rule, spelled once here: a directory under the corpus root that is a real
 * git checkout, `git ls-files`, the extension filter, the 1 MB engine cap, sorted, then a STRIDE
 * sample (`--files=N`; 0 = the whole admitted population).
 *
 *   npx tsx validation/m14/fixtures/lua/tools/imports-claim-pricing.mts [--files=N] [--compare-guard]
 *
 * Read-only.
 */
import { execFileSync } from "node:child_process"
import { statSync } from "node:fs"
import { readdirSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const LANE = "lua"
const EXTS = ["lua"]
const TYPES = ["imports"]

const argv = process.argv.slice(2)
const argOf = (f: string, d: string): string => {
  const hit = argv.find((a) => a === f || a.startsWith(`${f}=`))
  if (!hit) return d
  const eq = hit.indexOf("=")
  return eq === -1 ? (argv[argv.indexOf(hit) + 1] ?? d) : hit.slice(eq + 1)
}
const SAMPLE = Number(argOf("--files", "0"))
const COMPARE = argv.includes("--compare-guard")

// THE PRODUCTION PATH, not `analyzer.analyze` directly: `pool-worker.ts` derives the context the
// analyzer sees (and it is the module the incoming gate itself imports).
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
// THE LANDED MODULE, not the probe's own arithmetic.
const { fileClaimForTarget } = await import(path.join(ROOT, "src/ast/file-claim.ts"))

const dirOf = (rel: string): string => {
  const i = rel.lastIndexOf("/")
  return i < 0 ? "" : rel.slice(0, i + 1)
}

/** The path prefix ending at the file's FIRST `lua/` segment, or null when the file is not under one. */
function luaModuleRoot(selfRel: string): string | null {
  const segs = selfRel.split("/")
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i] === "lua") return segs.slice(0, i + 1).join("/") + "/"
  }
  return null
}

type Base = { label: string; base: string | null }
/** THE BASES, in a NAMED order, each with the layout that puts it on `package.path`. */
function basesFor(selfRel: string): Base[] {
  const dir = dirOf(selfRel)
  const luaRoot = luaModuleRoot(selfRel)
  const out: Base[] = [
    { label: "root", base: "" },
    { label: "fileDir", base: dir },
    { label: "luaRoot", base: luaRoot },
    { label: "fileDir+lua", base: dir + "lua/" },
  ]
  // A base that equals another is one base; a null base is not a base.
  const seen = new Set<string>()
  return out.filter((b) => {
    if (b.base === null) return false
    if (seen.has(b.base)) return false
    seen.add(b.base)
    return true
  })
}

/**
 * Every candidate a lua `require` can name, each tagged with its base, in the order the bases are
 * listed. `stem/init.lua` is the `?/init.lua` pattern of the default `package.path` — a real pattern,
 * not a guess — and it is tried AFTER the plain `?` pattern for the same base, which is the order the
 * default `package.path` itself uses.
 */
function luaCandidates(target: string, selfRel: string): { cand: string; base: string }[] {
  const w = target.trim()
  if (w.length === 0 || w.length > 300) return []
  if (w.includes("://") || w.startsWith("/") || w.startsWith("~") || w.startsWith("\\")) return []
  for (const ch of [" ", "\t", "*", "?", "<", ">", "|", "{", "}", "$"]) if (w.includes(ch)) return []
  const stem = w.split(".").join("/")
  if (stem.length === 0) return []
  const out: { cand: string; base: string }[] = []
  for (const { label, base } of basesFor(selfRel)) {
    for (const suffix of [".lua", "/init.lua"]) {
      const folded = fold(base as string, stem + suffix)
      if (folded !== null) out.push({ cand: folded, base: label })
    }
  }
  return out
}

/** The guard's own fold, spelled here so the probe can build candidates without the module. */
function fold(base: string, written: string): string | null {
  const w = written.trim()
  if (w.length === 0 || w.length > 300) return null
  if (w.includes("://") || w.startsWith("/") || w.startsWith("~") || w.startsWith("\\")) return null
  for (const ch of [" ", "\t", "*", "?", "<", ">", "|", "{", "}", "$"]) if (w.includes(ch)) return null
  const out: string[] = []
  for (const seg of (base + w).split("/")) {
    if (seg.length === 0 || seg === ".") continue
    if (seg === "..") {
      if (out.length === 0) return null
      out.pop()
      continue
    }
    out.push(seg)
  }
  return out.length > 0 ? out.join("/") : null
}

/** The lane's admitted extensions and nothing else — a candidate of another shape cannot verify. */
const admittedExt = (c: string): boolean => {
  const dot = c.lastIndexOf(".")
  const slash = c.lastIndexOf("/")
  return dot > slash && EXTS.includes(c.slice(dot + 1).toLowerCase())
}

function discover(): Map<string, { files: string[]; admitted: Set<string>; population: number }> {
  const out = new Map<string, { files: string[]; admitted: Set<string>; population: number }>()
  for (const name of readdirSync(CR).sort()) {
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
    const files: string[] = []
    const admitted = new Set<string>()
    for (const rel of tracked) {
      if (!admittedExt(rel)) continue
      const abs = path.join(dir, rel)
      try {
        if (statSync(abs).size > SIZE_CAP) continue
      } catch {
        continue
      }
      files.push(abs)
      admitted.add(rel.split(path.sep).join("/"))
    }
    files.sort()
    const population = files.length
    if (SAMPLE > 0 && files.length > SAMPLE) {
      const stride = files.length / SAMPLE
      const picked: string[] = []
      for (let i = 0; i < SAMPLE; i++) picked.push(files[Math.floor(i * stride)])
      files.length = 0
      files.push(...[...new Set(picked)].sort())
    }
    out.set(dir, { files, admitted, population })
  }
  return out
}

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

type Row = {
  files: number; population: number; edges: number; resolved: number; ambiguous: number
  unresolved: number; verify: number; wouldRefute: number; residue: number
}
const row: Row = {
  files: 0, population: 0, edges: 0, resolved: 0, ambiguous: 0,
  unresolved: 0, verify: 0, wouldRefute: 0, residue: 0,
}
const baseHist = new Map<string, number>()
const variantHist = new Map<string, number>()
const multiHist = new Map<string, number>()
const residueTop = new Map<string, number>()
const verifyExamples: string[] = []
const refuteExamples: string[] = []
/** Multi-candidate examples — the determinacy question, printed rather than asserted away. */
const multiExamples: string[] = []
const cmp: Record<string, number> = { total: 0 }
const cmpEx: string[] = []
/** The emitted claim under each BASE ORDER, so the order is chosen from numbers and not taste. */
const orderTally = new Map<string, { verify: number; refute: number; residue: number }>()

const ORDER_NAMES = ["root-first", "fileDir-first", "luaRoot-first", "fileDir+lua-first"]
const RANK: Record<string, string[]> = {
  "root-first": ["root", "fileDir", "luaRoot", "fileDir+lua"],
  "fileDir-first": ["fileDir", "root", "luaRoot", "fileDir+lua"],
  "luaRoot-first": ["luaRoot", "root", "fileDir", "fileDir+lua"],
  "fileDir+lua-first": ["fileDir+lua", "fileDir", "root", "luaRoot"],
}

const repos = discover()
for (const [repo, { files, admitted, population }] of repos) {
  row.population += population
  const keyCount = new Map<string, number>()
  const parsed: { file: string; rel: string; rels: any[] }[] = []
  for (const abs of files) {
    let res: any
    try {
      res = await parseFile(abs, repo, { projectRoot: repo } as any)
    } catch {
      continue
    }
    parsed.push({ file: abs, rel: path.relative(repo, abs).split(path.sep).join("/"), rels: res.relationships ?? [] })
    row.files++
    for (const s of res.symbols ?? []) {
      const n = String(s.name ?? "")
      if (n.length === 0) continue
      keyCount.set(n, (keyCount.get(n) ?? 0) + 1)
      const q = String(s.qualifiedName ?? "")
      if (q.length > 0 && q !== n) keyCount.set(q, (keyCount.get(q) ?? 0) + 1)
    }
  }
  for (const { file, rel, rels } of parsed) {
    for (const r of rels) {
      const t = String(r.type ?? r.relationshipType ?? "")
      if (!TYPES.includes(t)) continue
      row.edges++
      const tgt = String(r.target ?? "")
      if (tgt.length === 0) { row.unresolved++; row.residue++; continue }
      const decls = keyCount.get(tgt) ?? 0
      if (decls === 1) { row.resolved++; continue }
      if (decls > 1) { row.ambiguous++; continue }
      row.unresolved++

      const cands = luaCandidates(tgt, rel)
      // THE ARBITER'S KEY SPACE HOLDS ADMITTED FILES AND NOTHING ELSE.
      const admittedHits = cands.filter((c) => admitted.has(c.cand))
      const fsHits = cands.filter((c) => isFile(path.join(repo, c.cand)))

      // THE ORDER TALLY: what the analyzer would emit under each ordering of the bases.
      for (const name of ORDER_NAMES) {
        const rank = RANK[name]
        const picked = [...cands].sort((a, b) => rank.indexOf(a.base) - rank.indexOf(b.base))
          .find((c) => admitted.has(c.cand))
        const t = orderTally.get(name) ?? { verify: 0, refute: 0, residue: 0 }
        if (picked) t.verify++
        else if (fsHits.length > 0) t.refute++
        else t.residue++
        orderTally.set(name, t)
      }

      if (COMPARE) {
        // The guard's own arithmetic, fed ONLY the lane's extra spellings — it folds the written
        // target itself. `extraFor` is computed against the SAME base list, minus the literals the
        // guard already produces, so the comparison is of two ARITHMETICS and not of two orderings.
        const literals = new Set<string>()
        const a = fold(dirOf(rel), tgt.trim())
        const b = fold("", tgt.trim())
        if (a !== null) literals.add(a)
        if (b !== null) literals.add(b)
        const extras = cands.map((c) => c.cand).filter((c) => !literals.has(c))
        const guard = fileClaimForTarget({
          projectRoot: repo, filePath: file, written: tgt,
          admittedExtensions: EXTS, extraCandidates: extras,
        })
        const probeVerdict = admittedHits.length > 0 ? "verify" : fsHits.length > 0 ? "refute" : "residue"
        const guardVerdict = guard !== null ? "verify" : "residue"
        cmp.total++
        cmp[`${probeVerdict}->${guardVerdict}`] = (cmp[`${probeVerdict}->${guardVerdict}`] ?? 0) + 1
        if (probeVerdict !== guardVerdict && cmpEx.length < 12) {
          cmpEx.push(`${tgt}  probe=${probeVerdict} guard=${guardVerdict}  (${rel})`)
        }
      }

      if (admittedHits.length > 0) {
        row.verify++
        const first = admittedHits[0]
        baseHist.set(first.base, (baseHist.get(first.base) ?? 0) + 1)
        variantHist.set(first.cand.endsWith("/init.lua") ? "init" : "plain", (variantHist.get(first.cand.endsWith("/init.lua") ? "init" : "plain") ?? 0) + 1)
        multiHist.set(String(admittedHits.length), (multiHist.get(String(admittedHits.length)) ?? 0) + 1)
        if (admittedHits.length > 1 && multiExamples.length < 10) {
          multiExamples.push(`${tgt}  ${admittedHits.length} admitted: ${admittedHits.map((c) => `${c.cand}[${c.base}]`).join(" · ")}  (${rel})`)
        }
        if (verifyExamples.length < 12) {
          verifyExamples.push(`${tgt.padEnd(38)} -> ${first.cand.padEnd(52)} [${first.base}]  (${rel})`)
        }
        continue
      }
      if (fsHits.length > 0) {
        row.wouldRefute++
        if (refuteExamples.length < 12) {
          refuteExamples.push(`${tgt.padEnd(38)} -> ${fsHits[0].cand} (on disk, NOT admitted)  (${rel})`)
        }
        continue
      }
      row.residue++
      residueTop.set(tgt, (residueTop.get(tgt) ?? 0) + 1)
    }
  }
}

const w = (s: any, n: number) => (String(s) + " ".repeat(n)).slice(0, n)
console.log(`lua imports-claim pricing — ${SAMPLE > 0 ? `STRIDE SAMPLE of ${SAMPLE} files per repo` : "WHOLE admitted population"}, PRODUCTION path`)
console.log(`  POPULATION LABEL: ${SAMPLE > 0 ? "per-repo stride sample; ratios are estimates with the sample size printed beside them" : "every admitted .lua file, from the gate's own discovery rule"}`)
console.log(`  PATH LABEL: every edge comes from \`parseFile\` (src/ast/pool-worker.ts), the module the incoming gate imports — not the regex fallback.`)
console.log(`  CANDIDATE RULE: dots->slashes; \`X.lua\` then \`X/init.lua\`; bases ${basesFor("a/b/c.lua").map((b) => b.label).join(" · ")} (a base is dropped when it does not exist for that file)`)
console.log()
console.log(`${w("files", 7)} ${w("pop", 7)} ${w("edges", 8)} ${w("resolved", 9)} ${w("ambig", 7)} ${w("unres", 8)} ${w("VERIFY", 8)} ${w("wouldRefute", 12)} ${w("residue", 9)}`)
console.log("-".repeat(92))
console.log(`${w(row.files, 7)} ${w(row.population, 7)} ${w(row.edges, 8)} ${w(row.resolved, 9)} ${w(row.ambiguous, 7)} ${w(row.unresolved, 8)} ${w(row.verify, 8)} ${w(row.wouldRefute, 12)} ${w(row.residue, 9)}`)
console.log()
console.log(`WHICH BASE SUPPLIED THE HIT (the claim the analyzer would write, under a first-hit rule):`)
for (const [b, n] of [...baseHist].sort((x, y) => y[1] - x[1])) console.log(`  ${w(b, 14)} ${String(n).padStart(7)}`)
console.log(`PACKAGE SHAPE: ${[...variantHist].sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}=${v}`).join("  ") || "none"}`)
console.log(`CANDIDATE MULTIPLICITY (how many admitted files answer one require): ${[...multiHist].sort((x, y) => Number(x[0]) - Number(y[0])).map(([k, v]) => `${k}=${v}`).join("  ") || "none"}`)
console.log()
console.log(`THE ORDER QUESTION — the emitted claim under each base ordering (the order is a CHOICE, so it is measured):`)
for (const name of ORDER_NAMES) {
  const t = orderTally.get(name) ?? { verify: 0, refute: 0, residue: 0 }
  console.log(`  ${w(name, 18)} verify=${w(t.verify, 6)} wouldRefute=${w(t.refute, 4)} residue=${t.residue}`)
}
console.log()
console.log(`VERIFY examples:`)
for (const e of verifyExamples) console.log(`  ${e}`)
if (verifyExamples.length === 0) console.log("  none")
console.log(`would-REFUTE examples (on disk, NOT admitted):`)
for (const e of refuteExamples) console.log(`  ${e}`)
if (refuteExamples.length === 0) console.log("  none")
console.log(`MULTI-CANDIDATE examples (a determinacy question, not a refutation):`)
for (const e of multiExamples) console.log(`  ${e}`)
if (multiExamples.length === 0) console.log("  none")
console.log(`top residue targets (no candidate on disk anywhere):`)
console.log("  " + ([...residueTop].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([n, c]) => `${n}×${c}`).join("  ") || "none"))

if (COMPARE) {
  console.log()
  console.log(`GUARD-vs-PROBE comparison on every unresolved edge — the LANDED module (src/ast/file-claim.ts) against this probe's arithmetic:`)
  console.log(`  edges compared: ${cmp.total}`)
  for (const [k, v] of Object.entries(cmp).filter(([k]) => k !== "total").sort()) console.log(`    ${w(k, 24)} ${v}`)
  console.log(`  disagreements${cmpEx.length === 0 ? ": none" : ":"}`)
  for (const e of cmpEx) console.log(`    ${e}`)
}
