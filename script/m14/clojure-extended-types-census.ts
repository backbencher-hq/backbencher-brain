/**
 * CLOJURE LANE — THE EXTENDED-TYPES CONSTRUCT CENSUS (the population leg of the remedy ladder).
 * Author: Muhammad Ishaq Khan (clojure lane).
 *
 * ## THE QUESTION, AND WHY IT IS AN AST QUESTION
 *
 * The doctrine (L-2026-10-21-14) says a ruling is the LAST resort: the grammars can be cloned,
 * fixed, worked on and tested, so a lane achieves ALL the relationship types, and a ruling must NAME
 * WHICH RUNG WAS UNAVAILABLE AND WHY. The ladder is R1 (bump the npm package to a build whose
 * inventory HAS the construct) · R2 (fetch + patch the source, `tree-sitter generate`,
 * `tree-sitter build --wasm`) · R3 (implement the construct with an EXISTING node type, no grammar
 * change at all). **The question that decides the rung for a construct is WHAT IT PARSES AS** — so
 * this instrument answers it on the AST, over the WHOLE admitted population, and never over text.
 *
 * For each of the four extended values this census measures, per construct:
 *   · the SITES (forms) over the admitted population;
 *   · the NODE TYPE the construct arrives as (the form's own node type, and the node type of the
 *     position that carries the construct's keyword);
 *   · whether the form's subtree carries an ERROR or MISSING node — **the "REAL NODE rather than
 *     recovery text" test, measured on the tree**;
 *   · for the near-miss constructs, whether the relation is ALREADY PUBLISHED UNDER ANOTHER LABEL
 *     (L-2026-10-21-17: a near-miss construct must be NAMED and COUNTED).
 *
 * ## WHAT IT IS NOT
 *
 * It is not a text scan: every reading is a node type, a named child, a parent, or a stored row.
 * The population is the GATE's own rule (`git ls-files` per checkout + the lane's extension list +
 * the 1 MB cap) and the count is printed, so a short page is never mistaken for the population.
 *
 * ## USAGE
 *
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/clojure-extended-types-census.ts \
 *     --out validation/m14/measurements/clojure-extended-types-census.json
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const WASM = path.join(ROOT, "wasm", "tree-sitter-clojure.wasm")
const PINNED_WASM_SHA256 = "90f8866b74d04e1643ed73cce25720c732df2aaa38b45da9dcc773bae8181c27"

const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  if (i >= 0) return argv[i + 1] ?? ""
  for (const a of argv) if (a.startsWith(f + "=")) return a.slice(f.length + 1)
  return undefined
}
const OUT = argOf("--out") ?? ""
const CR = argOf("--corpus-root") ?? process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")

const EXTS = ["clj", "cljs", "cljc", "edn"]
const SIZE_CAP = 1024 * 1024

function gitTracked(repoDir: string): string[] {
  try {
    const r = Bun.spawnSync(["git", "-C", repoDir, "ls-files"], { stdout: "pipe", stderr: "pipe" })
    if (r.exitCode !== 0) return []
    return new TextDecoder().decode(r.stdout).split("\n").filter((l) => l.trim().length > 0)
  } catch {
    return []
  }
}
function discover(): { files: string[]; repos: Map<string, number>; byExt: Map<string, number> } {
  const files: string[] = []
  const repos = new Map<string, number>()
  const byExt = new Map<string, number>()
  for (const repo of readdirSync(CR).sort()) {
    const repoDir = path.join(CR, repo)
    let st: any
    try { st = statSync(repoDir) } catch { continue }
    if (!st.isDirectory()) continue
    let n = 0
    for (const rel of gitTracked(repoDir)) {
      const ext = rel.split(".").pop()?.toLowerCase() ?? ""
      if (!EXTS.includes(ext)) continue
      const abs = path.join(repoDir, rel)
      let size = 0
      try { size = statSync(abs).size } catch { continue }
      if (size > SIZE_CAP) continue
      files.push(abs)
      byExt.set(ext, (byExt.get(ext) ?? 0) + 1)
      n++
    }
    if (n > 0) repos.set(repo, n)
  }
  files.sort()
  return { files, repos, byExt }
}

/* ── the production parser, with the pinned grammar's digest ASSERTED ── */
const wasmBytes = readFileSync(WASM)
const wasmSha256 = createHash("sha256").update(wasmBytes).digest("hex")
if (wasmSha256 !== PINNED_WASM_SHA256) {
  console.error(`THE PINNED GRAMMAR's DIGEST MOVED — expected ${PINNED_WASM_SHA256}, read ${wasmSha256} ⇒ THIS RUN ANSWERS NOTHING`)
  process.exit(3)
}
const { getParser } = await import("../../src/ast/engine")
const parser = await getParser("clojure" as any)

