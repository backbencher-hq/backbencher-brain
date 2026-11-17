/**
 * C++ LANE AUDIT — whole-population emission census through the PRODUCTION entry.
 *
 * WHAT IT IS FOR: the C++ lane's claims (docs/analyzers/cpp.md, docs/m14/verification/CPP-*.md)
 * were measured on a corpus that is NOT on this machine, so none of them can be re-checked by
 * reading them. This probe re-derives them here, on a corpus cloned for this audit
 * (.cpp-corpus/fmt @ 10.2.1, .cpp-corpus/nlohmann-json @ v3.11.3).
 *
 * IT CALLS `ASTEngine.parseFile` (the call `engine.ts` itself makes), NEVER `analyze()` directly:
 * the lane's own doc records that the two paths differ, and every number in the lane is stated for
 * the production path.
 *
 * OUTPUT: JSON with per-type rows/files/distinct-pairs + the fabrication and honesty checks the
 * lane's gates assert (D1 keywords, D2 self-extends, D3 duplicate pairs, V3 name surface, R7
 * placeholders, confidence/evidenceClass/line presence, resolution of both endpoints against an
 * index built FROM ANALYZER OUTPUT).
 *
 * Usage: bun run script/cpp-audit/census.ts [--limit=N] [--json]
 */
import { readFileSync } from "node:fs"
import { readdirSync, statSync } from "node:fs"
import { join, extname } from "node:path"
import { ASTEngine } from "../../src/ast/engine"

const CPP_EXTS = new Set([".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hxx", ".ipp", ".inl", ".cu", ".h"])

/** Keyword set — a COPY of the analyzer's CPP_KEYWORDS is NOT used on purpose: this probe must be
 *  able to DISAGREE with the analyzer. Derived from ISO 14882 [lex.name] independently, and the
 *  rows it flags are printed so a reader can check them by hand. */
const ISO_KEYWORDS = new Set([
  "alignas", "alignof", "and", "and_eq", "asm", "auto", "bitand", "bitor", "bool", "break",
  "case", "catch", "char", "char8_t", "char16_t", "char32_t", "class", "compl", "concept",
  "const", "consteval", "constexpr", "constinit", "const_cast", "continue", "co_await",
  "co_return", "co_yield", "decltype", "default", "delete", "do", "double", "dynamic_cast",
  "else", "enum", "explicit", "export", "extern", "false", "float", "for", "friend", "goto",
  "if", "inline", "int", "long", "mutable", "namespace", "new", "noexcept", "not", "not_eq",
  "nullptr", "operator", "or", "or_eq", "private", "protected", "public", "register",
  "reinterpret_cast", "requires", "return", "short", "signed", "sizeof", "static",
  "static_assert", "static_cast", "struct", "switch", "template", "this", "thread_local",
  "throw", "true", "try", "typedef", "typeid", "typename", "union", "unsigned", "using",
  "virtual", "void", "volatile", "wchar_t", "while", "xor", "xor_eq",
])

// TRACED, not guessed — and this set was WRONG TWICE before it was right.
//
// DRAFT 1 contained `null`, `unknown`, `undefined`. EVERY row it flagged was a CORRECT edge:
//   * `null`      — fmt declares `template <typename T> struct null`, nlohmann declares
//                   `bool null()` on every SAX interface and `value_t::null`. 66 rows traced.
//   * `unknown`   — `enum class Color { red, green, blue, unknown }` in nlohmann's own examples.
//                   `contains Color -> unknown` is containment of a declared enumerator. 2 traced.
// All three are LEGAL C++ identifiers, so a placeholder test that guesses reports correct edges
// as fabrications. `anonymous` is the only string on this list that is a genuine SENTINEL: it is
// the analyzer's own `CPP_ANONYMOUS` constant, and ONTOLOGY/D21 made it UNPUBLISHABLE, so its
// presence would be a real violation. `global` is the lane's file-scope SOURCE sentinel and is
// checked separately below, because on the TARGET side it is `std::locale::global`.
const PLACEHOLDERS = new Set(["anonymous", ""])

