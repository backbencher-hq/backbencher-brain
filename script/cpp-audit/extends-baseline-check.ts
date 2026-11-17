/**
 * C++ LANE AUDIT — `extends` against the GRAMMAR's own base clauses.
 *
 * THE QUESTION. `extends` is the one relationship whose ground truth the grammar states outright: a
 * `base_class_clause` node lists the bases. So "does `extends` publish one row per base?" is a
 * question that can be answered without a hand-written oracle — parse the file twice, once with the
 * production entry (for the analyzer's rows) and once with the pinned grammar (for the bases), and
 * compare. This is the verification the `mixes_in` ruling's premise rests on: `mixes_in` is ruled
 * absent because multiple inheritance is "carried as one `extends` per base", and until this ran,
 * that sentence was a claim about the code rather than a measurement of it.
 *
 * WHAT IT REPORTS, per class/struct that has a base clause:
 *   - expected bases (structural `name` fields, never text splitting — see METHOD below)
 *   - the `extends` rows published for that class
 *   - MISSING bases, SURPLUS rows, and the DOCUMENTED D2 CASE
 *
 * THE D2 CASE IS COUNTED SEPARATELY ON PURPOSE. `extendsTargetName` (real-cpp-analyzer.ts:902)
 * refuses a base whose LEAF equals the derived class's own name, because the leaf clean that
 * produced it destroyed the evidence that told the two apart — `priority_tag<N-1> : priority_tag<N-2>`
 * and `char_traits : std::char_traits<T>` both collapse to `X : X`. The ruling is deliberate and the
 * resolver was aligned with it in the same commit. So a class whose bases ALL collapse to its own
 * leaf and which therefore has no `extends` row is NOT a defect; it is the ruled answer, and this
 * probe reports it as `d2SelfLeaf` rather than as a miss. What would be a defect is a class with a
 * base that does NOT collapse and still has no row — reported as `unexplainedMissing`.
 *
 * METHOD, AND WHY IT IS WRITTEN THIS WAY. Three earlier drafts of this audit produced 359, 215 and
 * then 514 fake mismatches, each from the PROBE rather than the analyzer:
 *   1. splitting the class head at the first ':' — lands inside `std::false_type`;
 *   2. taking the last `::` segment of a `template_type`'s TEXT — lands inside the template
 *      ARGUMENTS (`std::ratio_divide<std::ratio<1, Period::num>::type, ...>` -> `period>`);
 *   3. matching a class symbol by LINE — cpp symbols publish no line at all (`line` is undefined on
 *      every symbol this analyzer emits; only relationships carry `line_number`), so every class
 *      looked unpublished.
 * The ground truth is therefore read STRUCTURALLY (node `name` fields) and matched by NAME.
 *
 * KNOWN LIMITATION, stated rather than hidden: matching is by NAME within one file, so two class
 * template specializations with the same name in the same file share one row bucket. That is the
 * same C++ ambiguity the `overrides` audit records (a name cannot identify a declaration), and it is
 * why this probe reports per-name buckets rather than pretending to attribute rows per specialization.
 *
 * Reads only. Does not run the fixture suite and makes no claim about row metadata/confidence.
 *
 * Usage: bun run script/cpp-audit/extends-baseline-check.ts [--json]
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, extname } from "node:path"
import { ASTEngine } from "../../src/ast/engine"

const CORPUS = ["fmt", "nlohmann-json"]
const EXTS = new Set([".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hxx", ".hh", ".h", ".ipp", ".inl", ".cu"])
const BASE_NODE = new Set(["type_identifier", "qualified_identifier", "template_type", "primitive_type", "dependent_type"])

/** The DECLARED name of a type expression, read from the tree's `name` fields. */
function typeName(n: any): string {
  if (!n) return ""
  if (n.type === "type_identifier" || n.type === "primitive_type" || n.type === "namespace_identifier") return n.text
  const nm = n.childForFieldName?.("name")
  return nm ? typeName(nm) : ""
}

/** Last `::` segment — the lane's own leaf clean. */
const leaf = (s: string): string => {
  const i = s.lastIndexOf("::")
  return i >= 0 ? s.slice(i + 2) : s
}

function walk(dir: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const e of entries) {
    if (e === ".git" || e === "node_modules" || e === "build" || e === "third_party") continue
    const p = join(dir, e)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(p, out)
    else if (st.isFile() && EXTS.has(extname(e))) out.push(p)
  }
}

interface ClassResult {
  file: string
  line: number
  name: string
  expected: string[]
  published: string[]
  d2SelfLeaf: boolean
  /** base goes through a template argument list (`X<...>::type`): target naming is a judgement call */
  dependentAliasBase?: boolean
}

/** `std::conditional<...>::type` shape — the qualifier itself contains a template argument list. */
const isDependentAliasBase = (baseText: string): boolean => baseText.includes(">::") || /::type\b/.test(baseText)

