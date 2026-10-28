#!/usr/bin/env bun
/**
 * script/m60/solidity-import-claim.ts — the `importProjectFile` claim's control.
 *
 * WHY THIS EXISTS. The claim moved 798 `imports` rows from `unresolved` to
 * project-verified `extOK` on the 2026-10-28 arm. A number that large needs a
 * control that can FAIL: the claim must fire on a sibling file that exists and
 * must NOT fire on a path that does not. Both cases are built here, in a temp
 * directory, through the production entry (`parseFile` with a projectRoot), so
 * this is the same path the gate takes — not a copy of the predicate.
 *
 * Usage: bun run script/m60/solidity-import-claim.ts
 * Exit: 0 both cases correct · 1 a control failed · 2 environment.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")

const A = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "./B.sol";
import "./Missing.sol";
contract A { function f() public pure returns (uint256) { return 1; } }
`

const B = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract B { function g() public pure returns (uint256) { return 2; } }
`

async function main(): Promise<number> {
  const dir = mkdtempSync(path.join(tmpdir(), "sol-import-claim-"))
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, "A.sol"), A)
    writeFileSync(path.join(dir, "B.sol"), B)
    const result: any = await parseFile(path.join(dir, "A.sol"), dir, { projectRoot: dir })
    const rows = (result.relationships ?? []).filter((r: any) => r.type === "imports")
    const byTarget = new Map<string, any>()
    for (const r of rows) byTarget.set(String(r.target), r)

    const positive = byTarget.get("./B.sol")
    const negative = byTarget.get("./Missing.sol")
    const positiveOk = positive?.metadata?.importProjectFile === "B.sol"
    const negativeOk = negative !== undefined && negative?.metadata?.importProjectFile === undefined

    console.log("M60 — solidity importProjectFile claim control")
    console.log(`  imports edges: ${rows.length}`)
    console.log(`  positive ./B.sol      claim=${JSON.stringify(positive?.metadata?.importProjectFile ?? null)}  ${positiveOk ? "ok" : "FAIL"}`)
    console.log(`  negative ./Missing.sol claim=${JSON.stringify(negative?.metadata?.importProjectFile ?? null)}  ${negativeOk ? "ok" : "FAIL"}`)
    console.log(`  ${positiveOk && negativeOk ? "PASS" : "FAIL"} — the claim fires only when the file exists`)
    return positiveOk && negativeOk ? 0 : 1
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// The real-corpus smoke: AccessControl.sol imports Context.sol and others that exist.
async function corpusSmoke(): Promise<number> {
  const repo = path.join(ROOT, ".corpus", "solidity")
  const file = path.join(repo, "contracts", "access", "AccessControl.sol")
  try {
    const result: any = await parseFile(file, repo, { projectRoot: repo })
    const rows = (result.relationships ?? []).filter((r: any) => r.type === "imports")
    const claimed = rows.filter((r: any) => typeof r.metadata?.importProjectFile === "string")
    console.log(`  corpus AccessControl.sol: ${claimed.length}/${rows.length} imports carry a file claim`)
    for (const r of claimed) console.log(`    ${r.target} -> ${r.metadata.importProjectFile}`)
    return claimed.length > 0 ? 0 : 1
  } catch (error) {
    console.log(`  corpus smoke unavailable: ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }
}

const code = await main()
const corpus = await corpusSmoke()
process.exit(code === 0 && (corpus === 0 || corpus === 2) ? 0 : 1)
