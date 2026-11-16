// script/m14/tmp/clean-127-vanished-adjudication.ts
//
// Adjudicates F11's G3 "vanished symbol name(s)" list for the **tree-sitter-clean
// v1.2.4 → v1.2.7** candidate, which read INADMISSIBLE at
// `validation/m14/results/M14.0.F11.clean.json` (142 vanished names, 2 qualifier
// changes, 244 lost pairs, 14 identity breaks).
//
// WHY THIS PROBE IS NEEDED. F11's G3 rule — "the production analyzer must lose no
// symbol name" — is conservative by design and correct as a BLOCK, but it cannot tell
// a lost symbol from a FABRICATED one: a name the pinned grammar's damage invented,
// which therefore SHOULD disappear when the damage does. Measured on this lane, at
// least three of the vanished names are of that kind (`igin_x` for the source's
// `origin_x`, the keyword `where`, and the parameter `env` published as a function).
// So the block's content is a worklist, not a verdict, and this probe produces the
// classification the worklist needs.
//
// The discriminator is deliberately cheap and syntactic: a published NAME is
// evidence-backed only if the source WRITES it.
//
//   FABRICATED     the bare name occurs as a whole word NOWHERE in the tracked
//                  .icl/.dcl of its own corpus → nothing writes it → the analyzer
//                  published a string the source does not contain (a live defect on
//                  the pinned lane, and its disappearance is an improvement)
//   KEYWORD        the name is a Clean keyword (a keyword is never a declaration)
//   SUFFIX-OF      the name is a proper suffix of an identifier written in the SAME
//                  file (the truncation signature: `igin_x` ⊂ `origin_x`)
//   DECLARED       the name occurs in a `.dcl` — an interface file, where a name is a
//                  declaration by construction → the highest-severity real-loss
//                  candidate, since an interface has no locals
//   WRITTEN        it occurs in `.icl` only → needs structural adjudication
//                  (top-level declaration vs local binding vs parameter)
//
// BOUNDARIES, DISCLOSED. Whole-word matching is used throughout because a substring
// test is not evidence: `grep -F igin_x` matches `origin_x` (measured, 20 hits on
// Clyde alone) and would have read every truncation as "written". A name that IS
// written is not thereby a valid symbol — the pinned lane publishes parameters and
// locals as functions too (LocalsAreNotSymbols / ParamsAreNotSymbols) — so WRITTEN is
// deliberately an open class, not a verdict.
//
// Run: bun script/m14/tmp/clean-127-vanished-adjudication.ts
import { execSync } from "node:child_process"
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const CORPUS = "<corpus-root>/bb_tests/repositories"
const ART = path.join(ROOT, "validation/m14/results/M14.0.F11.clean.json")

const CLEAN_KEYWORDS = new Set([
  "where", "let", "in", "with", "case", "of", "if", "then", "else", "module", "import",
  "class", "instance", "type", "derive", "foreign", "export", "definition", "implementation",
  "from", "to", "code", "inline", "special", "system", "not", "is", "instanceof", "infix",
  "generic", "forall", "unboxed", "strict", "guid", "anyclass", "specialize", "newtype",
])

type Cls = "FABRICATED" | "KEYWORD" | "PREDEFINED" | "SUFFIX-OF" | "DECLARED" | "WEAK-DCL" | "WRITTEN"

interface Hit {
  repo: string
  rel: string
  entry: string
  line: number
  kind: string
  name: string
  owner: string | null
  cls: Cls
  detail: string
}

function tracked(repo: string): string[] {
  return execSync("git ls-files '*.icl' '*.dcl'", { cwd: path.join(CORPUS, repo), encoding: "utf8" })
    .split("\n").map((f) => f.trim()).filter(Boolean).sort()
}

interface Index {
  /** identifier -> { total whole-word occurrences, in ANY .dcl of this corpus } */
  idents: Map<string, { n: number; dcl: boolean }>
  /** per-file identifier sets, for the same-file suffix test */
  perFile: Map<string, Set<string>>
}