/* ── the buckets ── */
type Site = { file: string; line: number; form: string; nodeType: string; headNodeType: string; hasError: boolean; text: string }
const buckets: Record<string, Site[]> = {
  "mixes_in.defprotocol": [],
  "mixes_in.extend_type": [],
  "mixes_in.extend_protocol": [],
  "mixes_in.extend": [],
  "mixes_in.reify": [],
  "mixes_in.proxy": [],
  "mixes_in.defmixin": [],
  "implements.defrecord_deftype": [],
  "decorates.metadata_carrier": [],
  "decorates.metadata_on_a_declaration": [],
  "decorates.metadata_value_keyword_marker": [],
  "decorates.metadata_value_symbol_type_hint": [],
  "decorates.metadata_value_map": [],
  "decorates.metadata_map_naming_a_symbol": [],
  "renders.keyword_led_vector": [],
  "renders.keyword_led_vector_nested": [],
  "renders.keyword_led_vector_nested_in_code": [],
  "renders.element_with_bare_symbol_child": [],
  "renders.element_with_component_vector_child": [],
  "renders.tagged_literal": [],
  "part_of.ns_form": [],
  "part_of.load_form": [],
  "part_of.require_form": [],
}
const nodeTypesSeen = new Map<string, number>()
const filesByBucket = new Map<string, Set<string>>()
const reposByBucket = new Map<string, Set<string>>()
const extByBucket = new Map<string, Map<string, number>>()

function bump(bucket: string, file: string, repo: string, ext: string): void {
  if (!filesByBucket.has(bucket)) filesByBucket.set(bucket, new Set())
  filesByBucket.get(bucket)!.add(file)
  if (!reposByBucket.has(bucket)) reposByBucket.set(bucket, new Set())
  reposByBucket.get(bucket)!.add(repo)
  if (!extByBucket.has(bucket)) extByBucket.set(bucket, new Map())
  const m = extByBucket.get(bucket)!
  m.set(ext, (m.get(ext) ?? 0) + 1)
}

const DECLARATION_HEADS = new Set([
  "defn", "defn-", "def", "defmacro", "defmulti", "defmethod", "defrecord", "deftype", "defprotocol", "defonce", "defstruct", "deftest",
])

/** THE "REAL NODE, NOT RECOVERY TEXT" TEST, ON THE TREE: does the form's subtree carry an ERROR or
 *  a MISSING node? A construct that only survives as recovery text fails it. */
function subtreeHasError(node: any): boolean {
  if (node.type === "ERROR") return true
  if (node.isMissing) return true
  let cursor = node.walk ? node.walk() : null
  if (!cursor) return false
  const found = (function scan(n: any): boolean {
    if (n.type === "ERROR" || n.isMissing) return true
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c && scan(c)) return true
    }
    return false
  })(node)
  void cursor
  return found
}

/** A keyword-led vector: a `vec_lit` whose FIRST named child is a `kwd_lit` — the Hiccup/Reagent
 *  element shape. */
function isKeywordLed(node: any): boolean {
  if (node.type !== "vec_lit") return false
  const first = node.namedChild(0)
  return !!first && first.type === "kwd_lit"
}

/** Is there a keyword-led vector ANCESTOR? That is what makes a keyword-led vector a CHILD ELEMENT
 *  (a rendered component) rather than a data value. */
function hasKeywordLedAncestor(node: any): boolean {
  let p = node.parent
  while (p) {
    if (isKeywordLed(p)) return true
    p = p.parent
  }
  return false
}

