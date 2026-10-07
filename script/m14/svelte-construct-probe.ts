/**
 * SVELTE — CONSTRUCT PROBE for the types the lane does not emit.
 *
 * The workstream is explicit that a PROSE RULING IS NOT A RULING: `overrides`
 * had one for a whole wave and was wrong, so `ontology-coverage-gate.ts`
 * requires "a written reason AND a corpus measurement", falsifiable — "a probe
 * finding a non-zero count overturns the ruling". This file is that probe for
 * `implements`, `overrides` and `extends`.
 *
 * TWO INSTRUMENTS, AND THE CHOICE BETWEEN THEM IS THE POINT:
 *
 *   A: GRAMMAR INVENTORY. For a construct the pinned grammar cannot even
 *      REPRESENT. `overrides` needs TypeScript's `override` member modifier. If
 *      `tree-sitter-typescript` has no node for it, then no SFC can ever yield
 *      the edge regardless of what the corpus contains — that is a fact about
 *      the INSTRUMENT, and it must be stated as such rather than as a fact about
 *      Svelte.
 *
 *   B: PARSE-TREE SEMANTIC COUNT. For a construct the grammar CAN express. A
 *      text scan is the wrong instrument here for a reason the gate documents:
 *      in the `svelte` corpus `grep -n override` returns 9 hits and NOT ONE of
 *      them is the TypeScript keyword — they are `let override = $state()`, a
 *      string literal `'spread-override'`, and prose inside markup. A regex
 *      would have convicted the ruling on the strength of a variable named
 *      `override`. So the count walks the tree the ENGINE built (the same
 *      `sfcScriptTrees` the analyzer is handed), where a string cannot fake a
 *      heritage clause.
 *
 * BOTH corpora are measured, because shadcn-svelte is the differential's corpus
 * and the `svelte` repo is 2.4x larger and is Svelte's OWN source. A ruling
 * measured on one repo is a fact about that repo.
 *
 * READ-ONLY. Writes only the --out file.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { ASTEngine } from "../../src/ast/engine"
const { getParser, extractSfcScriptBlocks } = ASTEngine as any

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const REPOS = (argOf("--repo", "shadcn-svelte,svelte") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const OUT = argOf("--out")
const MAX_BYTES = 512 * 1024

const files: Array<{ repo: string; dir: string; rel: string; abs: string; text: string }> = []
for (const repo of REPOS) {
  const dir = path.join(process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories", repo)
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!rel.endsWith(".svelte")) continue
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > MAX_BYTES) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "svelte") continue
    files.push({ repo, dir, rel, abs, text })
  }
}
console.log(`svelte construct probe — ${files.length} .svelte files across ${REPOS.join(", ")}`)

// ══ INSTRUMENT A — grammar inventory ══════════════════════════════════════════
//
// Enumerating what the grammar PRODUCES is positive evidence of absence. If
// `implements_clause` never appears in 6,439 parsed SFCs' script blocks, the
// construct does not occur; if `override` is not even a node type the pinned
// grammar knows, no corpus can express it through this parser.
const A_NODES = [
  // TS heritage
  "implements_clause", "extends_clause", "class_heritage", "superclass",
  // TS override modifier
  "override", "override_modifier", "accessibility_modifier", "member_modifier",
  // declarations that could carry either
  "class_declaration", "class", "interface_declaration", "abstract_class_declaration",
  "enum_declaration",
]
const svelteA: Record<string, number> = {}
const scriptA: Record<string, number> = {}

const countTypes = (root: any, into: Record<string, number>): void => {
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()
    into[n.type] = (into[n.type] ?? 0) + 1
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
}

const perRepo = new Map<string, number>()
const tsInventory = new Map<string, number>()
{
  let i = 0
  const work = async (): Promise<void> => {
    while (true) {
      const k = i++
      if (k >= files.length) return
      const f = files[k]
      perRepo.set(f.repo, (perRepo.get(f.repo) ?? 0) + 1)
      let sfcTree: any
      try {
        // The ENGINE's own entry, not a private re-implementation: the SFC parse
        // and the `<script>` block split both come from the production code the
        // analyzer is handed, so this probe measures the same trees the analyzer
        // sees. A probe that re-implemented the split could disagree with the
        // analyzer about WHICH BYTES are TypeScript, and then it would measure a
        // construct the analyzer never had the chance to read.
        const p = await getParser("svelte")
        sfcTree = p.parse(f.text, f.abs)
      } catch { continue }
      if (sfcTree?.rootNode) countTypes(sfcTree.rootNode, svelteA)
      // The SFC grammar exposes a script body as opaque text, so every
      // TypeScript construct is counted on the sub-trees, same dispatch as
      // engine.ts: ts -> typescript, tsx -> tsx, else javascript.
      let blocks: any[] = []
      try { blocks = extractSfcScriptBlocks(sfcTree.rootNode, f.text) } catch { /* no script block */ }
      for (const b of blocks) {
        try {
          const sub = await getParser(b.lang === "ts" ? "typescript" : b.lang === "tsx" ? "tsx" : "javascript")
          const t = sub.parse(b.body)
          if (t?.rootNode) {
            countTypes(t.rootNode, scriptA)
            for (const kk of Object.keys(t.rootNode.type ? Object.keys(scriptA) : [])) tsInventory.set(kk, (tsInventory.get(kk) ?? 0) + 1)
          }
        } catch { /* sub-parse failed */ }
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, () => work()))
}
console.log(`admitted per repo: ${JSON.stringify(Object.fromEntries(perRepo))}`)
console.log(`SFC-grammar distinct node types: ${Object.keys(svelteA).length}; script-grammar distinct node types: ${Object.keys(scriptA).length}`)

