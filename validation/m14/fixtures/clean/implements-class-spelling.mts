#!/usr/bin/env bun
/**
 * CLEAN lane — the `implements` residual, split by CAUSE, over the gate's OWN dump.
 *
 * The arm's `implements` rows that are not resolved are almost all `ambDeclOnly`: the edge's
 * target is the class name as the INSTANCE spells it (`instance == Bool` -> `==`), and the
 * project's key space holds that spelling many times because every instance publishes its
 * member under the same name (`Bool.==`, `Int.==`, ... 37 of them). The class itself is
 * published under the DECLARATION's spelling, which Clean parenthesises (`class (==) infix 4`).
 *
 * This instrument answers ONE question, from the dump and the project's own symbols:
 * for a target `T`, is `(T)` a class-like declaration in the project, and does it collapse
 * (all its declarations carrying the same non-empty qualifiedName != the key) to exactly one?
 * That is the row a label-aware rule could decide — with the evidence that the row's LABEL is
 * `implements`, so its target is a CLASS, and the class is declared under the other spelling.
 *
 * It also names what stays: targets whose parenthesised spelling is not declared, targets with
 * no parenthesised form at all (ordinary identifiers), and targets where the class-like key
 * itself is genuinely ambiguous (two modules declaring the same class name).
 *
 * Usage: bun validation/m14/fixtures/clean/implements-class-spelling.mts --dump=<path> [--json=<out>]
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { parseFile } from "../../../../src/ast/pool-worker"

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const DUMP = arg("dump")
const JSON_OUT = arg("json")
const CORPUS = arg("corpus") ?? process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
if (!DUMP) {
  console.error("usage: --dump=<incoming gate --dump output>")
  process.exit(2)
}

// ---------------------------------------------------------------- the dump rows
type Row = { outcome: string; target: string; file: string; line: string }
const rows: Row[] = []
for (const line of fs.readFileSync(DUMP, "utf8").split("\n")) {
  const p = line.split("\t")
  if (p[0] !== "DUMP" || p[1] !== "implements") continue
  // DUMP <label> <outcome> <target> <file>:<line> <...>
  rows.push({ outcome: p[2], target: p[3], file: p[4], line: p[5] ?? "" })
}

// ---------------------------------------------------------------- the project's symbols
/** repo root -> target -> declarations */
const projectDecls = new Map<string, Map<string, { file: string; kind: string; qual: string }[]>>()
const repoCache = new Map<string, { root: string; files: string[] }>()

function repoOf(abs: string): { root: string; files: string[] } | null {
  const hit = [...repoCache.values()].find((r) => abs.startsWith(r.root + "/"))
  if (hit) return hit
  // walk up until a .git is found
  let dir = path.dirname(abs)
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, ".git"))) {
      let tracked: string[] = []
      try {
        tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 26 })
          .split("\0").filter((f) => /\.(icl|dcl)$/.test(f))
      } catch { /* not a repo */ }
      const rec = { root: dir, files: tracked }
      repoCache.set(dir, rec)
      return rec
    }
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}

async function declsFor(abs: string): Promise<Map<string, { file: string; kind: string; qual: string }[]>> {
  const repo = repoOf(abs)
  if (!repo) return new Map()
  let m = projectDecls.get(repo.root)
  if (m) return m
  m = new Map()
  projectDecls.set(repo.root, m)
  for (const rel of repo.files) {
    let r: any
    try { r = await parseFile(path.join(repo.root, rel), repo.root, { projectRoot: repo.root } as any) } catch { continue }
    if (!r) continue
    for (const s of r.symbols ?? []) {
      const name = String(s?.name ?? "")
      if (!name) continue
      const qual = String(s?.qualifiedName ?? "")
      let arr = m.get(name)
      if (!arr) m.set(name, (arr = []))
      arr.push({ file: rel, kind: String(s?.kind ?? ""), qual })
      if (qual && qual !== name) {
        let qa = m.get(qual)
        if (!qa) m.set(qual, (qa = []))
        qa.push({ file: rel, kind: String(s?.kind ?? ""), qual })
      }
    }
  }
  return m
}

/** the gate's own collapse test, stated over one key's declarations */
function collapseCount(list: { kind: string; qual: string }[]): { count: number; qualified: number; same: boolean } {
  const names = new Set(list.map((d) => (d.qual && d.qual !== "" ? d.qual : "")))
  const qualified = list.filter((d) => d.qual.length > 0).length
  const same = names.size === 1 && !names.has("")
  return { count: list.length, qualified, same }
}

const CLASS_LIKE = new Set(["class", "interface", "generic", "trait", "protocol", "type_class", "module"])

const buckets: Record<string, number> = {
  "decided-by-bare-class-like": 0,
  "decided-by-parens-class-like": 0,
  "class-like-of-bare-still-ambiguous": 0,
  "no-class-like-here-but-class-like-in-another-project": 0,
  "no-class-like-anywhere-in-the-corpus": 0,
  "class-like-of-parens-still-ambiguous": 0,
}

/** every corpus repository, so "the class is in another project" is MEASURED and not assumed */
const CORPUS_REPOS: string[] = fs.readdirSync(CORPUS)
  .map((d) => path.join(CORPUS, d))
  .filter((d) => { try { return fs.statSync(d).isDirectory() && fs.existsSync(path.join(d, ".git")) } catch { return false } })
