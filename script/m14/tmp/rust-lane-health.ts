/**
 * RUST lane — Master Review consolidated health pass.
 *
 * One run, four questions the lane's own gates do not answer together, over the
 * real corpora (cargo 1,374 / tokio 807 / serde 208 / hyper 99 / ripgrep 110
 * .rs files) rather than fixtures:
 *
 *   1. ID + DETERMINISM. The store's own key is (name, line_start); two runs must
 *      be byte-identical. Non-determinism is the defect class that silently
 *      rewrites an index between two reads of the same code.
 *   2. PLACEHOLDERS + OWNERS. Blank names, `Unknown`, member symbols with no
 *      owner, and impl symbols whose published name is not a name.
 *   3. DECLARATION COVERAGE per FORM. Node-type classification is the wrong
 *      granularity — a node type can be "handled" while the declaration it
 *      carries publishes nothing (this is the lesson the elixir lane's census
 *      produced, and rust's spec still classifies by node type, with 118
 *      internal_silent types unreviewed by any wave). So this walks each live
 *      DECLARATION FORM and asks whether a symbol carries it.
 *   4. RELATIONSHIP SOURCE RESOLUTION. Every edge's source must be a symbol the
 *      same file declared, or a declared member of one.
 *
 * CLI: npx tsx script/m14/tmp/rust-lane-health.ts --per-repo=250 [--skip-determinism]
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"

const ROOT = "/home/sano/ishaq/backbencher-brain"
const arg = (n: string) => process.argv.find((a: string) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const CORPUS = arg("corpus") ?? "/home/sano/ishaq/bb_rust_corpora"
const REPOS = (arg("repos") ?? "rust,cargo,tokio,serde,hyper,ripgrep").split(",")
const PER = Number(arg("per-repo") ?? "250")
const SKIP_DET = process.argv.includes("--skip-determinism")
// RUST-D21 sweep: `tests`, `test`, `benches` and `examples` are NO LONGER
// skipped. They are where macro_rules gets its strangest forms and where a
// declaration-position bug hides most easily, so an audit that skips them is
// auditing a corpus nobody ships. Only non-source trees remain excluded.
const SKIP = new Set([".git", "target", "node_modules", "vendor"])

/** rust declaration FORMS, and the symbol kind each must produce. A form with
 *  no live site in the sample is reported as such and never as OK — the census
 *  discipline the elixir lane established. */
const FORMS: { node: string; kind: string; label: string }[] = [
  { node: "function_item", kind: "function", label: "fn" },
  { node: "struct_item", kind: "struct", label: "struct" },
  { node: "enum_item", kind: "enum", label: "enum" },
  { node: "union_item", kind: "struct", label: "union" },
  { node: "trait_item", kind: "trait", label: "trait" },
  { node: "mod_item", kind: "module", label: "mod" },
  { node: "type_item", kind: "type", label: "type alias" },
  { node: "const_item", kind: "constant", label: "const" },
  { node: "static_item", kind: "constant", label: "static" },
  { node: "macro_definition", kind: "macro", label: "macro_rules!" },
  // A form whose lane contract is a PAYLOAD rather than a symbol. rust puts
  // module dependencies in `imports` — `use` publishes NO symbol and no
  // `references` edge (references is the TYPE surface: R13 declared types, R8
  // where-bounds, behaviour/derive) — so asking "is there a symbol on this
  // line" scores `use` and `extern crate` 0% while they are exactly as handled
  // as the contract says. The first version of this census printed
  // "extern crate 18 live / 0 covered" as if it were a gap; it was the census's
  // own wrong channel, and the review's F-4 entry has to be corrected with it.
  { node: "extern_crate_declaration", kind: "imports", label: "extern crate" },
  { node: "use_declaration", kind: "imports", label: "use" },
]

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith(".rs") && fs.statSync(p).size > 0) out.push(p)
  }
  return out
}

const canon = (r: any) => JSON.stringify({ s: (r.symbols ?? []).map((x: any) => [x.name, x.kind, x.range?.startLine, x.ownerName]), r: (r.relationships ?? []).map((x: any) => [x.type, x.source, x.target, x.line_number ?? x.line]) })

