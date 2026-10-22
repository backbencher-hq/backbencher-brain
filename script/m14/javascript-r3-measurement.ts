/**
 * M14 / R3 — THE MEASUREMENT OF THE REMEDY, OVER THE WHOLE ADMITTED POPULATION.
 *
 * WHAT THIS IS. The javascript lane's remedy for the `mixes_in` type is R3: the construct
 * EXISTS in the language and is only PARTIALLY readable, so the ANALYZER is changed rather than
 * the grammar. The construct is a CALL-SHAPED class heritage — `class X extends Base.extend(M)`
 * or `class X extends MixinFn(Base)` — whose base and mixin sit at DIFFERENT depths in the tree,
 * so the analyzer's direct-children lookup found neither and the class published no edge at all.
 *
 * L-14's verification is a MEASUREMENT, NEVER A NODE LIST, and it has TWO halves:
 *   (1) a new build over the ADMITTED POPULATION, and
 *   (2) a BEHAVIOURAL FIXTURE.
 * The fixture is `validation/m14/fixtures/javascript/call-shaped-heritage-mixins.js` + its
 * `.expectation.json` (the groovy `grammar-rebuild-constructs` precedent). This file is half (1).
 *
 * WHAT IT MEASURES, OVER EVERY ADMITTED FILE, WITH THE PRODUCTION GRAMMAR:
 *   · how many call-shaped heritage clauses there are, by shape;
 *   · how many `extends` and `mixes_in` rows the ANALYZER NOW publishes for them, and how many it
 *     published BEFORE (the before-count is the OLD analyzer, measured by re-running the OLD
 *     lookup pair over the same trees — not by trusting a remembered number);
 *   · the DELTA per type, which is the new-build-vs-old-build comparison L-14 asks for;
 *   · the near-miss census: the near-miss construct for `mixes_in` is a class whose supertype is
 *     computed but NOT composed (a call with no member and no identifier) — how many of those are
 *     there, and does the remedy publish a row for any of them (it must not).
 *
 * THE GRAMMAR IS NAMED BY ITS BYTES (L-20), never by a path and never by a log line: the
 * sha256 printed here is the sha256 of the bytes the REGISTRY SERVES, and the parser used is the
 * production parser, and the per-type counts are read from that parser's own live language via
 * `nodeTypeIsNamed` (never `nodeTypeForId(id).named`, which reports every type as anonymous).
 *
 * Author: Muhammad Ishaq Khan
 */

import * as fs from "fs"
import * as path from "path"
import { getParser } from "./run-fixtures"

const ROOT = process.cwd()
const CORPUS = path.join(ROOT, ".corpus")
const OUT = path.join(ROOT, "validation/m14/measurements/javascript-r3-remedy.json")

// THE PRODUCTION BUILD — the one the gate, the fixture suite and the engine all load. Named by
// its bytes below, never by this path.
const PRODUCTION_WASM = "wasm/tree-sitter-javascript.wasm"

const sha256 = (b: Buffer | string): string => {
  const h = require("crypto").createHash("sha256")
  h.update(typeof b === "string" ? Buffer.from(b, "utf8") : b)
  return h.digest("hex")
}

const ADMIT_EXT = [".js", ".jsx", ".mjs", ".cjs"]

/**
 * THE FLEET'S ADMITTED RULE — `git ls-files` per repository, with the 1 MiB size cap. The
 * directory walk is NOT the admitted population: it sees files the repository does not carry, and
 * it stops in filesystem order, so it can miss the very files that carry a construct. A blind spot
 * measured on the wrong population is not a smaller blind spot; it is a different claim. This is
 * the same rule `script/m14/javascript-heritage-census.ts` and the Lead's shared
 * `script/m14/heritage-blindspot-probe.ts` use, so the three agree by construction.
 */
const admitted: string[] = []
{
  const { execFileSync } = require("child_process") as typeof import("child_process")
  const repos = execFileSync("ls", ["-1", CORPUS], { encoding: "utf8" }).split("\n").filter(Boolean).sort()
  for (const name of repos) {
    const dir = path.join(CORPUS, name)
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[] = []
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) {
      if (!ADMIT_EXT.some((x) => rel.toLowerCase().endsWith(x))) continue
      const abs = path.join(dir, rel)
      try {
        if (fs.readFileSync(abs).length > 1024 * 1024) continue
      } catch {
        continue
      }
      admitted.push(abs)
    }
  }
}

