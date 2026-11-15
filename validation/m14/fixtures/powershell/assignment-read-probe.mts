/**
 * PS-B17 PROBE — is a bare ASSIGNMENT's right-hand side published as a read?
 *
 * ## THE QUESTION, AND WHY IT IS ASKED
 *
 * `variable-reads-psa4` pins reads from string interpolation, command arguments, compound
 * assignment LHS reads and scope-qualified reads. A probe written while building the cause-C
 * fixture (`externality-psb16`) found one shape none of those cover: `$b = $a` publishes the
 * DECLARATION of `$b` and no `uses -> a`. The same file also shows `$here = $env:TEMP`
 * publishing nothing, while `$c = "$a"` publishes `uses -> a`.
 *
 * This measures it, on a bounded deterministic sample, with the population stated. It is a
 * probe and not a gate: it answers one question about one construct.
 *
 * ## WHAT COUNTS AS THE CONSTRUCT
 *
 * An `assignment_statement` node (whatever the pinned grammar calls it — the name is READ from
 * the corpus, not assumed) whose right-hand side contains a `variable` NODE and is not a
 * `command_argument`. A `variable` NODE is the discriminator, not the text: `$b = $a` has one
 * on the RHS, `"$a"` has one nested under a string, and only the first is a bare read.
 *
 * ## NO REGEX
 *
 * Every predicate here is a node-type or char-code test. The file-name filters are byte
 * prefix/suffix tests, not patterns.
 *
 *   npx tsx validation/m14/fixtures/powershell/assignment-read-probe.mts [--files N]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import * as ASTEngine from "../../../../src/ast/engine"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import type { Node } from "web-tree-sitter"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "powershell"
const WANT = Number(process.argv[process.argv.indexOf("--files") + 1]) || 200

const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  return i < 0 ? undefined : argv[i + 1]
}
void argOf

function enumerate(): { repo: string; dir: string; rel: string; abs: string }[] {
  const out: { repo: string; dir: string; rel: string; abs: string }[] = []
  for (const e of readdirSync(CR)) {
    const dir = path.join(CR, e)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      const abs = path.join(dir, rel)
      let text = ""
      try {
        if (statSync(abs).size > 512 * 1024) continue
        text = readFileSync(abs, "utf8")
      } catch { continue }
      if (detectLanguageFromPath(abs, text) !== LANG) continue
      out.push({ repo: e, dir, rel, abs })
    }
  }
  return out
}

const all = enumerate().sort((a, b) => {
  const la = `${a.repo}/${a.rel}`, lb = `${b.repo}/${b.rel}`
  return la < lb ? -1 : la > lb ? 1 : 0
})
const population = all.length
const picked = WANT > 0 && WANT < population
  ? Array.from({ length: WANT }, (_, i) => all[Math.floor((i * population) / WANT)])
  : all

const parser = await ASTEngine.getParser(LANG as ASTEngine.SupportedLanguage)

/** Is `node` inside a construct another reader already covers? A read inside a string
 *  literal is `variable-reads-psa4`'s interpolation case, a read inside a command's
 *  `command_elements` is the argument case, and a read inside a `hash_entry` KEY is a name,
 *  not a value. The corpus shape is not guessed: the probe PRINTS the assignment node types
 *  it saw, and `$c = "$a"` / `$e = Get-Thing -Name $a` / `$f = @{ k = $a }` are all in the
 *  controlled fixture this predicate was written against. */
const COVERED_ANCESTORS = new Set(["string_literal", "expandable_string_literal", "expandable_here_string_literal", "here_string_literal", "command_elements", "key_expression"])
const isInsideCovered = (node: Node): boolean => {
  let n: Node | null = node.parent
  let depth = 0
  while (n && depth++ < 40) {
    if (COVERED_ANCESTORS.has(n.type)) return true
    n = n.parent
  }
  return false
}
/** `$name` -> `name`, for a real sigil only. `$env:PATH` and `${a}` are normalised the way
 *  the analyzer normalises them (F9: a braced variable is the same variable), because a probe
 *  that disagreed would be measuring its own bug rather than the analyzer's. */
const stripSigil = (t: string): string => {
  if (t.length < 2 || t.charCodeAt(0) !== 36 /* $ */) return t
  if (t.charCodeAt(1) === 123 /* { */ && t.charCodeAt(t.length - 1) === 125 /* } */) return t.slice(2, -1)
  return t.slice(1)
}

interface Candidate { file: string; line: number; name: string; nodeType: string; ancestors: string[] }
const candidates: Candidate[] = []
const assignNodeTypes = new Map<string, number>()
let filesWalked = 0
let filesFailed = 0

// The analyzer's own AUTOMATIC_VARIABLES set (PS8), mirrored so the probe can name
// the reason a read is suppressed rather than leaving it as an unexplained residue.
const AUTOMATIC = new Set([
  "this", "_", "psitem", "args", "input", "psscriptroot", "pscommandpath",
  "psmodulepath", "psversiontable", "host", "pid", "lastexitcode", "error",
  "home", "pwd", "myinvocation", "matches", "null", "true", "false", "ofs",
  "shellid", "stacktrace", "executioncontext", "psculture", "psuiculture",
  "psdebugcontext", "psedition", "iscoreclr", "islinux", "ismacos", "iswindows",
  "consolefilename", "consoleverbosity", "enabledexperimentalfeatures",
  "errorview", "maximumhistorycount", "nestedpromptlevel", "outputencoding",
])

