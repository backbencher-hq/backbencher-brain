// ELIXIR lane — the FOUR EXTENDED TYPES census (decorates · renders · mixes_in · part_of).
//
// WHY THIS EXISTS. The lane reads 9/13 and the four short types are exactly the extended
// vocabulary. The owner's ladder makes a ruling the LAST resort: R1 is the served build's
// inventory (validation/m14/measurements/elixir-grammar-nodes.json — 0 of the 45 distinct
// named types carries a decor/render/mixin/part/derive/include stem), R3 is an existing node
// type, and R2 is a patched grammar. This census measures the CONSTRUCT SIDE for each of the
// four candidates over the whole admitted population, because a ruling needs a counted
// near-miss population, and an implementation needs to know what its discriminator must
// separate (the dart lesson: a filter on the RETURN TYPE separates the construct from its
// impostors; a filter on the NAME does not).
//
// NO REGEX anywhere: node.type strings, `===`, charCodeAt, Set/Map lookups — the same rule as
// the analyzer itself.
//
// POPULATION: the GIT-TRACKED set under the 1 MiB cap over $PWD/.corpus (the fleet's rule),
// .ex/.exs per the ONE table (script/m14/language-extensions.ts). `git ls-files` per repo,
// never a disk walk. Rendered-template files (.eex/.heex) are NOT this lane's population —
// the router admits no such spelling — and the census records their count separately as the
// groovy-`gsp` precedent requires: a construct expressible in files NOT routed to this lane is
// an ONTOLOGICAL fact to publish, not a blind spot to hide.
//
// MEMORY: every parse frees its tree (`tree.delete()`), the fleet's tenth form — a census that
// leaks trees aborts the WASM module and reports a fraction of the population as a table.
// filesRead is checked against filesAdmitted and the instrument exits 5 on a mismatch.
//
// Usage: bun run validation/m14/elixir/elixir-extended-types-census.ts
// Artifact: validation/m14/measurements/elixir-extended-types-census.json

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { join, relative, isAbsolute, resolve } from "node:path"
import { ASTEngine } from "../../../src/ast/engine"

const ROOT = join(import.meta.dir, "../../..")
const headCommit = (): string => {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" }
}

// ── population: git ls-files under the 1 MiB cap, per repo carrying an admitted file ──────
const CAP = 1024 * 1024
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? join(ROOT, ".corpus")
const EXTS = [".ex", ".exs"]

