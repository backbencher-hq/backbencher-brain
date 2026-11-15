/**
 * LUA CLASS-B ORIGIN — what produced a DOTTED edge target, and whether retargeting
 * its final segment would be a SPELLING FIX or a FABRICATION.
 *
 * ## WHY THIS FILE EXISTS
 *
 * The round brief's class B reads:
 *
 *     B  EMITTER AND PUBLISHER DISAGREE ON THE SPELLING. The edge target's FINAL
 *        SEGMENT is a published name, so the edge would resolve if both sides used
 *        one canonical helper. Proven on graphql: unresolved 6,451 -> 1,016 (-84%).
 *        Retarget the edge to the name ALREADY PUBLISHED.
 *
 * That premise is a claim about GRAPHQL, where a dotted target is a `$ref` schema
 * pointer and the final segment IS the definition's name. It is not a premise about
 * Lua, and `validation/m14/fixtures/lua/ambiguity-split.ts` measured 5,181 class-B
 * edges here without ever asking what the dotted target MEANS.
 *
 * This file asks it, from the parse tree, per edge, with three structurally
 * distinguishable origins:
 *
 *   requireArg      the target is a `string` node that is an argument of a call whose
 *                   name is `require`. This is the ONLY producer of an `imports`
 *                   target — `real-lua-analyzer.ts:978` emits
 *                   `Relationship(ctx, ..., moduleName, Imports, ...)` from
 *                   `addImport(moduleName, ...)`, and `moduleName` is the required
 *                   MODULE. The target names a MODULE, not a symbol.
 *   bracketKey      the target is a `string` node in the `field` of a
 *                   `bracket_index_expression`, i.e. the source spelled `T["a.b"]`.
 *                   This is the only producer of a DOTTED `references` target —
 *                   `emitMemberRead` reads `node.childForFieldName("field")` and
 *                   returns unless it is a `string`. The target is a TABLE KEY: a
 *                   string literal the program compares against. It is not a module
 *                   and not a symbol.
 *   qualifiedName   the target is the text of a `dot_index_expression` /
 *                   `method_index_expression` node, i.e. the source spelled `a.b`
 *                   as a NAME. This is the shape of an `extends` metatable target.
 *
 * The attribution is a CHECK, not an assumption: every dotted edge is looked up in
 * all three sets and the mismatch counts are reported. If an `imports` dotted target
 * were not a `require` argument, that would be a finding and it would show up as
 * `originMismatch`.
 *
 * ## THE COUNTERFACTUAL, AND WHY IT IS NOT AUTOMATICALLY SAFE
 *
 * For each dotted target `a.b.c` the brief's fix publishes `c`. Three measurements
 * decide whether that is the same edge or a different one:
 *
 *   candidates(c)  how many declarations share the bare name `c` in the draw. A bare
 *                  name is what the store resolves on, so >1 candidate means the
 *                  retarget lands on one of several, which is the class-A collision
 *                  this whole workstream is about, reintroduced through the back
 *                  door.
 *   moduleFile     for a `requireArg`, does `a.b.c` name a file in the draw at all
 *                  (`a/b/c.lua`)? If not, the final segment is a COINCIDENCE: some
 *                  unrelated file publishes that bare name and the "fix" would bind
 *                  this require to it.
 *   segmentInModuleFile
 *                  for a `requireArg` whose module file EXISTS, does that file
 *                  declare a symbol named `c`? This is the only class-B shape that
 *                  is not fabricated: the module's own file publishes the name, the
 *                  resolution is structural rather than coincidental, and the retarget
 *                  names the module.
 *
 * `bracketKey` is reported as a counterfactual for completeness and is NOT expected
 * to be actionable: `T["indentation.zero"]` names a key of `T`, and publishing
 * `zero` would claim the file reads a symbol `zero`, which is a different claim.
 *
 * ## NO REGEX
 *
 * Every classification reads `node.type` and named children off the tree-sitter AST.
 * The module-path-to-file test is a `.`/`/` substitution plus a path join and a
 * `statSync`, not a pattern over source text. Nothing here can match a name inside a
 * comment or a string the walk did not classify, because the walk classifies nodes.
 *
 * ## USAGE
 *
 *   npx tsx validation/m14/fixtures/lua/classb-origin.ts --out validation/m60/lua/classb-origin.json
 *
 * Exit 0 always: this reports, it does not gate.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../../../src/ast/pool-worker"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const argv = process.argv.slice(2)
const arg = (k: string, d = ""): string => {
  const hit = argv.find((a) => a === `--${k}` || a.startsWith(`--${k}=`))
  if (!hit) return d
  const eq = hit.indexOf("=")
  return eq === -1 ? (argv[argv.indexOf(hit) + 1] ?? d) : hit.slice(eq + 1)
}
const OUT = arg("out", "validation/m60/lua/classb-origin.json")
const FILES_CAP = Number(arg("files", "100000"))

const LABEL_ALIASES: Record<string, string> = {
  calls: "calls", call: "calls",
  uses: "uses",
  contains: "contains", composition: "contains", part_of: "contains",
  imports: "imports", brain_import: "imports",
  references: "references", depends_on: "references", related: "references",
  exports: "exports", provides: "exports",
  extends: "extends", inheritance: "extends",
  implements: "implements", implementation: "implements",
  overrides: "overrides", override: "overrides",
  instantiates: "instantiates",
}

const SCOPE_LABELS = new Set(["global", "owner", "__global__", "file"])

interface Site { file: string; name: string; kind: string; startLine: number }
interface Edge { t: string; s: string; g: string; l: number; f: string }

type Origin = "requireArg" | "bracketKey" | "qualifiedName" | "notOnTree"

/**
 * Which producers in the edge's OWN file contain this target as a node.
 *
 * Membership, not priority: a file can contain `require("a.b.c")` AND `T["a.b.c"]`,
 * and then a dotted `references` edge on `a.b.c` belongs to BOTH. An earlier
 * revision of this file picked one by priority and reported 3 of 122 dotted
 * `references` targets as `requireArg`, which read as a producer disagreement and
 * was only an ordering artifact of the probe. Multi-membership makes the check
 * exact: `references` targets are `bracketKey` members, whatever else is true.
 */
