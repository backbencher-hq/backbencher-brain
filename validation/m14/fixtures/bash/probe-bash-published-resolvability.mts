/**
 * BASH PUBLISHED RESOLVABILITY — can a consumer walk this edge to ONE declaration
 * using only what the edge publishes?
 *
 * ## The question, and why it is not the question round 9 asked
 *
 * `probe-bash-ambiguity.mts` counts how many published symbols in a file share an
 * edge's target NAME. That is the condition `bb_impact`'s name-match faces when it
 * has nothing else — but a consumer does not have nothing else. It has the edge
 * row and the symbol table, and round 9's prose already claimed on that basis:
 *
 *   "`contains` puts the child's *name* line on the edge (`nameLineOf`, M60 #921),
 *    `exports` puts the declaration's line on it, and `overrides` carries
 *    `overridesLine` … `uses` and `calls` put the **use site's** line on the edge,
 *    which is a different line from the declaration, so the declaration was
 *    unrecoverable from the row."
 *
 * That claim was made from the metadata FIELD existing, not from an end-to-end
 * measurement of what the row narrows the candidate set to. A field can exist on
 * the row and still not name a published symbol — `targetLine` is the line the
 * analyzer recorded, and the store publishes `startLine`; if those two disagree
 * the rule yields ZERO candidates, which is worse than no rule. So this probe
 * applies each published discriminator to the file's real symbol set and reports
 * what each one LEAVES. A rule that yields 0 or >1 is visible here, which is what
 * makes the number falsifiable.
 *
 *   0 candidates   the edge asserts a declaration that the published table does not
 *                  contain — a claim the graph cannot walk, and the worst outcome
 *   1 candidate    resolvable, and the table says WHICH published field did it
 *   >1             genuinely ambiguous: nothing the edge publishes separates them
 *
 * ## THE POINT OF THE ROUND
 *
 * `contains` is 95% of round 9's open population (6,159 of 6,491 ambiguous edges).
 * If the edge's own line picks exactly one, that population is not open — it is
 * already closed by a field the analyzer has emitted since M60 #921, and round 9's
 * "not fixed and no edge is claimed to be fixed" understated what exists. If the
 * edge's line does NOT pick one, the population is real and this names it. Both
 * answers are worth having; only measuring gives either.
 *
 * ## INSTRUMENT
 *
 * Production `parseFile` from `src/ast/pool-worker.ts`, the same walk and the same
 * hash-order admission as `census-bash-ontology.ts` and `probe-bash-ambiguity.mts`
 * (512 KB cap, content-form `detectLanguageFromPath`), so the denominators match
 * every other number in this lane's doc. `--all` takes every admitted file.
 *
 * NO REGEX. Candidates are `result.symbols[].name/.startLine/.kind`; discriminators
 * are read off the relationship object. Nothing here inspects source text.
 *
 * CLI: npx tsx validation/m14/fixtures/bash/probe-bash-published-resolvability.mts
 *      [--sample 400 | --all]
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
const ALL = argv.includes("--all")
const SAMPLE = ALL ? Number.MAX_SAFE_INTEGER : num("sample", 400)

interface F {
  repo: string
  rel: string
  abs: string
  dir: string
  text: string
  hash: string
}
const files: F[] = []
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
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
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
    files.push({ repo: e, rel, abs, dir, text, hash: createHash("sha256").update(`${e}/${rel}`).digest("hex") })
  }
}
files.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
const sample = ALL ? files : files.slice(0, SAMPLE)

console.log(
  `bash published-resolvability probe — production parseFile, ${sample.length} files${ALL ? " (--all)" : ""}`,
)
console.log(`admitted ${files.length} / scanned ${scanned} / repos ${repoNames.size}\n`)

/** One candidate declaration: a published symbol, identified by the three fields
 *  the store actually carries. */
interface Cand {
  line: number
  kind: string
  owner: string
}

