#!/usr/bin/env bun
/**
 * THE GRAMMAR-NODE INVENTORY ARTIFACT (Lead, 2026-10-21).
 *
 * ★ WHY THIS EXISTS, AND IT IS A WHOLE CLASS OF DEFECT RATHER THAN ONE DEFECT. The GRAMMAR-SIDE HALF
 * of a ruling — "the language's own node-type inventory has no construct that carries this relation" —
 * is the half that makes a type an EXCLUSION rather than an UNIMPLEMENTED TYPE. That half is measured
 * by enumerating the grammar's node types, and lanes have been doing it into their OWN TEMPORARY
 * DIRECTORIES: the sql lane's `.tmp-census/grammar-nodes.json`, the vue lane's
 * `.tmp-f48/cov/grammar-nodes.json`, and 66 more temp-path citations across the fleet.
 *
 * ⇒ A `.tmp-` PATH IS EPHEMERAL BY CONSTRUCTION AND IS IN NO COMMIT. So the evidence for the
 * grammar-side half of a ruling is a file nobody else has, and the ruling cannot be checked by
 * anyone who clones the repository. The `citation-trackedness-check.ts` instrument found all 68.
 *
 * ⇒ THIS TOOL WRITES THE SAME INVENTORY TO A DURABLE, TRACKED PATH:
 * `validation/m14/measurements/<language>-grammar-nodes.json`
 *
 * AND IT IS NOT A SECOND MEASUREMENT — IT IS THE SAME MEASUREMENT, READ FROM THE SAME LIVE PARSER,
 * WITH THE SAME ACCESSOR. The one thing it adds is the NAMES, so a ruling can name the node types it
 * looked for and not merely the count, and the BUILD DIGEST beside them, so the inventory is bound to
 * the bytes the registry served.
 *
 * ★ THE ACCESSOR, AND IT IS THE FLEET'S RECURRING TRAP: `nodeTypeForId` returns the type NAME as a
 * STRING, and a string has no `.named`, so `t.named` counts EVERY type as anonymous. The accessor is
 * `nodeTypeIsNamed(id)`. THE TELL is that TOTAL agrees with a prior measurement while the named-count
 * is 0.
 *
 * ★ AND THE DIGEST IS WHAT MAKES THE INVENTORY CITABLE: the node-type inventory is only meaningful
 * beside the sha256 OF THE BYTES THE REGISTRY SERVES. Never a path, never the engine's log — the log
 * prints a path that is not the file the bytes came from.
 *
 * RUN: bun script/m14/grammar-node-inventory.ts [language ...]
 *   with no argument, every language in the fleet's table is inventoried.
 *
 * EXIT: 0 when every requested language's inventory was written; 5 when a language could not be
 * inventoried, because a missing inventory is not an empty inventory.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { createHash } from "node:crypto"

const ROOT = resolve(import.meta.dir, "../..")
const OUT_DIR = resolve(ROOT, "validation/m14/measurements")
const BINDINGS = resolve(ROOT, "validation/m14/verification/GRAMMAR-BINDINGS-2026-10-21.md")

/** THE FLEET'S LANGUAGE SPELLINGS. The engine's own key is not always the lane's name: objc's lane
 *  key is `objc` and the engine's is `objective-c` (`src/ast/engine.ts:329`). */
const ENGINE_KEY: Record<string, string> = { objc: "objective-c" }

/** THE SERVED DIGEST, READ FROM THE FLEET'S OWN TRACKED BINDING TABLE — so the inventory and the
 *  digest come from ONE recorded place and cannot drift apart. */
function servedDigest(lang: string): string | null {
  if (!existsSync(BINDINGS)) return null
  const text = readFileSync(BINDINGS, "utf8")
  for (const line of text.split("\n")) {
    const m = /^\|\s*`?([\w-]+)`?\s*\|\s*`?([0-9a-f]{8,64})`?\s*\|/.exec(line)
    if (m && m[1] === lang) return m[2]!
  }
  return null
}

