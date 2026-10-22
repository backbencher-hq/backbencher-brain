#!/usr/bin/env bun
/**
 * THE HERITAGE BLIND-SPOT PROBE (Lead, 2026-10-21).
 *
 * ★ THE JAVASCRIPT LANE FOUND A DEFECT BIGGER THAN ANY OF THE FOUR EXTENDED VALUES, AND THE LEAD
 * VERIFIES IT BEFORE IT BECOMES A RULING. The claim: the javascript analyzer is BLIND TO 802 of 2,572
 * class-heritage clauses — and the blind spot is not a wrong edge, it is NO EDGE AT ALL.
 *
 * THE MECHANISM, FROM THE ANALYZER'S OWN CODE (`src/ast/real-javascript-analyzer.ts:786` and `:831`):
 *
 *     const heritage = this.findChildByType(node, "class_heritage")
 *     const base = this.findChildByType(heritage, "identifier")
 *             ?? this.findChildByType(heritage, "member_expression")
 *
 * and `findChildByType` (`:3342-3348`) scans the DIRECT NAMED CHILDREN only:
 *
 *     for (let i = 0; i < node.namedChildCount; i++) {
 *       const child = node.namedChild(i)
 *       if (child && child.type === type) return child
 *     }
 *
 * So `class X extends (Base)` — whose heritage's ONE direct named child is a
 * `parenthesized_expression` — and `class X extends Route.extend(M)` — whose ONE direct named child
 * is a `call_expression` — publish NO EDGE AT ALL. Not a wrong target: nothing.
 *
 * ★ WHY THIS IS A LEAD-OWNED PROBE AND NOT THE LANE'S. The consequence is bigger than javascript: a
 * "the analyzer finds the base by looking for an identifier or a member expression" pattern is a
 * PATTERN, and the fleet's other 47 analyzers may share it. The probe is therefore written against
 * ANY language whose grammar has a heritage-like node, it reports the SHAPE distribution and the
 * uncovered shapes, and it works off the LIVE production parser with the production build's sha256
 * printed — because L-20 says a grammar is cited by the digest of the bytes the registry serves.
 *
 * THE MEASUREMENT IS OVER REAL FILES FROM THE REAL CORPUS, and the population is printed, because a
 * blind spot measured on a sample is a sample.
 *
 * RUN: bun script/m14/heritage-blindspot-probe.ts [--lang=<language>] [--max=<files>] [--repo=<name>]
 *
 * EXIT: 0 if every heritage clause's shape is covered by the analyzer's lookup pair, or if the
 * language has no heritage-like node; 5 if shapes are uncovered — because that is a MEASURED BLIND
 * SPOT, and the fleet has to know about it before it publishes a resolution number on top of it.
 */

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve, join } from "node:path"

const ROOT = resolve(import.meta.dir, "../..")
const CORPUS = resolve(ROOT, ".corpus")
const argv = process.argv.slice(2)
const argOf = (name: string, dflt: string): string => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}
const LANG = argOf("lang", "javascript")
const MAX = Number(argOf("max", "3000"))
const REPO = argOf("repo", "")

/** THE EXTENSIONS, PER LANGUAGE, SO THE WALK READS THE CORPUS'S REAL FILES. */
const EXT: Record<string, string[]> = {
  javascript: [".js", ".jsx", ".mjs", ".cjs"],
  typescript: [".ts", ".tsx"],
  dart: [".dart"],
  python: [".py"],
  java: [".java"],
  csharp: [".cs"],
  php: [".php"],
  ruby: [".rb"],
  scala: [".scala"],
  kotlin: [".kt"],
  swift: [".swift"],
}

/**
 * THE HERITAGE-LIKE NODE TYPES PER LANGUAGE, and the SHAPES THE ANALYZER LOOKS FOR.
 *
 * The javascript pair is measured, not assumed: the analyzer's own lookup pair is
 * `identifier` ?? `member_expression` over the DIRECT named children of the heritage node. The other
 * languages' pairs are the common shapes, and a language whose pair is wrong shows up as a large
 * UNCOVERED count — which is the point: the probe reports what it measures.
 */
