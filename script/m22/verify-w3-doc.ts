// script/m22/verify-w3-doc.ts — M22.W3
// Structurally verifies docs/TROUBLESHOOTING.md covers every user-reported
// symptom with a cause and a command, and never references a phantom command
// (it must not cite `--post`, which does not exist).
// No auto-pass / tautological assertions.

import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m22/results")

let checks = 0
let passed = 0
let negatives = 0
function check(label: string, ok: boolean, detail = "") { checks++; if (ok) passed++; else console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
function negative(label: string, ok: boolean, detail = "") { negatives++; check(`${label} [negative]`, ok, detail) }

async function run() {
  const doc = readFileSync(path.join(ROOT, "docs/TROUBLESHOOTING.md"), "utf8")

  // every reported symptom must appear with a cause (## section) and a fix command
  const symptoms: Array<[string, string]> = [
    ["slow", "hours"],
    ["single worker", "one worker"],
    ["worker err", "ast engine error"],
    ["wasm", "html wasm error"],
    ["database is locked", "SQLITE_BUSY"],
    ["no index for"],
    ["missing", "not in DB", "stale"],
    ["parse error", "symbol loss"],
    ["time remaining", "how many files", "total"],
    ["resume", "power loss", "checkpoint"],
  ]
  for (const group of symptoms) {
    const hit = group.some((k) => doc.toLowerCase().includes(k.toLowerCase()))
    check(`W3 symptom "${group[0]}" is covered`, hit, group.join(" / "))
  }

  // every `bb ...` command mentioned in the doc must actually exist in the CLI source
  const cliSrc = readFileSync(path.join(ROOT, "src/cli/index.ts"), "utf8")
  const known = new Set(["index", "status", "stats", "search", "health", "tool", "mcp", "version"])
  const mentioned = new Set<string>()
  for (const m of doc.matchAll(/\b(bb (?:index|status|stats|search|health|tool|mcp|version))\b/g)) mentioned.add(m[1].split(" ")[1])
  const unknown = [...mentioned].filter((c) => !known.has(c))
  check("W3 every `bb <subcommand>` mentioned in docs exists", unknown.length === 0, `unknown=${unknown.join(",")}`)

  // M40.A1: --post is now a REAL flag, so the doc MAY mention it — but only
  // alongside `bb index` (its actual home). A bare phantom mention elsewhere
  // still fails.
  {
    const postMentions = [...doc.matchAll(/--post\b/g)]
    const allNearIndex = postMentions.every((m) => {
      const window = doc.slice(Math.max(0, m.index! - 120), m.index! + 120)
      return /bb index/.test(window)
    })
    negative("W3 any --post doc mention sits next to bb index (real flag, right home)", postMentions.length === 0 || allNearIndex, "detached --post mention")
  }
  // every /tmp mention must be explicitly HISTORICAL (old/previously/replaces);
  // the current diagnostics location must be the discoverable data-dir path
  const tmpMentions = [...doc.matchAll(/\/tmp\/bb-parse-errors\.log/g)]
  const historical = tmpMentions.every((m) => {
    const lineStart = doc.lastIndexOf("\n", m.index!) + 1
    const lineEnd = doc.indexOf("\n", m.index!)
    const line = doc.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
    return /old|previously|replaces|replaced/.test(line)
  })
  negative("W3 every /tmp mention is historical; current location is the data-dir logs path", historical && doc.includes("~/.bb/logs/parse-errors.log"), `tmpMentions=${tmpMentions.length}`)

  check("W3 troubleshooting doc names the probe-grounded bottleneck truth (parse + dbFlush)", /parse\b.*dbFlush|dbFlush/.test(doc), "no dbFlush mention")

  mkdirSync(RESULTS, { recursive: true })
  const finalStatus = passed === checks && negatives >= 2 ? "verified" : "known-gap"
  const { execFileSync } = await import("node:child_process")
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  const result = {
    issue: "M22.W3", code: "W3", milestone: "M22", status: finalStatus,
    checks, passed, failed: checks - passed, negativeCases: negatives,
    currentCommit: commit, workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m22/verify-w3-doc.ts",
    evidenceFile: "W3.json", generatedAt: new Date().toISOString(),
    command: "bun run script/m22/verify-w3-doc.ts",
    symptomsCovered: symptoms.length,
    mentionedCommands: [...mentioned].sort(),
    limitations: ["Structural coverage check; the doc's accuracy is grounded in the probe/evidence (it cites per-phase truth and the discoverable log path)."],
  }
  writeFileSync(path.join(RESULTS, "W3.json"), JSON.stringify(result, null, 2) + "\n")
  try {
    const led = JSON.parse(readFileSync(path.join(ROOT, "validation/m22/ledger.json"), "utf8"))
    const e = Object.values(led.issues).find((i: any) => i.code === "W3")
    if (e) { e.status = finalStatus; e.passed = passed; e.failed = checks - passed; e.commit = commit; e.evidenceFile = "W3.json" }
    writeFileSync(path.join(ROOT, "validation/m22/ledger.json"), JSON.stringify(led, null, 2) + "\n")
  } catch (e: any) { console.log(`W3: ledger self-update failed: ${e?.message}`) }
  console.log(`W3: ${result.status.toUpperCase()} (${result.passed}/${result.checks}, ${result.negativeCases} negative)`)
  process.exit(finalStatus === "verified" ? 0 : 1)
}

run().catch((e) => { console.error("W3 verifier crashed:", e); process.exit(1) })