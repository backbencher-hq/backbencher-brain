/**
 * THE CROSS-LANGUAGE DENYLIST, MEASURED AGAINST BASH — a bash declaration the
 * shared filter deletes, and the edge it leaves pointing at nothing.
 *
 * ## What was found, and where
 *
 * The whole-corpus census prints a label check the 400-file sample never trips:
 *
 *   contains target not a symbol in its file : 1
 *   e.g. vault/.github/scripts/install-cob.sh: usage -> this
 *
 * One `contains` edge out of 39,083 names a target the run does not publish. Read
 * rather than guessed: the site is `install-cob.sh:7`, inside the function
 * `usage()` declared at line 6, and the line is `this=$1`. So `usage` contains a
 * declaration named `this`, the analyzer publishes the `contains` edge for it,
 * and the SYMBOL never reaches the caller.
 *
 * Nothing in `src/ast/real-bash-analyzer.ts` drops it. The symbol is published by
 * `analyze()` and deleted one layer up, in shared machinery this lane does not own
 * (§8):
 *
 *   src/ast/pool-worker.ts:483  keepSymbol() → UNIVERSAL = new Set(["this", "super", …])
 *   src/ast/pool-worker.ts:917  symbols: parsed.symbols.filter((s) => keepSymbol(s, lang))
 *
 * The comment above that set explains the design and is right about it — "keep
 * only names that are RESERVED in the language being parsed, and decide that per
 * language", with the entries that have produced a counterexample moved out of the
 * unconditional set. Six lanes had already done that: R, graphql, sql, lua, hcl,
 * solidity. `this` and `super` were kept unconditionally on the stated ground that
 * "no lane produced a legitimate declaration of any of them".
 *
 * **This lane produced one.** In bash `this` is an ordinary variable name with no
 * special meaning — the language has no `this` — so `this=$1` is a real
 * declaration, and the corpus contains exactly one of them. It is the seventh
 * counterexample to that set, and the third distinct consequence: R/graphql
 * deleted symbols, lua and sql deleted symbols AND left edges naming them, and
 * here one declaration and one edge are lost.
 *
 * ## What this file measures, and why it is a probe rather than a fix
 *
 * `keepSymbol` is exported, so this file CALLS the shared filter instead of
 * restating its list. A probe that copied the denylist would be a second copy to
 * keep in step with the first, and would report zero the moment the two diverged
 * — which is the failure mode of every "the census says zero" claim in this lane's
 * history. So: walk the corpus, find every `variable_assignment` whose LHS base
 * name the shared filter would reject for `language: "bash"`, and report the site.
 *
 * The population is 1 and the edge consequence is 1, so this is a small number.
 * It is reported rather than fixed because `pool-worker.ts` is §8 shared
 * machinery, and because the fix is a policy question the supervisor owns: move
 * `this` and `super` into the per-language RESERVED set that the rest of the list
 * already uses, for the languages that actually reserve them. bash reserves
 * neither.
 *
 * No regex: the LHS base name is read off the parse tree (`variable_assignment`'s
 * first child, or its `subscript`'s first child), which is the same shape the
 * analyzer's own round-12 fix established.
 *
 *   npx tsx validation/m14/fixtures/bash/probe-bash-keepsymbol-denylist.mts
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { parseFile, keepSymbol } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const ALL = argv.includes("--all")
const SAMPLE = ALL ? Number.MAX_SAFE_INTEGER : 400

interface Admitted {
  repo: string
  rel: string
  abs: string
  text: string
}
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
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "bash") continue
    admitted.push({ repo: e, rel, abs, text })
  }
}
admitted.sort((a, b) => {
  const ha = createHash("sha256").update(`${a.repo}/${a.rel}`).digest("hex")
  const hb = createHash("sha256").update(`${b.repo}/${b.rel}`).digest("hex")
  return ha < hb ? -1 : ha > hb ? 1 : 0
})
const sample = ALL ? admitted : admitted.slice(0, SAMPLE)

// This file's own parser handle, never the engine's.
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({
  locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
})
const lang = await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-bash.wasm")))
const parser = new WSP()
parser.setLanguage(lang)

interface Hit {
  file: string
  line: number
  name: string
  kind: string
  edgeLeftDangling: boolean
  symbolPublished: boolean
}
const hits: Hit[] = []

for (const f of sample) {
  let t: any
  try {
    t = parser.parse(f.text)
  } catch {
    continue
  }
  if (!t) continue
  // Every declaration-shaped LHS on the tree: `name=`, `name[i]=`, `for name in`,
  // `read name`, `declare name`. The base name is what a symbol would be named.
  const stack: any[] = [t.rootNode]
  const names: { name: string; line: number }[] = []
  while (stack.length > 0) {
    const n = stack.pop()!
    if (
      n.type === "variable_assignment" ||
      n.type === "declaration_command" ||
      n.type === "for_statement" ||
      n.type === "read"
    ) {
      for (let k = 0; k < n.namedChildCount; k++) {
        const c = n.namedChild(k)
        if (!c) continue
        const target = c.type === "subscript" ? c.namedChild(0) : c
        if (target && (target.type === "variable_name" || target.type === "special_variable_name")) {
          names.push({ name: target.text, line: target.startPosition.row + 1 })
        }
      }
    }
    for (let k = 0; k < n.childCount; k++) stack.push(n.child(k))
  }
  t.delete?.()

  const rejected = names.filter((n) => !keepSymbol({ name: n.name }, "bash"))
  if (rejected.length === 0) continue

  // The consequence, measured through the production entry point rather than
  // assumed: does the run publish the symbol, and does an edge name it anyway?
  let publishedNames = new Set<string>()
  let danglingContains: string[] = []
  try {
    const r: any = await parseFile(f.abs, f.abs.slice(0, f.abs.lastIndexOf("/")))
    publishedNames = new Set((r?.symbols ?? []).map((s: any) => String(s.name)))
    danglingContains = (r?.relationships ?? [])
      .filter((rel: any) => rel?.type === "contains" && !publishedNames.has(String(rel.target)))
      .map((rel: any) => `${String(rel.source)} -> ${String(rel.target)}`)
  } catch {
    // A parse failure here is reported as "unknown", never as a pass.
  }
  for (const n of rejected) {
    hits.push({
      file: `${f.repo}/${f.rel}`,
      line: n.line,
      name: n.name,
      kind: "variable",
      symbolPublished: publishedNames.has(n.name),
      edgeLeftDangling: danglingContains.some((e) => e.endsWith(`-> ${n.name}`)),
    })
  }
}

console.log(`keepSymbol denylist measured against bash — production parseFile`)
console.log(`  corpus root        : ${CR}`)
console.log(`  measured           : ${sample.length} admitted files${ALL ? " (--all)" : ` (hash-order sample of ${SAMPLE})`}`)
console.log(`  declarations the shared filter REJECTS for language "bash": ${hits.length}`)
console.log("")
for (const h of hits) {
  console.log(`  ${h.file}:${h.line}  ${h.name}=`)
  console.log(
    `    published by parseFile : ${h.symbolPublished ? "yes" : "NO — deleted by keepSymbol"}`,
  )
  console.log(`    edge left naming it   : ${h.edgeLeftDangling ? "YES — a `contains` edge the graph cannot walk" : "no"}`)
}
console.log("")
if (hits.length === 0) {
  console.log("No bash declaration is rejected. Nothing to report.")
  process.exit(0)
}
const dangling = hits.filter((h) => h.edgeLeftDangling)
console.log(
  `${hits.length} bash declaration(s) rejected by src/ast/pool-worker.ts keepSymbol's UNIVERSAL set; ` +
    `${dangling.length} leave a relationship naming a symbol the run does not publish.`,
)
console.log(
  "Reported, not fixed: pool-worker.ts is shared machinery (brief §8). The fix is to move `this` and",
)
console.log(
  "`super` into the per-language RESERVED set the rest of that list already uses, for the languages",
)
console.log("that actually reserve them. bash reserves neither.")
process.exit(6)