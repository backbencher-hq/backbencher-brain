/**
 * BASH ONTOLOGY — PASS-2 ADVERSARIAL PROBES.
 *
 * ## Why this file exists
 *
 * `census-bash-ontology.ts` answers "how many, and how clean". It cannot answer
 * "is the number RIGHT", because a count is satisfied by an edge that should not
 * exist. This file is the adversarial half: for each type the analyzer emits, it
 * tries to find a case where the edge is WRONG, and it separates two very
 * different reasons an edge can fail to resolve.
 *
 * That distinction is the whole point of P1. An unresolved `calls` target is
 * either
 *
 *   (a) a DECLARATION THE ANALYZER MISSED — the target is declared in the file
 *       by an independent tree walk and simply absent from the emitted symbol
 *       set. This is a defect: a false-negative symbol. It should be ~0.
 *   (b) an EXTERNAL COMMAND — `git`, `curl`, `awk`: a real runtime dependency on
 *       a program with no declaration in the file. Unresolvable BY CONSTRUCTION,
 *       and correct to emit.
 *
 * A pooled "18.7% resolved" cannot tell (a) from (b). If (a) is non-zero the
 * resolution rate is measuring the analyzer's own recall, not bash's shape; if
 * (a) is zero then the low rate is a property of the language and the number is
 * honest. This probe measures (a) and (b) separately, per type.
 *
 * ## Independence of the declaration inventory
 *
 * The "declared" set is built by walking the parse tree for `function_definition`
 * names and `variable_name` nodes under `variable_assignment` /
 * `declaration_command`. That is a SEPARATE derivation from the analyzer's symbol
 * extraction, and it is close to (but not the same as) the oracle in
 * `script/m14/differential.ts`. It is a recall check, not a truth oracle: a
 * grammar bug that hides a declaration from BOTH walks stays invisible here, and
 * this file does not claim otherwise.
 *
 * ## P2 — `overrides` is the label most open to challenge
 *
 * bash has no inheritance, so there is no superclass method being overridden.
 * `overrides` here is emitted for a RE-DEFINITION of a function name in one file.
 * Whether a redefinition is an "override" or a "shadow" is a judgement, not a
 * parse fact, so this probe does not settle it — it prints every edge with its
 * source context so the judgement can be made by hand on real text rather than
 * asserted. The distinction that decides it: an override implies a BASE to
 * override. This probe counts, per edge, whether a definition of the same name
 * occurs EARLIER in the same file (redefinition) or whether the name is defined
 * only at the override site (which would be a different fact entirely).
 *
 * ## P3 — `imports` and `references` may be one fact under two labels
 *
 * `real-bash-analyzer.ts` emits BOTH types from the same `source`/`.` branch,
 * with the same source, target and line. `deriveBashEdges` in
 * `script/m14/differential.ts` does the same, which is why the differential
 * reports zero unexplained edges and cannot see the duplication: both sides
 * agree, so the agreement certifies nothing about the labelling. This probe
 * measures how many (source, target, line) triples are emitted under BOTH labels,
 * because that is the size of the ontology's one-fact-two-labels question.
 *
 * CLI:
 *   npx tsx validation/m14/fixtures/bash/adversarial-probes.ts [--sample 400] [--json out.json] [--dump-dir DIR]
 */

import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const argv = process.argv.slice(2)
const flag = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const SAMPLE = Number(flag("sample") ?? "400")
const OUT = flag("json")
const DUMP_DIR = flag("dump-dir")

// ------------------------------------------------------------------ corpus
type Admitted = { repo: string; dir: string; rel: string; abs: string; text: string }
const admitted: Admitted[] = []
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
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try {
      if (statSync(abs).size > 512 * 1024) continue
    } catch {
      continue
    }
    let text: string
    try {
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "bash") continue
    admitted.push({ repo: e, dir, rel, abs, text })
  }
}
admitted.sort((a, b) => {
  const ha = createHash("sha256").update(`${a.repo}/${a.rel}`).digest("hex")
  const hb = createHash("sha256").update(`${b.repo}/${b.rel}`).digest("hex")
  return ha < hb ? -1 : ha > hb ? 1 : 0
})
const files = admitted.slice(0, SAMPLE)

