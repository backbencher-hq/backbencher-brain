/**
 * INCOMING_RUST construct probe — LANE-OWNED corpus measurement for RULING and
 * GAP decisions.
 *
 * The workstream's rule: a type may be RULED only with "a written reason AND a
 * corpus measurement proving the construct that would produce it never occurs",
 * and a GAP is "the language HAS the construct and the analyzer is not reading
 * it". Both verdicts need the same instrument — a count of the CONSTRUCT on the
 * parse tree, over the whole corpus, where a string or a comment cannot fake it.
 *
 * Every probe here is a tree walk: node types, fields and named children. No
 * regular expressions anywhere in this file (a text probe for a construct is how
 * the ontology gate's first version convicted a correct ruling on the strength of
 * a match inside a telnet IAC word list).
 *
 * MODES (all default to the whole ripgrep corpus)
 *   --bare-tuple-ctor     instrument B for the `instantiates` gap: a BARE
 *                         single-segment callee `Foo(..)`, reported against what
 *                         the file itself declares, because that is the only
 *                         evidence a bare name can carry.
 *   --trait-method-impl   instrument B for `overrides`: a method name declared by
 *                         an IN-FILE trait and implemented by an impl of that
 *                         trait — the construct an overrides edge would name.
 *   --imports-construct   the `imports` construct: every `use_declaration`, plus
 *                         the split between what the analyzer records on the
 *                         imports[] channel and what it projects as a relationship.
 *   --exports-construct   the `exports` construct: every `pub`-visible item (the
 *                         exports[] channel) against the ONE relationship-shaped
 *                         site the analyzer has (a route attribute).
 *
 * Usage: bun script/lanes/incoming-rust/construct-probe.ts <mode> [--limit N]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"

const REPO_ROOT = path.resolve(path.join(import.meta.dir, "..", "..", ".."))
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const CORPUS = process.env.BB_PROBE_CORPUS ?? "ripgrep"

const mode = process.argv[2]
const limitAt = process.argv.indexOf("--limit")
const LIMIT = limitAt >= 0 ? Number(process.argv[limitAt + 1]) : Number.MAX_SAFE_INTEGER

const repoDir = path.join(CR, CORPUS)
const tracked = execFileSync("git", ["-C", repoDir, "ls-files"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
  .split("\n").filter((r) => r.endsWith(".rs"))
const pin = execFileSync("git", ["-C", repoDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()

const { ASTEngine } = await import(path.join(REPO_ROOT, "src", "ast", "engine.ts"))

/** The prelude's own enum-variant constructors. A bare call to one of these is
 *  the PRELUDE's variant even when a same-named local type is in scope — which is
 *  exactly the collision RUST-D30 was written for. Matched by exact equality on
 *  the Rust prelude's variant list, never by shape. */
const PRELUDE_VARIANT_CTORS = ["Ok", "Some", "None", "Err"]

interface Ctx {
  tupleStructs: Set<string>
  unitStructs: Set<string>
  tupleVariants: Set<string>
  typeNames: Set<string>
  traitMethods: Map<string, Set<string>>
  implTraitTargets: Map<string, Set<string>>
  bareTupleCtorSites: { file: string; line: number; name: string; verdict: string }[]
  overrideSites: { file: string; line: number; from: string; to: string }[]
  importDecls: number
  importItems: number
  pubItems: number
  routeAttrs: number
}

const freshCtx = (): Ctx => ({
  tupleStructs: new Set(), unitStructs: new Set(), tupleVariants: new Set(), typeNames: new Set(),
  traitMethods: new Map(), implTraitTargets: new Map(),
  bareTupleCtorSites: [], overrideSites: [],
  importDecls: 0, importItems: 0, pubItems: 0, routeAttrs: 0,
})

function isPublic(node: any): boolean {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c && c.type === "visibility_modifier" && c.text.trim() === "pub") return true
  }
  return false
}

function firstUpper(s: string): boolean {
  if (s.length === 0) return false
  const c = s.charCodeAt(0)
  return c >= 65 && c <= 90
}

let filesScanned = 0, filesFailed = 0
const ctx = freshCtx()
let analyzerInstantiatesForBareCtor = 0, analyzerCallsForBareCtor = 0