/** Does this `use_declaration` have ONLY glob leaves (`use a::{B::*, C::*}`)?
 *  A glob's contents are unknowable without resolving it — the lane's
 *  registered recall gap — so such a tree publishes no import row and the
 *  form's leaves name nothing. */
function isAllGlobUse(n: any): boolean {
  let leaves = 0, globs = 0
  const st: any[] = [n]
  while (st.length) {
    const x = st.pop()
    if (x.type === "use_wildcard") { globs++; continue }
    if (x.type === "use_as_clause") { leaves++; continue }
    if (x.type === "identifier" || x.type === "scoped_identifier") {
      const par = x.parent?.type
      // a `scoped_use_list`'s FIRST identifier is the PREFIX (`windows_sys` in
      // `use windows_sys::{A::*, B::*}`), not a bound leaf — counting it made
      // every all-glob tree look mixed and the exclusion miss
      // compare by POSITION: web-tree-sitter returns a fresh wrapper per
      // `.parent` / `.namedChild` access, so identity comparison always fails
      // (the same trap the line audit recorded) and every all-glob tree looked
      // mixed, so the exclusion never fired
      const first = par === "scoped_use_list" ? x.parent.namedChild(0) : null
      const isPrefix = !!first && first.startIndex === x.startIndex && first.endIndex === x.endIndex
      if (!isPrefix && (par === "use_list" || par === "scoped_use_list" || par === "use_declaration")) leaves++
      continue
    }
    for (let i = 0; i < x.namedChildCount; i++) { const c = x.namedChild(i); if (c) st.push(c) }
  }
  return globs > 0 && leaves === 0
}

