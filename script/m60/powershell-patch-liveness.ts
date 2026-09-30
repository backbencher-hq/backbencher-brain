/**
 * M60 — is each CLAIMED powershell grammar patch actually LIVE in the wired bytes?
 *
 * WHY THIS FILE EXISTS. Found by chasing a "native/product divergence" that turned out
 * not to be one. `git --git-dir="$R/.git" status` parses under the native CLI and
 * fails under web-tree-sitter, with the same grammar.js — so the first hypothesis was
 * a runtime lexer difference. It is not: web-tree-sitter 0.27.0 produces output
 * IDENTICAL to 0.25.9 for that case and for `-PS7`. The real cause is that the WIRED
 * WASM DOES NOT CONTAIN G10 AT ALL.
 *
 * Proven behaviourally, on the product artifact with the product runtime, using a case
 * only G10 introduces (`command_parameter` followed by a value with no separator):
 *
 *     Get-Thing --flag=$x   WIRED: MISSING ">" + a fabricated `redirection` node
 *                           NATIVE: clean
 *
 * That MISSING ">" is the exact failure G10 was written to fix, so its presence in the
 * wired bytes is the signature of a build from BEFORE G10. A boundary probe locates it
 * exactly: G1, G6, G7, G8 (both halves) and G9 are live; G10 is not.
 *
 * WHY NO GATE CAUGHT IT. `script/m14/verify-grammar-pins.ts` checks sha256, byte
 * length, surface ids/named/anon/fields, the vendored source tree, and source↔wasm via
 * generated node-types.json. The powershell record has NO `source: { state: "vendored" }`
 * entry, so checks 4 and 5 cannot run for this lane at all — the same gap the
 * objective-c record describes for itself before its own treatment. What remains is a
 * sha comparison, and the sha MATCHES, because the pin record was updated to claim G10
 * in the same change that added G10 to grammar.js while the artifact was never rebuilt.
 * The record and the source agree with each other and both disagree with the bytes.
 *
 * The C lane rejected the sha-only pin in exactly these words: "sha-only would leave
 * `macro_prefixed_objc_declaration`'s live-ness a matter of memory, which is the exact
 * failure the C record describes for its own lane." objective-c, c and fsharp each
 * resolved it with a three-build A/B (WIRED vs REBUILD vs PRISTINE) and recorded
 * surface AND behaviour. This file is the behaviour half of that, made re-runnable and
 * made to EXIT NON-ZERO, because a claim no instrument can object to is the defect.
 *
 * A patch that adds a NODE TYPE is caught by the surface digest the pin gate already
 * keeps. G10 adds none — it is a parser alternative — which is precisely why the
 * existing gate was blind to it and why this behavioural probe is the only thing that
 * can see it.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const WASM = path.join(ROOT, "wasm/tree-sitter-powershell.wasm")
const OUT = path.join(ROOT, "validation/m60/results/powershell-patch-liveness.json")

type Probe = {
  patch: string
  claim: string
  source: string
  /** What must be TRUE for the patch to be judged live in the wired bytes. */
  expect: { clean?: boolean; noNode?: string; hasNode?: string }
}

const PROBES: Probe[] = [
  { patch: "G1", claim: "a script-level param() after a `using` statement is a param_block",
    source: "using namespace System.Text\nparam(\n  [string]$Name\n)\n",
    expect: { clean: true } },
  { patch: "G5a/b", claim: "PS7 `??` and `? :`",
    source: "$a = 1\n$b = $a ?? 'fallback'\n$c = $a ? 1 : 2\n",
    expect: { clean: true } },
  { patch: "G5c", claim: "PS7 `?.` and `?[`",
    source: "$a = 1\n$b = $a?.Name\n$c = $a?[1,2]\n",
    expect: { clean: true } },
  { patch: "G6", claim: "a command argument list including a BARE WORD",
    source: "Get-Thing deb, rpm\n",
    expect: { clean: true } },
  { patch: "G7", claim: "a command ARGUMENT that is a sigil-led path",
    source: "Resolve-Path $PSScriptRoot/x.ps1\n",
    expect: { clean: true } },
  { patch: "G8a", claim: "`+` as .NET's nested-type separator",
    source: "$x = [System.Environment+SpecialFolder]\n",
    expect: { clean: true } },
  { patch: "G8b", claim: "`=` admitted to the DOUBLE-dash command_parameter class",
    source: "Get-Thing --flag=alnum\n",
    expect: { clean: true } },
  { patch: "G9", claim: "a bracketed generic type argument",
    source: "$x = [Dictionary[[string],[int]]]::New()\n",
    expect: { clean: true } },
  { patch: "G10", claim: "a value GLUED to a double-dash parameter, with no argument separator",
    source: "Get-Thing --flag=$x\n",
    expect: { clean: true } },
]

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(WASM)))

