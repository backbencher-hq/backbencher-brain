/**
 * GRAMMAR CONFORMANCE — does the WIRED wasm correspond to the UPSTREAM source?
 *
 * The question this answers is the one the Groovy lane had to answer the hard
 * way: `wasm/tree-sitter-make.wasm` is an unversioned blob in the repo, and an
 * analyzer written against node types it does not actually have will look
 * correct on fixtures and be wrong on every real Makefile. A vendored grammar
 * that has DRIFTED from the wired bytes is the failure this exists to catch.
 *
 * Method (the hcl lane's, unchanged): read the wasm's own enumerable surface
 * through web-tree-sitter's `Language` API — every node-kind id, whether it is
 * named, and every field id — and compare it, in BOTH directions, with the
 * source's declared `src/node-types.json`. Zero missing and zero extra on named
 * types and on fields is the proof that the wired bytes are a build of this
 * source. One direction only would hide a renamed or deleted type.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { Parser, Language } from "web-tree-sitter"

const REPO = "<corpus-root>/backbencher-brain"
const SRC = "<corpus-root>/backbencher-brain/grammars/tree-sitter-make"
const OUT = "<corpus-root>/bb_tests/make/out"
const WASM = `${REPO}/wasm/tree-sitter-make.wasm`

await Parser.init()
const lang = await Language.load(WASM)

// ---- the wired surface, read from the wasm itself -------------------------
const ids: string[] = []
const named: string[] = []
const anon: string[] = []
for (let i = 0; i < lang.nodeTypeCount; i++) {
  const name = String(lang.nodeTypeForId(i) ?? "")
  const isNamed = !!lang.nodeTypeIsNamed(i)
  ids.push(`${i}\u0000${name}\u0000${isNamed ? 1 : 0}`)
  ;(isNamed ? named : anon).push(name)
}
const fields: string[] = []
for (let i = 1; i <= lang.fieldCount; i++) {
  const f = lang.fieldNameForId(i)
  if (f) fields.push(f)
}
const wiredNamed = [...new Set(named)].sort()
const wiredAnon = [...new Set(anon)].sort()
const wiredFields = [...new Set(fields)].sort()

// ---- the source's declared surface ---------------------------------------
const nt = JSON.parse(readFileSync(`${SRC}/src/node-types.json`, "utf8"))
const srcNamed = [...new Set(nt.filter((x: any) => x.named).map((x: any) => x.type))].sort()
const srcAnon = [...new Set(nt.filter((x: any) => !x.named).map((x: any) => x.type))].sort()
const srcFields = [...new Set(nt.flatMap((x: any) => Object.keys(x.fields ?? {})))].sort()

const missingNamed = srcNamed.filter((t) => !wiredNamed.includes(t))
const extraNamed = wiredNamed.filter((t) => !srcNamed.includes(t))
const missingAnon = srcAnon.filter((t) => !wiredAnon.includes(t))
const extraAnon = wiredAnon.filter((t) => !srcAnon.includes(t))
const missingFields = srcFields.filter((f) => !wiredFields.includes(f))
const extraFields = wiredFields.filter((f) => !srcFields.includes(f))

// ---- how many of those types does the ANALYZER actually name? ------------
// A grammar can match perfectly and still be mostly unused: the interesting
// number is not "does it match" but "how much of it is read". An analyzer that
// names 12 of 44 types is 12 types away from a behaviour change.
const analyzerSrc = readFileSync(`${REPO}/src/ast/real-makefile-analyzer.ts`, "utf8")
const analyzerTypes = [...new Set([...analyzerSrc.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!))]
  .filter((t) => srcNamed.includes(t) || srcAnon.includes(t))
  .sort()
const namedNeverNamed = srcNamed.filter((t) => !analyzerTypes.includes(t))

const report = {
  wired: {
    wasm: "wasm/tree-sitter-make.wasm",
    bytes: readFileSync(WASM).length,
    nodeTypeCount: lang.nodeTypeCount,
    namedUnique: wiredNamed.length,
    anonUnique: wiredAnon.length,
    fieldCount: wiredFields.length,
  },
  source: {
    repo: "tree-sitter-grammars/tree-sitter-make",
    rev: "70613f3d812cbabbd7f38d104d60a409c4008b43",
    namedUnique: srcNamed.length,
    anonUnique: srcAnon.length,
    fieldCount: srcFields.length,
    parserCShipped: existsSync(`${SRC}/src/parser.c`),
  },
  drift: {
    named: { missing: missingNamed, extra: extraNamed },
    anon: { missing: missingAnon, extra: extraAnon },
    fields: { missing: missingFields, extra: extraFields },
    matches:
      missingNamed.length === 0 && extraNamed.length === 0 &&
      missingFields.length === 0 && extraFields.length === 0,
  },
  analyzerCoverage: {
    typesReferenced: analyzerTypes.length,
    namedTypesInGrammar: srcNamed.length,
    namedNeverReferenced: namedNeverNamed,
    namedReferenced: srcNamed.filter((t) => analyzerTypes.includes(t)),
  },
  namedTypes: srcNamed,
  fields: srcFields,
}
/**
 * The A/B basis must be REPRODUCIBLE FROM THE REPO, not from one machine's
 * scratch directory. `ab/pristine-grammar.js` + `ab/grammar.patch` must
 * regenerate the wired `grammar.js` byte for byte, and `ab/pristine-make.wasm`
 * must be the build those two produce -- the build the wired wasm was compared
 * against. Without this check the vendored patch could rot while the docs kept
 * claiming the comparison was re-runnable.
 */
