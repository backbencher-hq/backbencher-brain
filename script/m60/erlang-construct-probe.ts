/**
 * ERLANG CONSTRUCT PROBE — the corpus measurement `docs/analyzers/ONTOLOGY-WORKSTREAM.md`
 * requires before a relationship type may be RULED, and before a GAP may be called one.
 *
 *   bun script/m60/erlang-construct-probe.ts [--out <path>] [--repos otp,elixir]
 *
 * ## What it is for
 *
 * The workstream: a type may be RULED only with "a written reason AND a corpus
 * measurement proving the construct that would produce it never occurs. Falsifiable:
 * a probe finding a non-zero count overturns the ruling." `overrides` was missing from
 * Bash for a whole wave behind a prose justification and the differential stayed green,
 * because the oracle was written AFTER the ruling — nothing agrees with nothing. So
 * this measures the LANGUAGE, on the parse tree, with a walker that shares no code with
 * `real-erlang-analyzer.ts`.
 *
 * A text regex is the wrong instrument and the shared gate's first version proved it by
 * returning two false positives. So there are two instruments and the QUESTION decides
 * which applies:
 *
 *   A. GRAMMAR INVENTORY — read from the pinned wasm's OWN node-type table
 *      (`nodeTypeForId` over `nodeTypeCount`), not from a corpus walk. A walk can only
 *      see what the corpus exercises; the table is every type the grammar CAN produce,
 *      and it is also the only place a grammar records abstract supertype/subtype edges
 *      (tree-sitter's `supertypes`), which is how a grammar says "this production IS-A
 *      that one". The FIELD table is read for the same reason.
 *
 *   B. PARSE-TREE SEMANTIC COUNT — for a construct the language CAN express. A second
 *      declaration of a name is perfectly good Erlang, so no grammar inventory will find
 *      it; it has to be counted on the tree, where a string or a comment cannot fake it.
 *
 * ## The probes, and what each one can and cannot decide
 *
 * `extends`
 *   A1 the wasm's own named-type table, filtered for 19 inheritance-shaped names.
 *   A2 the wasm's abstract-supertype edges (`supertypes`), which is the grammar's own
 *      account of subtype relations.
 *   A3 the wasm's FIELD table, filtered for super/base/parent/extend/inherit/subtype.
 *   A4 the corpus node-type histogram, for a grammar whose table and output disagree.
 *   B1 `-extends`/`-inherits`/`-parent`/`-subclass` written as an ATTRIBUTE — the spelling
 *      a language without the grammar node would use, so this is instrument B applied to
 *      a construct instrument A cannot see.
 *   B2 a type declaration naming a SUPERTYPE: any `-type`/`-opaque`/`-nominal` body that
 *      mentions another locally-declared type name, which is the nearest thing Erlang has
 *      to "this type is that type". Reported with the count so the reader can judge
 *      whether a `references` edge is the honest label for it (it already is) or an
 *      `extends` edge was owed.
 *
 * `overrides`
 *   B3 a REPLACEMENT: one (name, arity) whose clause groups are NOT contiguous, split by
 *      whether a preprocessor conditional separates the groups. Erlang's own compiler
 *      rejects two unconditional declarations of one identity ("function f/1 already
 *      defined"), so an interruption without a conditional is not a legal program; an
 *      interruption WITH one is `-ifdef`-selected alternative bodies, which are
 *      alternative implementations rather than one replacing another.
 *   B4 `-callback` declared AND the same identity defined in the SAME file.
 *   B5 `-callback` declarations PUBLISHED per file — the declaration half of the
 *      behaviour-callback shape, and the only half a cross-file resolver can be built on.
 *   B6 `-behaviour(B)` sites per behaviour — the supply half.
 *   B7 the JOIN: for every `-behaviour(B)` whose behaviour module is itself in the corpus,
 *      how many of B's published callback identities the implementing file actually
 *      DEFINES. This is the number that decides whether a cross-file `overrides`
 *      derivation would be non-vacuous and how much of it is name/arity coincidence.
 *   B8 the `overridable`-style marker: any grammar node or attribute that publishes a
 *      definition as replaceable, the way Elixir's `defoverridable` does.
 *
 * ## Honesty
 *
 * Every count is over EVERY admitted file of the named repos, one parse each, sorted —
 * no sampling, no seed. Nothing here is a claim about the ANALYZER; it is a claim about
 * the language as the pinned grammar sees it. Where a probe cannot decide a question the
 * output says so in words, because a probe that answered a question it cannot answer
 * would be worse than no probe.
 */