type Rule = "targetLine" | "targetKind" | "overridesLine" | "edgeLine" | "isFunctionCall"

type Row = {
  total: number
  tgtPresent: number
  unique: number
  ambiguous: number
  /** after every applicable published discriminator: 0 / 1 / >1 */
  leftZero: number
  leftOne: number
  leftMany: number
  /** of the >1: said so explicitly (`targetResolution` present, no line) */
  leftManyDeclined: number
  /** of the >1: published NOTHING — the real defect, distinct from declining */
  leftManyBare: number
  /** which published field closed the ambiguity, counted once per edge */
  byRule: Map<Rule, number>
  /** per-rule health: how many times applying the rule left 0 / 1 / >1 */
  ruleHealth: Map<Rule, { zero: number; one: number; many: number }>
  irreducibleExamples: string[]
  bareExamples: string[]
}

const rows = new Map<string, Row>()
const get = (t: string): Row => {
  let r = rows.get(t)
  if (!r) {
    r = {
      total: 0,
      tgtPresent: 0,
      unique: 0,
      ambiguous: 0,
      leftZero: 0,
      leftOne: 0,
      leftMany: 0,
      leftManyDeclined: 0,
      leftManyBare: 0,
      byRule: new Map(),
      ruleHealth: new Map(),
      irreducibleExamples: [],
      bareExamples: [],
    }
    rows.set(t, r)
  }
  return r
}

/** `contains` and `exports` are emitted at the CHILD's / the declaration's own line
 *  by construction (nameLineOf, M60 #921), so the edge's `line_number` is a
 *  published discriminator for them and for nothing else. Asserted here as a
 *  per-type set rather than baked in, so a type added later is measured as
 *  "no edge-line rule" until someone shows the line means that. */
const EDGE_LINE_TYPES = new Set(["contains", "exports"])

