/**
 * ZIG UNRESOLVED SPLIT — the 4,251 decomposed by WHAT THE RECEIVER IS.
 *
 * ## Why a second instrument
 *
 * `unresolved-census.ts` says how many unresolved edges name a module, a binding receiver or a
 * published declaration. It cannot say *which kind of receiver* the bulk of them have, because
 * the analyzer publishes only the LEAF for a receiver it refused to qualify (`self.allocator.alloc`
 * -> `alloc`) and the written form has to be read back out of the edge's own metadata. That is
 * what this file does, and it needs the SOURCE for one thing the edge does not carry: which names
 * the file binds to `@cImport`, to a bare `@import`, to a relative-path `@import`, and which are
 * locals or parameters.
 *
 * TWO INSTRUMENTS, STATED APART. The edges and every count of them come from PRODUCTION
 * `parseFile` (`src/ast/pool-worker`) over the same stride sample `incoming-gate.ts` draws. The
 * source model is a `web-tree-sitter` walk with the PINNED `wasm/tree-sitter-zig.wasm`, used only
 * to name the receiver; it must not be read as a second measurement of the analyzer.
 *
 * ## The buckets
 *
 *   cimport-member          the receiver is bound by `@cImport(...)` — a C header. Genuinely
 *                           external, and the analyzer does NOT qualify it (`zigImportModuleLiteral`
 *                           finds no module string in `@cImport`), so these are UNMARKED gaps.
 *   bare-module-member      the receiver is bound by `@import("<bare>")` — a build-system module.
 *                           The analyzer qualifies and marks these; an UNMARKED one is a defect.
 *   path-import-member      the receiver is bound by a RELATIVE `@import` — a file in the project
 *                           by the analyzer's own rule. The target leaf is a declaration that
 *                           lives in a file the 60-file key space may not contain.
 *   binding-receiver        the receiver is a parameter or local (`self`, `allocator`, `zcu`).
 *                           The family publishes no locals as symbols, and the member's declaring
 *                           type is not in the file.
 *   declaration-receiver    the receiver is a file-scope declaration of this file (a struct, an
 *                           enum, a module the file itself declares).
 *   no-receiver             the edge has no written member access at all (a bare target).
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/zig/unresolved-split.ts [--sample 60] [--out p.json]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { Parser, Language } from "web-tree-sitter"
import { parseFile } from "../../../../src/ast/pool-worker"
import { classifyEdge, externalClaimOf } from "../../../../script/m14/incoming-rule"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024

const argv = process.argv.slice(2)
const arg = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const SAMPLE = Number(arg("sample", "60"))
const OUT = arg("out", "")

await Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const language: any = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-zig.wasm")))
const parser = new Parser()
parser.setLanguage(language)

// ───────────────────────────────────────────── the gate's population, reproduced
const found: string[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".zig")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    found.push(abs)
  }
}
found.sort()
const total = found.length
let files = found
if (SAMPLE > 0 && total > SAMPLE) {
  const stride = Math.max(1, Math.floor(total / SAMPLE))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < SAMPLE; i += stride) picked.push(found[i])
  files = picked
}
const repoOf = (f: string) => path.join(CR, path.relative(CR, f).split(path.sep)[0]!)

// ───────────────────────────────────────────── the source model
type SrcModel = {
  cimport: Set<string>
  bareModule: Set<string>
  pathImport: Set<string>
  locals: Set<string>
  fileScope: Set<string>
}
/** a bare module path is external by the analyzer's own rule (`zigModuleIsExternal`) */
const isBareModule = (m: string) =>
  !m.startsWith(".") && !m.startsWith("/") && !m.includes("/") && !m.includes("\\") &&
  !m.endsWith(".zig") && !m.endsWith(".zon")

const importCalleeName = (rhs: any): string | null => {
  if (!rhs) return null
  if (rhs.type !== "call_expression" && rhs.type !== "builtin_function") return null
  for (let i = 0; i < rhs.namedChildCount; i++) {
    const c = rhs.namedChild(i)
    if (c && (c.type === "builtin_identifier" || c.type === "identifier")) return String(c.text ?? "")
  }
  return null
}
const firstStringValue = (rhs: any): string | null => {
  if (!rhs) return null
  let args: any = null
  for (let i = 0; i < rhs.namedChildCount; i++) if (rhs.namedChild(i)?.type === "arguments") args = rhs.namedChild(i)
  const pool: any[] = []
  for (const host of [rhs, args]) {
    if (!host) continue
    for (let i = 0; i < host.namedChildCount; i++) {
      const c = host.namedChild(i)
      if (c && (c.type === "string" || c.type === "string_content")) pool.push(c)
    }
  }
  let node = pool[0]
  if (node?.type === "string") {
    for (let i = 0; i < node.namedChildCount; i++) if (node.namedChild(i)?.type === "string_content") node = node.namedChild(i)
  }
  if (!node) return null
  let out = String(node.text ?? "")
  if ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("'") && out.endsWith("'"))) out = out.slice(1, -1)
  return out.length > 0 ? out : null
}
const INSIDE_FUNCTION = new Set(["function_declaration", "test_declaration", "comptime_declaration"])

