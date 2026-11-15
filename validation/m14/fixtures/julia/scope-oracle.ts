/**
 * SCOPE ORACLE — how many ambiguous targets JULIA'S OWN NAME RESOLUTION decides, and whether
 * the store picks the one it decides.
 * ------------------------------------------------------------------------
 * ## The question this file exists to answer
 *
 * The lane's ambiguity split (`ambiguity-split.ts`, record
 * `validation/m14/measurements/julia-ambiguity-before.json`) establishes **19,938** edges of the
 * 70,959 measured on the pinned 600 whose target name binds to more than one published symbol,
 * and the attribution partition establishes that **16,608 of those 19,938 (83.3%)** are
 * attributed by a rule nobody chose. Both numbers are about AMBIGUITY. Neither is about being
 * WRONG, and the distinction is not cosmetic: `ambiguous` is a property of the name table,
 * `wrong` is a property of one edge.
 *
 * So this file asks the question the two existing instruments cannot:
 *
 *   1. **Reach** — for how many of the 19,938 does the language itself supply an answer? Julia's
 *      name resolution is deterministic given (a) the `module` block enclosing the reference
 *      site and (b) the `using`/`import` set of that module. Both are stated in the parse tree
 *      the analyzer already walks, so the answer is derivable without shipping anything.
 *   2. **Accuracy** — of the edges the language decides, how many does
 *      `src/ast/parallel-indexer.ts:2239` already attribute to that declaration? That is a
 *      defect count, and it is the number no instrument in this lane has produced.
 *
 * Two numbers, same population, same instrument. The gap between them is the ambiguity count
 * overstating the defect count, which is exactly the overstatement the split already flagged for
 * its own `forced` arm (3,330 edges) but never priced across all ten types.
 *
 * ## The rule, stated so it can be disagreed with
 *
 * A bare name `T` written at a site in file F resolves in julia like this:
 *
 *   - if the site is inside `module M` and M declares `T`, `T` is **M's binding**. Every other
 *     declaration of `T` anywhere in the corpus is irrelevant to that site. This is the load-
 *     bearing step and it is why an edge can be decidable while its name table is ambiguous.
 *   - if M does not declare `T`, `T` comes from M's `using`/`import` set, and only if exactly one
 *     of those modules declares it. Two such modules is an ambiguity **in the language** — julia
 *     raises on the use — so it is reported as its own arm rather than resolved.
 *   - if the site is inside NO `module`, the file's top level is not a namespace at all: it binds
 *     into whatever module `include`s the file. That is the corpus's dominant shape, and
 *     `julia/base/Base.jl` (651 lines) is the proof in the corpus itself — it declares no
 *     `module` because it is included INTO `Base`.
 *
 * ## Section two: the include graph, and what it costs
 *
 * The third case is 77% of the ambiguous population, and it is the only one a lane-owned change
 * could still reach — so it is not left as an arm. `include("x.jl")` is a CALL whose argument is a
 * string literal, so the include graph is IN the parse tree, and section two reads it by node type
 * and then asks, for each including site, which module encloses the CALL's line. A file's owner
 * module is that answer, walked up the graph. The same scoping rules then run through it, and the
 * arms it produces (`viaInclude*`) are printed beside the arm they replaced.
 *
 * What it does NOT do: resolve an include target to a file outside the sample, resolve
 * `Base.include(f, "x.jl")` (two arguments — the target is position-dependent), or resolve
 * `include(some_var)`. Each refusal is counted in the printed `include sites` block, so the
 * resolution rate of the lever is a measured number and not an assumption.
 *
 * Module IDENTITY is `file + module name`, not the name alone. Two files each writing `module
 * Foo` are two different `Foo`s unless one includes the other, and the parse tree does not
 * state which. Collapsing on the bare name would resolve more edges and be wrong.
 *
 * ## What this oracle CANNOT see — declared before the numbers, not after
 *
 * 1. **Shadowing.** Inside `function f`, a local `T` shadows `M.T`, and this lane deliberately
 *    publishes no local bindings (21,693 corpus-wide). So `scopedUnique` names `M.T` for a site
 *    whose real answer may be a local. This file does not guess: it counts the edges whose site
 *    sits inside a function or macro body — the shadow-capable population — and reports that
 *    count beside `scopedUnique`, so the oracle's answer is read with its own error bar. The
 *    lane doc's precondition for `Owner.name` emission (21,693 shadow-capable bindings) is the
 *    same fact, and this is its first per-edge accounting.
 * 2. **Cross-file module identity.** Section two resolves the owner module of a file through the
 *    include graph, so this limitation is now bounded rather than open: it applies to the
 *    `viaIncludeNoOwner` and `viaIncludeNotDeclared` arms only, and only for the reasons the
 *    `include sites` block prints. A file nobody in the sample includes has no owner module and no
 *    amount of lane work supplies one — the corpus root, not the package graph, is what is missing.
 * 3. **Macro-expanded code.** A name a macro generates is not in the tree.
 *
 * ## The two resolver statements, replayed not estimated
 *
 * `src/ast/parallel-indexer.ts:3500` dispatches on the type, so the oracle scores each edge
 * against the statement that edge actually gets:
 *
 *     relType === "contains" && relLine !== null ? resolveContainsTargetStmt : resolveTargetStmt
 *
 * `COALESCE(s.is_declaration,0)` is dropped from BOTH replays, and that is ASSERTED at runtime
 * rather than assumed: `validation/m14/fixtures/julia/store-target-resolution.ts` established
 * that 0 of 10,681 published symbols carry `isDeclaration`, and this file re-checks it on its
 * own population and exits 2 if it is no longer 0 — at which point every number here is stale.
 *
 * Leaf extraction replays the store's `extractLeaf` by string splitting, never by pattern, and
 * so does the `s.id` text comparison (`${fileId}:${name}:${line}`, compared as TEXT — which is
 * why `constructor:227` beats `constructor:25`).
 *
 * ## Population
 *
 * The `sampleList` of `validation/m14/measurements/julia-ambiguity-before.json` — 600 files,
 * sampleHash `1c76a52a3ba9c16c`, stride 3 — read from the committed record rather than
 * re-sampled, so this file, the split, and `store-target-resolution.ts` are provably the same
 * population and the three are comparable to the digit.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/julia/scope-oracle.ts [--json out.json] [--files N]
 *
 * `--files N` takes the first N of that list for a fast self-test and is NOT a whole-population
 * figure; the record carries `isWholeSample` so the two cannot be confused.
 *
 * READ-ONLY with respect to the corpus.
 */
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import * as wts from "web-tree-sitter"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const argv = process.argv.slice(2)
const jsonIdx = argv.indexOf("--json")
const jsonOut = jsonIdx >= 0 ? argv[jsonIdx + 1] : null
const filesIdx = argv.indexOf("--files")
const FILE_LIMIT = filesIdx >= 0 && argv[filesIdx + 1] ? Number(argv[filesIdx + 1]) : null

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const RECORD = path.join(process.cwd(), "validation/m14/measurements/julia-ambiguity-before.json")
const record = JSON.parse(readFileSync(RECORD, "utf8"))
const sampleList: string[] = record.sampleList as string[]
const REPO_PREFIX = "/repositories/"
const labelOf = (abs: string): string => abs.slice(abs.indexOf(REPO_PREFIX) + REPO_PREFIX.length)

const WIDTH = Number(process.env.BB_JULIA_WORKERS ?? 1)
/** The size ceiling ambiguity-split.ts:128 admits under. Re-stated here so the admitted list is the
 *  SAME population the record describes, not a plausible neighbour of it. */