// ------------------------------------------------------------ parser + walks
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-bash.wasm"))))

/**
 * An independent declaration inventory: every function name and every VARIABLE
 * WRITE the tree actually contains. Deliberately NOT the analyzer's symbol
 * extractor — that is the thing under test.
 *
 * The write/read distinction is not pedantry; getting it wrong invents findings.
 * The first version of this probe collected every `variable_name` node and
 * reported `calls -> git` in `kubernetes/hack/cherry_pick_pull.sh` as a
 * "declaration the analyzer missed", on the strength of a single
 * `variable_name: "git"` node — which sat inside a `simple_expansion`, i.e. a
 * READ of an environment variable. 24 phantom defects, of which the examples
 * were `git`, `date` and `kate`: commands, not variables. A `variable_name` is a
 * declaration only where it is the NAME SIDE of an assignment or of a
 * declaration_command; everywhere else it is a use.
 *
 * `alias` is collected too, because the analyzer models an alias as a callable
 * `function` symbol (so a call to it resolves). Omitting it would manufacture
 * the opposite error — a "declared" name that the tree never declares.
 */
const declaredNames = (root: any): { fns: Set<string>; vars: Set<string>; aliases: Set<string> } => {
  const fns = new Set<string>()
  const vars = new Set<string>()
  const aliases = new Set<string>()
  const isWriteContext = (n: any): boolean => {
    const p = n?.parent
    if (!p) return false
    if (p.type === "variable_assignment") {
      // the name side only: `variable_name` is a write when its parent is the
      // assignment itself, which is what distinguishes `X=1` from `${X}`.
      return true
    }
    if (p.type === "declaration_command") return true
    return false
  }
  const st: any[] = [root]
  while (st.length > 0) {
    const n: any = st.pop()
    if (!n) continue
    if (n.type === "function_definition") {
      const nm = n.childForFieldName?.("name")
      if (nm?.text) fns.add(nm.text)
    }
    if (n.type === "variable_name") {
      const t = String(n.text ?? "").trim()
      if (t && isWriteContext(n)) vars.add(t)
    }
    // `alias ll='ls -la'` — the grammar gives no name field, the declaration
    // parses as a concatenation whose leading fragment carries the name.
    if (n.type === "command") {
      let cn: any = null
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && c.type === "command_name") { cn = c; break } }
      if (cn?.text === "alias") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && (c.type === "concatenation" || c.type === "word")) {
            const nm = aliasNameBeforeEquals(String(c.text ?? ""))
            if (nm) aliases.add(nm)
          }
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) st.push(c) }
  }
  return { fns, vars, aliases }
}

/** Every line on which a function with this name is defined, in file order. */
const functionDefLines = (root: any): Map<string, number[]> => {
  const m = new Map<string, number[]>()
  const st: any[] = [root]
  while (st.length > 0) {
    const n: any = st.pop()
    if (!n) continue
    if (n.type === "function_definition") {
      const nm = n.childForFieldName?.("name")?.text
      if (nm) {
        const a = m.get(nm) ?? []
        a.push((n.startPosition?.row ?? 0) + 1)
        m.set(nm, a.sort((x, y) => x - y))
      }
    }
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) st.push(c) }
  }
  return m
}