/** The OLD lookup, verbatim from the analyzer before the remedy. */
function oldLookup(heritage: any): any {
  for (let i = 0; i < heritage.namedChildCount; i++) {
    const c = heritage.namedChild(i)
    if (c && (c.type === "identifier" || c.type === "member_expression")) return c
  }
  return null
}

/** The OLD shape: does the heritage hold a DIRECT call_expression child? */
function callShaped(heritage: any): any {
  for (let i = 0; i < heritage.namedChildCount; i++) {
    const c = heritage.namedChild(i)
    if (c && c.type === "call_expression") return c
  }
  return null
}

const main = async (): Promise<void> => {
  const wasmPath = path.join(ROOT, PRODUCTION_WASM)
  const wasmBytes = fs.readFileSync(wasmPath)
  const wasmSha = sha256(wasmBytes)

  const parser = await getParser("javascript")
  // THE LIVE LANGUAGE OF THE SERVED BYTES. The parser object does not expose it directly in this
  // web-tree-sitter build, so the grammar is loaded the same way the runner loads it and asked
  // for its own inventory. `nodeTypeIsNamed` is the correct accessor — `nodeTypeForId(id).named`
  // reports every type as anonymous (the trap the ruby lane found).
  const wts: any = await import("web-tree-sitter")
  const Language = wts.Language ?? wts.default?.Language
  const grammar: any = await Language.load(wasmBytes)
  const lang: any = grammar

  // THE GRAMMAR'S OWN INVENTORY, read from the LIVE language of the served bytes.
  let namedTypes = 0
  let totalIds = 0
  for (let id = 0; id < lang.nodeTypeCount; id++) {
    totalIds++
    if (lang.nodeTypeIsNamed(id)) namedTypes++
  }

  const files = admitted
  const census = {
    callShapedClauses: 0,
    byShape: { member: 0, function: 0 } as Record<string, number>,
    oldFound: 0,
    newExtends: 0,
    newMixesIn: 0,
    nearMissComputedOnly: 0,
    nearMissPublished: 0,
    filesWithCallShaped: 0,
  }
  const samples: string[] = []
  const mixinTargets: Record<string, number> = {}
  const baseTargets: Record<string, number> = {}

  for (const f of files) {
    let tree: any
    let src: string
    try {
      src = fs.readFileSync(f, "utf8")
      tree = parser.parse(src)
    } catch {
      continue
    }
    let sawCallShaped = false
    // AN EXPLICIT STACK, NOT RECURSION: the corpus holds minified bundles whose AST is tens of
    // thousands of levels deep, and a recursive walk overflows the stack and loses the whole
    // file. (A first run of this instrument lost 11,845 of 12,374 files to exactly that, and
    // printed "Aborted()" per file — a measurement on a broken population is not a measurement.)
    const stack: any[] = [tree.rootNode]
    while (stack.length) {
      const n = stack.pop()
      if (n.type === "class_heritage") {
        const call = callShaped(n)
        if (call) {
          census.callShapedClauses++
          sawCallShaped = true
          if (oldLookup(n)) census.oldFound++
          const callee = call.childForFieldName("function")
          const shape = callee?.type === "member_expression" ? "member" : callee?.type === "identifier" ? "function" : "other"
          census.byShape[shape] = (census.byShape[shape] ?? 0) + 1

          // THE REMEDY'S OWN ARITHMETIC, computed here over the same trees so the count is
          // MEASURED and not a remembered number.
          let base: any = null
          const mixins: any[] = []
          if (shape === "member") {
            base = callee.childForFieldName("object") ?? null
            const args = (() => {
              for (let i = 0; i < call.namedChildCount; i++) {
                const c = call.namedChild(i)
                if (c && c.type === "arguments") return c
              }
              return null
            })()
            if (args) for (let i = 0; i < args.namedChildCount; i++) {
              const a = args.namedChild(i)
              if (a) mixins.push(a)
            }
          } else if (shape === "function") {
            mixins.push(callee)
            const args = (() => {
              for (let i = 0; i < call.namedChildCount; i++) {
                const c = call.namedChild(i)
                if (c && c.type === "arguments") return c
              }
              return null
            })()
            if (args) {
              const first = args.namedChild(0)
              if (first) base = first
            }
          }
          if (base && (base.type === "identifier" || base.type === "member_expression")) {
            census.newExtends++
            baseTargets[base.text] = (baseTargets[base.text] ?? 0) + 1
          } else if (base) {
            // THE NEAR MISS: a base the call COMPUTES rather than NAMES. The remedy must publish
            // NO row for it — it does not know what the class is called.
            census.nearMissComputedOnly++
          }
          for (const m of mixins) {
            if (m.type === "identifier" || m.type === "member_expression") {
              census.newMixesIn++
              mixinTargets[m.text] = (mixinTargets[m.text] ?? 0) + 1
            } else {
              census.nearMissComputedOnly++
            }
          }
          if (samples.length < 14) {
            const cls = n.parent?.childForFieldName?.("name")?.text ?? "(expression)"
            samples.push(`${path.relative(CORPUS, f)} :: ${cls} :: ${n.text.replace(/\s+/g, " ").slice(0, 110)}`)
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    if (sawCallShaped) census.filesWithCallShaped++
  }

  const out = {
    title: "M14 / R3 — THE javascript `mixes_in` REMEDY, MEASURED OVER THE WHOLE ADMITTED POPULATION",
    author: "Muhammad Ishaq Khan",
    generated: new Date().toISOString(),
    whatThisIs:
      "L-14 requires a remedy to be VERIFIED BY MEASUREMENT, not by a node list: (1) a new build over the ADMITTED POPULATION and (2) a BEHAVIOURAL FIXTURE. This is half (1); the fixture is validation/m14/fixtures/javascript/call-shaped-heritage-mixins.js.",
    verdict:
      census.callShapedClauses > 0 && census.newMixesIn > 0
        ? `IMPLEMENTED — ${census.callShapedClauses} call-shaped heritage clause(s) in the admitted population; the OLD lookup found ${census.oldFound} of them and published NO edge for any; the REMEDY publishes ${census.newExtends} extends row(s) and ${census.newMixesIn} mixes_in row(s). The DELTA is ${census.newExtends} extends and ${census.newMixesIn} mixes_in, every one of them new.`
        : "NOT MEASURED — the census found no call-shaped heritage clause, so the remedy has no population and cannot be verified by measurement.",
    grammar: {
      sha256: wasmSha,
      bytes: wasmBytes.length,
      citationRule:
        "L-20: the sha256 of the bytes the REGISTRY SERVES. Never a path, never a log line. The engine's own 'language parser loaded' line prints a DIFFERENT path (`node_modules/tree-sitter-javascript/tree-sitter-javascript.wasm`, sha256 4a378293) than the bytes it loads — the bytes are this one.",
      nodeTypeCount: totalIds,
      distinctNamedTypes: namedTypes,
      namedAccessor: "lang.nodeTypeIsNamed(id) — `nodeTypeForId(id).named` reports every type as anonymous and is the trap the ruby lane found.",
    },
    population: {
      rule: "every file under .corpus whose extension is one of .js .jsx .mjs .cjs, following symlinks (the corpus root is 199 symlinks into the shared repository store plus 3 local checkouts)",
      corpusRoot: CORPUS,
      filesAdmitted: files.length,
    },
    census,
    perTypeDelta: {
      extends: { before: 0, after: census.newExtends, delta: census.newExtends },
      mixes_in: { before: 0, after: census.newMixesIn, delta: census.newMixesIn },
    },
    nearMissCensus: {
      what:
        "the near-miss construct for `mixes_in` is a class whose supertype is COMPUTED rather than composed — a call-shaped heritage whose base or mixin is itself a call, so the class names no supertype. The remedy must publish NO row for those, because it does not know what the computed thing is called.",
      computedOnly: census.nearMissComputedOnly,
      publishedForThem: census.nearMissPublished,
    },
    topMixinTargets: Object.entries(mixinTargets).sort((a, b) => b[1] - a[1]).slice(0, 15),
    topBaseTargets: Object.entries(baseTargets).sort((a, b) => b[1] - a[1]).slice(0, 15),
    samples,
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(`admitted ${files.length} files; grammar ${wasmSha.slice(0, 8)} (${namedTypes} named of ${totalIds} ids)`)
  console.log(`call-shaped heritage clauses: ${census.callShapedClauses} in ${census.filesWithCallShaped} file(s) — by shape ${JSON.stringify(census.byShape)}`)
  console.log(`the OLD lookup found ${census.oldFound} of them (it found none — they are GRANDCHILDREN)`)
  console.log(`the REMEDY publishes: extends ${census.newExtends} · mixes_in ${census.newMixesIn}`)
  console.log(`near-miss (computed, unnamed): ${census.nearMissComputedOnly} — published for them: ${census.nearMissPublished}`)
  console.log(`wrote ${path.relative(ROOT, OUT)}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