function indexRepo(repo: string): Index {
  const idx: Index = { idents: new Map(), perFile: new Map() }
  for (const rel of tracked(repo)) {
    let src: string
    try { src = readFileSync(path.join(CORPUS, repo, rel), "utf8") } catch { continue }
    const set = new Set<string>()
    for (const m of src.matchAll(/[A-Za-z_][A-Za-z0-9_']*/g)) {
      const w = m[0]
      set.add(w)
      const cur = idx.idents.get(w) ?? { n: 0, dcl: false }
      cur.n++
      if (rel.endsWith(".dcl")) cur.dcl = true
      idx.idents.set(w, cur)
    }
    idx.perFile.set(rel, set)
  }
  return idx
}

/**
 * Is the name declared by the module's OWN interface file?
 *
 * The first version of this classifier asked whether the name occurred in ANY `.dcl`
 * of the corpus, and that is not evidence: measured, it put `i`, `env`, `a`, `line`,
 * `file`, `info`, `doc`, `kind` and `String` into the "declared" bucket, because those
 * tokens occur in some interface somewhere in a 312-file corpus while the occurrence
 * under test is a parameter or a local. The correct question is the module's own
 * interface — `Foo.icl` is declared by `Foo.dcl` — which is also how Clean's own
 * compiler resolves a name.
 */
function declaredInOwnDcl(repo: string, rel: string, name: string, idx: Index): string | null {
  const dcl = rel.replace(/\.(icl|dcl)$/i, ".dcl")
  const set = idx.perFile.get(dcl)
  if (!set) return null
  return set.has(name) ? dcl : null
}

/** Names the language predefines: publishing one is not a declaration either. */
const PREDEFINED = new Set([
  "otherwise", "Int", "String", "Bool", "Real", "Char", "Bool", "Void", "True", "False",
  "not", "abs", "max", "min", "toString", "undef", "abort", "id", "const", "sin", "cos",
])

function main() {
  if (!existsSync(ART)) { console.error(`missing ${path.relative(ROOT, ART)} — run F11 with --emit first`); process.exit(2) }
  const art = JSON.parse(readFileSync(ART, "utf8"))
  const g3 = art.data.g3 as { vanished: number; vanishedSymbols: string[]; lostPairs: string[]; qualifierChangedSymbols: string[] }
  const repos = art.data.repos as string[]
  console.log(`F11 clean run: ${art.data.g1.filesPinnedDamaged} -> ${art.data.g1.filesCandDamaged} damaged files | vanished=${g3.vanished} lost=${g3.lostPairs.length} qualifier=${g3.qualifierChangedSymbols.length}`)
  console.log(`corpora: ${repos.join(", ")}\n`)

  const indexes = new Map<string, Index>()
  for (const r of repos) indexes.set(r, indexRepo(r))

  const hits: Hit[] = []
  for (const raw of g3.vanishedSymbols) {
    const m = raw.match(/^([^/]+)\/(.+?)\s+(\d+):([^:]+):(.*?)(?:@(.*))?$/)
    if (!m) { console.log(`  (unparsed row) ${raw}`); continue }
    const [, repo, rel, lineS, kind, name, owner] = m
    const idx = indexes.get(repo)!
    const rec = idx.idents.get(name)
    const inFile = idx.perFile.get(rel) ?? new Set<string>()
    let cls: Cls = "FABRICATED"
    let detail = "occurrence 0 as a whole word"
    if (CLEAN_KEYWORDS.has(name)) {
      cls = "KEYWORD"; detail = "Clean keyword, never a declaration"
    } else if (PREDEFINED.has(name)) {
      cls = "PREDEFINED"; detail = "a name the language predefines"
    } else if (rec && rec.n > 0) {
      const own = declaredInOwnDcl(repo, rel, name, idx)
      if (own) { cls = "DECLARED"; detail = `declared by the module's own interface ${own}` }
      else if (rec.dcl) { cls = "WEAK-DCL"; detail = `written ${rec.n}x, appears in some OTHER .dcl of the corpus` }
      else { cls = "WRITTEN"; detail = `written ${rec.n}x in .icl only` }
    } else {
      for (const w of inFile) {
        if (w !== name && w.endsWith(name)) { cls = "SUFFIX-OF"; detail = `suffix of \`${w}\` in the same file`; break }
      }
    }
    hits.push({ repo, rel, entry: raw, line: Number(lineS), kind, name, owner: owner ?? null, cls, detail })
  }

  const by = new Map<Cls, Hit[]>()
  for (const h of hits) { const a = by.get(h.cls) ?? []; a.push(h); by.set(h.cls, a) }
  console.log("=== classification of the vanished names ===")
  for (const c of ["FABRICATED", "KEYWORD", "PREDEFINED", "SUFFIX-OF", "DECLARED", "WEAK-DCL", "WRITTEN"] as Cls[]) {
    const list = by.get(c) ?? []
    console.log(`  ${c.padEnd(11)} ${String(list.length).padStart(4)}`)
  }
  // The name left after every non-symbol class is removed: this is what the lane owes.
  const symbolic = hits.filter((h) => h.cls === "DECLARED" || h.cls === "WEAK-DCL" || h.cls === "WRITTEN")
  console.log(`\n  not-a-symbol in any reading (FABRICATED+KEYWORD+PREDEFINED+SUFFIX-OF): ${hits.length - symbolic.length} of ${hits.length}`)
  console.log(`  possibly-symbolic (DECLARED+WEAK-DCL+WRITTEN):                        ${symbolic.length} of ${hits.length}`)

  const show = (c: Cls, n = 12) => {
    const list = by.get(c) ?? []
    if (!list.length) return
    console.log(`\n--- ${c} (${list.length}) — first ${Math.min(n, list.length)} ---`)
    for (const h of list.slice(0, n)) console.log(`  ${h.repo}/${h.rel}:${h.line} ${h.kind} \`${h.name}\`${h.owner ? "@" + h.owner : ""}  [${h.detail}]`)
  }
  show("SUFFIX-OF", 8)
  show("KEYWORD", 10)
  show("PREDEFINED", 10)
  show("FABRICATED", 12)
  console.log(`\n--- DECLARED (${(by.get("DECLARED") ?? []).length}) — the real-loss candidates, in full ---`)
  for (const h of by.get("DECLARED") ?? []) console.log(`  ${h.repo}/${h.rel}:${h.line} ${h.kind} \`${h.name}\`${h.owner ? "@" + h.owner : ""}  [${h.detail}]`)
  console.log(`\n--- WRITTEN (${(by.get("WRITTEN") ?? []).length}) — needs structural adjudication, in full ---`)
  for (const h of by.get("WRITTEN") ?? []) console.log(`  ${h.repo}/${h.rel}:${h.line} ${h.kind} \`${h.name}\`${h.owner ? "@" + h.owner : ""}  [${h.detail}]`)
}

main()