// bash builtins + keywords. The analyzer refuses a `calls` edge to every one of
// these (real-bash-analyzer.ts, the SHELL_BUILTINS guard), so a NON-ZERO count
// in this bucket means the guard leaked. That is the reason the set is kept
// SEPARATE from the utility list below: mixing them would hide a leak.
const BASH_BUILTINS = new Set([
  "cd", "echo", "printf", "read", "pwd", "exit", "return", "export", "unset", "local", "readonly", "declare", "typeset",
  "eval", "exec", "source", "shift", "set", "trap", "wait", "jobs", "fg", "bg", "kill", "umask", "ulimit", "alias", "unalias",
  "type", "command", "builtin", "hash", "help", "history", "let", "getopts", "mapfile", "readarray", "caller", "compgen", "complete",
  "enable", "shopt", "bind", "disown", "suspend", "times", "logout", "dirs", "popd", "pushd", "true", "false", "test", "[",
  "if", "then", "else", "elif", "fi", "case", "esac", "for", "while", "until", "do", "done", "in", "function", "select", "time",
])

// The external programs the corpus actually runs. This list exists only to
// answer one question — "no file in the sample declares this name" — and it is
// deliberately NOT a claim that these are builtins: `grep`, `sed`, `git` and
// `python` are programs on PATH, not shell builtins. The first version of this
// probe called the union of both sets "builtin/keyword" and reported 1,893
// edges in that bucket, which reads as "1,893 calls to shell builtins" and is
// false — the analyzer refuses those outright. The names below are counted
// separately so the two cannot be conflated again.
const WELL_KNOWN_PROGRAMS = new Set([
  "grep", "sed", "awk", "cat", "cut", "sort", "uniq", "head", "tail", "tr", "wc", "find", "xargs", "cp", "mv", "rm", "mkdir", "rmdir",
  "ln", "chmod", "chown", "ls", "df", "du", "ps", "killall", "top", "tar", "gzip", "gunzip", "zip", "unzip", "curl", "wget",
  "git", "ssh", "scp", "rsync", "make", "cmake", "gcc", "g++", "clang", "ld", "python", "python3", "pip", "pip3", "perl",
  "ruby", "node", "npm", "npx", "yarn", "java", "javac", "mvn", "gradle", "go", "rustc", "cargo", "docker", "kubectl", "helm",
  "date", "mktemp", "dirname", "basename", "realpath", "readlink", "install", "patch", "diff", "cmp",
  "tee", "env", "expr", "seq", "yes", "base64", "md5sum", "sha1sum", "sha256sum", "openssl", "gpg",
  "mysql", "psql", "sqlite3", "redis-cli", "systemctl", "service", "apt", "apt-get", "yum", "dnf", "brew", "docker-compose",
])

type Cls = "resolved" | "missed-declaration" | "external" | "builtin"
type PerType = {
  total: number
  resolved: number
  missed: number
  external: number
  builtin: number
  knownProgram: number
  missedExamples: string[]
}
const perType = new Map<string, PerType>()
const bucket = (t: string): PerType => {
  let b = perType.get(t)
  if (!b) { b = { total: 0, resolved: 0, missed: 0, external: 0, builtin: 0, knownProgram: 0, missedExamples: [] }; perType.set(t, b) }
  return b
}

// The analyzer tags its OWN view of local-vs-external in relationship metadata.
// That is a self-report, so it is recorded SEPARATELY and cross-tabulated
// against the independent walk below. Where the two disagree, one of them is
// wrong and the disagreement is the finding.
const selfReport = new Map<string, { external: number; notExternal: number; disagreeExternal: number; disagreeLocal: number; disagreeExamples: string[] }>()
const selfBucket = (t: string) => {
  let b = selfReport.get(t)
  if (!b) { b = { external: 0, notExternal: 0, disagreeExternal: 0, disagreeLocal: 0, disagreeExamples: [] }; selfReport.set(t, b) }
  return b
}

/** Every distinct confidence value seen per type — honesty contract §4 wants these countable. */
const confValues = new Map<string, Map<number, number>>()

// ------------------------------------------------------------------ P1 + P3
type ImportTriples = { both: number; importsOnly: number; referencesOnly: number; neither: number; examples: string[] }
const triples = new Map<string, ImportTriples>()
const tg = (): ImportTriples => {
  let t = triples.get("k")
  if (!t) { t = { both: 0, importsOnly: 0, referencesOnly: 0, neither: 0, examples: [] }; triples.set("k", t) }
  return t
}