let parseFailures = 0
for (const f of sample) {
  let p: any
  try {
    p = await parseFile(f.abs, f.dir)
  } catch {
    parseFailures++
    continue
  }
  if (!p || p.success === false || !Array.isArray(p.symbols)) continue

  const byName = new Map<string, Cand[]>()
  for (const s of p.symbols) {
    const n = String(s?.name ?? "")
    if (!n) continue
    const list = byName.get(n) ?? []
    list.push({ line: Number(s.startLine ?? 0), kind: String(s.kind ?? ""), owner: String(s.ownerName ?? "") })
    byName.set(n, list)
  }

  for (const r of p.relationships ?? []) {
    const t = String(r.type ?? r.relationshipType ?? "")
    if (!t) continue
    const row = get(t)
    row.total++
    const meta = (r.metadata ?? {}) as Record<string, unknown>
    const tgt = String(r.target ?? "")
    let cands = byName.get(tgt)
    if (!cands || cands.length === 0) continue
    row.tgtPresent++
    if (cands.length === 1) {
      row.unique++
      continue
    }
    row.ambiguous++

    const applied: Rule[] = []
    const health = (rule: Rule, rest: Cand[]): Cand[] => {
      applied.push(rule)
      const h = row.ruleHealth.get(rule) ?? { zero: 0, one: 0, many: 0 }
      if (rest.length === 0) h.zero++
      else if (rest.length === 1) h.one++
      else h.many++
      row.ruleHealth.set(rule, h)
      return rest
    }
    /** A rule that is measured but does not narrow. Counted in the health table so
     *  it is visible, never returned, because returning it would let a
     *  can-only-discard rule overwrite a real answer with nothing. */
    const diagnostic = (rule: Rule, rest: Cand[]): void => {
      const h = row.ruleHealth.get(rule) ?? { zero: 0, one: 0, many: 0 }
      if (rest.length === 0) h.zero++
      else if (rest.length === 1) h.one++
      else h.many++
      row.ruleHealth.set(rule, h)
    }

    // A consumer applies the discriminators the edge CARRIES, and STOPS at the one
    // that answers. They are alternatives, not cumulative filters: `targetLine` and
    // `edgeLine` both select on a line, and applying both is an AND that can only
    // delete. The first version of this probe applied them cumulatively and reported
    // all 29 of the `exports` edges the analyzer had just fixed as leaving ZERO
    // candidates — because the edge's own line (the `export` statement's) was
    // ANDed with the `targetLine` the fix had published (the declaration's), and no
    // published symbol carries both. The analyzer was right and the probe was wrong,
    // which is the more useful of the two outcomes only because the probe's number
    // was checked against a file by hand before the claim was written down
    // (dark/scripts/testing/_gates-ui: the `exports -> DARK_CONFIG_RUNDIR` edge at
    // line 65 does carry targetLine 31, and the probe said it carried nothing).
    const rules: { rule: Rule; keep: Cand[] }[] = []
    const tl = meta.targetLine
    if (typeof tl === "number" && tl >= 1) rules.push({ rule: "targetLine", keep: cands.filter((c) => c.line === tl) })
    const ol = meta.overridesLine
    // An `overrides` edge points at the EARLIER declaration and names it here.
    if (typeof ol === "number" && ol >= 1) rules.push({ rule: "overridesLine", keep: cands.filter((c) => c.line === ol) })
    const tk = meta.targetKind
    if (typeof tk === "string" && tk.length > 0) rules.push({ rule: "targetKind", keep: cands.filter((c) => c.kind === tk) })
    if (EDGE_LINE_TYPES.has(t)) {
      const el = Number(r.line_number ?? 0)
      if (el >= 1) rules.push({ rule: "edgeLine", keep: cands.filter((c) => c.line === el) })
    }
    for (const r2 of rules) {
      const h = row.ruleHealth.get(r2.rule) ?? { zero: 0, one: 0, many: 0 }
      if (r2.keep.length === 0) h.zero++
      else if (r2.keep.length === 1) h.one++
      else h.many++
      row.ruleHealth.set(r2.rule, h)
    }
    for (const r2 of rules) {
      if (r2.keep.length !== 1) continue // this field does not answer; try the next one
      applied.push(r2.rule)
      cands = r2.keep
      break
    }

    // `isFunctionCall` is MEASURED but NOT APPLIED, and that is a finding rather
    // than an omission. It says the target is a function declared in this file —
    // it does not say WHICH one — so as a filter it can only discard, never
    // narrow. Measured on the whole corpus: applied to an ambiguous edge it leaves
    // zero candidates on all 231 cases, because every candidate it could be choosing
    // between is already a Function. A rule that can only remove answers must stay
    // out of the narrowing pipeline or it converts a resolved edge into a dangling
    // claim. It was in the pipeline in the first version of this probe.
    if (meta.isFunctionCall === true) diagnostic("isFunctionCall", cands.filter((c) => c.kind === "function"))

    if (cands.length === 0) {
      row.leftZero++
      if (row.irreducibleExamples.length < 6) {
        row.irreducibleExamples.push(
          `ZERO  ${f.repo}/${f.rel}:${r.line_number} ${r.source} -[${t}]-> ${tgt} ` +
            `applied [${applied.join(",")}] against ${byName.get(tgt)!.map((c) => `${c.kind}@${c.line}`).join(" ")}`,
        )
      }
    } else if (cands.length === 1) {
      row.leftOne++
      // Credit the LAST rule that narrowed it — the field a consumer would read.
      const decisive = applied[applied.length - 1] ?? "none"
      row.byRule.set(decisive, (row.byRule.get(decisive) ?? 0) + 1)
    } else {
      row.leftMany++
      // "the analyzer saw several and declined" and "the analyzer published
      // nothing" are different facts and a count cannot tell them apart. The
      // first is a correct answer to an unanswerable question; the second is the
      // defect the whole exercise exists to remove, because the edge then claims
      // a single target by naming one.
      if (typeof meta.targetResolution === "string" && meta.targetResolution.length > 0) row.leftManyDeclined++
      else {
        row.leftManyBare++
        if (row.bareExamples.length < 12) {
          row.bareExamples.push(
            `BARE  ${f.repo}/${f.rel}:${r.line_number} ${r.source} -[${t}]-> ${tgt} applied [${applied.join(",")}] ` +
              `left ${cands.length}: ${cands.map((c) => `${c.kind}@${c.line}/${c.owner}`).join(" ")}`,
          )
        }
      }
      if (row.irreducibleExamples.length < 6) {
        row.irreducibleExamples.push(
          `MANY  ${f.repo}/${f.rel}:${r.line_number} ${r.source} -[${t}]-> ${tgt} ` +
            `applied [${applied.join(",")}] resolution=${String(meta.targetResolution)} left ${cands.length}: ${cands.map((c) => `${c.kind}@${c.line}`).join(" ")}`,
        )
      }
    }
  }
}