interface Row {
  type: string
  source: string
  target: string
  confidence?: number
  line_number?: number
  metadata?: Record<string, unknown>
}

interface FileRec {
  path: string
  symbols: ASTEngine.UniversalSymbol[]
  relationships: Row[]
  /** How many syntax-error entries the engine itself disclosed for this file (`result.errors`).
   *  The engine caps the array at 50, so this is a floor for files that hit the cap — see
   *  `engineSyntaxErrorCap` in the corpus block. 0 means the grammar reported a clean tree. */
  errorEntries: number
}

function walk(dir: string, out: string[], cap: number): void {
  if (out.length >= cap) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const e of entries) {
    if (out.length >= cap) return
    if (e === ".git" || e === "node_modules" || e === "build" || e === "third_party") continue
    const p = join(dir, e)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(p, out, cap)
    else if (st.isFile() && CPP_EXTS.has(extname(e))) out.push(p)
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const limitArg = args.find((a) => a.startsWith("--limit="))
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 0
  const asJson = args.includes("--json")

  const files: string[] = []
  for (const repo of ["fmt", "nlohmann-json"]) {
    walk(join(process.cwd(), ".cpp-corpus", repo), files, limit > 0 ? limit : 1_000_000)
  }
  files.sort()
  if (limit > 0) files.length = Math.min(files.length, limit)

  const recs: FileRec[] = []
  const byLang: Record<string, number> = {}
  const failures: Array<{ path: string; error: string }> = []
  const t0 = Date.now()

  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    let content: string
    try {
      const buf = readFileSync(f)
      if (buf.length > 1_000_000) continue // the lane's own 1 MiB cap
      content = buf.toString("utf8")
    } catch (e) {
      failures.push({ path: f, error: String(e) })
      continue
    }
    try {
      const res: any = await ASTEngine.parseFile(f, content)
      const lang = String(res?.language ?? "")
      byLang[lang] = (byLang[lang] ?? 0) + 1
      if (lang !== "cpp") continue
      recs.push({
        path: f.replace(process.cwd() + "/", ""),
        symbols: res.symbols ?? [],
        relationships: (res.relationships ?? []) as Row[],
        // The engine already discloses grammar errors as `errors[]` on the result (engine.ts:1879
        // walks `rootNode.hasError`). This probe used to ignore that array entirely, so its
        // "parseFailures: 0" read as "clean parses" while a third of the corpus carries ERROR nodes.
        errorEntries: Array.isArray(res.errors) ? res.errors.length : 0,
      })
    } catch (e) {
      failures.push({ path: f, error: String(e) })
    }
    if ((i + 1) % 100 === 0) process.stderr.write(`  … ${i + 1}/${files.length}\n`)
  }
  const parseMs = Date.now() - t0

  // ── index FROM ANALYZER OUTPUT (the population bb_graph resolves against) ───────────────────
  const nameCount = new Map<string, number>()
  const symbolNames = new Set<string>()
  const ownerMember = new Set<string>() // `${owner}::${name}`
  // PER-FILE declaration counts, for the override-source ambiguity measurement.
  //
  // ★ M65 CORRECTION — THIS MAP PRODUCED THE THIRD WRONG NUMBER OF THE CAMPAIGN, AND THE LESSON IS THE
  // SAME ONE AS `part_of`. It counted `s.name` only, so a file declaring `void f(int)` / `void f(double)`
  // / `void f()` in three classes read as "leaf `f` declared 3x => ambiguous". That is the wrong
  // question. The resolver (parallel-indexer.ts:5239-5247) matches the edge's SOURCE STRING against
  // `name`, `qualifiedName` and `metadata.fqn` FIRST, and only falls back to the bare leaf when none
  // answers. An `overrides` source is `${cls}::${method}` (M65), which IS a published `qualifiedName`,
  // so it resolves EXACTLY and the leaf count is irrelevant.
  //
  // MEASURED both ways over 523 files: 134 of 134 `overrides` sources resolve EXACTLY by their full
  // string, 0 via endsWith, 0 by bare leaf, 0 unresolved. The earlier "134 of 134 ambiguous" measured
  // whether a NAME repeats — which it does in any C++ file with overloads — not whether the EDGE
  // resolves. `part_of` (97.5% correct, not 17.5%) was the same error one type earlier, and "0 of 134
  // unresolvable" before that. Three times is a pattern, so the check is fixed rather than its output:
  // ambiguity is now measured against the KEY SPACE the store receives, not against the name count.
  const keyCount = new Map<string, number>()
  for (const r of recs) {
    const perFile = new Map<string, number>()
    for (const s of r.symbols) {
      // the three keys the store receives: name, qualifiedName, metadata.fqn
      const keys = [s.name, (s as any).qualifiedName, (s.metadata as any)?.fqn]
      for (const k of keys) {
        if (typeof k === "string" && k.length > 0) perFile.set(k, (perFile.get(k) ?? 0) + 1)
      }
    }
    for (const [n, c] of perFile) keyCount.set(`${r.path}\u0000${n}`, c)
  }
  /** The declaration count for the key an override source binds by: the full string first, else the
   *  leaf — the resolver's own order. 0 means nothing in this file answers to it. */
  const keyCountFor = (filePath: string | undefined, source: string): number => {
    if (filePath === undefined) return 0
    const exact = keyCount.get(`${filePath}\u0000${source}`) ?? 0
    if (exact > 0) return exact
    const leaf = overrideLeafOf(source)
    return leaf === "" ? 0 : (keyCount.get(`${filePath}\u0000${leaf}`) ?? 0)
  }
  /** The leaf of an override source: after the last `::` (the M65 spelling) or the last `.` (the
   *  pre-M65 spelling). Both are accepted so the probe can read either. */
  const overrideLeafOf = (source: string): string => {
    const s = String(source ?? "")
    if (s.includes("::")) return s.slice(s.lastIndexOf("::") + 2)
    if (s.includes(".")) return s.slice(s.lastIndexOf(".") + 1)
    return s
  }
  for (const r of recs) {
    for (const s of r.symbols) {
      symbolNames.add(s.name)
      nameCount.set(s.name, (nameCount.get(s.name) ?? 0) + 1)
      const o = (s as any).ownerName
      if (o) ownerMember.add(`${o}::${s.name}`)
      const q = (s as any).qualifiedName
      if (typeof q === "string" && q !== s.name) symbolNames.add(q)
    }
  }
  // ── THE RESOLVER, PER TYPE. ★ M65, THE FOURTH WRONG NUMBER, AND THE FIX IS STRUCTURAL. ────────
  // A single `resolves()` against symbol names was used for EVERY type, and that produced four wrong
  // headlines in this campaign because each type resolves in a DIFFERENT key space:
  //
  //   calls/uses/instantiates/extends/overrides  -> symbol names (+ qualifiedName), per-file then corpus
  //   imports                                    -> module names; external by design (never a symbol)
  //   references                                 -> NAMESPACE names (a `using X = Y;` names a namespace)
  //   part_of                                    -> FILE STEMS (a file-level relation, not a symbol)
  //   exports                                    -> the macro/declared name it names
  //
  // MEASURED CONSEQUENCES, all four the same error — measuring a proxy instead of the consumer's
  // question:
  //   "0 of 134 overrides unresolvable"  -> wrong, all 134 resolved (extractLeaf splits on `.`)
  //   "part_of 17.5% resolved"           -> wrong, 97.5% (measured against file stems)
  //   "overrides 134/134 ambiguous"      -> wrong, 120 exact + 14 genuine
  //   "references 36.9% resolved"        -> wrong, 99.5% (205/206; the one miss is `::std::ostream`,
  //                                          whose ROOT namespace `std` is not declared in-corpus)
  //
  // So `resolves` now takes the type and answers in that type's own space. A rate printed by this
  // probe states which space it used, which is the only way a percentage here can mean anything.
  const corpusNamespaces = new Set<string>()
  const corpusStems = new Set<string>()
  for (const r of recs) {
    for (const s of r.symbols) if (s.kind === "namespace") corpusNamespaces.add(s.name)
    const slash = r.path.lastIndexOf("/")
    const base = slash >= 0 ? r.path.slice(slash + 1) : r.path
    const dot = base.lastIndexOf(".")
    corpusStems.add((dot > 0 ? base.slice(0, dot) : base))
  }
  const resolves = (t: string, type?: string): boolean => {
    if (t === "") return false
    // imports: an external module name. It resolves iff a symbol or namespace carries it, which for
    // a real `#include <vector>` it never does -- that is the contract, not a defect.
    if (type === "imports") return symbolNames.has(t) || corpusNamespaces.has(t)
    // references: a namespace name, possibly a `::` path whose ROOT is the declared namespace.
    if (type === "references") {
      if (corpusNamespaces.has(t)) return true
      const root = t.split("::")[0]
      return root !== "" && corpusNamespaces.has(root)
    }
    // part_of: a FILE STEM. It resolves iff a file with that stem is in the corpus.
    if (type === "part_of") return corpusStems.has(t)
    // the rest: symbol names, then a unique bare name.
    if (symbolNames.has(t)) return true
    if (nameCount.get(t) === 1) return true
    return false
  }
  /** WHICH KEY SPACE a type's rate was measured in. Printed beside every rate, because a resolution
   *  percentage with no stated space is the exact defect that produced four wrong headlines here. */
  const spaceFor = (type: string): string => {
    if (type === "part_of") return "file stems present in the corpus"
    if (type === "references") return "namespace names, or the root of a `::` path"
    if (type === "imports") return "in-corpus symbol/namespace names (EXTERNAL by design — not a defect)"
    return "symbol names + qualifiedName, unique-bare-name fallback"
  }

  // ── per-type aggregation ───────────────────────────────────────────────────────────────────
  const types = new Map<string, { rows: Row[]; files: Set<string>; pairs: Set<string> }>()
  let totalRows = 0
  for (const r of recs) {
    for (const rel of r.relationships) {
      const t = String(rel.type ?? "")
      totalRows++
      let e = types.get(t)
      if (!e) { e = { rows: [], files: new Set(), pairs: new Set() }; types.set(t, e) }
      // The row carries its file (non-enumerably) so a check can ask a PER-FILE question — the
      // override-source ambiguity is "is this leaf declared more than once IN THIS FILE", and a global
      // count would answer a different question.
      Object.defineProperty(rel, "__file", { value: r.path, enumerable: false, configurable: true })
      e.rows.push(rel)
      e.files.add(r.path)
      e.pairs.add(`${rel.source}\u0000${rel.target}`)
    }
  }

  // Object.create(null): `constructor` is a legal SymbolKind and a plain `{}` inherits
  // Object.prototype.constructor, so `kindCensus["constructor"] ?? 0` read a FUNCTION and the
  // count came out as "function Object() { [native code] }111…". That was this probe's bug,
  // found on its own first run — recorded because a census that corrupts one kind is worse
  // than a census that omits it.
  const kindCensus: Record<string, number> = Object.create(null)
  let totalSymbols = 0
  for (const r of recs) {
    totalSymbols += r.symbols.length
    for (const s of r.symbols) kindCensus[s.kind] = (kindCensus[s.kind] ?? 0) + 1
  }

  // ── the checks ────────────────────────────────────────────────────────────────────────────
  const perType: Record<string, any> = {}
  const findings: Array<{ check: string; type?: string; count: number; sample: string[] }> = []

  for (const [t, e] of [...types.entries()].sort((a, b) => b[1].rows.length - a[1].rows.length)) {
    const rows = e.rows
    const confMissing = rows.filter((r) => typeof r.confidence !== "number").length
    const evClass = new Map<string, number>()
    for (const r of rows) {
      const k = String((r.metadata as any)?.evidenceClass ?? "ABSENT")
      evClass.set(k, (evClass.get(k) ?? 0) + 1)
    }
    const lineMissing = rows.filter((r) => typeof r.line_number !== "number" || r.line_number <= 0).length
    const emptyEndpoint = rows.filter((r) => !r.source || !r.target || r.source === "" || r.target === "").length
    const srcResolved = rows.filter((r) => resolves(r.source, t) || r.source === "global").length
    const tgtResolved = rows.filter((r) => resolves(r.target, t)).length
    const reasonMissing = rows.filter((r) => typeof r.confidence === "number" && r.confidence < 1 && !(r.metadata as any)?.reasonCode).length
    const dupPairs = rows.length - e.pairs.size
    perType[t] = {
      rows: rows.length,
      files: e.files.size,
      distinctPairs: e.pairs.size,
      duplicatePairsVsRows: dupPairs,
      confidenceMissing: confMissing,
      confidenceValues: [...new Set(rows.map((r) => r.confidence))].sort() as any[],
      evidenceClass: Object.fromEntries(evClass),
      lineNumberMissing: lineMissing,
      emptyEndpoint,
      sourceResolved: `${srcResolved}/${rows.length}`,
      targetResolved: `${tgtResolved}/${rows.length}`,
      targetResolvedSpace: spaceFor(t),
      sub1WithoutReasonCode: reasonMissing,
    }
  }

  // D1 — a keyword as a calls/uses/instantiates target, or as a published symbol name
  {
    const sample: string[] = []
    let n = 0
    for (const [t, e] of types) {
      if (t !== "calls" && t !== "uses" && t !== "instantiates") continue
      for (const r of e.rows) if (ISO_KEYWORDS.has(r.target)) { n++; if (sample.length < 12) sample.push(`${t} ${r.source} -> ${r.target}`) }
    }
    findings.push({ check: "D1 keyword target (calls/uses/instantiates)", count: n, sample })

    const s2: string[] = []
    let n2 = 0
    for (const r of recs) for (const s of r.symbols) if (ISO_KEYWORDS.has(s.name)) { n2++; if (s2.length < 12) s2.push(`${s.kind} "${s.name}" @ ${r.path}`) }
    findings.push({ check: "D1 keyword SYMBOL name", count: n2, sample: s2 })
  }

  // D2 — a class inheriting from itself
  {
    const sample: string[] = []
    let n = 0
    for (const r of types.get("extends")?.rows ?? []) if (r.source === r.target) { n++; if (sample.length < 12) sample.push(`${r.source} -> ${r.target}`) }
    findings.push({ check: "D2 self-extends", type: "extends", count: n, sample })
  }

  // D3 — duplicate (source,target) pairs for contains/references/imports
  {
    // PER FILE, because the contract is per-file: two translation units that both
    // `#include <cmath>` state two dependencies, not one duplicate.
    for (const t of ["contains", "references", "imports", "part_of"]) {
      let dup = 0
      const sample: string[] = []
      for (const r of recs) {
        const seen = new Set<string>()
        for (const rel of r.relationships) {
          if (String(rel.type) !== t) continue
          const k = `${rel.source}\u0000${rel.target}`
          if (seen.has(k)) { dup++; if (sample.length < 8) sample.push(`${r.path}: ${rel.source} -> ${rel.target}`) }
          else seen.add(k)
        }
      }
      const present = types.has(t)
      if (!present) continue
      findings.push({ check: "D3 duplicate (source,target) pairs IN ONE FILE", type: t, count: dup, sample })
    }
  }

  // V3 — a published symbol name that is not a name (whitespace / angle brackets / braces)
  {
    const sample: string[] = []
    let n = 0
    for (const r of recs) for (const s of r.symbols) {
      const nm = s.name ?? ""
      // `expandedFrom: "macro-heading"` is the lane's DOCUMENTED product decision: a
      // `TEST(Suite, Name) { … }` block defines no C++ function, and the lane publishes the
      // heading TEXT so the body's reads have an owner. It is excluded here because counting a
      // designed answer as a defect is how a real one gets buried.
      if ((s.metadata as any)?.expandedFrom === "macro-heading") continue
      const bad = nm === "" || (/[\s<>{}()]/.test(nm) && !nm.startsWith("operator"))
      if (bad) { n++; if (sample.length < 15) sample.push(`${s.kind} ${JSON.stringify(nm)} @ ${r.path}`) }
    }
    findings.push({ check: "V3 unpublished-shape symbol name (ws/<>/{}/() unless operator), macro-headings excluded as designed", count: n, sample })
  }

  // R7 — placeholder endpoint literals.
  // `global` is DELIBERATELY EXCLUDED from this count and checked separately below, because on
  // the TARGET side it is a MEASURED REAL NAME rather than a placeholder: `std::locale::global`
  // is a function in the C++ standard library, and the analyzer's callee-leaf descent correctly
  // reduces it to `global`. Counting it here would report a correct edge as a fabrication.
  {
    const sample: string[] = []
    let n = 0
    for (const [t, e] of types) for (const r of e.rows) {
      if (PLACEHOLDERS.has(r.source) && r.source !== "global") { n++; if (sample.length < 10) sample.push(`${t} source="${r.source}"`) }
      if (PLACEHOLDERS.has(r.target) && r.target !== "global") { n++; if (sample.length < 10) sample.push(`${t} target="${r.target}"`) }
    }
    findings.push({ check: "R7 placeholder endpoint literal (anonymous/unknown/empty, `global` handled separately)", count: n, sample })
  }

  // THE SENTINEL COLLISION — `global` as a TARGET. This is the same collision D21 fixed for
  // `anonymous`, which the lane never fixed for `global`, and it is NOT a fabrication: the rows
  // name `std::locale::global`, a real function whose leaf IS `global`. What is wrong is the
  // VOCABULARY — the lane uses the literal string `global` as its file-scope SOURCE sentinel, so a
  // real call to `std::locale::global` is indistinguishable from the sentinel to any consumer, and
  // the lane's own R7 "0 placeholder targets" rule cannot flag it without flagging a real edge.
  {
    const sample: string[] = []
    let n = 0
    for (const [t, e] of types) for (const r of e.rows) {
      if (r.target === "global") { n++; if (sample.length < 8) sample.push(`${t} ${r.source} -> global (metadata.qualified=${JSON.stringify((r.metadata as any)?.qualified)})`) }
    }
    findings.push({
      check: "SENTINEL COLLISION: a TARGET spelled `global` (real `std::locale::global`, ambiguous with the lane's file-scope SOURCE sentinel)",
      count: n,
      sample,
    })
  }

  // THE `::` vs `.` SPELLING — the lane's own L-W4 block (real-cpp-analyzer.ts:5671-5673) says the
  // cpp scope separator is `::` and that "the analyzer's own OVERRIDE SOURCE uses the dot". That
  // sentence is still true: the override TARGET was fixed to the leaf, the SOURCE was not.
  {
    const ov = types.get("overrides")
    if (ov) {
      const dottedSrc = ov.rows.filter((r) => r.source.includes(".")).length
      const srcRes = ov.rows.filter((r) => resolves(r.source, "overrides")).length
      findings.push({
        // The check's FIRST name was "the dot ... resolves to no symbol", which this probe DISPROVED:
        // the resolver's extractLeaf (pool-worker.ts:879) splits on `.` too, so a dot source DOES bind —
        // to a NAME, and ambiguously (see the next check). The check below counts the rows whose source
        // is not C++ scope syntax at all, which is the spelling defect; the ambiguity is measured
        // separately so the two are not conflated again.
        check: "overrides SOURCE spelled with a dot (not C++ scope syntax; binds ambiguously rather than not at all)",
        type: "overrides",
        count: dottedSrc,
        sample: [...new Set(ov.rows.filter((r) => r.source.includes(".")).slice(0, 6).map((r) => `${r.source} -> ${r.target}`)), `sources resolving against the in-output index: ${srcRes}/${ov.rows.length}`],
      })
      // THE AMBIGUITY, measured separately. A source binds iff its leaf is declared in the file; it
      // binds UNAMBIGUOUSLY only if that leaf is declared exactly once. Counting the leaves that occur
      // more than once is what separates "no endpoint" (which this probe first claimed, wrongly) from
      // "an endpoint shared with another class" (the real defect).
      let ambig = 0
      let exactKey = 0
      let noKey = 0
      const ambigSample: string[] = []
      for (const r of ov.rows) {
        const src = String(r.source)
        const fp = (r as any).__file as string | undefined
        // THE RESOLVER'S OWN QUESTION: does any key in this file answer to this source string?
        // The full string first (`Derived::f` is a published qualifiedName), then the leaf. A count
        // above 1 means the key is ambiguous; 0 means nothing answers and the edge does not resolve.
        if (fp === undefined) continue
        const exact = keyCount.get(`${fp}\u0000${src}`) ?? 0
        if (exact === 1) { exactKey++; continue }
        const n = keyCountFor(fp, src)
        if (n === 0) { noKey++; if (ambigSample.length < 4) ambigSample.push(`${fp}: ${src} -> NO KEY in this file`) }
        else if (n > 1) { ambig++; if (ambigSample.length < 4) ambigSample.push(`${fp}: ${src} -> key declared ${n}x`) }
      }
      findings.push({
        check: "overrides source binds to an AMBIGUOUS key in its file (declared >1x, not merely a repeated name)",
        type: "overrides",
        count: ambig,
        sample: [`${exactKey} of ${ov.rows.length} sources bind EXACTLY by their full string; ${ambig} ambiguous; ${noKey} resolve to nothing`, ...ambigSample],
      })
    }
  }

  // overrides spelling — `Base.method` (dotted, unresolvable) vs `method` (leaf)
  {
    const ov = types.get("overrides")
    if (ov) {
      const dotted = ov.rows.filter((r) => r.target.includes(".")).length
      const withOwner = ov.rows.filter((r) => typeof (r.metadata as any)?.overriddenOwner === "string").length
      findings.push({
        check: "overrides target spelling",
        type: "overrides",
        count: dotted,
        sample: [`dotted targets (${dotted}) = unresolvable-by-name; leaf targets (${ov.rows.length - dotted}); rows carrying metadata.overriddenOwner (${withOwner})`],
      })
    }
  }

  // part_of target shape — a PATH target cannot resolve; a SYMBOL target can
  {
    const po = types.get("part_of")
    if (po) {
      const pathish = po.rows.filter((r) => r.target.includes("/") || r.target.includes(".") ).length
      findings.push({
        check: "part_of target is a PATH (unresolvable) rather than a symbol stem",
        type: "part_of",
        count: pathish,
        sample: [...new Set(po.rows.filter((r) => r.target.includes("/") || r.target.includes(".")).slice(0, 8).map((r) => `${r.source} -> ${r.target}`))],
      })
    }
  }

  // SOURCE endpoint, in its own key space. NEXT-WORK §1 asserts "source endpoints are 100% resolved
  // for every type" — an assertion is not a measurement, so it is measured here and the residual is
  // printed. The one documented exception is `global`, the lane's file-scope SOURCE sentinel: it is
  // not a declaration and never should resolve, so it is excluded and the number of such rows is
  // stated in the check name rather than silently dropped.
  {
    for (const t of [...types.keys()].sort()) {
      const e = types.get(t)
      if (!e) continue
      const sentinel = e.rows.filter((r) => r.source === "global").length
      const miss = e.rows.filter((r) => !resolves(r.source, t) && r.source !== "global")
      if (miss.length === 0) continue
      findings.push({
        check: `SOURCE unresolved against ITS OWN key space — ${spaceFor(t)} (\`global\` file-scope sentinel excluded: ${sentinel} rows)`,
        type: t,
        count: miss.length,
        sample: [...new Set(miss.slice(0, 40).map((r) => `${r.source} -> ${r.target}`))],
      })
    }
  }

  // EVERY type's unresolved target, in ITS OWN key space, with the space named.
  //
  // This loop used to cover imports/references/exports only, so `part_of`'s 13 residual targets were
  // never printed and two sections of NEXT-WORK (§6 "351/360 = 97.5%", §13 "347/360 = 96.4%") ended
  // up asserting different numbers for the same measurement with nothing to settle it. A probe that
  // prints a rate for one type and not another cannot adjudicate. Now every type reports its residual
  // and the space it measured, so the doc's table is reproducible rather than restated.
  {
    for (const t of [...types.keys()].sort()) {
      const e = types.get(t)
      if (!e) continue
      const miss = e.rows.filter((r) => !resolves(r.target, t))
      findings.push({
        check: `target unresolved against ITS OWN key space — ${spaceFor(t)}`,
        type: t,
        count: miss.length,
        sample: [...new Set(miss.slice(0, 40).map((r) => `${r.source} -> ${r.target}`))],
      })
    }
  }

  const out = {
    corpus: {
      roots: [".cpp-corpus/fmt (fmtlib/fmt @ 10.2.1)", ".cpp-corpus/nlohmann-json (nlohmann/json @ v3.11.3)"],
      candidateFiles: files.length,
      admittedCpp: recs.length,
      byLanguage: byLang,
      parseFailures: failures.length,
      failureSample: failures.slice(0, 10),
      parseMs,
      // ── PARSE HEALTH — DISCLOSURE, NOT A DEFECT RATE. READ THE LABEL. ─────────────────────────
      // `parseFailures` above counts only files where the ENGINE threw. It says nothing about the
      // grammar tree, and this corpus proves the difference: the headline "0 parse failures" sits
      // beside 172 files whose parse result carries ERROR nodes. That is tree-sitter's documented
      // error recovery — one ERROR node can be a single unparseable macro region in a 12,000-line
      // header, and the rest of the file can be exact. So `symbolsFromSyntaxErrorFiles` is NOT a
      // "degraded output" figure and must never be quoted as one; it states how much of the output
      // lives in files where a reader should expect the measured (not assumed) coverage to matter.
      // Measured by the fixture suite and the differential, not by this count.
      syntaxErrorFiles: recs.filter((r) => r.errorEntries > 0).length,
      cleanParseFiles: recs.filter((r) => r.errorEntries === 0).length,
      symbolsFromSyntaxErrorFiles: recs.filter((r) => r.errorEntries > 0).reduce((n, r) => n + r.symbols.length, 0),
      edgesFromSyntaxErrorFiles: recs.filter((r) => r.errorEntries > 0).reduce((n, r) => n + r.relationships.length, 0),
      filesAtEngineSyntaxErrorCap: recs.filter((r) => r.errorEntries >= 50).length,
      engineSyntaxErrorCap: 50,
      syntaxErrorFilesDetail: recs
        .filter((r) => r.errorEntries > 0)
        .sort((a, b) => b.errorEntries - a.errorEntries)
        .slice(0, 12)
        .map((r) => ({ path: r.path, errorEntries: r.errorEntries, symbols: r.symbols.length, edges: r.relationships.length })),
    },
    totals: { symbols: totalSymbols, relationships: totalRows, kinds: kindCensus },
    perType,
    findings,
  }

  if (asJson) {
    console.log(JSON.stringify(out, null, 2))
  } else {
    console.log("=== CORPUS ===")
    console.log(JSON.stringify(out.corpus, null, 2))
    console.log("=== TOTALS ===")
    console.log(`symbols ${totalSymbols} · relationships ${totalRows}`)
    console.log("kinds:", JSON.stringify(kindCensus))
    console.log("\n=== PER TYPE ===")
    for (const [t, v] of Object.entries(perType)) {
      console.log(`${t.padEnd(14)} rows=${String((v as any).rows).padStart(7)} files=${String((v as any).files).padStart(4)} pairs=${String((v as any).distinctPairs).padStart(7)} conf=${JSON.stringify((v as any).confidenceValues)} ev=${JSON.stringify((v as any).evidenceClass)} lineMissing=${(v as any).lineNumberMissing} srcRes=${(v as any).sourceResolved} tgtRes=${(v as any).targetResolved}`)
      console.log(`${" ".repeat(14)} target key space: ${(v as any).targetResolvedSpace}`)
    }
    console.log("\n=== FINDINGS ===")
    for (const f of findings) {
      console.log(`[${f.count === 0 ? "PASS" : "HIT "}] ${f.check}${f.type ? ` (${f.type})` : ""} = ${f.count}`)
      for (const s of f.sample) console.log(`        ${s}`)
    }
  }
}

main().catch((e) => {
  console.error("FAILED:", e)
  process.exit(1)
})