const MAX_ADMITTED_BYTES = 512 * 1024
const TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
]

interface Admitted { abs: string; label: string; repo: string; rel: string; bytes: number }

/**
 * The admitted corpus list, rebuilt with the rule `ambiguity-split.ts:130-176` states: git-tracked,
 * `.jl`, <=512KB, and the production `detectLanguageFromPath` says julia; sorted by `repo/rel`.
 *
 * The record carries `admittedFiles: 1985` and `corpusHash` but NOT the list itself — only
 * `sampleList`, the 600-file stride sample. So this rebuild is what makes a whole-corpus claim
 * checkable, and its sha256 is asserted against the record's: a mismatch exits 2 rather than
 * reporting a whole-corpus number over a population the record does not describe.
 */
const rebuildAdmitted = (): Admitted[] => {
  const out: Admitted[] = []
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
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0")
        .filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) {
      if (!rel.endsWith(".jl")) continue
      const abs = path.join(dir, rel)
      let st: ReturnType<typeof statSync>
      try {
        st = statSync(abs)
        if (st.size > MAX_ADMITTED_BYTES) continue
        if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) !== "julia") continue
      } catch {
        continue
      }
      out.push({ abs, label: labelOf(abs), repo: e, rel, bytes: st.size })
    }
  }
  out.sort((a, b) => {
    const x = `${a.repo}/${a.rel}`
    const y = `${b.repo}/${b.rel}`
    return x < y ? -1 : x > y ? 1 : 0
  })
  const hash = createHash("sha256")
    .update(out.map((f) => `${f.repo}/${f.rel}:${f.bytes}`).join("\n"))
    .digest("hex")
    .slice(0, 16)
  if (hash !== record.corpusHash || out.length !== record.admittedFiles) {
    console.error(
      `FATAL: rebuilt admitted corpus ${out.length} files hash ${hash}; the record says ` +
        `${record.admittedFiles} files hash ${record.corpusHash}. Whole-corpus numbers would be about a ` +
        `population the record does not describe.`,
    )
    process.exit(2)
  }
  return out
}

const admittedAll = rebuildAdmitted()
const WHOLE = argv.includes("--whole-corpus")
const walkedAll = WHOLE ? admittedAll : sampleList.map((abs) => ({ abs, label: labelOf(abs) }))
const files = (FILE_LIMIT ? walkedAll.slice(0, FILE_LIMIT) : walkedAll).map((f) => ({ abs: f.abs, label: f.label }))
/** What the arm table's population is: the pinned sample, or the whole admitted corpus. */
const POPULATION = WHOLE ? "whole-admitted-corpus" : "pinned-sample"

interface Cand {
  label: string
  name: string
  kind: string
  startLine: number
  endLine: number
  id: string
  /** Identity of the `module` block this declaration sits in, or `NONE`. `file + name`, never name alone. */
  moduleKey: string
  moduleName: string
}
interface Rel {
  label: string
  type: string
  target: string
  line: number
}

/** The store's `extractLeaf` (`parallel-indexer.ts:3393`), by splitting — never by pattern. */
const extractLeaf = (name: string): string => {
  const noLine = hasTrailingDigits(name, ":") ? name.slice(0, name.lastIndexOf(":")) : name
  const noArity = hasTrailingDigits(noLine, "/") ? noLine.slice(0, noLine.lastIndexOf("/")) : noLine
  const lastColon = noArity.split(":").pop() ?? noArity
  return lastColon.split(".").pop() ?? lastColon
}
function hasTrailingDigits(s: string, sep: string): boolean {
  if (!s.endsWith(sep)) return false
  const tail = s.slice(0, s.length - sep.length)
  if (tail.length === 0) return false
  for (let i = tail.length - 1; i >= 0; i--) {
    const c = tail.charCodeAt(i)
    if (c < 48 || c > 57) return false
  }
  return true
}

/** `resolveTargetStmt` (:2239) — every type except `contains`. */
const genericWinner = (c: Cand[], referring: string): Cand =>
  [...c].sort((a, b) => {
    const af = a.label === referring ? 0 : 1
    const bf = b.label === referring ? 0 : 1
    if (af !== bf) return af - bf
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })[0]

/** `resolveContainsTargetStmt` (:2354) — `contains` only, with the line tier the store has. */
const lineWinner = (c: Cand[], referring: string, edgeLine: number): Cand =>
  [...c].sort((a, b) => {
    const af = a.label === referring ? 0 : 1
    const bf = b.label === referring ? 0 : 1
    if (af !== bf) return af - bf
    const al = a.startLine === edgeLine ? 0 : 1
    const bl = b.startLine === edgeLine ? 0 : 1
    if (al !== bl) return al - bl
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })[0]

/** A function or macro body is the only place a local binding can shadow a module-level name. */
const BODY_KINDS = new Set(["function", "method", "macro"])
const isModuleKind = (k: string): boolean => k === "module"

/**
 * Interned identity for a `module` block: (declaring file, module name) -> `m1`, `m2`, ...
 *
 * Two nested maps keyed on the pair, never a concatenated string. Concatenation needs a separator,
 * and every separator a reader can see is one julia already uses in a qualified name (`Foo.bar`,
 * `A.B`), so a key built that way can collide — two distinct modules would share an identity and the
 * one-namespace arms would count them as one. Interning cannot collide and needs no separator.
 */
const modIds = new Map<string, Map<string, string>>()
const modIdName = new Map<string, string>()
let modSeq = 0
const internModule = (label: string, name: string): string => {
  let byName = modIds.get(label)
  if (!byName) {
    byName = new Map<string, string>()
    modIds.set(label, byName)
  }
  const existing = byName.get(name)
  if (existing) return existing
  modSeq++
  const id = `m${modSeq}`
  byName.set(name, id)
  modIdName.set(id, name)
  return id
}

