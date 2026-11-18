#!/usr/bin/env bun
// TS SELF-CORPUS PROBE — the lane measured on THE REPOSITORY ITSELF, through the PRODUCTION path.
//
// ## Why the project is a corpus
//
// The owner authorised this repository as a corpus (2026-11-17). It is the only population that is
// always present, always at a recorded revision, and always TypeScript the lane did not choose —
// src/, script/ and validation/ are written by this fleet, so a defect that only shows on
// "convenient" corpora shows here too. It complements the shared corpus rather than replacing it:
// the shared corpus is the WHOLE-POPULATION instrument (17,350 files), this is the SELF-CHECK.
//
// ## What it measures (and what it refuses to claim)
//
// Through `ASTEngine.parseFile` — the PRODUCTION path, filter included — per file: symbols and
// relationships by type, rows whose source is the file-level sentinel (and whether each carries
// `metadata.fileLevel`), endpoints that cannot be names, empty endpoints, and owner-carrying
// calls/uses. Every number is printed with the file set that produced it: `--max-files N` derives
// a deterministic stride and PRINTS it, so a sample can never be read as the whole population; the
// default is the whole repository's tracked TypeScript.
//
// The endpoint-shape test is the lane's own R7 rule, imported from the probe that owns it
// (`ts-r7-endpoint-probe.ts`) rather than re-spelled here — a second copy of a rule is a second
// answer to it.
//
// Usage:
//   bun run script/m14/ts-self-corpus-probe.ts [--max-files N] [--json path]
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../src/ast/pool-worker"
import { SIZE_CAP } from "./ts-corpus"

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const argv = process.argv.slice(2)
const argOf = (flag: string): string | null => {
  const i = argv.indexOf(flag)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null
}
const MAX_FILES = Number(argOf("--max-files") ?? "0")
const JSON_OUT = argOf("--json")

/** The lane's endpoint-shape rule, imported from the instrument that owns it. */
const shapeModule: any = await import("./ts-endpoint-shape")
const nameShapeOk: (s: string) => boolean = shapeModule.nameShapeOk
const BINDING_SEP = "\u0000"

const head = (() => {
  try {
    return execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  } catch {
    return null
  }
})()
const tracked = execFileSync("git", ["-C", REPO, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
  .split("\0")
  .filter(Boolean)
const admitted = tracked.filter((rel) => {
  const low = rel.toLowerCase()
  if (!(low.endsWith(".ts") || low.endsWith(".tsx") || low.endsWith(".mts") || low.endsWith(".cts"))) return false
  try {
    return statSync(join(REPO, rel)).size <= SIZE_CAP
  } catch {
    return false
  }
})
const stride = MAX_FILES > 0 && admitted.length > MAX_FILES ? Math.max(1, Math.floor(admitted.length / MAX_FILES)) : 1
const files = MAX_FILES > 0 ? admitted.filter((_, i) => i % stride === 0).slice(0, MAX_FILES) : admitted

const byType = new Map<string, number>()
let parsed = 0
let fallback = 0
let parseFailed = 0
let symbols = 0
let relationships = 0
let fileLevelRows = 0
let fileLevelViolations = 0
let emptyEndpoints = 0
let notANameEndpoints = 0
let bindingKeyTargets = 0
let calls = 0
let memberCalls = 0
let callsWithOwner = 0
let uses = 0
let usesWithOwner = 0

for (const rel of files) {
  const abs = join(REPO, rel)
  let content: string
  try {
    content = readFileSync(abs, "utf8")
  } catch {
    parseFailed++
    continue
  }
  let result: any
  try {
    result = await parseFile(abs, REPO)
  } catch {
    parseFailed++
    continue
  }
  if (result?.fallback === true) {
    fallback++
    continue
  }
  parsed++
  symbols += (result?.symbols ?? []).length
  for (const edge of result?.relationships ?? []) {
    relationships++
    const type = String(edge?.type ?? "")
    byType.set(type, (byType.get(type) ?? 0) + 1)
    const md: any = edge?.metadata ?? {}
    const source = String(edge?.source ?? "")
    const target = String(edge?.target ?? "")
    if (source === "(file)") {
      fileLevelRows++
      if (md.fileLevel !== true) fileLevelViolations++
    } else if (md.fileLevel === true) {
      fileLevelViolations++
    }
    if (source.length === 0 || target.length === 0) {
      emptyEndpoints++
      continue
    }
    // THE R7 SHAPE TEST — imports targets and binding keys are compound claim keys by contract,
    // not names (the same exclusions the R7 probe documents, at the same place).
    if (type !== "imports" && !target.includes(BINDING_SEP) && !source.includes(BINDING_SEP) && !nameShapeOk(target)) {
      notANameEndpoints++
    }
    if (target.includes(BINDING_SEP)) bindingKeyTargets++
    if (type === "calls") {
      calls++
      const callee = String(md.calleeExpression ?? "")
      if (callee.includes(".")) memberCalls++
      if (typeof md.owner === "string" && md.owner.length > 0) callsWithOwner++
    }
    if (type === "uses") {
      uses++
      if (typeof md.owner === "string" && md.owner.length > 0) usesWithOwner++
    }
  }
}

const report = {
  instrument: "script/m14/ts-self-corpus-probe.ts",
  corpus: { kind: "self", path: REPO, gitHead: head, trackedTsFamily: admitted.length },
  population: { files: files.length, stride, parsed, fallback, parseFailed },
  symbols,
  relationships,
  byType: Object.fromEntries([...byType.entries()].sort()),
  fileLevel: { rows: fileLevelRows, contractViolations: fileLevelViolations },
  endpoints: { empty: emptyEndpoints, notAName: notANameEndpoints, bindingKeyTargets },
  owner: { calls, memberCalls, callsWithOwner, uses, usesWithOwner },
  note: "measured through ASTEngine.parseFile (the production path, filter included), not the analyzer alone. A sample prints its stride; the default is every tracked .ts/.tsx/.mts/.cts file under the size cap.",
}
console.log(JSON.stringify(report, null, 1))
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(report, null, 2) + "\n")