for (const rel of tracked.slice(0, LIMIT)) {
  const abs = path.join(repoDir, rel)
  let content: string
  try {
    if (statSync(abs).size > 512 * 1024) continue
    content = readFileSync(abs, "utf8")
  } catch { continue }

  let tree: any, res: any
  try {
    const pt = await ASTEngine.parseTree(abs, content)
    tree = pt.tree
    res = await ASTEngine.parseFile(abs, content)
  } catch { filesFailed++; continue }
  filesScanned++

  const rels = res.relationships ?? []
  const bareCtorNames = new Set<string>()
  const callsTargets = new Set<string>()
  const instTargets = new Set<string>()
  for (const r of rels) {
    const lab = String(r.type ?? r.relationshipType ?? "")
    const tgt = String(r.target ?? r.to ?? "")
    if (lab === "calls") callsTargets.add(tgt)
    if (lab === "instantiates") instTargets.add(tgt)
  }
  // The registries answer "what does THIS FILE declare", so they are rebuilt per
  // file. They used to be created once for the whole sweep, which let a callee
  // declared in an EARLIER file classify as local: it reported 85 in-file trait
  // method implementations across 7 files where the true figure is 48 across 3
  // (the rest implement a trait another module declares — exactly the class the
  // analyzer must stay silent about), and it inflated the decidable
  // bare-constructor count the instantiates rule was sized against. The ANALYZER
  // never had the bug (it reads its own per-file symbol table); a probe that
  // over-counts is worse than no probe, because its number gets quoted.
  const per = freshCtx()

  const walk = (n: any): void => {
    const t = n.type
    if (t === "struct_item" || t === "union_item") {
      const nm = n.childForFieldName?.("name")?.text
      if (nm) {
        per.typeNames.add(nm)
        if (isPublic(n)) per.pubItems++
        let tuple = false
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "ordered_field_declaration_list") tuple = true
        }
        if (tuple) per.tupleStructs.add(nm)
        else if (n.namedChildCount <= 2) per.unitStructs.add(nm)
      }
    } else if (t === "enum_item") {
      const nm = n.childForFieldName?.("name")?.text
      if (nm) { per.typeNames.add(nm); if (isPublic(n)) per.pubItems++ }
    } else if (t === "trait_item") {
      const nm = n.childForFieldName?.("name")?.text
      if (nm) {
        per.typeNames.add(nm)
        if (isPublic(n)) per.pubItems++
        const ms = new Set<string>()
        const w: any[] = [n]
        while (w.length > 0) {
          const q = w.pop()!
          if (q !== n && (q.type === "function_item" || q.type === "function_signature_item")) {
            const fnm = q.childForFieldName?.("name")?.text
            if (fnm) ms.add(fnm)
          }
          for (let i = 0; i < q.namedChildCount; i++) { const c = q.namedChild(i); if (c) w.push(c) }
        }
        per.traitMethods.set(nm, ms)
      }
    } else if (t === "impl_item") {
      const traitN = n.childForFieldName?.("trait")
      const typeN = n.childForFieldName?.("type")
      if (traitN && typeN) {
        // `&mut T` / `*const T` / `(T)` are transparent to a type's NAME (the
        // analyzer's nominalTypeNode rule), so the walk unwraps them before
        // reading the leaf. Without this the probe read `&'a M` as the type and
        // could not see that the implementing type is a generic PARAMETER at all
        // — which is the split the overrides ruling turns on.
        let cur: any = typeN
        for (let guard = 0; cur && guard < 16; guard++) {
          const ct = cur.type
          if (ct === "reference_type" || ct === "pointer_type" || ct === "parenthesized_type") {
            let inner: any = cur.childForFieldName?.("type") ?? null
            if (!inner && cur.namedChildCount > 0) inner = cur.namedChild(cur.namedChildCount - 1)
            if (!inner) { cur = null; break }
            cur = inner
            continue
          }
          break
        }
        let tn = cur ? cur.text.split("<")[0].trim() : ""
        const segs = tn.split("::").filter(Boolean)
        tn = segs.length ? segs[segs.length - 1] : tn
        let tr = traitN.text.split("<")[0].trim()
        const tsegs = tr.split("::").filter(Boolean)
        tr = tsegs.length ? tsegs[tsegs.length - 1] : tr
        if (tr && tn) {
          let set = per.implTraitTargets.get(tr)
          if (!set) { set = new Set(); per.implTraitTargets.set(tr, set) }
          set.add(tn)
        }
        // the impl's own methods, at any depth of the declaration_list
        const w: any[] = [n]
        while (w.length > 0) {
          const q = w.pop()!
          if (q !== n && (q.type === "function_item" || q.type === "function_signature_item")) {
            const fnm = q.childForFieldName?.("name")?.text
            if (!fnm) continue
            const line = q.startPosition.row + 1
            // the overrides candidate: the impl of an IN-FILE trait that
            // declares a method with this name
            for (const [trName, ms] of per.traitMethods.entries()) {
              if (!ms.has(fnm)) continue
              const targets = per.implTraitTargets.get(trName)
              if (targets && targets.has(tn)) {
                per.overrideSites.push({ file: rel, line, from: `${tn}.${fnm}`, to: `${trName}.${fnm}` })
                break
              }
            }
          }
          for (let i = 0; i < q.namedChildCount; i++) { const c = q.namedChild(i); if (c) w.push(c) }
        }
      }
    } else if (t === "use_declaration") {
      per.importDecls++
      let items = 0
      const w: any[] = [n]
      while (w.length > 0) {
        const q = w.pop()!
        if (q !== n && (q.type === "identifier" || q.type === "type_identifier")) items++
        if (q !== n && q.type === "use_wildcard") items++
        for (let i = 0; i < q.namedChildCount; i++) { const c = q.namedChild(i); if (c) w.push(c) }
      }
      per.importItems += items
    } else if (t === "attribute_item") {
      const txt = n.text
      if (txt.startsWith("#[")) {
        const verbs = ["get", "post", "put", "delete", "patch", "head", "options", "trace", "route"]
        const rest = txt.slice(2)
        for (const vb of verbs) {
          if (!rest.startsWith(vb)) continue
          const nx = rest[vb.length] ?? ""
          if (nx === "(" || nx === " ") { per.routeAttrs++; break }
        }
      }
    } else if (t === "call_expression") {
      const fn = n.childForFieldName?.("function")
      if (fn && fn.type === "identifier" && firstUpper(fn.text)) {
        const name = fn.text
        bareCtorNames.add(name)
        if (callsTargets.has(name)) analyzerCallsForBareCtor++
        if (instTargets.has(name)) analyzerInstantiatesForBareCtor++
        let verdict: string
        if (PRELUDE_VARIANT_CTORS.includes(name)) verdict = "prelude-variant"
        else if (per.tupleStructs.has(name)) verdict = "in-file-tuple-struct"
        else if (per.tupleVariants.has(name)) verdict = "in-file-tuple-variant"
        else if (per.typeNames.has(name)) verdict = "in-file-type-other-shape"
        else verdict = "not-declared-here"
        per.bareTupleCtorSites.push({ file: rel, line: n.startPosition.row + 1, name, verdict })
      }
    } else if (t === "tuple_variant") {
      const nm = n.childForFieldName?.("name")?.text
      if (nm) {
        per.typeNames.add(nm)
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "ordered_field_declaration_list") per.tupleVariants.add(nm)
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(tree.rootNode)
  // fold this file's per-file registries into the corpus totals
  for (const s of per.bareTupleCtorSites) ctx.bareTupleCtorSites.push(s)
  for (const s of per.overrideSites) ctx.overrideSites.push(s)
  ctx.importDecls += per.importDecls
  ctx.importItems += per.importItems
  ctx.pubItems += per.pubItems
  ctx.routeAttrs += per.routeAttrs
  try { tree.delete?.() } catch { /* the pool frees it */ }
}

