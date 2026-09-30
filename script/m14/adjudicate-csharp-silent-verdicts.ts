/**
 * 2026-09-29: adjudicate csharp's 164 `internal_silent` verdicts with EVIDENCE instead of opinion.
 *
 * THE PROBLEM WITH THE VERDICTS AS THEY STAND. `script/m14/spec/csharp-completeness.json` lists
 * 164 node types the analyzer visits and publishes nothing for. That list is a hand-authored claim
 * that every one of them is internal structure — punctuation, literals, preprocessor lines — and
 * nothing in the repository checks it. The gate that exists for it (`completeness-inventory`)
 * verifies only that every type IS classified, never that the classification is right, so a wrong
 * entry is indistinguishable from a right one and equally invisible. Reading 164 names and forming
 * an opinion about each is how the list got here.
 *
 * THE MEASUREMENT. Every one of the 164 has a property that settles most of them without a human:
 * does the node ever occur in the corpus, and does its subtree contain anything PUBLISHABLE — an
 * `identifier`, or a node type the analyzer already turns into a symbol or a relationship? Three
 * buckets fall out, and only the third needs a human:
 *
 *   ABSENT        the type never occurs in the sample. The verdict is untested, not verified —
 *                 worth knowing, and a different statement from "correct".
 *   TRIVIAL       it occurs, and its subtree contains nothing publishable. It really is
 *                 punctuation or a literal, and the verdict is confirmed by measurement.
 *   SUSPECT       it occurs AND contains a publishable node. Either the analyzer is dropping
 *                 something, or the containment is incidental (an `argument_list` legitimately
 *                 holds identifiers that are published by the `argument` inside it). The report
 *                 prints the frequency and a real source line per suspect, so the adjudication
 *                 is a decision about evidence rather than about a name.
 *
 * It cannot decide the third bucket on its own, and it does not try: a `switch_body` contains
 * sections and statements that are all published elsewhere, so "contains an identifier" is not a
 * defect. What it can do is stop the 161 easy verdicts from resting on assertion, shrink the
 * human queue to the handful that are genuinely arguable, and say which of the 164 were never
 * tested at all — which is the more useful failure.
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

/** Node types the analyzer turns into a symbol or a relationship. If one of these appears inside
 *  a silent type's subtree, the containment is worth a look. Kept as a list rather than derived
 *  from the analyzer, because the analyzer's own table would make this check circular. */
const PUBLISHABLE = new Set([
  "identifier", "generic_name", "qualified_name", "alias_qualified_name", "predefined_type",
  "variable_declarator", "parameter", "class_declaration", "struct_declaration", "interface_declaration",
  "record_declaration", "enum_declaration", "enum_member_declaration", "delegate_declaration",
  "method_declaration", "constructor_declaration", "destructor_declaration", "property_declaration",
  "indexer_declaration", "event_declaration", "event_field_declaration", "field_declaration",
  "operator_declaration", "conversion_operator_declaration", "local_function_statement",
  "namespace_declaration", "file_scoped_namespace_declaration", "using_directive",
  "member_access_expression", "invocation_expression", "object_creation_expression",
  "element_access_expression", "assignment_expression", "base_list", "type_parameter_list",
  "attribute", "attribute_argument", "catch_declaration", "declaration_pattern",
  "lambda_expression", "anonymous_method_expression", "query_expression", "from_clause",
  "join_clause", "let_clause", "when_clause", "with_initializer", "subpattern",
  "interpolation", "argument", "type_parameter_constraints_clause", "primary_constructor_base_type",
])