const AB = `${SRC}/ab`
const abPresent = existsSync(`${AB}/pristine-grammar.js`) && existsSync(`${AB}/grammar.patch`) && existsSync(`${AB}/pristine-make.wasm`)
let abReproducesWiredSource: boolean | null = null
let abPristineSha = ""
if (abPresent) {
  const tmp = mkdtempSync(join(tmpdir(), "make-ab-"))
  try {
    writeFileSync(join(tmp, "grammar.js"), readFileSync(`${AB}/pristine-grammar.js`, "utf8"))
    try {
      execFileSync("git", ["apply", "-p1", `${AB}/grammar.patch`], { cwd: tmp, stdio: "pipe" })
      abReproducesWiredSource =
        readFileSync(join(tmp, "grammar.js"), "utf8") === readFileSync(`${SRC}/grammar.js`, "utf8")
    } catch {
      abReproducesWiredSource = false
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  abPristineSha = createHash("sha256").update(readFileSync(`${AB}/pristine-make.wasm`)).digest("hex")
}
;(report as any).abBasis = {
  dir: "grammars/tree-sitter-make/ab",
  present: abPresent,
  pristineSha256: abPristineSha,
  pristineShaMatchesPin: abPristineSha === "e85bd50b8182497c311fd72c4441b530ff437421176b64114faf532641534fff",
  patchReproducesWiredGrammarJs: abReproducesWiredSource,
  note:
    "pristine-grammar.js + grammar.patch must regenerate the wired grammar.js byte for byte, and pristine-make.wasm must be the build they produce -- the build the wired wasm was A/B'd against. Checked here so the retained basis cannot rot unnoticed.",
}

writeFileSync(`${OUT}/grammar-conformance.json`, JSON.stringify(report, null, 2) + "\n")

console.log(`wired   : ids=${lang.nodeTypeCount} named=${wiredNamed.length} anon=${wiredAnon.length} fields=${wiredFields.length}`)
console.log(`source  : named=${srcNamed.length} anon=${srcAnon.length} fields=${srcFields.length}`)
console.log(`MATCH   : ${report.drift.matches ? "yes — the wired bytes are a build of this source" : "NO"}`)
if (!report.drift.matches) {
  console.log(`  named  missing=${JSON.stringify(missingNamed)} extra=${JSON.stringify(extraNamed)}`)
  console.log(`  fields missing=${JSON.stringify(missingFields)} extra=${JSON.stringify(extraFields)}`)
}
const ab: any = (report as any).abBasis
console.log(`A/B basis : present=${ab.present} patch-regenerates-wired-grammar.js=${ab.patchReproducesWiredGrammarJs} pristine-sha-matches-pin=${ab.pristineShaMatchesPin}`)
console.log(`analyzer: names ${report.analyzerCoverage.typesReferenced} of ${srcNamed.length} declared named types`)
console.log(`  never referenced by the analyzer: ${namedNeverNamed.join(", ") || "(none)"}`)
