/**
 * COVERAGE CENSUS — the measurement `script/m14/spec/xml-completeness.json`'s `coverage`
 * block rests on. Two instruments in one pass over the SAME admitted population the lane's
 * other probes use (`git ls-files` tracked only, <= 512 KiB, `detectLanguageFromPath === "xml"`,
 * copied from `script/m14/ontology-coverage-gate.ts:201-213` and from
 * `validation/m14/fixtures/xml/use-construct-census.mts` so the populations are the same sample):
 *
 *   EMITTED      per relationship type: edges, files, roles, through the PRODUCTION entry
 *                point `parseFile` — the same entry the firing-check and the ontology census
 *                use. This is the whole-population number `_implemented_measured` needs,
 *                because the 120-file stride reads `calls`, `overrides`, `extends` SILENT
 *                while the corpus does exercise them.
 *
 *   KEY SPACES   the two spaces a markup language can write a relation in: an ELEMENT local
 *                name and an ATTRIBUTE name. Node-type-only probes are blind to the second
 *                one, and that blind spot already cost a lane a wrong ruling (HCL spells
 *                inheritance as the attribute key `inherits = [...]`, invisible to a
 *                node-type probe; XSLT 1.0 §7.1.4 spells `use-attribute-sets` as an
 *                ATTRIBUTE of `xsl:copy`/`xsl:element`/`xsl:sort`/...). Every family below is
 *                therefore counted in BOTH spaces, with a namespace tally and examples.
 *                CONTROL families (`name`, `type`, `base`, `template`) are probed the same
 *                way, because a probe that cannot see a name proves nothing when it sees none.
 *
 * ZERO REGEX: membership is `indexOf`, tokenisation is a whitespace-run splitter, and every
 * structural fact comes from node types and named children.
 *
 * Usage: npx tsx validation/m14/fixtures/xml/coverage-census.mts > validation/m14/fixtures/xml/coverage-census.json
 * (progress goes to stderr; stdout is the artifact and nothing else)
 */
import { readdirSync, statSync, readFileSync } from "fs"
import * as path from "path"
import * as childProcess from "child_process"
import * as wts from "web-tree-sitter"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LIMIT = Number(process.env.BB_LIMIT ?? "0") // 0 = every admitted file

// ------------------------------------------------------------------ text helpers
function lower(s: string): string {
  let out = ""
  for (let i = 0; i < s.length; i++) out += s[i].toLowerCase()
  return out
}
function isSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v"
}
function tokens(text: string): string[] {
  const out: string[] = []
  let cur = ""
  for (let i = 0; i < text.length; i++) {
    if (isSpace(text[i])) { if (cur.length) out.push(cur); cur = "" } else cur += text[i]
  }
  if (cur.length) out.push(cur)
  return out
}
const unquote = (t: string): string =>
  t.length >= 2 && (t[0] === "\"" || t[0] === "'") && t[0] === t[t.length - 1] ? t.slice(1, -1) : t
const directChild = (n: any, type: string): any => {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && c.type === type) return c
  }
  return null
}

// ------------------------------------------------------------------ admitted files
const admitted: { repo: string; rel: string; abs: string; text: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    statSync(path.join(dir, ".git"))
  } catch { continue }
  let tracked: string[]
  try {
    tracked = childProcess.execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "xml") continue
    admitted.push({ repo: e, rel, abs, text })
  }
}
const sample = LIMIT > 0 ? admitted.slice(0, LIMIT) : admitted
console.error(`admitted ${admitted.length}, walking ${sample.length}`)

// ------------------------------------------------------------------ the tree pass
const P: any = (wts as any).Parser ?? (wts as any).default
const L: any = (wts as any).Language ?? (wts as any).default?.Language
await P.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
// ONE language handle, ONE parser, sequential files: the lane measured that concurrent
// parseFile calls sharing a cached parser lose FILES to WASM memory pressure
// (validation/m14/fixtures/xml/shared-parser-probe.mts), and a count that moves is not
// evidence. This pass is deliberately single-threaded.
const XML_LANG = await L.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-xml.wasm")))
const parser = new P()
parser.setLanguage(XML_LANG)

