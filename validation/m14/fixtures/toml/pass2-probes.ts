/**
 * TOML PASS-2 ADVERSARIAL PROBES (#289) — the questions pass 1 did not ask.
 *
 * ## Why this file exists
 *
 * Pass 1 produced 1 EMITTED type and 9 RULED types. A ruling table built on those
 * numbers is only as good as the numbers, and pass 1's own report says the table
 * was never checked by the arbiter (`script/m14/ontology-coverage-gate.ts toml`
 * exits 2 with `no RULING TABLE for toml`). So this file does three things the
 * census cannot:
 *
 *   1. It re-measures every ruled type with a ROLE probe rather than a SHAPE
 *      probe. Pass 1's `references` probe counted keys NAMED `ref`; that is a
 *      shape. The role question is "does a value in this document name another
 *      key in this document", and that is a different measurement with a
 *      different answer — measured here, per dialect, with the resolution rate
 *      each candidate edge would actually get.
 *   2. It attacks `contains`, the one EMITTED type. Pass 1 measured 100%
 *      resolution WITHIN a file. This measures whether an edge agrees with the
 *      symbol it names (source == ownerName), whether any published symbol has no
 *      incoming edge at all, and — the one pass 1 never asked — whether a symbol
 *      name is unique inside a REPOSITORY, which is the scope the graph resolves
 *      in.
 *   3. It decides whether pass 1's two "the corpus contains it but it is not the
 *      construct" rulings survive an adversarial reading: the duplicate `[core]`
 *      header (1 occurrence) and the seven values naming an existing `.toml`.
 *      For the header the deciding question is whether the PARSER accepts the
 *      document, which is a fact about the tree rather than about the spec.
 *
 * READ-ONLY with respect to the repository and the corpus.
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "toml"
const quiet = process.argv.includes("--quiet")

// ---------------------------------------------------------------- corpus, the gate's admission rule

type CorpusFile = { repo: string; dir: string; rel: string; abs: string }
const corpus: CorpusFile[] = []
const repoCounts: Record<string, number> = {}
for (const e of readdirSync(CR).sort()) {
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
    try {
      if (statSync(abs).size > 512 * 1024) continue
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs) !== LANG) continue
    corpus.push({ repo: e, dir, rel, abs })
    n++
  }
  if (n > 0) repoCounts[e] = n
}
corpus.sort((a, b) => (a.repo === b.repo ? a.rel.localeCompare(b.rel) : a.repo.localeCompare(b.repo)))

// ---------------------------------------------------------------- tree helpers

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
const kids = (n: any): any[] => ((n.namedChildren ?? []) as any[]).filter(Boolean)
function walk(root: any, fn: (n: any, parent: any | null) => void): void {
  const stack: { n: any; p: any | null }[] = [{ n: root, p: null }]
  while (stack.length > 0) {
    const { n, p } = stack.pop()!
    fn(n, p)
    const k = kids(n)
    for (let i = k.length - 1; i >= 0; i--) if (k[i]) stack.push({ n: k[i], p: n })
  }
}
const keyNodeOf = (n: any): any => {
  for (const c of kids(n)) if (c.type === "bare_key" || c.type === "quoted_key" || c.type === "dotted_key") return c
  return null
}
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
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 45)) return false
  }
  return true
}
const spell = (seg: string): string => (isBareWritable(seg) ? seg : `"${seg.replace(/["\\]/g, (m) => "\\" + m)}"`)
const joinPath = (segs: string[]): string => segs.map(spell).join(".")
const lineOf = (n: any): number => n.startPosition.row + 1

// ---------------------------------------------------------------- phase A: production parseFile

type Sym = { name: string; kind: string; ownerName?: string; qualifiedName?: string }
type Edge = { type: string; source: string; target: string; confidence: number; line: number; evidenceClass: string }
type AFile = { repo: string; rel: string; ok: boolean; symbols: Sym[]; edges: Edge[]; label: string }
const A: AFile[] = []
{
  let idx = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const i = idx++
      if (i >= corpus.length) return
      const f = corpus[i]
      const label = `${f.repo}/${f.rel}`
      try {
        // THE PROJECT ROOT IS HANDED OVER, because the file-scoped identity is COMPUTED from
        // it. Without it the scope is empty and every `Cargo.toml` in a repository publishes
        // the same qualified names — the collision the identity rule exists to remove — so an
        // unrooted probe would measure the defect and not the fix, on the same input. This is
        // the call shape `incoming-gate.ts` uses for every lane.
        const r: any = await parseFile(f.abs, f.dir, { projectRoot: f.dir } as any)
        A.push({
          repo: f.repo,
          rel: f.rel,
          ok: true,
          label,
          symbols: (r.symbols ?? []).map((s: any) => ({
            name: String(s.name ?? ""),
            kind: String(s.kind ?? ""),
            ownerName: s.ownerName === undefined || s.ownerName === null ? undefined : String(s.ownerName),
            qualifiedName: s.qualifiedName === undefined || s.qualifiedName === null ? undefined : String(s.qualifiedName),
          })),
          edges: (r.relationships ?? []).map((x: any) => ({
            type: String(x.type ?? x.relationshipType ?? ""),
            source: String(x.source ?? ""),
            target: String(x.target ?? ""),
            confidence: typeof x.confidence === "number" ? x.confidence : -1,
            line: typeof x.line_number === "number" ? x.line_number : -1,
            evidenceClass: String(x?.metadata?.evidenceClass ?? ""),
          })),
        })
      } catch (err) {
        A.push({ repo: f.repo, rel: f.rel, ok: false, label, symbols: [], edges: [] })
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => worker()))
  A.sort((a, b) => a.label.localeCompare(b.label))
}

// ---------------------------------------------------------------- P1: does every `contains` edge agree with the symbol it names?

const p1 = {
  edges: 0,
  ownerAgrees: 0,
  ownerDisagrees: 0,
  disagreeExamples: [] as string[],
  sourceDangling: 0,
  targetDangling: 0,
  orphanSymbols: 0,
  orphanByKind: new Map<string, number>(),
  orphanExamples: [] as string[],
  orphanNoIncoming: 0,
  multiIncoming: 0,
}
{
  for (const f of A) {
    if (!f.ok) continue
    // THE KEY SPACE IS THE RESOLVER'S: `name` AND `qualifiedName`. Since 2026-10-09 the analyzer
    // writes the file-scoped qualified name on both ends of every edge (a document-relative
    // target names N declarations in a project with two manifests of the same shape), so a probe
    // that looked targets up by bare `name` alone would report every correct edge as dangling —
    // an instrument reading a different object than the consumer, which is the defect class this
    // file exists to catch.
    const byKey = new Map<string, Sym[]>()
    const moduleQ = String(f.symbols.find((s) => s.kind === "module")?.qualifiedName ?? "")
    for (const s of f.symbols) {
      for (const k of new Set<string>([s.name, s.qualifiedName ?? ""].filter((x) => x !== ""))) {
        const arr = byKey.get(k) ?? []
        arr.push(s)
        byKey.set(k, arr)
      }
    }
    const incoming = new Map<string, number>()
    for (const e of f.edges) {
      if (e.type !== "contains") continue
      p1.edges++
      const src = byKey.get(e.source)
      const tgt = byKey.get(e.target)
      if (!src) p1.sourceDangling++
      if (!tgt) {
        p1.targetDangling++
        if (p1.disagreeExamples.length < 10)
          p1.disagreeExamples.push(`${f.label}:${e.line}  target ${JSON.stringify(e.target)} is not a published symbol`)
        continue
      }
      const sym = tgt[0] as Sym
      // The owner the edge ACTUALLY names, spelled the way the edge spells it: the owner's
      // qualified name is the module prefix plus the owner's own name, and for a key in the
      // implicit root table the owner IS the module (its qualified name is the prefix itself).
      const expectedOwner =
        sym.ownerName === undefined || sym.ownerName === moduleQ
          ? moduleQ
          : `${moduleQ}.${sym.ownerName}`
      if (expectedOwner === e.source) p1.ownerAgrees++
      else {
        p1.ownerDisagrees++
        if (p1.disagreeExamples.length < 10)
          p1.disagreeExamples.push(
            `${f.label}:${e.line}  edge ${JSON.stringify(e.source)} -> ${JSON.stringify(e.target)} but the symbol's ownerName is ${JSON.stringify(sym.ownerName)}`,
          )
      }
      for (const k of new Set<string>([e.target])) incoming.set(k, (incoming.get(k) ?? 0) + 1)
    }
    for (const s of f.symbols) {
      const n = incoming.get(s.qualifiedName ?? "") ?? incoming.get(s.name) ?? 0
      if (n === 0) {
        p1.orphanSymbols++
        p1.orphanByKind.set(s.kind, (p1.orphanByKind.get(s.kind) ?? 0) + 1)
        if (s.ownerName === undefined) p1.orphanNoIncoming++
        if (p1.orphanExamples.length < 10)
          p1.orphanExamples.push(`${f.label}  ${s.kind} ${JSON.stringify(s.name)} owner=${JSON.stringify(s.ownerName)}`)
      }
      if (n > 1) p1.multiIncoming++
    }
  }
}

// ---------------------------------------------------------------- P2: is a symbol name unique inside a REPOSITORY?
//
// The census measures resolution INSIDE one file, where names are unique by
// construction (0 duplicates in 1,141 files). The graph is not per-file: bb
// resolves a relationship endpoint to a symbol across the indexed project, so the
// honest question is how often a `contains` target names exactly one file in its
// own repository.

const p2 = { edges: 0, unique: 0, ambiguous: 0, repoUnknown: 0, top: [] as string[], byRepo: [] as string[] }
{
  const nameToFiles = new Map<string, Set<string>>() // repo \0 name -> files
  for (const f of A) {
    if (!f.ok) continue
    for (const s of f.symbols) {
      // Both keys the resolver indexes, for the reason P1 states: a probe that asks a
      // different question than the resolver gets an answer about a different program.
      for (const key of new Set<string>([s.name, s.qualifiedName ?? ""].filter((x) => x !== ""))) {
        const k = `${f.repo}\0${key}`
        const set = nameToFiles.get(k) ?? new Set<string>()
        set.add(f.rel)
        nameToFiles.set(k, set)
      }
    }
  }
  const perRepo = new Map<string, { edges: number; uniq: number; amb: number }>()
  for (const f of A) {
    if (!f.ok) continue
    const row = perRepo.get(f.repo) ?? { edges: 0, uniq: 0, amb: 0 }
    for (const e of f.edges) {
      if (e.type !== "contains") continue
      p2.edges++
      row.edges++
      const set = nameToFiles.get(`${f.repo}\0${e.target}`)
      if (!set) {
        p2.repoUnknown++
        row.amb++
      } else if (set.size === 1) {
        p2.unique++
        row.uniq++
      } else {
        p2.ambiguous++
        row.amb++
        if (p2.top.length < 12) p2.top.push(`${f.repo}: ${JSON.stringify(e.target)} is published by ${set.size} files (this one: ${f.rel})`)
      }
    }
    perRepo.set(f.repo, row)
  }
  for (const [repo, row] of [...perRepo.entries()].sort((a, b) => b[1].amb - a[1].amb).slice(0, 8))
    p2.byRepo.push(`${repo}: ${row.edges} edges, ${row.uniq} target-name-in-1-file, ${row.amb} in 2+ files`)
}

// ---------------------------------------------------------------- one tree pass: the role probes

type Hit = { file: string; line: number; detail: string }
const valueNamesKeyHits: Hit[] = []
const role = {
  /** `uses`/`references` role probe: a value that NAMES another key of the SAME document. */
  valueNamesKey: { selfMatch: 0, refMatch: 0, other: 0, otherExamples: [] as string[] },
  valueNamesKeyFiles: new Set<string>(),
  /** `references` role probe: cargo `x.workspace = true`, with the resolution rate. */
  cargoWs: {
    hits: 0,
    sameFile: 0,
    repoFile: 0,
    miss: 0,
    files: new Set<string>(),
    form: { "dotted-in-section": 0, "inline-table": 0 } as Record<string, number>,
    missExamples: [] as string[],
    hitExamples: [] as string[],
  },
  /** pass 1's 1,269 figure, decomposed so the two numbers can be reconciled. */
  inheritMarker: { count: 0, outsideCargo: 0, byLeaf: new Map<string, number>(), outsideExamples: [] as string[] },
  /** `references` role probe: gradle `version.ref = "<alias>"`, with the resolution rate. */
  gradleRef: { hits: 0, resolved: 0, miss: 0, files: new Set<string>(), missExamples: [] as string[], hitExamples: [] as string[] },
  /** `overrides`: is the duplicate `[core]` header inside a document the parser accepts? */
  dupHeader: { count: 0, accepted: 0, rejected: 0, files: new Set<string>(), examples: [] as string[] },
  /** `imports` role probe: which KEY carries a value naming an existing .toml. */
  tomlValued: { count: 0, sameStemAsSource: 0, examples: [] as string[], keys: new Map<string, number>() },
  /** a section whose every path segment is empty: the section is dropped, and so are its keys. */
  emptySection: { count: 0, keysLost: 0, files: new Set<string>(), examples: [] as string[] },
  /** a dotted key whose intermediate table the document never declares. */
  dottedImplied: { keys: 0, files: new Set<string>(), examples: [] as string[] },
  /** a `pair` inside an ERROR region — the walk does not descend, so it is not published. */
  inError: { pairs: 0, errNodes: 0, files: new Set<string>(), examples: [] as string[], childKinds: new Map<string, number>() },
  /** limitation 3: a plain `[x.y]` after 2+ `[[x.y]]` elements — which element owns it. */
  arrayLastWins: { count: 0, files: new Set<string>(), examples: [] as string[] },
  /** `exports` role probe: a value naming a build target that EXISTS on disk (cargo's `path`). */
  buildPathExists: { count: 0, files: new Set<string>(), examples: [] as string[] },
}

