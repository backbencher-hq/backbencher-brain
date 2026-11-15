/**
 * IMPORT-CLAIM CENSUS — price the `importProjectFile` claim on rust's module-path imports
 * against the ANALYZER'S OWN EMISSIONS, before and after the claim landed.
 *
 * ## What it answers
 *
 * `incoming-gate.ts rust rs 400` reads `imports 1,751 edges / 45 resolved / 1,660 unresolved`.
 * A Rust module path names a FILE: `use crate::apis::client::Client;` depends on module
 * `crate::apis`, which is `src/apis.rs` or `src/apis/mod.rs`. The analyzer now attaches the
 * arbiter's file claim (`metadata.importProjectFile`) ONLY where `statSync` confirms the file, so
 * the arbiter's UNSAMPLED admitted file list should confirm every claim it sees (extOK) and
 * refute none (extFAIL 0). This probe checks exactly that: it runs the real analyzer over the
 * gate's stride sample, then verifies every emitted claim against the gate's own admitted-file
 * rule (git ls-files, `.rs`, <= 1 MB) — an independent check of the analyzer's stat.
 *
 * It also reports the residual: unresolved internal module paths the analyzer REFUSED to claim
 * because no module file exists (155 on the first census) — those are the honest remainder, and
 * the census is how a later iteration prices a wider module rule (workspace-crate `use` paths).
 *
 * The module-file arithmetic itself lives in the analyzer (`rustModuleFileCandidates`, exported so
 * there is ONE implementation); this probe prices the emissions, not a copy of the rule.
 *
 * Run: bun run validation/m14/fixtures/rust/import-claim-census.mts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const MAX_FILES = Number(process.env.MAX_FILES ?? 400)
const SIZE_CAP = 1024 * 1024

const norm = (p: string) => p.replace(/\\/g, "/")
const relTo = (root: string, p: string) => norm(path.relative(root, p))
const repoOf = (f: string) => norm(f).slice(norm(CR).length + 1).split("/")[0] ?? ""

type Discovery = { sampled: string[]; admittedByRepo: Map<string, Set<string>>; total: number }

function discover(): Discovery {
  const found: string[] = []
  const admittedByRepo = new Map<string, Set<string>>()
  for (const name of readdirSync(CR)) {
    const dir = path.join(CR, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch { continue }
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0").filter(Boolean)
    } catch { continue }
    const admitted = new Set<string>()
    for (const rel of tracked) {
      if (!rel.toLowerCase().endsWith(".rs")) continue
      const abs = path.join(dir, rel)
      try {
        if (statSync(abs).size > SIZE_CAP) continue
      } catch { continue }
      admitted.add(norm(rel))
      found.push(abs)
    }
    admittedByRepo.set(name, admitted)
  }
  found.sort()
  const total = found.length
  const sampled = [...found]
  if (MAX_FILES > 0 && total > MAX_FILES) {
    const stride = Math.max(1, Math.floor(total / MAX_FILES))
    sampled.length = 0
    for (let i = 0; i < found.length && sampled.length < MAX_FILES; i += stride) sampled.push(found[i])
  }
  return { sampled, admittedByRepo, total }
}

/** The gate's `name` + `qualifiedName` key model, per project. */
function keyIndex(symbols: any[]): Map<string, number> {
  const keys = new Map<string, number>()
  for (const s of symbols) {
    const name = String(s?.name ?? "")
    if (!name) continue
    keys.set(name, (keys.get(name) ?? 0) + 1)
    const q = String(s?.qualifiedName ?? "")
    if (q && q !== name) keys.set(q, (keys.get(q) ?? 0) + 1)
  }
  return keys
}

