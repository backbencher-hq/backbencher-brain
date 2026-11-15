/**
 * REFERENCES TARGET LEDGER — is the TARGET of a `references` edge a value the file writes,
 * under the source that claims it?
 *
 * ## THE QUESTION, AND WHY IT IS NOT THE RESOLUTION RATE
 *
 * `references` is the lane's highest-volume type after `contains`: 11,094 edges on the
 * arbiter's full-population pass, resolving at **48.4 %** of targets. The lane's own
 * `derivation-accounting.mts` already answers the SOURCE question — is the source a name the
 * file declares — and it found and fixed a fabricated source on 1,066 of 10,411 edges.
 *
 * The TARGET has never been asked the same way, and the resolution rate cannot ask it:
 * `metadata.resolvable` splits targets into `in-document` / `builtin` / `external` /
 * `unresolved`, and the two classes that are SUPPOSED to have no local symbol are 54.6 % of
 * the type. So a rate over all targets measures the vocabulary mix of XML Schema, not the
 * honesty of the edges.
 *
 * ## WHAT IT CHECKS, PER EDGE
 *
 * For every `references` edge (source -> target), walk the file's tree for an `Attribute`
 * whose `AttValue` carries a token whose LOCAL part is the target, and ask whether that
 * attribute sits on an element the source names — the element itself, or anything inside
 * it. Then:
 *
 *   covered            an attribute under the source writes that name
 *   value-elsewhere    the file writes the name, but not under the source
 *   no-value           nothing in the file writes that name (expected for `builtin`)
 *   source-absent      no symbol in the file carries the source's name
 *
 * The direction that matters is `no-value` on an edge whose `resolvable` says
 * `in-document`: that is an edge claiming a local declaration that no attribute in the file
 * spells. It is the fabricated-target class, and it is the mirror of the source defect the
 * lane already paid down.
 *
 * ## WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not decide which attributes are reference carriers. Enumerating "every attribute
 * whose value is QName-shaped" is a superset that includes `id="foo"` and `version="1.0"`
 * shaped data, and adjudicating thousands of those is how a probe grows a second analyzer.
 * The check is one-directional and it asks the edge to produce its own evidence, which is
 * the same discipline `derivation-accounting.mts` uses for `extends`: match a site to an
 * edge by observable facts, never re-derive the analyzer's accept/refuse test.
 *
 * `builtin` and `external` targets are expected to have no local value and are counted
 * separately rather than judged; only `in-document` and `unresolved` are graded.
 *
 * CLI: npx tsx validation/m14/fixtures/xml/references-target-ledger.mts
 *   BB_REFLEDGER_MAX=2500   bound the file count (0 = the whole admitted population)
 *   BB_XML_WORKERS=1        production parseFile concurrency
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const WORKERS = Number(process.env.BB_XML_WORKERS ?? "1")
const MAX_FILES = Number(process.env.BB_REFLEDGER_MAX ?? "2500")
const HERE = import.meta.dirname
const OUT = path.join(HERE, "references-target-ledger.json")

const { parseFile } = (await import("../../../../src/ast/pool-worker")) as any
const { detectLanguageFromPath } = (await import("../../../../src/ast/language-detection")) as any

// ── corpus discovery: the gate's rule ────────────────────────────────────────
const files: { repo: string; dir: string; rel: string; abs: string }[] = []
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
    const abs = path.join(dir, rel)
    try {
      if (statSync(abs).isDirectory()) continue
      if (statSync(abs).size > 512 * 1024) continue
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) !== "xml") continue
    files.push({ repo: e, dir, rel, abs })
  }
}
const admittedTotal = files.length
const admitted = MAX_FILES > 0 ? files.slice(0, MAX_FILES) : files
console.error(`references-target-ledger: ${admitted.length} admitted files (${admittedTotal} discovered), ${WORKERS} worker(s)`)
if (admittedTotal === 0) throw new Error("no files admitted — the corpus root is wrong")

// ── phase 1 — production edges ───────────────────────────────────────────────
type RefEdge = { from: string; to: string; resolvable: string; role: string; line: number | undefined }
const refsByFile = new Map<string, RefEdge[]>()
const symNamesByFile = new Map<string, Set<string>>()
let cursor = 0
let fallbackFiles = 0

const worker = async (): Promise<void> => {
  for (;;) {
    const i = cursor++
    if (i >= admitted.length) return
    const f = admitted[i]
    const label = `${f.repo}/${f.rel}`
    const r = await parseFile(f.abs, f.dir)
    if (r?.fallback === true) fallbackFiles++
    const edges: RefEdge[] = []
    const names = new Set<string>()
    for (const s of r.symbols ?? []) names.add(String(s.name))
    for (const rel of r.relationships ?? []) {
      // `source` / `target`, not `from` / `to` — the latter exist on the type and are
      // always undefined.
      if (rel.type !== "references") continue
      edges.push({
        from: rel.source as string,
        to: rel.target as string,
        resolvable: String((rel.metadata as any)?.resolvable ?? "<none>"),
        role: String((rel.metadata as any)?.role ?? "<none>"),
        line: (rel as any).line,
      })
    }
    if (edges.length > 0) refsByFile.set(label, edges)
    symNamesByFile.set(label, names)
  }
}
await Promise.all(Array.from({ length: WORKERS }, () => worker()))
const edgesTotal = [...refsByFile.values()].reduce((a, l) => a + l.length, 0)
console.error(`phase 1: ${edgesTotal} references edges across ${refsByFile.size} files, ${fallbackFiles} fallback files`)

// ── phase 2 — the tree, one pass per file ────────────────────────────────────
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-xml.wasm"))))

const directChild = (n: any, type: string): any => {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && c.type === type) return c
  }
  return null
}
const unquote = (text: string): string => {
  if (text.length >= 2) {
    const first = text[0]
    const last = text[text.length - 1]
    if ((first === "\"" || first === "'") && first === last) return text.slice(1, -1)
  }
  return text
}
const splitOnWhitespace = (value: string): string[] => {
  const out: string[] = []
  let start = -1
  for (let i = 0; i < value.length; i++) {
    const space = value[i] === " " || value[i] === "\t" || value[i] === "\n" || value[i] === "\r"
    if (!space && start < 0) start = i
    if (space && start >= 0) {
      out.push(value.slice(start, i))
      start = -1
    }
  }
  if (start >= 0) out.push(value.slice(start))
  return out
}
const localOf = (token: string): string => {
  const colon = token.indexOf(":")
  return colon >= 0 ? token.slice(colon + 1) : token
}

/**
 * Per file: the set of NAMES an attribute value spells, and for each such name the set of
 * ENCLOSING ELEMENT NAMES — read off the tree, not off the analyzer. The second set is what
 * lets the check ask "under the source" rather than only "somewhere in the file", which is
 * the difference between a target the source legitimately writes and a target the file
 * happens to mention elsewhere (a comment is not a node, but a second attribute is).
 */
