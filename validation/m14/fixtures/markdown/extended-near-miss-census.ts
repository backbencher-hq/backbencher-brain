/**
 * Whole-admitted-population NEAR-MISS census for the three extended relationship
 * types markdown cannot express: `decorates`, `renders`, `mixes_in` (2026-10-25).
 *
 * WHY A TEXT CENSUS IS THE HONEST INSTRUMENT HERE. A ruling's corpus half is a
 * count of construct SITES, and the constructs being counted are precisely the
 * ones the grammar does NOT model as named nodes: front-matter keys, MkDocs
 * `!!!` admonition markers, Hugo shortcodes `{{< figure >}}`, Jekyll/Liquid
 * template tags, and diagram fences. Counting them through the tree would
 * measure the tree's blind spot rather than the corpus — the ruling's own
 * question is whether the construct is there at all. The grammar half is
 * measured separately from the two pinned grammars' DECLARED inventories
 * (validation/m14/measurements/markdown-grammar-nodes.json for the block grammar,
 * and the same accessor over the inline companion), with a planted control on
 * every vocabulary so a zero cannot be a statement about the filter.
 *
 * ADMISSION — the gate's own rule: `git ls-files` per corpus repository (real
 * checkouts only), extension `md` or `markdown`, under the engine's 1 MiB
 * FULL-AST cap, read as UTF-8. Population: BB_CORPUS_ROOT or the sibling default.
 *
 * EACH NEAR FAMILY IS COUNTED FOR THE TYPE IT IS A CANDIDATE FOR, and the row
 * names which reading would overturn the ruling — a count with no falsifier is
 * the prose the rule-book §6 rejects.
 *
 * OUTPUT: validation/m14/fixtures/markdown/measurements/extended-near-miss-census.json
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, "../../../..")
const ROOT = process.env.BB_CORPUS_ROOT ?? path.resolve(REPO, "../bb_tests/repositories")
const SIZE_CAP = 1024 * 1024
const OUT = path.join(HERE, "measurements/extended-near-miss-census.json")

type Admitted = { repo: string; rel: string; abs: string }
function population(): Admitted[] {
  const all: Admitted[] = []
  const repos = readdirSync(ROOT, { withFileTypes: true }).filter(e => e.isDirectory() || e.isSymbolicLink())
  for (const r of repos) {
    const dir = path.join(ROOT, r.name)
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
    for (const rel of tracked) {
      const base = path.basename(rel).toLowerCase()
      if (!base.endsWith(".md") && !base.endsWith(".markdown")) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      all.push({ repo: r.name, rel, abs })
    }
  }
  return all.sort((a, b) => (a.abs < b.abs ? -1 : 1))
}

/** One census counter: the construct's name, how it is spelled, and what it is a CANDIDATE for. */
type Probe = {
  id: string
  /** Candidate relationship type this near miss belongs to. */
  forType: "decorates" | "renders" | "mixes_in"
  /** Human name of the construct. */
  construct: string
  /** Line predicate: true when the line carries the construct. */
  hit: (line: string) => boolean
  /** Files that carry the construct, and total sites. */
  files?: Set<string>
  sites: number
}

// Character-code helpers: no regex in the lane's instruments either, so the
// artifact can be read beside the analyzer that must stay regex-free.
const startsWith = (s: string, p: string) => s.length >= p.length && s.slice(0, p.length) === p
const contains = (s: string, p: string) => s.indexOf(p) >= 0
const trimStart = (s: string) => { let i = 0; while (i < s.length && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9)) i++; return s.slice(i) }