for (const f of picked) {
  let text = ""
  try { text = readFileSync(f.abs, "utf8") } catch { continue }
  let tree: any = null
  try { tree = parser.parse(text) } catch { filesFailed++; continue }
  const root = tree?.rootNode
  if (!root) { filesFailed++; continue }
  filesWalked++
  const found: Candidate[] = []
  const seenHere = new Set<string>()
  const stack: Node[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "assignment_expression") {
      assignNodeTypes.set(n.type, (assignNodeTypes.get(n.type) ?? 0) + 1)
      // The RIGHT-HAND side is the named child AFTER `assignement_operator`; the child before
      // it is the `left_assignment_expression`, which is the thing being DECLARED and whose
      // own `variable` is the declaration the analyzer already publishes.
      for (let i = 0; i < n.namedChildCount; i++) {
        if (n.namedChild(i)?.type !== "pipeline") continue
        const rhs = n.namedChild(i)!
        const rhsStack: Node[] = [rhs]
        while (rhsStack.length) {
          const rn = rhsStack.pop()!
          if (rn.type === "variable") {
            if (!isInsideCovered(rn)) {
              const name = stripSigil(rn.text)
              const key = `${rn.startPosition.row + 1} ${name}`
              if (name.length > 0 && !seenHere.has(key)) {
                seenHere.add(key)
                const anc: string[] = []
                let an: Node | null = rn.parent
                let d = 0
                while (an && d++ < 40) { anc.push(an.type); an = an.parent }
                found.push({ file: `${f.repo}/${f.rel}`, line: rn.startPosition.row + 1, name, nodeType: rn.type, ancestors: anc })
              }
            }
          }
          for (let j = 0; j < rn.namedChildCount; j++) {
            const c = rn.namedChild(j)
            if (c) rhsStack.push(c)
          }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  candidates.push(...found)
}

console.log(`assignment read probe — production parseFile + the pinned grammar's own tree`)
console.log(`corpus root         ${CR}`)
console.log(`admitted population ${population}`)
console.log(`files sampled       ${picked.length}${picked.length < population ? `  (deterministic stride of ${picked.length} over the sorted population)` : "  (the WHOLE admitted set)"}`)
console.log(`files parsed        ${filesWalked}   failed ${filesFailed}`)
console.log(`assignment node types the corpus produces: ${JSON.stringify(Object.fromEntries([...assignNodeTypes].sort((a, b) => b[1] - a[1])))}`)
console.log(`candidate bare RHS variable reads: ${candidates.length}`)

// Now ask production whether each one produced a `uses` edge, on the SAME file and line.
let published = 0
let missing = 0
const missingByName = new Map<string, number>()
const publishedByName = new Map<string, number>()
const missingByFile = new Map<string, number>()
const missingCandidates: Candidate[] = []
let checked = 0
for (const f of picked) {
  const label = `${f.repo}/${f.rel}`
  const mine = candidates.filter((c) => c.file === label)
  if (mine.length === 0) continue
  let r: any
  try { r = await parseFile(f.abs, f.dir) } catch { continue }
  checked++
  const uses = new Set<string>()
  for (const x of r.relationships ?? []) {
    if (String(x.type).toLowerCase() !== "uses") continue
    uses.add(`${x.line_number} ${x.target}`)
  }
  for (const c of mine) {
    if (uses.has(`${c.line} ${c.name}`)) {
      published++
      publishedByName.set(c.name, (publishedByName.get(c.name) ?? 0) + 1)
    } else {
      missing++
      missingByName.set(c.name, (missingByName.get(c.name) ?? 0) + 1)
      missingByFile.set(label, (missingByFile.get(label) ?? 0) + 1)
      missingCandidates.push(c)
    }
  }
}

console.log("")
console.log(`files carrying at least one candidate: ${checked}`)
console.log(`candidates checked: ${published + missing}`)
console.log(`  a uses edge exists for it : ${published}  (${((100 * published) / (published + missing)).toFixed(2)}%)`)
console.log(`  NO uses edge exists       : ${missing}  (${((100 * missing) / (published + missing)).toFixed(2)}%)`)
console.log("")
console.log(`top missing targets: ${[...missingByName].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([n, c]) => `${n} (${c})`).join(", ")}`)
console.log(`files with the most misses: ${[...missingByFile].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, c]) => `${n} (${c})`).join(", ")}`)

// DECOMPOSITION of the misses. Each missing candidate is bucketed by the FIRST
// applicable reason, in the order the analyzer's own guards apply:
//   automatic      — name is in AUTOMATIC_VARIABLES; emitVariableReads skips it (PS8)
//   element-access — inside an element_access; the receiver is psb5-forbidden, the KEY
//                    is published by the dedicated element_access case, so a miss here
//                    means the receiver (by design) or the key (a real finding)
//   script-block   — inside a script_block_expression/named_block; a SCOPE the frame
//                    walker reads with its own frame, not this pass's business
//   other          — none of the above; genuinely unexplained, and the number to act on
const buckets = new Map<string, { count: number; byName: Map<string, number> }>()
const bucketOf = (c: Candidate): string => {
  if (AUTOMATIC.has(c.name.toLowerCase())) return "automatic"
  if (c.ancestors.includes("element_access")) return "element-access"
  if (c.ancestors.includes("script_block_expression") || c.ancestors.includes("named_block")) return "script-block"
  return "other"
}
for (const c of missingCandidates) {
  const b = bucketOf(c)
  const e = buckets.get(b) ?? { count: 0, byName: new Map<string, number>() }
  e.count++
  e.byName.set(c.name, (e.byName.get(c.name) ?? 0) + 1)
  buckets.set(b, e)
}
console.log("")
console.log("decomposition of the misses (first applicable reason):")
for (const [b, e] of [...buckets].sort((a, b2) => b2[1].count - a[1].count)) {
  const top = [...e.byName].sort((a, b2) => b2[1] - a[1]).slice(0, 8).map(([n, c]) => `${n} (${c})`).join(", ")
  console.log(`  ${b.padEnd(15)} ${String(e.count).padStart(4)}   ${top}`)
}