type NameSite = { names: Map<string, Set<string>> }
const sitesByFile = new Map<string, NameSite>()
const unparsed: string[] = []
for (const f of admitted) {
  const label = `${f.repo}/${f.rel}`
  let tree: any
  try {
    tree = parser.parse(readFileSync(f.abs, "utf8"))
  } catch {
    unparsed.push(label)
    continue
  }
  const root = tree?.rootNode
  if (!root) {
    unparsed.push(label)
    continue
  }
  /** Ancestor element names, nearest last. `elementName` is the local part, because the
   *  analyzer's symbol for an ordinary element is its tag and for a declaration its
   *  declared name — and a declaration's DECLARED name is written in the attribute, so an
   *  ancestor whose tag is a bare constructor name can still be the symbol. Both are
   *  recorded and the edge matches on either. */
  const names = new Map<string, Set<string>>()
  const stack: any[] = [root]
  const ancestorStack: string[] = []
  while (stack.length) {
    const n = stack.pop()!
    const isElement = n.type === "element"
    let pushed = ""
    if (isElement) {
      const tag = n.children.find((c: any) => c && (c.type === "STag" || c.type === "EmptyElemTag"))
      if (tag) {
        const written = directChild(tag, "Name")?.text.trim() ?? ""
        const writtenLocal = written.includes(":") ? written.slice(written.lastIndexOf(":") + 1) : written
        pushed = writtenLocal
        ancestorStack.push(writtenLocal)
        for (let i = 0; i < tag.namedChildCount; i++) {
          const a = tag.namedChild(i)
          if (a?.type !== "Attribute") continue
          const raw = directChild(a, "AttValue")?.text
          if (!raw) continue
          for (const tok of splitOnWhitespace(unquote(raw).trim())) {
            if (!tok) continue
            const local = localOf(tok)
            if (!local) continue
            const set = names.get(local) ?? new Set<string>()
            for (const anc of ancestorStack) set.add(anc)
            // Also record the element's OWN declared name, so a `type="T"` written on
            // `<xs:element name="T">`… and a reference to `T` from a sibling are both
            // findable. Read from the tag's own `name=` attribute.
            names.set(local, set)
          }
        }
      }
    }
    for (let i = n.childCount - 1; i >= 0; i--) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
    if (isElement && pushed) ancestorStack.pop()
  }
  sitesByFile.set(label, { names })
}

