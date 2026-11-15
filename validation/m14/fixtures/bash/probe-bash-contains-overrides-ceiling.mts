/**
 * CEILING — can `contains` and `overrides` close their 931 open bindings, and with
 * WHICH published field?
 *
 * ## Why this file exists
 *
 * `probe-bash-ambiguity-split.mts` measured 933 edges that are ambiguous and publish
 * no binding: 901 `contains` and 30 `overrides`, plus 2 `calls`. Those 931 are the
 * largest bucket this lane controls, so the next question is not "is it a defect" —
 * 933 of them is established — but "what is the BEST answer this language admits, and
 * what does it leave open". A fix cannot be aimed without knowing its ceiling, and a
 * ceiling measured after the fix is a rationalisation.
 *
 * So this runs BEFORE the change and derives the ceiling from published fields only.
 *
 * ## Two different questions, because the two types are constructed differently
 *
 * `contains` is emitted from the CHILD symbol (`addRel(sym.ownerName, sym.name, ...)`
 * in the post-walk pass over `symbols`), so at emission the analyzer holds the exact
 * `UniversalSymbol` it means. The edge's own `line_number` is `nameLineOf(sym)` —
 * the line the child's NAME is written on — and `sym.kind` is its kind. So the
 * analyzer can name its target exactly, with no inference at all. The ceiling for
 * `contains` is therefore 100% by construction, and what this file measures is
 * whether the two published fields are enough to RE-DISCOVER that binding from the
 * outside — i.e. whether the fix is verifiable rather than merely true.
 *
 * `overrides` runs from the LATER definition to the EARLIER one, and the analyzer
 * already publishes `overridesLine` (the prior declaration's line) — a real key,
 * under a name no shared consumer reads. Two sub-questions, and they have different
 * answers:
 *
 *   O1  is `overridesLine` a line a declaration of that name actually occupies?
 *   O2  is it the RIGHT declaration — the immediately prior one — rather than some
 *       other declaration of the same name that happens to sit there?
 *
 * O1 is the `picks ZERO` check. O2 is the one that matters, because a redefinition
 * chain (`f` at 10, `f` at 20, `f` at 30) gives the edge at 30 the value 10 while
 * the binding it should name is 20. If the analyzer records only the FIRST
 * declaration, the edge at 30 names the wrong row and a consumer that trusts it
 * draws an `overrides` edge to line 10 — a real edge to a declaration that the
 * later definition did not override. That is a fabricated relationship, which the
 * honesty contract puts above a missing one.
 *
 * ## Why `contains` needs the OWNER filter and not just a line
 *
 * The split measured 875 of 901 ambiguous `contains` edges in bucket S — candidates
 * disagree on `ownerName`. Those are three DIFFERENT functions each declaring a
 * local named `file`, and three `contains` edges, one per owner. A line alone
 * cannot tell them apart only if the three happen to share a line; in general the
 * owner does, and the owner is the edge's own `source`. So the re-discovery rule
 * this file tests is:
 *
 *   candidate is the one whose (ownerName, name-line, kind) all match the edge
 *
 * and the buckets are what that rule leaves behind. A bucket at zero means the
 * fix is complete and a fixture can assert it on this corpus.
 *
 * ## Instrument
 *
 * Production `parseFile` from `src/ast/pool-worker.ts`. Same corpus admission and
 * same `--sample 600` as `probe-bash-ambiguity-split.mts`, so the two instruments
 * share a denominator and their numbers can be read in one table.
 *
 * NO REGEX: every field compared here is a published field, and candidates are
 * built from the published symbol table.
 *
 *   npx tsx validation/m14/fixtures/bash/probe-bash-contains-overrides-ceiling.mts [--sample 600] [--json]
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

const files: { repo: string; rel: string; abs: string; dir: string; hash: string }[] = []
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
  file: string
  name: string
  kind: string
  owner: string
  line: number
}
const pubs = new Map<string, Map<string, Cand[]>>()
const pending: { fkey: string; pub: Map<string, Cand[]>; rels: any[] }[] = []

for (const f of sample) {
  let p: any
  try {
    p = await parseFile(f.abs, f.dir)
  } catch {
    continue
  }
  if (!p || p.success === false || !Array.isArray(p.symbols)) continue
  const pub = new Map<string, Cand[]>()
  const fkey = `${f.repo}/${f.rel}`
  for (const s of p.symbols) {
    const n = String(s?.name ?? "")
    if (!n) continue
    const c: Cand = {
      file: fkey,
      name: n,
      kind: String(s.kind ?? ""),
      owner: String(s.ownerName ?? ""),
      line: Number(s.range?.startLine ?? s.startLine ?? 0),
    }
    const l = pub.get(n) ?? []
    l.push(c)
    pub.set(n, l)
  }
  pubs.set(f.abs, pub)
  pending.push({ fkey, pub, rels: Array.isArray(p.relationships) ? p.relationships : [] })
}

interface Row {
  edges: number
  ambiguous: number
  // contains
  ownerAndLineCloses: number
  ownerAndLineOpen: number
  ownerClosesAlone: number
  lineClosesAlone: number
  // overrides
  ovAmbiguous: number
  ovHasKey: number
  ovKeyPicksZero: number
  ovKeyPicksMany: number
  ovKeyCloses: number
  ovIsFirstDeclNotPrior: number
  ovPriorCorrect: number
}
const rows = new Map<string, Row>()
const get = (t: string): Row => {
  let r = rows.get(t)
  if (!r) {
    r = {
      edges: 0,
      ambiguous: 0,
      ownerAndLineCloses: 0,
      ownerAndLineOpen: 0,
      ownerClosesAlone: 0,
      lineClosesAlone: 0,
      ovAmbiguous: 0,
      ovHasKey: 0,
      ovKeyPicksZero: 0,
      ovKeyPicksMany: 0,
      ovKeyCloses: 0,
      ovIsFirstDeclNotPrior: 0,
      ovPriorCorrect: 0,
    }
    rows.set(t, r)
  }
  return r
}

const exContainsOpen: string[] = []
const exOvZero: string[] = []
const exOvMany: string[] = []
const exOvFirstNotPrior: string[] = []

for (const { fkey, pub, rels } of pending) {
  for (const r of rels) {
    const t = String(r.type ?? r.relationshipType ?? "")
    if (t !== "contains" && t !== "overrides") continue
    const row = get(t)
    row.edges++
    const tgt = String(r.target ?? r.to ?? "")
    if (!tgt) continue
    const local = pub.get(tgt) ?? []
    if (local.length <= 1) continue
    row.ambiguous++

    if (t === "contains") {
      // The proposed published binding: the child's own name line is the edge's
      // `line_number` (nameLineOf), and the child's owner is the edge's `source`.
      const edgeLine = Number(r.line_number ?? 0)
      const src = String(r.source ?? "")
      const byOwner = local.filter((c) => c.owner === src)
      const byLine = local.filter((c) => c.line === edgeLine)
      const both = byOwner.filter((c) => c.line === edgeLine)
      if (byOwner.length === 1) row.ownerClosesAlone++
      if (byLine.length === 1) row.lineClosesAlone++
      if (both.length === 1) {
        row.ownerAndLineCloses++
      } else {
        row.ownerAndLineOpen++
        if (exContainsOpen.length < 12)
          exContainsOpen.push(
            `${fkey}:${edgeLine}  -[contains]-> ${tgt}  owner ${byOwner.length} line ${byLine.length} both ${both.length}` +
              `   candidates ${local.map((c) => `${c.owner || "-"}@${c.line}/${c.kind}`).join(" ")}`,
          )
      }
      continue
    }

    // ---- overrides ----
    row.ovAmbiguous++
    const md = (r.metadata ?? {}) as Record<string, unknown>
    const prior = md.overridesLine
    if (prior === undefined || prior === null) {
      row.ovHasKey++
      continue
    }
    const pl = Number(prior)
    const hit = local.filter((c) => c.line === pl)
    if (hit.length === 0) {
      row.ovKeyPicksZero++
      if (exOvZero.length < 12)
        exOvZero.push(
          `${fkey}:${String(r.line_number)}  -[overrides]-> ${tgt}  overridesLine=${pl}  candidates ${[...new Set(local.map((c) => c.line))].join(",")}`,
        )
    } else if (hit.length > 1) {
      row.ovKeyPicksMany++
      if (exOvMany.length < 12)
        exOvMany.push(`${fkey}:${String(r.line_number)}  -[overrides]-> ${tgt}  overridesLine=${pl}  matches ${hit.length} declarations`)
    } else {
      row.ovKeyCloses++
      // O2 — is the declaration at overridesLine the IMMEDIATELY PRIOR one?
      const edgeLine = Number(r.line_number ?? 0)
      const declLines = [...new Set(local.map((c) => c.line))].sort((a, b) => a - b)
      const earlier = declLines.filter((l) => l < edgeLine)
      const nearest = earlier.length ? earlier[earlier.length - 1]! : undefined
      if (nearest !== undefined && nearest === pl) row.ovPriorCorrect++
      else {
        row.ovIsFirstDeclNotPrior++
        if (exOvFirstNotPrior.length < 12)
          exOvFirstNotPrior.push(
            `${fkey}  -[overrides]-> ${tgt}  edge@${edgeLine}  overridesLine=${pl}  ` +
              `immediately-prior=${nearest ?? "NONE"}  all ${declLines.join(",")}`,
          )
      }
    }
  }
}

const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`)
const w = (s: string | number, n: number) => (String(s) + " ".repeat(n)).slice(0, n)

if (JSON_OUT) {
  console.log(JSON.stringify({ sample: sample.length, perType: Object.fromEntries(rows) }, null, 2))
} else {
  console.log(`contains/overrides ceiling — production parseFile, ${sample.length} files`)
  console.log(`admitted ${files.length} / repos ${repoNames.size}\n`)

  const c = get("contains")
  console.log("CONTAINS — can a consumer re-discover the child from (source, line_number)?")
  console.log(`  edges                          ${c.edges}`)
  console.log(`  ambiguous in own file          ${c.ambiguous} ${pct(c.ambiguous, c.edges)} of edges`)
  console.log(`  source (owner) alone closes    ${c.ownerClosesAlone} ${pct(c.ownerClosesAlone, c.ambiguous)}`)
  console.log(`  line_number alone closes       ${c.lineClosesAlone} ${pct(c.lineClosesAlone, c.ambiguous)}`)
  console.log(`  owner AND line closes          ${c.ownerAndLineCloses} ${pct(c.ownerAndLineCloses, c.ambiguous)}`)
  console.log(`  STILL OPEN after both          ${c.ownerAndLineOpen} ${pct(c.ownerAndLineOpen, c.ambiguous)}`)

  const o = get("overrides")
  console.log("\nOVERRIDES — the edge already publishes overridesLine; is it right?")
  console.log(`  edges                          ${o.edges}`)
  console.log(`  ambiguous in own file          ${o.ovAmbiguous} ${pct(o.ovAmbiguous, o.edges)}`)
  console.log(`  no overridesLine key at all    ${o.ovHasKey}`)
  console.log(`  overridesLine picks ZERO       ${o.ovKeyPicksZero} ${pct(o.ovKeyPicksZero, o.ovAmbiguous)}`)
  console.log(`  overridesLine picks MANY       ${o.ovKeyPicksMany} ${pct(o.ovKeyPicksMany, o.ovAmbiguous)}`)
  console.log(`  overridesLine closes           ${o.ovKeyCloses} ${pct(o.ovKeyCloses, o.ovAmbiguous)}`)
  console.log(`  ...and IS the immediately-prior ${o.ovPriorCorrect} ${pct(o.ovPriorCorrect, o.ovAmbiguous)}`)
  console.log(`  ...but names an EARLIER one    ${o.ovIsFirstDeclNotPrior} ${pct(o.ovIsFirstDeclNotPrior, o.ovAmbiguous)}`)

  for (const [title, ex] of [
    ["contains: (owner, line) does not close", exContainsOpen],
    ["overrides: overridesLine is not a declaration line", exOvZero],
    ["overrides: overridesLine matches several declarations", exOvMany],
    ["overrides: overridesLine is the FIRST declaration, not the immediately prior one", exOvFirstNotPrior],
  ] as [string, string[]][]) {
    if (!ex.length) continue
    console.log(`\n${title}:`)
    for (const e of ex) console.log(`  ${e}`)
  }
}
