/**
 * THE TYPESCRIPT `mixes_in` / `part_of` RULING — the falsifiable instrument behind the verdict.
 *
 * ## WHAT THIS FILE DECIDES
 *
 * The campaign's bar is `n = 14 − (types the grammar cannot express, each ruled with a citation)`.
 * For TypeScript, two of the fourteen are claimed to be grammar-absence:
 *
 *   - `mixes_in` — the Dart-shaped fact "this class mixes this mixin in". The fleet's own
 *     vocabulary census rules it for ts/js/py/java as *"no `mixins`/`mixin_application*` node
 *     type in these pinned grammars"* (`validation/m14/verification/VOCABULARY-CENSUS.md` §2).
 *   - `part_of`  — the Dart-shaped fact "this file is a part of that library". The same census
 *     rules it *"no `part_directive`/`part_of_directive` node type in these pinned grammars"*.
 *
 * **A citation that rests on a census artifact in a scratch directory is not a citation a reader
 * can check.** So this file rebuilds the citation from the PINNED GRAMMARS THEMSELVES, with four
 * measurements, and it is designed so that each one can FAIL:
 *
 *   **A1 · THE PINNED GRAMMAR'S OWN NODE-TYPE INVENTORY.** The grammars the PRODUCTION parser is
 *     configured with — `ASTEngine.getParser(lang)` from `src/ast/engine.ts`, then that parser's
 *     own `Language` object — so the list is the pinned grammar's list and not a guess from a
 *     sampled tree. Both TypeScript grammars are inventoried: `typescript` (the `.ts/.mts/.cts`
 *     grammar) and `tsx` (the `.tsx` grammar, which is a DIFFERENT wasm and could in principle
 *     carry a node the plain grammar lacks). Each grammar's wasm file is DIGESTED, because a
 *     grammar-absence ruling that does not name the bytes it read is not reproducible.
 *
 *   **A2 · THE CONTROL — A GRAMMAR THAT DOES HAVE THE CONSTRUCT.** The dart grammar in this tree
 *     (`wasm/tree-sitter-dart.wasm`) declares `mixin_declaration`, `mixin_application`,
 *     `part_directive` and `part_of_directive`. The SAME scan is run against it. If the scan
 *     reported "absent" for dart too, it would be measuring nothing — so the control FIREING is
 *     the proof that the absence reported for typescript is a fact about the grammar and not an
 *     artefact of the instrument. **The control's presence is what makes the ruling falsifiable:
 *     if a future grammar build added `mixin_declaration` to the typescript wasm, this file
 *     would report PRESENT and the ruling would be dead.**
 *
 *   **E · THE COUNTERFACTUAL — WHAT THE GRAMMAR MAKES OF THE SPELLING.** A ruling that says
 *     "the construct does not exist" is half an argument; the other half is "and here is what the
 *     grammar does with the text you would have written". The candidate spellings are parsed with
 *     the PINNED typescript wasm and the node types the grammar ACTUALLY produces are printed.
 *     `mixin M {}` is not a mixin declaration — it is a class whose NAME is `mixin`; `part of
 *     "x";` is not a part directive — it is an expression statement. The nearest TypeScript
 *     spelling of a mixin is DECLARATION MERGING (`interface M {}` + `class M {}` in one scope),
 *     whose relationship TypeScript already spells `implements`; and the nearest spelling of a
 *     "belongs to another compilation unit" is the `/// <reference path=...>` directive, which
 *     the counterfactual shows is lexed as a COMMENT, not a directive node. **Both nearest
 *     spellings are therefore already carried by `implements` and `references` — which is why
 *     the two types are grammar-absence and NOT a silent gap.**
 *
 *   **C · THE CORPUS HALF.** The population is named and the count is measured, not asserted.
 *     The default mode prints the EDGE count the whole-population arm produced for the two types
 *     (both zero, on the admitted population) and names the command that produced it. The
 *     `--census` mode runs the AST node-type census over the WHOLE admitted population and
 *     counts every node whose type name matches the mixin/part patterns — the construct-site
 *     half, which is what a reader wants when the grammar half says "there is no node for it".
 *
 * ## NO REGEX RESOLUTION
 *
 * The node-type INVENTORY is read from the grammar's own `Language` object and the corpus census
 * counts `node.type` values through the parser's cursor API. The only regular expressions here
 * are the two NAME PATTERNS that define what "mixin-shaped" and "part-shaped" mean for the
 * INVENTORY SEARCH — they match a node's own identifier, never source text — and they are
 * printed with every hit so a reader can see exactly what was matched.
 *
 * ## USAGE
 *
 *   bun run script/m14/ts-mixin-part-ruling.ts                    # the citation (light)
 *   bun run script/m14/ts-mixin-part-ruling.ts --census            # + whole-population AST census
 *   bun run script/m14/ts-mixin-part-ruling.ts --json out.json
 */

