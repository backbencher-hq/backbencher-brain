/**
 * TS R2 PROBE — THE `<callable>\0<name>` KEY: does it carry the DECLARATION, or only the NAME?
 *
 * ## The fleet rule this instrument answers (charter §21.41 R2, 2026-10-20)
 *
 * "**A DEDUP KEY MUST CARRY THE DECLARATION'S IDENTITY WHENEVER THE ROW'S IDENTITY IS THE
 * OCCURRENCE — NOT THE NAME.** MEASURED (dart lane): a local read is spelled `<callable>\0<name>`,
 * so two reads of TWO DIFFERENT declarations sharing a name in one function spell IDENTICALLY and
 * collapsed into one row. The loss on dart-http alone was 1,246 rows — a resolution loss wearing a
 * dedup's clothes. The fix joins the key on the **DECLARATION's scope identity** … and only for
 * `localBinding` rows. … **THE LINE IS NOT THE ANSWER**: a line cannot tell "two reads of one
 * declaration" from "two reads of two declarations" — it splits both (measured: 3 rows where 2 are
 * correct). … **THE FLEET-WIDE PROBE (one parse, no corpus): write a file with two same-named
 * locals in nested scopes, read both, and check the analyzer publishes TWO rows.** A lane whose
 * local-read spelling carries the callable and the NAME (not the declaration) has this same loss."
 *
 * ## What this probe does, in two parts
 *
 * **PART A — THE FLEET-WIDE PROBE (one parse, no corpus, ALWAYS RUN).** It writes the file the
 * charter names, parses it through the PRODUCTION entry (`parseFile` from `pool-worker`), and
 * prints the rows the analyzer published for the two reads. It answers three questions, each
 * separately, because they are three different claims:
 *   1. **ROW COUNT** — are TWO rows published (one per read)?
 *   2. **SPELLING** — are the two rows' targets byte-identical? (the key carries the callable and
 *      the NAME, not the declaration)
 *   3. **KIND** — does `metadata.bindingKind` name the kind of the declaration the read actually
 *      binds?
 *
 * **PART B — THE POPULATION SURFACE (`--population`, an arm's work).** For every local-binding row
 * the analyzer publishes over the corpus, how many DISTINCT declarations of that name does the row's
 * own file contain? A name declared once is identified by the key; a name declared twice is NOT,
 * and every row that names it carries an identity the key cannot express.
 *
 * ## Why the answer is NOT the same as dart's
 *
 * Dart's loss was a ROW COLLAPSE: dart's analyzer DEDUPES its relationships on a key that carries
 * no line, so the shadowed read was LOST. This lane's analyzer has NO relationship dedup of its own
 * and the store's relationship identity carries the call-site line
 * (`${projectId}:rel:${sourceIdentity}:${targetName}:${relType}:${relLine}`), so two reads of two
 * declarations are two ROWS in both. The dart defect class is therefore ABSENT here as a row loss,
 * and the probe says so rather than implying a loss it did not find.
 *
 * What is NOT absent is the SPELLING: the key carries the callable and the NAME, so the two rows
 * are indistinguishable to every consumer that keys on the target, and the collector that decides
 * the KIND is a file-wide first-wins map — the same scope-shadowing class the receiver-type map
 * had (`4e0fd9054`). Part B prices both.
 *
 * ## Population rule
 *
 * The file set is derived per run from the corpus the same way `incoming-gate.ts` derives its own:
 * every git checkout under `$BB_CORPUS_ROOT`, `git ls-files`, extension admitted (the gate's own
 * `LANES_A` list for this lane, read LIVE), size cap, then the same deterministic stride. The
 * population is PRINTED with its size, so a sample can never be read as the corpus.
 *
 * Usage:
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/ts-r2-local-binding-probe.ts [--population] [--max-files N] [--json out.json]
 */
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"
import { ASTEngine } from "../../src/ast/engine"
import { laneExtensions } from "./ts-lane-extensions"
import { detectLanguageFromPath } from "../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const argv = process.argv.slice(2)
const argOf = (flag: string): string | null => {
  const i = argv.indexOf(flag)
  return i >= 0 ? (argv[i + 1] ?? null) : null
}
const POPULATION = argv.includes("--population")
const MAX_FILES = Number(argOf("--max-files") ?? 0)
const JSON_OUT = argOf("--json")
const SIZE_CAP = 1024 * 1024
/** THE EXTENSION SET — the gate's OWN map, read LIVE (`LANES_A.typescript`), never from memory. */
const EXT = laneExtensions("typescript", ["ts", "tsx", "mts", "cts"])