/** A family is a substring test on a LOCAL name, lower-cased. */
const FAMILIES: { id: string; needles: string[]; why: string }[] = [
  { id: "use", needles: ["use"], why: "`uses` — XSLT 1.0 §7.1.4 use-attribute-sets (ATTRIBUTE), XSLT 2.0 §10.6 use-attribute-sets / §12.1 use-package (ELEMENT), SVG <use>" },
  { id: "export", needles: ["export"], why: "`exports`" },
  { id: "implement", needles: ["implement", "interface", "conform", "satisf"], why: "`implements` — a conformance clause, incl. the Wayland <interface> ELEMENT spelling" },
  { id: "instantiat", needles: ["instantiat", "new", "create", "construct", "clone"], why: "`instantiates` — a construction form" },
  { id: "inherit", needles: ["inherit"], why: "`extends`/`overrides` — the HCL spelling this probe exists to catch" },
  { id: "extends", needles: ["extend"], why: "`extends` — XSD <xs:extension> ELEMENT and any attribute spelling" },
  { id: "override", needles: ["override"], why: "`overrides`" },
  { id: "call", needles: ["call"], why: "`calls`" },
  { id: "import", needles: ["import"], why: "`imports`" },
  { id: "referenc", needles: ["referenc"], why: "`references`" },
  { id: "name", needles: ["name"], why: "CONTROL — must be non-empty or the probe is blind" },
  { id: "type", needles: ["type"], why: "CONTROL — XSD `type=`/`base=` are attribute spellings of a name" },
  { id: "base", needles: ["base"], why: "CONTROL — the XSD derivation operand" },
  { id: "template", needles: ["template"], why: "CONTROL — XSLT's declared reusable unit" },
]
type Fam = {
  id: string; why: string
  elementHits: number; elementFiles: Set<string>; elementNames: Map<string, number>; elementNs: Map<string, number>
  attributeHits: number; attributeFiles: Set<string>; attributeNames: Map<string, number>; attributeNs: Map<string, number>
  valueTokenHits: number
  examples: string[]
}
const fams = new Map<string, Fam>()
for (const f of FAMILIES) {
  fams.set(f.id, {
    id: f.id, why: f.why,
    elementHits: 0, elementFiles: new Set(), elementNames: new Map(), elementNs: new Map(),
    attributeHits: 0, attributeFiles: new Set(), attributeNames: new Map(), attributeNs: new Map(),
    valueTokenHits: 0, examples: [],
  })
}
const nodeTypes = new Map<string, number>()
const elementLocalNames = new Map<string, number>()
const attributeNames = new Map<string, number>()
let nodesSeen = 0, walkedFiles = 0, treeFailed = 0
const errorFiles = new Set<string>()

/** Does any family needle occur in `s` (lower-cased local name)? */
function read(s: string): { id: string; needles: string[] } | null {
  const t = lower(s)
  for (const f of FAMILIES) for (const n of f.needles) if (t.indexOf(n) >= 0) return f
  return null
}
const bump = (m: Map<string, number>, k: string): void => { m.set(k, (m.get(k) ?? 0) + 1) }

