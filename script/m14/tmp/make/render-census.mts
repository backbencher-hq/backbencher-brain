// RENDER CENSUS — the measurement behind the renders ruling, over the whole
// gate-admitted make population. `renders` means "a declaration that turns
// data into a presentational artifact" (a template, a view, a markup emit).
// The grammar half is settled first, statically: the pinned grammar's 44
// named types + tokens + fields are probed with the renders vocabulary under
// WHOLE-WORD equality, substring hits reported as candidates only.
//
// The corpus half counts the render-ISH shapes a make file can actually
// carry, so the ruling cites counts rather than absence:
//   (a) `$(shell …)` invocations whose command text names a render tool
//       (pandoc, asciidoctor, jinja2, mustache, etc.) — a process spawn, not
//       a template declaration;
//   (b) target names that LOOK render-ish (docs, man, html) — a buildable
//       product, not a renderer;
//   (c) variables whose names carry render vocabulary — a name ABOUT
//       rendering, not a render declaration.
// NO REGEX on source text for the grammar half (a JSON read). The corpus half
// walks the AST: (a) reads shell_function/shell_command text and checks the
// command head against a tool table; (b) and (c) read word/text nodes.
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const OUT = resolve(ROOT, "validation/m14/fixtures/make/render-census.current.json")
const NODE_TYPES = resolve(ROOT, "grammars/tree-sitter-make/src/node-types.json")
const SIZE_CAP = 1024 * 1024

const { detectLanguageFromPath } = await import(`${ROOT}/src/ast/language-detection.ts`)
const { getParser } = await import(`${ROOT}/src/ast/engine.ts`)

// ── grammar half: whole-word probe of the pinned inventory ─────────────────
const declared = JSON.parse(readFileSync(NODE_TYPES, "utf8")) as any[]
const namedTypes: string[] = declared.filter((x) => x?.named === true).map((x) => String(x.type))
const anonymousTokens: string[] = declared.filter((x) => x?.named !== true).map((x) => String(x.type))
const fieldNames: string[] = [...new Set(declared.flatMap((x) => Object.keys(x?.fields ?? {})))]
const VOCAB = ["renders", "render", "renderer", "template", "templating", "view", "emit", "emits", "markup", "html", "jinja", "mustache", "placeholder", "presentation"]
const probe = (names: string[], space: string) => {
  const whole: string[] = [], sub: string[] = []
  for (const n of names) {
    const low = n.toLowerCase()
    if (VOCAB.includes(low)) whole.push(`${space}:${n}`)
    else if (VOCAB.some((w) => low.includes(w))) sub.push(`${space}:${n}`)
  }
  return { whole, sub }
}
const grammarProbe = {
  namedTypes: probe(namedTypes, "node"),
  anonymousTokens: probe(anonymousTokens, "anon"),
  fieldNames: probe(fieldNames, "field"),
}

// ── population: the gate's own enumeration and admission ───────────────────
const EXT = ["mk", "mak", "makefile", "gnumakefile"]
const gateAdmits = (rel: string): boolean => {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (EXT.some((e) => low.endsWith(`.${e}`))) return true
  return EXT.some((e) => base === e) && detectLanguageFromPath(rel) === "make"
}
const found: string[] = []
let absent = 0, overCap = 0
for (const name of readdirSync(CR).sort()) {
  const dir = join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!gateAdmits(rel)) continue
    const abs = join(dir, rel)
    try {
      const size = statSync(abs).size
      if (size > SIZE_CAP) { overCap++; continue }
    } catch { absent++; continue }
    found.push(abs)
  }
}
found.sort()
const relOf = (p: string) => (p.startsWith(CR) ? p.slice(CR.length + 1) : p)

// Render-tool table: command heads that ARE renderers when spawned.
const RENDER_TOOLS = new Set(["pandoc", "asciidoctor", "jinja2", "mustache", "mustach", "handlebars", "nkf", "ronn", "ronn-ng", "md-to-html", "plantuml", "graphviz", "dot", "latex", "pdflatex", "xelatex", "lualatex", "groff", "troff", "nroff", "man", "help2man", "mkdocs", "hugo", "jekyll", "sphinx-build", "doxygen"])
// Render-ish target/variable name fragments — a name ABOUT a product, counted
// as candidates and adjudicated, never as verdicts.
const RENDERISH_NAME_FRAGMENTS = ["docs", "doc", "man", "html", "pdf", "readme", "changelog", "banner", "help"]