async function main(): Promise<void> {
  const asJson = process.argv.includes("--json")
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(new Uint8Array(readFileSync(join(process.cwd(), "wasm", "tree-sitter-cpp.wasm"))))
  const parser = new ParserClass()
  parser.setLanguage(grammar)

  const files: string[] = []
  for (const repo of CORPUS) walk(join(process.cwd(), ".cpp-corpus", repo), files)

  let classes = 0
  let baseEntries = 0
  let multiBase = 0
  const mismatch: ClassResult[] = []
  /** The cases that would be DEFECTS: a base that does not collapse to the class leaf and still has
   *  no row. Kept in their own array, unbounded, so a capped `detail` can never bury them. */
  const unexplained: ClassResult[] = []
  let d2SelfLeafClasses = 0
  let dependentAliasClasses = 0
  let surplusRows = 0

  for (const f of files.sort()) {
    const buf = readFileSync(f)
    if (buf.length > 1_000_000) continue // the lane's own cap
    const src = buf.toString("utf8")
    const res: any = await ASTEngine.parseFile(f, src)
    if (res?.language !== "cpp") continue
    const tree = parser.parse(src)
    const rel = f.replace(process.cwd() + "/", "")
    const extRows = ((res.relationships ?? []) as any[]).filter((r) => r.type === "extends")

    const visit = (n: any): void => {
      if (n.type === "class_specifier" || n.type === "struct_specifier") {
        const nm = n.childForFieldName?.("name")
        const name = typeName(nm)
        let bcl: any = null
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c?.type === "base_class_clause") bcl = c
        }
        if (name && bcl) {
          const bases: string[] = []
          const baseTexts: string[] = []
          for (let i = 0; i < bcl.childCount; i++) {
            const c = bcl.child(i)
            if (c && BASE_NODE.has(c.type)) {
              const t = typeName(c)
              if (t) {
                bases.push(t)
                // the FULL node text, because the dependent-alias shape is only visible there:
                // the structural name of `std::conditional<...>::type` is the bare alias `type`.
                baseTexts.push(String(c.text ?? ""))
              }
            }
          }
          if (bases.length > 0) {
            classes++
            baseEntries += bases.length
            if (bases.length > 1) multiBase++
            const published = extRows.filter((r) => leaf(String(r.source)) === name).map((r) => leaf(String(r.target)))
            const want = bases.map(leaf)
            const missing = want.filter((w) => !published.includes(w))
            const surplus = published.filter((x) => !want.includes(x))
            if (surplus.length) surplusRows += surplus.length
            if (missing.length) {
              const allSelf = bases.every((b) => leaf(b) === name)
              const dependentAlias = baseTexts.some(isDependentAliasBase)
              const rec = { file: rel, line: n.startPosition.row + 1, name, expected: want, published, d2SelfLeaf: allSelf, dependentAliasBase: dependentAlias }
              if (allSelf) d2SelfLeafClasses++
              else if (dependentAlias) dependentAliasClasses++
              else unexplained.push(rec)
              mismatch.push(rec)
            } else if (surplus.length) {
              mismatch.push({ file: rel, line: n.startPosition.row + 1, name, expected: want, published, d2SelfLeaf: false })
            }
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) visit(n.child(i))
    }
    visit(tree.rootNode)
  }

  const out = {
    corpus: { roots: CORPUS, files: files.length },
    classesWithBaseClause: classes,
    baseEntries,
    multiBaseClasses: multiBase,
    extendsRowsDeficitClasses: mismatch.length,
    d2SelfLeafClasses,
    dependentAliasBaseClasses: dependentAliasClasses,
    unexplainedMissing: unexplained.length,
    surplusRows,
    /** DEFECTS ONLY, never truncated — a base the grammar names that no row carries */
    unexplained,
    /** a bounded sample of every non-matching class, including the D2 ruling and bucket collisions */
    detail: mismatch.slice(0, 40),
  }

  if (asJson) {
    console.log(JSON.stringify(out, null, 2))
    return
  }
  console.log(`=== extends vs the grammar's base_class_clause ===`)
  console.log(`classes with a base clause : ${classes}`)
  console.log(`base entries in the grammar: ${baseEntries} (multi-base classes: ${multiBase})`)
  console.log(`classes with NO row for a base: ${mismatch.length}`)
  console.log(`  of those, the DOCUMENTED D2 self-leaf case (every base leaf == class leaf): ${d2SelfLeafClasses}`)
  console.log(`  of those, a DEPENDENT-ALIAS base (grammar name is the alias \`type\`, analyzer publishes the template name): ${dependentAliasClasses}`)
  console.log(`  unexplained missing (a base that does NOT collapse, yet no row): ${unexplained.length}`)
  for (const u of unexplained) console.log(`  !! ${u.file}:${u.line} ${u.name} want=[${u.expected.join(",")}] got=[${u.published.join(",")}]`)
  console.log(`surplus rows (published target no base names): ${surplusRows}`)
  for (const d of mismatch.slice(0, 15)) {
    const tag = d.d2SelfLeaf ? "D2 " : d.dependentAliasBase ? "dep" : "!! "
    console.log(`  ${tag}${d.file}:${d.line} ${d.name} want=[${d.expected.join(",")}] got=[${d.published.join(",")}]`)
  }
}

main().catch((e) => {
  console.error("FAILED:", e)
  process.exit(1)
})