for (const f of sample) {
  let tree: any = null
  try {
    tree = parser.parse(f.text, f.abs)
  } catch { treeFailed++; continue }
  if (!tree) { treeFailed++; continue }
  walkedFiles++
  const rel = `${f.repo}/${f.rel}`
  // CONTROLS are threaded, not recomputed: a family hit is counted in BOTH spaces with the
  // same namespace resolution the analyzer uses (xmlns / xmlns:prefix on the same tag).
  const walk = (n: any, ns: Map<string, string>): void => {
    nodesSeen++
    bump(nodeTypes, n.type)
    if (n.type === "ERROR") errorFiles.add(rel)
    if (n.type !== "element") {
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, ns) }
      return
    }
    const tag = directChild(n, "STag") ?? directChild(n, "EmptyElemTag")
    if (!tag) return
    const inner = new Map(ns)
    const attrs: { raw: string; local: string; value: string }[] = []
    for (let i = 0; i < tag.namedChildCount; i++) {
      const a = tag.namedChild(i)
      if (a?.type !== "Attribute") continue
      const an = directChild(a, "Name")?.text.trim()
      if (an === undefined) continue
      const avRaw = directChild(a, "AttValue")?.text.trim()
      const av = avRaw === undefined ? "" : unquote(avRaw)
      if (an === "xmlns") inner.set("", av)
      else if (an.startsWith("xmlns:")) inner.set(an.slice(6), av)
      else {
        const c = an.indexOf(":")
        attrs.push({ raw: an, local: c >= 0 ? an.slice(c + 1) : an, value: av })
      }
    }
    const tagName = directChild(tag, "Name")?.text.trim() ?? ""
    const colon = tagName.indexOf(":")
    const prefix = colon >= 0 ? tagName.slice(0, colon) : ""
    const local = colon >= 0 ? tagName.slice(colon + 1) : tagName
    const uri = inner.get(prefix) ?? ""
    const line = n.startPosition.row + 1

    bump(elementLocalNames, local)
    const ef = read(local)
    if (ef) {
      const g = fams.get(ef.id)!
      g.elementHits++
      g.elementFiles.add(rel)
      bump(g.elementNames, local)
      bump(g.elementNs, uri || "(no-namespace)")
      if (g.examples.length < 4) g.examples.push(`${rel}:${line} ELEMENT <${local}> ns=${uri || "(none)"}`)
    }
    for (const a of attrs) {
      bump(attributeNames, a.raw)
      const af = read(a.local)
      if (!af) continue
      const g = fams.get(af.id)!
      g.attributeHits++
      g.attributeFiles.add(rel)
      bump(g.attributeNames, a.local)
      bump(g.attributeNs, uri || "(no-namespace)")
      for (const t of tokens(a.value)) if (t.length) g.valueTokenHits++
      if (g.examples.length < 8) g.examples.push(`${rel}:${line} ATTRIBUTE ${a.raw}="${a.value.slice(0, 60)}" on <${local}> ns=${uri || "(none)"}`)
    }

    const own = attrs.find((a) => a.local === "name")?.value ?? ""
    void own
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, inner) }
  }
  try { walk(tree.rootNode, new Map()) } catch { /* a walk failure is counted by its absence in walkedFiles */ }
  tree.delete()
  if (walkedFiles % 2000 === 0) console.error(`  tree walked ${walkedFiles}/${sample.length}`)
}

// ------------------------------------------------------------------ the production pass
const emitted = new Map<string, { edges: number; files: Set<string>; roles: Map<string, number> }>()
let filesParsed = 0, filesFailed = 0, degraded = 0, totalSymbols = 0, totalRelationships = 0
const failedExamples: string[] = []
for (const f of sample) {
  const rel = `${f.repo}/${f.rel}`
  let res: any
  try {
    res = await parseFile(f.abs, f.text)
  } catch (e) { filesFailed++; if (failedExamples.length < 5) failedExamples.push(`${rel}: ${String(e).slice(0, 60)}`); continue }
  const md = res?.metadata ?? {}
  if (md.fallback === true || md.analysisVersion === "2.0-basic-fallback") { degraded++; continue }
  filesParsed++
  totalSymbols += (res.symbols ?? []).length
  for (const r of res.relationships ?? []) {
    const t = String(r.relationshipType ?? r.type ?? "").toLowerCase()
    if (!t) continue
    const g = emitted.get(t) ?? { edges: 0, files: new Set<string>(), roles: new Map<string, number>() }
    g.edges++; g.files.add(rel); totalRelationships++
    const role = String(r.role ?? r.metadata?.role ?? "").toLowerCase()
    if (role) bump(g.roles, role)
    emitted.set(t, g)
  }
  if (filesParsed % 2000 === 0) console.error(`  production ${filesParsed}/${sample.length}`)
}

const sortedPairs = (m: Map<string, number>): [string, number][] =>
  [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))