const main = async () => {
  const t0 = Date.now()
  const { sampled, admittedByRepo, total } = discover()
  console.log("import-claim census — rust (analyzer emissions)")
  console.log(`population: ${sampled.length} of ${total} corpus .rs files (gate's stride shape, MAX_FILES=${MAX_FILES})`)

  const declByRepo = new Map<string, any[]>()
  type Row = { file: string; repo: string; line: number | null; target: string; claim: string | null; ns: string[] | null }
  const rows: Row[] = []
  let parseErrors = 0

  for (const f of sampled) {
    const repo = repoOf(f)
    let content: string
    try { content = readFileSync(f, "utf8") } catch { continue }
    let r: any
    try {
      r = await parseFile(f, repo, { projectRoot: path.join(CR, repo) } as any)
    } catch { parseErrors++; continue }
    const list = declByRepo.get(repo) ?? []
    for (const s of Array.isArray(r?.symbols) ? r.symbols : []) list.push(s)
    declByRepo.set(repo, list)
    for (const rel of Array.isArray(r?.relationships) ? r.relationships : []) {
      if (String(rel?.type ?? "") !== "imports") continue
      const md = rel?.metadata ?? {}
      rows.push({
        file: f,
        repo,
        line: Number(rel?.line_number ?? 0) || null,
        target: String(rel?.target ?? ""),
        claim: typeof md?.importProjectFile === "string" ? md.importProjectFile : null,
        ns: Array.isArray(md?.languageNamespace) ? md.languageNamespace.filter((x: any) => typeof x === "string") : null,
      })
    }
  }
  console.log(`parsed ${sampled.length - parseErrors} file(s), ${parseErrors} parse error(s), ${rows.length} imports edge(s) — gate TABLE 1 reads 1,751`)

  const decls = new Map<string, Map<string, number>>()
  for (const [repo, syms] of declByRepo) decls.set(repo, keyIndex(syms))

  const byOutcome = { resolved: 0, ambiguous: 0, unresolved: 0 }
  const unresolvedByRoot = new Map<string, number>()
  let claimsTotal = 0
  let nsClaims = 0
  let nsVerified = 0
  let nsRefuted = 0
  const nsRootsSeen = new Map<string, number>()
  const nsRows: Array<{ file: string; line: number | null; target: string; roots: string[]; repo: string }> = []
  /** unresolved + claim present: the edges the claim can move to extOK */
  let claimUnresolved = 0
  let claimVerified = 0
  let claimRefuted = 0
  let claimOnResolvable = 0
  const verifiedByRoot = new Map<string, number>()
  const verifiedByShape = new Map<string, number>()
  const examples: string[] = []
  const verifiedRows: Array<{ file: string; line: number | null; target: string; claim: string; repo: string }> = []
  const internalUnresolvedWithoutClaim: Array<{ row: Row; root: string }> = []

  for (const row of rows) {
    const d = decls.get(row.repo)?.get(row.target) ?? 0
    const outcome = d === 0 ? "unresolved" : d === 1 ? "resolved" : "ambiguous"
    byOutcome[outcome]++
    const parts = row.target.split("::").filter(Boolean)
    const rootWord = parts.length >= 2 ? parts[0] : "(one-segment)"
    // THE NAMESPACE CLAIM — reproduced with the arbiter's own segment rule (`namespaceMatchOf`:
    // split on `.` or `::`, longest entry first) so a claim that would be REFUTED is counted here.
    if (row.ns !== null && row.ns.length > 0) {
      nsClaims++
      const segs = row.target.split(/\.|::/).filter((x) => x.length > 0)
      let matched: string | null = null
      for (let n = segs.length; n >= 1; n--) {
        const cand = segs.slice(0, n).join(".")
        if (row.ns.includes(cand)) { matched = cand; break }
      }
      if (matched !== null) {
        nsVerified++
        for (const r of row.ns) nsRootsSeen.set(r, (nsRootsSeen.get(r) ?? 0) + 1)
        nsRows.push({ file: relTo(path.join(CR, row.repo), row.file), line: row.line, target: row.target, roots: row.ns, repo: row.repo })
      } else {
        nsRefuted++
      }
      continue
    }
    if (row.claim !== null) {
      claimsTotal++
      const admitted = admittedByRepo.get(row.repo) ?? new Set<string>()
      const ok = admitted.has(row.claim)
      if (!ok) claimRefuted++
      if (outcome !== "unresolved") { claimOnResolvable++; continue }
      claimUnresolved++
      if (ok) {
        claimVerified++
        verifiedByRoot.set(rootWord, (verifiedByRoot.get(rootWord) ?? 0) + 1)
        const shape = `${rootWord} segs=${parts.length} leaf=${/^[A-Z]/.test(parts[parts.length - 1] ?? "") ? "Upper" : "lower"}`
        verifiedByShape.set(shape, (verifiedByShape.get(shape) ?? 0) + 1)
        verifiedRows.push({ file: relTo(path.join(CR, row.repo), row.file), line: row.line, target: row.target, claim: row.claim, repo: row.repo })
        if (examples.length < 12) examples.push(`${relTo(path.join(CR, row.repo), row.file)}:${row.line ?? "?"}  ${row.target}  -> ${row.claim}`)
      }
      continue
    }
    if (outcome !== "unresolved") continue
    const root = parts.length >= 2 ? `${parts[0]}::` : "(one-segment)"
    unresolvedByRoot.set(root, (unresolvedByRoot.get(root) ?? 0) + 1)
    if (["crate", "self", "super"].includes(parts[0])) internalUnresolvedWithoutClaim.push({ row, root })
  }

  console.log(`outcomes under the gate's count model: resolved ${byOutcome.resolved} · ambiguous ${byOutcome.ambiguous} · unresolved ${byOutcome.unresolved}`)
  console.log(`imports edges carrying the file claim ......... ${claimsTotal}`)
  console.log(`imports edges carrying the namespace claim .... ${nsClaims}   roots: ${[...nsRootsSeen.entries()].map(([r, n]) => `${r} ${n}`).join(" · ") || "(none)"}`)
  console.log(`  of those, VERIFIED by the declared list ...... ${nsVerified}`)
  console.log(`  of those, REFUTED ........................... ${nsRefuted}   <- MUST BE 0 (extFAIL)`)
  console.log(`  claim on an unresolved edge ................. ${claimUnresolved}`)
  console.log(`  of those, VERIFIED by the admitted list ..... ${claimVerified}${[...verifiedByRoot.entries()].map(([k, v]) => ` [${k} ${v}]`).join("")}`)
  console.log(`  of those, REFUTED by the admitted list ...... ${claimRefuted}   <- MUST BE 0 (extFAIL)`)
  console.log(`  claim on an edge that resolves anyway ....... ${claimOnResolvable}`)
  console.log("")
  console.log("unresolved by root form (ALL, before the claim is applied):")
  for (const [root, n] of [...unresolvedByRoot.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${root}`)
  console.log(`\ninternal unresolved WITHOUT a claim ....... ${internalUnresolvedWithoutClaim.length}  (no module file existed → nothing claimed)`)
  console.log("verified by SHAPE:")
  for (const [shape, n] of [...verifiedByShape.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${shape}`)
  console.log("\nverified examples (hand-read these):")
  for (const e of examples) console.log(`  ${e}`)
  console.log("\ninternal unresolved rows with NO claim (first 12; the honest residual):")
  for (const { row, root } of internalUnresolvedWithoutClaim.slice(0, 12)) {
    console.log(`  ${relTo(path.join(CR, row.repo), row.file)}:${row.line ?? "?"}  ${row.target}  [${root}]`)
  }
  // THE ARTIFACT — every claim this run emitted, so a reader can hand-read any of them rather
  // than trusting the counter. Written beside this probe, inside the lane's own write scope.
  const artifact = path.join(path.dirname(new URL(import.meta.url).pathname), "import-claim-rows.json")
  const unclaimed = internalUnresolvedWithoutClaim.map(({ row, root }) => ({ repo: row.repo, file: relTo(path.join(CR, row.repo), row.file), line: row.line, target: row.target, root }))
  writeFileSync(artifact, JSON.stringify({ population: sampled.length, claimsTotal, claimVerified, claimRefuted, namespaceClaims: nsClaims, namespaceVerified: nsVerified, namespaceRefuted: nsRefuted, rows: verifiedRows, namespaceRows: nsRows, unclaimedInternal: unclaimed }, null, 2) + "\n")
  console.log(`\nwrote ${verifiedRows.length} claim row(s) to ${relTo(process.cwd(), artifact)}`)

  // THE CONTROLS. A claim mechanism that emits nothing would "pass" every counter above, and one
  // that emits an unconfirmed claim is the one defect this claim kind exists to make impossible:
  // the arbiter would REFUTE it, and extFAIL is counted against the lane.
  if (claimVerified === 0) {
    console.error("CONTROL FAILED: the analyzer emitted ZERO verifiable module-file claims — the mechanism is off, not clean")
    process.exitCode = 1
  }
  if (claimRefuted > 0) {
    console.error(`CONTROL FAILED: ${claimRefuted} emitted claim(s) name a file the admitted list does NOT contain — these are extFAIL`)
    process.exitCode = 1
  }
  if (nsRefuted > 0) {
    console.error(`CONTROL FAILED: ${nsRefuted} namespace claim(s) name a root outside their declared list — these are extFAIL`)
    process.exitCode = 1
  }
  console.log(`\nelapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

await main()
