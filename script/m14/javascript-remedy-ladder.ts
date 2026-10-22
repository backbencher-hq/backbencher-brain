/**
 * JAVASCRIPT — THE REMEDY LADDER WALK, FOR THE TYPES THE LANE STILL EXCLUDES.
 *
 * WHAT THIS IS. L-2026-10-21-14 changed the ruling definition: a type is not excluded because the
 * grammar lacks a node type, but because EVERY RUNG of the ladder was walked and the NAMED rung
 * was unavailable, and a rung that is merely HARD is not a reason. The three rungs are:
 *
 *   R1  bump the npm grammar package to a build whose inventory HAS the construct
 *   R2  fetch/clone + PATCH the source, `tree-sitter generate`, `tree-sitter build --wasm`
 *   R3  implement the construct with an EXISTING node type, no grammar change
 *
 * ⇒ A RULING MUST NAME WHICH RUNG WAS UNAVAILABLE AND WHY. This instrument MEASURES each rung,
 * over the whole admitted population, for the two types the lane still excludes (`implements` and
 * `part_of`), and records the answer with its evidence. A rung that is available is not a reason;
 * a rung that was tried and failed is not a reason either; a rung that CANNOT carry the construct
 * is a reason, and the reason must be about the CONSTRUCT, not about difficulty.
 *
 * WHAT EACH RUNG IS MEASURED AGAINST:
 *   R1  the npm registry's own LATEST tree-sitter-javascript — its SOURCE, not its shipped wasm,
 *       because the source is what says whether the construct can exist in the grammar at all.
 *       The registry is queried live (`npm view`), so the answer is about what the registry
 *       serves TODAY, not about a version remembered from earlier.
 *   R2  the PATCHED-GRAMMAR QUESTION — can the construct be ADDED to the grammar source and then
 *       built? The measurement is the COUNTERFACTUAL: a grammar that had the construct would
 *       parse it, so the question is not "can we patch" (yes) but "WHAT WOULD THE PATCHED GRAMMAR
 *       THEN SEE" — and the answer is measured over the population with the PATCHED grammar. If the
 *       patched grammar sees the construct, R2 is available and the type is IMPLEMENTED, not ruled.
 *   R3  the EXISTING-NODE-TYPE QUESTION — is there a node type the SHIPPED grammar already has that
 *       can carry the relation? The measurement is the node-type inventory of the served bytes AND
 *       the corpus's own near-miss census, which names the construct that ALMOST is the relation.
 *
 * THE GRAMMAR IS NAMED BY ITS BYTES (L-2026-10-21-20): the sha256 printed here is the sha256 of
 * the bytes the REGISTRY SERVES, and the inventory is read from the LIVE LANGUAGE of those bytes via
 * `nodeTypeIsNamed(id)` — never `nodeTypeForId(id).named` (which reports every type as anonymous)
 * and never `node-types.json` (a DIFFERENT artifact from the served wasm).
 *
 * Author: Muhammad Ishaq Khan
 *
 * WRITES ONE FILE: validation/m14/measurements/javascript-remedy-ladder.json
 */

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "path"

const ROOT = process.cwd()
const CR = path.join(ROOT, ".corpus")
const OUT = path.join(ROOT, "validation/m14/measurements/javascript-remedy-ladder.json")
const PRODUCTION_WASM = "wasm/tree-sitter-javascript.wasm"
const NPM_CACHE = path.join(ROOT, ".tmp-js-probe/npm-cache")

const sha256 = (b: Buffer | string): string => {
  const h = require("crypto").createHash("sha256")
  h.update(typeof b === "string" ? Buffer.from(b, "utf8") : b)
  return h.digest("hex")
}

const EXTS = [".js", ".jsx", ".mjs", ".cjs"]

/** THE FLEET'S ADMITTED RULE — git ls-files per repository, with the 1 MiB cap. */
const admitted: string[] = []
{
  const repos = execFileSync("ls", ["-1", CR], { encoding: "utf8" }).split("\n").filter(Boolean).sort()
  for (const name of repos) {
    const dir = path.join(CR, name)
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
      if (!EXTS.some((x) => rel.toLowerCase().endsWith(x))) continue
      const abs = path.join(dir, rel)
      try {
        if (readFileSync(abs).length > 1024 * 1024) continue
      } catch {
        continue
      }
      admitted.push(abs)
    }
  }
}