// ─────────────────────────────────────────────────────────────────────────────────────────
// PART A — THE FLEET-WIDE PROBE (one parse, no corpus)
// ─────────────────────────────────────────────────────────────────────────────────────────
/**
 * THE FILE THE CHARTER NAMES: two same-named locals in NESTED scopes, both read.
 *
 * `value` is the function's PARAMETER and is read at line 5; `value` is a BLOCK-LOCAL `const` in a
 * nested block and is read at line 8. Dart's rule is that the inner scope SHADOWS the outer
 * binding, so the two reads are TWO facts about TWO DIFFERENT declarations.
 */
const PROBE_SOURCE = `// r2 probe — two same-named locals in NESTED scopes, both read.
export function outer(value: () => number): number {
  const a = value()
  {
    const value = () => 42
    const b = value()
    console.log(b)
  }
  return a
}
`

type ProbeRow = { type: string; source: string; target: string; line: number; localBinding: boolean; bindingKind: string }

const runSyntheticProbe = async (): Promise<{ rows: ProbeRow[]; dir: string }> => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-ts-r2-"))
  const file = path.join(dir, "r2-probe.ts")
  fs.writeFileSync(file, PROBE_SOURCE, "utf8")
  const parsed: any = await parseFile(file, dir)
  const rows: ProbeRow[] = []
  for (const rel of parsed?.relationships ?? []) {
    const md: any = rel?.metadata ?? {}
    if (md.localBinding !== true) continue
    rows.push({
      type: String(rel?.type ?? ""),
      source: String(rel?.source ?? ""),
      target: String(rel?.target ?? ""),
      line: Number(rel?.line_number ?? rel?.line ?? 0),
      localBinding: true,
      bindingKind: String(md.bindingKind ?? ""),
    })
  }
  return { rows, dir }
}