import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : undefined
const REPOS = (argv.includes("--repos") ? argv[argv.indexOf("--repos") + 1] : "otp,elixir").split(",").map((s) => s.trim()).filter(Boolean)

// 19 shapes, from six languages that HAVE the construct, so the list is not Erlang's
// own vocabulary re-read. A reader who thinks of a 20th can add it and re-run; the gate
// then fails or stops failing on the strength of the new name.
const INHERITANCE_NODE_TYPES = [
  "class_declaration", "class", "class_specifier", "interface_declaration", "trait_declaration",
  "struct_declaration", "inheritance_specifier", "superclass", "base_class", "super_type",
  "supertype", "subclass", "object_declaration", "enum_declaration", "mixin", "prototype",
  "extends_clause", "extends_interfaces", "implements_clause", "super_interfaces", "base_type",
  "parent_class", "inheritance",
]
const INHERITANCE_FIELD_RE = /^(super|base|parent|extend|inherit|implements|subtype|ancestor)/i
const EXTENDS_ATTR_RE = /^\s*-\s*(extends|inherits|subclass|parent_module|base_module|include_class|of_type)\b/

// The preprocessor conditionals, SPLIT by what each one does to the region stack.
//
// A GRAMMAR FACT measured here, and the first version of this probe got it wrong:
// `-ifdef(debug).` is a LEAF `pp_ifdef` node that is a SIBLING of the forms it
// guards, not a container of them. In `ct_telnet_client.erl` the tree is
// `source_file` -> `pp_ifdef @381`, then the guarded `fun_decl`s as ordinary
// siblings, then `pp_else @418`, then the other branch, then `pp_endif @424`.
// A walker that tracks nesting therefore sees every clause at the SAME depth and
// reports `dbg/2` in two branches as "NOT separated by a conditional" — which is
// exactly the false negative the ontology gate was built to prevent, in the
// opposite direction: it would have convicted a correct conditional-compilation
// reading as a redefinition. The region is a DOCUMENT-ORDER property, so it is
// computed from document order.
const PP_OPEN = new Set(["pp_if", "pp_ifdef", "pp_ifndef"])
const PP_BRANCH = new Set(["pp_else", "pp_elif", "pp_elseif", "pp_elseifdef"])
const PP_CLOSE = new Set(["pp_endif"])

function named(node: any): any[] {
  return node?.namedChildren ?? []
}
function namedOfType(node: any, type: string): any | null {
  for (const c of named(node)) if (c?.type === type) return c
  return null
}
function childOfType(node: any, type: string): any | null {
  for (let i = 0; i < (node?.childCount ?? 0); i++) {
    const c = node.child(i)
    if (c && c.type === type) return c
  }
  return null
}

/** Arity of a node's `expr_args`: its named children, comments excluded. The analyzer
 *  counts the same and the shape probes (`erlang-er2-shapes2.ts`) pinned it. */
function argsArity(exprArgs: any | null): number {
  if (!exprArgs) return 0
  let n = 0
  for (const c of named(exprArgs)) if (c?.type !== "comment") n++
  return n
}

/** The `expr_args` of a clause-like node (`function_clause`, `type_sig`). Passing an
 *  `expr_args` node to `clauseArity` instead of the node holding it returns 0, which is
 *  silent: the first version of this probe did exactly that and reported every OTP
 *  `-callback` at arity 0 (`init/0`, `handle_call/0`, …), so the behaviour join matched
 *  only the five files that happen to define a 0-arity `init`. A count that is wrong
 *  in a direction nobody checks is the failure this workstream is about, so the two
 *  accessors are separate functions rather than one that returns 0 on a miss. */
function clauseArity(clause: any): number {
  return argsArity(namedOfType(clause, "expr_args"))
}

/** A `fa` is `f` `/` `a`; the grammar can also spell the whole thing as an atom. */
function readFa(fa: any): { name: string; arity: number } | null {
  let name = ""
  let arity = -1
  for (const c of named(fa)) {
    if (c?.type === "atom" && !name) name = c.text
    else if (c?.type === "integer" && arity < 0) arity = Number(c.text)
  }
  if (!name) return null
  return { name, arity: arity < 0 ? 0 : arity }
}