/** A metadata carrier's VALUE — the thing the `^` applies to. In the wired grammar the `meta_lit`
 *  is `^` + the value, and the value is a `kwd_lit` (a marker, `^:private`), a `sym_lit` (a TYPE
 *  HINT, `^String`) or a `map_lit` (a doc/attr map, `^{:doc "..."}`). THE VALUE'S KIND IS THE
 *  DECOMPOSITION: the earlier version of this census scanned the whole `meta_lit` subtree for a
 *  `sym_lit` and therefore counted every TYPE HINT as "metadata naming a symbol", which is how
 *  2,431 type hints came to be read as 2,431 decorator candidates. */
function metaValueKind(metaNode: any): "keyword" | "symbol" | "map" | "other" {
  for (let i = 0; i < metaNode.namedChildCount; i++) {
    const c = metaNode.namedChild(i)
    if (!c) continue
    if (c.type === "kwd_lit") return "keyword"
    if (c.type === "sym_lit") return "symbol"
    if (c.type === "map_lit") return "map"
    return "other"
  }
  return "other"
}

/** A metadata MAP whose VALUE names a symbol — the only shape in which a metadata carrier can
 *  name a callable at all (`^{:decorator my-decorator}`). A map whose values are strings or
 *  keywords is a doc/attr map and names nothing callable. */
function metaMapNamesSymbol(metaNode: any): boolean {
  const value = metaNode.namedChild(0)
  if (!value || value.type !== "map_lit") return false
  let found = false
  const scan = (n: any): void => {
    if (found) return
    if (n.type === "sym_lit") { found = true; return }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) scan(c)
    }
  }
  scan(value)
  return found
}

const { files, repos, byExt } = discover()
let parsed = 0
let parseFail = 0
let walkedForms = 0