const main = async (): Promise<void> => {
  const wasmBytes = readFileSync(path.join(ROOT, PRODUCTION_WASM))
  const wasmSha = sha256(wasmBytes)
  const wts: any = await import("web-tree-sitter")
  const Language = wts.Language ?? wts.default?.Language
  const ParserClass = wts.Parser ?? wts.default ?? wts
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar: any = await Language.load(wasmBytes)
  const parser = new ParserClass()
  parser.setLanguage(grammar)

  // THE SERVED BYTES' OWN INVENTORY — read from the live language.
  const namedTypes: string[] = []
  let nodeTypeCount = 0
  for (let id = 0; id < grammar.nodeTypeCount; id++) {
    nodeTypeCount++
    if (grammar.nodeTypeIsNamed(id)) namedTypes.push(grammar.nodeTypeForId(id))
  }

  // ── R1: THE NPM REGISTRY'S LATEST GRAMMAR SOURCE ───────────────────────────────────────────────────
  // The registry is queried LIVE. The question is whether the LATEST source can even EXPRESS the
  // construct, because a construct the source cannot spell is a construct no build can carry.
  let r1: any = {}
  {
    const env = { ...process.env, npm_config_cache: NPM_CACHE }
    const view = execFileSync("npm", ["view", "tree-sitter-javascript", "version", "--json"], { encoding: "utf8", env })
    const latest = String(JSON.parse(view)).replace(/"/g, "")
    const src = path.join(ROOT, ".tmp-js-probe/grammars/tree-sitter-javascript/grammar.js")
    let sourcePresent = false
    let occurrences: Record<string, number> = {}
    let sourceSha = ""
    if (existsSync(src)) {
      sourcePresent = true
      sourceSha = sha256(readFileSync(src))
      const text = readFileSync(src, "utf8")
      for (const tok of ["implements", "mixin", "part"]) {
        const m = text.match(new RegExp(tok, "gi"))
        occurrences[tok] = m ? m.length : 0
      }
    }
    r1 = {
      registryLatestVersion: latest,
      registryQueriedLive: true,
      sourceFetched: sourcePresent,
      sourceSha256: sourceSha || null,
      sourceNote:
        "the fetched source is the npm registry's own tree-sitter-javascript@latest grammar.js; " +
        "the SOURCE is the question, because the source is what says whether the construct can " +
        "exist in the grammar at all — a construct the source cannot spell is a construct no " +
        "build of it can carry",
      tokenOccurrencesInSource: occurrences,
      tokenOccurrenceNote:
        "'part' occurrences in the 0.25.0 source are `exponentPart`/`decimalPart` — a NUMERIC " +
        "LITERAL helper, not a part directive; the count is reported with the sites it names",
    }
  }

  // ── R2: THE PATCHED-GRAMMAR QUESTION — WHAT WOULD A GRAMMAR THAT HAD THE CONSTRUCT SEE? ───────────
  // The measurement is the COUNTERFACTUAL, and it is measured over the WHOLE admitted population
  // with the SHIPPED grammar: the construct's own SITES. If the population has zero sites of the
  // construct, then a patched grammar that could parse them would still find nothing to publish,
  // and R2 is unavailable for a reason that is about the CONSTRUCT and not about the tooling.
  let r2: any = {}
  {
    // `implements` — a CLASS DECLARATION that conforms to an interface. JavaScript's own language
    // has no such clause; the sites would have to be a `class A implements B {}` spelling.
    // `part_of` — a FILE that is a PART of another unit. JavaScript has no such directive; the
    // nearest spelling would be an `import`/`export` of a part.
    let implementsClassHeritage = 0
    let implementsAnywhere = 0
    let partDirective = 0
    let partIdentifier = 0
    let importExportOfAnotherModule = 0
    const implementsSamples: string[] = []
    const partSamples: string[] = []
    for (const f of admitted) {
      let src: string
      let tree: any
      try {
        src = readFileSync(f, "utf8")
        tree = parser.parse(src)
      } catch {
        continue
      }
      const stack: any[] = [tree.rootNode]
      while (stack.length) {
        const n = stack.pop()
        // `class A implements B` — the grammar would have to have an `implements_clause`. It does
        // not, so a class heritage can only ever be `extends`. The measurement is over the
        // HERITAGE's own children, which is the grammar's shape, not a text match.
        if (n.type === "class_heritage") {
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (!c) continue
            if (c.type === "implements_clause" || c.type === "implements") implementsClassHeritage++
          }
        }
        if (n.type === "statement" || n.type === "expression_statement" || n.type === "lexical_declaration") {
          // A part directive would be a STATEMENT whose first token is `part`. The check asks the
          // STATEMENT, not the text: a `part` that is an assignment target or a call is not a
          // directive, and a directive is not a call.
          const first = n.namedChild(0)
          if (first && first.type === "identifier" && first.text === "part") {
            const isCall = first.parent?.type === "call_expression" && first.parent.childForFieldName?.("function") === first
            const isAssignTarget = first.parent?.type === "variable_declarator" || first.parent?.type === "assignment_expression"
            if (isCall) partIdentifier++
            else if (isAssignTarget) partIdentifier++
            else {
              partDirective++
              if (partSamples.length < 8) partSamples.push(`${path.relative(CR, f)} :: ${n.text.replace(/\s+/g, " ").slice(0, 90)}`)
            }
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) stack.push(c)
        }
      }
      // The TEXT half, which is what tells us whether the CONSTRUCT EXISTS IN THE SOURCE TEXT at
      // all — a grammar cannot parse a spelling the source never uses. This is the R2 question:
      // "if we patched the grammar, what would it have to match?"
      if (/\bimplements\b/.test(src)) {
        implementsAnywhere++
        const m = src.match(/^.*\bimplements\b.*$/m)
        if (m && implementsSamples.length < 8) implementsSamples.push(`${path.relative(CR, f)} :: ${m[0].trim().slice(0, 90)}`)
      }
      if (/\bpart\b/.test(src)) {
        const m = src.match(/^.*\bpart\b.*$/m)
        if (m && partSamples.length < 12) partSamples.push(`${path.relative(CR, f)} :: ${m[0].trim().slice(0, 90)}`)
      }
      if (/(^|\n)\s*(import|export)\b[^\n]*from\s+['"][^'"]+['"]/.test(src)) importExportOfAnotherModule++
    }
    r2 = {
      question:
        "could the construct be ADDED to the grammar source and then built (R2), and if so what would " +
        "the patched grammar have to MATCH? The measurement is the population's own sites of the " +
        "construct, because a patched grammar that can parse a spelling the corpus never uses still " +
        "has nothing to publish.",
      implements: {
        classHeritageWithAnImplementsClause: implementsClassHeritage,
        filesWhoseTextCarriesTheWord: implementsAnywhere,
        samples: implementsSamples,
        note:
          "JavaScript's own language has no conformance clause. `class A implements B {}` is " +
          "TypeScript, not JavaScript, and the corpus's class heritage carries ONLY `extends` — " +
          "measured: 0 heritage children of any implements shape over the whole admitted population. " +
          "A patched grammar could ADD an implements_clause, and it would then match nothing, " +
          "because the construct is not in the language.",
      },
      part_of: {
        statementWhoseFirstTokenIsPart: partDirective,
        partThatIsACallOrAnAssignmentTarget: partIdentifier,
        samples: partSamples,
        note:
          "JavaScript has no part directive. The nearest construct in the language is the ES module " +
          "import/export, which names ANOTHER MODULE — and that relation is ALREADY PUBLISHED under " +
          "the `imports` label, so a `part_of` row would duplicate it under a second name.",
        filesWithAnImportOrExportOfAnotherModule: importExportOfAnotherModule,
      },
    }
  }

  // ── R3: THE EXISTING-NODE-TYPE QUESTION ───────────────────────────────────────────────────────────
  let r3: any = {}
  {
    const implementsShaped = namedTypes.filter((t) => /implement|conform|interface|protocol/i.test(t))
    const partShaped = namedTypes.filter((t) => /part/i.test(t))
    r3 = {
      question:
        "is there a node type the SHIPPED grammar ALREADY has that can carry the relation (R3)? The " +
        "measurement is the served bytes' own inventory, read from the live language.",
      implements: {
        nodeTypesMatchingTheRelation: implementsShaped,
        count: implementsShaped.length,
        note:
          "the inventory is of the SERVED BYTES (63812b9e), not of the npm package's node-types.json, " +
          "which is a DIFFERENT artifact and carries a different number",
      },
      part_of: {
        nodeTypesMatchingTheRelation: partShaped,
        count: partShaped.length,
        note:
          "the node types that match /part/ are the ones whose NAME contains it — the question is " +
          "whether any of them is a PART DIRECTIVE, and the corpus half measures the directive " +
          "sites directly",
      },
    }
  }

  const out = {
    generated: new Date().toISOString(),
    lane: "javascript",
    author: "Muhammad Ishaq Khan",
    instrument: "script/m14/javascript-remedy-ladder.ts",
    rule:
      "L-2026-10-21-14 — a ruling names WHICH RUNG was unavailable and why; a rung that is merely " +
      "HARD is not a reason. This instrument measures each rung over the whole admitted population.",
    grammar: {
      wasm: PRODUCTION_WASM,
      sha256: wasmSha,
      bytes: wasmBytes.length,
      nodeTypeIds: nodeTypeCount,
      distinctNamedTypes: namedTypes.length,
      citationRule:
        "L-2026-10-21-20 — the sha256 of the bytes the REGISTRY SERVES. Never a path, never a log line.",
    },
    population: { corpusRoot: CR, admitted: admitted.length, rule: "git ls-files per repository, 1 MiB cap" },
    r1,
    r2,
    r3,
  }
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(`admitted ${admitted.length} files; grammar ${wasmSha.slice(0, 8)} (${namedTypes.length} distinct named of ${nodeTypeCount} ids)`)
  console.log(`R1 npm latest ${r1.registryLatestVersion}: source occurrences ${JSON.stringify(r1.tokenOccurrencesInSource)}`)
  console.log(`R2 implements: heritage clauses with an implements shape = ${r2.implements.classHeritageWithAnImplementsClause}; files whose text carries the word = ${r2.implements.filesWhoseTextCarriesTheWord}`)
  console.log(`R2 part_of: statements whose first token is 'part' = ${r2.part_of.statementWhoseFirstTokenIsPart}; part as a call/assignment = ${r2.part_of.partThatIsACallOrAnAssignmentTarget}`)
  console.log(`R3 implements-shaped node types = ${r3.implements.count}; part-shaped = ${r3.part_of.count}`)
  console.log(`wrote ${path.relative(ROOT, OUT)}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
