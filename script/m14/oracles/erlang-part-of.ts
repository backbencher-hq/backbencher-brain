#!/usr/bin/env bun
/**
 * ERLANG `part_of` ORACLE — the independent derivation for the ER-D46 relabel.
 *
 * WHY IT EXISTS. The campaign's bar for an extended value is: "it must carry a fixture that FIRES it and an
 * ORACLE that audits it, or it is DERIVATION debt the moment it lands" (src/ast/types.ts). The fixture
 * `erlang/extended-part-of` fires it; this file is the second opinion. It walks the tree with its OWN
 * descendant search and the CONTRACT's direction (`metadata.partRole:"library"`), not the analyzer's
 * emission code, so a shared defect in one walker cannot agree with itself here.
 *
 * THE RULE THE ORACLE DERIVES (validation/m14/verification/VOCABULARY-EXTENSION-PROPOSAL.md §2.4):
 *   `-include("x.hrl")` / `-include_lib("kernel/…")` is FILE INCLUSION: the header is spliced into THIS
 *   module's single compilation scope, it cannot be compiled as a unit of its own, and it imports nothing.
 *   source = the file carrying the directive (its module symbol, else its path — ER-D32), target = the path
 *   as written. One row per directive.
 * The two name-bearing facts the analyzer pins are pinned here too: the LINE is the path STRING's line
 * (M59 #825), and BOTH forms are `part_of` (the `-include_lib` code-path classification is ER-D20's
 * `isExternal` on the ImportInfo entry, not a different relation).
 *
 * USAGE
 *   bun script/m14/oracles/erlang-part-of.ts --check-fixtures   # oracle vs analyzer on the lane's fixtures
 *   bun script/m14/oracles/erlang-part-of.ts --check-corpus 60  # oracle vs analyzer on a corpus stride
 *
 * EXIT: 0 agreement · 3 disagreement (both directions named) · 2 usage/parse failure — a check that cannot
 * fail is not a check, so the disagreement path prints MISSING and UNEXPLAINED samples.
 */
import { readdirSync, readFileSync } from "node:fs"
import * as path from "node:path"

import { ASTEngine } from "../../../src/ast/engine"
import { RealErlangAnalyzer } from "../../../src/ast/real-erlang-analyzer"
import { decodeSourceText } from "../../../src/util/source-text"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")

export interface PartOfRow { label: "part_of"; from: string; target: string; line: number; role: "library" }