for (const abs of files) {
  const rel = path.relative(CR, abs)
  const repo = rel.split(path.sep)[0] ?? ""
  const ext = abs.split(".").pop()?.toLowerCase() ?? ""
  let content = ""
  try { content = readFileSync(abs, "utf8") } catch { parseFail++; continue }
  let tree: any
  try { tree = (parser as any).parse(content) } catch { parseFail++; continue }
  if (!tree) { parseFail++; continue }
  parsed++
  const root = tree.rootNode
  const stack: any[] = [root]
  while (stack.length) {
    const node = stack.pop()
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c) stack.push(c)
    }
    nodeTypesSeen.set(node.type, (nodeTypesSeen.get(node.type) ?? 0) + 1)

    if (node.type === "list_lit") {
      const head = node.namedChild(0)
      const headText = head && head.type === "sym_lit" ? head.text : ""
      const headNodeType = head ? head.type : "(none)"
      if (headText) {
        walkedForms++
        const line = node.startPosition.row + 1
        const text = node.text.split("\n")[0]!.slice(0, 120)
        const mk = (bucket: string): void => {
          buckets[bucket]!.push({ file: rel, line, form: headText, nodeType: node.type, headNodeType, hasError: subtreeHasError(node), text })
          bump(bucket, rel, repo, ext)
        }
        if (headText === "defprotocol") mk("mixes_in.defprotocol")
        else if (headText === "extend-type") mk("mixes_in.extend_type")
        else if (headText === "extend-protocol") mk("mixes_in.extend_protocol")
        else if (headText === "extend") mk("mixes_in.extend")
        else if (headText === "reify") mk("mixes_in.reify")
        else if (headText === "proxy") mk("mixes_in.proxy")
        else if (headText === "defmixin") mk("mixes_in.defmixin")
        else if (headText === "defrecord" || headText === "deftype") mk("implements.defrecord_deftype")
        else if (headText === "ns") mk("part_of.ns_form")
        else if (headText === "load" || headText === "load-file" || headText === "load-string" || headText === "load-reader") mk("part_of.load_form")
        else if (headText === "require" || headText === "use" || headText === "import") mk("part_of.require_form")
      }
    } else if (node.type === "meta_lit") {
      const line = node.startPosition.row + 1
      const parent = node.parent
      /* THE DECLARATION IS THE GRANDPARENT, NOT THE PARENT. In the wired grammar a metadata
       * carrier and the NAME it decorates are SIBLINGS inside one `sym_lit` — `^:private f` is a
       * single `sym_lit` with children [meta_lit, sym_name] — so the FORM the metadata sits on is
       * that `sym_lit`'s parent. Reading the parent (the `sym_lit`) is why the earlier version of
       * this census read 0 declarations: it looked for a `list_lit` where there is none. */
      const owner = parent?.parent
      const ownerHead = owner && owner.type === "list_lit" ? (owner.namedChild(0)?.text ?? "") : ""
      const onDeclaration = DECLARATION_HEADS.has(ownerHead)
      const valueKind = metaValueKind(node)
      const rec = { file: rel, line, form: ownerHead || "(not on a form)", nodeType: node.type, headNodeType: parent ? parent.type : "(none)", hasError: subtreeHasError(node), text: node.text.split("\n")[0]!.slice(0, 120) }
      buckets["decorates.metadata_carrier"]!.push(rec)
      bump("decorates.metadata_carrier", rel, repo, ext)
      if (onDeclaration) {
        buckets["decorates.metadata_on_a_declaration"]!.push({ ...rec, form: ownerHead })
        bump("decorates.metadata_on_a_declaration", rel, repo, ext)
      }
      if (valueKind === "keyword") {
        buckets["decorates.metadata_value_keyword_marker"]!.push(rec)
        bump("decorates.metadata_value_keyword_marker", rel, repo, ext)
      } else if (valueKind === "symbol") {
        buckets["decorates.metadata_value_symbol_type_hint"]!.push(rec)
        bump("decorates.metadata_value_symbol_type_hint", rel, repo, ext)
      } else if (valueKind === "map") {
        buckets["decorates.metadata_value_map"]!.push(rec)
        bump("decorates.metadata_value_map", rel, repo, ext)
        if (metaMapNamesSymbol(node)) {
          buckets["decorates.metadata_map_naming_a_symbol"]!.push(rec)
          bump("decorates.metadata_map_naming_a_symbol", rel, repo, ext)
        }
      }
    } else if (node.type === "vec_lit" && isKeywordLed(node)) {
      const line = node.startPosition.row + 1
      const text = node.text.split("\n")[0]!.slice(0, 120)
      const nested = hasKeywordLedAncestor(node)
      const rec = { file: rel, line, form: node.namedChild(0)?.text ?? "", nodeType: node.type, headNodeType: node.namedChild(0)?.type ?? "(none)", hasError: subtreeHasError(node), text }
      buckets["renders.keyword_led_vector"]!.push(rec)
      bump("renders.keyword_led_vector", rel, repo, ext)
      if (nested) {
        buckets["renders.keyword_led_vector_nested"]!.push(rec)
        bump("renders.keyword_led_vector_nested", rel, repo, ext)
        if (ext !== "edn") {
          buckets["renders.keyword_led_vector_nested_in_code"]!.push(rec)
          bump("renders.keyword_led_vector_nested_in_code", rel, repo, ext)
        }
      }
      /* THE TWO COMPONENT-CALL SHAPES, COUNTED SEPARATELY, because the NAIVE RULE accepts both
       * and the SHAPE COUNTS are what made the resolution test necessary: a bare symbol child
       * (`[:div widget]`) and a child VECTOR whose head is a symbol (`[:div [widget]]`). */
      for (let i = 1; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (!c) continue
        if (c.type === "sym_lit") {
          buckets["renders.element_with_bare_symbol_child"]!.push({ ...rec, text: c.text.split("\n")[0]!.slice(0, 120) })
          bump("renders.element_with_bare_symbol_child", rel, repo, ext)
        } else if (c.type === "vec_lit") {
          const inner = c.namedChild(0)
          if (inner && inner.type === "sym_lit") {
            buckets["renders.element_with_component_vector_child"]!.push({ ...rec, text: inner.text.split("\n")[0]!.slice(0, 120) })
            bump("renders.element_with_component_vector_child", rel, repo, ext)
          }
        }
      }
    } else if (node.type === "tagged_or_ctor_lit") {
      const line = node.startPosition.row + 1
      buckets["renders.tagged_literal"]!.push({ file: rel, line, form: node.text.split(" ")[0] ?? "", nodeType: node.type, headNodeType: "(tagged literal)", hasError: subtreeHasError(node), text: node.text.split("\n")[0]!.slice(0, 120) })
      bump("renders.tagged_literal", rel, repo, ext)
    }
  }
  try { tree.delete() } catch { /* the tree is released below */ }
}

