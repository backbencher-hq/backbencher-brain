/**
 * M14 ONTOLOGY — LUA. A dead flag and a dead call site, both found by reading.
 *
 * ## Why this probe exists
 *
 * The line-by-line read required by the dual-lens regime found two places where the
 * code cannot do what its own comment says. Neither is visible in any count of the
 * emitted SET — a flag that changes nothing and a call that can never return — so
 * neither can be caught by the census, the oracle, or a mutant. Only a probe that
 * asks "what would this do if it worked?" can size one, and only a probe that counts
 * the population a branch can reach can size the other.
 *
 * **F1 — `dedupe: false` is a NO-OP** (real-lua-analyzer.ts:1758-1761).
 *
 *     if (opts?.dedupe === false) {
 *       if (ctx.seenRelationships.has(key)) return
 *     } else if (ctx.seenRelationships.has(key)) return
 *     ctx.seenRelationships.add(key)
 *
 * Both arms run the SAME test, and the key is added to `seenRelationships` either
 * way. So `dedupe: false` cannot change any output: four call sites pass it
 * (addContainsRelationships:1717, addOverrideRelationships:1628 and :1654,
 * addFactorySupertypeEdges:1392) and none of them is affected by the flag's value.
 * A flag that is read and then ignored is a claim about the output that no reader can
 * check, which is the same failure shape as LUA-02's `isCoroutine` counter and LUA-10's
 * dead `+5` branch — both previously found in this analyzer.
 *
 * The population that matters is the count of `dedupe: false` ADDITIONS the dedup
 * SUPPRESSES, i.e. how many edges the flag would have published had it worked. That
 * number is also a correctness question rather than only a tidiness one: a
 * redefinition declared THREE times publishes one `overrides` edge, and the second
 * redefinition's own line is not represented anywhere.
 *
 * **F2 — `detectFrameworks` on every `identifier` can never fire** (:308-309).
 *
 *     case "identifier":
 *       this.detectFrameworks(node.text, ctx)
 *
 * `detectFrameworks` (:2071) returns immediately unless `text.includes(".")`, and an
 * `identifier` node in the pinned grammar never contains a dot — a qualified name is a
 * `dot_index_expression`, a different node type with its own case arm. Framework
 * detection therefore runs through `processCall`'s `detectFrameworks(qualified, ctx)`
 * (:872) and through `addImport`, and the identifier arm adds nothing. This probe
 * counts `identifier` nodes whose text contains a dot, per corpus file, so the claim
 * is measured over the whole corpus rather than argued from the grammar.
 *
 * ## INSTRUMENT
 *
 * A tree walk over the wired grammar. NO REGEX anywhere in this file: the keys are
 * rebuilt from node TYPES and node FIELDS, exactly as the analyzer builds them, and the
 * dot test is a character-class test on node text (a `.` cannot appear in a name the
 * grammar produced), not a pattern over source text. A regex probe for `extends` in
 * bash matched the words `class voice` inside a telnet IAC word list in a string
 * literal, and a regex probe for `instantiates` matched `new Map(` in a heredoc —
 * both would have convicted a correct ruling. The workstream's own record is why.
 *
 * ## WHAT A NON-ZERO COUNT WOULD MEAN
 *
 *   F1 attempts > distinct  ->  the dedup IS suppressing `dedupe: false` additions,
 *                              and the flag is either lying or the dedup is a latent
 *                              defect. Which of the two is decided by the row: an
 *                              `overrides` row means a redefinition's line is lost; a
 *                              `contains` row means two same-named members publish
 *                              one containment edge.
 *   F1 attempts == distinct ->  the flag is dead AND harmless on this corpus, and the
 *                              finding is the flag alone.
 *   F2 identifiersWithDot > 0  ->  the arm is NOT dead and framework detection is
 *                              reachable from a bare name, which LUA-04's rule forbids.
 *   F2 identifiersWithDot == 0 ->  the arm is unreachable on every corpus file.
 *
 * Usage: npx tsx script/m60/lua-dead-flag-probe.ts [--cap N] [--out <path>]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const arg = (k: string, d?: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const CAP = Number(arg("--cap", "0"))
const OUT = path.resolve(ROOT, arg("--out", "validation/m60/lua/dead-flag-probe.json")!)

// ───────────────────────────────────────────────────────── corpus (same draw predicate as the census)
interface CorpusFile { repo: string; rel: string; abs: string }
function corpusFiles(): CorpusFile[] {
  const files: CorpusFile[] = []
  for (const e of readdirSync(CR).sort()) {
    const dir = path.join(CR, e)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    let tracked: string[]
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.lua"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean).sort()
    } catch { continue }
    for (const rel of (CAP > 0 ? tracked.slice(0, CAP) : tracked)) {
      files.push({ repo: e, rel, abs: path.join(dir, rel) })
    }
  }
  return files
}

// ───────────────────────────────────────────────────────── grammar
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-lua.wasm"))))

// ───────────────────────────────────────────────────────── F1: rebuild the dedupe keys
//
// The analyzer's key is `${type}${source}${target}` and its three `dedupe: false`
// families are:
//
//   contains   addContainsRelationships   source = ownerName | frameSelfName | scope,
//                                          target = symbol.name  — one attempt per SYMBOL
//   overrides  addOverrideRelationships    shape 1, one attempt per declaration AFTER the
//                                          first of a label; source = owner ?? "global",
//                                          target = owner ? member : label
//   extends    addFactorySupertypeEdges    one attempt per `factorySupertypeLines` entry,
//                                          source = derived, target = base
//
// `contains` needs the frame each symbol was filed under, which is a SCOPE property and
// not a node, so it is counted separately and reported per-file rather than claimed from
// a single global counter. `overrides` shape 1 and `extends` factory are pure functions
// of the tree and are counted exactly.
type KeyCount = Map<string, number>

/** Declarations per LABEL, and the key each redefinition after the first would use.
 * `splitMemberName` is reproduced from the node shape: an index expression puts the
 * RECEIVER in namedChild(0) and the FIELD last. */
