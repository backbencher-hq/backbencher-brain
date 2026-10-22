#!/usr/bin/env bun
/**
 * SCALA PINNED-GRAMMAR NODE-TYPE INVENTORY — the GRAMMAR-SIDE half of the all-out-of-all bar
 * (L-2026-10-21-05, L-2026-10-21-06), for the SCALA lane.
 *
 * WHY THIS FILE IS LANE-OWNED. The shared census instrument `.tmp-census/grammar.mts` writes ONE
 * `grammar-nodes.json` for a fixed language list, so running it for scala would OVERWRITE the
 * fleet's shared artifact with a one-language file. This instrument is the scala lane's own and
 * writes only into `validation/m14/measurements/`.
 *
 * ★ THE ZERO-EMISSION FACT IS A CLAIM ABOUT TWO SUBJECTS, AND THIS FILE MEASURES THE HARD ONE.
 *   "The analyzer never emits it" is a claim about the ANALYZER, and an analyzer that merely lacks
 *   an emission site is an UNIMPLEMENTED type — a GAP, which does NOT shrink the denominator. Only
 *   the GRAMMAR-side half (the LANGUAGE has no such construct, measured over the grammar's OWN
 *   node-type inventory) makes it an exclusion. So this file enumerates the node types of the
 *   grammar the production analyzer actually loads, and the gate's GRAMMAR_SIDE check is satisfied
 *   only by a citation that names such an inventory.
 *
 * THE THREE ADMISSIBILITY TESTS THIS FILE SATISFIES (L-2026-10-21-06):
 *   1. THE BUILD TEST (L-05) — the SHA-256 OF THE BYTES THE REGISTRY SERVES, printed BESIDE the
 *      node-type count enumerated from the SAME build, plus the sha256 of the file at the resolved
 *      path and an explicit AGREEMENT check. A citation that names a build nobody loaded is prose.
 *   2. THE POSITIVE CONTROL — the same scan run over grammars that DO carry the constructs
 *      (typescript `implements_clause`, dart `mixin_application` + `part_directive`, python
 *      `decorator`, tsx `jsx_element`). A scan that finds nothing everywhere is a broken scan, so
 *      the controls must FIRE, or this file's absences are artefacts of the scan.
 *   3. THE NEAR-MISS TEST — a near-miss construct is NAMED AND COUNTED, never merely absent. The
 *      near-misses are printed as full inventories, so the reader sees what the grammar HAS in the
 *      neighbourhood of the absent construct.
 *
 * THE CANDIDATE FAMILIES, ONE PER TYPE THE LANE MUST DISPOSITION. The five are the four EXTENDED
 * values plus `implements` (the canonical value the fleet MIXIN RULING relabelled for scala), and
 * for each the families are the node types that would have to EXIST for the construct to reach an
 * analyzer as a real node.
 *
 * Usage: bun run script/m14/scala-grammar-inventory.ts [--json]
 */
import { writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

import { getParser } from "../../src/ast/engine"
import { resolveWasmAsset, hasWasmInRegistry } from "../../src/util/wasm"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
const OUT_DIR = path.join(ROOT, "validation", "m14", "measurements")
const OUT_PATH = path.join(OUT_DIR, "scala-grammar-inventory.json")

const sha256 = (b: Uint8Array | Buffer): string => createHash("sha256").update(b).digest("hex")

/** THE CANDIDATE NODE FAMILIES, one per type the lane must disposition. */
const CANDIDATES: Record<string, string[]> = {
  // `implements` — a conformance declaration with NO composition semantics. Scala's supertype
  // clause is `extends_clause`; the construct that would carry a conformance-without-composition
  // is the SELF-TYPE (`trait T { this: Foo => }`), which is a conformance REQUIREMENT with no
  // supertype position. The families below are every shape that could carry it.
  implements: [
    "implements_clause", "implements_list", "interface_specifier", "super_interfaces",
    "self_type", "self_type_clause", "self", "this_type", "refinement", "template_body",
    "extends_clause", "class_definition", "trait_definition", "mixin_definition",
  ],
  // `decorates` — a decorator applied TO a declaration. Scala's near miss is the ANNOTATION
  // (`@main`, `@deprecated`), which the JVM reads as metadata.
  decorates: [
    "decorator", "decorators", "decorated_definition", "annotation", "annotations",
    "annotation_argument", "marker_annotation", "class_annotation", "modifiers",
  ],
  // `renders` — a component rendering another component. Scala has no markup/template layer.
  renders: [
    "jsx_element", "jsx_self_closing_element", "jsx_fragment", "template_element",
    "razor_element", "html_element", "xml_element", "element", "render_element",
    "component_element", "view_element", "sbt_task",
  ],
  // `part_of` — a library unit INCLUDING a part file. Scala has no part directive.
  part_of: [
    "part_directive", "part_of_directive", "part_file", "part_definition", "package_object",
    "package_clause", "package_identifier", "export_declaration", "extension_definition",
  ],
  // `mixes_in` — a mixin composed into a supertype chain. Scala's near miss is the `with` list
  // inside `extends_clause`, which the analyzer already publishes as `mixes_in`.
  mixes_in: [
    "mixin_application", "mixins", "mixin_definition", "mixin_body", "with_clause",
    "extends_clause", "class_definition", "trait_definition",
  ],
}

/** THE POSITIVE CONTROLS — grammars that DO carry the construct, so the scan is proved live. */
const CONTROLS: Array<{ lang: string; spelling: string; expect: string[]; why: string }> = [
  { lang: "typescript", spelling: "tree-sitter-typescript.wasm", expect: ["implements_clause"],
    why: "typescript HAS an implements clause — the scan must FIND it, or the scan is blind" },
  { lang: "dart", spelling: "tree-sitter-dart.wasm", expect: ["mixin_application", "part_directive"],
    why: "dart HAS a mixin application and a part directive — the scan must FIND both" },
  { lang: "python", spelling: "tree-sitter-python.wasm", expect: ["decorator"],
    why: "python HAS a decorator — the scan must FIND it" },
  { lang: "tsx", spelling: "tree-sitter-tsx.wasm", expect: ["jsx_element"],
    why: "tsx HAS a jsx element — the scan must FIND it" },
]

type Inventory = {
  spelling: string
  registrySha256: string | null
  fileSha256: string | null
  resolvedPath: string
  pathExists: boolean
  agree: boolean
  totalIds: number
  namedCount: number
  named: string[]
  anonymous: string[]
}

async function inventoryOf(lang: string, spelling: string): Promise<Inventory> {
  // THE REGISTRY'S BYTES FIRST (L-20/L-11): the citation is the digest of what the engine SERVES.
  const bytes = hasWasmInRegistry(spelling)
  const registrySha = bytes && bytes.length ? sha256(bytes) : null
  const resolvedPath = resolveWasmAsset(spelling)
  let fileSha: string | null = null
  let pathExists = false
  try {
    fileSha = sha256(readFileSync(resolvedPath))
    pathExists = true
  } catch { /* the resolved path is not readable from here */ }

  const parser = await getParser(lang as any)
  const language = (parser as any).language
  if (!language) throw new Error(`NO LANGUAGE for ${lang} — the pinned grammar did not load`)
  const totalIds: number = language.nodeTypeCount
  const named: string[] = []
  const anon: string[] = []
  // ★ `nodeTypeIsNamed(id)` IS THE ACCESSOR. `nodeTypeForId(id)` returns the type NAME as a STRING,
  //   and a string has no `.named`, so `t.named` counts EVERY type as anonymous. THE TELL is that
  //   TOTAL agrees with a prior measurement while the named-count is 0.
  for (let id = 1; id < totalIds; id++) {
    const t = language.nodeTypeForId(id)
    if (t == null) continue
    if (language.nodeTypeIsNamed(id)) named.push(t)
    else anon.push(t)
  }
  named.sort()
  anon.sort()
  return {
    spelling, registrySha256: registrySha, fileSha256: fileSha, resolvedPath, pathExists,
    agree: registrySha !== null && fileSha !== null && registrySha === fileSha,
    totalIds, namedCount: named.length, named, anonymous: anon,
  }
}

const scala = await inventoryOf("scala", "tree-sitter-scala.wasm")
const scalaSet = new Set(scala.named)

const presence: Record<string, { present: string[]; absent: string[] }> = {}
for (const [value, cands] of Object.entries(CANDIDATES)) {
  presence[value] = {
    present: cands.filter((c) => scalaSet.has(c)),
    absent: cands.filter((c) => !scalaSet.has(c)),
  }
}

/** EVERY named node type containing a candidate stem — the positive inventory beside the absence. */
const STEMS = [
  "implements", "interface", "self", "refinement", "extend", "mixin", "with", "decorat",
  "annotat", "render", "template", "jsx", "xml", "part", "partial", "package", "export",
  "element", "tag",
  // ★ THE STEMS THE THREE SCALA RULINGS TURN ON, ADDED SO THE CITED ARTEFACT COVERS EVERY
  //   STEM THE VERIFICATION PAGES NAME. `include` is sbt's build-file inclusion directive —
  //   the nearest thing scala has to "a file that is PART OF another" — and it is measured
  //   here because the `part_of` ruling must show the construct is ABSENT FROM THE GRAMMAR,
  //   not merely unused: `include "other.sbt"` parses as an ERROR node.
  "include", "view", "component", "razor", "html",
]
const stemHits: Record<string, string[]> = {}
for (const s of STEMS) stemHits[s] = scala.named.filter((n) => n.includes(s))

/** THE POSITIVE CONTROLS. */
const controlResults: Array<Record<string, unknown>> = []
for (const c of CONTROLS) {
  try {
    const inv = await inventoryOf(c.lang, c.spelling)
    const set = new Set(inv.named)
    controlResults.push({
      lang: c.lang,
      spelling: c.spelling,
      registrySha256: inv.registrySha256,
      namedCount: inv.namedCount,
      totalIds: inv.totalIds,
      expected: c.expect,
      found: c.expect.filter((e) => set.has(e)),
      missing: c.expect.filter((e) => !set.has(e)),
      controlFired: c.expect.every((e) => set.has(e)),
      why: c.why,
    })
  } catch (e) {
    controlResults.push({ lang: c.lang, spelling: c.spelling, controlFired: false, error: String(e).slice(0, 200), why: c.why })
  }
}

const report = {
  lane: "scala",
  generatedAt: new Date().toISOString(),
  grammar: {
    spelling: "tree-sitter-scala.wasm",
    registrySha256: scala.registrySha256,
    fileSha256: scala.fileSha256,
    resolvedPath: scala.resolvedPath,
    pathExists: scala.pathExists,
    agree: scala.agree,
  },
  nodeTypeCount: scala.totalIds,
  namedCount: scala.namedCount,
  named: scala.named,
  anonymousCount: scala.anonymous.length,
  candidatePresence: presence,
  stemHits,
  positiveControls: controlResults,
  controlsAllFired: controlResults.every((c) => c.controlFired === true),
  buildTest: {
    rule: "L-2026-10-21-05 — the SHA-256 of the bytes the REGISTRY SERVES, beside the node-type count enumerated from the SAME build",
    registrySha256: scala.registrySha256,
    fileSha256: scala.fileSha256,
    agree: scala.agree,
    namedCount: scala.namedCount,
    totalIds: scala.totalIds,
  },
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT_PATH, JSON.stringify(report, null, 1))

console.log(`SCALA PINNED-GRAMMAR INVENTORY`)
console.log(`  spelling              ${scala.spelling}`)
console.log(`  registry sha256       ${scala.registrySha256 ?? "(none served)"}`)
console.log(`  file sha256           ${scala.fileSha256 ?? "(unreadable)"}`)
console.log(`  AGREE                 ${scala.agree ? "YES" : "NO — a citation on either digest would be FALSE"}`)
console.log(`  resolved path         ${scala.resolvedPath}`)
console.log(`  node type ids         ${scala.totalIds}`)
console.log(`  NAMED node types      ${scala.namedCount}`)
console.log(`  written               ${path.relative(ROOT, OUT_PATH)}`)
console.log("")
console.log(`  CANDIDATE NODE PRESENCE`)
for (const [value, p] of Object.entries(presence)) {
  console.log(`  ${value}:`)
  for (const c of CANDIDATES[value]) console.log(`    ${scalaSet.has(c) ? "PRESENT" : "ABSENT "}  ${c}`)
}
console.log("")
console.log(`  EVERY NAMED NODE TYPE CONTAINING A CANDIDATE STEM`)
for (const s of STEMS) console.log(`    ${s.padEnd(12)} -> ${stemHits[s].length ? stemHits[s].join(", ") : "(none)"}`)
console.log("")
console.log(`  POSITIVE CONTROLS (a scan that finds nothing everywhere is a broken scan)`)
for (const c of controlResults) {
  const r = c as any
  console.log(`    ${String(r.lang).padEnd(12)} ${r.controlFired ? "FIRED " : "DID NOT FIRE"}  expect ${(r.expected ?? []).join(", ")} found ${(r.found ?? []).join(", ")} (${r.namedCount ?? "-"} named / ${r.totalIds ?? "-"} ids)`)
  console.log(`      ${r.why}`)
}
console.log("")
console.log(`  ALL CONTROLS FIRED: ${report.controlsAllFired ? "YES" : "NO"}`)

// THE EXIT IS A GATE, NOT A REPORT: a build disagreement or a blind scan is a FAILED measurement.
if (!scala.agree) {
  console.error(`FAIL: the registry's bytes and the file's bytes DISAGREE for scala — exit 5`)
  process.exit(5)
}
if (!report.controlsAllFired) {
  console.error(`FAIL: a positive control did not FIRE — the scan is blind, so its absences prove nothing — exit 5`)
  process.exit(5)
}
process.exit(0)