/* ── the report ── */
const L: string[] = []
const say = (s = "") => L.push(s)
say("CLOJURE — THE EXTENDED-TYPES CONSTRUCT CENSUS (the population leg of the remedy ladder)")
say()
say(`  population   ${files.length} admitted file(s) over ${repos.size} repo(s) — ${[...repos.entries()].map(([r, n]) => `${r} ${n}`).join(" · ")}`)
say(`  extensions   ${[...byExt.entries()].map(([e, n]) => `${e} ${n}`).join(" · ")}`)
say(`  root         ${CR}`)
say(`  grammar      ${path.relative(ROOT, WASM)} sha256 ${wasmSha256}`)
say(`  parsed       ${parsed} file(s) · parse failures ${parseFail} · list-headed forms walked ${walkedForms}`)
say()
say("  THE CONSTRUCT, ITS SITES, AND THE NODE TYPE IT ARRIVES AS")
for (const [bucket, sites] of Object.entries(buckets)) {
  const errs = sites.filter((s) => s.hasError).length
  const forms = new Map<string, number>()
  for (const s of sites) forms.set(s.form, (forms.get(s.form) ?? 0) + 1)
  const exts = extByBucket.get(bucket) ?? new Map<string, number>()
  say(`    ${bucket.padEnd(46)} ${String(sites.length).padStart(6)} site(s) · ${String(filesByBucket.get(bucket)?.size ?? 0).padStart(4)} file(s) · ${String(reposByBucket.get(bucket)?.size ?? 0).padStart(2)} repo(s) · ERROR/MISSING subtrees ${errs} · ext ${[...exts.entries()].map(([e, n]) => `${e}:${n}`).join(",") || "-"}`)
  if (sites.length && sites.length <= 400) {
    const kinds = [...forms.entries()].sort((a, b) => b[1] - a[1])
    say(`      heads: ${kinds.map(([k, n]) => `${k}(${n})`).join(" ")}`)
  }
}
say()
say("  THE NODE TYPES THE WALK SAW (top 20 by count) — the construct's own vocabulary")
const top = [...nodeTypesSeen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
for (const [t, n] of top) say(`    ${t.padEnd(28)} ${n}`)
console.log(L.join("\n"))

if (OUT) {
  const counts: Record<string, number> = {}
  const filesCount: Record<string, number> = {}
  const reposCount: Record<string, number> = {}
  const errs: Record<string, number> = {}
  for (const [bucket, sites] of Object.entries(buckets)) {
    counts[bucket] = sites.length
    filesCount[bucket] = filesByBucket.get(bucket)?.size ?? 0
    reposCount[bucket] = reposByBucket.get(bucket)?.size ?? 0
    errs[bucket] = sites.filter((s) => s.hasError).length
  }
  writeFileSync(OUT, JSON.stringify({
    instrument: "script/m14/clojure-extended-types-census.ts",
    question: "the four extended values, counted on the AST over the whole admitted population — what node type does each construct arrive as, and is it a REAL node rather than recovery text?",
    population: { files: files.length, repos: Object.fromEntries(repos), byExt: Object.fromEntries(byExt), root: CR, rule: "the GATE's own rule: a real git checkout + `git ls-files` + the lane's extension list {clj,cljs,cljc,edn} + the 1 MB cap" },
    grammar: { file: path.relative(ROOT, WASM), sha256: wasmSha256 },
    parse: { parsed, parseFail, listHeadedFormsWalked: walkedForms },
    counts, files: filesCount, repos: reposCount, errorSubtrees: errs,
    nodeTypesSeen: Object.fromEntries([...nodeTypesSeen.entries()].sort((a, b) => b[1] - a[1])),
    examples: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.slice(0, 12)])),
  }, null, 2))
  console.log(`\nJSON written: ${OUT}`)
}