function sourceModel(rootNode: any): SrcModel {
  const m: SrcModel = { cimport: new Set(), bareModule: new Set(), pathImport: new Set(), locals: new Set(), fileScope: new Set() }
  const stack: any[] = [rootNode]
  let guard = 0
  while (stack.length > 0 && guard++ < 900000) {
    const n = stack.pop()!
    if (n.type === "parameter") {
      const id = n.namedChildren?.find((c: any) => c.type === "identifier")
      if (id) m.locals.add(String(id.text ?? ""))
    }
    if (n.type === "variable_declaration") {
      const kids = n.namedChildren ?? []
      const nameNode = kids.length > 0 && kids[0].type === "identifier" ? kids[0] : null
      const rhs = kids.length > 0 ? kids[kids.length - 1] : null
      const bound = nameNode ? String(nameNode.text ?? "") : ""
      if (bound) {
        const callee = importCalleeName(rhs)
        if (callee === "@import" || callee === "import") {
          const mod = firstStringValue(rhs)
          if (mod && isBareModule(mod)) m.bareModule.add(bound)
          else if (mod) m.pathImport.add(bound)
        } else if (callee === "@cImport") {
          m.cimport.add(bound)
        } else {
          // local or file-scope binding: which one depends on whether a function encloses it
          let cur = n.parent
          let inFn = false
          while (cur) { if (INSIDE_FUNCTION.has(cur.type)) { inFn = true; break } cur = cur.parent }
          if (inFn) m.locals.add(bound)
          else m.fileScope.add(bound)
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return m
}

// ───────────────────────────────────────────── walk the population
type Row = {
  repo: string; file: string; type: string; target: string; source: string; outcome: string
  written: string; root: string; bucket: string; module: string; markKeys: string[]
  /** declarations of the WHOLE TARGET in the edge's own file, and of its last segment. The
   *  first is the tiebreak a per-file resolver could use; the second says whether the name is
   *  a member whose declaring container is elsewhere. Both 0 means the name is nowhere in that
   *  file. Read only for the ambiguous column's ruling. */
  targetInFile: number; leafInFile: number
}
const rows: Row[] = []
const fileDecl = new Map<string, Map<string, number>>()
const projectDecl = new Map<string, Map<string, number>>()
const projectKinds = new Map<string, Map<string, Set<string>>>()
const pending: { row: Row; rel: any; claim: any; repo: string; file: string }[] = []
let parsed = 0

for (const f of files) {
  const repo = repoOf(f)
  let r: any
  try { r = await parseFile(f, repo, { projectRoot: repo } as any) } catch { continue }
  if (!r) continue
  parsed++
  let src: SrcModel = { cimport: new Set(), bareModule: new Set(), pathImport: new Set(), locals: new Set(), fileScope: new Set() }
  try {
    const tree = parser.parse(readFileSync(f, "utf8"))
    if (tree) src = sourceModel(tree.rootNode)
  } catch { /* the source model is an annotation; a failure leaves the bucket `unclassified` */ }
  const fDecl = new Map<string, number>()
  fileDecl.set(f, fDecl)
  let pDecl = projectDecl.get(repo)
  if (!pDecl) projectDecl.set(repo, (pDecl = new Map()))
  let pKinds = projectKinds.get(repo)
  if (!pKinds) projectKinds.set(repo, (pKinds = new Map()))
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const nm = String(s?.name ?? "")
    if (nm.length === 0) continue
    const k = String(s?.kind ?? "")
    fDecl.set(nm, (fDecl.get(nm) ?? 0) + 1)
    pDecl.set(nm, (pDecl.get(nm) ?? 0) + 1)
    let ps = pKinds.get(nm)
    if (!ps) pKinds.set(nm, (ps = new Set()))
    ps.add(k)
    const q = String(s?.qualifiedName ?? "")
    if (q.length > 0 && q !== nm) {
      fDecl.set(q, (fDecl.get(q) ?? 0) + 1)
      pDecl.set(q, (pDecl.get(q) ?? 0) + 1)
      let qs = pKinds.get(q)
      if (!qs) pKinds.set(q, (qs = new Set()))
      qs.add(k)
    }
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const md = rel?.metadata ?? {}
    const written = String(md.callExpression ?? md.fieldAccessExpression ?? "")
    const root = (/^([A-Za-z_][A-Za-z0-9_]*)/.exec(written)?.[1]) ?? ""
    const markKeys = Object.keys(md).filter((k) => k !== "evidenceClass" && md[k] === true)
    let bucket = "no-receiver"
    let module = String(md.zigImportModule ?? "")
    if (root) {
      if (src.cimport.has(root)) { bucket = "cimport-member"; module = module || "@cImport" }
      else if (src.bareModule.has(root)) bucket = "bare-module-member"
      else if (src.pathImport.has(root)) bucket = "path-import-member"
      else if (src.locals.has(root)) bucket = "binding-receiver"
      else if (src.fileScope.has(root)) bucket = "declaration-receiver"
      else bucket = "unclassified-receiver"
    }
    pending.push({
      repo, file: f, rel, claim: externalClaimOf(rel),
      row: {
        repo, file: path.relative(CR, f), type: String(rel?.type ?? ""), target: String(rel?.target ?? ""),
        source: String(rel?.source ?? ""), outcome: "", written, root, bucket, module, markKeys,
        targetInFile: 0, leafInFile: 0,
      },
    })
  }
}

for (const p of pending) {
  const c = classifyEdge(projectDecl.get(p.repo)!, projectKinds.get(p.repo)!, p.row.target, p.claim)
  p.row.outcome = c.outcome
  const fd = fileDecl.get(p.file)!
  p.row.targetInFile = fd.get(p.row.target) ?? 0
  const t = p.row.target
  const leaf = t.includes(".") ? t.slice(t.lastIndexOf(".") + 1) : t
  p.row.leafInFile = fd.get(leaf) ?? 0
  rows.push(p.row)
}

// ───────────────────────────────────────────── report
const tally = (rs: Row[]) => {
  const m = new Map<string, number>()
  for (const r of rs) m.set(r.bucket, (m.get(r.bucket) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}
const all = rows
const un = rows.filter((r) => r.outcome === "unresolved")
const ref = rows.filter((r) => r.outcome === "externalRefuted")
const ver = rows.filter((r) => r.outcome === "externalVerified")
if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    population: { sampled: files.length, corpusTotal: total, parsed },
    totals: {
      edges: all.length, unresolved: un.length, refuted: ref.length, externalVerified: ver.length,
    },
    unresolvedByBucket: tally(un), refutedByBucket: tally(ref), verifiedByBucket: tally(ver),
    rows,
  }, null, 2))
}
console.log(`zig unresolved split — ${parsed} parsed of ${files.length} (corpus ${total} .zig)`)
console.log(`edges ${all.length}  unresolved ${un.length}  refuted ${ref.length}  externalVerified ${ver.length}`)
for (const [label, rs] of [["UNRESOLVED", un], ["REFUTED", ref], ["EXTERNAL-VERIFIED", ver]] as const) {
  console.log(`\n${label} by receiver:`)
  for (const [b, n] of tally(rs)) console.log(`  ${b.padEnd(24)} ${String(n).padStart(5)}`)
}
const byBucketType = new Map<string, Map<string, number>>()
for (const r of un) {
  const m = byBucketType.get(r.bucket) ?? new Map<string, number>()
  m.set(r.type, (m.get(r.type) ?? 0) + 1)
  byBucketType.set(r.bucket, m)
}
console.log(`\nUNRESOLVED bucket x type:`)
for (const [b, m] of [...byBucketType.entries()].sort((a, b2) => [...b2[1].values()].reduce((x, y) => x + y, 0) - [...a[1].values()].reduce((x, y) => x + y, 0))) {
  console.log(`  ${b.padEnd(24)} ${[...m.entries()].map(([k, v]) => `${k}=${v}`).join(" ")}`)
}
console.log(`\nUNRESOLVED top targets by bucket:`)
for (const [b] of tally(un)) {
  const m = new Map<string, number>()
  for (const r of un) if (r.bucket === b) m.set(r.target, (m.get(r.target) ?? 0) + 1)
  const top = [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8)
  console.log(`  ${b.padEnd(24)} ${top.map(([t, n]) => `${t}(${n})`).join(" ")}`)
}
const amb = rows.filter((r) => r.outcome === "ambDeclOnly" || r.outcome === "ambBoth")
console.log(`\nAMBIGUOUS ${amb.length} — same-file candidate (a resolver's tiebreak, not this analyzer's):`)
for (const [b] of tally(amb)) {
  const sel = amb.filter((r) => r.bucket === b)
  const tgt = sel.filter((r) => r.targetInFile > 0).length
  const leaf = sel.filter((r) => r.targetInFile === 0 && r.leafInFile > 0).length
  console.log(`  ${b.padEnd(24)} ${String(sel.length).padStart(5)}  target-declared-in-own-file ${String(tgt).padStart(5)}  leaf-in-own-file-only ${String(leaf).padStart(5)}  nowhere ${String(sel.length - tgt - leaf).padStart(5)}`)
}
console.log(`\nREFUTED distinct targets: ${new Set(ref.map((r) => r.target)).size}; modules: ${JSON.stringify([...new Set(ref.map((r) => r.module))])}`)
console.log(`REFUTED markKeys: ${JSON.stringify([...new Set(ref.map((r) => r.markKeys.join("+")))])}`)