const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`)
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)

console.log(
  `type          ${w("edges", 9)}${w("tgt present", 18)}${w("unique", 8)}${w("ambiguous", 12)}` +
    `${w("-> 0 cand", 11)}${w("-> 1 cand", 12)}${w("-> >1 cand", 12)}${w("of which said so", 15)}${w("bare", 8)}  decided by`,
)
console.log("-".repeat(130))
for (const [t, r] of rows) {
  const decided = [...r.byRule.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")
  console.log(
    `${w(t, 13)}${w(r.total.toLocaleString(), 9)}${w(`${r.tgtPresent} ${pct(r.tgtPresent, r.total)}`, 18)}` +
      `${w(r.unique.toLocaleString(), 8)}${w(`${r.ambiguous} ${pct(r.ambiguous, r.tgtPresent)}`, 12)}` +
      `${w(`${r.leftZero} ${pct(r.leftZero, r.ambiguous)}`, 11)}${w(`${r.leftOne} ${pct(r.leftOne, r.ambiguous)}`, 12)}` +
      `${w(`${r.leftMany} ${pct(r.leftMany, r.ambiguous)}`, 12)}${w(r.leftManyDeclined, 15)}${w(r.leftManyBare, 8)}  ${decided}`,
  )
}

console.log(`\nper-rule health — how many candidates the field leaves when it is applied to an AMBIGUOUS edge`)
console.log(`(applied = narrows the answer; isFunctionCall is measured but NOT applied — see the comment above)`)
console.log(`rule             applied     0 cand      1 cand      >1 cand`)
console.log("-".repeat(74))
const ruleTotals = new Map<Rule, { zero: number; one: number; many: number }>()
for (const r of rows.values()) {
  for (const [k, h] of r.ruleHealth) {
    const acc = ruleTotals.get(k) ?? { zero: 0, one: 0, many: 0 }
    acc.zero += h.zero
    acc.one += h.one
    acc.many += h.many
    ruleTotals.set(k, acc)
  }
}
for (const [k, h] of ruleTotals) {
  const n = h.zero + h.one + h.many
  console.log(
    `${w(k, 16)}${w(n.toLocaleString(), 12)}${w(`${h.zero} ${pct(h.zero, n)}`, 12)}${w(`${h.one} ${pct(h.one, n)}`, 12)}${h.many} ${pct(h.many, n)}`,
  )
}

console.log(`\nBARE — ambiguous, several declarations, and NOTHING published: a claim of one target by naming one`)
for (const [t, r] of rows) {
  if (r.bareExamples.length === 0) continue
  console.log(`  ${t}:`)
  for (const e of r.bareExamples) console.log(`    ${e}`)
}
console.log(`\nparse failures: ${parseFailures}`)
for (const [t, r] of rows) {
  if (r.irreducibleExamples.length === 0) continue
  console.log(`\n${t} — edges the published fields do NOT reduce to one declaration:`)
  for (const e of r.irreducibleExamples) console.log(`  ${e}`)
}
