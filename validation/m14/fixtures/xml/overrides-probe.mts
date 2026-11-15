/**
 * `overrides` PROBE — corrected, and the correction is the finding.
 *
 * ## The defect this file fixes
 *
 * `validation/m14/fixtures/xml/ontology-census.mts` probes `overrides` with a
 * `same-file-template-override` probe keyed on `match|mode|priority`. Measured over a
 * 2,500-file draw it returned **3 occurrences in 3 files**, which on its face
 * convicts this lane's RULED verdict for `overrides`: XSLT 1.0 §5.5 makes two
 * templates of the same match pattern, mode and priority in one stylesheet an error,
 * and a non-zero count is exactly what `script/m14/ontology-coverage-gate.ts` calls
 * FALSIFIED.
 *
 * It is not. The key is wrong, and it is wrong in the direction that manufactures
 * hits. A template written `<xsl:template name="dumptext">` — a NAMED template —
 * carries no `match`, no `mode` and no `priority`, so the key reduces to `||`, and so
 * does every other named template in the same file. Legal XSLT full of named
 * templates therefore reads as N templates "colliding" at one key.
 *
 * Measured on the three files the probe named:
 *
 *   libxslt/doc/EXSLT/devhelp/html.xsl   `<xsl:template name="dumptext">` (l.26) and
 *                                        its siblings carry no `match` at all
 *   libxslt/doc/devhelp/html.xsl         same file, same shape
 *   powershell/src/Schemas/PSMaml/Maml_HTML_Style.xsl
 *                                        `<xsl:template name='transformCALSCell'>` (l.121),
 *                                        `name='findInheritedAttribute'` (l.216),
 *                                        `name='transformInheritedAttribute'` (l.310)
 *
 * A named template does not compete for nodes at all: it is invoked by
 * `xsl:call-template name="…"`, so two of them can never be alternative matches for
 * the same node. The corrected key therefore counts only templates that can compete,
 * which means a template with a `match` (with or without a `name`) and NOT a
 * `name`-only template.
 *
 * ## What this file reports
 *
 * Both keys, over the same draw, with the colliding templates' full signatures for
 * every hit the CORRECTED key still produces. A corrected count that is non-zero
 * falsifies the ruling and this file says so; a corrected count of zero is the
 * measurement the ruling rests on, and the old count is printed beside it so the
 * difference is visible rather than described.
 *
 * ## Instrument
 *
 * Instrument B (parse-tree count), because XSLT CAN express an override and no
 * grammar inventory will find one: two templates that compete is a semantic
 * property of two declarations, not a node type.
 *
 * READ-ONLY. Writes nothing except the JSON passed with `--out`.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync, readdirSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SAMPLE = Number(process.env.BB_XML_SAMPLE ?? 2500)
const PER_REPO = Number(process.env.BB_XML_PER_REPO ?? 400)
const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : undefined
const XSLT_NS = "http://www.w3.org/1999/XSL/Transform"

// ── corpus discovery: the same method as ontology-census.mts, so both are asked
// about the same documents.
type FileRow = { repo: string; dir: string; rel: string; abs: string }
const byRepo = new Map<string, FileRow[]>()
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  const rows: FileRow[] = []
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let size: number
    try { size = statSync(abs).size } catch { continue }
    if (size > 512 * 1024) continue
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "xml") continue
    rows.push({ repo: e, dir, rel, abs })
  }
  if (rows.length > 0) byRepo.set(e, rows.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0)))
}
const sample: FileRow[] = []
{
  const queues = new Map([...byRepo].map(([k, v]) => [k, [...v]]))
  let progress = true
  while (progress && sample.length < SAMPLE) {
    progress = false
    for (const [repo, rows] of queues) {
      if (rows.length === 0 || sample.length >= SAMPLE) continue
      if (sample.filter((f) => f.repo === repo).length >= PER_REPO) continue
      sample.push(rows.shift()!)
      progress = true
    }
  }
}

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-xml.wasm"))))

const directChild = (n: any, type: string) => {
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

/** Every `xsl:template` in the file, with the three attributes §5.5 compares. */
type Template = { match: string; mode: string; priority: string; name: string; line: number }
const templatesOf = (root: any): Template[] => {
  const out: Template[] = []
  const walk = (n: any, ns: Map<string, string>) => {
    if (n.type === "element") {
      const tag = directChild(n, "STag") ?? directChild(n, "EmptyElemTag")
      if (tag) {
        const inner = new Map(ns)
        const attrs = new Map<string, string>()
        for (let i = 0; i < tag.namedChildCount; i++) {
          const a = tag.namedChild(i)
          if (a?.type !== "Attribute") continue
          const an = directChild(a, "Name")?.text.trim()
          const av = directChild(a, "AttValue")?.text.trim()
          if (an === "xmlns") inner.set("", av === undefined ? "" : unquote(av))
          else if (an?.startsWith("xmlns:")) inner.set(an.slice(6), av === undefined ? "" : unquote(av))
          else if (an) attrs.set(an, av === undefined ? "" : unquote(av))
        }
        const nameNode = directChild(tag, "Name")
        const tagName = nameNode?.text.trim() ?? ""
        const colon = tagName.indexOf(":")
        const prefix = colon >= 0 ? tagName.slice(0, colon) : ""
        const local = colon >= 0 ? tagName.slice(colon + 1) : tagName
        const thisNs = inner.get(prefix) ?? (prefix === "" ? inner.get("") : undefined)
        if (thisNs === XSLT_NS && local === "template") {
          out.push({
            match: attrs.get("match") ?? "",
            mode: attrs.get("mode") ?? "",
            priority: attrs.get("priority") ?? "",
            name: attrs.get("name") ?? "",
            line: n.startPosition.row + 1,
          })
        }
        // Descend into the ELEMENT's children, carrying the bindings this element
        // established. `element`'s children per node-types.json are ETag,
        // EmptyElemTag, STag and `content`, so `content` is where an element's own
        // child ELEMENTS live. A first version walked only the STag's children and
        // found 0 templates in 2,500 files, because a stylesheet's children are all
        // inside its `content` — and a probe that cannot SEE the construct is not a
        // probe that found none of it. Those two must never be reported the same way.
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c || c === tag) continue
          walk(c, inner)
        }
        return
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) walk(c, ns)
    }
  }
  walk(root, new Map())
  return out
}