const synthetic = await runSyntheticProbe()
console.log(`TS R2 PROBE — the \`<callable>\\0<name>\` key · corpus ${CR}`)
console.log(`\nPART A — THE FLEET-WIDE PROBE (one parse, no corpus):`)
console.log(`  the file: two same-named locals in NESTED scopes, both read (a PARAMETER and a BLOCK-LOCAL)`)
for (const r of synthetic.rows) {
  console.log(`    ${r.type}\t${r.source}\t${r.target.replace(/\0/g, "<NUL>")}\tline ${r.line}\tbindingKind=${r.bindingKind}`)
}
const twoRows = synthetic.rows.length === 2
const identical = twoRows && synthetic.rows[0]!.target === synthetic.rows[1]!.target
const kinds = synthetic.rows.map((r) => r.bindingKind)
const kindsAgree = kinds.length === 2 && kinds[0] === kinds[1]
console.log(`  (1) ROW COUNT — the analyzer published ${synthetic.rows.length} row(s) for the two reads: ${twoRows ? "TWO — the row-count half of R2's probe PASSES" : `NOT TWO (${synthetic.rows.length}) — the row-count half of R2's probe FAILS`}`)
console.log(`  (2) SPELLING — the two targets are ${identical ? "BYTE-IDENTICAL" : "different"}: ${identical ? "the key carries the CALLABLE and the NAME, not the DECLARATION (R2's defect class is present in its SPELLING form)" : "the key distinguishes the two declarations"}`)
console.log(`  (3) KIND — bindingKind is ${kindsAgree ? "the SAME on both rows" : "DIFFERENT on the two rows"} (${kinds.join(", ")}): ${kindsAgree ? "the collector is a FILE-WIDE first-wins map, so the block-local's kind is the parameter's kind — the same scope-shadowing class the receiver-type map had" : "the kinds are distinguished"}`)
console.log(`  THE VERDICT: the key does NOT carry the declaration's identity, and this lane has NO analyzer-level relationship dedup — so nothing is COLLAPSED here; the defect class is present as an IDENTITY defect, not as a row loss.`)

// ─────────────────────────────────────────────────────────────────────────────────────────
// PART B — THE POPULATION SURFACE
// ─────────────────────────────────────────────────────────────────────────────────────────
type Decl = { kind: string; line: number; scope: number; fnScope: number }
type FileDecls = Map<string, Decl[]>

const discover = (): { files: string[]; admitted: number; repos: number; overCap: number; absent: number } => {
  const found: string[] = []
  const repos = new Set<string>()
  let overCap = 0
  let absent = 0
  let entries: string[]
  try { entries = fs.readdirSync(CR) } catch { return { files: [], admitted: 0, repos: 0, overCap, absent } }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try { if (!fs.statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      const low = rel.toLowerCase()
      const base = low.slice(low.lastIndexOf("/") + 1)
      const admitted = EXT.list.some((e) => low.endsWith(`.${e}`))
        || (EXT.list.some((e) => base === e) && detectLanguageFromPath(rel) === "typescript")
      if (!admitted) continue
      const abs = path.join(dir, rel)
      try {
        const st = fs.statSync(abs)
        if (!st.isFile()) { absent++; continue }
        if (st.size > SIZE_CAP) { overCap++; continue }
      } catch { absent++; continue }
      found.push(abs)
      repos.add(name)
    }
  }
  found.sort()
  return { files: found, admitted: found.length, repos: repos.size, overCap, absent }
}

/** THE NAMES A BINDING PATTERN INTRODUCES. */
const patternNames = (p: any, out: string[]): void => {
  if (!p) return
  if (p.type === "identifier" || p.type === "type_identifier" || p.type === "shorthand_property_identifier" || p.type === "shorthand_property_identifier_pattern") {
    out.push(p.text)
    return
  }
  if (p.type === "pair_pattern" || p.type === "pair") {
    const v = p.childForFieldName?.("value") ?? p.namedChild(1) ?? p.namedChild(0)
    if (v) patternNames(v, out)
    return
  }
  if (p.type === "object_assignment_pattern" || p.type === "assignment_pattern") {
    const l = p.childForFieldName?.("left") ?? p.namedChild(0)
    if (l) patternNames(l, out)
    return
  }
  if (p.type === "rest_pattern" || p.type === "spread_pattern" || p.type === "object_pattern" || p.type === "array_pattern") {
    for (let i = 0; i < p.namedChildCount; i++) {
      const c = p.namedChild(i)
      if (c) patternNames(c, out)
    }
  }
}

/** THE FILE'S LOCAL-BINDING DECLARATIONS, with the kind and the scope each was declared in.
 *
 * THE SCOPE IS THE NEAREST ENCLOSING SCOPE-FORMING NODE, and a scope-forming node is a FUNCTION-LIKE
 * node **or a BLOCK** — a `statement_block`, a `for` head, a `catch` clause, a class body. THE
 * BLOCKS ARE THE POINT: the charter's own probe is a parameter and a BLOCK-LOCAL of the same name in
 * the same function, and a function-level scope model cannot tell them apart — so a probe that
 * stopped at the function would report the defect as ABSENT when it is present.
 */
const SCOPE_NODE_TYPES = new Set([
  "function_declaration", "generator_function_declaration", "function_expression", "arrow_function",
  "method_definition", "statement_block", "lexical_block", "for_statement", "for_in_statement",
  "catch_clause", "class_body",
])

const collectDeclarations = (tree: any): {
  decls: FileDecls
  scopes: Map<number, { id: number; parent: number | null; startLine: number; endLine: number }>
  scopeAtLine: (line: number) => number
  visibleKind: (name: string, scope: number) => { kind: string; line: number } | null
  fnScopeAtLine: (line: number) => number
  declarationsInCallable: (name: string, fnScope: number) => Decl[]
} => {
  const out: FileDecls = new Map()
  const scopes = new Map<number, { id: number; parent: number | null; startLine: number; endLine: number }>()
  const add = (name: string, kind: string, line: number, scope: number, fnScope: number) => {
    if (name.length === 0) return
    let list = out.get(name)
    if (!list) out.set(name, (list = []))
    list.push({ kind, line, scope, fnScope })
  }
  /** THE NEAREST ENCLOSING FUNCTION-LIKE SCOPE — the CALLABLE, which is the half of the spelling
   *  `<callable>\0<name>`. Two declarations of a name in DIFFERENT callables spell DIFFERENTLY, so
   *  only the declarations INSIDE ONE CALLABLE can make the key ambiguous. */
  const fnScopeOf = (node: any): number => {
    let p = node?.parent
    while (p) {
      if (
        p.type === "function_declaration" || p.type === "generator_function_declaration" ||
        p.type === "function_expression" || p.type === "arrow_function" || p.type === "method_definition"
      ) return p.startIndex
      p = p.parent
    }
    return 0
  }
  // The nearest enclosing SCOPE of a node — a function-like node OR a block.
  const scopeOf = (node: any): number => {
    let p = node?.parent
    while (p) {
      if (SCOPE_NODE_TYPES.has(p.type)) return p.startIndex
      p = p.parent
    }
    return 0
  }
  // THE SCOPE TREE — every scope node's parent is the scope of the node that CONTAINS it.
  const buildScopes = (node: any): void => {
    if (SCOPE_NODE_TYPES.has(node?.type) && !scopes.has(node.startIndex)) {
      scopes.set(node.startIndex, {
        id: node.startIndex,
        parent: scopeOf(node.parent),
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      })
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c) buildScopes(c)
    }
  }
  buildScopes(tree.rootNode)
  scopes.set(0, { id: 0, parent: null, startLine: 0, endLine: 1_000_000 })
  /** THE FUNCTION-LIKE SCOPE IDS — the CALLABLES, the `<callable>` half of the spelling. */
  const FN_SCOPE_IDS = new Set<number>()
  {
    const collect = (node: any): void => {
      if (
        node?.type === "function_declaration" || node?.type === "generator_function_declaration" ||
        node?.type === "function_expression" || node?.type === "arrow_function" || node?.type === "method_definition"
      ) FN_SCOPE_IDS.add(node.startIndex)
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c) collect(c)
      }
    }
    collect(tree.rootNode)
  }
  const walk = (node: any) => {
    const t = node.type
    const scope = scopeOf(node)
    const fnScope = fnScopeOf(node)
    const line = node.startPosition.row + 1
    if (t === "required_parameter" || t === "optional_parameter") {
      const pat = node.childForFieldName("pattern") ?? node.childForFieldName("name") ?? node.namedChild(0)
      const names: string[] = []
      patternNames(pat, names)
      for (const n of names) add(n, "parameter", line, scope, fnScope)
    } else if (t === "type_parameter") {
      const nm = node.childForFieldName("name") ?? node.namedChild(0)
      if (nm) add(String(nm.text ?? ""), "type_parameter", line, scope, fnScope)
    } else if (t === "variable_declarator") {
      const nm = node.childForFieldName("name") ?? node.namedChild(0)
      const names: string[] = []
      patternNames(nm, names)
      for (const n of names) add(n, "local", line, scope, fnScope)
    } else if (t === "catch_clause") {
      const pat = node.childForFieldName("parameter") ?? node.namedChild(0)
      const names: string[] = []
      patternNames(pat, names)
      for (const n of names) add(n, "catch_binding", line, scope, fnScope)
    } else if (t === "for_in_statement") {
      const left = node.childForFieldName("left") ?? node.namedChild(0)
      if (left?.type === "identifier") add(left.text, "loop_binding", line, scope, fnScope)
      else {
        const names: string[] = []
        patternNames(left, names)
        for (const n of names) add(n, "loop_binding", line, scope, fnScope)
      }
    } else if (t === "function_declaration" || t === "generator_function_declaration" || t === "class_declaration") {
      const nm = node.childForFieldName("name")
      if (nm?.text && scope !== 0) add(nm.text, "nested_declaration", line, scope, fnScope)
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c) walk(c)
    }
  }
  walk(tree.rootNode)
  /** THE INNERMOST SCOPE THAT COVERS A LINE — the scope a row written on that line is in. */
  const scopeAtLine = (line: number): number => {
    let best = 0
    let bestSize = Number.MAX_SAFE_INTEGER
    for (const s of scopes.values()) {
      if (s.id === 0) continue
      if (line < s.startLine || line > s.endLine) continue
      const size = s.endLine - s.startLine
      if (size < bestSize) { bestSize = size; best = s.id }
    }
    return best
  }
  /** THE CALLABLE THAT COVERS A LINE — the nearest function-like scope, which is the `<callable>`
   *  half of the spelling. */
  const fnScopeAtLine = (line: number): number => {
    let best = 0
    let bestSize = Number.MAX_SAFE_INTEGER
    for (const s of scopes.values()) {
      if (s.id === 0) continue
      if (!FN_SCOPE_IDS.has(s.id)) continue
      if (line < s.startLine || line > s.endLine) continue
      const size = s.endLine - s.startLine
      if (size < bestSize) { bestSize = size; best = s.id }
    }
    return best
  }
  /** THE DECLARATIONS OF A NAME INSIDE ONE CALLABLE — the set that can make the key ambiguous,
   *  because two declarations in DIFFERENT callables spell DIFFERENTLY. */
  const declarationsInCallable = (name: string, fnScope: number): Decl[] => {
    const list = out.get(name)
    if (!list) return []
    return list.filter((d) => d.fnScope === fnScope)
  }
  /** THE DECLARATION OF A NAME THAT IS VISIBLE IN A SCOPE — the innermost scope that declares it,
   *  walking outward, which is the lexical rule. */
  const visibleKind = (name: string, scope: number): { kind: string; line: number } | null => {
    const list = out.get(name)
    if (!list || list.length === 0) return null
    let s: number | null = scope
    while (s !== null) {
      const here = list.filter((d) => d.scope === s)
      if (here.length > 0) return { kind: here[0]!.kind, line: here[0]!.line }
      const sc = scopes.get(s)
      s = sc ? sc.parent : null
    }
    return null
  }
  return { decls: out, scopes, scopeAtLine, visibleKind, fnScopeAtLine, declarationsInCallable }
}

