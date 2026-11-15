/**
 * M14 ONTOLOGY CENSUS — TOML (#289), laptop B.
 *
 * ## Why this exists
 *
 * `script/m14/ontology-coverage-gate.ts toml` exits 2 and prints
 *
 *     no RULING TABLE for toml.
 *     Refusing to report: a gate with an empty table would call every
 *     un-emitted type RULED-UNJUSTIFIED and that is a verdict about the
 *     TABLE, not about the lane.
 *
 * — because `RULED_BY_LANG` in that shared file carries `bash` and `json` and
 * nothing else. The gate is supervisor-owned (§8), so the TABLE is a report-to-
 * supervisor item and not a lane edit. Until it lands, this file is the lane's
 * own arbiter: it runs the SAME two instruments the gate's header defines, over
 * the SAME census the gate admits, and prints the SAME four verdicts, so the
 * rulings are falsifiable now rather than asserted until someone wires them up.
 *
 *   A. GRAMMAR INVENTORY — enumerate every node type the grammar actually
 *      produces across the corpus. For a type needing a node type the language
 *      does not have, this is positive evidence of absence.
 *   B. PARSE-TREE SEMANTIC COUNT — for a type the language CAN express, or for
 *      one carried by a CONVENTION rather than by syntax (a manifest's `bin`
 *      entry point is an ordinary object key; a grammar cannot see it, which is
 *      the json lane's recorded reason for un-ruling `exports`). Counted on the
 *      tree, where a string in a comment or a heredoc cannot fake it.
 *
 * ## What is measured, and through which entry point
 *
 * Every analyzer-side count comes from `parseFile` (src/ast/pool-worker.ts) —
 * NOT from `analyze()`. `analyze()` is the per-file unit and skips the pipeline
 * stages (pool-worker, timeouts, truncation, enhancements), so a count taken
 * from it is a count of the analyzer's OUTPUT, not of what production stores.
 *
 * ## Phases
 *
 *   --phase=a   production census through parseFile (cached)
 *   --phase=bc  instrument A + instrument B probes on the parse tree
 *   --phase=d   analyzer-defect probes: shapes the corpus contains that the
 *               analyzer's walk may not be reading
 *   --phase=all all three
 *
 * READ-ONLY with respect to the repository and the corpus. Writes only its own
 * cache under /tmp.
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import { RealTomlAnalyzer } from "../../../../src/ast/real-toml-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "toml"
const CACHE = process.env.BB_TOML_CENSUS_CACHE ?? "/tmp/opencode/toml-census-phase-a.json"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof string) extends never ? never : (typeof ALL_TYPES)[number]

const argv = process.argv.slice(2)
const phase = (() => {
  const p = argv.find((a) => a.startsWith("--phase="))
  return p ? p.slice("--phase=".length) : "all"
})()
const quiet = argv.includes("--quiet")

// ---------------------------------------------------------------- corpus census
//
// DETERMINISTIC and not a sample: every git-tracked file in every corpus
// repository whose path detects as `toml` and whose size is at or under the
// gate's 512 KB ceiling. This is the same admission rule the gate uses, so the
// two answer about the same population.

type CorpusFile = { repo: string; dir: string; rel: string; abs: string; bytes: number }
const corpus: CorpusFile[] = []
const repoCounts: Record<string, number> = {}
{
  const entries = readdirSync(CR).sort()
  for (const e of entries) {
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
    let n = 0
    for (const rel of tracked) {
      const abs = path.join(dir, rel)
      let bytes: number
      try {
        bytes = statSync(abs).size
        if (bytes > 512 * 1024) continue
      } catch {
        continue
      }
      if (detectLanguageFromPath(abs) !== LANG) continue
      corpus.push({ repo: e, dir, rel, abs, bytes })
      n++
    }
    if (n > 0) repoCounts[e] = n
  }
  corpus.sort((a, b) => (a.repo === b.repo ? a.rel.localeCompare(b.rel) : a.repo.localeCompare(b.repo)))
}

// ---------------------------------------------------------------- phase A: parseFile census

type Edge = { type: string; source: string; target: string; confidence: number; line: number; evidenceClass: string; meta: Record<string, unknown> }
type AFile = {
  repo: string
  rel: string
  ok: boolean
  error?: string
  symbols: { name: string; kind: string; ownerName?: string; evidenceClass: string; meta: Record<string, unknown> }[]
  edges: Edge[]
  parseErrors: number
  fallback?: unknown
}
type PhaseA = { corpusSize: number; files: AFile[] }

async function runPhaseA(): Promise<PhaseA> {
  const files: AFile[] = []
  let idx = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const i = idx++
      if (i >= corpus.length) return
      const f = corpus[i]
      try {
        // Rooted, so the file-scoped identity is computed rather than collapsed to the bare
        // stem: the analyzer derives `<project-relative dirs>.<stem>` from this root, and an
        // unrooted call would make every same-named file in a repository share a prefix.
        const r: any = await parseFile(f.abs, f.dir, { projectRoot: f.dir } as any)
        files.push({
          repo: f.repo,
          rel: f.rel,
          ok: true,
          symbols: (r.symbols ?? []).map((s: any) => ({
            name: String(s.name ?? ""),
            kind: String(s.kind ?? ""),
            ownerName: s.ownerName === undefined || s.ownerName === null ? undefined : String(s.ownerName),
            evidenceClass: String(s?.metadata?.evidenceClass ?? ""),
            meta: (s?.metadata ?? {}) as Record<string, unknown>,
          })),
          edges: (r.relationships ?? []).map((x: any) => ({
            type: String(x.type ?? x.relationshipType ?? ""),
            source: String(x.source ?? ""),
            target: String(x.target ?? ""),
            confidence: typeof x.confidence === "number" ? x.confidence : -1,
            line: typeof x.line_number === "number" ? x.line_number : -1,
            evidenceClass: String(x?.metadata?.evidenceClass ?? ""),
            meta: (x?.metadata ?? {}) as Record<string, unknown>,
          })),
          parseErrors: (r.errors ?? []).length,
          fallback: r.fallback,
        })
      } catch (err) {
        files.push({ repo: f.repo, rel: f.rel, ok: false, error: String(err), symbols: [], edges: [], parseErrors: 0 })
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => worker()))
  files.sort((a, b) => `${a.repo}/${a.rel}`.localeCompare(`${b.repo}/${b.rel}`))
  return { corpusSize: corpus.length, files }
}

let A: PhaseA
if (existsSync(CACHE)) {
  A = JSON.parse(readFileSync(CACHE, "utf8"))
  if (!quiet) console.error(`[census] phase A loaded from cache ${CACHE} (${A.files.length} files)`)
} else {
  if (!quiet) console.error(`[census] phase A: ${corpus.length} files through parseFile ...`)
  A = await runPhaseA()
  const { writeFileSync, mkdirSync } = await import("node:fs")
  mkdirSync(path.dirname(CACHE), { recursive: true })
  writeFileSync(CACHE, JSON.stringify(A))
  if (!quiet) console.error(`[census] phase A written to ${CACHE}`)
}

// ---------------------------------------------------------------- the parse tree

let parser: any = null
async function getParser(): Promise<any> {
  if (parser) return parser
  const wts: any = await import("web-tree-sitter")
  const WSP = wts.Parser ?? wts.default
  const WSL = wts.Language ?? wts.default?.Language
  await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  parser = new WSP()
  parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-toml.wasm"))))
  return parser
}

/** Every named node of a parse tree, in document order. */
function walk(root: any, fn: (n: any, parent: any | null) => void): void {
  const stack: { n: any; p: any | null }[] = [{ n: root, p: null }]
  while (stack.length > 0) {
    const { n, p } = stack.pop()!
    fn(n, p)
    const kids = (n.namedChildren ?? []) as any[]
    for (let i = kids.length - 1; i >= 0; i--) if (kids[i]) stack.push({ n: kids[i], p: n })
  }
}
const kids = (n: any): any[] => ((n.namedChildren ?? []) as any[]).filter(Boolean)
const keyNodeOf = (n: any): any => {
  for (const c of kids(n)) if (c.type === "bare_key" || c.type === "quoted_key" || c.type === "dotted_key") return c
  return null
}
/** A key's segments, leaf-first via a different route than the analyzer's. */
const layer = (raw: string): string => {
  if (raw.length < 2) return raw
  const q = raw.charCodeAt(0)
  if (q !== 34 && q !== 39) return raw
  const body = raw.slice(1, -1)
  if (q === 39) return body
  let out = ""
  for (let i = 0; i < body.length; i++) {
    if (body.charCodeAt(i) !== 92) {
      out += body[i]
      continue
    }
    const n = body.charCodeAt(i + 1)
    i++
    if (n === 110) out += "\n"
    else if (n === 116) out += "\t"
    else if (n === 114) out += "\r"
    else if (n === 34) out += '"'
    else if (n === 92) out += "\\"
    else if (n === 117 || n === 85) {
      const hex = body.slice(i + 1, i + 5)
      const v = Number.parseInt(hex, 16)
      if (hex.length === 4 && Number.isFinite(v)) {
        out += String.fromCharCode(v)
        i += 4
      } else out += "\\u"
    } else out += "\\" + (body[i] ?? "")
  }
  return out
}
const segmentsOf = (node: any): string[] => {
  const out: string[] = []
  const visit = (n: any): void => {
    if (n.type === "dotted_key") {
      for (const c of kids(n)) visit(c)
      return
    }
    if (n.type === "bare_key" || n.type === "quoted_key") out.push(layer(n.text))
  }
  visit(node)
  return out
}
const isBareWritable = (seg: string): boolean => {
  if (seg.length === 0) return false
  for (let i = 0; i < seg.length; i++) {
    const c = seg.charCodeAt(i)
    const bare = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 45
    if (!bare) return false
  }
  return true
}
const spell = (seg: string): string => {
  if (isBareWritable(seg)) return seg
  let out = '"'
  for (let i = 0; i < seg.length; i++) {
    const c = seg.charCodeAt(i)
    if (c === 34 || c === 92) out += "\\"
    out += seg[i]
  }
  return out + '"'
}
const joinPath = (segs: string[]): string => segs.map(spell).join(".")