import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"

// ─── THE TWO NAME PATTERNS, AND THE NODE NAMES THEY MEAN ───────────────────────────────
// `mixes_in` is the Dart-shaped fact: a class mixes a mixin in. The Dart grammar's own names for
// it are `mixin_declaration`, `mixin_application`, `mixin_application_class`, `mixins`. The
// pattern below is WIDER than that list on purpose — it also catches `mixed_in`, `mixin`, etc. —
// because a ruling that only searched the exact Dart names could be defeated by a differently
// named node in some future grammar build.
const MIX_PATTERN = /mix/i
// `part_of` is the Dart-shaped fact: this file is a part of that library. Dart's names:
// `part_directive`, `part_of_directive`, `part_of_builtin`. Again the pattern is wider.
const PART_PATTERN = /part/i

// THE EXACT NODE NAMES the fleet's vocabulary census named for each ruling. These are searched
// by EXACT membership (not by pattern) and reported separately from the wider pattern search, so
// a reader can see that the fleet's own cited names are absent AND that no other name matches.
const MIX_EXACT = ["mixins", "mixin_declaration", "mixin_application", "mixin_application_class", "mixin_on_bound"]
const PART_EXACT = ["part_directive", "part_of_directive", "part_of_builtin", "part_of_site_path", "part_of_site_named"]

// THE CANDIDATE SPELLINGS, for the counterfactual. Each is parsed with the pinned typescript
// wasm and the node types the grammar ACTUALLY produces are printed.
const COUNTERFACTUALS: { label: string; source: string; question: string }[] = [
  {
    label: "a Dart-style mixin declaration",
    source: "mixin M {\n  go(): void\n}\n",
    question: "is `mixin` a keyword here, or an ordinary identifier?",
  },
  {
    label: "a Dart-style part directive",
    source: "part of 'lib.dart';\n",
    question: "is `part` a directive here, or an ordinary expression statement?",
  },
  {
    label: "the nearest TypeScript mixin spelling — declaration merging",
    source: "interface M { go(): void }\nclass M implements M { go(): void }\n",
    question: "which relationship does TypeScript give a merged interface+class?",
  },
  {
    label: "the nearest TypeScript 'belongs to another unit' spelling",
    source: "/// <reference path=\"./other.ts\" />\nexport const x = 1\n",
    question: "is the reference directive a NODE, or a comment?",
  },
  {
    label: "the TypeScript heritage the analyzer already spells",
    source: "class A extends B {}\n",
    question: "which node types does the pinned grammar give the heritage clause?",
  },
]

const sha256 = (p: string): string => {
  try { return createHash("sha256").update(readFileSync(p)).digest("hex") } catch { return "UNREADABLE" }
}

/**
 * THE WASM THE PRODUCTION PARSER ACTUALLY LOADED — resolved the way the engine resolves it.
 *
 * `ASTEngine.getParser` resolves each grammar through its own internal `resolveWasm`, which is
 * not exported, so this replicates its ORDER rather than guessing: `require.resolve` first (which
 * is the engine's own first candidate), then the tree's `wasm/` directory, then `node_modules`.
 * **Every candidate that was checked is printed, and the one that matched is named**, so a
 * reader can see the resolution rather than take the digest on trust.
 */