const kids = (n: any): any[] => {
  const out: any[] = []
  for (let i = 0; i < (n?.namedChildCount ?? 0); i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}
const byType = (n: any, t: string): any => kids(n).find((c) => c.type === t)
const stripQuotes = (s: string): string => {
  let out = ""
  for (const ch of s) if (ch !== '"' && ch !== "'") out += ch
  return out
}

/** THE INDEPENDENT DERIVATION. Descends everything (not the analyzer's pre-pass form list), finds every
 *  `pp_include`/`pp_include_lib`, and publishes the contract row. A module-less file attributes to its
 *  PATH (ER-D32), never to a synthesised name. */
export function deriveErlangPartOfTruth(root: any, filePath: string, declaredModule?: string): PartOfRow[] {
  const out: PartOfRow[] = []
  const seen = new Set<string>()
  const source = declaredModule || filePath
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()
    if (!n) continue
    const t = String(n.type ?? "")
    if (t === "pp_include" || t === "pp_include_lib") {
      const s = byType(n, "string")
      if (s?.text) {
        const target = stripQuotes(s.text)
        const line = s.startPosition.row + 1
        const key = `${source}|${target}|${line}`
        if (!seen.has(key)) {
          seen.add(key)
          out.push({ label: "part_of", from: source, target, line, role: "library" })
        }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push(n.namedChild(i))
  }
  return out
}

const moduleNameOf = (result: any): string | undefined => {
  const mod = (result?.symbols ?? []).find((s: any) => s?.kind === "module")
  return typeof mod?.name === "string" ? mod.name : undefined
}

async function compareOne(abs: string, parser: any): Promise<{ ok: boolean; missing: string[]; unexplained: string[]; n: number }> {
  const content = decodeSourceText(readFileSync(abs)).text
  const tree = parser.parse(content, abs)
  if (!tree?.rootNode) return { ok: false, missing: [`${abs}: no root node`], unexplained: [], n: 0 }
  try {
    const result: any = new RealErlangAnalyzer().analyze(tree.rootNode, content, abs)
    const truth = deriveErlangPartOfTruth(tree.rootNode, abs, moduleNameOf(result))
    const actual = ((result?.relationships ?? []) as any[])
      .filter((r) => String(r?.type) === "part_of")
      .map((r) => ({ from: String(r.source ?? ""), target: String(r.target ?? ""), line: Number(r.line_number ?? 0), role: String((r.metadata as any)?.partRole ?? "") }))
    const key = (f: string, t: string, l: number) => `${f}\u0000${t}\u0000${l}`
    const aSet = new Set(actual.map((r) => key(r.from, r.target, r.line)))
    const tSet = new Set(truth.map((r) => key(r.from, r.target, r.line)))
    const missing = truth.filter((r) => !aSet.has(key(r.from, r.target, r.line))).map((r) => `${r.from} -> ${r.target}:${r.line}`)
    const unexplained = actual.filter((r) => !tSet.has(key(r.from, r.target, r.line))).map((r) => `${r.from} -> ${r.target}:${r.line}`)
    // the two mandatory markers are part of the contract, checked on every actual row
    const badMarker = actual.filter((r) => r.role !== "library").map((r) => `${r.from} -> ${r.target}: partRole=${JSON.stringify(r.role)}`)
    return { ok: missing.length === 0 && unexplained.length === 0 && badMarker.length === 0, missing: missing.concat(badMarker), unexplained, n: actual.length }
  } finally {
    try { tree.delete?.() } catch { /* nothing to free */ }
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const parser: any = await ASTEngine.getParser("erlang" as any)
  const files: string[] = []
  if (argv.includes("--check-fixtures")) {
    const dir = path.join(ROOT, "validation/m14/fixtures/erlang")
    for (const f of readdirSync(dir).sort()) if (f.endsWith(".erl")) files.push(path.join(dir, f))
  } else if (argv.includes("--check-corpus")) {
    const i = argv.indexOf("--check-corpus")
    const stride = Math.max(1, Number(argv[i + 1] ?? 60))
    const { execFileSync } = await import("node:child_process")
    for (const repo of ["otp", "rebar3", "elixir"]) {
      let tracked: string[] = []
      try {
        tracked = execFileSync("git", ["-C", path.join(CR, repo), "ls-files", "-z"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\0").filter(Boolean)
      } catch { continue }
      const erl = tracked.filter((r) => r.endsWith(".erl") || r.endsWith(".hrl")).sort()
      for (let k = 0; k < erl.length; k += stride) files.push(path.join(CR, repo, erl[k]!))
    }
  } else {
    console.error("usage: bun script/m14/oracles/erlang-part-of.ts --check-fixtures | --check-corpus <stride>")
    process.exit(2)
  }
  let ok = 0, bad = 0, rows = 0
  for (const f of files) {
    const r = await compareOne(f, parser)
    rows += r.n
    if (r.ok) { ok++; continue }
    bad++
    if (bad <= 10) {
      console.log(`DISAGREE ${path.relative(ROOT, f)} (analyzer part_of rows ${r.n})`)
      for (const m of r.missing.slice(0, 4)) console.log(`  MISSING     ${m}`)
      for (const u of r.unexplained.slice(0, 4)) console.log(`  UNEXPLAINED ${u}`)
    }
  }
  console.log(`\npart_of oracle: ${ok} file(s) agree, ${bad} disagree, ${rows} analyzer row(s) checked`)
  if (bad > 0) { console.error("REFUSED — the oracle and the analyzer disagree; the relabel is not pinned."); process.exit(3) }
}

main().catch((e) => { console.error(`FATAL: ${String(e?.stack ?? e)}`); process.exit(2) })