type OriginSet = { requireArg: boolean; bracketKey: boolean; qualifiedName: boolean }

/** `pool-worker.ts:866-869` emits FLAT startLine/endLine and no range object. */
const symbolLine = (s: any): number => {
  const flat = Number(s?.startLine ?? 0)
  if (flat > 0) return flat
  const nested = Number(s?.range?.startLine ?? s?.range?.start?.line ?? 0)
  return nested > 0 ? nested : 0
}
const edgeLine = (r: any): number => {
  const raw = r?.line_number
  if (typeof raw === "number" && raw > 0) return raw
  const n = Number(r?.range?.start?.line ?? 0)
  return n > 0 ? n : 0
}

// ─────────────────────────────────────────────────────── corpus draw
// IDENTICAL predicate and digest to ambiguity-split.ts, so the population here is
// provably the same set of files that produced the 5,181 class-B edges.
function draw(): { files: string[]; repos: Record<string, number>; digest: string } {
  const repos: Record<string, string[]> = {}
  const rd = (d: string): string[] => { try { return readdirSync(d) } catch { return [] } }
  for (const repo of rd(CR).sort()) {
    const dir = path.join(CR, repo)
    try {
      if (!statSync(dir).isDirectory()) continue
      if (!existsSync(path.join(dir, ".git"))) continue
    } catch { continue }
    let out = ""
    try {
      out = execFileSync("git", ["ls-files", "*.lua"], { cwd: dir, encoding: "utf8", maxBuffer: 1 << 28 })
    } catch { continue }
    const tracked = out.split("\n").map((s) => s.trim()).filter(Boolean).sort()
    if (tracked.length === 0) continue
    repos[repo] = tracked.slice(0, FILES_CAP).map((p) => path.join(repo, p))
  }
  const files = Object.values(repos).flat().sort()
  const h = createHash("sha256")
  for (const f of files) {
    let size = -1
    try { size = statSync(path.join(CR, f)).size } catch { /* absent */ }
    h.update(`${f}\t${size}\n`)
  }
  return { files, repos: Object.fromEntries(Object.entries(repos).map(([k, v]) => [k, v.length])), digest: h.digest("hex") }
}