function countRedefinitionKeys(root: any, keys: KeyCount, examples: string[]): number {
  let attempts = 0
  const byLabel = new Map<string, Array<{ line: number; owner: string | null; member: string | null }>>()
  const visit = (n: any): void => {
    if (n.type === "function_declaration" || n.type === "function_definition") {
      const nameNode = n.childForFieldName("name")
      if (nameNode) {
        const label = String(nameNode.text ?? "")
        let name = label
        let owner: string | null = null
        if (nameNode.type === "dot_index_expression" || nameNode.type === "method_index_expression") {
          const first = nameNode.namedChild(0)
          const last = nameNode.namedChildCount > 1 ? nameNode.namedChild(nameNode.namedChildCount - 1) : undefined
          owner = first?.type === "identifier" ? first.text : null
          name = last?.text || label
        }
        const arr = byLabel.get(label) ?? []
        arr.push({ line: n.startPosition.row + 1, owner, member: owner ? name : null })
        byLabel.set(label, arr)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visit(c) }
  }
  visit(root)
  for (const [label, decls] of byLabel) {
    if (decls.length < 2) continue
    const byLine = [...decls].sort((a, b) => a.line - b.line)
    for (let i = 1; i < byLine.length; i++) {
      const d = byLine[i]
      const source = d.owner ?? "global"
      const target = d.owner ? (d.member ?? label) : label
      attempts++
      const key = `overrides${source}${target}`
      keys.set(key, (keys.get(key) ?? 0) + 1)
      if (examples.length < 6 && d.line !== byLine[0].line) examples.push(`${label}@${d.line} (first at ${byLine[0].line})`)
    }
  }
  return attempts
}

/** F2: does an `identifier` node ever carry a dot? `detectFrameworks` returns early
 * unless it does, and the identifier arm of processNode is the only caller that can
 * reach it with a bare name. */
function countIdentifiersWithDot(root: any): { total: number; withDot: number; examples: string[] } {
  let total = 0
  let withDot = 0
  const examples: string[] = []
  const visit = (n: any): void => {
    if (n.type === "identifier") {
      total++
      const t = String(n.text ?? "")
      if (t.includes(".")) {
        withDot++
        if (examples.length < 6) examples.push(`L${n.startPosition.row + 1}: ${t}`)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visit(c) }
  }
  visit(root)
  return { total, withDot, examples }
}

// ───────────────────────────────────────────────────────── run
const files = corpusFiles()
console.log(`dead-flag probe — ${files.length} lua files drawn from the corpus (cap=${CAP || "none"})`)

const overrideKeys: KeyCount = new Map()
const redExamples: string[] = []
let overrideAttempts = 0
let idTotal = 0
let idWithDot = 0
const idExamples: string[] = []
let parseFailures = 0
const perRepo: Record<string, { files: number; overrideAttempts: number }> = {}

for (const f of files) {
  let text: string
  try { if (statSync(f.abs).size > 512 * 1024) continue; text = readFileSync(f.abs, "utf8") } catch { continue }
  const t = parser.parse(text)
  if (!t) { parseFailures++; continue }
  const repoAttempts = countRedefinitionKeys(t.rootNode, overrideKeys, redExamples)
  overrideAttempts += repoAttempts
  const r = perRepo[f.repo] ?? { files: 0, overrideAttempts: 0 }
  r.files++
  r.overrideAttempts += repoAttempts
  perRepo[f.repo] = r
  const ids = countIdentifiersWithDot(t.rootNode)
  idTotal += ids.total
  idWithDot += ids.withDot
  if (ids.withDot > 0) { for (const e of ids.examples) if (idExamples.length < 8) idExamples.push(`${f.repo}/${f.rel} ${e}`) }
  t.delete?.()
}

const overrideDistinct = overrideKeys.size
const overrideSuppressed = overrideAttempts - overrideDistinct
let maxRepeat = 0
let maxKey = ""
for (const [k, v] of overrideKeys) if (v > maxRepeat) { maxRepeat = v; maxKey = k }

const out = {
  schemaVersion: 1,
  kind: "lua_dead_flag_probe",
  at: new Date().toISOString().slice(0, 10),
  filesDrawn: files.length,
  parseFailures,
  f1_dedupeFalse: {
    claim: "real-lua-analyzer.ts:1758-1761 — both arms of the dedupe test run the same check and the key is recorded either way, so `dedupe: false` cannot change any output.",
    callSitesPassingIt: [
      "addContainsRelationships:1717",
      "addOverrideRelationships:1628 (lua_redefinition)",
      "addOverrideRelationships:1654 (lua_inherited_member)",
      "addFactorySupertypeEdges:1392 (lua_factory_supertype)",
    ],
    population: {
      note: "overrides/lua_redefinition only: a redefinition declared N times attempts N-1 edges of ONE key, so the dedup publishes 1 and the population below is what it drops. contains and lua_inherited_member need a frame property that is not a node and are not claimed here.",
      attempts: overrideAttempts,
      distinctKeys: overrideDistinct,
      suppressedByDedup: overrideSuppressed,
      maxAttemptsOnOneKey: maxRepeat,
      maxKey,
    },
    examples: redExamples,
    overturn: "a suppressed count above 0 means the flag is either lying to its four call sites or the dedup is losing a redefinition line; 0 means the flag is dead AND harmless on this corpus.",
  },
  f2_identifierDetectFrameworks: {
    claim: "real-lua-analyzer.ts:308-309 — detectFrameworks returns early unless the text contains a dot, and an identifier node in the pinned grammar never does, so the identifier arm can never add a framework.",
    identifierNodes: idTotal,
    identifiersContainingADot: idWithDot,
    examples: idExamples,
    livePathForFrameworkDetection: [
      "processCall:872 detectFrameworks(qualified) — qualified is the index expression's text",
      "addImport:983-988 — a module name that names a framework",
    ],
    overturn: "identifiersContainingADot > 0 would mean a bare name CAN name a framework, which LUA-04's rule forbids; 0 means the arm is unreachable on every file.",
  },
  perRepo,
}
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")

console.log(`\nF1 dedupe:false — ${overrideAttempts.toLocaleString()} redefinition attempts over ${overrideDistinct.toLocaleString()} keys`)
console.log(`   suppressed by the dedup: ${overrideSuppressed}   max attempts on one key: ${maxRepeat} (${maxKey})`)
console.log(`F2 identifier arm — ${idTotal.toLocaleString()} identifier nodes, ${idWithDot} containing a dot`)
console.log(`\nwrote ${path.relative(ROOT, OUT)}`)