// ------------------------------------------------------------------ P2
type OverrideRow = { file: string; line: number; source: string; target: string; earlierDef: boolean; context: string }
const overrideRows: OverrideRow[] = []
// exports: is the target a variable or a function, and is it ever read?
type ExportRow = { file: string; line: number; source: string; target: string; kind: string; context: string }
const exportRows: ExportRow[] = []

let parseFailures = 0
const failureExamples: string[] = []

for (const f of files) {
  const label = `${f.repo}/${f.rel}`
  let r: any
  try {
    r = await parseFile(f.abs, f.dir)
  } catch {
    parseFailures++; if (failureExamples.length < 6) failureExamples.push(label); continue
  }
  if (!r || r.success === false) {
    parseFailures++; if (failureExamples.length < 6) failureExamples.push(label); continue
  }

  let declared: ReturnType<typeof declaredNames> = { fns: new Set<string>(), vars: new Set<string>(), aliases: new Set<string>() }
  let defLines = new Map<string, number[]>()
  try {
    const t = parser.parse(f.text)
    if (t) {
      declared = declaredNames(t.rootNode)
      defLines = functionDefLines(t.rootNode)
      t.delete?.()
    }
  } catch { /* the production path already recorded its own outcome */ }

  const symbols: any[] = r.symbols ?? []
  const emittedNames = new Set<string>()
  const kindOf = new Map<string, string>()
  for (const s of symbols) {
    const nm = String(s?.name ?? "")
    if (nm) { emittedNames.add(nm); if (!kindOf.has(nm)) kindOf.set(nm, String(s?.kind ?? "")) }
  }

  const lines = f.text.split("\n")
  const ctx = (ln: number): string => {
    const out: string[] = []
    for (let i = Math.max(1, ln - 2); i <= Math.min(lines.length, ln + 2); i++) {
      out.push(`${i === ln ? ">>" : "  "} ${i}: ${lines[i - 1] ?? ""}`)
    }
    return out.join("\n")
  }

  const rels: any[] = r.relationships ?? []
  const perTriple = new Map<string, Set<string>>()
  for (const x of rels) {
    const t = String(x?.type ?? x?.relationshipType ?? "").toLowerCase()
    const src = String(x?.source ?? "")
    const tgt = String(x?.target ?? "")
    const line = Number(x?.line_number ?? x?.line ?? x?.startLine ?? 0)
    const key = `${src} ${tgt} ${line}`
    if (t === "imports" || t === "references") {
      const s = perTriple.get(key) ?? new Set<string>()
      s.add(t)
      perTriple.set(key, s)
    }
    if (t === "calls" || t === "uses") {
      const b = bucket(t)
      b.total++
      const cv = Number(x?.confidence ?? 0)
      const cm = confValues.get(t) ?? new Map<number, number>()
      cm.set(cv, (cm.get(cv) ?? 0) + 1)
      confValues.set(t, cm)
      // cross-tabulate the analyzer's self-report against the independent walk
      const md: any = x?.metadata ?? {}
      if (typeof md.isExternalCommand === "boolean") {
        const sb = selfBucket(t)
        const mineExternal = !declared.fns.has(tgt) && !declared.vars.has(tgt) && !declared.aliases.has(tgt)
        if (md.isExternalCommand) { sb.external++; if (!mineExternal) { sb.disagreeExternal++; if (sb.disagreeExamples.length < 8) sb.disagreeExamples.push(`${label}:${line} analyzer=external mine=declared-in-file target=${tgt}`) } }
        else { sb.notExternal++; if (mineExternal) { sb.disagreeLocal++; if (sb.disagreeExamples.length < 8) sb.disagreeExamples.push(`${label}:${line} analyzer=local mine=undeclared target=${tgt}`) } }
      }
      if (emittedNames.has(tgt)) { b.resolved++; continue }
      if (declared.fns.has(tgt) || declared.vars.has(tgt) || declared.aliases.has(tgt)) {
        b.missed++
        if (b.missedExamples.length < 8) b.missedExamples.push(`${label}:${line} ${t} -> ${tgt}`)
      } else if (BASH_BUILTINS.has(tgt)) { b.builtin++ } else if (WELL_KNOWN_PROGRAMS.has(tgt)) { b.knownProgram++ } else { b.external++ }
    }
    if (t === "overrides") {
      const dl = defLines.get(tgt) ?? []
      const earlier = dl.some((d) => d < line)
      overrideRows.push({ file: label, line, source: src, target: tgt, earlierDef: earlier, context: ctx(line) })
    }
    if (t === "exports") {
      exportRows.push({ file: label, line, source: src, target: tgt, kind: kindOf.get(tgt) ?? "(not-a-symbol)", context: ctx(line) })
    }
  }
  for (const [k, s] of perTriple) {
    const g = tg()
    if (s.has("imports") && s.has("references")) { g.both++; if (g.examples.length < 6) g.examples.push(`${label} ${k}`) }
    else if (s.has("imports")) g.importsOnly++
    else g.referencesOnly++
  }
  void neitherGuard(tg())
}
function neitherGuard(t: ImportTriples): void { void t.neither }