// ── phase 3 — grade every edge ───────────────────────────────────────────────
type Cls = "covered" | "value-elsewhere" | "no-value" | "source-absent"
const byCls = new Map<Cls, { edges: number; files: number; examples: string[] }>()
const byResolvabilityThenCls = new Map<string, Map<Cls, number>>()
const roleOfNoValue = new Map<string, number>()
const bump = (c: Cls, file: string, ex: string): void => {
  const row = byCls.get(c) ?? { edges: 0, files: 0, examples: [] }
  row.edges++
  if (!row.examples.includes(file)) row.files++
  if (row.examples.length < 8) row.examples.push(ex)
  byCls.set(c, row)
}
const cls = (c: Cls) => byCls.get(c)?.edges ?? 0

for (const [label, edges] of refsByFile) {
  const sites = sitesByFile.get(label)
  const symNames = symNamesByFile.get(label) ?? new Set<string>()
  for (const e of edges) {
    let c: Cls
    let note = ""
    if (!sites) {
      c = "no-value"
      note = " (file unparsed by the probe)"
    } else if (!symNames.has(e.from)) {
      c = "source-absent"
    } else {
      const owners = sites.names.get(e.to)
      if (!owners) {
        c = "no-value"
      } else if (owners.has(e.from)) {
        c = "covered"
      } else {
        c = "value-elsewhere"
        note = ` written under ${[...owners].slice(0, 3).join("/")}, not under ${e.from}`
      }
    }
    const key = e.resolvable
    const per = byResolvabilityThenCls.get(key) ?? new Map<Cls, number>()
    per.set(c, (per.get(c) ?? 0) + 1)
    byResolvabilityThenCls.set(key, per)
    if (c === "no-value") roleOfNoValue.set(`${e.resolvable}\u0000${e.role}`, (roleOfNoValue.get(`${e.resolvable}\u0000${e.role}`) ?? 0) + 1)
    bump(c, label, `${label}: ${e.from} -references-> ${e.to} resolvable=${e.resolvable} role=${e.role}${e.line !== undefined ? ` line ${e.line}` : ""}${note}`)
  }
}

/** The graded population: `in-document` and `unresolved` are the classes where a missing
 *  value IS a defect. `builtin` names are declared in the XML Schema specification and
 *  `external` names live in another file by design, so neither is graded here and both are
 *  reported so the reader can see how much of the type they are. */