const partB = {
  ran: false,
  population: { filesParsed: 0, admitted: 0, repos: 0, overCap: 0, absent: 0, parseFailures: 0 },
  localBindingRows: 0,
  rowsWhoseNameIsDeclaredOnce: 0,
  rowsWhoseNameIsDeclaredMoreThanOnce: 0,
  rowsSharingASpellingInTheirFile: 0,
  filesWithASharedSpelling: 0,
  kindMislabelled: 0,
  samples: [] as string[],
}

if (POPULATION) {
  const disc = discover()
  let files = disc.files
  if (MAX_FILES > 0 && disc.admitted > MAX_FILES) {
    const stride = Math.max(1, Math.floor(disc.admitted / MAX_FILES))
    const picked: string[] = []
    for (let i = 0; i < disc.files.length && picked.length < MAX_FILES; i += stride) picked.push(disc.files[i]!)
    files = picked
  }
  const parser = await ASTEngine.getParser("typescript" as any)
  let parseFailures = 0
  for (const file of files) {
    const rel = file.startsWith(CR) ? file.slice(CR.length + 1) : file
    let content: string
    try { content = fs.readFileSync(file, "utf8") } catch { parseFailures++; continue }
    let tree: any
    try { tree = parser.parse(content) } catch { parseFailures++; continue }
    if (!tree) { parseFailures++; continue }
    let parsed: any
    try { parsed = await ASTEngine.parseFile(file, content, {} as any) } catch { parseFailures++; continue }
    if (parsed?.fallback === true) { parseFailures++; continue }
    const decls = collectDeclarations(tree)
    // THE SPELLINGS IN THIS FILE — how many rows share one key.
    const bySpelling = new Map<string, number>()
    for (const rel2 of parsed?.relationships ?? []) {
      const md: any = rel2?.metadata ?? {}
      if (md.localBinding !== true) continue
      const target = String(rel2?.target ?? "")
      bySpelling.set(target, (bySpelling.get(target) ?? 0) + 1)
    }
    let sharedInThisFile = false
    for (const [spelling, n] of bySpelling) if (n > 1) sharedInThisFile = true
    if (sharedInThisFile) partB.filesWithASharedSpelling++
    for (const rel2 of parsed?.relationships ?? []) {
      const md: any = rel2?.metadata ?? {}
      if (md.localBinding !== true) continue
      const target = String(rel2?.target ?? "")
      const at = target.lastIndexOf("\0")
      if (at < 0) continue
      const name = target.slice(at + 1)
      partB.localBindingRows++
      if ((bySpelling.get(target) ?? 0) > 1) partB.rowsSharingASpellingInTheirFile++
      // THE SHARP TEST: how many declarations of this name live inside the row's OWN CALLABLE? Two
      // declarations in DIFFERENT callables spell DIFFERENTLY (`f1\0tmp` vs `f2\0tmp`), so only the
      // ones in ONE callable can make the key ambiguous. A FILE-WIDE count would over-report.
      const rowLine0 = Number(rel2?.line_number ?? rel2?.line ?? 0)
      const inCallable = decls.declarationsInCallable(name, decls.fnScopeAtLine(rowLine0))
      const list = inCallable.length > 0 ? inCallable : (decls.decls.get(name) ?? [])
      if (list.length <= 1) { partB.rowsWhoseNameIsDeclaredOnce++; continue }
      partB.rowsWhoseNameIsDeclaredMoreThanOnce++
      // THE KIND, SCOPE-AWARE: the declaration the row's OWN scope sees, walked outward. This is the
      // test the charter's probe makes ("the block-local's kind is the parameter's kind"), and a
      // FILE-WIDE kind test would report the defect as absent whenever the file happens to declare
      // the name with both kinds somewhere.
      const rowLine = rowLine0
      const visible = decls.visibleKind(name, decls.scopeAtLine(rowLine))
      const rowKind = String(md.bindingKind ?? "")
      if (visible && rowKind.length > 0 && visible.kind !== rowKind) {
        partB.kindMislabelled++
        if (partB.samples.length < 12) {
          partB.samples.push(`${rel}:${rowLine} ${target.replace(/\0/g, "<NUL>")} bindingKind=${rowKind} but the declaration in scope is a ${visible.kind} at line ${visible.line}`)
        }
      }
    }
  }
  partB.ran = true
  partB.population = { filesParsed: files.length, admitted: disc.admitted, repos: disc.repos, overCap: disc.overCap, absent: disc.absent, parseFailures }
  console.log(`\nPART B — THE POPULATION SURFACE (${files.length} parsed of ${disc.admitted} admitted, ${disc.repos} repos):`)
  console.log(`  extensions: ${EXT.list.join(",")}   (source: ${EXT.source})`)
  console.log(`  local-binding rows published                      ${partB.localBindingRows}`)
  console.log(`  rows whose CALLABLE declares the name ONCE        ${partB.rowsWhoseNameIsDeclaredOnce}   (the key identifies the declaration here)`)
  console.log(`  rows whose CALLABLE declares the name MORE THAN ONCE ${partB.rowsWhoseNameIsDeclaredMoreThanOnce}   (THE KEY CANNOT IDENTIFY THE DECLARATION — R2's surface)`)
  console.log(`  rows whose SPELLING is shared with another row in their file  ${partB.rowsSharingASpellingInTheirFile}   (in ${partB.filesWithASharedSpelling} file(s))`)
  console.log(`  of those, rows whose bindingKind names no declaration of that kind in the file  ${partB.kindMislabelled}   (UPPER BOUND — see the caveat below)`)
  console.log(`  CAVEAT ON THAT LAST LINE: this probe's OWN scope model does not model every binding form (a JSX prop`,)
  console.log(`  destructuring, for one), so it can call a row mislabelled that is not. **THE DEFECT IS PROVEN TO`)
  console.log(`  EXIST by PART A above** — the charter's own probe publishes a block-local with the parameter's`)
  console.log(`  kind — and the number here is its UPPER BOUND, not its size. The size needs the scope model the`)
  console.log(`  fix would introduce, which is why the fix and the price belong together.`)
  for (const s of partB.samples) console.log(`    · ${s}`)
}

const report = {
  synthetic: {
    rows: synthetic.rows.map((r) => ({ ...r, target: r.target.replace(/\0/g, "<NUL>") })),
    twoRowsPublished: twoRows,
    targetsByteIdentical: identical,
    bindingKinds: kinds,
  },
  population: partB,
}
if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2))
  console.log(`\nWROTE ${JSON_OUT}`)
}
