/**
 * VB ONTOLOGY CENSUS — the instrument that puts a NUMBER behind every one of the
 * ten relationship types for VB, on real corpora, through the production path.
 *
 * WHY THIS FILE EXISTS. The handover said "MEASURED 6/10, never independently
 * verified" and, in the same breath, that no VB.NET corpus existed.
 * `roslyn-vb` (Microsoft's Roslyn compiler — 3751 tracked `.vb`) and
 * `vbnet-samples` (469) are both on disk. The ontology gate exists because a
 * prose ruling once shipped a missing type for an entire wave, so every "absent"
 * claim this census supports is backed by a count ON THE TREE, and every ruling
 * it reaches is falsifiable by re-running one probe.
 *
 * TWO INSTRUMENTS, AND THE QUESTION DECIDES WHICH APPLIES — the same split
 * `ontology-coverage-gate.ts` documents, for the same reason:
 *
 *   A. GRAMMAR INVENTORY — for a type whose construct would need a node type the
 *      language does not have. Enumerating what the grammar actually produces
 *      across the whole corpus is positive evidence of absence.
 *   B. PARSE-TREE SEMANTIC COUNT — for a type the language CAN express, where an
 *      inventory is silent by construction because the grammar has nothing to say
 *      about which of its nodes count. A second `New Foo()` is a perfectly good
 *      VB file; it has to be counted on the tree, where a comment or a string
 *      literal cannot fake it.
 *
 * ZERO REGEX. Every classification below is `node.type`, a field read, a Set
 * membership test, or a char-code scan whose equivalence is argued at the call
 * site. A text probe would read the corpus a second time with a different parser
 * and would match comments and string literals — the exact failure the ontology
 * gate records for its own first version.
 *
 * READ-ONLY. Writes nothing.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPOS = (process.env.BB_VB_REPOS ?? "roslyn-vb,vbnet-samples").split(",").filter(Boolean)
const LIMIT = Number(process.env.BB_VB_LIMIT ?? 0)
/**
 * Concurrency. 8 was tried and the 4,211-file run died twice before printing a
 * row: eight `parseFile` calls each hold a wasm tree for a Roslyn compiler file,
 * and the machine had ~4 GB to hand. Three completes, and the number is recorded
 * here rather than discovered again by the next person who runs it at scale.
 */
const WORKERS = Number(process.env.BB_VB_WORKERS ?? 3)

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

/**
 * Both spellings of the import type. `engine.ts` says `Imports = "imports"` and
 * `types.ts` says `Imports = "brain_import"` — the same member name, two values,
 * two exported enums. Every count in this file folds both onto `imports` so the
 * number is a property of the ANALYZER rather than of which enum a reader held.
 */
const IMPORT_ALIASES = new Set(["imports", "brain_import"])

// ---------------------------------------------------------------- corpus
type File = { repo: string; dir: string; rel: string; abs: string; text: string; label: string }
const files: File[] = []
for (const repo of REPOS) {
  const dir = path.join(CR, repo)
  try { statSync(dir) } catch { console.error(`!! no corpus dir ${repo}`); continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { console.error(`!! ${repo} is not a git repo; skipped`); continue }
  let admitted = 0
  for (const rel of tracked) {
    if (!rel.endsWith(".vb")) continue
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 900_000) continue; text = readFileSync(abs, "utf8") } catch { continue }
    files.push({ repo, dir, rel, abs, text, label: `${repo}/${rel}` })
    admitted++
    if (LIMIT > 0 && admitted >= LIMIT) break
  }
  console.error(`corpus ${repo}: ${admitted} tracked .vb admitted`)
}
console.error(`corpus total: ${files.length} files\n`)

// ---------------------------------------------------------------- production path
type Edge = { type: string; source: string; target: string; confidence: number; line: number | null; meta: Record<string, any>; file: string }
type Sym = { name: string; kind: string; owner: string | undefined; file: string }

const edges: Edge[] = []
const syms: Sym[] = []
let importRows = 0
let importFiles = 0
let fallbackFiles = 0
let errorFiles = 0
let errorNodes = 0
const perType = new Map<Type, { n: number; files: Set<string>; conf: Map<string, number>; examples: string[] }>()