const graded = (r: string) => r === "in-document" || r === "unresolved"
let gradedTotal = 0
let gradedCovered = 0
const gradedByResolvability = new Map<string, { total: number; covered: number; elsewhere: number; noValue: number; sourceAbsent: number }>()
for (const [r, m] of byResolvabilityThenCls) {
  const total = [...m.values()].reduce((a, x) => a + x, 0)
  const covered = m.get("covered") ?? 0
  const elsewhere = m.get("value-elsewhere") ?? 0
  const noValue = m.get("no-value") ?? 0
  const sourceAbsent = m.get("source-absent") ?? 0
  gradedByResolvability.set(r, { total, covered, elsewhere, noValue, sourceAbsent })
  if (!graded(r)) continue
  gradedTotal += total
  gradedCovered += covered
}

const report = {
  generatedBy: "validation/m14/fixtures/xml/references-target-ledger.mts",
  question: "is the target of every `references` edge a value the file writes, under the source that claims it",
  corpus: {
    root: CR,
    admittedTotal,
    admitted: admitted.length,
    workers: WORKERS,
    method: "git-tracked files only, 512 KiB cap, detectLanguageFromPath(abs, text) — the gate's own rule",
    fallbackFiles,
    unparsedByOwnParser: unparsed.length,
    unparsedExamples: unparsed.slice(0, 5),
  },
  edges: { total: edgesTotal, files: refsByFile.size },
  byClass: Object.fromEntries([...byCls.entries()].map(([k, v]) => [k, { edges: v.edges, files: v.files, examples: v.examples }])),
  byResolvabilityThenClass: Object.fromEntries([...byResolvabilityThenCls.entries()].map(([r, m]) => [r, Object.fromEntries(m)])),
  graded: {
    note: "`in-document` and `unresolved` only. `builtin` names are declared in the XML Schema specification and `external` names live in a file this document imports, so neither is expected to have a local value.",
    classes: ["in-document", "unresolved"],
    total: gradedTotal,
    covered: gradedCovered,
    coveredRate: gradedTotal === 0 ? null : gradedCovered / gradedTotal,
    byResolvability: Object.fromEntries([...gradedByResolvability.entries()]),
  },
  noValueByRole: Object.fromEntries([...roleOfNoValue.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => [k.replace("\u0000", " / "), v])),
  limitations: [
    "It grades the TARGET only. Whether the source is a name the file declares is derivation-accounting.mts's question, and it is a separate ledger.",
    "`value-elsewhere` is not a defect: the file writes the name on a different element, which is ordinary in a schema whose content models name each other's types. It is counted so the reader can see it rather than folded into `covered`.",
    "It matches a target by LOCAL part, so `xs:string` and a document-local `string` are the same key. That is the analyzer's own target convention (a prefix is a property of the file, not of the component) and this probe does not audit it.",
    "It is one-directional. It does not enumerate reference-carrier attributes, because a QName-shaped superset includes `id=\"foo\"` and adjudicating those grows a second analyzer rather than a measurement.",
    "It is a second walker over the same tree-sitter-xml, so a grammar-level fault is invisible to both it and the analyzer.",
  ],
}
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)
console.error(`wrote ${OUT}`)
console.log(
  [
    `references edges        ${edgesTotal} across ${refsByFile.size} files`,
    ...[...byCls.entries()].map(([k, v]) => `  ${k.padEnd(18)} ${String(v.edges).padStart(7)} edges / ${v.files} files`),
    `graded (in-document + unresolved)  ${gradedCovered}/${gradedTotal} covered = ${report.graded.coveredRate?.toFixed(4)}`,
    ...[...gradedByResolvability.entries()].map(([r, v]) => `  ${r.padEnd(14)} total ${String(v.total).padStart(6)} covered ${String(v.covered).padStart(6)} elsewhere ${String(v.elsewhere).padStart(5)} noValue ${String(v.noValue).padStart(5)}`),
  ].join("\n"),
)