async function main() {
  const listFile = arg("--list")
  if (!listFile) { console.error("usage: csharp-silent-verdicts.ts --list <paths> [--limit N] [--show K]"); process.exit(2) }
  const limit = Number(arg("--limit") ?? 400)
  const show = Number(arg("--show") ?? 25)

  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, "script/m14/spec/csharp-completeness.json"), "utf8"))
  const silent: string[] = spec.internal_silent?.types ?? []
  if (silent.length === 0) { console.error("  the spec lists no internal_silent types"); process.exit(3) }

  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
  const parser = new P()
  parser.setLanguage(grammar)

  const files = fs.readFileSync(listFile, "utf8").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, limit)
  const counts = new Map<string, number>()
  const withPublishable = new Map<string, number>()
  const example = new Map<string, { file: string; line: number; text: string; inner: string }>()

  for (const f of files) {
    let src: string
    try { src = fs.readFileSync(f, "utf8") } catch { continue }
    if (src.length > 1_000_000) continue
    let root: any
    try { root = parser.parse(src).rootNode } catch { continue }
    if (!root) continue
    const lines = src.split("\n")
    const walk = (n: any): void => {
      if (silent.includes(n.type)) {
        counts.set(n.type, (counts.get(n.type) ?? 0) + 1)
        // what publishable node does this subtree contain, and not simply the node itself?
        let inner: string | null = null
        const scan = (m: any): void => {
          if (inner) return
          if (m !== n && PUBLISHABLE.has(m.type) && m.type !== n.type) { inner = m.type; return }
          for (let i = 0; i < m.namedChildCount; i++) { const c = m.namedChild(i); if (c) scan(c) }
        }
        scan(n)
        if (inner) {
          withPublishable.set(n.type, (withPublishable.get(n.type) ?? 0) + 1)
          if (!example.has(n.type)) {
            const ln = n.startPosition.row + 1
            example.set(n.type, {
              file: path.basename(f), line: ln,
              text: (lines[n.startPosition.row] ?? "").trim().slice(0, 96),
              inner: inner!,
            })
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
    }
    walk(root)
  }

  const absent: string[] = []
  const trivial: Array<[string, number]> = []
  const suspect: Array<[string, number, number]> = []
  for (const t of silent) {
    const c = counts.get(t) ?? 0
    if (c === 0) { absent.push(t); continue }
    const w = withPublishable.get(t) ?? 0
    if (w === 0) trivial.push([t, c])
    else suspect.push([t, c, w])
  }
  trivial.sort((a, b) => b[1] - a[1])
  suspect.sort((a, b) => b[2] - a[2])

  console.log(`csharp internal_silent adjudication — ${silent.length} verdicts, ${files.length} files\n`)
  console.log(`  ABSENT   (never occurs in this sample — the verdict is UNTESTED, not verified)  ${absent.length}`)
  console.log(`  TRIVIAL  (occurs, contains nothing publishable — confirmed by measurement)        ${trivial.length}`)
  console.log(`  SUSPECT  (occurs AND contains a publishable node — needs a human)                ${suspect.length}`)
  console.log(`  ${"-".repeat(100)}`)

  if (absent.length > 0) {
    console.log(`\nABSENT (${absent.length}):`)
    for (let i = 0; i < absent.length; i += 8) console.log("  " + absent.slice(i, i + 8).join(", "))
  }
  if (trivial.length > 0) {
    console.log(`\nTRIVIAL (${trivial.length}), by frequency:`)
    for (const [t, c] of trivial) console.log(`  ${String(c).padStart(7)}  ${t}`)
  }
  if (suspect.length > 0) {
    console.log(`\nSUSPECT (${suspect.length}) — occurrences / of those containing a publishable node:`)
    for (const [t, c, w] of suspect.slice(0, show)) {
      const e = example.get(t)!
      console.log(`  ${String(c).padStart(7)} / ${String(w).padStart(6)}  ${t}`)
      console.log(`            contains: ${e.inner}`)
      console.log(`            ${e.file}:${e.line}  ${e.text}`)
    }
    if (suspect.length > show) console.log(`  ... and ${suspect.length - show} more`)
  }
  console.log(`\nThis does NOT decide the SUSPECT bucket. A \`switch_body\` contains sections and`)
  console.log(`statements that are all published by the nodes inside them, so containment alone is not a`)
  console.log(`defect — the point is to shrink 164 asserted verdicts to ${suspect.length} argued ones, and`)
  console.log(`to say which ${absent.length} were never exercised at all.`)
}

if (import.meta.main) await main()