const perTarget = new Map<string, { bucket: string; total: number; parens: string; kind: string }>()
const examples: Record<string, string[]> = {}
const bump = (k: string, ex: string) => {
  buckets[k] = (buckets[k] ?? 0) + 1
  ;(examples[k] ??= []).length < 8 && examples[k].push(ex)
}

/** an operator spelling: no identifier characters, no dot, no colon — the same predicate the
 *  analyzer uses to decide a name cannot be an ordinary identifier. */
function isOperatorSpelling(name: string): boolean {
  if (name.length === 0 || name.startsWith("(") || name.includes(".") || name.includes(":")) return false
  for (const c of name) {
    if (c === "_" || c === "'" || (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9")) return false
  }
  return true
}

let ambiguousRows = 0
for (const row of rows) {
  if (row.outcome !== "ambDeclOnly" && row.outcome !== "ambBoth") continue
  ambiguousRows++
  const parens = `(${row.target})`
  const decls = await declsFor(row.file)
  const classLikeOf = (key: string) => (decls.get(key) ?? []).filter((d) => CLASS_LIKE.has(d.kind.toLowerCase()))
  const describe = (list: { kind: string; qual: string }[]) =>
    `decls=${list.length} kinds=${JSON.stringify([...new Set(list.map((d) => d.kind))])} quals=${JSON.stringify([...new Set(list.map((d) => d.qual))])}`

  // STEP 1 — the key itself, class-like declarations only. `implements` SAYS the target is a class,
  // so a member that shares the spelling is not a rival for THIS row.
  const bare = classLikeOf(row.target)
  const bareCol = collapseCount(bare)
  if (bare.length > 0 && bareCol.count > 1 && bareCol.same) {
    bump("decided-by-bare-class-like", `${row.target} ${describe(bare)}`)
    const prev = perTarget.get(row.target)
    perTarget.set(row.target, { bucket: "decided-by-bare-class-like", total: (prev?.total ?? 0) + 1, parens, kind: bare[0].kind })
    continue
  }
  // STEP 2 — the DECLARATION's spelling. Clean parenthesises an operator-named class there.
  const ph = classLikeOf(parens)
  const phCol = collapseCount(ph)
  if (ph.length > 0 && phCol.count > 1 && phCol.same) {
    bump("decided-by-parens-class-like", `${row.target}->${parens} ${describe(ph)}`)
    const prev = perTarget.get(row.target)
    perTarget.set(row.target, { bucket: "decided-by-parens-class-like", total: (prev?.total ?? 0) + 1, parens, kind: ph[0].kind })
    continue
  }
  let bucket = bare.length > 1 || ph.length > 1
    ? `class-like-of-${bare.length > 1 ? "bare" : "parens"}-still-ambiguous`
    : "no-class-like-anywhere-in-the-corpus"
  if (bucket === "no-class-like-anywhere-in-the-corpus") {
    // MEASURE the cross-project claim: is the class declared class-like in a DIFFERENT corpus repo?
    const homeRoot = repoOf(row.file)?.root ?? ""
    const elsewhere: string[] = []
    for (const repo of CORPUS_REPOS) {
      if (repo === homeRoot) continue
      const other = await declsFor(path.join(repo, "x.icl"))
      const otherBare = (other.get(row.target) ?? []).filter((d) => CLASS_LIKE.has(d.kind.toLowerCase()))
      const otherPh = (other.get(parens) ?? []).filter((d) => CLASS_LIKE.has(d.kind.toLowerCase()))
      const col = [...otherBare, ...otherPh]
      if (col.length > 0 && collapseCount(col).same) elsewhere.push(path.basename(repo))
    }
    bucket = elsewhere.length > 0
      ? "no-class-like-here-but-class-like-in-another-project"
      : "no-class-like-anywhere-in-the-corpus"
    bump(bucket, `${row.target} elsewhere=${JSON.stringify(elsewhere)} @ ${row.file.replace(CORPUS + "/", "")}`)
  } else {
    bump(bucket, `${row.target} bare=(${bare.length ? describe(bare) : "none"}) parens=(${ph.length ? describe(ph) : "none"}) @ ${row.file.replace(CORPUS + "/", "")}`)
  }
  const prev = perTarget.get(row.target)
  perTarget.set(row.target, { bucket, total: (prev?.total ?? 0) + 1, parens, kind: (bare[0] ?? ph[0])?.kind ?? "" })
}

const total = Object.values(buckets).reduce((a, b) => a + b, 0)
console.log(`CLEAN implements class-spelling census — ${rows.length} dumped rows, ${ambiguousRows} ambiguous, ${total} classified`)
for (const [k, v] of Object.entries(buckets).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(58)} ${v}`)
console.log("\ntargets (count desc):")
for (const [t, r] of [...perTarget].sort((a, b) => b[1].total - a[1].total).slice(0, 25)) {
  console.log(`  ${JSON.stringify(t).padEnd(18)} n=${String(r.total).padEnd(4)} ${r.bucket}`)
}
for (const [k, ex] of Object.entries(examples)) {
  console.log(`\n-- ${k}`)
  for (const e of ex) console.log(`   ${e}`)
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ rows: rows.length, ambiguousRows, buckets, perTarget: Object.fromEntries(perTarget) }, null, 2))