type Hit = { file: string; line: number; detail: string }
type Probe = { type: Type | "analyzer"; label: string; instrument: "A:grammar-inventory" | "B:parse-tree-count"; hits: Hit[]; hitFiles: Set<string> }
const probes: Record<string, Probe> = {}

// ---------------------------------------------------------------- instrument B probes

/**
 * Every MARKER: a key whose NAME is itself the syntactic marker a construct
 * would have to carry in TOML. TOML has no keywords — a construct that is not a
 * table header, a key and a value has no spelling at all — so for every ruled
 * type the falsifiable probe is "does a key with the name this construct would
 * carry occur?", counted on the tree.
 *
 * A hit is a REVIEW item, not automatically a construct: the gate's own header
 * records a regex probe for `extends` matching `class voice` inside a telnet
 * word list in a string. Every hit below is therefore printed with its file,
 * line and key path so it can be read, and none is trusted on its count.
 */
const MARKERS: Record<string, string[]> = {
  calls: ["call", "calls", "invoke", "invokes", "callable", "run", "exec"],
  uses: ["uses", "using", "interpolate", "interpolation", "template", "expr"],
  imports: ["import", "imports", "include", "includes", "include_str", "require", "requires", "source_file", "load"],
  references: ["$ref", "ref", "refs", "reference", "references", "anchor", "alias", "target", "points_to", "link"],
  exports: ["export", "exports", "expose", "exposed", "pub", "public", "publish", "main", "module", "mod", "entrypoint"],
  extends: ["extends", "extend", "extends_from", "inherits_from", "base", "parent", "superclass", "derived_from", "template"],
  implements: ["implements", "implement", "implements_from", "iface", "interface", "contracts"],
  overrides: ["override", "overrides", "replace", "replaces"],
  instantiates: ["new", "instantiate", "instantiates", "construct", "constructor", "factory"],
}

