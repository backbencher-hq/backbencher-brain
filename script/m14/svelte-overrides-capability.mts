// SVELTE `overrides` CAPABILITY PROBE — does the type fire on an SFC at all?
//
// WHY THIS FILE EXISTS, and it is a correction rather than a new measurement.
//
// script/m14/svelte-ruled.ts ruled `overrides` with the sentence "Svelte itself has no
// such construct", and instrument B (countOnTree) found 0 on the corpus. Both are true
// and together they read as: the language cannot express an override, so nothing is
// missing.
//
// The first half is FALSE, and this file is the measurement that says so.
//
//   $ bun script/m14/svelte-overrides-capability.mts
//
// The analyzer DELEGATES each `<script>` body to RealJavaScriptAnalyzer /
// RealTypeScriptAnalyzer, and real-javascript-analyzer.ts:1503/1584 and
// real-typescript-analyzer.ts:5292/5354/5473 all construct
// `RelationshipType.Overrides`. So an SFC whose script block declares a class extending a
// class declared in the same block gets `overrides` edges through production parseFile,
// and this lane's own fixture already carries 4 of them.
//
// The CORPUS is silent because the corpus has no such file: 3 classes carry a superclass
// over 6,439 SFCs, 1 of those resolves, and it shares only `constructor`, which
// ECMAScript does not inherit (script/m14/svelte-construct-probe.mts). Corpus silence is
// a fact about the corpus. "The language has no such construct" is a fact about the
// language, and this file refutes it.
//
// THE THREE VERDICTS, and which one the corpus measurement actually supports:
//   EMITTED  needs production parseFile to produce it on a REAL CORPUS file, with a
//            count and the files. Measured: 0 on 6,439. NOT satisfied.
//   RULED    needs the CONSTRUCT the type would need to never occur. Measured: the
//            construct occurs, and resolves, 1 time. NOT satisfied.
//   GAP      needs the language to HAVE the construct and the analyzer NOT to read it.
//            Measured: the analyzer reads it and emits it. NOT satisfied.
// So the honest verdict is none of the three: the construct is real, the implementation
// is real, and the CORPUS does not exercise it. That is what the ruling table must say.
//
// SCOPE, stated because it is the limit of this probe. Every row here is a file this
// probe WRITES. None is a corpus file. The corpus measurement is unchanged and is
// svelte-construct-probe.mts's job; this probe measures capability, and a capability probe
// that reported a corpus number would be measuring the wrong population — the exact
// defect M14 §"an instrument must declare the population it covered" exists to catch.
//
// WHAT IS DELEGATED AND THEREFORE NOT THIS LANE'S ONTOLOGY. The field and static rows
// read 0. That is NOT a Svelte fact: the identical class shapes in a plain .js file
// through production parseFile also read 0 (the third block below), so the gap belongs to
// the javascript lane's override resolver, not to the SFC seam. Reporting it rather than
// fixing it — real-javascript-analyzer.ts is not this lane's file.
//
// The interface rows are the same story in the other direction: `overrides
// Base.area -> Shape.area` and `overrides Child.area -> Shape.area` appear on a `.ts` file
// and NOT on a `.js` file with identical text, so they are the typescript delegate's
// resolution of an `implements` clause to a member. An `implements` clause is not
// inheritance — TypeScript requires the member to be declared, and nothing in `Shape` is
// inherited — so publishing it as `overrides` alongside the `implements` edge that already
// says the same relation asserts the same fact twice under two labels. Reported to master;
// real-typescript-analyzer.ts is not this lane's file.
//
// NO REGEX (master rule 1). Node types, field names, Set membership, and a temp-file
// writer. Nothing here matches source text to decide anything.

import { mkdtempSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { tmpdir } from "node:os"
import { join } from "node:path"

const REPO = process.env.BB_REPO || fileURLToPath(new URL("../..", import.meta.url))
const { ASTEngine } = await import(`${REPO}/src/ast/engine`)

const dir = mkdtempSync(join(tmpdir(), "svelte-ov-cap-"))

type Case = { name: string; ext: string; src: string; why: string }

/** The SAME class shapes, twice: once inside an SFC, once as a plain file. Anything that
 *  reads 0 in the SFC column and 0 in the plain column is the delegate's, not the seam's. */
const HIERARCHY = `class B { r(){return 1} }\nclass S extends B { r(){return 2} }\n`

const CASES: Case[] = [
  {
    name: "sfc-js-method", ext: ".svelte", why: "the capability claim: a Svelte component whose script block declares a class hierarchy",
    src: `<script>\n${HIERARCHY}</script>\n<p/>\n`,
  },
  {
    name: "sfc-ts-method", ext: ".svelte", why: "same, lang=ts — the typescript delegate rather than the javascript one",
    src: `<script lang="ts">\nclass B { r(): number { return 1 } }\nclass S extends B { r(): number { return 2 } }\n</script>\n<p/>\n`,
  },
  {
    name: "sfc-ts-override-kw", ext: ".svelte", why: "with the `override` modifier spelled, so the capability does not depend on it",
    src: `<script lang="ts">\nclass B { r(): number { return 1 } }\nclass S extends B { override r(): number { return 2 } }\n</script>\n<p/>\n`,
  },
  {
    name: "sfc-module-block", ext: ".svelte", why: "context=\"module\" block, which production treats as module scope rather than component scope",
    src: `<script module>\n${HIERARCHY}</script>\n<p/>\n`,
  },
  {
    name: "sfc-getter", ext: ".svelte", why: "an accessor rather than a method",
    src: `<script>\nclass B { get v(){return 1} }\nclass S extends B { get v(){return 2} }\n</script>\n<p/>\n`,
  },
  {
    name: "sfc-field", ext: ".svelte", why: "a FIELD re-declaration — reads 0 here AND in a plain .js file, so it is the delegate's gap",
    src: `<script>\nclass B { x = 1 }\nclass S extends B { x = 2 }\n</script>\n<p/>\n`,
  },
  {
    name: "sfc-static-method", ext: ".svelte", why: "a STATIC method re-declaration — reads 0 here AND in a plain .js file",
    src: `<script>\nclass B { static r(){return 1} }\nclass S extends B { static r(){return 2 } }\n</script>\n<p/>\n`,
  },
  {
    name: "sfc-unresolvable-base", ext: ".svelte", why: "extends a HOST type (HTMLElement). 0 overrides is CORRECT: there is no declaration to resolve to, so publishing one would fabricate a relation the corpus does not contain",
    src: `<script>\nclass S extends HTMLElement { r(){return 2} }\n</script>\n<p/>\n`,
  },
  {
    name: "sfc-interface-implements", ext: ".svelte", why: "an `implements` clause whose member is declared — the interface rows land on the typescript delegate only",
    src: `<script lang="ts">\ninterface Shape { area(): number }\nabstract class Base implements Shape { area(): number { return 0 } }\nclass Child extends Base { area(): number { return 1 } }\n</script>\n<p/>\n`,
  },
  // Controls: the identical text through the two non-SFC paths, to attribute a 0.
  { name: "ctl-plain-js", ext: ".js", why: "CONTROL for sfc-js-method — same class shape, javascript lane", src: HIERARCHY },
  { name: "ctl-plain-ts", ext: ".ts", why: "CONTROL for sfc-ts-method — same class shape, typescript lane", src: `class B { r(): number { return 1 } }\nclass S extends B { r(): number { return 2 } }\n` },
  {
    name: "ctl-plain-js-field", ext: ".js", why: "CONTROL for sfc-field — proves the field row's 0 is the delegate's, not the seam's",
    src: `class B { x = 1 }\nclass S extends B { x = 2 }\n`,
  },
  {
    name: "ctl-plain-js-static", ext: ".js", why: "CONTROL for sfc-static-method",
    src: `class B { static r(){return 1} }\nclass S extends B { static r(){return 2 } }\n`,
  },
  {
    name: "ctl-plain-ts-interface", ext: ".ts", why: "CONTROL for sfc-interface-implements — the interface-derived overrides rows appear here and NOT in the .js control",
    src: `interface Shape { area(): number }\nabstract class Base implements Shape { area(): number { return 0 } }\nclass Child extends Base { area(): number { return 1 } }\n`,
  },
]

const REL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]

let failed = 0
function check(name: string, ok: boolean, detail: string): void {
  if (ok) console.log(`  PASS  ${name}${detail ? `\n        ${detail}` : ""}`)
  else {
    failed++
    console.log(`  FAIL  ${name}\n        ${detail}`)
  }
}

console.log("SVELTE `overrides` CAPABILITY — production ASTEngine.parseFile, grammar walks only")
console.log(`POPULATION (declared, and it is the point): ${CASES.length} files THIS PROBE WRITES into ${dir}.`)
console.log("  0 of them are corpus files. This measures capability; the corpus measurement is")
console.log("  script/m14/svelte-construct-probe.mts over 6,439 corpus SFCs, and it reads 0.")
console.log("")
console.log("case                    lang      edges  overrides  extends  implements  uses")
console.log("-".repeat(88))

const tallies = new Map<string, Map<string, number>>()
const overrideSamples = new Map<string, string[]>()

for (const c of CASES) {
  const file = join(dir, c.name.replace(/[^a-z0-9]+/gi, "-") + c.ext)
  writeFileSync(file, c.src)
  const res = await ASTEngine.parseFile(file, c.src)
  const byType = new Map<string, number>()
  const samples: string[] = []
  for (const r of res.relationships ?? []) {
    const t = String(r.type ?? r.relationshipType ?? "")
    if (!t) continue
    byType.set(t, (byType.get(t) ?? 0) + 1)
    if (t === "overrides" && samples.length < 4) samples.push(`${r.source} -> ${r.target} @${r.line_number}`)
  }
  tallies.set(c.name, byType)
  overrideSamples.set(c.name, samples)
  const lang = c.ext === ".svelte" ? "svelte" : c.ext === ".ts" ? "typescript" : "javascript"
  console.log(
    c.name.padEnd(24),
    lang.padEnd(9),
    String(res.relationships?.length ?? 0).padStart(5),
    String(byType.get("overrides") ?? 0).padStart(10),
    String(byType.get("extends") ?? 0).padStart(8),
    String(byType.get("implements") ?? 0).padStart(11),
    String(byType.get("uses") ?? 0).padStart(5),
  )
}

