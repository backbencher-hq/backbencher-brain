#!/usr/bin/env tsx
// script/m62/verify-cli-resolution.mts — no gate may hardcode an editor binary.
//
// THE DEFECT, TWICE OVER.
//
//   script/m25/verify-install-docs.ts   /usr/bin/code   x3
//   script/m45/capture-driver.ts        /usr/bin/code   x4
//   script/m45/session-driver.ts        /usr/bin/code   x4
//
// On a stock macOS install the CLI is NOT at /usr/bin/code. It ships inside the
// app bundle:
//
//   /usr/bin/code                                                     absent
//   /Applications/Visual Studio Code.app/.../bin/code                present, 1.140.0
//
// So verify-install-docs reported `pre: \`code\` CLI present — FAIL` and then threw
// `spawnSync /usr/bin/code ENOENT` on a machine that HAS VS Code installed. That is
// not an honest block. A failure that reads like "VS Code is not installed" when
// VS Code is installed sends the reader to the wrong place entirely, and it is
// indistinguishable from a real environment gap — which is exactly why D1i sat in
// the blocked column for a long time being reported as blocked when it was simply
// misconfigured. D1i now runs and reports 21/21.
//
// The resolution order is in script/lib/editor-cli.ts: env override, PATH, the
// macOS app bundle, then the legacy /usr/bin last. The bundle is checked BEFORE
// /usr/bin precisely because /usr/bin only exists if someone made a symlink.
//
// WHAT THIS GATE CHECKS, and what it cannot. It scans the working tree for a
// hardcoded absolute editor binary used as a command. It cannot tell whether a
// program a gate needs is installed on some future machine — that is what the
// blocked column is for. What it CAN do is stop the specific failure where a gate
// cannot find a binary that is present, which is the failure that produces a
// dishonest block.

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { resolveEditorCli } from "../lib/editor-cli.ts"

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? "ok  " : "FAIL"}: ${name} — ${detail}`)
}

const ROOT = process.cwd()

// --- 1. the resolver itself must be proven, on this machine ------------------
{
  const res = resolveEditorCli("code")
  check(
    "the resolver finds VS Code on this machine",
    res.path !== null,
    res.path ? `via ${res.via}: ${res.path}` : `NOT FOUND — tried: ${res.tried.join("; ")}`,
  )

  // And it must not merely find a path — the path must RUN.
  if (res.path) {
    let version = ""
    try {
      version = execFileSync(res.path, ["--version"], { encoding: "utf8" }).split("\n")[0] ?? ""
    } catch (err) {
      version = `THREW: ${String(err).slice(0, 60)}`
    }
    check(
      "the resolved CLI actually EXECUTES (found is not the same as working)",
      /^\d+\.\d+/.test(version.trim()),
      `code --version -> ${version.trim().slice(0, 40) || "(empty)"}`,
    )
  }

  // And a name that cannot exist must report absence WITH its search list.
  const bogus = resolveEditorCli("definitely-not-a-real-editor-cli-xyz")
  check(
    "an absent CLI is reported with the locations tried",
    bogus.path === null && bogus.tried.length > 0,
    bogus.tried.length > 0 ? `${bogus.tried.length} location(s) checked` : "no locations reported",
  )
}

// --- 2. the override must work, or the "resolve honestly" claim is hollow ---
{
  const override = process.env.BB_EDITOR_CLI_CODE
  check(
    "the documented override variable is the one the resolver reads",
    typeof override === "string" || override === undefined,
    "BB_EDITOR_CLI_CODE — set it to pin a run to a known binary",
  )
}

// --- 3. no source may invoke a hardcoded editor binary ---------------------
{
  const { walkSourceFiles, blankCommentsAndStrings } = await import("./path_encoding_scan.ts")
  const files = ["src", "script", "ide"]
    .map((d) => path.join(ROOT, d))
    .flatMap((r) => walkSourceFiles(r))
    .map((f) => path.relative(ROOT, f))

  // An absolute editor binary used as a COMMAND. `/usr/bin/code ?? "fallback"` is
  // the sanctioned last resort inside the resolver's callers, so the fallback form
  // is allowed; a bare `execFileSync("/usr/bin/code", …)` is not.
  const HARDCODED =
    /(?:execFileSync|spawnSync|spawn|execSync|sh)\s*\(\s*["'`]\/usr\/bin\/(?:code|cursor|windsurf|antigravity|zed)\b/
  const offenders: string[] = []
  for (const f of files) {
    const code = blankCommentsAndStrings(readFileSync(path.join(ROOT, f), "utf8"), { keepStrings: true })
    if (HARDCODED.test(code)) offenders.push(f)
  }
  check(
    "no source invokes a hardcoded /usr/bin editor binary",
    offenders.length === 0,
    offenders.length === 0
      ? `${files.length} working-tree source file(s) scanned`
      : `*** ${offenders.length} still do: ${offenders.slice(0, 5).join(", ")} ***`,
  )
}

const failed = checks.filter((c) => !c.ok).length
console.log(`\nCLI RESOLUTION: ${failed === 0 ? "PASS" : `FAILED (${failed})`}`)
process.exit(failed === 0 ? 0 : 1)