let shellRenderTool = 0, renderishTargets = 0, renderishVars = 0, walkFailed = 0
const shellRenderSites: Array<{ file: string; line: number; head: string }> = []
const renderishTargetSites: Array<{ file: string; line: number; name: string }> = []
const renderishVarSites: Array<{ file: string; line: string; name: string }> = []
const walkFailedFiles: string[] = []

for (const f of found) {
  const content = readFileSync(f, "utf8")
  try {
    const parser: any = await getParser("make")
    const tree: any = await parser.parse(content, f)
    if (!tree?.rootNode) throw new Error("null root")
    const stack: any[] = [tree.rootNode]
    while (stack.length > 0) {
      const node: any = stack.pop()
      if (!node) continue
      // (a) shell_command text inside a shell_function — command head checked
      // against the tool table (first token, by whitespace split — a node
      // text read, not a regex over source).
      if (node.type === "shell_command") {
        const txt = String(node.text).trim()
        if (txt) {
          const head = txt.split(/\s+/)[0]
          if (RENDER_TOOLS.has(head)) {
            shellRenderTool++
            shellRenderSites.push({ file: relOf(f), line: node.startPosition.row + 1, head })
          }
        }
      }
      // (b) render-ish target names
      if (node.type === "rule") {
        const targetsNode = (node.namedChildren ?? []).find((c: any) => c.type === "targets")
        if (targetsNode) {
          for (const c of targetsNode.namedChildren ?? []) {
            if (c.type !== "word") continue
            const n = String(c.text).trim().toLowerCase()
            if (n && RENDERISH_NAME_FRAGMENTS.some((fr) => n === fr || n.startsWith(fr + "-") || n.startsWith(fr + "_") || n.endsWith("-" + fr))) {
              renderishTargets++
              renderishTargetSites.push({ file: relOf(f), line: node.startPosition.row + 1, name: String(c.text).trim() })
            }
          }
        }
      }
      // (c) render-ish variable names
      if (node.type === "variable_assignment") {
        const w = (node.namedChildren ?? []).find((c: any) => c.type === "word")
        if (w) {
          const raw = String(w.text).trim().toLowerCase()
          if (raw && RENDERISH_NAME_FRAGMENTS.some((fr) => raw.includes(fr))) {
            renderishVars++
            renderishVarSites.push({ file: relOf(f), line: node.startPosition.row + 1, name: String(w.text).trim() })
          }
        }
      }
      for (const c of node.namedChildren ?? []) stack.push(c)
    }
  } catch (e) { walkFailed++; walkFailedFiles.push(`${relOf(f)}: ${String(e).slice(0, 60)}`) }
}

if (walkFailed > 0) {
  console.error(`SITE-WALK REFUSAL — ${walkFailed} file(s): ${walkFailedFiles.slice(0, 3).join(" | ")}`)
  process.exit(3)
}

const artefact = {
  instrument: "script/m14/tmp/make/render-census.mts",
  whatThisIs: "Render census for the renders ruling: a static whole-word probe of the pinned grammar's inventory with the renders vocabulary, plus a corpus count of the render-ISH shapes a make file carries (shell-spawned render tools, render-ish target names, render-ish variable names), over the whole gate-admitted make population.",
  population: { corpusRoot: CR, membership: "gate's own admission (exts=[mk,mak,makefile,gnumakefile] + basename + router verdict), git ls-files, 1 MiB cap", admitted: found.length, absent, overCap, walkFailed, repos: new Set(found.map((f) => relOf(f).split("/")[0])).size },
  grammarProbe: {
    source: "grammars/tree-sitter-make/src/node-types.json",
    declaredNamedTypes: namedTypes.length,
    declaredAnonymousTokens: anonymousTokens.length,
    declaredFieldNames: fieldNames.length,
    vocabulary: VOCAB,
    predicate: "WHOLE-WORD equality; substring hits are candidates, never verdicts",
    ...grammarProbe,
  },
  renderIshShapes: {
    shellSpawnedRenderToolSites: shellRenderTool,
    renderishTargetNames: renderishTargets,
    renderishVariableNames: renderishVars,
  },
  perShellRenderSite: shellRenderSites,
  perRenderishTarget: renderishTargetSites.slice(0, 200),
  perRenderishVar: renderishVarSites.slice(0, 200),
  walkFailedFiles,
}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(artefact, null, 2) + "\n")
console.log(`render census — ${found.length} admitted · grammar whole-word matches: node ${grammarProbe.namedTypes.whole.length} · anon ${grammarProbe.anonymousTokens.whole.length} · field ${grammarProbe.fieldNames.whole.length}`)
console.log(`render-ish: shell render-tool sites ${shellRenderTool} · render-ish target names ${renderishTargets} · render-ish variable names ${renderishVars}`)