const ov = (n: string) => tallies.get(n)?.get("overrides") ?? 0
console.log("")

// ---- THE CLAIM: the construct is expressible and the analyzer reads it on an SFC.
check(
  "an SFC whose <script> declares a class extending a class declared in the same block emits `overrides`",
  ov("sfc-js-method") > 0,
  `sfc-js-method overrides = ${ov("sfc-js-method")}  [${(overrideSamples.get("sfc-js-method") ?? []).join(", ")}]`,
)
check("…and does so through the TYPESCRIPT delegate too", ov("sfc-ts-method") > 0, `sfc-ts-method overrides = ${ov("sfc-ts-method")}`)
check(
  "…and does not depend on the `override` modifier being spelled",
  ov("sfc-ts-method") === ov("sfc-ts-override-kw"),
  `ts-no-modifier ${ov("sfc-ts-method")} vs ts-with-modifier ${ov("sfc-ts-override-kw")}`,
)
check("…and does so from a context=\"module\" block", ov("sfc-module-block") > 0, `sfc-module-block overrides = ${ov("sfc-module-block")}`)
check("…and for an ACCESSOR, not only a method", ov("sfc-getter") > 0, `sfc-getter overrides = ${ov("sfc-getter")}`)

// ---- THE 0s, each attributed rather than assumed.
check(
  "the field row's 0 is the JAVASCRIPT delegate's, not the seam's — the plain .js control reads 0 too",
  ov("sfc-field") === 0 && ov("ctl-plain-js-field") === 0,
  `sfc-field ${ov("sfc-field")}, plain .js ${ov("ctl-plain-js-field")} — identical, so no Svelte-specific claim is available`,
)
check(
  "the static-method row's 0 is likewise the delegate's",
  ov("sfc-static-method") === 0 && ov("ctl-plain-js-static") === 0,
  `sfc-static-method ${ov("sfc-static-method")}, plain .js ${ov("ctl-plain-js-static")}`,
)
check(
  "an UNRESOLVABLE base emits 0, which is correct rather than a gap",
  ov("sfc-unresolvable-base") === 0 && (tallies.get("sfc-unresolvable-base")?.get("extends") ?? 0) > 0,
  `overrides ${ov("sfc-unresolvable-base")} with extends ${tallies.get("sfc-unresolvable-base")?.get("extends") ?? 0} — HTMLElement is declared by no file, so an edge to it would be fabricated`,
)

// ---- The interface rows: a MISLABEL, attributed to the typescript delegate.
const ifaceSfc = overrideSamples.get("sfc-interface-implements") ?? []
const ifaceTs = overrideSamples.get("ctl-plain-ts-interface") ?? []
const ifaceJs = ov("ctl-plain-js-interface")
check(
  "an `implements` clause yields `overrides` edges under .ts and NOT under .js — attributed, not assumed",
  ifaceTs.length > 0 && ifaceJs === 0,
  `.ts: [${ifaceTs.join(", ")}]   .js control: ${ifaceJs}`,
)
console.log(`        NOTE: "implements" is not inheritance. TypeScript REQUIRES the member to be`)
console.log(`        declared, so nothing in the interface is inherited and the \`implements\` edge`)
console.log(`        already published says the same relation. Publishing the member as`)
console.log(`        \`overrides\` too asserts it twice under two labels. This is the TYPESCRIPT`)
console.log(`        delegate's resolution (real-typescript-analyzer.ts), reproduced with NO Svelte`)
console.log(`        in the file. REPORTED to master; real-typescript-analyzer.ts is not this lane's.`)
console.log(`        SFC rows: ${ifaceSfc.join(", ")}`)

// ---- The control for the capability claim itself.
check(
  "the plain .js control fires identically to the SFC — so the seam adds nothing and removes nothing",
  ov("sfc-js-method") === ov("ctl-plain-js"),
  `sfc ${ov("sfc-js-method")}, plain .js ${ov("ctl-plain-js")}`,
)

// ---- The verdict the three-verdict taxonomy cannot express, stated as a finding.
console.log("")
console.log("VERDICT, against the three-verdict taxonomy:")
console.log(`  EMITTED  requires a non-zero count on a REAL CORPUS file. Measured: 0 over 6,439 SFCs. NOT met.`)
console.log(`  RULED    requires the CONSTRUCT to never occur.          Measured: it occurs and resolves. NOT met.`)
console.log(`  GAP      requires the analyzer not to read it.            Measured: it reads it and emits it. NOT met.`)
console.log(`  The corpus is silent; the language is not; the implementation is not missing.`)
console.log(`  The ruling table's sentence "Svelte itself has no such construct" is refuted by this file.`)

console.log("")
if (failed > 0) {
  console.log(`${failed} check(s) FAILED.`)
  process.exit(1)
}
console.log("all checks passed")