/**
 * ★ THE SHAPE PAIRS ARE READ FROM THE ANALYZERS' OWN CODE, NOT INVENTED. The first version of this
 * table was written from memory and it was WRONG for four languages: it reported java as 1,901
 * uncovered clauses when java's analyzer looks up `scoped_type_identifier ?? generic_type ??
 * type_identifier` (`src/ast/real-java-analyzer.ts:5449-5451`) — a THREE-WAY lookup that covers the
 * shape the probe claimed was uncovered. It reported dart as 6,604 uncovered when dart's analyzer uses
 * `resolvedHeritageNodes(superclass)` (`src/ast/real-dart-analyzer.ts:4154`), which is not a shape
 * list at all. And python's `argument_list` is not a heritage node — it is the argument list of a
 * CALL. ⇒ A PROBE CONFIGURED FROM MEMORY MEASURES THE PROBE'S ASSUMPTIONS, NOT THE ANALYZER. EVERY
 * PAIR BELOW IS QUOTED FROM THE ANALYZER'S OWN SOURCE, WITH THE LINE.
 */
/**
 * ★ THE MODE IS PART OF THE CONFIGURATION, BECAUSE TWO ANALYZERS LOOK FOR DIFFERENT THINGS. A `pair`
 * analyzer names specific shapes and a lookup that names none of them finds nothing; an `any` analyzer
 * iterates EVERY named child and cannot miss a shape at all. Reading a `pair` analyzer as an `any` one
 * — or the reverse — measures the PROBE'S ASSUMPTION, and typescript's first configuration did
 * exactly that: it named javascript's pair for a clause the analyzer walks wholesale.
 */
const HERITAGE: Record<string, { node: string; shapes: string[]; source: string; mode?: "pair" | "any" }> = {
  javascript: { node: "class_heritage", shapes: ["identifier", "member_expression"],
    source: "src/ast/real-javascript-analyzer.ts:786,:831 — `identifier` ?? `member_expression`" },
  // TYPESCRIPT'S STRUCTURE IS DIFFERENT, AND THE PROBE MUST READ IT RATHER THAN ASSUME IT. Its
  // `class_heritage` holds an `extends_clause` child, and the analyzer iterates ALL of that clause's
  // named children (src/ast/real-typescript-analyzer.ts:8439-8470) — so the clause's own shape is the
  // `extends_clause`, and the pair the analyzer effectively matches is the clause's children. The
  // first version of this table said typescript used javascript's `identifier` ?? `member_expression`
  // and measured 446 of 446 clauses UNCOVERED, which was the TABLE's error and not the analyzer's.
  typescript: { node: "extends_clause", shapes: [], mode: "any",
    source: "src/ast/real-typescript-analyzer.ts:8439-8470 — iterates ALL named children of `extends_clause`" },
  java: { node: "superclass", shapes: ["scoped_type_identifier", "generic_type", "type_identifier"],
    source: "src/ast/real-java-analyzer.ts:5449-5451 — a THREE-WAY lookup" },
  // CSHARP'S PAIR IS LONGER THAN THE OBVIOUS ONE, and the probe's first table said otherwise and
  // reported 67 `predefined_type` clauses as uncovered. They are NOT: the analyzer handles
  // `predefined_type` explicitly (src/ast/real-csharp-analyzer.ts:132 lists it, :640 and :968 skip
  // it in the symbol path, and :2327 reads it) and it handles
  // `primary_constructor_base_type` too (:1593-1594 takes the identifier/generic_name child). A
  // `predefined_type` base is `int`/`string`/`object` — the language's own built-ins, which carry
  // no declaration to point at, so the analyzer's refusal is right.
  csharp: { node: "base_list", shapes: ["identifier", "qualified_name", "generic_name", "predefined_type", "primary_constructor_base_type"],
    source: "src/ast/real-csharp-analyzer.ts:1576,:1593-1594,:2327 — and `predefined_type` is handled at :132/:640/:968" },
  php: { node: "base_clause", shapes: ["name", "qualified_name"],
    source: "src/ast/real-php-analyzer.ts — `name` ?? `qualified_name`" },
  // RUBY'S FOUR UNCOVERED SUPERCLASSES ARE A DELIBERATE REFUSAL, NOT A BLIND SPOT. The analyzer
  // emits an extends relationship ONLY when the superclass is a statically NAMEABLE constant or
  // scope path (`Foo`, `::Foo`, `A::B::C`) — its own comment at
  // `src/ast/real-ruby-analyzer.ts:311-315` says a superclass expression that is "a call" is
  // "unknowable statically; emitting its raw text as an extends target" would be a fabricated edge.
  // `class X < Struct.new(:a)` is exactly that. The four uncovered clauses are `call` superclasses,
  // and the analyzer's refusal is CORRECT. The probe reports the shape and the lane's instrument
  // decides; the probe does not claim a defect where the analyzer is right.
  ruby: { node: "superclass", shapes: ["constant", "scope_resolution"],
    source: "src/ast/real-ruby-analyzer.ts:311-315 — a `call` superclass is unknowable statically, and refusing it is right" },
}