async function main(): Promise<void> {
  interface ModSpan { name: string; key: string; startLine: number; endLine: number }
  interface BodySpan { startLine: number; endLine: number }
  const moduleSpans = new Map<string, ModSpan[]>()
  const bodySpans = new Map<string, BodySpan[]>()
  const usingPaths = new Map<string, Set<string>>()
  const byName = new Map<string, Cand[]>()
  const rels: Rel[] = []
  const degraded: string[] = []
  const threw: string[] = []
  let symbols = 0
  let isDeclarationSymbols = 0
  let filesWithNoModule = 0

  let idx = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const i = idx++
      if (i >= files.length) return
      const f = files[i]
      let r: any
      try {
        r = await parseFile(f.abs, path.dirname(f.abs))
      } catch {
        threw.push(f.label)
        continue
      }
      if (!r) {
        threw.push(f.label)
        continue
      }
      if (r.fallback === true) degraded.push(f.label)

      const mods: ModSpan[] = []
      const bodies: BodySpan[] = []
      const syms: (Cand & { raw: any })[] = []
      for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
        const name = String((s as any)?.name ?? "")
        if (name.length === 0) continue
        symbols++
        if ((s as any)?.isDeclaration === true) isDeclarationSymbols++
        const startLine = Number((s as any)?.startLine ?? (s as any)?.range?.startLine ?? 0)
        const endLine = Number((s as any)?.endLine ?? (s as any)?.range?.endLine ?? startLine)
        const kind = String((s as any)?.kind ?? "")
        const c: Cand & { raw: any } = {
          label: f.label, name, kind, startLine, endLine,
          id: `${f.label}:${name}:${startLine}`,
          moduleKey: "NONE", moduleName: "", raw: s,
        }
        if (isModuleKind(kind)) mods.push({ name, key: "", startLine, endLine })
        if (BODY_KINDS.has(kind)) bodies.push({ startLine, endLine })
        syms.push(c)
      }
      for (const m of mods) m.key = internModule(f.label, m.name)
      moduleSpans.set(f.label, mods)
      bodySpans.set(f.label, bodies)
      if (mods.length === 0) filesWithNoModule++

      // Innermost module containing a line: the narrowest span that contains it. Ties cannot occur —
      // two `module` blocks with identical spans would be the same block.
      const moduleAt = (line: number): ModSpan | null => {
        let best: ModSpan | null = null
        for (const m of mods) {
          if (m.startLine <= line && line <= m.endLine) {
            if (!best || m.endLine - m.startLine < best.endLine - best.startLine) best = m
          }
        }
        return best
      }
      for (const c of syms) {
        const m = moduleAt(c.startLine)
        if (m) {
          c.moduleKey = m.key
          c.moduleName = m.name
        }
        const arr = byName.get(c.name)
        if (arr) arr.push(c)
        else byName.set(c.name, [c])
      }

      // `using`/`import` set of the FILE. Not of the enclosing module: `importTargets` publishes the
      // statement's module path and the statement's own position, so a per-module attribution would
      // be an inference. A file that `include`s another has no `using` for it at all — `include` is
      // a call, which is the second declared limitation.
      const ups = new Set<string>()
      for (const im of Array.isArray(r.imports) ? r.imports : []) {
        const p = String((im as any)?.path ?? "")
        if (p.length > 0 && !p.startsWith(".")) ups.add(p)
      }
      usingPaths.set(f.label, ups)

      for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
        const type = String((rel as any)?.type ?? (rel as any)?.relationshipType ?? "")
        if (!TYPES.includes(type)) continue
        rels.push({
          label: f.label,
          type,
          target: String((rel as any)?.target ?? ""),
          line: Number((rel as any)?.line_number ?? 0),
        })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, WIDTH) }, () => worker()))

  if (isDeclarationSymbols > 0) {
    console.error(
      `FATAL: ${isDeclarationSymbols} symbols carry isDeclaration. Both ORDER BY replays here drop the ` +
        `COALESCE(s.is_declaration,0) tier on the ground that it is constant for this lane. That ground is no ` +
        `longer true, so every number in this file is stale.`,
    )
    process.exit(2)
  }

  // ------------------------------------------------------------------ section two: the include graph
  //
  // `noModuleAtSite` is 77% of the ambiguous population and it is the ONLY arm a lane-owned change
  // could still reach, because 72.8% of the sampled files declare no `module` at all. In julia a
  // module-less file's top level binds into whatever module `include`s it, so the question is not
  // "which module block encloses this line" but "which module does the including file run in" — and
  // `include` is a CALL with a string argument, so the include graph IS in the parse tree.
  //
  // This section therefore prices that lever BEFORE anyone builds it: it resolves the owner module of
  // every module-less file through the include graph, then runs the same scoping rules through it. A
  // lever priced at 2% is not worth the analyzer change, and this file says so with the number rather
  // than after the fact.
  //
  // Tree navigation only — `include("x.jl")` is located by node type and its argument's node type,
  // never by matching source text. `web-tree-sitter` is loaded exactly as
  // `script/m14/ontology-coverage-gate.ts:324-328` loads it, with the same wasm.
  const WSP: any = (wts as any).Parser ?? (wts as any).default
  const WSL: any = (wts as any).Language ?? (wts as any).default?.Language
  await WSP.init({
    locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
  })
  const parser = new WSP()
  parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-julia.wasm"))))

  interface IncludeSite { includer: string; target: string; line: number }
  const includeSites: IncludeSite[] = []
  let includeCallsFound = 0
  let includeCallsRefused = 0
  let includeTreesParsed = 0
  let includeTreesThrew = 0

  const namedKids = (n: any): any[] => {
    const out: any[] = []
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) out.push(c)
    }
    return out
  }
  /** The literal inside a string node, or `null` when the string is interpolated (`include(p)`). */
  const unquote = (t: string): string | null => {
    const s = t.trim()
    if (s.length < 2) return null
    const q = s[0]
    if ((q !== '"' && q !== "'" && q !== "`") || s[s.length - 1] !== q) return null
    const inner = s.slice(1, -1)
    // An interpolated string is not a path; `string_literal` can still carry one, so the node's own
    // children decide rather than the text.
    return inner.includes("$") ? null : inner
  }

  /**
   * One tree pass over one file: its include SITES and its `module` block spans.
   *
   * Module spans are taken from the tree by node type (`module_definition`, which covers `module`
   * and `baremodule` alike — `src/ast/real-julia-analyzer.ts:469-482` maps both to
   * `SymbolKind.Module`). The sample path does NOT use them: there it uses the analyzer's own
   * published module symbols, so the oracle scores the store against the store. The closure pass
   * needs spans for files the analyzer never ran on, and the two are cross-checked — the printed
   * `closure` block reports how far they agree on the 600 files where both exist.
   */
  interface TreeFacts { sites: IncludeSite[]; mods: TreeMod[]; calls: number; refused: number }
  interface TreeMod { name: string; startLine: number; endLine: number }

  // The three failure modes are counted apart. A single "failed" counter cannot tell a grammar that
  // rejects a file from a read that ran out of descriptors, and those need different fixes.
  interface ScanFail { read: number; parseThrew: number; nullTree: number; examples: string[] }
  const newFail = (): ScanFail => ({ read: 0, parseThrew: 0, nullTree: 0, examples: [] })
  const scanFailed = (why: keyof ScanFail, abs: string, detail: string, into: ScanFail): null => {
    into[why] = (into[why] as number) + 1
    if (into.examples.length < 8) into.examples.push(`${why} ${labelOf(abs)}${detail ? ` :: ${detail}` : ""}`)
    return null
  }
  const scanFile = (abs: string, label: string, into: ScanFail): TreeFacts | null => {
    let text: string
    try { text = readFileSync(abs, "utf8") } catch (e) { return scanFailed("read", abs, (e as Error).message.slice(0, 100), into) }
    let tree: any
    try { tree = parser.parse(text) } catch (e) { return scanFailed("parseThrew", abs, (e as Error).message.slice(0, 100), into) }
    if (!tree) return scanFailed("nullTree", abs, "", into)
    const facts: TreeFacts = { sites: [], mods: [], calls: 0, refused: 0 }
    const walk = (n: any): void => {
      if (n.type === "module_definition") {
        const nameNode = n.childForFieldName ? n.childForFieldName("name") : null
        const nm = nameNode ? nameNode.text.trim() : ""
        if (nm.length > 0) facts.mods.push({ name: nm, startLine: n.startPosition.row + 1, endLine: n.endPosition.row + 1 })
      }
      if (n.type === "call_expression") {
        const kids = namedKids(n)
        const callee = kids[0]
        const argList = kids[1]
        // `Base.include(f, "x.jl")` is two-argument and its target is position-dependent, so only the
        // one-argument `include("x.jl")` form is read. Refusing the other is a refusal, and the count
        // of refusals is printed rather than folded into the resolution rate.
        const calleeIsInclude =
          !!callee && (callee.type === "identifier" ? callee.text.trim() === "include" : callee.text.trim().endsWith(".include"))
        if (calleeIsInclude) {
          facts.calls++
          // The callee's sibling is an `argument_list`, not the argument: measured on the corpus,
          // `include("utils.jl")` has named children `identifier, argument_list`, and the literal is
          // INSIDE the list. Reading `kids[1]` as the argument refuses every call in the corpus, so
          // the argument is taken from the list and its arity is required to be exactly one.
          const args = argList && argList.type === "argument_list" ? namedKids(argList) : []
          if (args.length !== 1) facts.refused++
          else if (args[0].type === "string_literal" || args[0].type === "string") {
            const raw = unquote(args[0].text)
            if (raw === null || raw.length === 0) facts.refused++
            else facts.sites.push({ includer: label, target: raw, line: n.startPosition.row + 1 })
          } else facts.refused++
        }
      }
      for (let i = 0; i < n.childCount; i++) walk(n.child(i))
    }
    walk(tree.rootNode)
    // Free the tree. It is the whole measurement, not a nicety, and the shape of it was measured
    // rather than guessed:
    //
    //   validation/m14/fixtures/julia/tree-lifetime-probe.ts, two arms in separate processes,
    //   three passes over all 1,985 admitted files, differing only in this call:
    //     retain  pass 1 1,985 parsed 0 threw rss 587 MB | pass 2 1,985/0, 641 MB | pass 3 57 parsed 1,928 threw, 649 MB
    //     free    pass 1 1,985 parsed 0 threw rss 124 MB | pass 2 1,985/0,  95 MB | pass 3 1,985/0,  78 MB
    //
    // 1,928 files parse in one arm and throw in the other, so a `parseThrew` here is a statement
    // about how many trees this process is still holding, not about the file. Without this line the
    // closure arm below loses its last ~105 files and reports the loss as a scan failure against a
    // record that prints `admittedFiles: 1985`.
    //
    // Safe to free here because `TreeFacts` holds only strings and numbers — sites, mods, calls,
    // refused — and no node reference escapes `walk`.
    try { tree.delete?.() } catch { /* the tree is already gone; the facts above are complete */ }
    return facts
  }

  const scanFailSample = newFail()
  const sampleFacts = new Map<string, TreeFacts>()
  for (const f of files) {
    const facts = scanFile(f.abs, f.label, scanFailSample)
    if (!facts) continue
    includeTreesParsed++
    includeCallsFound += facts.calls
    includeCallsRefused += facts.refused
    for (const site of facts.sites) includeSites.push(site)
    sampleFacts.set(f.label, facts)
  }

  // Resolve `include("x.jl")` to a sampled file. julia resolves relative to the INCLUDING file's
  // directory; the corpus's own idiom is relative-from-src (`include("Pkg/foo.jl")`), so the
  // including file's directory and one and two levels up are tried. A target that exists at two of
  // them is counted as ambiguous rather than silently taking the first — an include graph with a
  // guessed edge prices the lever wrong in the direction that flatters it.
  const labelToAbs = new Map<string, string>()
  for (const f of files) labelToAbs.set(f.label, f.abs)
  const repoPrefix = "/repositories/"
  const toLabel = (abs: string): string | null => {
    const i = abs.indexOf(repoPrefix)
    return i < 0 ? null : abs.slice(i + repoPrefix.length)
  }
  /** includer label -> the include SITES in that file, so the site's line can locate the enclosing module. */
  const includeOut = new Map<string, IncludeSite[]>()
  /** included label -> the (includer, line) pairs that include it. */
  const includedBy = new Map<string, { includer: string; line: number }[]>()
  let includeTargetsResolved = 0
  let includeTargetsUnresolved = 0
  let includeTargetsAmbiguous = 0
  for (const site of includeSites) {
    const incAbs = labelToAbs.get(site.includer)
    if (!incAbs) continue
    const dir = path.dirname(incAbs)
    const hits = new Set<string>()
    for (const candAbs of [path.resolve(dir, site.target), path.resolve(dir, "..", site.target), path.resolve(dir, "..", "..", site.target)]) {
      const lbl = toLabel(candAbs)
      if (lbl !== null && labelToAbs.has(lbl)) hits.add(lbl)
    }
    const arr = includeOut.get(site.includer)
    if (arr) arr.push(site)
    else includeOut.set(site.includer, [site])
    if (hits.size === 0) {
      includeTargetsUnresolved++
      continue
    }
    if (hits.size > 1) {
      includeTargetsAmbiguous++
      continue
    }
    includeTargetsResolved++
    const targetLabel = [...hits][0]
    const rev = includedBy.get(targetLabel)
    if (rev) rev.push({ includer: site.includer, line: site.line })
    else includedBy.set(targetLabel, [{ includer: site.includer, line: site.line }])
  }

  // OWNER MODULE of a file's top level: the module the file is `include`d INTO, which for a file
  // that declares no `module` is the only module it belongs to. Resolution walks up the include graph
  // and, at each step, asks for the module enclosing the `include` CALL's line in the including file —
  // so `include` inside `module Q` nested in `module P` lands in Q, which is what julia does.
  //
  // Every distinct answer is kept and compared. Two parents whose modules disagree are NOT resolved
  // to one of them; they are reported as disagreement, because picking either would be the guess this
  // instrument exists to avoid.
  const moduleAtLine = (label: string, line: number): ModSpan | null => {
    const mods = moduleSpans.get(label) ?? []
    let best: ModSpan | null = null
    for (const m of mods) {
      if (m.startLine <= line && line <= m.endLine) {
        if (!best || m.endLine - m.startLine < best.endLine - best.startLine) best = m
      }
    }
    return best
  }
  const ownerModule = new Map<string, string | null>()
  const ownerWhy = new Map<string, string>()
  const resolving = new Set<string>()
  const resolveOwner = (label: string): string | null => {
    const memo = ownerModule.get(label)
    if (memo !== undefined) return memo
    if (resolving.has(label)) {
      ownerWhy.set(label, "include cycle")
      return null
    }
    const parents = includedBy.get(label) ?? []
    if (parents.length === 0) {
      ownerModule.set(label, null)
      ownerWhy.set(label, "no include site in the sample")
      return null
    }
    resolving.add(label)
    const keys = new Set<string>()
    let viaCall = 0
    let viaParent = 0
    for (const p of parents) {
      const m = moduleAtLine(p.includer, p.line)
      if (m) {
        viaCall++
        keys.add(m.key)
      } else {
        const up = resolveOwner(p.includer)
        viaParent++
        if (up) keys.add(up)
      }
    }
    resolving.delete(label)
    if (keys.size === 1) {
      const key = [...keys][0]
      ownerModule.set(label, key)
      ownerWhy.set(
        label,
        viaCall === parents.length
          ? `the include call sits in ${modIdName.get(key)} (${parents.length} parent(s))`
          : viaParent === parents.length
            ? `${parents.length} including file(s) with no module at the include line, all resolving to one module`
            : `mixed: ${viaCall} parent(s) by the module at the include line, ${viaParent} by their own owner`,
      )
      return key
    }
    ownerModule.set(label, null)
    ownerWhy.set(
      label,
      keys.size === 0
        ? `${parents.length} include parent(s), none with a derivable module`
        : `${parents.length} include parent(s) disagree on the module (${keys.size} distinct)`,
    )
    return null
  }
  for (const f of files) resolveOwner(f.label)

  /** A candidate's module: its own `module` block, else the module its file is included into. */
  const candModule = (c: Cand): string | null => (c.moduleKey !== "NONE" ? c.moduleKey : resolveOwner(c.label))
  const candModuleName = (c: Cand): string | null => {
    if (c.moduleKey !== "NONE") return c.moduleName
    const k = resolveOwner(c.label)
    return k === null ? null : (modIdName.get(k) ?? null)
  }
  let filesWithDerivedOwner = 0
  for (const [, v] of ownerModule) if (v !== null) filesWithDerivedOwner++
  const ownerWhyCounts = new Map<string, number>()
  for (const [, w] of ownerWhy) ownerWhyCounts.set(w, (ownerWhyCounts.get(w) ?? 0) + 1)

  // ------------------------------------------------------------------ section three: full closure
  //
  // The sample resolves 59 of 258 include targets, because a target must be IN THE SAMPLE to be found.
  // So the 7.7% owner-derivation rate above is a property of the SAMPLE's closure, not of julia: with
  // stride 3 an include chain needs every link sampled, and the link that is usually missing is the
  // package entry file — one per repo, so 1-in-3 at best, and the file that names the module.
  //
  // This section separates the two. It scans every ADMITTED corpus file (1,985, not the 600) for
  // include sites and module spans — tree navigation only, no `parseFile` — then asks the same
  // question with the whole corpus available: how many of the sampled files does the graph give an
  // owner module, and how many top-level-site edges sit in one of them.
  //
  // That edge number is the CEILING of the lever: the population a production include-graph pass
  // could reach at all. It is a ceiling and not a yield while the CANDIDATES are the sampled files'
  // published symbols — an owner module whose declarations live in unsampled files yields no
  // `viaIncludeUnique` here. `--whole-corpus` removes that caveat by walking all 1,985 files through
  // `parseFile`, and then the two rows are the ceiling and the yield on the same population.
  //
  // Measured on the pinned 600 (committed as julia-scope-oracle-600-include.json): include targets
  // resolved 59 of 258 at sample closure and 1,014 of 1,034 at full closure; files with an owner
  // module 46 (7.7%) and 200 (33.3%); the ceiling 25,522 of 54,883 top-level-site edges (46.5%).
  // So the sample's closure was suppressing this lever 4.3x, and the earlier reading of 7.7% as the
  // lever's size was a statement about a stride-3 sample.
  const closure = (() => {
    // With `--files N` the harness truncates the admitted list before this point, so the "full"
    // closure it builds is only N files wide and the two columns coincide. The flag below says so
    // in the record rather than letting a truncated run print two identical numbers as a result.
    // The graph universe is the whole admitted corpus whatever `--files N` says; `--files` truncates
    // the WALKED population, which is the thing being asked about. Both readings are in the record,
    // so a truncated run cannot be mistaken for a whole-corpus one.
    const admitted = admittedAll
    const rebuiltHash = createHash("sha256")
      .update(admittedAll.map((f) => `${f.repo}/${f.rel}:${f.bytes}`).join("\n"))
      .digest("hex")
      .slice(0, 16)

    const admittedLabels = new Set(admitted.map((f) => f.label))
    const allSites: IncludeSite[] = []
    const allMods = new Map<string, TreeMod[]>()
    let parsed = 0
    let threwTrees = 0
    const closureFail = newFail()
    for (const f of admitted) {
      const facts = scanFile(f.abs, f.label, closureFail)
      if (!facts) {
        threwTrees++
        continue
      }
      parsed++
      for (const site of facts.sites) allSites.push(site)
      if (facts.mods.length > 0) allMods.set(f.label, facts.mods)
    }
    // Resolve every include site against the WHOLE admitted corpus.
    const allIncludedBy = new Map<string, { includer: string; line: number }[]>()
    let resolvedAll = 0
    let unresolvedAll = 0
    let ambiguousAll = 0
    for (const site of allSites) {
      const incAbs = admitted.find((f) => f.label === site.includer)?.abs
      if (!incAbs) continue
      const dir = path.dirname(incAbs)
      const hits = new Set<string>()
      for (const candAbs of [path.resolve(dir, site.target), path.resolve(dir, "..", site.target), path.resolve(dir, "..", "..", site.target)]) {
        const lbl = toLabel(candAbs)
        if (lbl !== null && admittedLabels.has(lbl)) hits.add(lbl)
      }
      if (hits.size === 0) {
        unresolvedAll++
        continue
      }
      if (hits.size > 1) {
        ambiguousAll++
        continue
      }
      resolvedAll++
      const t = [...hits][0]
      const rev = allIncludedBy.get(t)
      if (rev) rev.push({ includer: site.includer, line: site.line })
      else allIncludedBy.set(t, [{ includer: site.includer, line: site.line }])
    }
    const modAtAll = (label: string, line: number): TreeMod | null => {
      let best: TreeMod | null = null
      for (const m of allMods.get(label) ?? []) {
        if (m.startLine <= line && line <= m.endLine) {
          if (!best || m.endLine - m.startLine < best.endLine - best.startLine) best = m
        }
      }
      return best
    }
    const fullOwner = new Map<string, string | null>()
    const fullWhy = new Map<string, string>()
    const busy = new Set<string>()
    const resolveFull = (label: string): string | null => {
      if (fullOwner.has(label)) return fullOwner.get(label) ?? null
      if (busy.has(label)) {
        fullWhy.set(label, "include cycle")
        return null
      }
      const parents = allIncludedBy.get(label) ?? []
      if (parents.length === 0) {
        fullOwner.set(label, null)
        fullWhy.set(label, "no include site anywhere in the admitted corpus")
        return null
      }
      busy.add(label)
      const names = new Set<string>()
      let viaCall = 0
      let viaParent = 0
      for (const p of parents) {
        const m = modAtAll(p.includer, p.line)
        if (m) {
          viaCall++
          names.add(m.name)
        } else {
          const up = resolveFull(p.includer)
          viaParent++
          if (up) names.add(up)
        }
      }
      busy.delete(label)
      const key = names.size === 1 ? [...names][0] : null
      fullOwner.set(label, key)
      fullWhy.set(
        label,
        key === null
          ? names.size === 0
            ? `${parents.length} include parent(s), none with a derivable module`
            : `${parents.length} include parent(s) disagree on the module`
          : viaCall === parents.length
            ? `the include call sits in ${key} (${parents.length} parent(s))`
            : `${parents.length} include parent(s) resolving to ${key}`,
      )
      return key
    }
    for (const f of files) resolveFull(f.label)
    let sampledWithOwner = 0
    for (const f of files) if (fullOwner.get(f.label)) sampledWithOwner++
    // The ceiling: how many of the edges whose site sat at a top level sit in a file that gains an
    // owner module once the whole corpus is available. `name` alone, not the interned key, because
    // the tree-derived spans are interned by name in this pass.
    let topLevelEdges = 0
    let topLevelEdgesWithOwner = 0
    const perTypeCeiling: Record<string, { topLevel: number; withOwner: number }> = {}
    // `moduleAt` is declared below, in the oracle section; this pass runs first, so the test is
    // inlined. "Some `module` block spans this line" is exactly `moduleAt(...) !== null`.
    const insideModuleBlock = (label: string, line: number): boolean =>
      (moduleSpans.get(label) ?? []).some((m) => m.startLine <= line && line <= m.endLine)
    for (const rel of rels) {
      if (insideModuleBlock(rel.label, rel.line)) continue
      topLevelEdges++
      const rowC = (perTypeCeiling[rel.type] ??= { topLevel: 0, withOwner: 0 })
      rowC.topLevel++
      if (fullOwner.get(rel.label)) {
        topLevelEdgesWithOwner++
        rowC.withOwner++
      }
    }
    // Cross-check: the tree-derived module spans against the analyzer's published module symbols, on
    // the 600 files where both exist. This is what licenses using tree spans for the other 1,385.
    let filesBoth = 0
    let filesAgree = 0
    let spanDisagreements = 0
    for (const f of files) {
      const published = (moduleSpans.get(f.label) ?? []).slice().sort((a, b) => a.startLine - b.startLine)
      const derived = (sampleFacts.get(f.label)?.mods ?? []).slice().sort((a, b) => a.startLine - b.startLine)
      if (published.length === 0 && derived.length === 0) continue
      filesBoth++
      const same = published.length === derived.length && published.every((m, i) => m.name === derived[i].name && m.startLine === derived[i].startLine && m.endLine === derived[i].endLine)
      if (same) filesAgree++
      else spanDisagreements++
    }
    const fullWhyCounts = new Map<string, number>()
    for (const [, w] of fullWhy) fullWhyCounts.set(w, (fullWhyCounts.get(w) ?? 0) + 1)
    return {
      admittedIsWholeCorpus: true,
      candidatesAreWholeCorpus: WHOLE,
      sampleTruncatedByFilesFlag: FILE_LIMIT !== null,
      admittedFiles: admitted.length,
      admittedCorpusHash: rebuiltHash,
      admittedScanned: parsed,
      admittedTreesThrew: threwTrees,
      scanFailures: { sample: scanFailSample, closure: closureFail },
      includeSitesAll: allSites.length,
      targetsResolvedAll: resolvedAll,
      targetsUnresolvedAll: unresolvedAll,
      targetsAmbiguousAll: ambiguousAll,
      sampledFiles: files.length,
      sampledFilesWithOwnerAtSampleClosure: filesWithDerivedOwner,
      sampledFilesWithOwnerAtFullClosure: sampledWithOwner,
      topLevelSiteEdges: topLevelEdges,
      topLevelSiteEdgesWithOwnerAtFullClosure: topLevelEdgesWithOwner,
      perTypeCeiling,
      moduleSpanCrossCheck: {
        filesWithBoth: filesBoth,
        filesIdentical: filesAgree,
        filesDiffering: spanDisagreements,
        rule: "same count of `module` blocks, and each block's name and start/end line identical, between the analyzer's published module symbols and the tree's `module_definition` spans",
      },
      reasons: Object.fromEntries([...fullWhyCounts].sort((a, b) => b[1] - a[1])),
      rule: "owner module of a file = the module enclosing the `include` call's LINE in the including file, walked up the include graph, with every admitted corpus file available as a link",
    }
  })()

  // ------------------------------------------------------------------ the oracle
  type Arm =
    | "scopedUnique" // exactly one declaration in the site's own module: julia decides
    | "scopedOneNamespace" // >=2 in that module: one binding, N published symbols
    | "scopedViaUsing" // not in the module; exactly one `using`ed module declares it: julia decides
    | "scopedViaUsingMulti" // >=2 `using`ed modules declare it: ambiguous IN THE LANGUAGE
    | "viaIncludeUnique" // include graph gives the site a module; exactly one declaration in it: julia decides
    | "viaIncludeOneNamespace" // include graph gives the site a module; >=2 declarations in it
    | "viaIncludeViaUsing" // no declaration in that module; exactly one `using`ed module declares it: julia decides
    | "viaIncludeViaUsingMulti" // >=2 `using`ed modules declare it: ambiguous IN THE LANGUAGE
    | "viaIncludeNotDeclared" // owner module known, nobody in it or in its `using` set declares it
    | "viaIncludeNoOwner" // no include path in the sample reaches a module: the lever cannot decide this
    | "notDerivable" // inside a module, nobody declares it, no `using`ed module does: it is outside the corpus

  /** Arms in which julia's own rules pick exactly one declaration. */
  const DECIDERS: Arm[] = ["scopedUnique", "scopedViaUsing", "viaIncludeUnique", "viaIncludeViaUsing"]

  interface Row {
    edges: number
    ambiguous: number
    /** Edges whose site sat at a file's top level, before the include graph was consulted. */
    noModuleAtSiteInput: number
    arms: Record<Arm, number>
    /** Of the arms julia decides, how many the store already gets right. */
    decided: number
    storeAlreadyRight: number
    storeWrong: number
    /** Of the decided arms, the ones whose site sits inside a function/macro body, where a local binding can shadow. */
    decidedShadowCapable: number
    storeWrongShadowCapable: number
    storeWrongExamples: string[]
  }
  const emptyArms = (): Record<Arm, number> => ({
    scopedUnique: 0, scopedOneNamespace: 0, scopedViaUsing: 0, scopedViaUsingMulti: 0,
    viaIncludeUnique: 0, viaIncludeOneNamespace: 0, viaIncludeViaUsing: 0, viaIncludeViaUsingMulti: 0,
    viaIncludeNotDeclared: 0, viaIncludeNoOwner: 0,
    notDerivable: 0,
  })
  const rows: Record<string, Row> = {}
  for (const t of TYPES) {
    rows[t] = {
      edges: 0, ambiguous: 0, noModuleAtSiteInput: 0, decided: 0, storeAlreadyRight: 0, storeWrong: 0,
      decidedShadowCapable: 0, storeWrongShadowCapable: 0, storeWrongExamples: [],
      arms: emptyArms(),
    }
  }

  const moduleAt = (label: string, line: number): ModSpan | null => {
    const mods = moduleSpans.get(label) ?? []
    let best: ModSpan | null = null
    for (const m of mods) {
      if (m.startLine <= line && line <= m.endLine) {
        if (!best || m.endLine - m.startLine < best.endLine - best.startLine) best = m
      }
    }
    return best
  }
  const inBody = (label: string, line: number): boolean =>
    (bodySpans.get(label) ?? []).some((b) => b.startLine <= line && line <= b.endLine)

  const totals: Row = {
    edges: 0, ambiguous: 0, noModuleAtSiteInput: 0, decided: 0, storeAlreadyRight: 0, storeWrong: 0,
    decidedShadowCapable: 0, storeWrongShadowCapable: 0, storeWrongExamples: [],
    arms: emptyArms(),
  }

  for (const rel of rels) {
    const row = rows[rel.type]
    row.edges++
    totals.edges++
    const leaf = extractLeaf(rel.target)
    const cands = byName.get(leaf) ?? []
    if (cands.length <= 1) continue
    row.ambiguous++
    totals.ambiguous++

    const site = moduleAt(rel.label, rel.line)
    let arm: Arm
    let answer: Cand[] = []
    if (!site) {
      // The site is at a file's top level. Its module is the module that file is `include`d into,
      // which the include graph can supply — so this arm is re-decided rather than parked. The
      // original classification is kept as a counter so the movement is measurable, not asserted.
      row.noModuleAtSiteInput++
      totals.noModuleAtSiteInput++
      const owner = resolveOwner(rel.label)
      if (owner === null) {
        arm = "viaIncludeNoOwner"
      } else {
        const inOwner = cands.filter((c) => candModule(c) === owner)
        if (inOwner.length === 1) {
          arm = "viaIncludeUnique"
          answer = inOwner
        } else if (inOwner.length > 1) {
          arm = "viaIncludeOneNamespace"
        } else {
          const ups = usingPaths.get(rel.label) ?? new Set<string>()
          const viaUsing = cands.filter((c) => {
            const n = candModuleName(c)
            return n !== null && n.length > 0 && ups.has(n)
          })
          if (viaUsing.length === 1) {
            arm = "viaIncludeViaUsing"
            answer = viaUsing
          } else if (viaUsing.length > 1) arm = "viaIncludeViaUsingMulti"
          else arm = "viaIncludeNotDeclared"
        }
      }
      row.arms[arm]++
      totals.arms[arm]++
    } else {
      const inModule = cands.filter((c) => c.moduleKey === site.key)
      if (inModule.length === 1) {
        arm = "scopedUnique"
        answer = inModule
      } else if (inModule.length > 1) {
        arm = "scopedOneNamespace"
        answer = inModule
      } else {
        const ups = usingPaths.get(rel.label) ?? new Set<string>()
        const viaUsing = cands.filter((c) => c.moduleName.length > 0 && ups.has(c.moduleName))
        if (viaUsing.length === 1) {
          arm = "scopedViaUsing"
          answer = viaUsing
        } else if (viaUsing.length > 1) arm = "scopedViaUsingMulti"
        else arm = "notDerivable"
      }
      row.arms[arm]++
      totals.arms[arm]++
    }
    if (!DECIDERS.includes(arm)) continue

    row.decided++
    totals.decided++
    const shadow = inBody(rel.label, rel.line)
    if (shadow) {
      row.decidedShadowCapable++
      totals.decidedShadowCapable++
    }
    const store = rel.type === "contains" && rel.line > 0
      ? lineWinner(cands, rel.label, rel.line)
      : genericWinner(cands, rel.label)
    if (store.id === answer[0].id) {
      row.storeAlreadyRight++
      totals.storeAlreadyRight++
    } else {
      row.storeWrong++
      totals.storeWrong++
      if (shadow) {
        row.storeWrongShadowCapable++
        totals.storeWrongShadowCapable++
      }
      if (row.storeWrongExamples.length < 6) {
        row.storeWrongExamples.push(
          `${rel.label}:${rel.line} ${rel.type} -> ${rel.target} [${arm}] | julia says ${answer[0].label}:${answer[0].startLine} ` +
            `${answer[0].kind} in ${answer[0].moduleName || "<none>"} | store says ${store.label}:${store.startLine} ` +
            `${store.kind} in ${store.moduleName || "<none>"} | ${cands.length} candidates`,
        )
      }
    }
  }

  const sampleId = createHash("sha256").update(files.map((f) => f.label).join("\n")).digest("hex").slice(0, 16)
  const out = {
    instrument: "validation/m14/fixtures/julia/scope-oracle.ts",
    measured: new Date().toISOString().slice(0, 10),
    question:
      "of the edges whose target name binds to >1 published symbol, how many does julia's own name resolution decide (the site module, else the module's using/import set), and does the store's pick already match that answer",
    population: {
      record: "validation/m14/measurements/julia-ambiguity-before.json",
      sampleHash: record.sampleHash,
      stride: record.stride,
      corpusAdmitted: record.admittedFiles,
      files: files.length,
      population: POPULATION,
      walked: WHOLE ? "all admitted corpus files" : "the record's stride sample",
      isWholeSample: FILE_LIMIT === null,
      workerWidth: WIDTH,
      symbols,
      symbolsCarryingIsDeclaration: isDeclarationSymbols,
      filesDeclaringNoModule: filesWithNoModule,
      filesDeclaringAModule: files.length - filesWithNoModule,
      edges: totals.edges,
      degraded,
      parseThrew: threw,
    },
    rule: {
      moduleIdentity: "file + module name, never the bare name — two files each writing `module Foo` are two different Foo unless one includes the other, and the tree does not say which",
      usingSetScope: "per FILE, not per module: importTargets publishes the statement's module path and position, and attributing it to an enclosing module would be an inference",
      deciders: DECIDERS,
      storeStatements: {
        contains: "src/ast/parallel-indexer.ts:2354 resolveContainsTargetStmt (line tier)",
        other: "src/ast/parallel-indexer.ts:2239 resolveTargetStmt (no line tier)",
        dispatch: "src/ast/parallel-indexer.ts:3500",
      },
      droppedTier:
        "COALESCE(s.is_declaration,0) — asserted 0 on this population at runtime, exit 2 otherwise",
    },
    includeGraph: {
      treesParsed: includeTreesParsed,
      treesThrew: includeTreesThrew,
      includeCallsFound,
      includeCallsRefused,
      targetsResolved: includeTargetsResolved,
      targetsUnresolved: includeTargetsUnresolved,
      targetsAmbiguous: includeTargetsAmbiguous,
      filesWithDerivedOwner,
      filesSampled: files.length,
      ownerReasons: Object.fromEntries([...ownerWhyCounts].sort((a, b) => b[1] - a[1])),
      rule:
        "owner module of a file = the module enclosing the `include` call's LINE in the including file, walked up the include graph; two parents whose modules disagree are NOT resolved, they are reported as disagreement",
    },
    limitations: [
      "shadowing: inside a function/macro body a local binding shadows the module-level one, and this lane publishes no local bindings (21,693 corpus-wide). `decidedShadowCapable` is the population where the oracle's answer can be beaten by an unpublished binding.",
      "cross-file module identity: resolved through the include graph, which covers only files included by another SAMPLED file; `viaIncludeNoOwner` and `viaIncludeNotDeclared` are the residue, with the reasons counted in the include-sites block.",
      "macro-expanded definitions: a name a macro generates is not in the tree.",
      "the oracle reads the same published symbol set the resolver reads, so a publication decision that is wrong (the 23.1% ceiling) is wrong on both sides.",
    ],
    closure,
    perType: rows,
    totals,
    sampleHash: sampleId,
  }
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(out, null, 2)}\n`)

  const p = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
  console.log(
    `scope oracle — julia, ${files.length} file(s), population ${POPULATION}` +
      `${FILE_LIMIT !== null ? ` truncated to ${FILE_LIMIT} by --files` : ""}`,
  )
  console.log(`sampleHash ${sampleId}  width ${WIDTH}  symbols ${symbols}  edges ${totals.edges}`)
  console.log(`files declaring a module: ${files.length - filesWithNoModule}   files declaring none: ${filesWithNoModule} (${((filesWithNoModule / files.length) * 100).toFixed(1)}%)`)
  console.log(`degraded ${degraded.length}   parse failures ${threw.length}   isDeclaration symbols ${isDeclarationSymbols}`)
  if (degraded.length || threw.length) {
    for (const f of [...degraded, ...threw].slice(0, 5)) console.log(`  ${f}`)
  }
  console.log("")
  console.log("include sites (section two — the lever, priced before it is built):")
  console.log(
    `  trees parsed ${includeTreesParsed}, failures ${includeTreesThrew} ` +
      `(read ${scanFailSample.read}, parse threw ${scanFailSample.parseThrew}, null tree ${scanFailSample.nullTree})`,
  )
  for (const ex of scanFailSample.examples.slice(0, 3)) console.log(`    ${ex}`)
  console.log(`  include() calls found ${includeCallsFound}, refused (2-arg / interpolated / non-literal) ${includeCallsRefused}`)
  console.log(`  targets resolved to a sampled file ${includeTargetsResolved}, unresolved ${includeTargetsUnresolved}, ambiguous ${includeTargetsAmbiguous}`)
  console.log(`  files whose owner module the graph derives ${filesWithDerivedOwner} of ${files.length} (${((filesWithDerivedOwner / files.length) * 100).toFixed(1)}%)`)
  for (const [w, n] of [...ownerWhyCounts].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`    ${n}  ${w}`)
  console.log("")
  console.log(
    `full closure (section three — the graph universe is all ${closure.admittedFiles} admitted files; ` +
      `candidates are ${closure.candidatesAreWholeCorpus ? "all of them" : `the ${closure.sampledFiles} walked`}):`,
  )
  if (FILE_LIMIT !== null) {
    console.log(`  NOTE: --files ${FILE_LIMIT} — the graph universe is still all ${closure.admittedFiles} admitted files; only the ${closure.sampledFiles} files being ASKED ABOUT are truncated.`)
  }
  const cf = closure.scanFailures.closure
  console.log(
    `  admitted corpus files scanned ${closure.admittedScanned} of ${closure.admittedFiles}, failures ${closure.admittedTreesThrew} ` +
      `(read ${cf.read}, parse threw ${cf.parseThrew}, null tree ${cf.nullTree})`,
  )
  for (const ex of cf.examples.slice(0, 3)) console.log(`    ${ex}`)
  console.log(`  include sites across all of them ${closure.includeSitesAll}, targets resolved ${closure.targetsResolvedAll}, unresolved ${closure.targetsUnresolvedAll}, ambiguous ${closure.targetsAmbiguousAll}`)
  console.log(`  the ${closure.sampledFiles} sampled files with an owner module: ${closure.sampledFilesWithOwnerAtSampleClosure} at sample closure (${((closure.sampledFilesWithOwnerAtSampleClosure / closure.sampledFiles) * 100).toFixed(1)}%), ${closure.sampledFilesWithOwnerAtFullClosure} at full closure (${((closure.sampledFilesWithOwnerAtFullClosure / closure.sampledFiles) * 100).toFixed(1)}%)`)
  console.log(`  CEILING on the lever — top-level-site edges in a file that gains an owner: ${closure.topLevelSiteEdgesWithOwnerAtFullClosure} of ${closure.topLevelSiteEdges} (${((closure.topLevelSiteEdgesWithOwnerAtFullClosure / Math.max(1, closure.topLevelSiteEdges)) * 100).toFixed(1)}%)`)
  console.log(`  module-span cross-check: ${closure.moduleSpanCrossCheck.filesIdentical} of ${closure.moduleSpanCrossCheck.filesWithBoth} sampled files have identical published/tree module spans, ${closure.moduleSpanCrossCheck.filesDiffering} differ`)
  for (const [w, n] of Object.entries(closure.reasons).slice(0, 5)) console.log(`    ${n}  ${w}`)
  console.log("")
  console.log("arm, over the edges whose target name binds to >1 published symbol:")
  console.log(p("arm", 22) + p("edges", 9) + p("share", 8) + "what it is")
  console.log("-".repeat(104))
  const arms: (Arm | "ambSym" | "topLevelInput")[] = [
    "ambSym", "topLevelInput",
    "scopedUnique", "scopedViaUsing", "scopedOneNamespace", "scopedViaUsingMulti", "notDerivable",
    "viaIncludeUnique", "viaIncludeViaUsing", "viaIncludeOneNamespace", "viaIncludeViaUsingMulti",
    "viaIncludeNotDeclared", "viaIncludeNoOwner",
  ]
  const ARM_WHAT: Record<string, string> = {
    ambSym: "every target binding to >1 published symbol",
    topLevelInput: "of which the site sits at a file's top level (no enclosing module block)",
    scopedUnique: "one declaration in the site's own module block — JULIA DECIDES",
    scopedViaUsing: "one using/imported module declares it, site in a module block — JULIA DECIDES",
    scopedOneNamespace: ">=2 declarations in that module block: one binding, N published symbols",
    scopedViaUsingMulti: ">=2 using/imported modules declare it — ambiguous IN THE LANGUAGE",
    notDerivable: "in a module block, nobody declares it, no using/imported module does",
    viaIncludeUnique: "include graph names the module; one declaration in it — JULIA DECIDES",
    viaIncludeViaUsing: "include graph names the module; one using/imported module declares it — JULIA DECIDES",
    viaIncludeOneNamespace: "include graph names the module; >=2 declarations in it",
    viaIncludeViaUsingMulti: "include graph names the module; >=2 using/imported modules declare it",
    viaIncludeNotDeclared: "owner module known; nobody in it or in its using/import set declares it",
    viaIncludeNoOwner: "no include path in the sample reaches a module — the lever CANNOT decide this",
  }
  for (const a of arms) {
    const n = a === "ambSym" ? totals.ambiguous : a === "topLevelInput" ? totals.noModuleAtSiteInput : totals.arms[a]
    const mark = DECIDERS.includes(a as Arm) ? " *" : ""
    console.log(
      p(a, 22) + p(String(n), 9) + p(`${((n / Math.max(1, totals.ambiguous)) * 100).toFixed(1)}%`, 8) +
        (ARM_WHAT[a] ?? "") + mark,
    )
  }
  console.log("-".repeat(104))
  console.log("  * an arm in which julia itself picks exactly one declaration")
  console.log("-".repeat(104))
  console.log("")
  console.log("ATTRIBUTION ACCURACY — only over the arms julia decides:")
  console.log(`  decided (${DECIDERS.join(" + ")})  ${totals.decided}`)
  console.log(`  the store already attributes it correctly    ${totals.storeAlreadyRight}  (${((totals.storeAlreadyRight / Math.max(1, totals.decided)) * 100).toFixed(1)}% of decided)`)
  console.log(`  the store attributes it to ANOTHER declaration ${totals.storeWrong}  (${((totals.storeWrong / Math.max(1, totals.decided)) * 100).toFixed(1)}% of decided)`)
  console.log(`  of the decided, shadow-capable (site in a fn body) ${totals.decidedShadowCapable}, of which wrong ${totals.storeWrongShadowCapable}`)
  console.log("")
  console.log("per type:")
  // The third column is `viaIncludeUnique + viaIncludeViaUsing` and the fourth is `decided`. It was
  // labelled `decided` and `right` respectively, which is a header that does not name the quantity
  // under it, and it cost a real number: the commit that re-measured this record quoted `calls` as
  // "3,294 wrong of 7,298" by reading the mislabelled columns — 3,294 is calls' `right` and 7,298
  // is no column at all. Both are now named for what they are.
  console.log(
    p("type", 14) + p("edges", 9) + p("ambig", 9) + p("viaIncl", 10) + p("decided", 10) + p("right", 8) +
      p("wrong", 8) + p("wrong%", 9) + p("shadow", 9) + p("wrong+sh", 10),
  )
  console.log("-".repeat(106))
  for (const t of TYPES) {
    const r = rows[t]
    if (r.edges === 0) continue
    console.log(
      p(t, 14) + p(String(r.edges), 9) + p(String(r.ambiguous), 9) +
        p(String(r.arms.viaIncludeUnique + r.arms.viaIncludeViaUsing), 10) + p(String(r.decided), 10) +
        p(String(r.storeAlreadyRight), 8) + p(String(r.storeWrong), 8) +
        p(r.decided > 0 ? `${((r.storeWrong / r.decided) * 100).toFixed(1)}%` : "-", 9) +
        p(String(r.decidedShadowCapable), 9) + String(r.storeWrongShadowCapable),
    )
  }
  console.log("-".repeat(106))
  console.log(
    p("TOTAL", 14) + p(String(totals.edges), 9) + p(String(totals.ambiguous), 9) +
      p(String(totals.arms.viaIncludeUnique + totals.arms.viaIncludeViaUsing), 10) + p(String(totals.decided), 10) +
      p(String(totals.storeAlreadyRight), 8) + p(String(totals.storeWrong), 8) +
      p(totals.decided > 0 ? `${((totals.storeWrong / totals.decided) * 100).toFixed(1)}%` : "-", 9) +
      p(String(totals.decidedShadowCapable), 9) + String(totals.storeWrongShadowCapable),
  )
  if (totals.storeWrongExamples.length > 0) {
    console.log("")
    console.log("store-wrong examples (name ${file}:${line} ${type} -> ${target} | julia says X | store says Y):")
    for (const e of totals.storeWrongExamples) console.log(`  ${e}`)
  }
  if (!FILE_LIMIT) {
    console.log("")
    console.log(`ambiguity is not wrongness: ${totals.ambiguous} ambiguous, ${totals.storeWrong} demonstrably misattributed.`)
    console.log(`The gap is ${totals.ambiguous - totals.storeWrong} edges the language does not decide and the store cannot be shown wrong on.`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})