async function main() {
  const mod: any = await import(path.join(ROOT, "src/ast/real-rust-analyzer.ts"))
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? (wts.default as any)?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-rust.wasm")))
  let parser = new P(); parser.setLanguage(g)
  // RUST-D21: the pinned grammar's wasm heap is NOT released between parses, so
  // one parser dies at scale — MEASURED on rust-lang/rust's own src/: 4,000 files
  // clean, 5,000 aborts in ts_parser__reduce -> ts_malloc_default. The abort kills
  // the process, so a tool that prints its report at the END prints NOTHING: an
  // exhaustion that reads exactly like "no data". Production is immune by design
  // (parallel-indexer's exit handler respawns the worker and re-routes its batch,
  // and a fresh worker's fresh heap succeeds), which is exactly why the tool
  // defect was invisible until a corpus crossed 5,000 files. Recycle here.
  const RECYCLE_EVERY = 1500
  let sinceRecycle = 0
  const recycle = () => { try { parser.delete() } catch { /* already gone */ } parser = new P(); parser.setLanguage(g); sinceRecycle = 0 }

  const files: string[] = []
  for (const repo of REPOS) {
    const d = path.join(CORPUS, repo)
    if (!fs.existsSync(d)) { console.log(`(no corpus ${repo})`); continue }
    files.push(...walk(d).sort().slice(0, PER))
  }

  const formSeen: Record<string, number> = {}
  const uncovered: Record<string, string[]> = {}
  const formCovered: Record<string, number> = {}
  const idKeys = new Map<string, string>()
  let collisions = 0, blankNames = 0, unknownNames = 0, ownerlessMembers = 0, nonDet = 0, symbols = 0, rels = 0
  // declared-silent classes the first version of this census scored as failures
  let r12BlankDecls = 0, allGlobUseDecls = 0
  const placeholders: string[] = []
  const collisionEx: string[] = []
  const nonDetEx: string[] = []
  let errFiles = 0

  for (const f of files) {
    const text = fs.readFileSync(f, "utf8")
    const tree = parser.parse(text)
    const root = tree.rootNode
    if (root.hasError) errFiles++
    let res: any
    try {
      res = await new mod.RealRustAnalyzer().analyze(root, text, f)
    } catch (e: any) {
      console.log(`ANALYZER THREW ${path.relative(CORPUS, f)}: ${String(e?.message).slice(0, 80)}`)
      continue
    }
    if (!SKIP_DET) {
      const h1 = createHash("md5").update(canon(res)).digest("hex")
      // RUST-D21: this second parse exists only for the determinism hash, and its
      // wasm tree needs the same explicit release as the first — an un-deleted tree
      // per file is what exhausted the heap and aborted the sweep mid-corpus, which
      // looked exactly like an empty corpus because the report prints at the end.
      const tree2 = parser.parse(text)
      let h2: string
      try {
        const res2: any = await new mod.RealRustAnalyzer().analyze(tree2.rootNode, text, f)
        h2 = createHash("md5").update(canon(res2)).digest("hex")
      } finally {
        ;(tree2 as any).delete?.()
      }
      if (h1 !== h2) { nonDet++; if (nonDetEx.length < 5) nonDetEx.push(path.relative(CORPUS, f)) }
    }
    const syms = res.symbols ?? []
    const relsList = res.relationships ?? []
    symbols += syms.length; rels += relsList.length
    // declared names, for source resolution + form coverage
    const byName = new Set<string>()
    for (const s of syms) {
      const nm = String(s.name ?? "")
      byName.add(nm)
      const key = `${nm}@${s.range?.startLine}`
      const prev = idKeys.get(key)
      if (prev !== undefined && prev !== f) { collisions++; if (collisionEx.length < 6) collisionEx.push(`${key} in ${path.relative(CORPUS, f)} and ${path.relative(CORPUS, prev)}`) } else idKeys.set(key, f)
      if (nm === "" || nm.trim() === "") { blankNames++; if (placeholders.length < 12) placeholders.push(`BLANK ${path.relative(CORPUS, f)}:${s.range?.startLine} kind=${s.kind}`) }
      // A PLACEHOLDER is a name the analyzer invented; it is not a name that
      // happens to spell "Unknown". The first version of this census tested the
      // string and reported 7 placeholders — all six of them enum variants
      // literally named `Unknown` (cargo-credential's `ErrorKind::Unknown`,
      // hyper's `BodyLength::Unknown`) and one a FIELD named `unknown` that the
      // analyzer published with its correct case. The falsifiable test is whether
      // the name appears in the SOURCE: a placeholder never does.
      if ((nm === "Unknown" || nm === "unknown") && !new RegExp(`\\b${nm}\\b`).test(text.slice(Math.max(0, (s.range?.startIndex ?? 0) - 400), (s.range?.endIndex ?? 0) + 400))) {
        unknownNames++
        if (placeholders.length < 12) placeholders.push(`PLACEHOLDER ${path.relative(CORPUS, f)}:${s.range?.startLine} kind=${s.kind} name not in source`)
      }
      if ((s.kind === "method" || s.kind === "property") && !s.ownerName) { ownerlessMembers++; if (placeholders.length < 12) placeholders.push(`OWNERLESS ${path.relative(CORPUS, f)}:${s.range?.startLine} ${s.kind} ${nm}`) }
    }
    // declaration FORM coverage: does a symbol carry this node's name?
    const walkNode = (n: any) => {
      const form = FORMS.find((x) => x.node === n.type)
      if (form) {
        // `live` is the denominator, so a declared-silent class must not be
        // counted into it at all — excluding only the numerator left `const`
        // reading 99.7% with every real declaration covered.
        // TWO declared-silent classes leave the DENOMINATOR (excluding only the
        // numerator is what left `const` reading 99.7% with every real
        // declaration covered):
        //   R12 — a blank name declares nothing: `const _: fn() = || {` and
        //   `const _: LinkedList<&Entry> = LinkedList::new();` are valid Rust
        //   and mint no symbol (the GO5/Z8 class);
        //   the registered glob recall gap — a glob's names are unknowable
        //   without resolving it, so `use windows_sys::{A::*, B::*}` publishes
        //   no import row. Both were scored as FAILURES by the first version of
        //   this census, which is the same instrument-error class as the wrong
        //   CHANNEL (F-4) and the wrong PLACEHOLDER test (F-8): three census
        //   corrections, zero analyzer defects behind them.
        const declNm0 = form.kind !== "imports" ? (n.childForFieldName?.("name") ?? (n.namedChild(0)?.type === "identifier" ? n.namedChild(0) : null)) : null
        const isR12Blank = !!declNm0 && declNm0.text === "_"
        const isAllGlob = form.node === "use_declaration" && isAllGlobUse(n)
        if (isR12Blank) { r12BlankDecls++; formSeen[`${form.label} [R12 blank]`] = (formSeen[`${form.label} [R12 blank]`] ?? 0) + 1 }
        else if (isAllGlob) { allGlobUseDecls++; formSeen[`${form.label} [all-glob]`] = (formSeen[`${form.label} [all-glob]`] ?? 0) + 1 }
        else formSeen[form.label] = (formSeen[form.label] ?? 0) + 1
        // the symbol's name should be a declared name in this file at that line
        const line = n.startPosition.row + 1
        if (!isR12Blank && !isAllGlob) {
        // measure on the channel the form's contract actually uses
        const hit = form.kind === "imports"
          ? (res.imports ?? []).some((im: any) => im.range?.startLine === line)
          : syms.some((s: any) => s.range?.startLine === line)
        if (hit) formCovered[form.label] = (formCovered[form.label] ?? 0) + 1
        else {
          // is it inside a function BODY? then the class is "function-local
          // declaration", not "this form is unhandled" — the distinction the
          // elixir census forced, and the reason a per-node-type spec can be
          // right about the form and wrong about the site
          let inFn = false
          let cur: any = n.parent
          while (cur) { if (cur.type === "function_item" || cur.type === "closure_expression") { inFn = true; break } cur = cur.parent }
          const bucket = inFn ? "function-local" : "other"
          const key = `${form.label} [${bucket}]`
          formSeen[key] = (formSeen[key] ?? 0) + 1
          formCovered[key] = (formCovered[key] ?? 0) + (hit ? 1 : 0)
          const ex = uncovered[key] ?? (uncovered[key] = [])
          if (ex.length < 4) ex.push(`${path.relative(CORPUS, f)}:${line}  ${n.text.split("\n")[0].slice(0, 78)}`)
        }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walkNode(c) }
    }
    walkNode(root)
    ;(tree as any).delete?.()  // RUST-D21: only tree.delete() returns wasm heap
  }

  console.log(`\n######## RUST LANE HEALTH — files=${files.length} corpora=${REPOS.join(",")} (${SKIP_DET ? "determinism SKIPPED" : "two runs per file"})`)
  console.log(`  symbols=${symbols}  relationships=${rels}  files with a parse error=${errFiles}`)
  console.log(`\n  1. ID / DETERMINISM`)
  console.log(`     same (name, startLine) in DIFFERENT files: ${collisions}  [not a store violation: brain_symbol's PK is id TEXT and no unique index covers that pair — this is consumer lookup ambiguity, and the first version of this census mislabelled it]${collisionEx.length ? "  e.g. " + collisionEx.slice(0, 2).join(" | ") : ""}`)
  console.log(`     non-deterministic files:                    ${nonDet}${nonDetEx.length ? "  e.g. " + nonDetEx.join(", ") : ""}`)
  console.log(`\n  2. PLACEHOLDERS / OWNERS`)
  console.log(`     blank names=${blankNames}  Unknown names=${unknownNames}  ownerless members=${ownerlessMembers}`)
  for (const p of placeholders.slice(0, 8)) console.log(`       ${p}`)
  console.log(`\n  3. DECLARATION COVERAGE per FORM (a form with no live site is reported, never OK)`)
  for (const f of FORMS) {
    const seen = formSeen[f.label] ?? 0, cov = formCovered[f.label] ?? 0
    const pct = seen ? ((cov / seen) * 100).toFixed(1) : "n/a"
    console.log(`     ${f.label.padEnd(14)} live=${String(seen).padStart(6)}  covered=${String(cov).padStart(6)}  ${seen ? pct + "%" : "(no live site)"}`)
    for (const key of Object.keys(formSeen).filter((k) => k.startsWith(f.label + " ["))) {
      const sv = formSeen[key], cv = formCovered[key]
      // a declared-silent class has no `covered` counter, and printing NaN% for
      // it would put a nonsense number next to real ones — the cheapest way to
      // stop a reader trusting the whole table
      const bucketSilent = key.endsWith("[R12 blank]") || key.endsWith("[all-glob]") || key.endsWith("[function-local]")
      const pct = bucketSilent ? "declared silent" : sv ? ((cv / sv) * 100).toFixed(1) + "%" : ""
      console.log(`       ${key.padEnd(28)} live=${String(sv).padStart(5)} covered=${bucketSilent ? "—" : String(cv).padStart(5)} ${pct}`)
      for (const e of (uncovered[key] ?? [])) console.log(`          UNCOVERED ${e}`)
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