const INHERIT_MARKERS = ["workspace", "inherits", "inherit", "parent", "base"]

const p = (type: string, label: string, instrument: "A:grammar-inventory" | "B:parse-tree-count"): Probe =>
  (probes[type] ??= { type: type as any, label, instrument, hits: [], hitFiles: new Set() })

for (const [type, markers] of Object.entries(MARKERS)) {
  const probe = p(type, `a key named one of ${markers.map((m) => `"${m}"`).join(", ")}`, "B:parse-tree-count")
  probe.probe = (root: any, fileLabel: string) => {
    walk(root, (n) => {
      if (n.type !== "pair") return
      const k = keyNodeOf(n)
      if (!k) return
      const segs = segmentsOf(k)
      if (segs.length === 0) return
      const leaf = segs[segs.length - 1]
      if (!markers.includes(leaf)) return
      const v = kids(n)[kids(n).length - 1]
      probe.hits.push({
        file: fileLabel,
        line: k.startPosition.row + 1,
        detail: `[marker:${leaf}] ${joinPath(segs)} = ${v ? v.type : "none"} ${JSON.stringify(v?.text ?? "")}`,
      })
    })
  }
}

// `imports` needs the stronger probe: a value that names ANOTHER FILE ON DISK.
// A marker key alone is a string; a string that resolves to a file the manifest
// could read is a file dependency whatever the key is called, which is exactly
// the json lane's `$ref` reasoning. The hits are SPLIT BY WHAT THEY POINT AT,
// because "a value naming an existing file" and "a value naming another
// configuration file" are different claims and only the second one is an
// import. The split is the difference between a number worth reading and a
// number worth nothing — the gate's header records the first version of a $ref
// probe reporting 2,651 hits of which the examples were a filename in a `files`
// array, i.e. a list of what a package ships.
{
  const any = p("imports", "a value naming another file that EXISTS on disk, relative to the manifest", "B:parse-tree-count")
  const toml = p("imports:toml-target", "a value naming another `.toml` file that EXISTS on disk (the only shape that could be an import of a configuration file)", "B:parse-tree-count")
  any.probe = (root: any, fileLabel: string, abs: string) => {
    walk(root, (n) => {
      if (n.type !== "string") return
      const inner = String(n.text ?? "")
      const m = /^(['"])([\s\S]*)\1$/.exec(inner)
      const value = m ? m[2] : inner
      if (value.length === 0 || value.length > 300) return
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return // a URL, not a path
      if (value.includes("*") || value.includes("?") || value.includes("$")) return // a glob or an unexpanded variable
      const cand = value.startsWith("/") ? value : path.resolve(path.dirname(abs), value)
      if (!existsSync(cand) || !statSync(cand).isFile()) return
      let st: any
      try {
        st = statSync(cand)
      } catch {
        return
      }
      const isToml = path.extname(cand).toLowerCase() === ".toml"
      any.hits.push({ file: fileLabel, line: n.startPosition.row + 1, detail: `${JSON.stringify(value)} -> ${cand} (exists, ${st.size} bytes)${isToml ? "  *** .toml ***" : ""}` })
      if (isToml) toml.hits.push({ file: fileLabel, line: n.startPosition.row + 1, detail: `${JSON.stringify(value)} -> ${cand} (exists, ${st.size} bytes)` })
    })
  }
}

// The CARGO WORKSPACE-INHERITANCE shape, measured separately because it is the
// one genuine cross-key dependency in the corpus and the ruling has to answer
// it rather than walk past it.
{
  const probe = p("references:workspace-inheritance", `a key named one of ${INHERIT_MARKERS.map((m) => `"${m}"`).join(", ")} whose value is the boolean true`, "B:parse-tree-count")
  probe.probe = (root: any, fileLabel: string) => {
    const visit = (n: any, prefix: string): void => {
      if (n.type === "pair") {
        const k = keyNodeOf(n)
        if (k) {
          const segs = segmentsOf(k)
          const last = segs[segs.length - 1]
          const v = kids(n)[kids(n).length - 1]
          if (INHERIT_MARKERS.includes(last) && v?.type === "boolean" && v.text.trim() === "true") {
            probe.hits.push({ file: fileLabel, line: k.startPosition.row + 1, detail: `${prefix}${joinPath(segs)} = true` })
          }
        }
      }
      if (n.type === "table" || n.type === "table_array_element") {
        const h = keyNodeOf(n)
        const seg = h ? joinPath(segmentsOf(h)) : ""
        for (const c of kids(n)) visit(c, seg.length > 0 ? `${seg}.` : "")
        return
      }
      for (const c of kids(n)) visit(c, prefix)
    }
    visit(root, "")
  }
}

// `uses` also has to answer INTERPOLATION: a value that reads another value is
// the only `uses` edge a data format could honestly carry, and TOML's whole
// position is that a value is a literal. The marker characters are counted on
// the tree inside `string` nodes only, so a comment cannot produce one.
{
  const probe = p("uses:string-interpolation", "a string VALUE containing an interpolation marker (${ , {{ , %( , $( )", "B:parse-tree-count")
  probe.probe = (root: any, fileLabel: string) => {
    walk(root, (n) => {
      if (n.type !== "string") return
      const t = String(n.text ?? "")
      const marks: string[] = []
      if (t.includes("${")) marks.push("${")
      if (t.includes("{{")) marks.push("{{")
      if (t.includes("%(")) marks.push("%(")
      if (t.includes("$( ")) marks.push("$( ")
      if (marks.length > 0) probe.hits.push({ file: fileLabel, line: n.startPosition.row + 1, detail: `${marks.join(",")} in ${JSON.stringify(t.slice(0, 70))}` })
    })
  }
}

// `exports` also has to answer the BUILD-TARGET surface: cargo declares the
// names a crate publishes as ordinary keys under `[lib]` / `[[bin]]`, which is
// the json lane's `bin` precedent reached through headers instead of keys.
{
  const probe = p("exports:build-target", `a [lib]/[[bin]]/[[bench]]/[[test]]/[[example]] section carrying a "name" key`, "B:parse-tree-count")
  probe.probe = (root: any, fileLabel: string) => {
    walk(root, (n) => {
      if (n.type !== "table" && n.type !== "table_array_element") return
      const h = keyNodeOf(n)
      if (!h) return
      const path = joinPath(segmentsOf(h))
      const leaf = path.split(".").pop() ?? path
      if (!["lib", "bin", "bench", "test", "example"].includes(leaf)) return
      for (const c of kids(n)) {
        if (c.type !== "pair") continue
        const ck = keyNodeOf(c)
        if (!ck) continue
        const segs = segmentsOf(ck)
        if (segs[segs.length - 1] === "name" || segs[segs.length - 1] === "path" || segs[segs.length - 1] === "crate-type") {
          const v = kids(c)[kids(c).length - 1]
          probe.hits.push({ file: fileLabel, line: ck.startPosition.row + 1, detail: `[${path}] ${joinPath(segs)} = ${JSON.stringify(v?.text ?? "")}` })
        }
      }
    })
  }
}

// `overrides` is instrument B by construction: a second declaration of a name
// is legal TOML for `[[array]]` and a spec violation for a table or a key, so
// no grammar inventory can see it. The three shapes are counted SEPARATELY
// because they are three different semantics, and a single number over all
// three would be unreadable:
//   - a `table` header declared twice    -> the second DEFINES the same table,
//                                            so the later body wins: an override
//   - a key declared twice in one section -> TOML makes it undefined behaviour,
//                                            which is not the same as override
//   - `[[array]]` declared twice          -> TOML APPENDS, so nothing is replaced
{
  const tables = p("overrides:table-header", "a `table` header path declared 2+ times in one document", "B:parse-tree-count")
  const keys = p("overrides:duplicate-key", "a key path declared 2+ times inside ONE section", "B:parse-tree-count")
  const arrays = p("overrides:array-element", "a `[[array-of-tables]]` header path declared 2+ times", "B:parse-tree-count")
  const any = p("overrides", "any of the three re-declaration shapes above", "B:parse-tree-count")
  any.probe = (root: any, fileLabel: string) => {
    // The SCOPE of a key is the table that declares it. Two `[[rules]]` elements
    // are two tables, so `id` under each is two keys, not a duplicate — the
    // element ORDINAL is part of the scope for that reason. The first version of
    // this probe omitted it, and also counted every in-table pair a second time
    // under the root scope, which reported 1,515 where the corrected count is
    // below. A duplicate-key number that counts the same key twice is worse than
    // no number.
    const tableCount = new Map<string, number>()
    const arrayCount = new Map<string, number>()
    const keyCount = new Map<string, { n: number; line: number }>()
    const bump = (m: Map<string, { n: number; line: number }>, k: string, line: number): number => {
      const prev = m.get(k)
      const n = prev ? prev.n + 1 : 1
      m.set(k, { n, line })
      return n
    }
    const arrayOrdinal = new Map<string, number>()
    // The document's own children, in order: a pair here is a ROOT key, and a
    // table here is a section. Reading the children directly (rather than
    // testing a node's parent during a whole-tree walk) is what keeps a pair
    // inside a section from also being counted at the root.
    for (const n of kids(root)) {
      if (n.type === "table" || n.type === "table_array_element") {
        const h = keyNodeOf(n)
        if (!h) continue
        const path = joinPath(segmentsOf(h))
        const isArray = n.type === "table_array_element"
        const c = bump(isArray ? (arrayCount as any) : (tableCount as any), path, h.startPosition.row + 1)
        if (c === 2) {
          const detail = `${isArray ? "table_array_element" : "table"} [${path}] declared a 2nd time on line ${h.startPosition.row + 1} — ${isArray ? "TOML APPENDS to the array; nothing is replaced" : "TOML v1.0.0 forbids redefining a table, so the document is invalid rather than the second body winning"}`
          ;(isArray ? arrays : tables).hits.push({ file: fileLabel, line: h.startPosition.row + 1, detail })
          any.hits.push({ file: fileLabel, line: h.startPosition.row + 1, detail })
        }
        const ord = isArray ? (arrayOrdinal.get(path) ?? 0) + 1 : 1
        if (isArray) arrayOrdinal.set(path, ord)
        const scope = isArray ? `${path}#${ord}` : path
        for (const c2 of kids(n)) {
          if (c2.type !== "pair") continue
          const ck = keyNodeOf(c2)
          if (!ck) continue
          const key = joinPath(segmentsOf(ck))
          const kn = bump(keyCount, `${scope}//${key}`, ck.startPosition.row + 1)
          if (kn === 2) {
            const d2 = `key ${key} inside [${scope}] declared a 2nd time on line ${ck.startPosition.row + 1} — TOML v1.0.0 forbids a duplicate key within one table, which is UNDEFINED rather than a replacement`
            keys.hits.push({ file: fileLabel, line: ck.startPosition.row + 1, detail: d2 })
            any.hits.push({ file: fileLabel, line: ck.startPosition.row + 1, detail: d2 })
          }
        }
      } else if (n.type === "pair") {
        const ck = keyNodeOf(n)
        if (!ck) continue
        const key = joinPath(segmentsOf(ck))
        if (key.length === 0) continue
        const kn = bump(keyCount, `<root>//${key}`, ck.startPosition.row + 1)
        if (kn === 2) {
          const d2 = `root key ${key} declared a 2nd time on line ${ck.startPosition.row + 1} — TOML v1.0.0 forbids a duplicate key in the root table, which is UNDEFINED rather than a replacement`
          keys.hits.push({ file: fileLabel, line: ck.startPosition.row + 1, detail: d2 })
          any.hits.push({ file: fileLabel, line: ck.startPosition.row + 1, detail: d2 })
        }
      }
    }
  }
}

// ------------------------------------------------- ONE tree pass: instrument A + every instrument-B probe
//
// Every file is parsed EXACTLY ONCE and every probe reads that one tree. The
// first version re-parsed per probe (12 probes x 1,140 files) and the parse
// count, not the probe logic, was the cost. A probe can therefore never see a
// different tree than its neighbour, which matters when a probe's whole claim
// is "this shape occurs N times across the corpus".

const nodeTypeCounts = new Map<string, number>()
const dRaw: Record<string, Hit[]> = {}
const dFiles: Record<string, Set<string>> = {}
const dHit = (id: string, fileLabel: string, line: number, detail: string): void => {
  ;(dRaw[id] ??= []).push({ file: fileLabel, line, detail })
  ;(dFiles[id] ??= new Set()).add(fileLabel)
}

/** D-probe: a section whose ancestor table is declared LATER in the document. */
function probeOutOfOrderSuperTable(root: any, fileLabel: string): void {
  const rows: { path: string; line: number }[] = []
  walk(root, (n) => {
    if (n.type !== "table" && n.type !== "table_array_element") return
    const h = keyNodeOf(n)
    if (!h) return
    rows.push({ path: joinPath(segmentsOf(h)), line: h.startPosition.row + 1 })
  })
  for (let ri = 0; ri < rows.length; ri++) {
    const r = rows[ri]
    const segs = r.path.split(".")
    for (let i = 1; i < segs.length; i++) {
      const prefix = segs.slice(0, i).join(".")
      const at = rows.findIndex((x) => x.path === prefix)
      if (at > ri) dHit("D1", fileLabel, r.line, `[${r.path}] at line ${r.line} is declared BEFORE its ancestor [${prefix}] at line ${rows[at].line}`)
    }
  }
}

/** D-probe: a section nested inside another section or inside an inline table. */
function probeNestedTable(root: any, fileLabel: string): void {
  walk(root, (n, parent) => {
    if (n.type !== "table" && n.type !== "table_array_element") return
    if (parent && (parent.type === "table" || parent.type === "table_array_element" || parent.type === "inline_table")) {
      dHit("D3", fileLabel, lineOf(n), `${n.type} inside ${parent.type}`)
    }
  })
}

// ---------------------------------------------------------------- phase E: pipeline loss
//
// The analyzer's OWN output, against what production stores. `parseFile` runs the
// pipeline stages `analyze()` skips, including `filterNoiseRelationships` — and
// that filter is where the census found an edge the analyzer emits correctly and
// production throws away (see D7). The lane's own header records the same lesson
// for bash: "the m12 corpus measurement read `analyze()` directly, not
// `parseFile`" and the pre-fix artifacts therefore did not show the 21 lost
// edges. So the two are measured side by side rather than one being assumed to
// stand for the other.
const pipeline: { analyzerEdges: number; parseFileEdges: number; dropped: number; symbolDropped: number; examples: Hit[] } = {
  analyzerEdges: 0,
  parseFileEdges: 0,
  dropped: 0,
  symbolDropped: 0,
  examples: [],
}
const lineOf = (n: any): number => n.startPosition.row + 1
if (phase !== "a") {
  const P = await getParser()
  const analyzer = new RealTomlAnalyzer()
  const prodByFile = new Map<string, Set<string>>()
  for (const af of A.files) {
    if (!af.ok) continue
    prodByFile.set(`${af.repo}/${af.rel}`, new Set((af.edges ?? []).map((e) => `${e.type}|${e.source}|${e.target}`)))
    pipeline.parseFileEdges += af.edges.length
  }
  for (const f of corpus) {
    const label = `${f.repo}/${f.rel}`
    const text = readFileSync(f.abs, "utf8")
    const t = P.parse(text)
    if (!t) continue
    let r: any
    try {
      // THE SAME CONTEXT THE PRODUCTION CALL GOT, or this comparison measures the CONTEXT
      // instead of the pipeline: phase A above now hands `parseFile` the repo root, and the
      // direct call has to see the same one, otherwise every endpoint differs by the
      // file-scoped prefix and the pipeline reads as having dropped all of them.
      r = analyzer.analyze(t.rootNode as any, text, f.abs, { projectRoot: f.dir } as any)
    } catch {
      t.delete?.()
      continue
    }
    const edges: any[] = r.relationships ?? []
    pipeline.analyzerEdges += edges.length
    const prod = prodByFile.get(label)
    if (prod) {
      for (const e of edges) {
        const k = `${e.type}|${e.source}|${e.target}`
        if (!prod.has(k)) {
          pipeline.dropped++
          if (pipeline.examples.length < 8) pipeline.examples.push({ file: label, line: e.line_number ?? -1, detail: `${k}  (analyzer emitted it; parseFile did not return it)` })
        }
      }
    }
    t.delete?.()
  }
  pipeline.symbolDropped = pipeline.parseFileEdges > 0 ? 0 : 0
}

/** D-probe: a pair below a value (inline table, or an array of them). */
function probePairBelowValue(root: any, fileLabel: string): void {
  walk(root, (n, parent) => {
    if (n.type !== "pair") return
    if (parent && (parent.type === "inline_table" || parent.type === "array")) dHit("D4", fileLabel, n.startPosition.row + 1, `pair inside ${parent.type}`)
  })
}

if (phase !== "a") {
  const P = await getParser()
  const probeFns = Object.entries(probes).map(([key, probe]) => [key, (probe as any).probe as ((root: any, fileLabel: string, abs: string) => void) | undefined] as const)
  for (const f of corpus) {
    const text = readFileSync(f.abs, "utf8")
    const t = P.parse(text)
    if (!t) continue
    const root = t.rootNode
    // Instrument A: the grammar's own vocabulary, over the same trees.
    walk(root, (n) => {
      if (n.isMissing) nodeTypeCounts.set("MISSING", (nodeTypeCounts.get("MISSING") ?? 0) + 1)
      nodeTypeCounts.set(n.type, (nodeTypeCounts.get(n.type) ?? 0) + 1)
      if (n.type === "ERROR") dHit("D6", `${f.repo}/${f.rel}`, n.startPosition.row + 1, `ERROR node spanning ${JSON.stringify(String(n.text ?? "").slice(0, 60))}`)
      if (n.isMissing) dHit("D5", `${f.repo}/${f.rel}`, n.startPosition.row + 1, `MISSING ${n.type}`)
    })
    // Instrument B: every construct probe, on this one tree.
    const label = `${f.repo}/${f.rel}`
    for (const [key, fn] of probeFns) {
      if (!fn) continue
      const before = probes[key].hits.length
      fn(root, label, f.abs)
      if (probes[key].hits.length > before) probes[key].hitFiles.add(label)
    }
    // Analyzer-defect probes, on this one tree.
    probeOutOfOrderSuperTable(root, label)
    probeNestedTable(root, label)
    probePairBelowValue(root, label)
    t.delete?.()
  }
}

// ---------------------------------------------------------------- phase D: analyzer-defect probes

type Defect = { id: string; question: string; occurrences: number; files: number; examples: string[]; meaning: string }
const defects: Defect[] = []
const D = (id: string, question: string, meaning: string, exN = 6): void => {
  const hits = dRaw[id] ?? []
  defects.push({
    id,
    question,
    occurrences: hits.length,
    files: (dFiles[id] ?? new Set()).size,
    examples: hits.slice(0, exN).map((h) => `${h.file}:${h.line}  ${h.detail}`),
    meaning,
  })
}

// ---------------------------------------------------------------- report

const pad = (s: string, n: number): string => (s + " ".repeat(n)).slice(0, n)
const out: string[] = []
const w = (s: string): void => {
  if (!quiet) console.log(s)
  out.push(s)
}

// ---- analyzer-defect probes: the shapes the corpus actually contains ----

// D1 — OUT-OF-ORDER SUPER-TABLE. TOML v1.0.0 requires no super-table to be
// declared first: `[a.b]` written above `[a]` is valid and `a.b` is inside `a`.
// Both the analyzer AND `deriveTomlEdges` resolve an owner from a document-order
// map, so both file the earlier section under the MODULE — the SHARED-PREMISE
// class the oracle's own header says it cannot catch.
D(
  "D1",
  "a section whose ancestor table is declared LATER in the same document (legal TOML; declaration order is not significant)",
  "the owner is resolved from a document-order map, so such a section is filed under the MODULE instead of under its declared ancestor. The ORACLE builds its `declared` map in the same order, so F5 differential agrees with the analyzer and cannot see it. The fix is a second pass that re-owns a section once a later header supplies its ancestor.",
)

// D2 — A PUBLISHED NAME WITH AN EMPTY PATH SEGMENT. The lane's own contract says
// an empty key `"" = 1` produces no symbol. The root-level pair carries a
// `segs.length === 0` guard; the in-table pair does not, and builds its path as
// `${name}.${joinPath([])}` — a TRAILING DOT. Read straight off parseFile's
// output rather than reasoned about.
//
// A LEADING dot is counted separately and is NOT this defect: the module name is
// the file's stem, and `.gitleaks.toml` legitimately has the stem `.gitleaks`.
// The first version of this probe conflated the two and reported 17, all of
// which were dotfiles.
{
  const trailing: Hit[] = []
  const leading: Hit[] = []
  const files = new Set<string>()
  for (const af of A.files) {
    if (!af.ok) continue
    for (const s of af.symbols) {
      const bad = s.name.endsWith(".") || s.name.includes("..")
      if (!bad) continue
      trailing.push({ file: `${af.repo}/${af.rel}`, line: -1, detail: `published symbol name ${JSON.stringify(s.name)}` })
      files.add(`${af.repo}/${af.rel}`)
    }
    for (const s of af.symbols) {
      if (!s.name.startsWith(".")) continue
      leading.push({ file: `${af.repo}/${af.rel}`, line: -1, detail: `module name from a dotfile stem: ${JSON.stringify(s.name)}` })
    }
  }
  dRaw["D2"] = trailing
  dFiles["D2"] = files
  D("D2", "a published symbol name with a TRAILING or doubled `.` — an empty path segment", "an identity that is not a spelling TOML can parse back. The document-level pair is guarded (`segs.length === 0` -> skip) and the in-table pair is not, so the two halves of the same rule disagree.")
  defects.push({
    id: "D2b",
    question: "a module name with a LEADING `.` (measured, and NOT a defect)",
    occurrences: leading.length,
    files: new Set(leading.map((h) => h.file)).size,
    examples: leading.slice(0, 4).map((h) => `${h.file}  ${h.detail}`),
    meaning: "the module name is the file's stem, so a dotfile yields `.name`. Recorded because the first version of this probe reported these 17 times as a defect and every one was a dotfile; the shape is correct and the probe was wrong.",
  })
}

// D3 — A SECTION NESTED INSIDE ANOTHER. The analyzer's walk is one level deep
// and its header claims a `table` never contains a `table`. That claim is a
// fact about the grammar and is measured here rather than assumed.
D(
  "D3",
  "a `table`/`table_array_element` nested inside another node (the analyzer's walk is one level deep)",
  "a non-zero count would mean a section the document really declares is never published. Zero confirms the one-level walk loses nothing.",
)

// D4 — A PAIR BELOW A VALUE. `metadata.inlineKeys` is filled only when the
// value's OWN type is `inline_table`, so pairs inside an ARRAY of inline tables
// are recorded nowhere. A scoping decision, measured so the loss is a number.
D(
  "D4",
  "a `pair` below a value (an inline table, or an array of them) — never a symbol, per the inline-table ruling",
  "`metadata.inlineKeys` covers a value whose own type is `inline_table` and does NOT cover pairs inside an ARRAY of inline tables, so those key names are recorded in no field at all. Not an edge defect; a metadata gap with a count.",
  4,
)

D("D5", "a `MISSING` recovery node", "the completeness spec records MISSING as never occurring; this measures it on the census rather than restating the spec.")

D("D6", "an `ERROR` recovery node", "the analyzer reports each one at its own span. The census measures how many files carry one.")

w(`TOML ontology census — corpus ${corpus.length} git-tracked .toml files across ${Object.keys(repoCounts).length} repositories`)
w(`phase: ${phase}${existsSync(CACHE) ? " (phase A from cache)" : ""}`)

// --- phase A -----------------------------------------------------------------

const okFiles = A.files.filter((f) => f.ok)
const failed = A.files.filter((f) => !f.ok)
const byType = new Map<string, { n: number; files: Set<string>; examples: string[]; confLt7: number; unresolvedSource: number; unresolvedTarget: number; resolvedBoth: number; lineMissing: number; lineNonPositive: number; evidenceClasses: Map<string, number>; self: number }>()
const ALL_RELSET = new Set<string>(ALL_TYPES)

let totalSymbols = 0
let emptyNames = 0
let emptyKinds = 0
const kindCounts = new Map<string, number>()
const unknownEndpoints = new Set<string>()
let duplicateNameFiles = 0
let dupExamples: string[] = []

for (const f of okFiles) {
  totalSymbols += f.symbols.length
  const names = new Set<string>()
  const dupHere = new Set<string>()
  for (const s of f.symbols) {
    if (s.name.length === 0) emptyNames++
    if (s.kind.length === 0) emptyKinds++
    kindCounts.set(s.kind, (kindCounts.get(s.kind) ?? 0) + 1)
    if (names.has(s.name)) dupHere.add(s.name)
    names.add(s.name)
  }
  if (dupHere.size > 0) {
    duplicateNameFiles++
    if (dupExamples.length < 6) dupExamples.push(`${f.repo}/${f.rel}: ${[...dupHere].slice(0, 3).join(", ")}`)
  }
  for (const e of f.edges) {
    const t = e.type
    if (e.source === "unknown") unknownEndpoints.add(`${f.repo}/${f.rel}:source`)
    if (e.target === "unknown") unknownEndpoints.add(`${f.repo}/${f.rel}:target`)
    const row =
      byType.get(t) ??
      { n: 0, files: new Set<string>(), examples: [], confLt7: 0, unresolvedSource: 0, unresolvedTarget: 0, resolvedBoth: 0, lineMissing: 0, lineNonPositive: 0, evidenceClasses: new Map<string, number>(), self: 0 }
    row.n++
    if (row.files.size < 6) {
      row.examples.push(`${f.repo}/${f.rel}:${e.line} ${e.source} -> ${e.target}`)
      row.files.add(`${f.repo}/${f.rel}`)
    }
    if (e.confidence >= 0 && e.confidence < 0.7) row.confLt7++
    if (!names.has(e.source)) row.unresolvedSource++
    if (!names.has(e.target)) row.unresolvedTarget++
    if (names.has(e.source) && names.has(e.target)) row.resolvedBoth++
    if (e.line < 0) row.lineMissing++
    else if (e.line <= 0) row.lineNonPositive++
    if (e.source === e.target) row.self++
    const ec = e.evidenceClass || "(none)"
    row.evidenceClasses.set(ec, (row.evidenceClasses.get(ec) ?? 0) + 1)
    byType.set(t, row)
  }
}

w("")
w(`== PHASE A — production parseFile over ${okFiles.length} files (${failed.length} threw) ==`)
w(`symbols ${totalSymbols.toLocaleString()}   empty names ${emptyNames}   empty kinds ${emptyKinds}   files with a duplicate symbol name ${duplicateNameFiles}`)
if (dupExamples.length > 0) w(`  duplicate-name examples: ${dupExamples.join(" | ")}`)
w(`SymbolKind census: ${[...kindCounts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n.toLocaleString()}`).join("  ")}`)
w(`relationship-type wire values observed: ${[...byType.keys()].sort().join(", ") || "(none)"}`)
w(`endpoints equal to the literal "unknown": ${unknownEndpoints.size === 0 ? 0 : [...unknownEndpoints].slice(0, 5).join(", ")}`)
w("")
w(`${pad("type", 14)}${pad("edges", 10)}${pad("files", 8)}${pad("resBoth", 10)}${pad("res%", 9)}${pad("srcMiss", 9)}${pad("tgtMiss", 9)}${pad("<0.7", 7)}${pad("line<=0", 9)}${pad("self", 6)}evidenceClass`)
w("-".repeat(150))
for (const t of [...byType.keys()].sort()) {
  const r = byType.get(t)!
  const res = r.n > 0 ? (r.resolvedBoth / r.n) * 100 : 0
  w(
    `${pad(t, 14)}${pad(r.n.toLocaleString(), 10)}${pad(String(r.files.size), 8)}${pad(r.resolvedBoth.toLocaleString(), 10)}${pad(res.toFixed(1) + "%", 9)}${pad(String(r.unresolvedSource), 9)}${pad(String(r.unresolvedTarget), 9)}${pad(String(r.confLt7), 7)}${pad(String(r.lineMissing + r.lineNonPositive), 9)}${pad(String(r.self), 6)}${[...r.evidenceClasses.entries()].map(([k, n]) => `${k}:${n}`).join(", ")}`,
  )
}
const inOntology = [...byType.keys()].filter((k) => (ALL_RELSET as ReadonlySet<string>).has(k))
w("")
w(`types inside the 10-type ontology: ${inOntology.length ? inOntology.join(", ") : "(none)"}`)
w(`types OUTSIDE the ontology (counted, unjudged): ${[...byType.keys()].filter((k) => !(ALL_RELSET as ReadonlySet<string>).has(k)).join(", ") || "(none)"}`)
for (const t of ALL_TYPES) if (!byType.has(t)) w(`  ${t}: 0 edges`)
w("")
w(`examples per emitted type:`)
for (const t of inOntology) {
  const r = byType.get(t)!
  w(`  ${t}: ${r.examples.slice(0, 3).join("  |  ")}`)
}

// --- phase B/C ----------------------------------------------------------------

if (phase === "bc" || phase === "all") {
  w("")
  w(`== INSTRUMENT A — grammar inventory over ${corpus.length} files ==`)
  w(`${nodeTypeCounts.size} distinct node types observed:`)
  const sorted = [...nodeTypeCounts.entries()].sort((a, b) => b[1] - a[1])
  for (const [k, n] of sorted) w(`  ${pad(k, 24)}${n.toLocaleString()}`)

  w("")
  w(`== INSTRUMENT B — semantic probes on the parse tree ==`)
  for (const [key, probe] of Object.entries(probes)) {
    w(`${pad(key, 34)}${pad(probe.instrument, 24)}occurrences=${pad(String(probe.hits.length), 8)}files=${probe.hitFiles.size}`)
    // Every marker broken out by its own name, and every file-extension target
    // broken out by extension. A single number over a mixed population is the
    // shape the gate's header warns about, so the breakdown is the answer and
    // the total is only its sum.
    const byMarker = new Map<string, number>()
    const byExt = new Map<string, number>()
    for (const h of probe.hits) {
      const m = /\[marker:([^\]]+)\]/.exec(h.detail)
      if (m) byMarker.set(m[1], (byMarker.get(m[1]) ?? 0) + 1)
      if (h.detail.includes("-> ")) {
        const tail = h.detail.split("-> ")[1] ?? ""
        const sp = tail.lastIndexOf(" (exists,")
        if (sp > 0) {
          const ext = path.extname(tail.slice(0, sp)).toLowerCase() || "(no extension)"
          byExt.set(ext, (byExt.get(ext) ?? 0) + 1)
        }
      }
    }
    if (byMarker.size > 0) w(`      by marker key:  ${[...byMarker.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join("  ")}`)
    if (byExt.size > 0) w(`      by target ext:  ${[...byExt.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join("  ")}`)
    // Per-FILE, so a population concentrated in one repository is visible as such.
    // "169 hits across 6 files" and "169 hits across 169 files" are different
    // findings and only the second sentence says which tool owns them.
    const byFile = new Map<string, number>()
    for (const h of probe.hits) byFile.set(h.file, (byFile.get(h.file) ?? 0) + 1)
    const topFiles = [...byFile.entries()].sort((a, b) => b[1] - a[1])
    w(`      distinct files: ${topFiles.length}${topFiles.length > 0 ? `  top: ${topFiles.slice(0, 5).map(([f, n]) => `${f}=${n}`).join("  ")}` : ""}`)
    for (const h of probe.hits.slice(0, 5)) w(`      ${h.file}:${h.line}  ${h.detail}`)
    if (probe.hits.length > 5) w(`      ... ${probe.hits.length - 5} more`)
  }
}

// --- phase E -----------------------------------------------------------------

if (phase !== "a") {
  w("")
  w(`== PHASE E — the analyzer's OWN output vs what production stores ==`)
  w(`analyze() edges ${pipeline.analyzerEdges.toLocaleString()}   parseFile edges ${pipeline.parseFileEdges.toLocaleString()}   emitted by the analyzer and NOT returned by parseFile: ${pipeline.dropped.toLocaleString()}`)
  for (const h of pipeline.examples) w(`      ${h.file}:${h.line}  ${h.detail}`)
  if (pipeline.dropped > pipeline.examples.length) w(`      ... ${pipeline.dropped - pipeline.examples.length} more`)
  w(`=> \`filterNoiseRelationships\` in src/ast/pool-worker.ts computes a target's leaf by SPLITTING ON \`:\` and \`.\`. A TOML key may contain a colon, so the leaf of \`project.urls."CI: Azure Pipelines"\` is \`" Azure Pipelines"\`, which then trips the \`leaf.startsWith(" ")\` clause and the edge is dropped. The colon split is an Objective-C selector-arity accommodation; it is applied to every language.`)
}

// --- phase D ------------------------------------------------------------------

if (defects.length > 0) {
  w("")
  w(`== ANALYZER-DEFECT PROBES ==`)
  for (const d of defects) {
    w(`${pad(d.id, 5)}${pad(String(d.occurrences), 8)}in ${pad(String(d.files), 6)} file(s)  ${d.question}`)
    for (const e of d.examples) w(`      ${e}`)
    if (d.occurrences > d.examples.length) w(`      ... ${d.occurrences - d.examples.length} more`)
    w(`      => ${d.meaning}`)
  }
}

const { writeFileSync, mkdirSync } = await import("node:fs")
const OUT = process.env.BB_TOML_CENSUS_OUT ?? "/tmp/opencode/toml-census.txt"
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, out.join("\n") + "\n")
if (!quiet) console.error(`[census] report -> ${OUT}`)