const out = {
  instrument: "xml coverage-census — emitted-type counts through parseFile, plus element-name and attribute-name key spaces",
  question:
    "which of the ten ontology relationship types does the production path emit over the whole admitted xml population, and which of them can this language express at all — measured in BOTH spaces a markup document writes a relation in, an ELEMENT local name and an ATTRIBUTE name?",
  generatedBy: "validation/m14/fixtures/xml/coverage-census.mts",
  at: new Date().toISOString(),
  corpus: {
    root: CR,
    admission: "every git repository under the root, `git ls-files` tracked only, <= 512 KiB, read as utf8, detectLanguageFromPath(abs, text) === 'xml' — the same admission as script/m14/ontology-coverage-gate.ts:201-213, validation/m14/fixtures/xml/use-construct-census.mts and validation/m14/fixtures/xml/derivation-accounting.mts",
    discovered: admitted.length,
    walked: sample.length,
    sampling: LIMIT > 0 ? `first ${LIMIT} admitted files` : "every admitted file",
  },
  tree: {
    filesWalked: walkedFiles,
    filesFailed: treeFailed,
    filesCarryingAnErrorNode: errorFiles.size,
    nodesSeen,
    distinctNodeTypes: nodeTypes.size,
    nodeTypes: sortedPairs(nodeTypes),
    distinctElementLocalNames: elementLocalNames.size,
    distinctAttributeNames: attributeNames.size,
  },
  production: {
    entryPoint: "parseFile (src/ast/pool-worker.ts)",
    filesParsed, filesFailed, degraded,
    failedExamples,
    totalSymbols, totalRelationships,
  },
  emitted: [...emitted.entries()]
    .map(([type, g]) => ({ type, edges: g.edges, files: g.files.size, roles: Object.fromEntries(sortedPairs(g.roles)) }))
    .sort((a, b) => b.edges - a.edges || (a.type < b.type ? -1 : 1)),
  keySpaces: {
    note: "a family is a lower-cased substring test on a LOCAL name; attributeHits counts a NAME, so every occurrence of e.g. `use=\"required\"` is one hit; valueTokenHits counts whitespace-separated tokens in those attributes' values",
    elementLocalNamesDistinct: elementLocalNames.size,
    attributeNamesDistinct: attributeNames.size,
    topElementLocalNames: sortedPairs(elementLocalNames).slice(0, 40),
    topAttributeNames: sortedPairs(attributeNames).slice(0, 40),
    families: FAMILIES.map((f) => {
      const g = fams.get(f.id)!
      return {
        id: f.id, why: f.why, needles: f.needles,
        elementHits: g.elementHits, elementFiles: g.elementFiles.size, elementNames: Object.fromEntries(sortedPairs(g.elementNames)), elementNamespaces: Object.fromEntries(sortedPairs(g.elementNs)),
        attributeHits: g.attributeHits, attributeFiles: g.attributeFiles.size, attributeNames: Object.fromEntries(sortedPairs(g.attributeNames)), attributeNamespaces: Object.fromEntries(sortedPairs(g.attributeNs)),
        valueTokenHits: g.valueTokenHits,
        examples: g.examples,
      }
    }),
  },
  limitations: [
    "counts are a single sequential run; the lane measured that CONCURRENT parseFile calls lose whole FILES to WASM memory pressure (validation/m14/fixtures/xml/shared-parser-probe.mts), which is why this pass is single-threaded — a rerun must keep it single-threaded to be comparable",
    "a family hit is a NAME, not a resolved relation: `use=\"required\"` in XSD and `<use xlink:href=\"#id\">` in SVG both land in the `use` family and mean different things. Resolution is the separate job of validation/m14/fixtures/xml/use-construct-census.mts",
    "the attribute-name space is measured as SPELLED (raw name, including any prefix) and as LOCAL name; a vocabulary that encodes a relation in a prefixed name a reader would not guess is only found by the raw-name map, which is why both are reported",
  ],
}
console.log(JSON.stringify(out, null, 2))
