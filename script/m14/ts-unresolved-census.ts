/**
 * TS UNRESOLVED CENSUS — classify EVERY unresolved edge the fleet gate reports, per label,
 * by CAUSE, over the gate's own `--dump` population.
 *
 * ## Why this instrument exists
 *
 * `script/m14/incoming-gate.ts --dump` prints one TSV row per non-resolved edge
 * (`label · outcome · target · srcFile:line · claimKind`) and nothing about WHY. A count
 * with no cause is a worklist entry without a next action: "1148 unresolved calls" can be
 * a spelling defect, a population artifact, or a delivered property of the language, and
 * the three have different fixes. This instrument reads the dump, re-parses every file it
 * names with the SAME production entry the gate used (`parseFile` from pool-worker), and
 * attributes each row to a named cause.
 *
 * ## What it is NOT
 *
 * It is not a gate and cannot pass or fail a lane: it reprints the gate's own rows. It is
 * not independent of the analyzer either — the cause classification reads the analyzer's
 * own metadata (`calleeExpression`, `module`, `isFieldAccess`, …) and the file's own AST.
 * A classification is an ATTRIBUTION, not a verification, and the limitation is stated
 * here so a reader does not treat a bucket as an oracle.
 *
 * ## Population rule
 *
 * The population is the dump file's own rows: every non-resolved edge in the run that
 * produced it. The row count is printed and reconciled against the gate's TABLE 1 by the
 * caller, not re-derived here. Every bucket count is over all rows it saw, and rows whose
 * edge could not be joined back to the analyzer output are counted as `unjoined` — never
 * silently dropped, because a bucket table that quietly omits rows is the "correct number
 * about the wrong population" defect `docs/M14-HONESTY-CONTRACT.md` bans.
 *
 * Usage:
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/ts-unresolved-census.ts <dump.txt> [--json out.json]
 *   BB_DUMP_LABEL=calls BB_DUMP_LIMIT=100000 bun run script/m14/incoming-gate.ts typescript ts 50 --dump > /tmp/dump.txt
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { builtinModules } from "node:module"
import { parseFile } from "../../src/ast/pool-worker"
import { ASTEngine } from "../../src/ast/engine"

const CORPUS = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const dumpPath = process.argv[2]
const jsonOut = (() => {
  const i = process.argv.indexOf("--json")
  return i >= 0 ? process.argv[i + 1] : null
})()

type Bucket = { count: number; samples: string[] }
const labels = new Map<string, { rows: number; buckets: Map<string, Bucket> }>()
const bucket = (label: string, name: string, sample: string) => {
  let row = labels.get(label)
  if (!row) labels.set(label, (row = { rows: 0, buckets: new Map() }))
  row.rows++
  let b = row.buckets.get(name)
  if (!b) row.buckets.set(name, (b = { count: 0, samples: [] }))
  b.count++
  if (b.samples.length < 4) b.samples.push(sample)
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// The gate's dump rows. Format: DUMP\t<label>\t<outcome>\t<target>\t<srcFile>:<line>\t<claimKind>
// ─────────────────────────────────────────────────────────────────────────────────────────
type DumpRow = { label: string; outcome: string; target: string; file: string; line: number; claimKind: string }
const rows: DumpRow[] = []
const files = new Set<string>()
for (const line of fs.readFileSync(dumpPath, "utf8").split("\n")) {
  if (!line.startsWith("DUMP\t")) continue
  const f = line.split("\t")
  if (f.length < 6) continue
  // `<file>:<line>` — the file path itself contains no `:<digits>` at the end except the line.
  const m = f[4].match(/^(.*):(\d+)$/)
  const file = m ? m[1] : f[4]
  const lineNo = m ? Number(m[2]) : 0
  rows.push({ label: f[1], outcome: f[2], target: f[3], file, line: lineNo, claimKind: f[5] })
  files.add(file)
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Repo facts: workspace package names, from the project's own package.json files.
// Bounded walk: node_modules/.git skipped, manifest count capped and the cap PRINTED.
// ─────────────────────────────────────────────────────────────────────────────────────────
const MANIFEST_CAP = 200
const repoFacts = new Map<string, { packages: Set<string>; capped: boolean; manifests: number }>()
function repoFactsFor(repo: string) {
  const cached = repoFacts.get(repo)
  if (cached) return cached
  const out = { packages: new Set<string>(), capped: false, manifests: 0 }
  const stack: string[] = [repo]
  while (stack.length > 0 && out.manifests < MANIFEST_CAP) {
    const dir = stack.pop()!
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (out.manifests >= MANIFEST_CAP) { out.capped = true; break }
      if (e.name === "node_modules" || e.name === ".git") continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (e.name === "package.json") {
        out.manifests++
        try {
          const j = JSON.parse(fs.readFileSync(p, "utf8"))
          if (typeof j?.name === "string" && j.name.length > 0) out.packages.add(j.name)
        } catch { /* an unreadable manifest is not evidence */ }
      }
    }
  }
  if (out.manifests >= MANIFEST_CAP) out.capped = true
  repoFacts.set(repo, out)
  return out
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// File facts. `parseFile` is the gate's own entry — the same analyzer, no context (the
// gate's default arm), so the rows join by construction.
// ─────────────────────────────────────────────────────────────────────────────────────────
const NODE_BUILTINS = new Set(builtinModules.flatMap((m) => [m, m.replace(/^node:/, "")]))
const plain = (s: string) => {
  if (s.length === 0) return false
  const c = s[0]!
  if (!((c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "_" || c === "$")) return false
  for (let i = 1; i < s.length; i++) {
    const ch = s[i]!
    if (!((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9") || ch === "_" || ch === "$")) return false
  }
  return true
}
const typeLeaf = (text: string): string | null => {
  // `Widget`, `ns.Widget`, `Widget<T>`, `Promise<Widget>` -> the LEAF type name only.
  let t = text.trim()
  if (t.length === 0) return null
  const lt = t.indexOf("<")
  if (lt > 0) t = t.slice(0, lt)
  const dot = t.lastIndexOf(".")
  if (dot >= 0) t = t.slice(dot + 1)
  t = t.replace(/^readonly\s+/, "").trim()
  return plain(t) ? t : null
}

type FileFacts = {
  symbols: Map<string, Set<string>>
  declaredAnyDepth: Set<string>
  imports: Map<string, string>
  moduleClass: Map<string, string>
  edges: Map<string, any[]>
  receiverTypes: Map<string, string>
  lines: string[]
}
const fileFacts = new Map<string, FileFacts>()
const parseFailures: string[] = []
/**
 * WHY FILES FAILED, aggregated — a mass fallback must say its cause, not only its count.
 * (The js lane's classifier records the same rule after its first cap-0 run skipped 11,875 of
 * 12,374 files and the report printed a bare number.)
 */
const parseFailureReasons = new Map<string, number>()
const noteFailure = (why: string, detail: unknown): void => {
  const msg = `${why}: ${String((detail as any)?.message ?? detail ?? "unknown").slice(0, 140)}`
  parseFailureReasons.set(msg, (parseFailureReasons.get(msg) ?? 0) + 1)
}
/**
 * READY-GUARD, NOT A HELD PARSER. `engine.getParser` caches parser instances and its own cleanup
 * recreates them every 500 acquisitions (deleting the old one); a parser held across the stream then
 * faults on its next `.parse` — the measured failure here was a whole-population mass fallback
 * (`join: 283,714 of 465,865`) with `[BB-PARSE-ERR] … Out of bounds memory access` on element-plus
 * trees, while a 50-file run was clean because it never crossed the recreation boundary. Acquire the
 * grammar once to fail early if it is missing, then acquire PER FILE below (the engine cache makes
 * that cheap).
 */
await ASTEngine.getParser("typescript" as any)

function collectAstFacts(root: any, facts: FileFacts) {
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    switch (n.type) {
      case "class_declaration":
      case "abstract_class_declaration":
      case "interface_declaration":
      case "enum_declaration":
      case "type_alias_declaration":
      case "function_declaration":
      case "generator_function_declaration":
      case "namespace_declaration":
      case "module":
      case "import_alias": {
        const nm = n.childForFieldName("name") ?? n.childForFieldName("declaration") ?? n.namedChild(0)
        if (nm && plain(nm.text)) facts.declaredAnyDepth.add(nm.text)
        break
      }
      case "variable_declarator": {
        const nm = n.childForFieldName("name") ?? n.namedChild(0)
        if (nm && nm.type === "identifier") {
          facts.declaredAnyDepth.add(nm.text)
          const value = n.childForFieldName("value")
          let t: string | null = null
          if (value && value.type === "new_expression") {
            const ctor = value.namedChild(0)
            if (ctor) t = typeLeaf(ctor.text)
          }
          if (!t) {
            for (let i = 0; i < n.namedChildCount; i++) {
              const c = n.namedChild(i)
              if (c && c.type === "type_annotation") {
                const inner = c.namedChild(0)
                if (inner) t = typeLeaf(inner.text)
                break
              }
            }
          }
          if (t) facts.receiverTypes.set(nm.text, t)
        }
        break
      }
      case "required_parameter":
      case "optional_parameter": {
        const pat = n.childForFieldName("pattern") ?? n.childForFieldName("name") ?? n.namedChild(0)
        if (pat && pat.type === "identifier") {
          facts.declaredAnyDepth.add(pat.text)
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c && c.type === "type_annotation") {
              const inner = c.namedChild(0)
              const t = inner ? typeLeaf(inner.text) : null
              if (t) facts.receiverTypes.set(pat.text, t)
              break
            }
          }
        }
        break
      }
      case "method_definition": {
        const nm = n.childForFieldName("name")
        if (nm && (nm.type === "property_identifier" || nm.type === "private_property_identifier")) {
          facts.declaredAnyDepth.add(nm.text.replace(/^#/, ""))
        }
        break
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
  }
}

for (const file of [...files].sort()) {
  const rel = file.startsWith(CORPUS) ? file.slice(CORPUS.length + 1) : file
  const repo = path.join(CORPUS, rel.split(path.sep)[0]!)
  const facts: FileFacts = {
    symbols: new Map(), declaredAnyDepth: new Set(), imports: new Map(),
    moduleClass: new Map(), edges: new Map(), receiverTypes: new Map(),
    lines: fs.readFileSync(file, "utf8").split("\n"),
  }
  fileFacts.set(file, facts)
  let r: any
  try { r = await parseFile(file, CORPUS) } catch (e: any) { parseFailures.push(`${file}: ${e?.message ?? e}`); noteFailure("parseFile-threw", e); continue }
  if (r?.fallback === true) { parseFailures.push(`${file}: fallback`); noteFailure("parseFile-fallback", "fallback") }
  for (const s of r?.symbols ?? []) {
    const name = String(s?.name ?? "")
    if (!name) continue
    const kinds = facts.symbols.get(name) ?? new Set()
    kinds.add(String(s?.kind ?? ""))
    facts.symbols.set(name, kinds)
  }
  for (const e of r?.relationships ?? []) {
    const label = String(e?.type ?? "")
    const key = `${label}|${String(e?.target ?? "")}|${Number(e?.line_number ?? e?.metadata?.line ?? 0) || 0}`
    const arr = facts.edges.get(key) ?? []
    arr.push(e)
    facts.edges.set(key, arr)
  }
  for (const imp of r?.relationships ?? []) {
    if (String(imp?.type ?? "") !== "imports") continue
    const md: any = imp.metadata ?? {}
    const module = String(md.module ?? "")
    if (!module) continue
    const binding = String(md.alias ?? (String(imp.target ?? "").includes(":") ? String(imp.target).slice(String(imp.target).lastIndexOf(":") + 1) : String(imp.target ?? "")))
    if (binding && binding !== "*") {
      facts.imports.set(binding, module)
      facts.moduleClass.set(binding, classifyModule(module, repo))
    }
  }
  // AST facts: nested declarations + receiver/parameter types (one walk per file).
  // PARSER ACQUIRED PER FILE, TREE DISPOSED AFTER THE WALK — never a parser held across the stream
  // (see the ready-guard comment above for the measured fault this caused).
  let tree: any = null
  try {
    const fileParser: any = await ASTEngine.getParser("typescript" as any)
    tree = fileParser.parse(fs.readFileSync(file, "utf8"))
    // `Parser.parse` returns `Tree | null`; a null tree leaves the depth buckets coarse and is
    // counted by the join rate rather than crashing the census.
    if (tree !== null) collectAstFacts(tree.rootNode, facts)
  } catch (e) {
    // Counted, not swallowed: an AST-walk failure leaves the depth buckets coarse and is reported.
    noteFailure("ast-parse-threw", e)
  } finally {
    try { tree?.delete?.() } catch { /* Tree.delete is optional in web-tree-sitter */ }
  }
}

function classifyModule(spec: string, repo: string): string {
  if (spec.startsWith(".") || spec.startsWith("/")) return "relative-or-absolute"
  const bare = spec.replace(/^node:/, "")
  if (NODE_BUILTINS.has(bare)) return "node-builtin"
  const segs = bare.split("/")
  const pkg = bare.startsWith("@") ? segs.slice(0, 2).join("/") : segs[0]!
  const facts = repoFactsFor(repo)
  if (facts.packages.has(pkg)) return "workspace-package"
  return "external-package"
}

/** The receiver ROOT of a callee/member expression: `a.b.c` -> `a`, `this.x` -> `this`. */
function receiverRoot(callee: string): string | null {
  const c = callee.trim()
  if (c.length === 0) return null
  const dot = c.indexOf(".")
  const head = dot >= 0 ? c.slice(0, dot) : c
  return plain(head) ? head : null
}

function classifyBareName(facts: FileFacts, repo: string, name: string): string {
  if (facts.symbols.has(name)) return "declared-same-file-published"
  if (facts.declaredAnyDepth.has(name)) return "declared-same-file-nested-scope"
  const mod = facts.imports.get(name)
  if (mod !== undefined) return `imported-from-${facts.moduleClass.get(name) ?? classifyModule(mod, repo)}`
  if (NODE_BUILTINS.has(name)) return "node-builtin-global"
  return "no-declaration-or-import-origin"
}

function classifyReceiver(facts: FileFacts, repo: string, root: string): string {
  if (root === "this") return "receiver-this"
  if (root === "super") return "receiver-super"
  const typed = facts.receiverTypes.get(root)
  if (typed !== undefined) {
    if (facts.symbols.has(typed)) return "member-of-receiver-typed-same-file-type"
    const mod = facts.imports.get(typed)
    if (mod !== undefined) return `member-of-receiver-typed-imported-${facts.moduleClass.get(typed) ?? classifyModule(mod, repo)}`
    return "member-of-receiver-typed-unknown-or-external-type"
  }
  const mod = facts.imports.get(root)
  if (mod !== undefined) return `member-of-imported-binding-${facts.moduleClass.get(root) ?? classifyModule(mod, repo)}`
  if (facts.symbols.has(root)) return "member-of-same-file-declaration"
  if (facts.declaredAnyDepth.has(root)) return "member-of-same-file-nested-declaration"
  return "member-of-untyped-local-or-param-receiver-typing-wall"
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Classification, per dumped row.
// ─────────────────────────────────────────────────────────────────────────────────────────
for (const row of rows) {
  const facts = fileFacts.get(row.file)
  const rel = row.file.startsWith(CORPUS) ? row.file.slice(CORPUS.length + 1) : row.file
  const repo = path.join(CORPUS, rel.split(path.sep)[0]!)
  const sample = `${row.target} @ ${rel}:${row.line}`
  // ext-claim rows are separated by the gate; this census classifies the NON-resolved rows
  // and keeps claim rows in their own bucket so a claim count can never be read as a gap.
  if (row.outcome === "externalVerified" || row.outcome === "externalUnverified" || row.outcome === "bindingVerified") {
    bucket(row.label, `CLAIM-${row.outcome}`, sample)
    continue
  }
  if (!facts) { bucket(row.label, "unjoined-no-file-facts", sample); continue }
  // Join the dumped row back to its analyzer edge, by (label, target, line). Duplicate keys
  // consume one edge each, so a repeated edge cannot be classified twice against one row.
  const key = `${row.label}|${row.target}|${row.line}`
  const cands = facts.edges.get(key)
  const edge = cands && cands.length > 0 ? cands.shift() : null
  if (!edge) { bucket(row.label, "unjoined-no-matching-analyzer-edge", sample); continue }
  const md: any = edge.metadata ?? {}
  const target = row.target

  if (row.label === "imports") {
    const at = target.lastIndexOf(":")
    if (at > 0 && !target.includes("\u0000")) {
      const module = target.slice(0, at)
      const item = target.slice(at + 1)
      const cls = classifyModule(module, repo)
      bucket(row.label, item === "*" ? `${cls} (whole module)` : `${cls} (module:item spelling)`, sample)
    } else if (target.includes("\u0000")) {
      bucket(row.label, "binding-spelled (bind?)", sample)
    } else {
      const cls = classifyBareName(facts, repo, target)
      bucket(row.label, `bare item -> ${cls}`, sample)
    }
    continue
  }

  if (row.label === "calls") {
    if (row.outcome.startsWith("amb")) { bucket(row.label, "ambiguous (2+ declarations in project)", sample); continue }
    const callee = String(md.calleeExpression ?? "")
    if (!callee) { bucket(row.label, "no-callee-metadata", sample); continue }
    const root = receiverRoot(callee)
    const isMember = callee.includes(".")
    if (!isMember || root === null) {
      bucket(row.label, `bare callee -> ${classifyBareName(facts, repo, target)}`, sample)
    } else {
      bucket(row.label, `member call -> ${classifyReceiver(facts, repo, root)}`, sample)
    }
    continue
  }

  if (row.label === "uses" || row.label === "references") {
    if (row.outcome.startsWith("amb")) { bucket(row.label, "ambiguous (2+ declarations in project)", sample); continue }
    if (md.isFieldAccess === true) {
      // The receiver is on the source line; read it rather than guess.
      const src = String(facts.lines[row.line - 1] ?? "")
      const at = src.lastIndexOf(`.${target}`)
      const recvText = at > 0 ? src.slice(0, at) : ""
      const recv = /([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(recvText)?.[1] ?? ""
      if (recv) { bucket(row.label, `value read -> ${classifyReceiver(facts, repo, recv)}`, sample); continue }
      bucket(row.label, "value read -> receiver not recoverable from line", sample)
      continue
    }
    bucket(row.label, `name mention -> ${classifyBareName(facts, repo, target)}`, sample)
    continue
  }

  if (row.label === "exports") {
    if (facts.symbols.has(target)) bucket(row.label, "exported name IS a published symbol of this file", sample)
    else if (facts.declaredAnyDepth.has(target)) bucket(row.label, "exported name declared same file, nested scope", sample)
    else if (facts.imports.has(target)) bucket(row.label, `re-export of imported binding (${facts.moduleClass.get(target)})`, sample)
    else bucket(row.label, "exported name declared nowhere in this file", sample)
    continue
  }

  // `decorates` and `overrides` used to fall through to `unclassified-label` — a counted bucket,
  // but not a CAUSE, and D3 asks for every edge in a DECLARED class. Their targets are names like
  // any other: an ambiguous outcome is the project-declaration ambiguity class, and a
  // non-ambiguous one is classified by the same bare-name resolver the heritage/ctor labels use.
  if (row.label === "decorates") {
    if (row.outcome.startsWith("amb")) { bucket(row.label, "ambiguous (2+ declarations in project)", sample); continue }
    bucket(row.label, `decorator name -> ${classifyBareName(facts, repo, target)}`, sample)
    continue
  }
  if (row.label === "overrides") {
    if (row.outcome.startsWith("amb")) { bucket(row.label, "ambiguous (2+ declarations in project)", sample); continue }
    bucket(row.label, `override target -> ${classifyBareName(facts, repo, target)}`, sample)
    continue
  }
  if (row.label === "extends" || row.label === "implements" || row.label === "instantiates") {
    bucket(row.label, `base/ctor name -> ${classifyBareName(facts, repo, target)}`, sample)
    continue
  }

  bucket(row.label, "unclassified-label", sample)
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────────────────────────────────
const report: any = { dump: dumpPath, population: { rows: rows.length, files: files.size, parseFailures: parseFailures.length, failureReasons: Object.fromEntries(parseFailureReasons) }, labels: {} }
let total = 0
console.log(`TS UNRESOLVED CENSUS — ${path.basename(dumpPath)}`)
console.log(`population: ${rows.length} dumped non-resolved rows over ${files.size} source file(s); re-parsed with the gate's own entry; unreadable/fallback: ${parseFailures.length}`)
if (parseFailureReasons.size > 0) console.log(`failure reasons: ${[...parseFailureReasons.entries()].sort((a, b) => b[1] - a[1]).map(([m, n]) => `${n}x ${m}`).join(" | ")}`)
for (const [label, l] of [...labels.entries()].sort((a, b) => b[1].rows - a[1].rows)) {
  total += l.rows
  console.log(`\n== ${label}: ${l.rows} rows ==`)
  const ordered = [...l.buckets.entries()].sort((a, b) => b[1].count - a[1].count)
  for (const [name, b] of ordered) {
    console.log(`  ${String(b.count).padStart(5)}  ${(100 * b.count / l.rows).toFixed(1).padStart(5)}%  ${name}`)
    for (const s of b.samples) console.log(`            e.g. ${s}`)
  }
  report.labels[label] = { rows: l.rows, buckets: Object.fromEntries(ordered.map(([n, b]) => [n, { count: b.count, samples: b.samples }])) }
}
console.log(`\nTOTAL ${total} rows classified across ${labels.size} label(s)`)
if (parseFailures.length > 0) {
  console.log(`PARSE FAILURES (counted, not hidden): ${parseFailures.length}`)
  for (const f of parseFailures.slice(0, 10)) console.log(`  ${f}`)
}
report.total = total
const unionFiles = rows.length
const joined = [...labels.values()].reduce((n, l) => n + [...l.buckets.entries()].reduce((m, [name, b]) => m + (name.startsWith("unjoined") ? b.count : 0), 0), 0)
console.log(`join: ${joined} of ${unionFiles} rows could not be joined back to analyzer output (${((100 * joined) / Math.max(1, unionFiles)).toFixed(1)}%)`)
report.joinFailures = joined
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2))