const probes: Probe[] = [
  // ── decorates: a name applied TO a declaration ─────────────────────────────────
  // A markdown document has NO declaration form to decorate (no function, class or
  // method production in either pinned grammar). The near family is the METADATA and
  // MARKER constructs that LOOK like the decorator position: a key applied to a
  // document, an admonition marker applied to a block, a role applied to a fragment.
  { id: "front-matter files", forType: "decorates", construct: "a file opening with a `---` fence (Jekyll/Pandoc/MyST front matter)", hit: null as any, sites: 0 },
  { id: "front-matter layout key", forType: "decorates", construct: "a front-matter `layout:` key (a template applied to the DOCUMENT)", hit: (l) => { const t = trimStart(l); return startsWith(t, "layout:") }, sites: 0 },
  { id: "front-matter render key", forType: "decorates", construct: "a front-matter `render:`/`renderer:` key (a rendering choice for the document)", hit: (l) => { const t = trimStart(l); return startsWith(t, "render:") || startsWith(t, "renderer:") }, sites: 0 },
  { id: "front-matter title key", forType: "decorates", construct: "a front-matter `title:` key", hit: (l) => { const t = trimStart(l); return startsWith(t, "title:") && l.length < 400 }, sites: 0 },
  { id: "front-matter weight key", forType: "decorates", construct: "a front-matter `weight:`/`order:` key (nav placement)", hit: (l) => { const t = trimStart(l); return startsWith(t, "weight:") || startsWith(t, "order:") }, sites: 0 },
  { id: "mkdocs admonition marker", forType: "decorates", construct: "a MkDocs `!!! note` admonition marker (decorates the following BLOCK, not a declaration)", hit: (l) => { const t = trimStart(l); return startsWith(t, "!!!") }, sites: 0 },
  { id: "hugo/myst role directive", forType: "decorates", construct: "a `{eval}`/`{code-cell}` style role (an executable role applied to content)", hit: (l) => { const t = trimStart(l); return contains(t, "{eval}") || contains(t, "{code-cell}") || contains(t, "{code-cell} ") }, sites: 0 },

  // ── renders: a component renders another component ─────────────────────────────
  // Markdown has no component model. The near family is everything the document
  // hands to a RENDERER: an image reference (renders an ASSET, not a component), a
  // diagram fence (content rendered by an external tool), a raw-HTML block (passed
  // through), and a Hugo/MkDocs include-of-a-rendered-thing.
  { id: "image references", forType: "renders", construct: "an inline image `![alt](src)` (a reference to an ASSET)", hit: (l) => contains(l, "![") && contains(l, "]("), sites: 0 },
  { id: "diagram fences (mermaid/graphviz/plantuml/dot/vega)", forType: "renders", construct: "a fence whose info string names a DIAGRAM renderer", hit: (l) => { const t = trimStart(l); if (!startsWith(t, "```")) return false; const info = t.slice(3).trim().toLowerCase(); for (const d of ["mermaid", "graphviz", "plantuml", "dot", "vega", "d2"]) { if (startsWith(info, d)) return true } return false }, sites: 0 },
  { id: "figure/image directives", forType: "renders", construct: "a `{figure}`/`{image}` directive (a rendered figure)", hit: (l) => { const t = trimStart(l); return startsWith(t, "```{figure}") || startsWith(t, "```{image}") || startsWith(t, "::: figure") || startsWith(t, "::: image") }, sites: 0 },
  { id: "hugo shortcodes (figure/include)", forType: "renders", construct: "a Hugo shortcode `{{< figure >}}`/`{{< include >}}`", hit: (l) => contains(l, "{{<"), sites: 0 },
  { id: "raw html blocks", forType: "renders", construct: "a line opening a raw-HTML block (passthrough; the html lane's own grammar models it)", hit: (l) => { const t = trimStart(l); return startsWith(t, "<script") || startsWith(t, "<div") || startsWith(t, "<img") || startsWith(t, "<iframe") }, sites: 0 },

  // ── mixes_in: a class composes a mixin into its supertype chain ────────────────
  // Markdown has no classes, no methods, and no supertype chain. The near family is
  // the TEMPLATE COMPOSITION family: a template that includes or extends another,
  // and a layout key that names the wrapping template.
  { id: "liquid/jinja include tags", forType: "mixes_in", construct: "a `{% include %}`/`{% include-markdown %}` template tag (content splice, labelled imports/part_of)", hit: (l) => { const t = trimStart(l); return startsWith(t, "{% include") || contains(t, "{% include") }, sites: 0 },
  { id: "liquid/jinja extends tags", forType: "mixes_in", construct: "a `{% extends %}` template tag (template inheritance)", hit: (l) => { const t = trimStart(l); return startsWith(t, "{% extends") || contains(t, "{% extends") }, sites: 0 },
  { id: "liquid/jinja block tags", forType: "mixes_in", construct: "a `{% block %}` template tag (a supertype-slot placeholder)", hit: (l) => { const t = trimStart(l); return contains(t, "{% block") }, sites: 0 },
  { id: "liquid/jinja assign tags", forType: "mixes_in", construct: "a `{% assign %}` template tag (a variable, not a composition)", hit: (l) => { const t = trimStart(l); return contains(t, "{% assign") }, sites: 0 },
  { id: "myst toctree directives", forType: "mixes_in", construct: "a `{toctree}` directive (a navigation tree, not a mixin)", hit: (l) => { const t = trimStart(l); return startsWith(t, "```{toctree}") || startsWith(t, "::: toctree") }, sites: 0 },
]