const missingOf = (root: any): string[] => {
  const out: string[] = []
  const walk = (n: any) => {
    if (n.isMissing) out.push(n.type)
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(root)
  return out
}

const results = PROBES.map((p) => {
  const tree = parser.parse(p.source)
  const s = tree.rootNode.toString()
  const missing = missingOf(tree.rootNode)
  const hasError = s.includes("ERROR")
  const nodes = [...s.matchAll(/\((\w+)/g)].map((m) => m[1])
  const failures: string[] = []
  if (p.expect.clean && (hasError || missing.length)) {
    failures.push(`expected clean, got ERROR=${hasError} MISSING=[${missing.join(",")}]`)
  }
  if (p.expect.noNode && nodes.includes(p.expect.noNode)) failures.push(`unexpected node ${p.expect.noNode}`)
  if (p.expect.hasNode && !nodes.includes(p.expect.hasNode)) failures.push(`missing node ${p.expect.hasNode}`)
  // The signature of a pre-G10 build: a glued value is STOLEN by `redirection`, which
  // is how G10's own comment describes the defect it fixes.
  const stolen = nodes.includes("redirection")
  return {
    patch: p.patch,
    claim: p.claim,
    source: p.source.replace(/\n/g, " ; "),
    hasError,
    missing,
    live: failures.length === 0,
    failures,
    redirectionFabrication: stolen,
  }
})

const notLive = results.filter((r) => !r.live)
const out = {
  instrument: "m60-powershell-patch-liveness",
  question:
    "Is every patch the pin record CLAIMS actually present in the wired bytes this lane measures with?",
  whyNotSha: results.every((r) => r.live)
    ? "all claimed patches are behaviourally live"
    : "the pin record and grammar.js agree with each other and both disagree with the bytes; a sha comparison cannot see that, because the record was updated in the same change that added the patch to the source",
  wasm: { path: path.relative(ROOT, WASM), bytes: readFileSync(WASM).length },
  totals: { probes: results.length, live: results.length - notLive.length, NOT_LIVE: notLive.length },
  notLive: notLive.map((r) => ({ patch: r.patch, claim: r.claim, failures: r.failures })),
  results,
  precedent:
    "objective-c, c and fsharp each settled the same question with a three-build A/B (WIRED vs REBUILD vs PRISTINE) recording surface AND behaviour. The C lane rejected a sha-only pin for exactly this reason. This is the behaviour half, re-runnable, and it exits non-zero.",
}
import { mkdirSync, writeFileSync } from "node:fs"
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")

console.log(`  powershell patch liveness — wired wasm ${out.wasm.bytes} B`)
for (const r of results) {
  console.log(`    ${r.live ? "LIVE    " : "NOT LIVE"}  ${r.patch.padEnd(6)} ${r.claim.slice(0, 62)}`)
  if (!r.live) for (const f of r.failures) console.log(`              ${f}`)
}
console.log(`\n  ${out.totals.live}/${out.totals.probes} claimed patches are live in the bytes`)
console.log(`  wrote ${path.relative(ROOT, OUT)}`)
if (notLive.length) {
  console.error(`\n  PIN NOT HONEST: ${notLive.length} claimed patch(es) are not in the wired bytes: ${notLive.map((r) => r.patch).join(", ")}`)
  console.error("  The pin record claims them. Either rebuild the wasm from the current grammar.js, or correct the record.")
  process.exit(1)
}