const pad = (s: string | number, n: number): string => (String(s) + " ".repeat(n)).slice(0, n)
console.log(`construct probe — ${mode} — ${CORPUS}@${pin.slice(0, 7)}  ${filesScanned} files scanned, ${filesFailed} failed\n`)

if (mode === "--bare-tuple-ctor") {
  const byVerdict = new Map<string, number>()
  for (const s of ctx.bareTupleCtorSites) byVerdict.set(s.verdict, (byVerdict.get(s.verdict) ?? 0) + 1)
  console.log(`bare single-segment PascalCase CALLEE sites: ${ctx.bareTupleCtorSites.length}`)
  for (const [k, v] of [...byVerdict.entries()].sort()) console.log(`  ${pad(k, 26)} ${v}`)
  console.log(`\ncallee names that carry an instantiates edge somewhere in the same file: ${analyzerInstantiatesForBareCtor} ` +
    `(a name covers several sites, so this is not a site count; the census's constructorSpelling split is: ` +
    `bare_tuple_shape vs path_new)`)
  const decidable = ctx.bareTupleCtorSites.filter((s) => s.verdict === "in-file-tuple-struct" || s.verdict === "in-file-tuple-variant")
  console.log(`\nsites where the file ITSELF declares the callee as a tuple struct/variant (decidable): ${decidable.length}`)
  for (const s of decidable.slice(0, 30)) console.log(`  ${s.file}:${s.line} ${s.name}  (${s.verdict})`)
  const prelude = ctx.bareTupleCtorSites.filter((s) => s.verdict === "prelude-variant")
  console.log(`\nprelude-variant sites (must stay silent — RUST-D30): ${prelude.length}`)
  for (const s of prelude.slice(0, 20)) console.log(`  ${s.file}:${s.line} ${s.name}`)
  const undeclared = ctx.bareTupleCtorSites.filter((s) => s.verdict === "not-declared-here")
  console.log(`\nsites whose callee this file does not declare (foreign — must stay silent): ${undeclared.length}`)
  for (const s of undeclared.slice(0, 20)) console.log(`  ${s.file}:${s.line} ${s.name}`)
} else if (mode === "--trait-method-impl") {
  const uniq = new Map<string, { file: string; line: number; from: string; to: string }>()
  for (const s of ctx.overrideSites) {
    const k = `${s.file}|${s.from}|${s.to}`
    if (!uniq.has(k)) uniq.set(k, { file: s.file, line: s.line, from: s.from, to: s.to })
  }
  console.log(`in-file trait method implementations (the construct an overrides edge names): ${uniq.size}`)
  // the PUBLISHABLE subset: the implementing type must be a real type name, not
  // one of the impl block's own generic parameters. `impl<'a, M: Matcher> Matcher
  // for &'a M` implements the trait for one caller's reference to whatever M is
  // bound to, and this file has no name for that.
  // ASCII upper-case test, NOT a pattern: this lane's instruments do not use
  // regular expressions at all.
  const isSingleUpperLetter = (s0: string): boolean => {
    if (s0.length !== 1) return false
    const c = s0.charCodeAt(0)
    return c >= 65 && c <= 90
  }
  let publishable = 0, suppressed = 0
  const supFiles = new Map<string, number>()
  for (const s of uniq.values()) {
    const owner = String(s.from).split(".")[0]
    if (isSingleUpperLetter(owner)) { suppressed++; supFiles.set(s.file, (supFiles.get(s.file) ?? 0) + 1) }
    else publishable++
  }
  console.log(`  of which the implementing type is a REAL type name (publishable): ${publishable}`)
  console.log(`  of which the implementing type is a generic PARAMETER (silent): ${suppressed}`)
  for (const [f, c] of [...supFiles.entries()].sort()) console.log(`    suppressed in ${f}: ${c}`)
  const byTrait = new Map<string, number>()
  for (const s of uniq.values()) {
    const t = String(s.file)
    byTrait.set(t, (byTrait.get(t) ?? 0) + 1)
  }
  let n = 0
  for (const s of uniq.values()) {
    if (n++ < 40) console.log(`  ${s.file}:${s.line} ${s.from} -> ${s.to}`)
  }
  console.log(`\nfiles carrying at least one: ${byTrait.size}`)
} else if (mode === "--imports-construct") {
  console.log(`use_declaration nodes: ${ctx.importDecls}`)
  console.log(`imported NAMES inside them: ${ctx.importItems}`)
  console.log(`\n(the analyzer's imports[] channel recorded these in the census run; what it does NOT\n project is a relationship of type \`imports\` — see the census's 0 for that label)`)
} else if (mode === "--exports-construct") {
  console.log(`pub-visible items: ${ctx.pubItems}`)
  console.log(`route attributes (the only site that projects an \`exports\` RELATIONSHIP): ${ctx.routeAttrs}`)
} else {
  console.error(`unknown mode ${mode}; see the header for the list`)
  process.exit(2)
}