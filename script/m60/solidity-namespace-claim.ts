#!/usr/bin/env bun
/**
 * script/m60/solidity-namespace-claim.ts — the `languageNamespace` claim's control.
 *
 * `abi.encode` and `type(I).interfaceId` were published with the bare member
 * name (`encode`, `interfaceId`), so the gate counted them unresolved or
 * ambiguous against unrelated declarations. They now carry the namespace in the
 * target and the arbiter's list-verified `languageNamespace` claim.
 *
 * The control must show BOTH sides: the namespace call is qualified and
 * claimed, and a PROJECT function with the same member name is not.
 *
 * Usage: bun run script/m60/solidity-namespace-claim.ts
 * Exit: 0 both sides correct · 1 a control failed · 2 environment.
 */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
interface I { function f() external; }
contract T {
  function encode(uint256 x) public pure returns (uint256) { return x + 1; }
  function g() public pure returns (bytes memory) { return abi.encode(1); }
  function bare() public pure returns (uint256) { return encode(1); }
}
`

async function main(): Promise<number> {
  const dir = mkdtempSync(path.join(tmpdir(), "sol-namespace-claim-"))
  try {
    writeFileSync(path.join(dir, "T.sol"), SOURCE)
    const result: any = await parseFile(path.join(dir, "T.sol"), dir, { projectRoot: dir })
    const calls = (result.relationships ?? []).filter((r: any) => r.type === "calls")
    const byTarget = new Map<string, any>()
    for (const r of calls) byTarget.set(String(r.target), r)

    const abi = byTarget.get("abi.encode")
    const bare = byTarget.get("encode")
    const abiOk = abi?.metadata?.languageNamespace?.[0] === "abi"
    const bareOk = bare !== undefined && bare?.metadata?.languageNamespace === undefined

    console.log("M60 — solidity languageNamespace claim control")
    console.log(`  abi.encode        namespace=${JSON.stringify(abi?.metadata?.languageNamespace ?? null)}  ${abiOk ? "ok" : "FAIL"}`)
    console.log(`  project encode    namespace=${JSON.stringify(bare?.metadata?.languageNamespace ?? null)}  ${bareOk ? "ok" : "FAIL"}`)
    console.log(`  ${abiOk && bareOk ? "PASS" : "FAIL"} — a namespace call is qualified and claimed; a project function is not`)
    return abiOk && bareOk ? 0 : 1
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

process.exit(await main())