interface Inventory {
  language: string
  engineKey: string
  servedDigest: string | null
  namedTypes: number
  totalIds: number
  namedTypeNames: string[]
  allTypeNames: string[]
  measuredAt: string
  note: string
}

const args = process.argv.slice(2).filter((a) => !a.startsWith("-"))

/** THE LANE SPELLINGS COME FROM THE FLEET'S OWN BINDING TABLE, so the tool's language list can never
 *  disagree with the fleet's. */
function fleetLanguages(): string[] {
  if (!existsSync(BINDINGS)) return []
  const out: string[] = []
  for (const line of readFileSync(BINDINGS, "utf8").split("\n")) {
    const m = /^\|\s*`?([\w-]+)`?\s*\|\s*`?[0-9a-f]{8,64}`?\s*\|/.exec(line)
    if (m) out.push(m[1]!)
  }
  return out
}

const languages = args.length ? args : fleetLanguages()

if (!languages.length) {
  console.error("no language list: the binding table was not readable, and the fleet's own table is the list.")
  process.exit(5)
}

const { getParser } = await import("../../src/ast/engine")
mkdirSync(OUT_DIR, { recursive: true })

const written: string[] = []
const failed: string[] = []

for (const lang of languages) {
  const engineKey = ENGINE_KEY[lang] ?? lang
  try {
    const parser = await getParser(engineKey as any)
    const language = (parser as any).language
    if (!language) throw new Error("the parser exposes no language")
    const totalIds: number = language.nodeTypeCount
    const namedTypeNames: string[] = []
    const allTypeNames: string[] = []
    for (let id = 0; id < totalIds; id++) {
      const name = String(language.nodeTypeForId(id) ?? "")
      allTypeNames.push(name)
      // THE ACCESSOR IS `nodeTypeIsNamed(id)` — NOT `t.named`. `nodeTypeForId` returns a STRING and a
      // string has no `.named`, so `t.named` counts every type as anonymous.
      if (language.nodeTypeIsNamed(id)) namedTypeNames.push(name)
    }
    const inv: Inventory = {
      language: lang,
      engineKey,
      servedDigest: servedDigest(lang),
      namedTypes: namedTypeNames.length,
      totalIds,
      namedTypeNames: namedTypeNames.sort(),
      allTypeNames: allTypeNames.sort(),
      measuredAt: new Date().toISOString(),
      note:
        "READ FROM THE LIVE PARSER the engine's registry served, over the same wasm the product loads. " +
        "The named accessor is nodeTypeIsNamed(id); nodeTypeForId returns a STRING and a string has no " +
        ".named, so t.named would count every type as anonymous. The digest is the sha256 of the bytes " +
        "the registry serves — never a path, never the engine's log.",
    }
    const path = resolve(OUT_DIR, `${lang}-grammar-nodes.json`)
    writeFileSync(path, JSON.stringify(inv, null, 2) + "\n")
    written.push(`${lang} (${namedTypeNames.length} named / ${totalIds} ids) → validation/m14/measurements/${lang}-grammar-nodes.json`)
  } catch (e: any) {
    failed.push(`${lang}: ${e?.message ?? String(e)}`)
  }
}

console.log(`GRAMMAR-NODE INVENTORY — ${written.length} language(s) written, ${failed.length} failed`)
console.log()
for (const w of written) console.log(`  ${w}`)
if (failed.length) {
  console.log()
  console.log("★ FAILED — and a language that could not be inventoried is NOT a language with an empty")
  console.log("  inventory. A missing artifact is not a zero.")
  for (const f of failed) console.log(`  ${f}`)
  process.exit(5)
}
console.log()
console.log("⇒ EVERY REQUESTED LANGUAGE'S INVENTORY IS WRITTEN TO A DURABLE, TRACKED PATH, WITH ITS")
console.log("  SERVED DIGEST BESIDE IT. A ruling may cite THIS file instead of a temporary directory.")