const conf = HERITAGE[LANG]
if (!conf) {
  console.log(`★ ${LANG} IS NOT CONFIGURED IN THIS PROBE, and the reason is a MEASUREMENT one, not a`)
  console.log("  convenience one:")
  if (LANG === "dart") {
    console.log("  dart's analyzer resolves a superclass with `resolvedHeritageNodes(superclass)")
    console.log("  (src/ast/real-dart-analyzer.ts:4154), which is a RESOLUTION, not a shape list — so a")
    console.log("  shape table cannot stand in for it, and a table that did would measure the table.")
  } else if (LANG === "python") {
    console.log("  python's `argument_list` is the argument list of a CALL, not a heritage node; a")
    console.log("  python base class list is a different node, and naming the wrong one measures noise.")
  } else {
    console.log(`  no heritage-like node for ${LANG} is confirmed from the analyzer's own source.`)
  }
  console.log("  ⇒ NOTHING IS MEASURED AND NOTHING IS CLAIMED. The lane's own instrument is the authority")
  console.log("    for this language, as it is for javascript's.")
  process.exit(0)
}

/**
 * THE ADMITTED POPULATION, BY THE FLEET'S OWN RULE: the files a REPOSITORY CARRIES, taken from
 * `git ls-files` — the git-TRACKED set — with the size cap applied.
 *
 * ★ THIS CHANGED THE MEASUREMENT, AND THE REASON MATTERS. The first version walked the DIRECTORY
 * TREE, and measured 3,000 files with ZERO uncovered heritage clauses. The lane's own census, over
 * the git-TRACKED set, measured 802 uncovered. THE DIRECTORY WALK AND THE TRACKED WALK ARE DIFFERENT
 * POPULATIONS: a directory walk sees files the repository does not carry, and it stops at `MAX` in
 * whatever order the filesystem returns, so it can miss the very files that carry the construct.
 * ⇒ A BLIND SPOT MEASURED ON THE WRONG POPULATION IS NOT A SMALLER BLIND SPOT. IT IS A DIFFERENT
 * CLAIM, and the two populations must be named, not assumed to agree.
 *
 * THE RULE IS THE FLEET'S: a cell's REPO COUNT = repositories CARRYING AN ADMITTED FILE, and the
 * admitted set is the tracked set under the size cap. A symlinked directory is followed, because the
 * corpus root is 199 absolute symlinks into the repository store.
 */
function corpusFiles(): string[] {
  const out: string[] = []
  const exts = EXT[LANG] ?? []
  let repos: string[]
  try {
    repos = execFileSync("ls", ["-1", CORPUS], { encoding: "utf8" }).split("\n").filter(Boolean).sort()
  } catch {
    repos = []
  }
  if (REPO) repos = repos.filter((r) => r === REPO)
  for (const name of repos) {
    const dir = join(CORPUS, name)
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[] = []
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) {
      if (!exts.some((x) => rel.toLowerCase().endsWith(x))) continue
      const abs = join(dir, rel)
      try {
        if (readFileSync(abs).length > 1024 * 1024) continue
      } catch {
        continue
      }
      out.push(abs)
      if (out.length >= MAX) return out
    }
  }
  return out
}

/** THE PRODUCTION BUILD'S DIGEST — L-20: a grammar is cited by the bytes the registry serves. */
async function productionDigest(): Promise<string> {
  try {
    const { resolveWasmAsset, hasWasmInRegistry } = await import(resolve(ROOT, "src/util/wasm"))
    const p = resolveWasmAsset(`tree-sitter-${LANG}/tree-sitter-${LANG}.wasm`)
    const bytes = hasWasmInRegistry(`tree-sitter-${LANG}.wasm`)
    const { createHash } = await import("node:crypto")
    return `${createHash("sha256").update(bytes).digest("hex").slice(0, 12)} (${p})`
  } catch (e: any) {
    return `unavailable: ${String(e).slice(0, 60)}`
  }
}

const files = corpusFiles()
console.log(`HERITAGE BLIND-SPOT PROBE — ${LANG}`)
console.log(`population: ${files.length} GIT-TRACKED admitted files from ${CORPUS}${REPO ? `/${REPO}` : ""}`)
console.log(`heritage node: ${conf.node} · the analyzer's lookup: ${conf.mode === "any" ? "EVERY named child" : conf.shapes.join(" ?? ")}`)
console.log(`the pair, quoted from the analyzer: ${conf.source}`)
console.log(`production build: ${await productionDigest()}`)
console.log()