let oldOccurrences = 0
let newOccurrences = 0
let namedOnlyTemplates = 0
let competingTemplates = 0
const oldHitFiles: string[] = []
const newHitFiles: string[] = []
const newHitExamples: string[] = []
const oldOnlyExamples: string[] = []
const fileBreakdown: Record<string, number> = {}

for (const f of sample) {
  let text: string
  try { text = readFileSync(f.abs, "utf8") } catch { continue }
  const t = parser.parse(text)
  if (!t) continue
  const templates = templatesOf(t.rootNode)
  t.delete?.()
  if (templates.length === 0) continue
  const label = `${f.repo}/${f.rel}`

  // ── the OLD key: match|mode|priority, name ignored ──
  const oldGroups = new Map<string, Template[]>()
  for (const tp of templates) {
    const k = `${tp.match}|${tp.mode}|${tp.priority}`
    const arr = oldGroups.get(k) ?? []
    arr.push(tp)
    oldGroups.set(k, arr)
  }
  let oldHere = 0
  for (const [k, arr] of oldGroups) {
    if (!k.startsWith("@") || arr.length < 2) continue
    oldHere += arr.length - 1
    if (oldOnlyExamples.length < 6) {
      oldOnlyExamples.push(`${label}: key="${k}" x${arr.length} — signatures ${arr.map((x) => (x.name ? `name=${x.name}` : `match=${x.match}`)).join(" , ")}`)
    }
  }
  if (oldHere > 0) { oldOccurrences += oldHere; if (oldHitFiles.length < 12) oldHitFiles.push(label) }

  // ── the CORRECTED key: only templates that can COMPETE for a node ──
  // A `name`-only template is invoked by `xsl:call-template`, never matched, so two
  // of them are not alternative matches and cannot override one another.
  let namedOnly = 0
  for (const tp of templates) if (tp.match.length === 0) namedOnly++
  namedOnlyTemplates += namedOnly
  competingTemplates += templates.length - namedOnly
  const groups = new Map<string, Template[]>()
  for (const tp of templates) {
    if (tp.match.length === 0) continue
    const k = `${tp.match}|${tp.mode}|${tp.priority}`
    const arr = groups.get(k) ?? []
    arr.push(tp)
    groups.set(k, arr)
  }
  let newHere = 0
  for (const [k, arr] of groups) {
    if (arr.length < 2) continue
    newHere += arr.length - 1
    if (newHitExamples.length < 8) {
      newHitExamples.push(`${label}: key="${k}" x${arr.length} at lines ${arr.map((x) => x.line).join(",")}`)
    }
  }
  if (newHere > 0) {
    newOccurrences += newHere
    if (newHitFiles.length < 12) newHitFiles.push(label)
    fileBreakdown[label] = newHere
  }
}

const out = {
  generatedBy: "validation/m14/fixtures/xml/overrides-probe.mts",
  corpusRoot: CR,
  sampling: { perRepoCap: PER_REPO, totalCap: SAMPLE, repositoriesAdmittingXml: byRepo.size, sampled: sample.length },
  construct: "two xsl:template in ONE stylesheet with the same match, mode and priority — XSLT 1.0 §5.5, where the later one replaces the earlier",
  instrument: "B:parse-tree-count",
  counts: {
    oldKeyOccurrences: oldOccurrences,
    correctedKeyOccurrences: newOccurrences,
    namedOnlyTemplates,
    competingTemplates,
  },
  oldHitFiles,
  newHitFiles,
  newHitExamples,
  oldOnlyExamples,
  perFile: fileBreakdown,
}
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 2))

console.log("overrides probe — xml (corrected key)")
console.log(`sampled ${sample.length} files across ${byRepo.size} repositories`)
console.log(`\nxsl:template total           ${namedOnlyTemplates + competingTemplates}`)
console.log(`  name-only (cannot compete) ${namedOnlyTemplates}`)
console.log(`  with a match (can compete) ${competingTemplates}`)
console.log(`\nOLD key  match|mode|priority          occurrences ${oldOccurrences} in ${oldHitFiles.length}+ files`)
console.log(`NEW key  same, name-only templates out occurrences ${newOccurrences} in ${newHitFiles.length}+ files`)
console.log(`\nOLD hits, with the templates behind them:`)
for (const e of oldOnlyExamples) console.log(`  ${e}`)
console.log(`\nNEW hits (these would FALSIFY the ruling):`)
for (const e of newHitExamples) console.log(`  ${e}`)
if (newOccurrences === 0) {
  console.log(`\nNEW key is 0: no two templates in any sampled file compete for the same node at the same`)
  console.log(`priority. The ruling is not falsified by this draw. Overturn condition: a non-zero count here.`)
}