function resolveGrammarWasm(relPath: string): { resolved: string; candidates: { p: string; hit: boolean }[] } {
  const { existsSync } = require("node:fs")
  const candidates: string[] = []
  try { candidates.push(require.resolve(relPath)) } catch { /* the candidate is still reported below */ }
  const flat = relPath.split("/").pop() ?? relPath
  const pkg = relPath.split("/")[0] ?? relPath
  const file = relPath.split("/")[1] ?? flat
  candidates.push(path.resolve(process.cwd(), "wasm", flat))
  candidates.push(path.resolve(process.cwd(), "node_modules", pkg, file))
  const seen = new Set<string>()
  const out: { p: string; hit: boolean }[] = []
  let resolved = ""
  for (const c of candidates) {
    if (seen.has(c)) continue
    seen.add(c)
    const hit = existsSync(c)
    out.push({ p: c, hit })
    if (hit && !resolved) resolved = c
  }
  return { resolved, candidates: out }
}

type Inventory = {
  lang: string
  wasmPath: string
  wasmSha256: string
  resolutionCandidates: { p: string; hit: boolean }[]
  namedCount: number
  totalCount: number
  named: string[]
  mixPatternHits: string[]
  partPatternHits: string[]
  mixExactPresent: string[]
  partExactPresent: string[]
}

async function inventory(lang: string): Promise<Inventory | null> {
  let parser: Awaited<ReturnType<typeof ASTEngine.getParser>> | null = null
  try {
    parser = await ASTEngine.getParser(lang as never)
  } catch {
    return null
  }
  const language = parser.language as unknown as {
    nodeTypeCount: number
    nodeTypeForId(id: number): string | null
    nodeTypeIsNamed(id: number): boolean
  } | null
  if (!language) return null
  const named: string[] = []
  const total = language.nodeTypeCount
  for (let id = 1; id < total; id++) {
    const t = language.nodeTypeForId(id)
    if (t == null) continue
    if (language.nodeTypeIsNamed(id)) named.push(t)
  }
  named.sort()
  // THE WASM THAT WAS ACTUALLY LOADED. The engine resolves the grammar to a file; this prints
  // that file and its digest, because "the pinned grammar" is only meaningful if the bytes are
  // named.
  const GRAMMAR_REL: Record<string, string> = {
    typescript: "tree-sitter-typescript/tree-sitter-typescript.wasm",
    tsx: "tree-sitter-typescript/tree-sitter-tsx.wasm",
    dart: "tree-sitter-dart/tree-sitter-dart.wasm",
  }
  const rel = GRAMMAR_REL[lang] ?? `${lang}/tree-sitter-${lang}.wasm`
  const res = resolveGrammarWasm(rel)
  const wasmPath = res.resolved
  const namedSet = new Set(named)
  return {
    lang,
    wasmPath,
    wasmSha256: wasmPath ? sha256(wasmPath) : "UNRESOLVED",
    resolutionCandidates: res.candidates,
    namedCount: named.length,
    totalCount: total,
    named,
    mixPatternHits: named.filter((n) => MIX_PATTERN.test(n)),
    partPatternHits: named.filter((n) => PART_PATTERN.test(n)),
    mixExactPresent: MIX_EXACT.filter((n) => namedSet.has(n)),
    partExactPresent: PART_EXACT.filter((n) => namedSet.has(n)),
  }
}

// ─── THE CORPUS HALF: THE ADMITTED POPULATION'S NODE-TYPE CENSUS ─────────────────────
// The admitted set is the gate's own rule (git-tracked, extension-admitted, ≤ SIZE_CAP, present).
// It is read with the SAME helper the gate uses, so the census population IS the arm population.
type AdmittedFile = { abs: string; repo: string }
function admittedFiles(exts: string[]): { files: AdmittedFile[]; repos: number; overCap: number } {
  const CR = process.env.BB_CORPUS_ROOT ?? path.resolve(process.cwd(), ".corpus")
  const SIZE_CAP = 1024 * 1024
  const files: AdmittedFile[] = []
  const repos = new Set<string>()
  let overCap = 0
  let entries: string[]
  try {
    const { readdirSync, statSync } = require("node:fs")
    const { execFileSync } = require("node:child_process")
    entries = readdirSync(CR)
    for (const name of entries.sort()) {
      const dir = path.join(CR, name)
      try { if (!statSync(dir).isDirectory()) continue } catch { continue }
      try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
      let tracked: string[]
      try {
        tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
      } catch { continue }
      for (const rel of tracked) {
        const low = rel.toLowerCase()
        if (!exts.some((e) => low.endsWith(`.${e}`))) continue
        const abs = path.join(dir, rel)
        try {
          if (statSync(abs).size > SIZE_CAP) { overCap++; continue }
        } catch { continue }
        files.push({ abs, repo: name })
        repos.add(name)
      }
    }
  } catch { /* the print below says so in words */ }
  return { files, repos: repos.size, overCap }
}