/** The `string` node's payload: `childForFieldName("content")` -> `string_content`. */
function stringPayload(node: any): string | undefined {
  if (!node || node.type !== "string") return undefined
  const direct = node.childForFieldName("content")
  if (direct?.type === "string_content") return direct.text
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c && c.type === "string_content") return c.text
  }
  return undefined
}

/**
 * Every `string` argument of a call, INCLUDING the `require "mod"` sugar form and
 * the `pcall(require, "mod")` form the analyzer reads at :881-884.
 *
 * The grammar puts arguments under an `arguments` node
 * (`function_call name: (identifier) arguments: (arguments (string ...))`), so a
 * direct named-child scan sees the wrapper, not the string. An earlier revision of
 * this file scanned named children directly and attributed 5,397 of 5,485 dotted
 * `imports` targets to `notOnTree` — that was this defect, not a property of the
 * corpus. Recorded here because the first artifact in this lane to be wrong was
 * wrong in exactly that way.
 */
function callStringArgs(call: any): string[] {
  const out: string[] = []
  const push = (n: any): void => {
    if (!n) return
    if (n.type === "arguments") {
      for (let i = 0; i < n.namedChildCount; i++) push(n.namedChild(i))
      return
    }
    const v = stringPayload(n)
    if (v !== undefined) out.push(v)
  }
  for (let i = 0; i < call.namedChildCount; i++) push(call.namedChild(i))
  return out
}

/** The callee text of a call: `require`, `pcall`, `M.require`, ... */
function calleeText(call: any): string {
  const n = call.childForFieldName("name") ?? call.namedChild(0)
  if (!n) return ""
  if (n.type === "identifier" || n.type === "dot_index_expression" || n.type === "method_index_expression") return n.text
  return ""
}

const hasDot = (s: string): boolean => s.split(".").length > 1
const lastSegment = (s: string): string => {
  const parts = s.split(".")
  return parts[parts.length - 1]
}
const toModuleRelPath = (mod: string): string => {
  const parts = mod.split(".")
  const stem = parts[parts.length - 1]
  const dir = parts.slice(0, parts.length - 1).join("/")
  return dir.length > 0 ? `${dir}/${stem}.lua` : `${stem}.lua`
}