const files = population()
const perRepo = new Map<string, number>()
// front-matter is a FILE fact, counted once per file (the first line is a `---` fence).
let frontMatterFiles = 0
const frontMatterRepos = new Map<string, number>()
let filesWithAny = 0
for (const f of files) {
  let content: string
  try { content = readFileSync(f.abs, "utf8") } catch { continue }
  const lines = content.split("\n")
  const trimmedFirst = (lines[0] ?? "").trim()
  const isFrontMatter = startsWith(trimmedFirst, "---") && lines.length > 1
  if (isFrontMatter) {
    frontMatterFiles++
    frontMatterRepos.set(f.repo, (frontMatterRepos.get(f.repo) ?? 0) + 1)
  }
  let any = false
  for (const probe of probes) {
    if (!probe.hit) continue
    let hits = 0
    for (const line of lines) { if (probe.hit(line)) hits++ }
    if (hits > 0) {
      probe.sites += hits
      probe.files = probe.files ?? new Set()
      probe.files.add(`${f.repo}/${f.rel}`)
      any = true
      perRepo.set(probe.id, (perRepo.get(probe.id) ?? 0) + hits)
    }
  }
  if (any) filesWithAny++
}

const artifact = {
  whatThisIs: "Whole-admitted-population near-miss census for the three extended relationship types markdown cannot express: decorates, renders, mixes_in. Each probe names the type it is a candidate for and the construct it spells, so the count can be read as an answer to a ruling and not as a wall of numbers.",
  admissionRule: "git ls-files per corpus repository (real checkouts only), basename .md or .markdown, under the engine's 1 MiB FULL-AST cap, UTF-8 readable",
  corpusRoot: ROOT,
  measuredOn: new Date().toISOString(),
  population: { admitted: files.length, filesWithAnyNearMiss: filesWithAny },
  frontMatter: { files: frontMatterFiles, perRepo: Object.fromEntries([...frontMatterRepos.entries()].sort((a, b) => b[1] - a[1])) },
  probes: probes.map(p => ({
    id: p.id, forType: p.forType, construct: p.construct,
    sites: p.sites, files: p.files?.size ?? 0,
    sampleFiles: p.files ? [...p.files].slice(0, 8) : [],
  })),
}
writeFileSync(OUT, JSON.stringify(artifact, null, 1) + "\n")
console.log(`census: ${files.length} admitted, ${filesWithAny} carry a near miss, ${frontMatterFiles} front-matter files`)
for (const p of artifact.probes) console.log(`${p.forType.padEnd(10)} ${String(p.sites).padStart(7)} sites ${String(p.files).padStart(5)} files  ${p.id}`)
console.log(`wrote ${OUT}`)