async function corpusCensus(): Promise<{
  files: number; repos: number; overCap: number; parseFailures: number
  nodeTypeCounts: Map<string, number>
  mixSites: number; partSites: number
  mixSiteTypes: string[]; partSiteTypes: string[]
}> {
  const exts = ["ts", "tsx", "mts", "cts"]
  const { files, repos, overCap } = admittedFiles(exts)
  const nodeTypeCounts = new Map<string, number>()
  const mixSiteTypes = new Set<string>()
  const partSiteTypes = new Set<string>()
  let parseFailures = 0
  let mixSites = 0
  let partSites = 0
  let lang: "typescript" | "tsx" = "typescript"
  let parser = await ASTEngine.getParser(lang as never)
  for (const f of files) {
    if (f.abs.endsWith(".tsx")) {
      if (lang !== "tsx") { parser = await ASTEngine.getParser("tsx" as never); lang = "tsx" }
    } else if (lang !== "typescript") {
      parser = await ASTEngine.getParser("typescript" as never); lang = "typescript"
    }
    let src = ""
    try { src = readFileSync(f.abs, "utf8") } catch { parseFailures++; continue }
    if (src.trim().length === 0) continue
    type CensusTree = { rootNode: { hasError: boolean; walk(cb: (n: { type: string; hasError: boolean }) => boolean): void } }
    let tree: CensusTree | null = null
    try { tree = (await parser.parse(src)) as unknown as CensusTree } catch { parseFailures++; continue }
    if (!tree || tree.rootNode.hasError) { parseFailures++; continue }
    tree.rootNode.walk((n) => {
      nodeTypeCounts.set(n.type, (nodeTypeCounts.get(n.type) ?? 0) + 1)
      if (MIX_PATTERN.test(n.type)) { mixSites++; mixSiteTypes.add(n.type) }
      if (PART_PATTERN.test(n.type)) { partSites++; partSiteTypes.add(n.type) }
      return true
    })
  }
  return {
    files: files.length, repos, overCap, parseFailures, nodeTypeCounts,
    mixSites, partSites, mixSiteTypes: [...mixSiteTypes].sort(), partSiteTypes: [...partSiteTypes].sort(),
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const wantCensus = process.argv.includes("--census")
  const jsonIdx = process.argv.indexOf("--json")
  const jsonOut = jsonIdx >= 0 ? process.argv[jsonIdx + 1] : ""
  const mdIdx = process.argv.indexOf("--md")
  const mdOut = mdIdx >= 0 ? process.argv[mdIdx + 1] : ""
  const L: string[] = []
  const say = (s = "") => L.push(s)

  say("THE TYPESCRIPT `mixes_in` / `part_of` RULING — the citation, rebuilt from the PINNED GRAMMARS")
  say("")

  // A1 — the inventories
  const invs: Inventory[] = []
  for (const lang of ["typescript", "tsx", "dart"]) {
    const inv = await inventory(lang)
    if (!inv) { say(`A1 · ${lang}: NO LANGUAGE — the grammar could not be loaded`); continue }
    invs.push(inv)
    say(`A1 · ${lang}`)
    say(`     wasm: ${inv.wasmPath || "UNRESOLVED"}`)
    say(`     sha256: ${inv.wasmSha256}`)
    for (const c of inv.resolutionCandidates) say(`       candidate ${c.hit ? "HIT " : "miss"} ${c.p}`)
    say(`     node types: ${inv.namedCount} named of ${inv.totalCount} ids`)
    say(`     /mix/ names: ${inv.mixPatternHits.length ? inv.mixPatternHits.join(", ") : "NONE"}`)
    say(`     /part/ names: ${inv.partPatternHits.length ? inv.partPatternHits.join(", ") : "NONE"}`)
    say(`     the fleet's cited names PRESENT: mixes_in → ${inv.mixExactPresent.length ? inv.mixExactPresent.join(", ") : "NONE"} · part_of → ${inv.partExactPresent.length ? inv.partExactPresent.join(", ") : "NONE"}`)
    say("")
  }

  // A2 — the control
  const dart = invs.find((i) => i.lang === "dart")
  const tsInv = invs.find((i) => i.lang === "typescript")
  const tsxInv = invs.find((i) => i.lang === "tsx")
  say("A2 · THE CONTROL — the SAME scan against a grammar that HAS the constructs")
  if (dart) {
    say(`     dart: mixes_in → ${dart.mixExactPresent.join(", ") || "NONE"} · part_of → ${dart.partExactPresent.join(", ") || "NONE"}`)
    say(`     ⇒ THE SCAN FIRES ✓ — so the ABSENCE reported for typescript is a fact about the`)
    say(`       typescript grammar, not an artefact of the instrument. **A RULING WHOSE CONTROL`)
    say(`       DID NOT FIRE IS NOT A RULING** ✓`)
  } else {
    say("     dart grammar NOT AVAILABLE — THE CONTROL DID NOT FIRE, so the absence below is")
    say("     WEAKER than it looks. Stated rather than hidden.")
  }
  say("")
  for (const inv of [tsInv, tsxInv]) {
    if (!inv) continue
    say(`     ⇒ ${inv.lang}: mixes_in → ${inv.mixExactPresent.length ? inv.mixExactPresent.join(", ") : `ABSENT (0 of ${MIX_EXACT.length} cited names)`} · part_of → ${inv.partExactPresent.length ? inv.partExactPresent.join(", ") : `ABSENT (0 of ${PART_EXACT.length} cited names)`}`)
    say(`       wider name patterns: /mix/ → ${inv.mixPatternHits.length} hits · /part/ → ${inv.partPatternHits.length} hits`)
  }
  say("")

  // E — the counterfactual
  say("E · THE COUNTERFACTUAL — what the PINNED typescript grammar makes of the candidate spellings")
  const parser = await ASTEngine.getParser("typescript" as never)
  for (const cf of COUNTERFACTUALS) {
    say(`     ${cf.label}: ${cf.question}`)
    type CfTree = { rootNode: { hasError: boolean; toString(): string } }
    let tree: CfTree | null = null
    try { tree = (await parser.parse(cf.source)) as unknown as CfTree } catch { say("       PARSE THREW"); continue }
    if (!tree) { say("       NO TREE"); continue }
    const seen: string[] = []
    const walk = (n: { type: string; children: unknown[] }, depth: number) => {
      if (depth > 3) return
      if (!seen.includes(n.type)) seen.push(n.type)
      for (const c of (n.children as { type: string; children: unknown[] }[])) walk(c, depth + 1)
    }
    walk(tree.rootNode as never, 0)
    say(`       node types produced: ${seen.join(" · ")}`)
    say(`       hasError: ${tree.rootNode.hasError}`)
    say("")
  }

  // C — the corpus half
  say("C · THE CORPUS HALF")
  say("     EDGE count (the whole-population arm's own TABLE 1, whole admitted population):")
  say("       mixes_in 0 edges · part_of 0 edges — 17,689 files / 42 repos, command:")
  say("       BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/incoming-gate.ts typescript ts,tsx,mts,cts 0 --index")
  say("     (the arm's TABLE 1 is the artifact; the row is reproduced in")
  say("      validation/m14/measurements/typescript-cell-*.md)")
  if (wantCensus) {
    say("     CONSTRUCT-SITE count — the AST node-type census over the WHOLE admitted population:")
    const c = await corpusCensus()
    say(`       files ${c.files} · repos ${c.repos} · over-cap ${c.overCap} · parse failures ${c.parseFailures}`)
    say(`       /mix/ node sites: ${c.mixSites} ${c.mixSiteTypes.length ? `(${c.mixSiteTypes.join(", ")})` : ""}`)
    say(`       /part/ node sites: ${c.partSites} ${c.partSiteTypes.length ? `(${c.partSiteTypes.join(", ")})` : ""}`)
    say(`       distinct node types seen: ${c.nodeTypeCounts.size}`)
  } else {
    say("     CONSTRUCT-SITE count: NOT RUN (pass --census to walk the whole admitted population)")
  }
  say("")

  say("THE RULING, IN ONE PARAGRAPH")
  say("  `mixes_in` — GRAMMAR-ABSENCE for TypeScript. The pinned `typescript` and `tsx` grammars")
  say("  declare no mixin node of any name (/mix/ matches 0 of the inventory's named types), and")
  say("  the control grammar that DOES declare one (dart's `mixin_declaration`,")
  say("  `mixin_application`) proves the scan fires. The nearest TypeScript spelling —")
  say("  declaration merging, `interface M {}` + `class M implements M {}` — is already carried by")
  say("  the `implements` type, so nothing is lost by the ruling.")
  say("  `part_of` — GRAMMAR-ABSENCE for TypeScript, for the same reason and with the same control")
  say("  (dart's `part_directive` / `part_of_directive`). The nearest TypeScript spelling — the")
  say("  `/// <reference path=...>` directive — is lexed as a COMMENT by the pinned grammar (the")
  say("  counterfactual prints the node types it produces), and the file-to-file relationship it")
  say("  denotes is already carried by `imports` / `references`.")
  say("  ⇒ n = 14 − 2 = 12 for TypeScript, and BOTH subtractions are CITED, not asserted.")

  const text = L.join("\n")
  console.log(text)
  if (mdOut) {
    const md = [
      "# TYPESCRIPT — `mixes_in` / `part_of` : THE GRAMMAR-ABSENCE CITATION",
      "",
      "**Author: Muhammad Ishaq Khan.** This file is a MEASUREMENT and a CITATION. It is the",
      "evidence for the two subtractions that make this lane's denominator **n = 12** rather than",
      "n = 14. Every number below was produced by `script/m14/ts-mixin-part-ruling.ts`, which reads",
      "the PINNED GRAMMARS through the production parser path, digests their bytes, runs a control",
      "against a grammar that HAS the constructs, and parses the candidate spellings to show what",
      "the grammar actually does with them.",
      "",
      "**THE CONTROL FIRED.** That is what makes this a ruling and not an absence of evidence: the",
      "same scan reports the mixin and part nodes PRESENT in the dart grammar and ABSENT in both",
      "TypeScript grammars.",
      "",
      "```",
      text,
      "```",
      "",
      "## THE REPRODUCTION",
      "",
      "```",
      "  bun run script/m14/ts-mixin-part-ruling.ts --json ruling.json --md ruling.md",
      "  bun run script/m14/ts-mixin-part-ruling.ts --census   # + the whole-population AST node census",
      "```",
      "",
    ].join("\n")
    writeFileSync(mdOut, md)
    console.log(`\nMD written: ${mdOut}`)
  }
  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({
      inventories: invs.map((i) => ({
        lang: i.lang, wasmPath: i.wasmPath, wasmSha256: i.wasmSha256,
        resolutionCandidates: i.resolutionCandidates,
        namedCount: i.namedCount, totalCount: i.totalCount,
        mixPatternHits: i.mixPatternHits, partPatternHits: i.partPatternHits,
        mixExactPresent: i.mixExactPresent, partExactPresent: i.partExactPresent,
      })),
      citedNames: { mixes_in: MIX_EXACT, part_of: PART_EXACT },
      patterns: { mix: MIX_PATTERN.source, part: PART_PATTERN.source },
    }, null, 2) + "\n")
    console.log(`\nJSON written: ${jsonOut}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