// ------------------------------------------------------------------ report
const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(2)}%`)
const out: any = {
  sample: { files: files.length, repos: new Set(files.map((f) => f.repo)).size, admittedTotal: admitted.length, parseFailures, failureExamples },
  p1_unresolved_target_classification: {},
  p1b_self_report_vs_independent_walk: {},
  p5_confidence_values: {},
  p3_imports_references_overlap: triples.get("k") ?? { both: 0, importsOnly: 0, referencesOnly: 0, neither: 0, examples: [] },
  p2_overrides: { total: overrideRows.length, withEarlierDefinitionInFile: overrideRows.filter((r) => r.earlierDef).length, rows: [] },
  p4_exports: { total: exportRows.length, byKind: {} as Record<string, number>, rows: [] },
}
for (const [t, b] of [...perType].sort()) {
  ;(out.p1_unresolved_target_classification as any)[t] = {
    total: b.total,
    resolved: b.resolved,
    resolvedPct: pct(b.resolved, b.total),
    missedDeclaration: b.missed,
    missedDeclarationPct: pct(b.missed, b.total),
    externalCommand: b.external,
    bashBuiltinNamedByACall: b.builtin,
    wellKnownExternalProgram: b.knownProgram,
    missedExamples: b.missedExamples,
  }
}
for (const [t, b] of selfReport) (out.p1b_self_report_vs_independent_walk as any)[t] = b
for (const [t, m] of confValues) {
  ;(out.p5_confidence_values as any)[t] = Object.fromEntries([...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => [String(k), v]))
}
const exportByKind: Record<string, number> = {}
for (const e of exportRows) exportByKind[e.kind] = (exportByKind[e.kind] ?? 0) + 1
out.p4_exports.byKind = exportByKind
out.p4_exports.rows = exportRows.slice(0, 12)

console.log("=".repeat(78))
console.log("BASH PASS-2 ADVERSARIAL PROBES")
console.log("=".repeat(78))
console.log(`sample: ${out.sample.files} files, ${out.sample.repos} repos, ${out.sample.admittedTotal} admitted, parse failures ${parseFailures}`)
console.log("")
console.log("P1  UNRESOLVED-TARGET CLASSIFICATION — is a miss the analyzer's or bash's?")
console.log("-".repeat(78))
for (const [t, v] of Object.entries(out.p1_unresolved_target_classification as any)) {
  console.log(`  ${t}:  total ${v.total}`)
  console.log(`      resolved to an emitted symbol : ${v.resolved} (${v.resolvedPct})`)
  console.log(`      DECLARED BUT NOT EMITTED      : ${v.missedDeclaration} (${v.missedDeclarationPct})   <- a real defect if > 0`)
  console.log(`      bash builtin named by a call : ${v.bashBuiltinNamedByACall}   <- the SHELL_BUILTINS guard leaked if > 0`)
  console.log(`      well-known external program  : ${v.wellKnownExternalProgram}`)
  console.log(`      other undeclared name        : ${v.externalCommand}`)
  for (const e of v.missedExamples) console.log(`        e.g. ${e}`)
}
console.log("")
console.log("P1b SELF-REPORT vs INDEPENDENT WALK — does the analyzer's own local/external tag hold up?")
console.log("-".repeat(78))
for (const [t, v] of Object.entries(out.p1b_self_report_vs_independent_walk as any)) {
  console.log(`  ${t}:  tagged external ${v.external}, tagged local ${v.notExternal}`)
  console.log(`      disagreements: analyzer=external but DECLARED in file : ${v.disagreeExternal}`)
  console.log(`                     analyzer=local but UNDECLARED in file   : ${v.disagreeLocal}`)
  for (const e of v.disagreeExamples) console.log(`        e.g. ${e}`)
}
console.log("")
console.log("P5  CONFIDENCE VALUES per type (honesty contract §4: heuristics must be countable)")
console.log("-".repeat(78))
for (const [t, v] of Object.entries(out.p5_confidence_values as any)) {
  console.log(`  ${t}: ${JSON.stringify(v)}`)
}
console.log("")
console.log("P3  imports/references — one fact under two labels?")
console.log("-".repeat(78))
console.log(`  triples under BOTH labels        : ${out.p3_imports_references_overlap.both}`)
console.log(`  triples imports-only             : ${out.p3_imports_references_overlap.importsOnly}`)
console.log(`  triples references-only          : ${out.p3_imports_references_overlap.referencesOnly}`)
for (const e of out.p3_imports_references_overlap.examples) console.log(`    e.g. ${e}`)
console.log("")
console.log("P2  overrides — is there a BASE to override?")
console.log("-".repeat(78))
console.log(`  total overrides edges            : ${out.p2_overrides.total}`)
console.log(`  whose target is defined EARLIER in the same file : ${out.p2_overrides.withEarlierDefinitionInFile}`)
console.log(`  (the rest define the name ONLY at the override site, which is a different fact)`)
out.p2_overrides.rows = overrideRows.slice(0, 8)
for (const r of out.p2_overrides.rows) {
  console.log(`  --- ${r.file}:${r.line}  ${r.source} -[overrides]-> ${r.target}  earlierDef=${r.earlierDef}`)
  console.log(r.context.split("\n").map((l) => "      " + l).join("\n"))
}
console.log("")
console.log("P4  exports — what kind of symbol is the target?")
console.log("-".repeat(78))
console.log(`  total exports edges              : ${out.p4_exports.total}`)
for (const [k, v] of Object.entries(exportByKind).sort((a, b) => (b[1] as number) - (a[1] as number))) {
  console.log(`    target kind ${k.padEnd(22)}: ${v}`)
}
for (const r of out.p4_exports.rows) {
  console.log(`  --- ${r.file}:${r.line}  ${r.source} -[exports]-> ${r.target}  kind=${r.kind}`)
  console.log(r.context.split("\n").map((l) => "      " + l).join("\n"))
}
console.log("")

if (DUMP_DIR) {
  mkdirSync(DUMP_DIR, { recursive: true })
  writeFileSync(path.join(DUMP_DIR, "overrides.tsv"), overrideRows.map((r) => `${r.file}\t${r.line}\t${r.source}\t${r.target}\t${r.earlierDef}`).join("\n"))
  writeFileSync(path.join(DUMP_DIR, "exports.tsv"), exportRows.map((r) => `${r.file}\t${r.line}\t${r.source}\t${r.target}\t${r.kind}`).join("\n"))
  console.log(`dumped per-edge tables to ${DUMP_DIR}`)
}
if (OUT) {
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(`wrote ${OUT}`)
}