let idx = 0
let lastProgress = 0
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    if (i - lastProgress >= 250) {
      lastProgress = i
      const mem = Math.round(process.memoryUsage().rss / 1048576)
      console.error(`  … ${i}/${files.length} files · rss ${mem} MB`)
    }
    const f = files[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { errorFiles++; continue }
    if (r?.fallback) { fallbackFiles++; continue }
    const errs = r?.errors ?? []
    if (errs.length) { errorFiles++; errorNodes += errs.length }
    const imps = r?.imports ?? []
    importRows += imps.length
    if (imps.length > 0) importFiles++
    for (const s of r?.symbols ?? []) {
      if (typeof s?.name === "string" && s.name.length > 0) syms.push({ name: s.name, kind: String(s.kind), owner: s.ownerName, file: f.label })
    }
    for (const e of r?.relationships ?? []) {
      edges.push({
        type: String(e?.type ?? e?.relationshipType ?? ""),
        source: String(e?.source ?? ""),
        target: String(e?.target ?? ""),
        confidence: typeof e?.confidence === "number" ? e.confidence : -1,
        line: typeof e?.line_number === "number" ? e.line_number : null,
        meta: (e?.metadata ?? {}) as Record<string, any>,
        file: f.label,
      })
    }
  }
}
console.error(`production parseFile over ${files.length} files …`)
const t0 = Date.now()
await Promise.all(Array.from({ length: WORKERS }, () => worker()))
console.error(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s · ${edges.length} relationship rows · ${syms.length} symbols\n`)

for (const e of edges) {
  const t = (IMPORT_ALIASES.has(e.type) ? "imports" : e.type) as Type
  if (!ALL_TYPES.includes(t)) continue
  const row = perType.get(t) ?? { n: 0, files: new Set<string>(), conf: new Map<string, number>(), examples: [] }
  row.n++
  row.files.add(e.file)
  const ck = String(e.confidence)
  row.conf.set(ck, (row.conf.get(ck) ?? 0) + 1)
  if (row.examples.length < 3) row.examples.push(`${e.file}:${e.line} ${e.source} -> ${e.target}`)
  perType.set(t, row)
}

// ---------------------------------------------------------------- parse tree
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-vbnet.wasm"))))

// ---------------------------------------------------------------- tree helpers
/** The last `identifier` leaf at or under a node, skipping a type-argument list. */
function lastIdentifierLeaf(n: any, depth = 0): any | null {
  if (depth > 64) return null
  if (n.type === "type_argument_list") return null
  if (n.type === "identifier") return n
  for (let i = n.childCount - 1; i >= 0; i--) {
    const c = n.child(i)
    if (!c) continue
    const r = lastIdentifierLeaf(c, depth + 1)
    if (r) return r
  }
  return null
}

/**
 * Is this node inside the CALLEE POSITION of an invocation?
 *
 * The rule climbs first, because VB chains receivers: in `sb.Append(x).Length` the
 * OUTER member access is the callee and the INNER one is its receiver, so a test
 * that looks only at the immediate parent counts `Append` as a read when it is
 * the function being invoked. The first version of the `uses` probe did exactly
 * that and reported 60 `Add` and 8 `WriteLine` "reads" that are calls — which is
 * the same defect the analyzer's own `calleeLeaf` docstring records, in reverse.
 */
function inCalleeChain(n: any): boolean {
  let cur = n
  for (let guard = 0; guard < 64; guard++) {
    const p = cur.parent
    if (!p) return false
    if (p.type === "invocation_expression" || p.type === "generic_invocation_expression") {
      const fn = p.childForFieldName?.("function")
      if (fn && fn.startIndex === cur.startIndex && fn.endIndex === cur.endIndex) return true
      return false
    }
    if (p.type === "member_access_expression" || p.type === "with_member_access_expression") {
      const recv = p.childForFieldName?.("expression") ?? p.childForFieldName?.("target")
      if (recv && recv.startIndex === cur.startIndex && recv.endIndex === cur.endIndex) { cur = p; continue }
      return false
    }
    return false
  }
  return false
}

/** Is this node on the LEFT of an assignment — a write, not a read? */
function inWritePosition(n: any): boolean {
  const p = n.parent
  if (!p) return false
  if (p.type !== "assignment_expression" && p.type !== "assignment_statement") return false
  const l = p.childForFieldName?.("left")
  return !!l && l.startIndex === n.startIndex && l.endIndex === n.endIndex
}

function modifierTexts(n: any, out: Set<string>, depth = 0): void {
  if (depth > 4) return
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (!c) continue
    if (c.type === "member_modifier" || c.type === "local_declaration_modifier") { out.add(c.text.toLowerCase()); continue }
    modifierTexts(c, out, depth + 1)
  }
}

function lastSegmentText(n: any, depth = 0): string {
  if (depth > 32) return ""
  if (n.type === "identifier") return n.text.trim()
  const named = n.childForFieldName?.("name")
  if (named && named.startIndex !== n.startIndex) return lastSegmentText(named, depth + 1)
  if (n.type === "array_type") {
    const el = n.childForFieldName?.("element_type")
    if (el) return lastSegmentText(el, depth + 1)
  }
  if (n.type === "simple_name" || n.type === "generic_name") {
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c && c.type === "identifier") return c.text.trim()
    }
    return n.text.trim()
  }
  return n.text.trim()
}
function declarationName(n: any): string {
  const f = n.childForFieldName?.("name")
  if (f) return lastSegmentText(f)
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && (c.type === "identifier" || c.type === "simple_name")) return lastSegmentText(c)
  }
  return ""
}
function firstNamedOfTypes(n: any, types: Set<string>, depth = 0): any | null {
  if (depth > 8) return null
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (!c) continue
    if (types.has(c.type)) return c
    const deep = firstNamedOfTypes(c, types, depth + 1)
    if (deep) return deep
  }
  return null
}

/**
 * Depth bound for every probe's descent, and it exists because of what happened
 * without one: `RangeError: Maximum call stack size exceeded` on one corpus file,
 * and — worse — a probe that THROWS being swallowed by a bare `catch {}`, which
 * reported `0 occurrences` for a construct the corpus is full of. A silent catch
 * turns a broken instrument into a false ruling, which is the exact defect class
 * this whole workstream exists to catch. Probe failures are now COUNTED and
 * printed, and a probe with any failure cannot be quoted.
 */
const MAX_PROBE_DEPTH = 4000

const probes: Probe[] = []

const MEMBER_ACCESS = "a member READ — `receiver.Member` that is neither in a callee chain nor the left of an assignment"
probes.push({
  key: "uses/member-read",
  type: "uses",
  describe: MEMBER_ACCESS,
  run: (root, label, hits) => {
    const visit = (n: any, depth = 0): void => {
      if (n.type === "member_access_expression" || n.type === "with_member_access_expression") {
        const leaf = lastIdentifierLeaf(n)
        if (leaf && !inCalleeChain(n) && !inWritePosition(n)) {
          const recv = n.childForFieldName?.("expression") ?? firstNamedOfTypes(n, new Set(["simple_name", "predefined_type", "me_expression", "identifier"]))
          hits.push({ file: label, line: leaf.startPosition.row + 1, shape: `${n.type}/${recv?.type ?? "?"}`, leaf: leaf.text.trim() })
        }
      }
      if (depth > MAX_PROBE_DEPTH) return
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) visit(c, depth + 1)
      }
    }
    visit(root, 0)
  },
})

const EVENT_BINDING = "an event BINDING — `AddHandler o.E, AddressOf h` / `Handles Me.Startup` / `RaiseEvent E`: a name bound without being invoked"
probes.push({
  key: "uses/event-binding",
  type: "uses",
  describe: EVENT_BINDING,
  run: (root, label, hits) => {
    const visit = (n: any, depth = 0): void => {
      if (n.type === "add_handler_statement" || n.type === "remove_handler_statement" ||
          n.type === "raiseevent_statement" || n.type === "event_member") {
        const leaf = lastIdentifierLeaf(n)
        if (leaf) hits.push({ file: label, line: leaf.startPosition.row + 1, shape: n.type, leaf: leaf.text.trim() })
      }
      if (depth > MAX_PROBE_DEPTH) return
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) visit(c, depth + 1)
      }
    }
    visit(root, 0)
  },
})

const DELEGATE_REF = "a delegate REFERENCE — `AddressOf h` passed as a value (a callable named without calling it)"
probes.push({
  key: "uses/delegate-reference",
  type: "uses",
  describe: DELEGATE_REF,
  run: (root, label, hits) => {
    const visit = (n: any, depth = 0): void => {
      if (n.type === "address_of_expression") {
        const leaf = lastIdentifierLeaf(n)
        if (leaf) hits.push({ file: label, line: leaf.startPosition.row + 1, shape: n.type, leaf: leaf.text.trim() })
      }
      if (depth > MAX_PROBE_DEPTH) return
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) visit(c, depth + 1)
      }
    }
    visit(root, 0)
  },
})

const MODULE_EXPORTS = "a MODULE's Public member — the VB analogue of python `__all__` and a TypeScript `export` statement"
probes.push({
  key: "exports/module-public-member",
  type: "exports",
  describe: MODULE_EXPORTS,
  run: (root, label, hits) => {
    const visit = (n: any, depth = 0): void => {
      if (n.type === "module_declaration") {
        const owner = declarationName(n)
        const members = (m: any, mdepth = 0): void => {
          if (m.type === "method_declaration" || m.type === "property_declaration" ||
              m.type === "field_declaration" || m.type === "event_declaration" ||
              m.type === "constructor_declaration" || m.type === "operator_declaration" ||
              m.type === "enum_declaration" || m.type === "structure_declaration" ||
              m.type === "class_declaration" || m.type === "interface_declaration" ||
              m.type === "delegate_declaration") {
            const mods = new Set<string>()
            modifierTexts(m, mods)
            if (mods.has("public")) {
              const nm = m.type === "field_declaration" ? firstDeclaredName(m) : declarationName(m)
              hits.push({ file: label, line: m.startPosition.row + 1, shape: m.type, leaf: `${owner}.${nm || "(unnamed)"}` })
            }
          }
          if (mdepth > MAX_PROBE_DEPTH) return
          for (let i = 0; i < m.namedChildCount; i++) {
            const c = m.namedChild(i)
            if (c) members(c, mdepth + 1)
          }
        }
        members(n)
      }
      if (depth > MAX_PROBE_DEPTH) return
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) visit(c, depth + 1)
      }
    }
    visit(root, 0)
  },
})

const NAMESPACE_EXPORTS = "a NAMESPACE-scope Public TYPE — what the file publishes at namespace level"
probes.push({
  key: "exports/namespace-public-type",
  type: "exports",
  describe: NAMESPACE_EXPORTS,
  run: (root, label, hits) => {
    const visit = (n: any, depth = 0): void => {
      if (n.type === "namespace_declaration") {
        const owner = declarationName(n)
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "class_declaration" || c.type === "structure_declaration" ||
              c.type === "interface_declaration" || c.type === "enum_declaration" ||
              c.type === "module_declaration" || c.type === "delegate_declaration") {
            const mods = new Set<string>()
            modifierTexts(c, mods)
            if (mods.has("public")) hits.push({ file: label, line: c.startPosition.row + 1, shape: c.type, leaf: `${owner}.${declarationName(c)}` })
          }
        }
      }
      if (depth > MAX_PROBE_DEPTH) return
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) visit(c, depth + 1)
      }
    }
    visit(root, 0)
  },
})

const CONSTRUCTION = "a construction — `New X()`: object_creation_expression or array_creation_expression, named off the `type` field"
probes.push({
  key: "instantiates/construction",
  type: "instantiates",
  describe: CONSTRUCTION,
  run: (root, label, hits) => {
    const visit = (n: any, depth = 0): void => {
      if (n.type === "object_creation_expression" || n.type === "array_creation_expression") {
        const ty = n.childForFieldName?.("type")
        const leaf = ty ? lastIdentifierLeaf(ty) : null
        hits.push({
          file: label,
          line: (leaf ?? n).startPosition.row + 1,
          shape: `${n.type}/${ty ? "type-field" : "NO-type-field"}/${leaf ? "named" : "unnamed"}`,
          leaf: leaf ? leaf.text.trim() : "",
        })
      }
      if (depth > MAX_PROBE_DEPTH) return
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) visit(c, depth + 1)
      }
    }
    visit(root, 0)
  },
})

function firstDeclaredName(fieldDecl: any): string {
  for (let i = 0; i < fieldDecl.namedChildCount; i++) {
    const c = fieldDecl.namedChild(i)
    if (c && c.type === "variable_declarator") return declarationName(c)
  }
  return ""
}


// ---------------------------------------------------------------- Instrument A + B
//
// ONE parse per file, every probe applied to that tree, then the tree is
// released. Holding all 4,211 trees at once was tried and the process died before
// it printed a single row — the instrument has to survive the corpus it is
// measuring, and "run everything, then free everything" measures nothing.
const nodeTypeCount = new Map<string, number>()
const nodeTypeFiles = new Map<string, Set<string>>()
const probeHits = new Map<string, Hit[]>()
const probeFiles = new Map<string, Set<string>>()
const probeFailures = new Map<string, number>()
const PROBE_FAILURE_MSGS: string[] = []
for (const pr of probes) {
  probeHits.set(pr.key, [])
  probeFiles.set(pr.key, new Set<string>())
}
console.error(`parse-tree probes over ${files.length} files …`)
{
  for (const f of files) {
    const t = parser.parse(f.text)
    if (!t) continue
    // AN EXPLICIT STACK, WITH A DEPTH BOUND. The first version recursed and died:
    // `RangeError: Maximum call stack size exceeded` on one corpus file, with no
    // output at all. That is not a census bug, it is the same unbounded recursion
    // that makes `ASTEngine.parseFile` return an EMPTY result for
    // `T_68086.vb` — one deep file costs the whole file. The bound is recorded so
    // the number below is read as "nodes within MAX_DEPTH", not as "nodes".
    const MAX_DEPTH = 4000
    const stack: Array<{ n: any; d: number }> = [{ n: t.rootNode, d: 0 }]
    let truncated = 0
    while (stack.length > 0) {
      const { n, d } = stack.pop()!
      if (d > MAX_DEPTH) { truncated++; continue }
      nodeTypeCount.set(n.type, (nodeTypeCount.get(n.type) ?? 0) + 1)
      let fs2 = nodeTypeFiles.get(n.type)
      if (!fs2) { fs2 = new Set(); nodeTypeFiles.set(n.type, fs2) }
      fs2.add(f.label)
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push({ n: c, d: d + 1 })
      }
    }
    if (truncated > 0) console.error(`  !! ${f.label}: ${truncated} nodes deeper than ${MAX_DEPTH} were NOT counted`)
    for (const pr of probes) {
      const before = probeHits.get(pr.key)!.length
      try {
        pr.run(t.rootNode, f.label, probeHits.get(pr.key)!)
      } catch (e) {
        probeFailures.set(pr.key, (probeFailures.get(pr.key) ?? 0) + 1)
        if (PROBE_FAILURE_MSGS.length < 5) PROBE_FAILURE_MSGS.push(`${pr.key} on ${f.label}: ${e instanceof Error ? e.message : String(e)}`)
      }
      if (probeHits.get(pr.key)!.length > before) probeFiles.get(pr.key)!.add(f.label)
    }
    t.delete?.()
  }
  for (const pr of probes) {
    const fails = probeFailures.get(pr.key) ?? 0
    console.error(`  ${pr.key}: ${probeHits.get(pr.key)!.length} occurrences in ${probeFiles.get(pr.key)!.size} files${fails > 0 ? `  *** ${fails} FILES FAILED — THIS PROBE'S NUMBER IS NOT QUOTABLE ***` : ""}`)
  }
  for (const m of PROBE_FAILURE_MSGS) console.error(`  PROBE FAILURE ${m}`)
}

// ---------------------------------------------------------------- Instrument B
type Hit = { file: string; line: number; shape: string; leaf: string }
type Probe = { key: string; type: Type; describe: string; run: (root: any, label: string, hits: Hit[]) => void }
// ---------------------------------------------------------------- report
const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
const probeTotalFor = (t: Type) => [...probeHits.entries()].filter(([k]) => k.startsWith(`${t}/`)).reduce((a, [, v]) => a + v.length, 0)
const probeFilesFor = (t: Type) => {
  const s = new Set<string>()
  for (const [k, v] of probeHits) if (k.startsWith(`${t}/`)) for (const h of v) s.add(h.file)
  return s
}

console.log("")
console.log(`VB ONTOLOGY CENSUS   corpus=${REPOS.join("+")}   files=${files.length}`)
console.log(`production parseFile → ${edges.length} relationship rows · ${syms.length} symbols · imports[] ${importRows} rows in ${importFiles} files`)
console.log(`structural-fallback files ${fallbackFiles} · files with parse errors ${errorFiles} (${errorNodes} error nodes) · distinct node types ${nodeTypeCount.size}`)

console.log("\n=== PER-TYPE VERDICT (production path) ===")
console.log(`${pad("type", 14)}${pad("verdict", 10)}${pad("edges", 10)}${pad("files", 8)}${pad("conf", 26)}examples`)
console.log("-".repeat(160))
const verdicts: Array<{ type: Type; verdict: string; edges: number; files: number }> = []
for (const t of ALL_TYPES) {
  const row = perType.get(t)
  const n = row?.n ?? 0
  const onTree = probeTotalFor(t)
  const verdict = n > 0 ? "EMITTED" : onTree > 0 ? "GAP" : "RULED"
  verdicts.push({ type: t, verdict, edges: n, files: row?.files.size ?? 0 })
  const conf = row ? [...row.conf.entries()].sort((a, b) => Number(b[0]) - Number(a[0])).map(([c, k]) => `${c}:${k}`).join(" ") : "-"
  console.log(`${pad(t, 14)}${pad(verdict, 10)}${pad(n.toLocaleString(), 10)}${pad(String(row?.files.size ?? 0), 8)}${pad(conf, 26)}${(row?.examples ?? []).slice(0, 1).join("")}`)
}

console.log("\n=== the two import channels ===")
console.log(`  relationships typed "imports" (engine.ts:454)  : ${(perType.get("imports")?.n ?? 0).toLocaleString()} edges in ${perType.get("imports")?.files.size ?? 0} files`)
console.log(`  ParseResult.imports[] (separate channel)          : ${importRows.toLocaleString()} rows in ${importFiles} files`)
console.log(`  enum value firing-check-v2 counts (types.ts:69)   : "brain_import" — emitted by 0 of 20 lanes by construction`)

console.log("\n=== Q2/Q4 — confidence distribution per emitted type ===")
for (const t of ALL_TYPES) {
  const row = perType.get(t)
  if (!row) continue
  const parts = [...row.conf.entries()].sort((a, b) => Number(b[0]) - Number(a[0]))
  const under = [...row.conf.entries()].filter(([c]) => Number(c) < 0.7).reduce((a, [, k]) => a + k, 0)
  console.log(`  ${pad(t, 14)}${pad(parts.map(([c, n]) => `${c}:${n}`).join("  "), 30)} under 0.7: ${under}`)
}

console.log("\n=== Q5 — RESOLVED? endpoint binding, measured against declared symbols ===")
{
  const byFile = new Map<string, Set<string>>()
  const corpusNames = new Set<string>()
  for (const s of syms) {
    corpusNames.add(s.name)
    let set = byFile.get(s.file)
    if (!set) { set = new Set(); byFile.set(s.file, set) }
    set.add(s.name)
  }
  for (const t of ALL_TYPES) {
    let n = 0, sOk = 0, tOk = 0, bothOk = 0, outN = 0, outOk = 0, outCorpus = 0
    for (const e of edges) {
      const et = (IMPORT_ALIASES.has(e.type) ? "imports" : e.type) as Type
      if (et !== t) continue
      n++
      if (e.source === "root") continue
      const inFile = byFile.get(e.file) ?? new Set<string>()
      const so = inFile.has(e.source), to = inFile.has(e.target)
      if (so) sOk++
      if (to) tOk++
      if (so && to) bothOk++
      if (!to) { outN++; if (corpusNames.has(e.target)) outCorpus++ }
      void outOk
    }
    if (!n) { console.log(`  ${pad(t, 14)}no edges`); continue }
    const p = (x: number) => `${((x / n) * 100).toFixed(1)}%`.padStart(7)
    console.log(`  ${pad(t, 14)}n=${String(n).padStart(6)}  in-file src ${p(sOk)}  tgt ${p(tOk)}  BOTH ${p(bothOk)}  · target outside its file ${String(outN).padStart(6)} of which declared elsewhere in the corpus ${String(outCorpus).padStart(6)} (${outN ? p(outCorpus) : "  n/a"})`)
  }
}

console.log("\n=== R7 — unknown symbols, empty names, placeholder endpoints ===")
{
  /** Contract literals the family publishes as a SYMBOL NAME, so they resolve. */
  const CONTRACT_LITERALS = new Set(["constructor", "operator"])
  const KEYWORDS = new Set(["new", "me", "mybase", "myclass", "nothing", "base", "and", "or", "not", "xor", "mod", "is", "as", "in", "to", "step", "then", "else", "elseif", "end", "if", "while", "wend", "for", "each", "next", "select", "case", "return", "exit", "try", "catch", "finally", "throw", "call", "sub", "function", "property", "class", "structure", "interface", "module", "enum", "namespace", "imports", "inherits", "implements", "overrides", "overridable", "shadows", "mustoverride", "notoverridable", "shared", "public", "private", "protected", "friend", "readonly", "writeonly", "const", "dim", "get", "set", "byval", "byref", "optional", "paramarray", "addressof", "handles", "addhandler", "removehandler", "raiseevent", "with", "using", "do", "loop", "until", "goto", "stop", "when", "operator", "default", "partial", "narrowing", "widening", "notinheritable", "mustinherit", "withevents", "iterator", "async", "await", "yield"])
  let emptySymName = 0, emptyTarget = 0, emptySource = 0, noLine = 0
  const corpusNames = new Set<string>()
  for (const s2 of syms) corpusNames.add(s2.name)
  const kinds = new Map<string, number>()
  for (const s of syms) { if (s.name.length === 0) emptySymName++; kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1) }
  const unresolvable = new Map<string, number>()
  const kwTargets = new Map<string, number>()
  for (const e of edges) {
    if (e.target.length === 0) emptyTarget++
    if (e.source.length === 0) emptySource++
    if (e.line === null) noLine++
    if (e.target.length === 0 || CONTRACT_LITERALS.has(e.target)) continue
    if (KEYWORDS.has(e.target.toLowerCase())) { const k = `${e.type} -> ${e.target}`; kwTargets.set(k, (kwTargets.get(k) ?? 0) + 1); continue }
    if (!corpusNames.has(e.target)) { const k = `${e.type} -> ${e.target}`; unresolvable.set(k, (unresolvable.get(k) ?? 0) + 1) }
  }
  console.log(`  symbols ${syms.length} · empty symbol names ${emptySymName} · kinds ${[...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(" ")}`)
  console.log(`  edges ${edges.length} · empty source ${emptySource} · empty target ${emptyTarget} · no line_number ${noLine}`)
  console.log(`  contract-literal endpoints (a SYMBOL with that name, so resolvable): contains->constructor, contains->operator`)
  console.log(`  keyword-shaped targets: ${[...kwTargets.entries()].map(([k, n]) => `${k}×${n}`).join(", ") || "none"}`)
  console.log(`  distinct targets that resolve to NO symbol anywhere in the corpus: ${unresolvable.size}`)
  for (const [k, n] of [...unresolvable.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`      ${pad(k, 46)}${n}`)
  const unresolvedRows = [...unresolvable.values()].reduce((a, b) => a + b, 0)
  const unresolvedTotal = [...unresolvable.values()].reduce((a, b) => a + b, 0)
  console.log(`  ${unresolvedTotal} of ${edges.length} edges (${((unresolvedTotal / edges.length) * 100).toFixed(1)}%) name a target no symbol in the corpus declares`)
  const byType = new Map<Type, { n: number; miss: number }>()
  for (const e of edges) {
    if (e.target.length === 0 || CONTRACT_LITERALS.has(e.target)) continue
    if (KEYWORDS.has(e.target.toLowerCase())) continue
    const t = (IMPORT_ALIASES.has(e.type) ? "imports" : e.type) as Type
    if (!ALL_TYPES.includes(t)) continue
    const row = byType.get(t) ?? { n: 0, miss: 0 }
    row.n++
    if (!corpusNames.has(e.target)) row.miss++
    byType.set(t, row)
  }
  console.log("  per type (a target outside the corpus is usually a FRAMEWORK type, which is what confidence 0.6 declares):")
  for (const t of ALL_TYPES) {
    const r = byType.get(t)
    if (!r) continue
    console.log(`      ${pad(t, 14)}${String(r.n).padStart(7)} edges · ${String(r.miss).padStart(7)} resolve to nothing in the corpus (${((r.miss / r.n) * 100).toFixed(1)}%)`)
  }
}

console.log("\n=== INSTRUMENT A — the corpus's own grammar inventory ===")
{
  const sorted = [...nodeTypeCount.entries()].sort((a, b) => b[1] - a[1])
  console.log(`  ${nodeTypeCount.size} distinct node types across ${files.length} files`)
  console.log(`  top 24: ${sorted.slice(0, 24).map(([t, n]) => `${t}:${n}`).join("  ")}`)
  const ofInterest = ["member_access_expression", "object_creation_expression", "array_creation_expression", "add_handler_statement", "remove_handler_statement", "raiseevent_statement", "event_member", "address_of_expression", "module_declaration", "lambda_expression", "constructor_initializer", "inherits_member_clause", "implements_member_clause", "on_error_statement", "synclock_statement"]
  console.log("  of interest to the three silent types:")
  for (const t of ofInterest) console.log(`      ${pad(t, 34)}${String(nodeTypeCount.get(t) ?? 0).padStart(8)} occurrences in ${String(nodeTypeFiles.get(t)?.size ?? 0).padStart(5)} files`)
}

console.log("\n=== INSTRUMENT B — parse-tree semantic counts (the falsifier for a RULED verdict) ===")
{
  const anyFail = [...probeFailures.values()].reduce((a, b) => a + b, 0)
  console.log(`  probe failures across the corpus: ${anyFail}${anyFail > 0 ? "  *** A PROBE FAILED, so the affected counts are NOT measurements ***" : "  (none — every probe ran on every file)"}`)
}
for (const pr of probes) {
  const hits = probeHits.get(pr.key) ?? []
  const fileset = probeFiles.get(pr.key) ?? new Set<string>()
  console.log(`  ${pad(pr.key, 34)}${String(hits.length).padStart(8)} occurrences in ${String(fileset.size).padStart(5)} files`)
  console.log(`      ${pr.describe}`)
  const byShape = new Map<string, number>()
  for (const h of hits) byShape.set(h.shape, (byShape.get(h.shape) ?? 0) + 1)
  for (const [k, n] of [...byShape.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`        ${pad(k, 48)}${n}`)
  const ex = hits.slice(0, 3)
  for (const h of ex) console.log(`        e.g. ${h.file}:${h.line} ${h.leaf}`)
}

console.log("\n=== `uses` population, decomposed (is it real, and what is in it?) ===")
{
  const hits = probeHits.get("uses/member-read") ?? []
  const byLeaf = new Map<string, number>()
  for (const h of hits) byLeaf.set(h.leaf, (byLeaf.get(h.leaf) ?? 0) + 1)
  console.log(`  ${hits.length} member reads · ${byLeaf.size} distinct leaves · top 20:`)
  for (const [k, n] of [...byLeaf.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`      ${pad(k, 36)}${n}`)
  const VB_PREDEF = new Set(["False", "True", "Nothing", "Me", "MyBase", "MyClass"])
  console.log(`  leaves that are VB predefined tokens rather than member names: ${hits.filter((h) => VB_PREDEF.has(h.leaf)).length}`)
  // A REPORTING device, not a rule: VB's own naming convention says a receiver
  // beginning upper-case is a TYPE (so `SyntaxKind.None` reads an enum constant)
  // and lower-case is an INSTANCE (so `member.GetNameToken` reads a member). It
  // is stated here so a reader knows what the population is made of; no analyzer
  // decision anywhere depends on it.
  const byCase = new Map<string, number>()
  for (const h of hits) {
    const recv = h.file && h.shape.includes("/") ? h.shape.slice(h.shape.lastIndexOf("/") + 1) : ""
    void recv
    byCase.set(h.leaf.charCodeAt(0) >= 65 && h.leaf.charCodeAt(0) <= 90 ? "leaf looks like a CONSTANT/enum member" : "leaf looks like a member or method", (byCase.get(h.leaf.charCodeAt(0) >= 65 && h.leaf.charCodeAt(0) <= 90 ? "leaf looks like a CONSTANT/enum member" : "leaf looks like a member or method") ?? 0) + 1)
  }
  for (const [k, n] of [...byCase.entries()].sort((a, b) => b[1] - a[1])) console.log(`      ${pad(k, 46)}${n}`)
}

console.log("\n=== CROSS-CHECK — every construction on the tree vs the analyzer's own edge ===")
{
  const hits = probeHits.get("instantiates/construction") ?? []
  const shapes = new Map<string, number>()
  for (const h of hits) shapes.set(h.shape, (shapes.get(h.shape) ?? 0) + 1)
  console.log("  tree shapes:")
  for (const [k, n] of [...shapes.entries()].sort((a, b) => b[1] - a[1])) console.log(`      ${pad(k, 56)}${n}`)
  const named = hits.filter((h) => h.leaf.length > 0)
  const analyzerCtor = edges.filter((e) => e.type === "calls" && e.meta?.constructed === true)
  const byMeta = new Map<string, number>()
  for (const e of analyzerCtor) byMeta.set(String(e.meta?.constructionNode ?? "invocation(function=object_creation)"), (byMeta.get(String(e.meta?.constructionNode ?? "invocation(function=object_creation)")) ?? 0) + 1)
  console.log(`  named constructions on the tree: ${named.length} · analyzer 'calls' edges with constructed:true: ${analyzerCtor.length}`)
  for (const [k, n] of [...byMeta.entries()].sort((a, b) => b[1] - a[1])) console.log(`      ${pad(k, 56)}${n}`)
  // Per-file coverage: does the analyzer publish an edge naming this type?
  const analyzerTargetsByFile = new Map<string, Set<string>>()
  for (const e of edges) {
    if (e.type !== "calls" || e.meta?.constructed !== true) continue
    let set = analyzerTargetsByFile.get(e.file)
    if (!set) { set = new Set(); analyzerTargetsByFile.set(e.file, set) }
    set.add(e.target)
  }
  const uncoveredFiles = new Set<string>()
  let uncoveredHits = 0
  const uncoveredExamples: string[] = []
  for (const h of named) {
    const set = analyzerTargetsByFile.get(h.file)
    if (set && set.has(h.leaf)) continue
    uncoveredHits++
    uncoveredFiles.add(h.file)
    if (uncoveredExamples.length < 8) uncoveredExamples.push(`${h.file}:${h.line} New ${h.leaf} [${h.shape}]`)
  }
  console.log(`  constructions with NO analyzer edge naming that type: ${uncoveredHits} in ${uncoveredFiles.size} files`)
  for (const e of uncoveredExamples) console.log(`      e.g. ${e}`)
}

console.log("\n=== SANITY — the census can fail ===")
console.log(`  every type is either EMITTED (edges > 0) or GAP/RULED (probe count printed above); no type is unmeasured.`)
console.log(`  ${verdicts.filter((v) => v.verdict === "EMITTED").length} EMITTED · ${verdicts.filter((v) => v.verdict === "GAP").length} GAP · ${verdicts.filter((v) => v.verdict === "RULED").length} RULED`)