/** Every key path the document declares, spelled the way the analyzer spells it. */
const declaredKeysOf = (root: any): Set<string> => {
  const out = new Set<string>()
  for (const n of kids(root)) {
    if (n.type === "table" || n.type === "table_array_element") {
      const h = keyNodeOf(n)
      if (!h) continue
      const sec = joinPath(segmentsOf(h))
      for (const c of kids(n)) {
        if (c.type !== "pair") continue
        const ck = keyNodeOf(c)
        if (!ck) continue
        out.add(`${sec}.${joinPath(segmentsOf(ck))}`)
      }
    } else if (n.type === "pair") {
      const ck = keyNodeOf(n)
      if (!ck) continue
      out.add(joinPath(segmentsOf(ck)))
    }
  }
  return out
}
const tablePathsOf = (root: any): Map<string, { isArray: boolean; ordinal: number }> => {
  const out = new Map<string, { isArray: boolean; ordinal: number }>()
  const ord = new Map<string, number>()
  for (const n of kids(root)) {
    if (n.type !== "table" && n.type !== "table_array_element") continue
    const h = keyNodeOf(n)
    if (!h) continue
    const p = joinPath(segmentsOf(h))
    const isArray = n.type === "table_array_element"
    const o = isArray ? (ord.get(p) ?? 0) + 1 : 1
    if (isArray) ord.set(p, o)
    out.set(p, { isArray, ordinal: o })
  }
  return out
}