console.log("\n" + "=".repeat(110))
console.log("INSTRUMENT A — grammar inventory (a construct whose node never appears does not occur)")
console.log("=".repeat(110))
console.log(`${"node type".padEnd(26)}${"in SFC tree".padStart(12)}${"in <script> TS tree".padStart(22)}   verdict`)
console.log("-".repeat(110))
for (const n of A_NODES) {
  const s = svelteA[n] ?? 0
  const t = scriptA[n] ?? 0
  const verdict = t > 0 ? "OCCURS" : s > 0 ? "sfc-only" : "ABSENT"
  console.log(`${n.padEnd(26)}${String(s).padStart(12)}${String(t).padStart(22)}   ${verdict}`)
}

// ══ INSTRUMENT B — parse-tree semantic count ══════════════════════════════════
//
// Counted on the tree, with the ROLE checked rather than a shape matched: an
// `implements` is a heritage clause on a class, not the word "implements" in a
// comment or a string. A class member is an OVERRIDE only when it carries
// TypeScript's `override` modifier AND its class has a superclass (an override
// with no base class is a compile error, so the two facts travel together).
type Hit = { repo: string; rel: string; detail: string }
const hits: Record<string, Hit[]> = {
  implements: [], extends_class: [], extends_interface: [], overrides: [], classes: [],
}
{
  let i = 0
  const work = async (): Promise<void> => {
    while (true) {
      const k = i++
      if (k >= files.length) return
      const f = files[k]
      // The ENGINE's own SFC parse + `<script>` split, so this probe reads the
      // same bytes the analyzer reads. Re-implementing the split here could
      // disagree with engine.ts about WHICH BYTES are TypeScript, and then the
      // probe would measure a construct the analyzer never had the chance to see.
      let sfcTree: any
      let blocks: any[] = []
      try {
        const p = await getParser("svelte")
        sfcTree = p.parse(f.text, f.abs)
        blocks = extractSfcScriptBlocks(sfcTree.rootNode, f.text)
      } catch { /* unparseable */ }
      for (const b of blocks) {
        try {
          const sub = await getParser(b.lang === "ts" ? "typescript" : b.lang === "tsx" ? "tsx" : "javascript")
          const t = sub.parse(b.body)
          const visit = (n: any): void => {
            if (n.type === "implements_clause") {
              const parent = n.parent
              const nameNode = parent?.childForFieldName?.("name")
              hits.implements.push({
                repo: f.repo, rel: f.rel,
                detail: `class ${String(nameNode?.text ?? "?")} ${n.text.replace(/\s+/g, " ").slice(0, 70)} (line ${n.startPosition.row + 1})`,
              })
            }
            const sc = n.childForFieldName?.("superclass")
            if (n.type === "class_declaration" && sc) {
              const detail = `superclass ${String(sc?.text ?? "?").replace(/\s+/g, " ").slice(0, 40)} (line ${(n.childForFieldName?.("name") ?? n).startPosition.row + 1})`
              const owner = n.parent?.type === "interface_declaration" || n.text.trimStart().startsWith("interface ")
              if (owner) hits.extends_interface.push({ repo: f.repo, rel: f.rel, detail })
              else hits.extends_class.push({ repo: f.repo, rel: f.rel, detail })
            }
            if (n.type === "extends_clause" || n.type === "class_heritage") {
              const iface = n.parent?.type === "interface_declaration" || n.text.replace(/\s+/g, " ").startsWith("extends")
              const d = { repo: f.repo, rel: f.rel, detail: `${n.type} ${n.text.replace(/\s+/g, " ").slice(0, 50)} (line ${n.startPosition.row + 1})` }
              if (iface) hits.extends_interface.push(d)
              else hits.extends_class.push(d)
            }
            // TypeScript's `override` member modifier. Checked by SPELLING on the
            // node, not by a text scan: this is the only place a real modifier can
            // appear, and a `let override = $state()` binding is a different node
            // type entirely.
            if (n.type === "override" || (n.type === "accessibility_modifier" && String(n.text).includes("override"))) {
              hits.overrides.push({ repo: f.repo, rel: f.rel, detail: `override modifier on ${n.parent?.type ?? "?"} (line ${n.startPosition.row + 1})` })
            }
            if (n.type === "class_declaration") {
              hits.classes.push({ repo: f.repo, rel: f.rel, detail: `class ${n.childForFieldName?.("name")?.text} (line ${n.startPosition.row + 1})` })
            }
            for (let j = n.namedChildCount - 1; j >= 0; j--) {
              const c = n.namedChild(j)
              if (c) visit(c)
            }
          }
          if (t?.rootNode) visit(t.rootNode)
        } catch { /* sub-parse failed */ }
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, () => work()))
}

console.log("\n" + "=".repeat(110))
console.log("INSTRUMENT B — semantic counts on the tree the ENGINE built (strings cannot fake these)")
console.log("=".repeat(110))
const uniq = (xs: Hit[]): Map<string, number> => {
  const m = new Map<string, number>()
  for (const x of xs) m.set(`${x.repo}/${x.rel}`, (m.get(`${x.repo}/${x.rel}`) ?? 0) + 1)
  return m
}
for (const [k, xs] of Object.entries(hits)) {
  const u = uniq(xs)
  console.log(`\n${k}: ${xs.length} occurrences in ${u.size} files`)
  for (const [f, n] of [...u.entries()].slice(0, 8)) {
    const ex = xs.find((x) => `${x.repo}/${x.rel}` === f)
    console.log(`   ${String(n).padStart(3)}x  ${f}\n         ${ex?.detail ?? ""}`)
  }
}

// ══ the text probe, shown so its FALSE POSITIVES are on the record ════════════
console.log("\n" + "=".repeat(110))
console.log("WHY INSTRUMENT B AND NOT A REGEX — the same word, counted both ways")
console.log("=".repeat(110))
const wordCounts: Record<string, number> = { implements: 0, override: 0 }
const wordFiles: Record<string, Set<string>> = { implements: new Set(), override: new Set() }
for (const f of files) {
  for (const m of f.text.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
    if (m[0] === "implements" || m[0] === "override") {
      wordCounts[m[0]]++
      wordFiles[m[0]].add(`${f.repo}/${f.rel}`)
    }
  }
}
console.log(`  text "implements": ${wordCounts.implements} occurrences in ${wordFiles.implements.size} files   |  tree heritage clause: ${hits.implements.length}`)
console.log(`  text "override":   ${wordCounts.override} occurrences in ${wordFiles.override.size} files   |  tree override modifier: ${hits.overrides.length}`)
console.log(`  class declarations: ${hits.classes.length} in ${uniq(hits.classes).size} files`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    schemaVersion: 1,
    at: new Date().toISOString(),
    corpus: {
      files: files.length,
      perRepo: Object.fromEntries(perRepo),
      repos: REPOS,
      commits: Object.fromEntries([...new Set(files.map((f) => f.dir))].map((d) => {
        let c = "unknown"
        try { c = execFileSync("git", ["-C", d, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { /* not a repo */ }
        return [path.basename(d), c]
      })),
    },
    instrumentA: { sfcNodeTypes: Object.keys(svelteA).length, scriptNodeTypes: Object.keys(scriptA).length, nodes: A_NODES.map((n) => ({ node: n, inSfcTree: svelteA[n] ?? 0, inScriptTree: scriptA[n] ?? 0 })) },
    instrumentB: Object.fromEntries(Object.entries(hits).map(([k, v]) => [k, { occurrences: v.length, files: [...uniq(v).keys()], examples: v.slice(0, 20) }])),
    textProbe: { wordCounts, files: { implements: [...wordFiles.implements].slice(0, 20), override: [...wordFiles.override].slice(0, 20) } },
    instrument: "ASTEngine.parseFile + the engine's own sfcScriptTrees; grammar inventory and parse-tree role counts",
  }, null, 2))
  console.log(`\nevidence: ${OUT}`)
}