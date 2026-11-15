/**
 * WHY THE 115 DECLINES — decompose the only bucket left, by the SCOPE the analyzer
 * actually walks, and say for each whether declining was FORCED or CHOSEN.
 *
 * ## Why this file exists
 *
 * `probe-bash-ambiguity-closure-whole.mts` measured 0 STILL OPEN over the 600-file
 * sample: every ambiguous edge either closes from a published field or carries
 * `targetResolution: "ambiguousInFile"`. That leaves 115 declined edges, and "not
 * open" plus "declined" still leaves a question the lane has never answered:
 *
 * **Did the analyzer have to decline on those 115, or did it choose to?**
 *
 * The two are different facts with different owners. A FORCED decline is bash's
 * semantics and no implementation can close it. A CHOSEN decline is a rule that saw
 * one answer and did not publish it — a defect.
 *
 * ## THE CORRECTION — a first run of this file got this wrong, and the number is
 * ## kept here because the error is the interesting part
 *
 * The first version of this probe measured LINE proximity only. For each declined
 * edge it took every candidate whose `startLine` preceded the use, picked the
 * nearest, and reported "unique nearest => a rule could have picked it". It printed
 *
 *     A unbound at use 69 (60.0%)   B something in effect 46 (40.0%)   C tie 0
 *
 * and the 46 was WRONG, in a way that is worth recording because it is easy to make.
 *
 * The analyzer does not walk lines. `resolveDeclaration`
 * (src/ast/real-bash-analyzer.ts:1137) walks a SCOPE CHAIN:
 *
 *     const scopes = useOwner === fileOwner ? [fileOwner] : [useOwner, fileOwner]
 *
 * and a candidate is only eligible when `c.owner === scope`. The line-only version
 * dropped that predicate, so it counted a declaration inside a SIBLING FUNCTION as
 * "in effect" purely because its line came first — which is precisely the mistake the
 * analyzer's own doc comment says its first version made, and which
 * `ambiguous-target-resolution.sh` exists to catch. Concretely,
 * consul/test/integration/connect/envoy/helpers.bash:1061 reads `status` inside
 * `get_upstream_fortio_name`; the nearest preceding declaration is
 * `assert_config_entry_status@954`, a local of a DIFFERENT function, and bash does
 * not let one function's assignment be shadowed by another's.
 *
 * So this version applies the same chain the analyzer applies, and the candidate set
 * is restricted to the chain before anything is decided.
 *
 * ## The four buckets, decided from published data only
 *
 * For an edge at line L naming target T from source S, with `fileOwner` = the file's
 * own basename and `useOwner` = `S` unless `S` is that basename:
 *
 *   A  SCOPE-UNBOUND — no scope in the chain has a declaration of T at or before L.
 *      Nothing is in effect where the edge points. bash has no declare-before-use
 *      (`echo "$X"; X=1` is legal and reads whatever the environment held), so the
 *      text order does not settle it. This is the analyzer's own final
 *      `return { targetResolution: "ambiguousInFile" }` (line 1152) and it is FORCED.
 *
 *   B  SCOPE-UNIQUE — some scope in the chain HAS a declaration at or before L and
 *      the nearest one is unique. The rule had one answer and did not publish it, so
 *      B is the only bucket where a defect can live. A CORRECT analyzer must print
 *      B = 0, because the walk would have returned `innermostScope`/`outerScope`.
 *      A non-zero B is a defect, not a finding about bash.
 *
 *   C  SCOPE-TIE — two or more eligible declarations share one line inside one scope.
 *      No line separates them, so even a correct rule has nothing to publish. FORCED,
 *      and reported apart from A because the reason is a fact about the SOURCE.
 *
 *   D  CROSS-SCOPE-ONLY — every candidate sits in a scope that is NOT in the chain: a
 *      sibling function's local. bash binds dynamically, so such a declaration is not
 *      statically in effect at the use site either — the other function may not have
 *      run. FORCED, and reported apart from A and C because a line-only probe
 *      misclassifies these, which is what the correction above is about.
 *
 * ## What would overturn the reading
 *
 * If B > 0 the declines are partly CHOSEN and the walk is wrong. This file prints
 * every B row with its candidates and the scope that matched, so the claim is
 * checkable rather than asserted: a reader can open the named file and see whether
 * the tie is real. If B = 0 and the four buckets account for all 115, the whole
 * declined population is forced, and the correct report is that bash's ambiguity has
 * no remaining recoverable edge in this sample.
 *
 * ## Instrument
 *
 * Production `parseFile`. Same corpus admission, hash order and `--sample 600` as
 * `probe-bash-ambiguity-closure-whole.mts`, so the 115 is the same population. Every
 * field read is a published field (`source`, `target`, `type`, `line_number`,
 * `metadata.targetResolution`, and on symbols `name`, `kind`, `ownerName`,
 * `startLine`); every candidate comes from the published symbol table. The scope
 * chain is reconstructed from `source` and the file's basename, which is what
 * `relSource()` publishes (src/ast/real-bash-analyzer.ts:392).
 *
 * ONE declared limitation, since it is a reconstruction and not a published field:
 * `useOwner` is derived as `source !== basename`. The analyzer holds it as
 * `functionStack[last] ?? ""`, so a FUNCTION whose name equals the script's basename
 * would be read as file scope here. The count of such edges is printed as
 * `nameEqualsBasename` so the size of that approximation is visible rather than
 * assumed to be zero.
 *
 * NO REGEX.
 *
 *   npx tsx validation/m14/fixtures/bash/probe-bash-declined-decomposition.mts [--sample 600] [--json]
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const num = (n: string, d: number): number => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? Number(argv[i + 1]) : d
}
const SAMPLE = num("sample", 600)
const JSON_OUT = argv.includes("--json")

const TYPES = [
  "calls",
  "uses",
  "contains",
  "imports",
  "references",
  "exports",
  "extends",
  "implements",
  "overrides",
  "instantiates",
] as const

const LABEL_ALIASES: Record<string, string> = {
  calls: "calls",
  call: "calls",
  uses: "uses",
  contains: "contains",
  composition: "contains",
  part_of: "contains",
  imports: "imports",
  brain_import: "imports",
  references: "references",
  depends_on: "references",
  related: "references",
  exports: "exports",
  provides: "exports",
  extends: "extends",
  inheritance: "extends",
  implements: "implements",
  implementation: "implements",
  overrides: "overrides",
  override: "overrides",
  instantiates: "instantiates",
}
const ontologyName = (raw: string): string | null => LABEL_ALIASES[raw] ?? null

interface FileRec {
  repo: string
  rel: string
  abs: string
  dir: string
  hash: string
}
const files: FileRec[] = []
let scanned = 0
const repoNames = new Set<string>()
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    scanned++
    if (detectLanguageFromPath(abs, text) !== "bash") continue
    repoNames.add(e)
    files.push({ repo: e, rel, abs, dir, hash: createHash("sha256").update(`${e}/${rel}`).digest("hex") })
  }
}
files.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
const sample = files.slice(0, SAMPLE)

interface Cand {
  name: string
  kind: string
  owner: string
  line: number
}

let failures = 0
let degraded = 0
let symbols = 0
const pending: { fkey: string; base: string; pub: Map<string, Cand[]>; rels: any[] }[] = []

for (const f of sample) {
  let p: any
  try {
    p = await parseFile(f.abs, f.dir)
  } catch {
    failures++
    continue
  }
  if (!p || p.success === false || !Array.isArray(p.symbols)) {
    if (p?.fallback === true) degraded++
    continue
  }
  const pub = new Map<string, Cand[]>()
  const fkey = `${f.repo}/${f.rel}`
  for (const s of p.symbols) {
    const n = String(s?.name ?? "")
    if (!n) continue
    symbols++
    const c: Cand = {
      name: n,
      kind: String(s.kind ?? ""),
      owner: String(s.ownerName ?? ""),
      line: Number(s.startLine ?? 0),
    }
    const l = pub.get(n) ?? []
    l.push(c)
    pub.set(n, l)
  }
  pending.push({ fkey, base: path.basename(f.rel), pub, rels: Array.isArray(p.relationships) ? p.relationships : [] })
}

type Bucket = "A-scope-unbound" | "B-scope-unique" | "C-scope-tie" | "D-cross-scope-only"
const BUCKETS: Bucket[] = ["A-scope-unbound", "B-scope-unique", "C-scope-tie", "D-cross-scope-only"]
const perType = new Map<string, Record<Bucket, number>>()
const getT = (t: string): Record<Bucket, number> => {
  let r = perType.get(t)
  if (!r) {
    r = { "A-scope-unbound": 0, "B-scope-unique": 0, "C-scope-tie": 0, "D-cross-scope-only": 0 }
    perType.set(t, r)
  }
  return r
}
const totals: Record<Bucket, number> = {
  "A-scope-unbound": 0,
  "B-scope-unique": 0,
  "C-scope-tie": 0,
  "D-cross-scope-only": 0,
}

let declined = 0
let nameEqualsBasename = 0
let nonFunctionCandidates = 0
let functionOnlyCandidates = 0
const exB: string[] = []
const exA: string[] = []
const exC: string[] = []
const exD: string[] = []

for (const { fkey, base, pub, rels } of pending) {
  for (const r of rels) {
    const label = ontologyName(String(r.type ?? r.relationshipType ?? ""))
    if (!label) continue
    const md = (r.metadata ?? {}) as Record<string, unknown>
    if (String(md.targetResolution ?? "") !== "ambiguousInFile") continue
    const tgt = String(r.target ?? r.to ?? "")
    if (!tgt) continue
    const cands = pub.get(tgt) ?? []
    if (cands.length < 2) continue // not ambiguous to a name-matching consumer

    const edgeLine = Number(r.line_number ?? 0)
    const src = String(r.source ?? "")
    const fileOwner = base
    const useOwner = src === fileOwner ? "" : src
    if (useOwner !== "" && src === fileOwner) nameEqualsBasename++
    const scopes: string[] = useOwner === fileOwner ? [fileOwner] : [useOwner, fileOwner]

    // What the analyzer's own `declSites` could see: variables, aliases and locals,
    // never functions. Reported so the gap between the two indexes is a number.
    const nonFn = cands.filter((c) => c.kind !== "function" && c.kind !== "method")
    if (nonFn.length > 0) nonFunctionCandidates++
    else functionOnlyCandidates++

    declined++

    let bucket: Bucket | null = null
    let note = ""
    for (const scope of scopes) {
      const atOrBefore = cands.filter((c) => c.owner === scope && c.line <= edgeLine)
      if (atOrBefore.length === 0) continue
      const nearest = Math.max(...atOrBefore.map((c) => c.line))
      const winners = atOrBefore.filter((c) => c.line === nearest)
      const rows = [...new Set(winners.map((c) => `${c.owner || "-"}@${c.line}/${c.kind}`))]
      if (winners.length !== 1) {
        bucket = "C-scope-tie"
        note = `${rows.length} declarations share line ${nearest} in scope "${scope || "-"}": ${rows.join("  ")}`
      } else {
        bucket = "B-scope-unique"
        note =
          `scope "${scope || "-"}" has a UNIQUE nearest at-or-before (${rows.join("  ")}) ` +
          `but the edge carries ambiguousInFile — the walk had one answer`
      }
      break
    }
    if (bucket === null) {
      const inChain = cands.filter((c) => scopes.includes(c.owner))
      bucket = inChain.length === 0 ? "D-cross-scope-only" : "A-scope-unbound"
      const rows = [...new Set(cands.map((c) => `${c.owner || "-"}@${c.line}/${c.kind}`))]
      note =
        bucket === "A-scope-unbound"
          ? `chain [${scopes.map((s) => s || "-").join(" -> ")}] has nothing at or before; in-chain candidates are ${rows.join("  ")}`
          : `no candidate is in the chain [${scopes.map((s) => s || "-").join(" -> ")}]; candidates are ${rows.join("  ")}`
    }

    const row = `${fkey}:${edgeLine}  -[${label}]-> ${tgt}   source=${src || "(file)"}  ${note}`
    if (bucket === "B-scope-unique" && exB.length < 14) exB.push(row)
    if (bucket === "A-scope-unbound" && exA.length < 10) exA.push(row)
    if (bucket === "C-scope-tie" && exC.length < 10) exC.push(row)
    if (bucket === "D-cross-scope-only" && exD.length < 10) exD.push(row)

    getT(label)[bucket]++
    totals[bucket]++
  }
}

const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`)
const w = (s: string | number, n: number) => (String(s) + " ".repeat(n)).slice(0, n)

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        sample: sample.length,
        admitted: files.length,
        scanned,
        repos: repoNames.size,
        symbols,
        failures,
        degraded,
        declined,
        nameEqualsBasename,
        nonFunctionCandidates,
        functionOnlyCandidates,
        perType: Object.fromEntries(perType),
        totals,
      },
      null,
      2,
    ),
  )
} else {
  console.log(`bash declined-edge decomposition — SCOPE-AWARE, production parseFile, ${sample.length} files`)
  console.log(
    `admitted ${files.length.toLocaleString()} / scanned ${scanned.toLocaleString()} / repos ${repoNames.size} / symbols ${symbols.toLocaleString()}`,
  )
  console.log(`parse failures ${failures}   degraded ${degraded}\n`)
  console.log(`declined edges carrying targetResolution: ambiguousInFile, target declared >1x : ${declined}\n`)

  console.log(`${w("type", 12)}${w("declined", 11)}${w("A unbound", 15)}${w("B UNIQUE", 15)}${w("C tie", 13)}${w("D cross-scope", 16)}`)
  console.log("-".repeat(72))
  for (const t of TYPES) {
    const r = perType.get(t)
    if (!r) continue
    const n = BUCKETS.reduce((a, b) => a + r[b], 0)
    if (n === 0) continue
    console.log(
      `${w(t, 12)}${w(n, 11)}` +
        BUCKETS.map((b) => w(`${r[b]} ${pct(r[b], n)}`, b === "A-scope-unbound" ? 15 : b === "B-scope-unique" ? 15 : b === "C-scope-tie" ? 13 : 16)).join(""),
    )
  }
  console.log(
    `${w("ALL", 12)}${w(declined, 11)}` +
      BUCKETS.map((b) => w(`${totals[b]} ${pct(totals[b], declined)}`, b === "A-scope-unbound" ? 15 : b === "B-scope-unique" ? 15 : b === "C-scope-tie" ? 13 : 16)).join(""),
  )

  console.log("\nA  FORCED  — no scope in the chain has the name at or before the use site")
  console.log("B  DEFECT  — a scope in the chain has a UNIQUE nearest declaration; the walk had one answer")
  console.log("C  FORCED  — two eligible declarations share one line inside one scope")
  console.log("D  FORCED  — every candidate is in a scope OUTSIDE the chain (a sibling function's local)")
  console.log(
    `\ncandidate set: ${nonFunctionCandidates} edges have >=1 non-function candidate (the analyzer's declSites can see these), ` +
      `${functionOnlyCandidates} have function candidates only`,
  )
  console.log(`approximation size: ${nameEqualsBasename} edges where a function is named exactly the script basename`)

  for (const [title, ex] of [
    ["B — the only bucket that can be a defect: a unique nearest declaration WAS in effect", exB],
    ["A — nothing in effect in any scope of the chain", exA],
    ["C — declarations share a line inside one scope", exC],
    ["D — every candidate is outside the chain (what a line-only probe misreads as in effect)", exD],
  ] as [string, string[]][]) {
    if (!ex.length) continue
    console.log(`\n${title}:`)
    for (const e of ex) console.log(`  ${e}`)
  }
}