{
  const P = await getParser()
  // Pre-pass: every table header and every key path, per REPOSITORY. The cargo
  // probe needs to know whether an inheritance target is declared in another file
  // of the same repo, and that question cannot be answered from one file.
  const repoTables = new Map<string, Set<string>>()
  const repoKeys = new Map<string, Set<string>>()
  for (const f of corpus) {
    const t0 = P.parse(readFileSync(f.abs, "utf8"))
    if (!t0) continue
    const tt = repoTables.get(f.repo) ?? new Set<string>()
    for (const p of tablePathsOf(t0.rootNode).keys()) tt.add(p)
    repoTables.set(f.repo, tt)
    const kk = repoKeys.get(f.repo) ?? new Set<string>()
    for (const p of declaredKeysOf(t0.rootNode)) kk.add(p)
    repoKeys.set(f.repo, kk)
    t0.delete?.()
  }

  for (const f of corpus) {
    const label = `${f.repo}/${f.rel}`
    const text = readFileSync(f.abs, "utf8")
    const t = P.parse(text)
    if (!t) continue
    const root = t.rootNode
    const declaredKeys = declaredKeysOf(root)
    const tables = tablePathsOf(root)
    const declaredLeafs = new Set<string>()
    for (const k of declaredKeys) {
      const parts = k.split(".")
      declaredLeafs.add(parts[parts.length - 1] as string)
    }

    // -- `uses` / `references` role probe: a value that NAMES another key of this document.
    walk(root, (n) => {
      if (n.type !== "pair") return
      const k = keyNodeOf(n)
      if (!k) return
      const v = kids(n)[kids(n).length - 1]
      if (!v || v.type !== "string") return
      const raw = String(v.text ?? "")
      const inner = /^(['"])([\s\S]*)\1$/.exec(raw)
      const value = inner ? inner[2] as string : raw
      if (value.length === 0 || value.length > 80) return
      // A NAME, not a path and not prose: no separator, no extension, no space.
      if (/[^A-Za-z0-9_.\-]/.test(value)) return
      const full = declaredKeys.has(value)
      const leafHit = declaredLeafs.has(value)
      if (!full && !leafHit) return
      const segs = segmentsOf(k)
      const path = joinPath(segs)
      const ownLeaf = segs[segs.length - 1] === value
      // A value that equals the DECLARING key's own leaf is not a reference to
      // anything: typos' `[default.extend-words] BRE = "BRE"` declares a
      // correction whose replacement happens to be the word it corrects. Counting
      // those as references is the "matches a SHAPE rather than a ROLE" failure.
      if (ownLeaf) role.valueNamesKey.selfMatch++
      else if (segs[segs.length - 1] === "ref") role.valueNamesKey.refMatch++
      else {
        role.valueNamesKey.other++
        if (role.valueNamesKey.otherExamples.length < 10)
          role.valueNamesKey.otherExamples.push(`${label}:${lineOf(k)}  ${path} = ${JSON.stringify(value)} names a DIFFERENT key of this document`)
      }
      const kindOfMatch = full ? "FULL PATH" : "leaf only"
      valueNamesKeyHits.push({ file: label, line: lineOf(k), detail: `${path} = ${JSON.stringify(value)} matches ${kindOfMatch} key(s) of this document${ownLeaf ? "  (value equals its OWN leaf)" : ""}` })
      role.valueNamesKeyFiles.add(label)
    })

    // -- `references` role probe 1: cargo workspace inheritance, WITH its resolution rate.
    //
    // Cargo's rule: inside `[package]`, `edition.workspace = true` means
    // `package.edition` takes the value of `[workspace.package] edition` in the
    // WORKSPACE ROOT manifest, so the target is `workspace.` + the key's OWNING PATH,
    // and the owning path is the ENCLOSING SECTION plus the key's segments minus the
    // leaf. The first version of this probe used the key's segments alone, so
    // `edition.workspace = true` inside `[package]` asked for `workspace.edition`,
    // which no cargo manifest declares; it reported 674 misses of 679 on a construct
    // cargo's own root resolves. A probe that computes the wrong target measures the
    // probe, not the language.
    //
    // There are TWO spellings of the rule and both are counted separately, because a
    // count that mixes them cannot be read: `edition.workspace = true` in a section,
    // and a bare `workspace = true` inside an inline table that is another pair's
    // value (`serde = { workspace = true }`). They resolve by the same cargo rule and
    // they are written by different hands.
    if (path.basename(f.rel) === "Cargo.toml") {
      const record = (k: any, segs: string[], section: string, owner: string, form: string): void => {
        role.cargoWs.hits++
        role.cargoWs.files.add(label)
        role.cargoWs.form[form] = (role.cargoWs.form[form] ?? 0) + 1
        const target = owner.length > 0 ? `workspace.${owner}` : ""
        const where = `${section}${joinPath(segs)} = true`
        if (target.length > 0 && declaredKeys.has(target)) {
          role.cargoWs.sameFile++
          if (role.cargoWs.hitExamples.length < 6)
            role.cargoWs.hitExamples.push(`${label}:${lineOf(k)}  ${where}  ->  ${target}  (declared in THIS file)`)
        } else if (target.length > 0 && repoKeys.get(f.repo)?.has(target)) {
          role.cargoWs.repoFile++
          if (role.cargoWs.hitExamples.length < 6)
            role.cargoWs.hitExamples.push(`${label}:${lineOf(k)}  ${where}  ->  ${target}  (declared in ANOTHER file of the repo)`)
        } else {
          role.cargoWs.miss++
          if (role.cargoWs.missExamples.length < 6)
            role.cargoWs.missExamples.push(`${label}:${lineOf(k)}  ${where}  ->  ${target || "(no owning path)"}  NOT declared`)
        }
      }
      const walkPairs = (n: any, section: string, owner: string | null): void => {
        if (n.type === "pair") {
          const k = keyNodeOf(n)
          if (!k) return
          const segs = segmentsOf(k)
          const v = kids(n)[kids(n).length - 1]
          if (segs[segs.length - 1] === "workspace" && v?.type === "boolean" && v.text.trim() === "true") {
            const path = owner !== null ? owner : section.length > 0 ? `${section}${joinPath(segs.slice(0, -1))}` : joinPath(segs.slice(0, -1))
            record(k, segs, section, path, owner !== null ? "inline-table" : "dotted-in-section")
          }
          // An inline table is a pair's VALUE, so the pairs inside it belong to that
          // pair's key. Nothing else under a pair needs walking.
          if (v?.type === "inline_table") {
            const inner = section.length > 0 ? `${section}${joinPath(segs)}` : joinPath(segs)
            for (const c of kids(v)) walkPairs(c, section, inner)
          }
          return
        }
        for (const c of kids(n)) walkPairs(c, section, owner)
      }
      const visit = (n: any, section: string): void => {
        if (n.type === "table" || n.type === "table_array_element") {
          const h = keyNodeOf(n)
          const seg = h ? joinPath(segmentsOf(h)) : ""
          for (const c of kids(n)) visit(c, seg.length > 0 ? `${seg}.` : "")
          return
        }
        if (n.type === "pair") {
          walkPairs(n, section, null)
          return
        }
        for (const c of kids(n)) visit(c, section)
      }
      visit(root, "")
    }

    // -- the same construct counted WITHOUT the Cargo.toml restriction and WITH
    //    every marker name pass 1 used, so the two numbers can be reconciled rather
    //    than compared. Pass 1's figure was 1,269 across 138 files; this is where
    //    those 1,269 are.
    walk(root, (n) => {
      if (n.type !== "pair") return
      const k = keyNodeOf(n)
      if (!k) return
      const segs = segmentsOf(k)
      const leaf = segs[segs.length - 1]
      const v = kids(n)[kids(n).length - 1]
      if (!v || v.type !== "boolean" || v.text.trim() !== "true") return
      if (!["workspace", "inherits", "inherit", "parent", "base"].includes(leaf)) return
      role.inheritMarker.count++
      role.inheritMarker.byLeaf.set(leaf, (role.inheritMarker.byLeaf.get(leaf) ?? 0) + 1)
      if (path.basename(f.rel) !== "Cargo.toml") {
        role.inheritMarker.outsideCargo++
        if (role.inheritMarker.outsideExamples.length < 6)
          role.inheritMarker.outsideExamples.push(`${label}:${lineOf(k)}  ${joinPath(segs)} = true (file is not Cargo.toml)`)
      }
    })

    // -- `references` role probe 2: gradle version catalogue `version.ref = "<alias>"`.
    walk(root, (n) => {
      if (n.type !== "pair") return
      const k = keyNodeOf(n)
      if (!k) return
      const segs = segmentsOf(k)
      if (segs[segs.length - 1] !== "ref") return
      const v = kids(n)[kids(n).length - 1]
      if (!v || v.type !== "string") return
      const raw = String(v.text ?? "")
      const m = /^(['"])([\s\S]*)\1$/.exec(raw)
      const alias = m ? m[2] as string : raw
      if (alias.length === 0) return
      role.gradleRef.hits++
      role.gradleRef.files.add(label)
      // The catalogue declares its aliases as `versions.<alias>` — that is the
      // role question: does the alias name a key THIS document declares?
      const target = `versions.${spell(alias)}`
      if (declaredKeys.has(target) || declaredLeafs.has(alias)) {
        role.gradleRef.resolved++
        if (role.gradleRef.hitExamples.length < 6)
          role.gradleRef.hitExamples.push(`${label}:${lineOf(k)}  ${joinPath(segs)} = ${JSON.stringify(alias)}  ->  ${target} declared in THIS file`)
      } else {
        role.gradleRef.miss++
        if (role.gradleRef.missExamples.length < 6)
          role.gradleRef.missExamples.push(`${label}:${lineOf(k)}  ${joinPath(segs)} = ${JSON.stringify(alias)}  ->  ${target} NOT declared`)
      }
    })

    // -- `overrides`: does the parser ACCEPT the duplicate table header?
    {
      const seen = new Set<string>()
      for (const n of kids(root)) {
        if (n.type !== "table") continue
        const h = keyNodeOf(n)
        if (!h) continue
        const p = joinPath(segmentsOf(h))
        if (seen.has(p)) {
          role.dupHeader.count++
          role.dupHeader.files.add(label)
          // The document's own verdict: does the tree carry an ERROR or a MISSING
          // node anywhere? If it does, the parser already rejected the redefinition
          // and there is no replacement semantics to read.
          let hasError = false
          let hasMissing = false
          walk(root, (m) => {
            if (m.type === "ERROR") hasError = true
            if (m.isMissing) hasMissing = true
          })
          if (hasError || hasMissing) role.dupHeader.rejected++
          else role.dupHeader.accepted++
          if (role.dupHeader.examples.length < 6)
            role.dupHeader.examples.push(
              `${label}:${lineOf(h)}  [${p}] declared twice; document hasError=${hasError} hasMissing=${hasMissing}`,
            )
        }
        seen.add(p)
      }
    }

    // -- `imports` role probe: WHICH KEY carries a value naming an existing .toml.
    //
    // Two things are measured, because "there are 7" is not a finding on its own:
    // the KEY that carries each value (the role — a list a tool is told about, or a
    // config that genuinely extends another), and whether the target file's MODULE
    // NAME — the graph addresses nodes by name, and a TOML module is its file's
    // stem — is the same string as the source module's. When it is, the edge the
    // construct implies is `X -> X`, which is a self-edge by name and resolves to
    // nothing. Arrays are descended into, because pass 1's count of 7 came from array
    // elements and a probe that only reads scalars would have reported 1 and been
    // wrong in the other direction.
    const stemOf = (p2: string): string => path.basename(p2, path.extname(p2)) || "document"
    const checkTomlValue = (k: any, kp: string, value: string): void => {
      if (value.length === 0 || value.length > 300) return
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return
      if (value.includes("*") || value.includes("?") || value.includes("$")) return
      const cand = value.startsWith("/") ? value : path.resolve(path.dirname(f.abs), value)
      if (!existsSync(cand) || !statSync(cand).isFile()) return
      if (path.extname(cand).toLowerCase() !== ".toml") return
      role.tomlValued.count++
      role.tomlValued.keys.set(kp, (role.tomlValued.keys.get(kp) ?? 0) + 1)
      const sameStem = stemOf(cand) === stemOf(f.abs)
      if (sameStem) role.tomlValued.sameStemAsSource++
      if (role.tomlValued.examples.length < 12)
        role.tomlValued.examples.push(
          `${label}:${lineOf(k)}  key ${JSON.stringify(kp)} = ${JSON.stringify(value)}  ->  ${cand}   target module name ${JSON.stringify(stemOf(cand))} vs source ${JSON.stringify(stemOf(f.abs))}${sameStem ? "  *** SAME NAME — the edge would be a self-edge ***" : ""}`,
        )
    }
    const valueStrings = (v: any): string[] => {
      if (!v) return []
      if (v.type === "string") {
        const raw = String(v.text ?? "")
        const m = /^(['"])([\s\S]*)\1$/.exec(raw)
        return [m ? (m[2] as string) : raw]
      }
      if (v.type === "array") return kids(v).filter((c) => c.type === "string").flatMap((c) => valueStrings(c))
      return []
    }
    const walkValues = (n: any, prefix: string): void => {
      if (n.type === "table" || n.type === "table_array_element") {
        const h = keyNodeOf(n)
        const seg = h ? joinPath(segmentsOf(h)) : ""
        for (const c of kids(n)) walkValues(c, seg.length > 0 ? `${seg}.` : "")
        return
      }
      if (n.type !== "pair") {
        for (const c of kids(n)) walkValues(c, prefix)
        return
      }
      const k = keyNodeOf(n)
      if (!k) return
      const segs = segmentsOf(k)
      const kp = `${prefix}${joinPath(segs)}`
      const v = kids(n)[kids(n).length - 1]
      for (const s of valueStrings(v)) checkTomlValue(k, kp, s)
      if (v?.type === "inline_table") for (const c of kids(v)) walkValues(c, `${kp}.`)
    }
    walkValues(root, "")

    // -- a section whose every path segment is empty.
    for (const n of kids(root)) {
      if (n.type !== "table" && n.type !== "table_array_element") continue
      const h = keyNodeOf(n)
      if (!h) continue
      const segs = segmentsOf(h)
      if (segs.some((s) => s.length > 0)) continue
      const inner = kids(n).filter((c) => c.type === "pair").length
      role.emptySection.count++
      role.emptySection.keysLost += inner
      role.emptySection.files.add(label)
      if (role.emptySection.examples.length < 6)
        role.emptySection.examples.push(`${label}:${lineOf(h)}  header ${JSON.stringify(n.text)} has ${inner} key(s) inside`)
    }

    // -- a DOTTED key whose intermediate table the document never declares.
    //
    // `metadata.impliedParents` is recorded for a section HEADER whose ancestor is
    // missing, and the same rule is NOT applied to a dotted key: `[a]` followed by
    // `b.c = 1` declares the intermediate table `a.b`, which is never written and
    // never published, and the key symbol carries no record that it has a parent the
    // document did not write. Two halves of one rule, one of which is recorded. This
    // counts the population so the gap is a number rather than an observation.
    {
      const declaredTables = new Set(tables.keys())
      const visit = (n: any, prefix: string): void => {
        if (n.type === "table" || n.type === "table_array_element") {
          const h = keyNodeOf(n)
          const seg = h ? joinPath(segmentsOf(h)) : ""
          for (const c of kids(n)) visit(c, seg.length > 0 ? `${seg}.` : "")
          return
        }
        if (n.type !== "pair") return
        const k = keyNodeOf(n)
        if (!k) return
        const segs = segmentsOf(k)
        for (let i = 1; i < segs.length; i++) {
          const prefixPath = `${prefix}${joinPath(segs.slice(0, i))}`
          if (declaredTables.has(prefixPath)) continue
          if (declaredKeys.has(prefixPath)) continue
          role.dottedImplied.keys++
          role.dottedImplied.files.add(label)
          if (role.dottedImplied.examples.length < 8)
            role.dottedImplied.examples.push(`${label}:${lineOf(k)}  ${prefix}${joinPath(segs)} implies an undeclared table ${JSON.stringify(prefixPath)}`)
          break
        }
      }
      visit(root, "")
    }

    // -- a PAIR inside an ERROR region, at any depth. The walk uses `children` and
    //    does not stop at a recovery node, but it also does not descend INTO one, so
    //    a key whose value failed to parse would not be published. Pass 1 recorded
    //    the cost as "2 symbols in 2 files", measured on cargo; this measures the
    //    whole corpus and reports WHAT an ERROR region actually contains, because a
    //    count of 0 is only informative next to the reason for it.
    {
      const stack: { n: any; inErr: boolean }[] = [{ n: root, inErr: false }]
      while (stack.length > 0) {
        const { n, inErr } = stack.pop()!
        const isErr = n.type === "ERROR"
        if (isErr) {
          role.inError.errNodes++
          role.inError.files.add(label)
          for (const c of kids(n)) role.inError.childKinds.set(c.type, (role.inError.childKinds.get(c.type) ?? 0) + 1)
        }
        const inside = inErr || isErr
        for (const c of kids(n)) {
          if (inside && c.type === "pair") {
            role.inError.pairs++
            if (role.inError.examples.length < 8)
              role.inError.examples.push(`${label}:${lineOf(c)}  a pair inside an ERROR region: ${JSON.stringify(String(c.text ?? "").slice(0, 60))}`)
          }
          stack.push({ n: c, inErr: inside })
        }
      }
    }

    // -- limitation 3: a plain `[a.b]` that follows 2+ `[[a.b]]` elements.
    {
      const counts = new Map<string, { arr: number; plain: number }>()
      for (const n of kids(root)) {
        if (n.type !== "table" && n.type !== "table_array_element") continue
        const h = keyNodeOf(n)
        if (!h) continue
        const p = joinPath(segmentsOf(h))
        const row = counts.get(p) ?? { arr: 0, plain: 0 }
        if (n.type === "table_array_element") row.arr++
        else row.plain++
        counts.set(p, row)
      }
      for (const [p, row] of counts) {
        if (row.arr >= 2 && row.plain >= 1) {
          role.arrayLastWins.count++
          role.arrayLastWins.files.add(label)
          if (role.arrayLastWins.examples.length < 6) role.arrayLastWins.examples.push(`${label}  [${p}] x${row.arr} as [[array]] and x${row.plain} as [table]`)
        }
      }
    }

    // -- `exports` role probe: a `[lib]/[[bin]]/...` `path` value that EXISTS on disk.
    {
      walk(root, (n) => {
        if (n.type !== "table" && n.type !== "table_array_element") return
        const h = keyNodeOf(n)
        if (!h) return
        const p = joinPath(segmentsOf(h))
        const leaf = p.split(".").pop() ?? p
        if (!["lib", "bin", "bench", "test", "example"].includes(leaf)) return
        for (const c of kids(n)) {
          if (c.type !== "pair") continue
          const ck = keyNodeOf(c)
          if (!ck) continue
          const segs = segmentsOf(ck)
          if (segs[segs.length - 1] !== "path") continue
          const v = kids(c)[kids(c).length - 1]
          if (!v || v.type !== "string") continue
          const raw = String(v.text ?? "")
          const m = /^(['"])([\s\S]*)\1$/.exec(raw)
          const value = m ? m[2] as string : raw
          if (!value.endsWith(".rs")) continue
          const cand = path.resolve(path.dirname(f.abs), value)
          if (!existsSync(cand)) continue
          role.buildPathExists.count++
          role.buildPathExists.files.add(label)
          if (role.buildPathExists.examples.length < 6)
            role.buildPathExists.examples.push(`${label}:${lineOf(ck)}  [${p}] path = ${JSON.stringify(value)} exists`)
        }
      })
    }
    t.delete?.()
  }
}

// ---------------------------------------------------------------- DERIVATION: emitted types vs derived types

const derivation = { emitted: [] as string[], derived: ["contains"] as string[], findings: 0, findingTypes: [] as string[] }
{
  const emitted = new Set<string>()
  for (const f of A) for (const e of f.edges) emitted.add(e.type)
  derivation.emitted = [...emitted].sort()
  // `deriveTomlEdges` is a single function; its only `label` literal is
  // "contains" (script/m14/differential.ts, the `emit` helper inside it).
  derivation.findings = derivation.emitted.filter((t) => !derivation.derived.includes(t)).length
  derivation.findingTypes = derivation.emitted.filter((t) => !derivation.derived.includes(t))
}

// ---------------------------------------------------------------- report

const pad = (s: string, n: number): string => (s + " ".repeat(n)).slice(0, n)
const out: string[] = []
const w = (s: string): void => {
  if (!quiet) console.log(s)
  out.push(s)
}
w(`TOML pass-2 adversarial probes — corpus ${corpus.length} git-tracked .toml files across ${Object.keys(repoCounts).length} repositories`)
w(`production parseFile over ${A.filter((f) => f.ok).length} files (${A.filter((f) => !f.ok).length} threw)`)
w("")
w("== P1  does every `contains` edge agree with the symbol it names? ==")
w(`  edges ${p1.edges}   source resolves ${p1.edges - p1.sourceDangling}   target resolves ${p1.edges - p1.targetDangling}`)
w(`  edge source == the target symbol's ownerName: ${p1.ownerAgrees}   DISAGREE: ${p1.ownerDisagrees}`)
for (const e of p1.disagreeExamples) w(`      ${e}`)
w(`  published symbols with NO incoming contains edge: ${p1.orphanSymbols}  by kind ${[...p1.orphanByKind.entries()].map(([k, n]) => `${k}=${n}`).join(" ") || "(none)"}`)
for (const e of p1.orphanExamples) w(`      ${e}`)
w("")
w("== P2  is a symbol name unique inside its own REPOSITORY? (the scope the graph resolves in) ==")
w(`  contains edges ${p2.edges}   target name published by exactly 1 file: ${p2.unique} (${((p2.unique / p2.edges) * 100).toFixed(1)}%)   by 2+ files: ${p2.ambiguous} (${((p2.ambiguous / p2.edges) * 100).toFixed(1)}%)   no file: ${p2.repoUnknown}`)
for (const e of p2.byRepo) w(`      ${e}`)
for (const e of p2.top) w(`      ${e}`)
w("")
w("== ROLE PROBE  a value that NAMES another key of the SAME document (uses / references) ==")
w(`  occurrences ${valueNamesKeyHits.length} in ${role.valueNamesKeyFiles.size} file(s)`)
w(`  value equals its OWN key leaf (a typos correction, not a reference): ${role.valueNamesKey.selfMatch}`)
w(`  a \`ref\` key naming a DIFFERENT key (gradle version catalogue): ${role.valueNamesKey.refMatch}`)
w(`  anything else: ${role.valueNamesKey.other}`)
for (const e of role.valueNamesKey.otherExamples) w(`      ${e}`)
for (const h of valueNamesKeyHits.slice(0, 12)) w(`      ${h.file}:${h.line}  ${h.detail}`)
if (valueNamesKeyHits.length > 12) w(`      ... ${valueNamesKeyHits.length - 12} more`)
w("")
w("== ROLE PROBE  cargo `x.workspace = true`, and whether its target resolves ==")
w(`  occurrences ${role.cargoWs.hits} in ${role.cargoWs.files.size} Cargo.toml file(s); by form ${Object.entries(role.cargoWs.form).map(([k, n]) => `${k}=${n}`).join("  ")}`)
w(`  target declared in THIS file: ${role.cargoWs.sameFile}   declared in ANOTHER file of the repo: ${role.cargoWs.repoFile}   NOT declared anywhere in the repo: ${role.cargoWs.miss}`)
w(`  ALL markers over ALL files (pass 1's 1,269): ${role.inheritMarker.count}   by leaf ${[...role.inheritMarker.byLeaf.entries()].map(([k, n]) => `${k}=${n}`).join("  ")}   in files not named Cargo.toml: ${role.inheritMarker.outsideCargo}`)
for (const e of role.inheritMarker.outsideExamples) w(`      ${e}`)
for (const e of role.cargoWs.hitExamples) w(`      ${e}`)
for (const e of role.cargoWs.missExamples) w(`      ${e}`)
w("")
w("== ROLE PROBE  gradle `version.ref = \"<alias>\"`, and whether the alias resolves ==")
w(`  occurrences ${role.gradleRef.hits} in ${role.gradleRef.files.size} file(s)   resolved in this document: ${role.gradleRef.resolved}   NOT: ${role.gradleRef.miss}`)
for (const e of role.gradleRef.hitExamples) w(`      ${e}`)
for (const e of role.gradleRef.missExamples) w(`      ${e}`)
w("")
w("== overrides  is the duplicate table header in a document the PARSER accepts? ==")
w(`  duplicate [table] headers ${role.dupHeader.count} in ${role.dupHeader.files.size} file(s)   document carries ERROR/MISSING: ${role.dupHeader.rejected}   parser accepted it: ${role.dupHeader.accepted}`)
for (const e of role.dupHeader.examples) w(`      ${e}`)
w("")
w("== imports  WHICH KEY carries a value naming an existing .toml ==")
w(`  occurrences ${role.tomlValued.count}; of those, the TARGET FILE'S MODULE NAME EQUALS THE SOURCE'S: ${role.tomlValued.sameStemAsSource}`)
w(`  keys that carry one: ${[...role.tomlValued.keys.entries()].map(([k, n]) => `${k}=${n}`).join("  ") || "(none)"}`)
for (const e of role.tomlValued.examples) w(`      ${e}`)
w("")
w("== exports  a [lib]/[[bin]]/[[bench]]/[[test]]/[[example]] `path` value that EXISTS on disk ==")
w(`  occurrences ${role.buildPathExists.count} in ${role.buildPathExists.files.size} file(s)`)
for (const e of role.buildPathExists.examples) w(`      ${e}`)
w("")
w("== a section whose every path segment is empty (the section AND its keys are dropped) ==")
w(`  occurrences ${role.emptySection.count} in ${role.emptySection.files.size} file(s); keys inside them ${role.emptySection.keysLost}`)
for (const e of role.emptySection.examples) w(`      ${e}`)
w("")
w("== a DOTTED key implying an undeclared intermediate table (metadata gap; 0 on the corpus is NOT a clean bill) ==")
w(`  occurrences ${role.dottedImplied.keys} in ${role.dottedImplied.files.size} file(s)`)
for (const e of role.dottedImplied.examples) w(`      ${e}`)
w("")
w("== a PAIR inside an ERROR region — not published ==")
w(`  ERROR nodes ${role.inError.errNodes} in ${role.inError.files.size} file(s); pairs anywhere inside one: ${role.inError.pairs}`)
w(`  child node types inside an ERROR: ${[...role.inError.childKinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join("  ") || "(none)"}`)
for (const e of role.inError.examples) w(`      ${e}`)
w("")
w("== limitation 3  a plain [a.b] that follows 2+ [[a.b]] elements ==")
w(`  occurrences ${role.arrayLastWins.count} in ${role.arrayLastWins.files.size} file(s)`)
for (const e of role.arrayLastWins.examples) w(`      ${e}`)
w("")
w("== DERIVATION findings ==")
w(`  emitted types: ${derivation.emitted.join(", ") || "(none)"}`)
w(`  types deriveTomlEdges derives: ${derivation.derived.join(", ")}`)
w(`  DERIVATION findings: ${derivation.findings}${derivation.findingTypes.length ? ` (${derivation.findingTypes.join(", ")})` : ""}`)

const { writeFileSync, mkdirSync } = await import("node:fs")
const OUT = process.env.BB_TOML_PASS2_OUT ?? "/tmp/opencode/toml-pass2.txt"
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, out.join("\n") + "\n")