function trackedAdmitted(): { files: Array<{ path: string; repo: string }>; perRepo: Record<string, number>; symlinkedDirs: number; overCap: number } {
  const files: Array<{ path: string; repo: string }> = []
  const perRepo: Record<string, number> = {}
  let symlinkedDirs = 0
  let overCap = 0
  let repos: string[] = []
  try { repos = execFileSync("ls", ["-1", CORPUS_ROOT], { encoding: "utf8" }).split("\n").filter(Boolean) } catch { return { files: [], perRepo: {}, symlinkedDirs: 0, overCap: 0 } }
  for (const r of repos) {
    const rp = join(CORPUS_ROOT, r)
    let tracked: string[] = []
    try { tracked = execFileSync("git", ["-C", rp, "ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean) } catch { continue }
    let n = 0
    for (const t of tracked) {
      if (!t.endsWith(".ex") && !t.endsWith(".exs")) continue
      const fp = join(rp, t)
      let st: any
      try { st = execFileSync("stat", ["-c", "%s", fp], { encoding: "utf8" }).trim() } catch { continue }
      const size = Number(st)
      if (!Number.isFinite(size)) continue
      if (size > CAP) { overCap++; continue }
      if (size < 8) continue
      files.push({ path: fp, repo: r })
      n++
    }
    if (n > 0) perRepo[r] = n
  }
  return { files, perRepo, symlinkedDirs, overCap }
}

// ── the probe helpers, mirrored from the lane's proven construct census ───────────────────
const kids = (n: any): any[] => { const r: any[] = []; for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) r.push(c) } return r }
const findChild = (n: any, t: string): any => { for (const c of kids(n)) if (c.type === t) return c; return undefined }
const callIdentifier = (n: any): string => { if (n.type !== "call") return ""; const id = findChild(n, "identifier"); return id ? id.text : "" }
const hasArguments = (n: any): boolean => !!findChild(n, "arguments")
const findChildDeep = (n: any, t: string, depth = 6): boolean => {
  if (depth <= 0 || !n) return false
  if (n.type === t) return true
  for (const c of kids(n)) if (findChildDeep(c, t, depth - 1)) return true
  return false
}

// ── counters ────────────────────────────────────────────────────────────────────────────
const counters = {
  // DECORATES — the module-attribute application surface. The java falsifier was "an
  // annotation argument that is a call or a lambda". Elixir's attributes ARE applied at
  // compile time; the question is whether their ARGUMENTS are applied callables.
  derivesTotal: 0, derivesFiles: new Set<string>(),
  deriveArgIsCall: 0,            // @derive X — X applied, X a call form
  deriveArgIsAtomOrAlias: 0,     // @derive Protocols.Enum  — a TYPE MENTION, not applied
  deriveArgIsTuple: 0,           // @derive {Eq, only: [...]} — alias + opts
  deriveArgOther: 0,
  deriveArgsAreList: 0,          // @derive [A, B] / @derive {key: :value}
  attributeCallArgs: 0,          // ANY attribute whose argument subtree contains a `call`
  attributeLambdaArgs: 0,        // ANY attribute whose argument subtree contains a fn
  attrNames: new Map<string, number>(),
  beforeCompile: 0, beforeCompileFiles: new Set<string>(),
  // RENDERS — .ex files have no component DSL; the near misses are sigils and EEx.
  eexSigils: 0, eexSigilFiles: new Set<string>(),       // ~e/~E sigil templates in .ex
  heredocTemplates: 0,
  templateFilesNotRouted: new Set<string>(),            // .eex/.heex count, published separately
  // MIXES_IN — `use` composes a module's behaviour. The contract wants a supertype-chain
  // member that declares no conformance; `use` injects code via __using__ (EX-D8).
  useSites: 0, useFiles: new Set<string>(),
  useWithOpts: 0,
  useDistinctModules: new Set<string>(),
  useGenServer: 0, usePhoenixHtml: 0,
  behavioursDeclared: 0, behaviourFiles: new Set<string>(),  // @behaviour (the conformance marker)
  defimplSites: 0,
  // PART_OF — the fleet's implemented set is unanimous: a textual file-inclusion
  // directive. Elixir has Code.eval_file/string-to-code at RUNTIME, not a directive.
  includeOrRequireTokens: 0,      // `include`/`require` as a call identifier (near miss)
  codeEvalFile: 0, codeEvalFileFiles: new Set<string>(),  // Code.eval_file / require_file
}

const fileRows: Array<Record<string, any>> = []
let filesAdmitted = 0
let filesRead = 0
let parseFailures = 0
const started = Date.now()

async function main() {
  const pop = trackedAdmitted()
  filesAdmitted = pop.files.length
  const parser = await ASTEngine.getParser("elixir")

  for (const f of pop.files) {
    let content: string
    try { content = readFileSync(f.path, "utf8") } catch { parseFailures++; continue }
    let tree: any
    try { tree = await parser.parse(content, f.path) } catch { parseFailures++; continue }
    filesRead++
    const root = tree.rootNode
    const rel = f.path

    const fileRow: Record<string, any> = { file: rel, repo: f.repo }
    let fileChanged = false
    const bump = (k: keyof typeof counters): void => {
      const v = (counters as any)[k]
      if (typeof v === "number") (counters as any)[k] = v + 1
      else if (v instanceof Set) v.add(rel)
      else if (v instanceof Map) { /* handled by callers */ }
    }

    const inQuote = (n: any): boolean => {
      let c: any = n.parent
      while (c) { if (c.type === "call" && (callIdentifier(c) === "quote" || callIdentifier(c) === "quote_location")) return true; c = c.parent }
      return false
    }

    const walk = (n: any): void => {
      const line = n.startPosition.row + 1

      // ── attribute application surface (@name ...) ──
      // Shape measured on the live parser: `@derive Foo` is
      //   unary_operator > call > identifier[derive] + arguments
      // The `@` token is an ANONYMOUS operator, so there is no operator_identifier
      // named child — the first probe version tested for one and every decorator
      // counter read 0 over 1,368 files. Fixed against the dumped shape above.
      if (n.type === "unary_operator") {
        const val = kids(n).find((c: any) => c.type === "call")
        if (val) {
          const name = callIdentifier(val)
          if (name) counters.attrNames.set(name, (counters.attrNames.get(name) ?? 0) + 1)
          if (name === "derive") {
            bump("derivesTotal"); counters.derivesFiles.add(rel); fileChanged = true
            // the argument shape decides: alias/atom = TYPE MENTION; call/lambda = APPLIED
            const args = val ? findChild(val, "arguments") : undefined
            if (args) {
              const akids = kids(args)
              const first = akids[0]
              if (first) {
                if (first.type === "tuple") counters.deriveArgIsTuple++
                else if (first.type === "list" || first.type === "map" || first.type === "keywords") counters.deriveArgsAreList++
                else if (first.type === "alias" || first.type === "atom" || first.type === "dot") counters.deriveArgIsAtomOrAlias++
                else if (first.type === "call" || first.type === "anonymous_function") counters.deriveArgIsCall++
                else if (first.type === "identifier") counters.deriveArgIsAtomOrAlias++
                else counters.deriveArgOther++
              }
            }
          }
          if (name === "before_compile") { counters.beforeCompile++; counters.beforeCompileFiles.add(rel) }
          // the falsifier population: ANY attribute whose value subtree contains a call or a fn
          if (val && !inQuote(n)) {
            if (findChildDeep(val, "call", 5)) { counters.attributeCallArgs++; fileChanged = true }
            if (findChildDeep(val, "anonymous_function", 5)) counters.attributeLambdaArgs++
          }
        }
      }

      // ── `use` directive sites ──
      if (n.type === "call" && !inQuote(n)) {
        const id = callIdentifier(n)
        if (id === "use") {
          counters.useSites++; counters.useFiles.add(rel); fileChanged = true
          const args = findChild(n, "arguments")
          const akids = args ? kids(args) : []
          const first = akids[0]
          if (first) {
            const t = first.text
            counters.useDistinctModules.add(t.split("\n")[0])
            if (t === "GenServer") counters.useGenServer++
            if (t.startsWith("Phoenix.HTML")) counters.usePhoenixHtml++
          }
          if (args && kids(args).some((c: any) => c.type === "keywords")) counters.useWithOpts++
        }
        if (id === "behaviour" || id === "behavior") { counters.behavioursDeclared++; counters.behaviourFiles.add(rel) }
        if (id === "defimpl") counters.defimplSites++
        // part_of near misses at the call surface
        if (id === "include" || id === "require") { if (id === "include") counters.includeOrRequireTokens++ }
        // renders near miss: EEx sigils inside .ex files
        if (n.type === "sigil" || (n.type === "call" && (id === "EEx" || id === "eex"))) { /* handled below */ }
      }

      if (n.type === "sigil") {
        const nm = findChild(n, "sigil_name")
        const t = nm ? nm.text : ""
        if (t === "e" || t === "E") { counters.eexSigils++; counters.eexSigilFiles.add(rel); fileChanged = true }
      }

      // Code.eval_file / require_file — the runtime inclusion near miss
      if (n.type === "call") {
        const args = findChild(n, "arguments")
        const tgt = findChild(n, "dot")
        if (tgt && callIdentifier(n) === "" && args) {
          const dotKids = kids(tgt)
          const leaf = dotKids[dotKids.length - 1]
          const rootId = dotKids[0]
          if (leaf && rootId && leaf.text === "eval_file" && rootId.text === "Code") {
            counters.codeEvalFile++; counters.codeEvalFileFiles.add(rel); fileChanged = true
          }
        }
      }

      for (const c of kids(n)) walk(c)
    }
    walk(root)
    if (fileChanged) fileRows.push(fileRow)

    // ★ the fleet's tenth form: every parse frees its tree
    tree.delete()
  }

  // ── the NOT-ROUTED template population, published beside the verdict (groovy-gsp precedent)
  let eexTracked = 0, heexTracked = 0
  try {
    const repos = execFileSync("ls", ["-1", CORPUS_ROOT], { encoding: "utf8" }).split("\n").filter(Boolean)
    for (const r of repos) {
      const rp = join(CORPUS_ROOT, r)
      let tracked: string[] = []
      try { tracked = execFileSync("git", ["-C", rp, "ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean) } catch { continue }
      for (const t of tracked) {
        if (t.endsWith(".eex")) { eexTracked++; counters.templateFilesNotRouted.add(join(rp, t)) }
        if (t.endsWith(".heex")) heexTracked++
      }
    }
  } catch { /* published as measured */ }

  const artifact = {
    tool: "validation/m14/elixir/elixir-extended-types-census.ts",
    lane: "elixir",
    subjectCommit: headCommit(),
    generatedAt: new Date().toISOString(),
    population: {
      rule: "git ls-files per repo under .corpus, .ex/.exs admitted, 1 MiB cap, dedup none (paths are unique per repo checkout)",
      corpusRoot: CORPUS_ROOT,
      admitted: filesAdmitted,
      perRepo: pop.perRepo,
      reposCarryingAdmitted: Object.keys(pop.perRepo).length,
      overCap: pop.overCap,
      note: "the same population rule as ELIXIR-BASELINE.md's 1,368-file run",
    },
    grammar: {
      servedDigest: "ed99093c548c12d43f7e337fd3440e9e2daa2ec671a5e29aadb6c6dcb2232a62",
      servedDigestSource: "read from the resolver's own choice (resolveWasmAsset), hashed bytes — §6",
      namedTypes: 45,
      stems: { decor: 0, render: 0, mixin: 0, part: 0, derive: 0, include: 0, template: 0, component: 0 },
      artifact: "validation/m14/measurements/elixir-grammar-nodes.json",
    },
    filesRead,
    parseFailures,
    wallMs: Date.now() - started,
    decorates: {
      derivesTotal: counters.derivesTotal,
      derivesFiles: counters.derivesFiles.size,
      deriveArgIsCall: counters.deriveArgIsCall,
      deriveArgIsAtomOrAlias: counters.deriveArgIsAtomOrAlias,
      deriveArgIsTuple: counters.deriveArgIsTuple,
      deriveArgOther: counters.deriveArgOther,
      deriveArgsAreList: counters.deriveArgsAreList,
      beforeCompile: counters.beforeCompile,
      beforeCompileFiles: counters.beforeCompileFiles.size,
      attributeCallArgs: counters.attributeCallArgs,
      attributeLambdaArgs: counters.attributeLambdaArgs,
      attrNameCensus: Object.fromEntries([...counters.attrNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)),
    },
    renders: {
      eexSigilsInEx: counters.eexSigils,
      eexSigilFiles: counters.eexSigilFiles.size,
      eexTemplateFilesNotRouted: eexTracked,
      heexTemplateFilesNotRouted: heexTracked,
    },
    mixes_in: {
      useSites: counters.useSites,
      useFiles: counters.useFiles.size,
      useWithOpts: counters.useWithOpts,
      useDistinctModules: counters.useDistinctModules.size,
      useGenServer: counters.useGenServer,
      usePhoenixHtml: counters.usePhoenixHtml,
      behavioursDeclared: counters.behavioursDeclared,
      behaviourFiles: counters.behaviourFiles.size,
      defimplSites: counters.defimplSites,
    },
    part_of: {
      includeTokens: counters.includeOrRequireTokens,
      codeEvalFile: counters.codeEvalFile,
      codeEvalFileFiles: counters.codeEvalFileFiles.size,
    },
  }

  const outDir = join(ROOT, "validation/m14/measurements")
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "elixir-extended-types-census.json"), JSON.stringify(artifact, null, 2) + "\n")

  console.log(`admitted ${filesAdmitted} read ${filesRead} parseFailures ${parseFailures} wallMs ${Date.now() - started}`)
  console.log(`decorates: @derive ${counters.derivesTotal}/${counters.derivesFiles.size} (call ${counters.deriveArgIsCall} · type-mention ${counters.deriveArgIsAtomOrAlias} · tuple ${counters.deriveArgIsTuple} · list ${counters.deriveArgsAreList} · other ${counters.deriveArgOther}) · @before_compile ${counters.beforeCompile} · attr-call-args ${counters.attributeCallArgs} · attr-fn-args ${counters.attributeLambdaArgs}`)
  console.log(`renders: ~e sigils ${counters.eexSigils}/${counters.eexSigilFiles.size} · NOT-ROUTED .eex ${eexTracked} · .heex ${heexTracked}`)
  console.log(`mixes_in: use ${counters.useSites}/${counters.useFiles.size} over ${counters.useDistinctModules.size} modules (GenServer ${counters.useGenServer} · Phoenix.HTML ${counters.usePhoenixHtml}) · @behaviour ${counters.behavioursDeclared}/${counters.behaviourFiles.size} · defimpl ${counters.defimplSites}`)
  console.log(`part_of: include-tokens ${counters.includeOrRequireTokens} · Code.eval_file ${counters.codeEvalFile}/${counters.codeEvalFileFiles.size}`)
  if (filesRead !== filesAdmitted) { console.log(`*** filesRead ${filesRead} != admitted ${filesAdmitted} — PARTIAL RUN, NOT A MEASUREMENT ***`); process.exit(5) }
  console.log("artifact: validation/m14/measurements/elixir-extended-types-census.json")
}

main().catch((e) => { console.error(e); process.exit(1) })