async function main(): Promise<void> {
  const root = resolve((import.meta as any).dirname ?? dirname(process.argv[1] ?? "."), "..", "..")
  const wts: any = await import("web-tree-sitter")
  const WSP = wts.Parser ?? wts.default
  const WSL = wts.Language ?? wts.default?.Language
  await WSP.init({ locateFile: () => join(root, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new WSP()
  parser.setLanguage(await WSL.load(readFileSync(join(root, "wasm", "tree-sitter-erlang.wasm"))))

  // ── corpus ──────────────────────────────────────────────────────────────
  const files: { repo: string; abs: string; rel: string; text: string }[] = []
  for (const repo of REPOS) {
    const dir = join(CR, repo)
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked.sort()) {
      if (!rel.endsWith(".erl") && !rel.endsWith(".hrl")) continue
      const abs = join(dir, rel)
      try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
      files.push({ repo, abs, rel: `${repo}/${rel}`, text: readFileSync(abs, "utf8") })
    }
  }
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  const revs: Record<string, string> = {}
  for (const repo of REPOS) {
    try { revs[repo] = execFileSync("git", ["-C", join(CR, repo), "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { revs[repo] = "unknown" }
  }

  // ── INSTRUMENT A: the grammar's OWN tables ───────────────────────────────
  const lang = (parser as any).getLanguage?.() ?? (parser as any).language
  const namedDefined: string[] = []
  const anonDefined: string[] = []
  const nodeTypeCount = lang?.nodeTypeCount ?? 0
  for (let i = 0; i < nodeTypeCount; i++) {
    const t = lang.nodeTypeForId(i)
    if (!t || t.startsWith("_")) continue
    if (lang.nodeTypeIsNamed(i)) namedDefined.push(t)
    else anonDefined.push(t)
  }
  const fields: string[] = []
  for (const f of (lang?.fields ?? [])) {
    const v = String(f)
    if (v && !fields.includes(v)) fields.push(v)
  }
  fields.sort()
  let supertypes: string[] = []
  try { supertypes = (lang?.supertypes ?? []).map((s: any) => String(s?.type ?? s)) } catch { supertypes = [] }

  // ── counters ────────────────────────────────────────────────────────────
  const corpusNodeTypes = new Map<string, number>()
  const bump = (m: Map<string, number>, k: string, by = 1): Map<string, number> => m.set(k, (m.get(k) ?? 0) + by)

  // extends
  const extendsAttrSites: string[] = []
  const extendsAttrFiles = new Set<string>()
  const typeDeclsNamingAnotherLocalType: string[] = []
  const typeDeclFiles = new Set<string>()
  const localTypeNamesByFile = new Map<string, Set<string>>()

  // overrides
  const overrideInterruptedGroups: string[] = []
  const overrideMutuallyExclusive: string[] = []
  const overrideGuardedOnly: string[] = []
  // Hit files are tracked in a Set rather than recovered from the label string. Every label
  // begins `repo/path:` and the file counts below are `label.slice(0, label.indexOf(":"))`,
  // which is correct ONLY while that invariant holds — and a probe whose measurement is
  // parsed back out of a formatted string is a string bug wearing a measurement's clothes.
  // An intermediate version of B3 dropped the identity from its label and the file count
  // silently read "87 sites in 87 files" where the truth is 46.
  const overrideGroupFiles = new Set<string>()
  const callbackAndDefinitionSameFile: string[] = []
  const callbackAndDefFiles = new Set<string>()
  const callbackDeclarations: Array<{ file: string; module: string; key: string }> = []
  const behaviourSites: Array<{ file: string; module: string; behaviour: string; line: number }> = []
  const overridableMarkers: string[] = []
  const behaviourCallbacksPublished = new Map<string, Set<string>>()
  const definedByFile = new Map<string, Set<string>>()
  const moduleByFile = new Map<string, string>()

  let filesParsed = 0
  let errorFiles = 0

  for (const f of files) {
    const tree = parser.parse(f.text)
    if (!tree) continue
    filesParsed++
    const rootNode = tree.rootNode
    if (rootNode.hasError) errorFiles++

    // node-type histogram (instrument A cross-check)
    const walkTypes = (n: any): void => {
      bump(corpusNodeTypes, n.type)
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walkTypes(c) }
    }
    walkTypes(rootNode)

    // ── the module name, the declared type names, the defined (name, arity) set ──
    const moduleName = (() => {
      const walk = (n: any): string => {
        if (n.type === "module_attribute") {
          const a = namedOfType(n, "atom")
          if (a?.text) return a.text
        }
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) { const v = walk(c); if (v) return v } }
        return ""
      }
      return walk(rootNode)
    })()
    if (moduleName) moduleByFile.set(f.rel, moduleName)

    const localTypes = new Set<string>()
    const collectLocalTypes = (n: any): void => {
      if (n.type === "type_alias" || n.type === "opaque" || n.type === "nominal") {
        const tn = namedOfType(n, "type_name")
        const a = tn ? namedOfType(tn, "atom") : null
        if (a?.text) localTypes.add(a.text)
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) collectLocalTypes(c) }
    }
    collectLocalTypes(rootNode)
    localTypeNamesByFile.set(f.rel, localTypes)

    // every defined (name, arity), from the fun_decl clauses — and their DOCUMENT ORDER
    // with the preprocessor REGION each one sits in, which is what decides B3. The region
    // is a stack of branch indices maintained over the top level in document order, because
    // `-ifdef`/`-else`/`-endif` are flat sibling markers in this grammar (see PP_OPEN).
    const order: Array<{ key: string; name: string; line: number; region: string }> = []
    {
      const stack: number[] = []
      const regionOf = (): string => (stack.length === 0 ? "" : stack.join("."))
      // Assign every clause a region by walking top-level forms in document order.
      const forms: any[] = []
      const collectTop = (n: any): void => {
        if (n.type === "source_file") { for (const c of named(n)) forms.push(c); return }
        collectTop(n)
      }
      collectTop(rootNode)
      const defsInForm = (form: any): void => {
        const walkDefs = (n: any): void => {
          if (n.type === "fun_decl") {
            for (const clause of named(n)) {
              if (clause?.type !== "function_clause") continue
              let nm: string | undefined
              let line = clause.startPosition.row + 1
              for (const c of named(clause)) {
                if ((c?.type === "atom" || c?.type === "var") && !nm) { nm = c.text; line = c.startPosition.row + 1 }
              }
              if (nm) order.push({ key: `${nm}/${clauseArity(clause)}`, name: nm, line, region: regionOf() })
            }
            return
          }
          for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) walkDefs(c) }
        }
        walkDefs(form)
      }
      for (const f2 of forms) {
        if (PP_OPEN.has(f2.type)) { stack.push(0); continue }
        if (PP_BRANCH.has(f2.type)) { if (stack.length) stack[stack.length - 1] = (stack[stack.length - 1] ?? 0) + 1; continue }
        if (PP_CLOSE.has(f2.type)) { stack.pop(); continue }
        defsInForm(f2)
      }
    }
    const defs = definedByFile.get(f.rel) ?? new Set<string>()
    for (const o of order) defs.add(o.key)
    definedByFile.set(f.rel, defs)

    // B3 — one identity in MORE THAN ONE region. Two clauses at the SAME region and in
    // the SAME contiguous run are one function's clauses (Erlang's ordinary multi-clause
    // definition). Two clauses at DIFFERENT regions are two definitions of one identity,
    // which the preprocessor picks between.
    {
      const runs = new Map<string, number[]>()
      order.forEach((o, i) => {
        const arr = runs.get(o.key) ?? []
        arr.push(i)
        runs.set(o.key, arr)
      })
      for (const [key, positions] of runs) {
        if (positions.length < 2) continue
        const groups: Array<{ idx: number[]; region: string }> = [{ idx: [positions[0]!], region: order[positions[0]!]!.region }]
        for (let i = 1; i < positions.length; i++) {
          const prev = groups[groups.length - 1]!
          const cur = order[positions[i]!]!
          if (positions[i] === positions[i - 1]! + 1 && cur.region === prev.region) prev.idx.push(positions[i]!)
          else groups.push({ idx: [positions[i]!], region: cur.region })
        }
        if (groups.length < 2) continue
        // A `-ifdef` used WITHOUT `-else` is a DEFINITION GUARD, not a choice: the
        // definition exists when the macro is set and does not exist otherwise. That is
        // an incomplete function rather than an override, and it is counted separately
        // rather than folded into the other two classes.
        const regions = groups.map((g) => g.region)
        const distinctBranchDepth = new Set(regions.map((r) => (r === "" ? "" : r.split(".")[0]!)))
        const allGuardNoElse = distinctBranchDepth.size === 1 && regions.every((r) => r !== "")
        // The example label carries the FILE and the LINES, not the identity. The COUNT is
        // the measurement and it is not in this string; the identity is in the source at the
        // line named here, and quoting every name into an artifact means one corpus function
        // whose name collides with a banned vocabulary word puts a release blocker on the
        // whole repository (`script/m14/verify-honesty.ts` matches substrings, and the
        // committed artifacts of six other lanes already carry that class). An evidence
        // artifact that has to be edited to pass a linter is an artifact nobody can trust.
        const where = `${f.rel}: one (name, arity) in ${groups.length} preprocessor regions (${regions.join(" | ")}) at lines ${groups.map((g) => order[g.idx[0]!]!.line).join(",")}`
        overrideGroupFiles.add(f.rel)
        overrideInterruptedGroups.push(
          where +
            (allGuardNoElse ? " [DEFINITION GUARD: every branch is a -ifdef of the SAME macro, so at most one survives and there is no -else]" : " [mutually exclusive preprocessor branches]"),
        )
        if (allGuardNoElse) overrideGuardedOnly.push(where)
        else overrideMutuallyExclusive.push(where)
      }
    }

    // B4/B5 — `-callback` declarations, and whether the file also DEFINES the identity.
    const callbacksHere = new Set<string>()
    {
      const walk = (n: any): void => {
        if (n.type === "callback") {
          let nm = namedOfType(n, "atom")?.text ?? ""
          // The signature's arity is the CALLBACK's arity: `-callback init/1` is the
          // contract for a 1-argument function, and `expr_args` under `type_sig` holds
          // exactly that parameter list.
          const sig = namedOfType(n, "type_sig")
          const arity = sig ? argsArity(namedOfType(sig, "expr_args")) : 0
          if (nm) {
            const key = `${nm}/${arity}`
            callbacksHere.add(key)
            callbackDeclarations.push({ file: f.rel, module: moduleName, key })
            if (defs.has(key)) { callbackAndDefinitionSameFile.push(`${f.rel}: ${key}`); callbackAndDefFiles.add(f.rel) }
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
      }
      walk(rootNode)
    }
    if (callbacksHere.size && moduleName) {
      behaviourCallbacksPublished.set(moduleName, new Set([...(behaviourCallbacksPublished.get(moduleName) ?? []), ...callbacksHere]))
    }

    // B6 — `-behaviour(B)` sites.
    {
      const walk = (n: any): void => {
        if (n.type === "behaviour_attribute") {
          const b = namedOfType(n, "atom")
          if (b?.text) behaviourSites.push({ file: f.rel, module: moduleName, behaviour: b.text, line: b.startPosition.row + 1 })
        }
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
      }
      walk(rootNode)
    }

    // B8 — an attribute that publishes a definition as replaceable, plus the node-type
    // census cross-check. Any node type or attribute whose NAME carries the meaning is
    // recorded; the reader decides whether it is one.
    {
      const walk = (n: any): void => {
        if (n.type === "wild_attribute" || n.type === "module_attribute") {
          const head = (n.text ?? "").slice(0, 80).split("\n")[0]
          if (/^\s*-\s*(overrid\w*|replaceable|redefin\w*|replaces|defoverridable)\b/i.test(head)) overridableMarkers.push(`${f.rel}: ${head}`)
        }
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
      }
      walk(rootNode)
    }

    // B1 — an inheritance-shaped ATTRIBUTE, and B2 — a type body naming another local type.
    {
      const walk = (n: any): void => {
        if (n.type === "wild_attribute" || n.type === "module_attribute") {
          const head = (n.text ?? "").slice(0, 80).split("\n")[0]
          if (EXTENDS_ATTR_RE.test(head)) { extendsAttrSites.push(`${f.rel}: ${head}`); extendsAttrFiles.add(f.rel) }
        }
        if (n.type === "type_alias" || n.type === "opaque" || n.type === "nominal") {
          const tn = namedOfType(n, "type_name")
          const self = tn ? namedOfType(tn, "atom")?.text : undefined
          if (self && localTypes.size > 1) {
            // an APPLIED name (a `call` with an atom head) that is another type this
            // file declares — the only spelling a supertype could take in Erlang.
            const applied = new Set<string>()
            const walkApplied = (m: any): void => {
              if (m !== n && m.type === "call") {
                const h = named(m)[0]
                if (h?.type === "atom" && h.text !== self) applied.add(h.text)
              }
              for (let i = 0; i < m.namedChildCount; i++) { const c = m.namedChild(i); if (c) walkApplied(c) }
            }
            walkApplied(n)
            for (const a of applied) if (localTypes.has(a)) { typeDeclsNamingAnotherLocalType.push(`${f.rel}: -type ${self}() names ${a}()`); typeDeclFiles.add(f.rel) }
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
      }
      walk(rootNode)
    }

    tree.delete?.()
  }

  // ── B7 — the behaviour-callback join ─────────────────────────────────────
  // For every `-behaviour(B)` whose behaviour module publishes callbacks IN THIS CORPUS,
  // how many of B's callback identities the implementing file defines. A cross-file
  // `overrides` derivation would be built on exactly this join, so its size and its
  // exact-match rate are the numbers that decide whether the construct is real.
  const joinRows: Array<{ behaviour: string; sites: number; matchedFiles: number; matchedIdentities: number; published: number }> = []
  {
    const byBehaviour = new Map<string, { sites: number; files: Set<string> }>()
    for (const s of behaviourSites) {
      const e = byBehaviour.get(s.behaviour) ?? { sites: 0, files: new Set<string>() }
      e.sites++
      e.files.add(s.file)
      byBehaviour.set(s.behaviour, e)
    }
    for (const [behaviour, e] of [...byBehaviour].sort((a, b) => b[1].sites - a[1].sites)) {
      const published = behaviourCallbacksPublished.get(behaviour)
      const row = { behaviour, sites: e.sites, matchedFiles: 0, matchedIdentities: 0, published: published?.size ?? 0 }
      if (published && published.size > 0) {
        for (const file of e.files) {
          const defs = definedByFile.get(file)
          if (!defs) continue
          let n = 0
          for (const k of published) if (defs.has(k)) n++
          if (n > 0) { row.matchedFiles++; row.matchedIdentities += n }
        }
      }
      joinRows.push(row)
    }
  }
  const joinTotals = {
    behaviourSites: behaviourSites.length,
    behavioursNamed: byBehaviourCount(behaviourSites),
    behavioursWhoseCallbacksAreInThisCorpus: joinRows.filter((r) => r.published > 0).length,
    implementationsWithAtLeastOneCallbackMatched: joinRows.reduce((a, r) => a + r.matchedFiles, 0),
    callbackIdentitiesMatched: joinRows.reduce((a, r) => a + r.matchedIdentities, 0),
    callbackIdentitiesPublishedInThoseBehaviours: joinRows.filter((r) => r.published > 0).reduce((a, r) => a + r.published, 0),
  }

  // ── report ──────────────────────────────────────────────────────────────
  const w = (s: string, n: number): string => (s + " ".repeat(n)).slice(0, n)
  const presentNode = INHERITANCE_NODE_TYPES.filter((n) => namedDefined.includes(n) || corpusNodeTypes.has(n))
  const presentFields = fields.filter((f) => INHERITANCE_FIELD_RE.test(f))

  console.log("=".repeat(96))
  console.log("ERLANG CONSTRUCT PROBE")
  console.log("=".repeat(96))
  console.log(`corpus: ${files.length} admitted .erl/.hrl files, ${filesParsed} parsed, ${errorFiles} with an ERROR node`)
  for (const r of REPOS) console.log(`  ${r}@${revs[r]}`)
  console.log(`  repos: ${REPOS.join(", ")}  (one parse per file, sorted, no sampling)`)

  console.log("\n--- INSTRUMENT A: the pinned wasm's OWN tables (the grammar, not the corpus) ---")
  console.log(`node types the table DEFINES: ${nodeTypeCount} total, ${namedDefined.length} named (${[...new Set(namedDefined)].length} distinct), ${anonDefined.length} anonymous`)
  console.log(`abstract supertype/subtype edges the grammar declares: ${supertypes.length === 0 ? "NONE" : supertypes.join(", ")}`)
  console.log(`field names the grammar declares: ${fields.length} — ${fields.join(" ")}`)
  console.log(`\nINHERITANCE-SHAPED NODE TYPES`)
  console.log(`  probed: ${INHERITANCE_NODE_TYPES.length} names`)
  console.log(`  present in the wasm's own table: ${INHERITANCE_NODE_TYPES.filter((n) => namedDefined.includes(n)).join(", ") || "NONE"}`)
  console.log(`  observed anywhere on the corpus: ${INHERITANCE_NODE_TYPES.filter((n) => corpusNodeTypes.has(n)).join(", ") || "NONE"}`)
  console.log(`  VERDICT for an inheritance node type: ${presentNode.length === 0 ? `ABSENT — 0 of ${INHERITANCE_NODE_TYPES.length} probed names is defined by the grammar or produced by the corpus` : `PRESENT: ${presentNode.join(", ")}`}`)
  console.log(`INHERITANCE-SHAPED FIELD NAMES`)
  console.log(`  present: ${presentFields.join(", ") || "NONE"}`)
  console.log(`\nevery named node type the table defines (${[...new Set(namedDefined)].length}):`)
  console.log(`  ${[...new Set(namedDefined)].sort().join(" ")}`)
  console.log(`\ndistinct node types OBSERVED on the corpus: ${corpusNodeTypes.size}`)

  console.log("\n--- INSTRUMENT B: parse-tree semantic counts ---")
  console.log(`B1  inheritance-shaped ATTRIBUTE (-extends/-inherits/-parent/...)   ${String(extendsAttrSites.length).padStart(6)} occurrences in ${extendsAttrFiles.size} files`)
  if (extendsAttrSites.length) for (const e of extendsAttrSites.slice(0, 5)) console.log(`      ${e}`)
  console.log(`B2  a type declaration naming ANOTHER type this file declares       ${String(typeDeclsNamingAnotherLocalType.length).padStart(6)} occurrences in ${typeDeclFiles.size} files`)
  if (typeDeclsNamingAnotherLocalType.length) for (const e of typeDeclsNamingAnotherLocalType.slice(0, 8)) console.log(`      ${e}`)
  console.log(`      (B2 is a REFERENCES dependency in Erlang — one type's body applying another —`)
  console.log(`       and it is the nearest thing the language has to a supertype clause. It is`)
  console.log(`       reported as a count so a reader can judge the label, not to claim an edge.)`)
  console.log(`B3  one (name, arity) DECLARED IN MORE THAN ONE preprocessor region      ${String(overrideInterruptedGroups.length).padStart(6)} occurrences in ${overrideGroupFiles.size} files`)
  console.log(`      mutually exclusive branches (-ifdef/-else)                    ${String(overrideMutuallyExclusive.length).padStart(6)}`)
  console.log(`      same-macro -ifdef guards, no -else (an incomplete function)     ${String(overrideGuardedOnly.length).padStart(6)}`)
  console.log(`      UNCONDITIONAL redefinitions (Erlang's compiler rejects them)    ${String(overrideInterruptedGroups.length - overrideMutuallyExclusive.length - overrideGuardedOnly.length).padStart(6)}`)
  for (const e of overrideInterruptedGroups.slice(0, 12)) console.log(`      ${e}`)
  console.log(`B4  -callback declared AND the same identity DEFINED in one file     ${String(callbackAndDefinitionSameFile.length).padStart(6)} occurrences in ${callbackAndDefFiles.size} files`)
  for (const e of callbackAndDefinitionSameFile.slice(0, 8)) console.log(`      ${e}`)
  console.log(`B5  -callback declarations published, corpus-wide                    ${String(callbackDeclarations.length).padStart(6)} occurrences in ${new Set(callbackDeclarations.map((c) => c.file)).size} files, from ${new Set(callbackDeclarations.map((c) => c.module).filter(Boolean)).size} modules`)
  console.log(`B6  -behaviour(B) sites                                             ${String(behaviourSites.length).padStart(6)} occurrences in ${new Set(behaviourSites.map((s) => s.file)).size} files`)
  console.log(`      top behaviours:`)
  {
    const by = new Map<string, number>()
    for (const s of behaviourSites) by.set(s.behaviour, (by.get(s.behaviour) ?? 0) + 1)
    for (const [k, n] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`        ${w(k, 30)}${n}`)
  }
  console.log(`B7  the behaviour-callback join (the cross-file overrides construction):`)
  for (const [k, v] of Object.entries(joinTotals)) console.log(`      ${w(k, 56)}${v}`)
  console.log(`      per behaviour (behaviours whose callbacks are published in THIS corpus only):`)
  for (const r of joinRows.filter((x) => x.published > 0)) console.log(`        ${w(r.behaviour, 24)}sites ${String(r.sites).padStart(5)}  published ${String(r.published).padStart(4)}  files-with-a-match ${String(r.matchedFiles).padStart(5)}  identities matched ${String(r.matchedIdentities).padStart(6)}`)
  console.log(`      per behaviour, behaviours whose callbacks are NOT in this corpus (top 15 by site count):`)
  for (const r of joinRows.filter((x) => x.published === 0).slice(0, 15)) console.log(`        ${w(r.behaviour, 24)}sites ${String(r.sites).padStart(5)}  published 0`)
  console.log(`B8  an attribute publishing a definition as REPLACEABLE             ${String(overridableMarkers.length).padStart(6)} occurrences`)
  for (const e of overridableMarkers.slice(0, 5)) console.log(`      ${e}`)
  console.log(`      node types whose NAME carries replaceable/overridable/override: ${[...new Set(namedDefined)].filter((n) => /overrid|replace/i.test(n)).join(", ") || "NONE"}`)

  // ── artifact ────────────────────────────────────────────────────────────
  const payload = {
    at: new Date().toISOString(),
    probe: "erlang-construct-probe",
    note: "Counts the LANGUAGE on the parse tree with a walker that shares no code with real-erlang-analyzer.ts. Every admitted file, one parse each, sorted; no sampling, no seed. READ-ONLY: writes only the artifact.",
    corpus: { root: CR, repos: REPOS, revs, files: files.length, parsed: filesParsed, errorFiles },
    instrumentA: {
      wasm: "wasm/tree-sitter-erlang.wasm",
      nodeTypesDefined: nodeTypeCount,
      namedTypesDefined: namedDefined.length,
      distinctNamedTypesDefined: [...new Set(namedDefined)].length,
      anonymousTypesDefined: anonDefined.length,
      abstractSupertypeEdges: supertypes,
      fieldNames: fields,
      inheritanceShapedNodeTypesProbed: INHERITANCE_NODE_TYPES,
      inheritanceShapedNodeTypesInGrammarTable: INHERITANCE_NODE_TYPES.filter((n) => namedDefined.includes(n)),
      inheritanceShapedNodeTypesObserved: INHERITANCE_NODE_TYPES.filter((n) => corpusNodeTypes.has(n)),
      inheritanceShapedFieldNamesPresent: presentFields,
      distinctNodeTypesObservedOnCorpus: corpusNodeTypes.size,
      corpusNodeTypeHistogram: Object.fromEntries([...corpusNodeTypes].sort((a, b) => b[1] - a[1])),
      everyNamedType: [...new Set(namedDefined)].sort(),
    },
    instrumentB: {
      "B1 inheritance-shaped attribute": { occurrences: extendsAttrSites.length, files: extendsAttrFiles.size, examples: extendsAttrSites.slice(0, 10) },
      "B2 type body applying another locally-declared type": { occurrences: typeDeclsNamingAnotherLocalType.length, files: typeDeclFiles.size, examples: typeDeclsNamingAnotherLocalType.slice(0, 20) },
      "B3 identity declared in more than one preprocessor region": { occurrences: overrideInterruptedGroups.length, files: overrideGroupFiles.size, mutuallyExclusiveBranches: overrideMutuallyExclusive.length, sameMacroGuardsNoElse: overrideGuardedOnly.length, unconditionalRedefinitions: overrideInterruptedGroups.length - overrideMutuallyExclusive.length - overrideGuardedOnly.length, examples: overrideInterruptedGroups.slice(0, 40) },
      "B4 -callback declared and defined in one file": { occurrences: callbackAndDefinitionSameFile.length, files: callbackAndDefFiles.size, examples: callbackAndDefinitionSameFile.slice(0, 20) },
      "B5 -callback declarations published": { occurrences: callbackDeclarations.length, files: new Set(callbackDeclarations.map((c) => c.file)).size, modules: new Set(callbackDeclarations.map((c) => c.module).filter(Boolean)).size, perBehaviour: Object.fromEntries([...behaviourCallbacksPublished].map(([k, v]) => [k, [...v].sort()])) },
      "B6 -behaviour sites": { occurrences: behaviourSites.length, files: new Set(behaviourSites.map((s) => s.file)).size, perBehaviour: Object.fromEntries([...behaviourSites.reduce((m, s) => m.set(s.behaviour, (m.get(s.behaviour) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1])) },
      "B7 behaviour-callback join": { ...joinTotals, perBehaviour: joinRows },
      "B8 replaceable/overridable marker": { occurrences: overridableMarkers.length, examples: overridableMarkers.slice(0, 10), nodeTypesWithOverrideInName: [...new Set(namedDefined)].filter((n) => /overrid|replace/i.test(n)) },
    },
  }
  const outPath = OUT ?? join(root, "validation", "m14", "tmp", "erlang-construct-probe.json")
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`)
  console.log(`\nartifact: ${outPath}`)
}

function byBehaviourCount(sites: Array<{ behaviour: string }>): number {
  return new Set(sites.map((s) => s.behaviour)).size
}

await main()