async function main(): Promise<void> {
  const { files, repos, digest } = draw()
  console.log(`draw: ${files.length} lua files from ${Object.keys(repos).length} repos  digest=${digest.slice(0, 12)}`)

  const wts: any = await import("web-tree-sitter")
  const WSP = wts.Parser ?? wts.default
  const WSL = wts.Language ?? wts.default
  await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new WSP()
  parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-lua.wasm"))))

  const published = new Map<string, Site[]>()
  const fileSet = new Set(files)
  const edges: Edge[] = []
  let parsedFiles = 0
  let symbolCount = 0
  const parseFailures: string[] = []
  const trees: { file: string; tree: any }[] = []

  for (const rel of files) {
    const abs = path.join(CR, rel)
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    let res: any
    try { res = await parseFile(abs, text, "lua") } catch (e: any) {
      parseFailures.push(`${rel}: ${String(e?.message ?? e).split("\n")[0]}`)
      continue
    }
    if (!res) { parseFailures.push(`${rel}: parseFile returned nothing`); continue }
    parsedFiles++

    for (const s of (res.symbols ?? []) as any[]) {
      const name = String(s?.name ?? "")
      if (name.length === 0) continue
      if (SCOPE_LABELS.has(name)) continue
      symbolCount++
      const kind = String(s?.kind ?? "")
      const arr = published.get(name)
      const site: Site = { file: rel, name, kind, startLine: symbolLine(s) }
      if (arr) arr.push(site)
      else published.set(name, [site])
    }
    for (const r of (res.relationships ?? []) as any[]) {
      const t = LABEL_ALIASES[String(r?.type ?? "")] ?? String(r?.type ?? "")
      const g = String(r?.target ?? "")
      if (t.length === 0 || g.length === 0) continue
      edges.push({ t, s: String(r?.source ?? ""), g, l: edgeLine(r), f: rel })
    }

    try { trees.push({ file: rel, tree: parser.parse(text) }) } catch { /* tree unavailable; attribution degrades */ }
  }
  console.log(`parsed ${parsedFiles}/${files.length}  symbols ${symbolCount}  edges ${edges.length}  trees ${trees.length}`)

  // ─────────────────────────────────── per-file structural origin sets
  interface FileOrigins { requireArg: Set<string>; bracketKey: Set<string>; qualifiedName: Set<string> }
  const origins = new Map<string, FileOrigins>()
  for (const { file, tree } of trees) {
    const o: FileOrigins = { requireArg: new Set(), bracketKey: new Set(), qualifiedName: new Set() }
    origins.set(file, o)
    if (!tree) continue
    const cursor = tree.walk()
    const visit = (): void => {
      const n = cursor.currentNode
      if (!n) return
      if (n.type === "dot_index_expression" || n.type === "method_index_expression") {
        if (hasDot(n.text)) o.qualifiedName.add(n.text)
      } else if (n.type === "bracket_index_expression") {
        const key = n.childForFieldName("field")
        const val = stringPayload(key)
        if (val && hasDot(val)) o.bracketKey.add(val)
      } else if (n.type === "function_call") {
        const callee = calleeText(n)
        const args = callStringArgs(n)
        if (callee === "require") {
          for (const v of args) if (hasDot(v)) o.requireArg.add(v)
        } else if (callee === "pcall" || callee === "xpcall") {
          // pcall(require, "mod") — the analyzer reads this form at :881-884.
          const firstNamed = n.childForFieldName("arguments")
          const firstIsRequire = firstNamed?.namedChild?.(0)?.text === "require"
          if (firstIsRequire) for (const v of args) if (hasDot(v)) o.requireArg.add(v)
        }
      }
      if (cursor.gotoFirstChild()) { do { visit() } while (cursor.gotoNextSibling()); cursor.gotoParent() }
    }
    visit()
    cursor.delete()
  }

  // ─────────────────────────────────────────── classify every dotted edge
  interface Bucket {
    edges: number
    origin: Record<string, number>
    candidates: Record<string, number>
    moduleFileExists: number
    moduleFileAbsent: number
    segmentInModuleFile: number
    segmentOnlyInModuleFile: number
    topTargets: Record<string, number>
  }
  const perType: Record<string, Bucket> = {}
  /** Edges whose type disagrees with the producer its emitter is documented to read. */
  const mismatches: Record<string, number> = {}
  /** Targets present under MORE THAN ONE producer, so the reader can see the overlap. */
  const multiOrigin: Record<string, Record<string, number>> = {}
  const examples: Record<string, Record<string, number>> = {}
  const fileSetNorm = new Set(files.map((f) => f.split(path.sep).join("/")))

  for (const e of edges) {
    if (!hasDot(e.g)) continue
    const seg = lastSegment(e.g)
    const cands = published.get(seg) ?? []
    const o = origins.get(e.f)
    const mem: OriginSet = {
      requireArg: o ? o.requireArg.has(e.g) : false,
      bracketKey: o ? o.bracketKey.has(e.g) : false,
      qualifiedName: o ? o.qualifiedName.has(e.g) : false,
    }
    const hits: Origin[] = []
    if (mem.requireArg) hits.push("requireArg")
    if (mem.bracketKey) hits.push("bracketKey")
    if (mem.qualifiedName) hits.push("qualifiedName")
    if (hits.length === 0) hits.push("notOnTree")
    if (hits.length > 1) {
      multiOrigin[e.t] ??= {}
      const k = hits.join("+")
      multiOrigin[e.t][k] = (multiOrigin[e.t][k] ?? 0) + 1
    }
    // the attribution is a CHECK: the producer each emitter is documented to read
    const expect: Record<string, keyof OriginSet> = { imports: "requireArg", references: "bracketKey", extends: "qualifiedName" }
    const want = expect[e.t]
    if (want && !mem[want]) {
      const key = `${e.t}:${hits.join("+") || "notOnTree"}`
      mismatches[key] = (mismatches[key] ?? 0) + 1
      examples[key] ??= {}
      examples[key][e.g] = (examples[key][e.g] ?? 0) + 1
    }
    const origin: string = hits.join("+")

    const b = perType[e.t] ?? (perType[e.t] = {
      edges: 0, origin: {}, candidates: {}, moduleFileExists: 0, moduleFileAbsent: 0,
      segmentInModuleFile: 0, segmentOnlyInModuleFile: 0, topTargets: {},
    })
    b.edges++
    b.origin[origin] = (b.origin[origin] ?? 0) + 1
    const n = cands.length
    const cb = n === 0 ? "0" : n === 1 ? "1" : n <= 3 ? "2-3" : n <= 10 ? "4-10" : ">10"
    b.candidates[cb] = (b.candidates[cb] ?? 0) + 1
    b.topTargets[e.g] = (b.topTargets[e.g] ?? 0) + 1

    if (mem.requireArg) {
      const relMod = toModuleRelPath(e.g)
      const repo = e.f.split(path.sep)[0]
      const absMod = path.posix.join(repo, relMod)
      const exists = fileSetNorm.has(absMod) || existsSync(path.join(CR, absMod))
      if (exists) {
        b.moduleFileExists++
        const inMod = cands.filter((c) => c.file === absMod).length
        if (inMod > 0) {
          b.segmentInModuleFile++
          if (inMod === n) b.segmentOnlyInModuleFile++
        }
      } else b.moduleFileAbsent++
    }
  }

  const trim = (r: Record<string, number>, n: number): Record<string, number> =>
    Object.fromEntries(Object.entries(r).sort((a, c) => c[1] - a[1]).slice(0, n))

  const head = createHash("sha256")
  head.update(digest)
  head.update("|symbols=" + symbolCount)
  head.update("|edges=" + edges.length)

  const out = {
    tool: "lua-classb-origin",
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    corpus: {
      root: CR,
      method: "git ls-files '*.lua' per repo, sorted, no cap (identical predicate to ambiguity-split.ts)",
      filesDrawn: files.length,
      repos,
      drawDigest: digest,
      headDigest: head.digest("hex"),
    },
    production: {
      filesParsed: parsedFiles,
      parseFailures: parseFailures,
      symbols: symbolCount,
      relationships: edges.length,
    },
    definitions: {
      requireArg: "the target is a `string` node that is an argument of a call whose name is `require`. The ONLY producer of an `imports` target (real-lua-analyzer.ts:978). The target names a MODULE.",
      bracketKey: "the target is a `string` node in the `field` of a `bracket_index_expression` — the source spelled T[\"a.b\"]. The only producer of a DOTTED `references` target. The target is a TABLE KEY.",
      qualifiedName: "the target is the text of a dot_index_expression / method_index_expression node. The shape of an `extends` metatable target.",
      notOnTree: "no producing node found in the edge's own file. Counted, never assumed away.",
      multiOrigin: "targets present under more than one producer in the same file, e.g. require(\"a.b.c\") and T[\"a.b.c\"]. Membership, not priority.",
      candidates: "how many declarations share the FINAL SEGMENT as a bare name in the draw — what the store would resolve the retarget to.",
      moduleFileExists: "requireArg only: the module path maps to a file in the draw (dots to slashes, .lua appended).",
      segmentInModuleFile: "requireArg only, module file EXISTS: that file declares a symbol named the final segment. Structural, not coincidental.",
      segmentOnlyInModuleFile: "requireArg only, module file EXISTS, and the final segment's candidates are ALL in that one file — so the retarget is unambiguous.",
      originMismatch: "the edge's type disagrees with the producer its own emitter is documented to read. A CHECK, not an assumption.",
    },
    perType,
    originMismatch: mismatches,
    originMismatchExamples: examples,
    multiOrigin,
  }

  mkdirSync(path.dirname(path.resolve(ROOT, OUT)), { recursive: true })
  writeFileSync(path.resolve(ROOT, OUT), JSON.stringify(out, null, 2) + "\n")
  for (const k of Object.keys(perType)) {
    const b = perType[k]
    console.log(`${k.padEnd(12)} dotted=${String(b.edges).padStart(6)} origin=${JSON.stringify(b.origin)} cand=${JSON.stringify(b.candidates)} modFile[+${b.moduleFileExists}/-${b.moduleFileAbsent}] segInMod=${b.segmentInModuleFile} segOnly=${b.segmentOnlyInModuleFile}`)
  }
  console.log(`\noriginMismatch: ${JSON.stringify(mismatches)}`)
  console.log(`wrote ${OUT}`)
}

main().catch((e) => { console.error(e); process.exit(1) })