const { getParser } = await import(resolve(ROOT, "src/ast/engine"))
const parser = await getParser(LANG as any)

const shapeCounts = new Map<string, number>()
const uncovered = new Map<string, number>()
let heritageTotal = 0
let covered = 0
let filesRead = 0
let failed = 0

for (const f of files) {
  let src: string
  try { src = readFileSync(f, "utf8") } catch { continue }
  let tree: any
  try { tree = parser.parse(src) } catch { failed++; continue }
  filesRead++
  // THE WALK, over the whole tree, so a heritage node at any depth is counted.
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === conf.node) {
      heritageTotal++
      // THE ANALYZER'S OWN LOOKUP, REPRODUCED VERBATIM: DIRECT named children only.
      let found: any = null
      if (conf.mode === "any") {
        // THE `any` MODE: the analyzer takes EVERY named child, so a shape cannot be missed. The
        // analyzer may still FILTER some of them — typescript skips argument nodes
        // (`:8455`, `isNameableHeritageNode`) — so the probe reports the shape and leaves the
        // FILTERING to the lane's own instrument. What this probe asserts is only that the
        // analyzer's LOOKUP can REACH the shape, which is the question a missing edge turns on.
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) { found = c; break }
        }
      } else {
        for (const want of conf.shapes) {
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c && c.type === want) { found = c; break }
          }
          if (found) break
        }
      }
      // THE SHAPE OF THE DIRECT NAMED CHILDREN, which is what decides whether the pair can match.
      const direct = (n.namedChildren ?? []).map((c: any) => c?.type ?? "?")
      const key = direct.length === 0 ? "(no named children)" : direct.join("+")
      shapeCounts.set(key, (shapeCounts.get(key) ?? 0) + 1)
      if (found) covered++
      else uncovered.set(key, (uncovered.get(key) ?? 0) + 1)
    }
    for (const c of (n.namedChildren ?? [])) if (c) stack.push(c)
  }
  try { tree.delete() } catch { /* the probe's own tree */ }
}

console.log(`files read ${filesRead} · failed ${failed} · heritage clauses ${heritageTotal}`)
console.log(`covered by the lookup pair ${covered} · UNCOVERED ${heritageTotal - covered}`)
console.log()
console.log("THE SHAPES OF THE DIRECT NAMED CHILDREN, AND WHICH OF THEM THE PAIR CANNOT MATCH:")
const shapes = [...shapeCounts.entries()].sort((a, b) => b[1] - a[1])
for (const [shape, n] of shapes) {
  const miss = uncovered.get(shape) ?? 0
  const tag = miss > 0 ? `  ★ ${miss} UNCOVERED` : ""
  console.log(`  ${String(n).padStart(6)}  ${shape}${tag}`)
}
console.log()

if (heritageTotal === 0) {
  console.log(`no ${conf.node} clause was found in the population — the population may not exercise the construct.`)
  process.exit(0)
}
const missTotal = heritageTotal - covered
if (missTotal === 0) {
  console.log("⇒ EVERY heritage clause's shape is covered by the analyzer's lookup pair. No blind spot.")
  process.exit(0)
}
// A SHAPE THE ANALYZER DOES NOT MATCH IS NOT AUTOMATICALLY A DEFECT. It is a defect only when the
// analyzer is SUPOSED to publish an edge for that shape. Ruby's four `call` superclasses are the
// counter-example the probe itself must carry: ruby refuses them DELIBERATELY, because a superclass
// expression that is a call is not statically knowable and naming it would be a fabricated edge
// (`src/ast/real-ruby-analyzer.ts:311-315`). ⇒ THE PROBE REPORTS THE SHAPE AND THE COUNTS; THE
// QUESTION "SHOULD IT HAVE PUBLISHED AN EDGE" IS THE LANE'S, ANSWERED AGAINST THE ANALYZER'S OWN
// STATED INTENT — not against the probe's expectation.
console.log(`★ THE BLIND SPOT IS MEASURED: ${missTotal} of ${heritageTotal} ${conf.node} clauses (${((missTotal / heritageTotal) * 100).toFixed(1)} %) publish`)
console.log("  NO EDGE AT ALL, because their direct named child is a shape the lookup pair does not name.")
console.log("  THAT IS NOT A WRONG EDGE. IT IS A MISSING EDGE, and a resolution count over a population")
console.log("  that contains them is a count over a population the analyzer cannot see.")
process.exit(5)
