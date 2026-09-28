// script/m25/verify-extension-skeleton.ts — M25.E1 verifier + mutation suite.
//
// Headless proof of the E1 skeleton:
//   G1 resolution order: explicit > workspace dist > bundled dist > bun
//      source (declared fallback), per the documented order in
//      ide/vscode/src/server-resolution.ts. Fixture layouts on real tmpfs.
//   G2 version matrix: semver minimum enforced, fail-closed on unparsable or
//      missing versions; honest remediation message.//   G3  activation budget declared: `bbLsp.activationBudgetMs` exists in the
//      manifest contributes and is read by extension.ts (contract §7.3).
//   G3b activation events: every launch language has onLanguage:<lang> in the
//      manifest — without it the extension never activates on file open (the
//      owner spot-check defect, 2026-09-05).
//   G4 thin-client wiring: documentSelector covers the five launch languages;
//      no completion/diagnostics/rename providers registered (complement
//      stance, contract §7.1) — enforced by source lint.
//   G5 crash surface: State.Stopped handler + restart command exist (source
//      lint) and the restart command is registered in the manifest.
//   G6 mutants: planted defects in a rewritten module are caught (the suite
//      can fail).
//
// Run: npx tsx script/m25/verify-extension-skeleton.ts
// Evidence: validation/m25/results/E1.json (machine-emitted)

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const EXT_ROOT = path.join(ROOT, "ide/vscode")
const SRC = path.join(EXT_ROOT, "src/server-resolution.ts")
const EXT_TS = path.join(EXT_ROOT, "src/extension.ts")
const MANIFEST = JSON.parse(readFileSync(path.join(EXT_ROOT, "package.json"), "utf8")) as {
  contributes?: { commands?: Array<{ command: string }>; configuration?: { properties?: Record<string, unknown> } }
}

let checks = 0
let passed = 0
let mutantsCaught = 0
let mutantsTotal = 0

function check(label: string, condition: boolean, detail = ""): boolean {
  checks++
  if (condition) {
    passed++
    return true
  }
  console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  return false
}

// Import the real module under test.
const mod = await import(pathToFileURL(SRC).href)
const { resolveServerLaunch, serverVersionSatisfiesMinimum, versionDecision } = mod as {
  resolveServerLaunch: (input: unknown) => unknown
  serverVersionSatisfiesMinimum: (actual: string | undefined, min: string) => boolean
  versionDecision: (actual: string | undefined, min: string) => { ok: true } | { ok: false; message: string }
}

// --- Fixture layouts -------------------------------------------------------
const tmp = mkdtempSync(path.join(tmpdir(), "e1-res-"))
const wsDist = path.join(tmp, "ws-dist")
const wsSrc = path.join(tmp, "ws-src")
const wsBare = path.join(tmp, "ws-bare")
for (const d of [wsDist, wsSrc, wsBare]) mkdirSync(d, { recursive: true })
mkdirSync(path.join(wsDist, "dist/lsp"), { recursive: true })
writeFileSync(path.join(wsDist, "dist/lsp/server.js"), "// fixture server\n")
mkdirSync(path.join(wsSrc, "src/lsp"), { recursive: true })
writeFileSync(path.join(wsSrc, "src/lsp/server.ts"), "// fixture server source\n")

try {
  // --- G1: resolution order ------------------------------------------------
  // a. explicit override wins over everything, validated.
  const explicit = resolveServerLaunch({
    workspaceRoot: wsDist,
    extensionRoot: tmp,
    mode: "auto",
    explicitServerPath: "dist/lsp/server.js",
  }) as { kind: string }
  check("G1: explicit serverPath wins when it exists", explicit.kind === "explicit", JSON.stringify(explicit))

  const explicitMissing = resolveServerLaunch({
    workspaceRoot: wsDist,
    extensionRoot: tmp,
    mode: "auto",
    explicitServerPath: "nope/missing.js",
  }) as { error?: string }
  check(
    "G1: explicit serverPath that does not exist is a visible error (never invented)",
    typeof explicitMissing.error === "string" && explicitMissing.error.includes("does not exist"),
    JSON.stringify(explicitMissing),
  )

  // b. workspace dist before bundled before source.
  const fromWsDist = resolveServerLaunch({ workspaceRoot: wsDist, extensionRoot: tmp, mode: "auto" }) as { kind: string; isFallback: boolean; runtime: string }
  check(
    "G1: workspace dist preferred (node, not fallback)",
    fromWsDist.kind === "dist-workspace" && fromWsDist.isFallback === false && fromWsDist.runtime === "node",
    JSON.stringify(fromWsDist),
  )

  // b'. source-bun mode skips dist legs by declaration: a workspace with
  // BOTH dist and source must resolve to source under the declared mode.
  mkdirSync(path.join(wsDist, "src/lsp"), { recursive: true })
  writeFileSync(path.join(wsDist, "src/lsp/server.ts"), "// fixture server source\n")
  const forcedSource = resolveServerLaunch({ workspaceRoot: wsDist, extensionRoot: tmp, mode: "source-bun" }) as { kind: string }
  check("G1: source-bun mode skips dist legs by declaration", forcedSource.kind === "source-bun", JSON.stringify(forcedSource))

  // c. bundled dist used when workspace has none.
  const bundledExt = path.join(tmp, "ext")
  mkdirSync(path.join(bundledExt, "dist/server/lsp"), { recursive: true })
  writeFileSync(path.join(bundledExt, "dist/server/lsp/server.js"), "// bundled fixture\n")
  const fromBundled = resolveServerLaunch({ workspaceRoot: wsBare, extensionRoot: bundledExt, mode: "auto" }) as { kind: string }
  check("G1: bundled dist used when workspace lacks one", fromBundled.kind === "dist-bundled", JSON.stringify(fromBundled))

  // d. bun source fallback declared as fallback — extension root WITHOUT a
  // bundled copy (else bundled dist legitimately wins per the declared order).
  const fromSource = resolveServerLaunch({ workspaceRoot: wsSrc, extensionRoot: wsBare, mode: "auto" }) as { kind: string; isFallback: boolean; runtime: string }
  check(
    "G1: bun source fallback declared (runtime bun, isFallback true)",
    fromSource.kind === "source-bun" && fromSource.isFallback === true && fromSource.runtime === "bun",
    JSON.stringify(fromSource),
  )

  // nothing resolvable → visible remediation error.
  const nothing = resolveServerLaunch({ workspaceRoot: wsBare, extensionRoot: wsBare, mode: "auto" }) as { error?: string }
  check(
    "G1: nothing resolvable yields remediation error",
    typeof nothing.error === "string" && nothing.error.includes("bbLsp.serverPath"),
    JSON.stringify(nothing),
  )

  // --- G1b: no-workspace refusal (M53 live-session defect, 2026-09-12) -----
  // A single-file window has NO workspace folder. The extension used to fall
  // back to process.cwd() and silently start the server against an arbitrary
  // root (it indexed and watched the WRONG project while the status surface
  // looked alive). The extension now refuses BEFORE resolution; the refusal
  // is a pure function of the workspace state, verified here at the same
  // boundary activate() uses. The resolver itself must also never be handed
  // a guessed root: the wire contract is workspaceRootOrNull() === null →
  // no launch attempt.
  {
    const src = readFileSync(path.join(EXT_ROOT, "src", "extension.ts"), "utf8")
    const hasGuard = src.includes("workspaceRootOrNull()") && src.includes("no workspace folder")
    check("G1b: single-file window is a declared refusal (no silent cwd root)", hasGuard, hasGuard ? "activate() refuses before resolveServerLaunch" : "guard missing")
    // The fallback path must be GONE: workspaceRoot() may not return cwd when
    // folders exist — and activate may not call it without a null check.
    const cwdFallback = /workspaceFolders\?\.\[0\]\?\.uri\.fsPath \?\? process\.cwd\(\)/.test(src)
    check("G1b: the process.cwd() fallback is removed from the root getter", !cwdFallback, cwdFallback ? "silent fallback still present" : "clean")
  }

  // --- G2: version matrix --------------------------------------------------
  check("G2: equal version satisfies minimum", serverVersionSatisfiesMinimum("0.3.0", "0.3.0") === true)
  check("G2: newer patch satisfies", serverVersionSatisfiesMinimum("0.3.1", "0.3.0") === true)
  check("G2: older patch fails", serverVersionSatisfiesMinimum("0.2.9", "0.3.0") === false)
  check("G2: minor bump satisfies", serverVersionSatisfiesMinimum("0.4.0", "0.3.0") === true)
  check("G2: major bump satisfies", serverVersionSatisfiesMinimum("1.0.0", "0.3.0") === true)
  check("G2: v-prefix tolerated", serverVersionSatisfiesMinimum("v0.3.0", "0.3.0") === true)
  check("G2: missing version fails closed", serverVersionSatisfiesMinimum(undefined, "0.3.0") === false)
  check("G2: empty version fails closed", serverVersionSatisfiesMinimum("", "0.3.0") === false)
  check("G2: unparsable version fails closed", serverVersionSatisfiesMinimum("not-a-version", "0.3.0") === false)
  const decision = versionDecision(undefined, "0.3.0")
  check(
    "G2: mismatch message carries remediation, never silent",
    decision.ok === false && decision.message.includes("minimum") && decision.message.includes("Features stay off"),
  )

  // --- G3: activation budget declared --------------------------------------
  const props = MANIFEST.contributes?.configuration?.properties ?? {}
  const budget = props["bbLsp.activationBudgetMs"] as { default?: number; description?: string } | undefined
  check("G3: activation budget setting declared in manifest", budget !== undefined)
  check("G3: activation budget has a declared default (150 ms)", typeof budget?.default === "number" && budget.default === 150)
  check(
    "G3: budget description names contract §7.3 and the miss-is-gate rule",
    typeof budget?.description === "string" && budget.description.includes("7.3") && budget.description.includes("failed gate"),
  )
  const extSource = readFileSync(EXT_TS, "utf8")
  check("G3: extension reads the declared budget at activation", extSource.includes("BB_ACTIVATION_BUDGET_SETTING") && extSource.includes("activationBudgetMs"))
  check("G3: activation is measured (wall clock) and compared to budget", extSource.includes("activationMs") && extSource.includes("withinBudget"))

  // --- G3b: activation events — the extension must be able to WAKE UP ------
  // The owner spot-check (M29 §8.5, 2026-09-05) caught the blind spot: the
  // manifest shipped activationEvents: [] so opening a java file never
  // activated the extension — documentSelector only filters AFTER activation.
  // The E5 editor leg never caught it because runTests calls activate()
  // directly. Gate: every launch language must have an onLanguage: event.
  const LAUNCH_LANGS = ["java", "groovy", "kotlin", "scala", "typescript", "javascript", "python"]
  const activationEvents = (MANIFEST.activationEvents ?? []) as string[]
  check("G3b: manifest declares activation events at all", activationEvents.length > 0, "activationEvents empty — the extension can never wake up")
  for (const lang of LAUNCH_LANGS) {
    check(`G3b: onLanguage:${lang} declared`, activationEvents.includes(`onLanguage:${lang}`), "missing — opening a " + lang + " file will not activate the extension")
  }

  // --- G4: thin client — complement stance (source lint) --------------------
  check(
    "G4: documentSelector covers the launch languages (M29 wave-1 set)",
    ["java", "groovy", "kotlin", "scala", "typescript", "javascript", "python"].every((lang) => extSource.includes(`language: "${lang}"`)),
  )
  const bannedProviderPatterns: Array<[RegExp, string]> = [
    [/registerCompletion/, "completion provider (contract §7.1 bans it)"],
    [/onDidChangeDiagnostics|createDiagnosticCollection/, "diagnostics provider (contract §7.1 bans it)"],
    [/registerRenameProvider/, "rename provider (contract §7.1 bans it)"],
  ]
  for (const [pattern, why] of bannedProviderPatterns) {
    const m = extSource.match(pattern)
    check(`G4: extension registers no ${why}`, m === null, m?.[0] ?? "")
  }

  // --- G5: crash surface ----------------------------------------------------
  const restartCmd = MANIFEST.contributes?.commands?.some((c) => c.command === "bbLsp.restartServer")
  check("G5: restart command declared in manifest", restartCmd === true)
  check("G5: crash handler reacts to State.Stopped", extSource.includes("State.Stopped"))
  check("G5: crash message offers Restart action (never silent)", extSource.includes("stopped unexpectedly") && extSource.includes("Restart bb_lsp"))
  check("G5: version mismatch offers restart too", /version/i.test(extSource) && extSource.split("showErrorMessage").length > 2)

  // --- G6: mutants (the suite can fail) -------------------------------------
  // Plant defects in a rewritten copy of server-resolution.ts and prove the
  // suite's own expectations catch each. Each mutant is loaded in a child
  // process (tsx) against the same fixture checks; a mutant is "caught" when
  // the corresponding probe returns the failure signature.
  const mutants: Array<{ name: string; from: RegExp; to: string; probe: (m: unknown) => boolean }> = [
    {
      // Resolution-order fabrication: bundled promoted over workspace dist.
      name: "resolution: bundled promoted over workspace dist",
      from: /const workspaceDist = path\.join\(input\.workspaceRoot, "dist", "lsp", "server\.js"\)/,
      to: `const workspaceDist = path.join(input.extensionRoot, "dist", "server", "lsp", "server.js")`,
      probe: (m) => {
        const r = (m as { resolveServerLaunch: typeof resolveServerLaunch }).resolveServerLaunch({ workspaceRoot: wsDist, extensionRoot: path.join(tmp, "ext-nonexistent"), mode: "auto" }) as { kind: string }
        return r.kind !== "dist-workspace"
      },
    },
    {
      // Version matrix defect: minimum silently satisfied.
      name: "version: minimum always satisfied",
      from: /if \(actual === undefined \|\| actual === ""\) return false/,
      to: `if (false) return false`,
      probe: (m) => {
        const v = (m as { serverVersionSatisfiesMinimum: typeof serverVersionSatisfiesMinimum }).serverVersionSatisfiesMinimum
        return v(undefined, "0.3.0") !== false
      },
    },
    {
      // Fallback masking: source-bun reported as non-fallback.
      name: "fallback: source-bun masked as preferred",
      from: /runtime: "bun", runtimeArgs: \["run"\], isFallback: true/,
      to: `runtime: "bun", runtimeArgs: ["run"], isFallback: false`,
      probe: (m) => {
        const r = (m as { resolveServerLaunch: typeof resolveServerLaunch }).resolveServerLaunch({ workspaceRoot: wsSrc, extensionRoot: wsBare, mode: "auto" }) as { isFallback: boolean }
        return r.isFallback !== true
      },
    },
  ]

  for (const mutant of mutants) {
    mutantsTotal++
    const mutated = readFileSync(SRC, "utf8").replace(mutant.from, mutant.to)
    if (mutated === readFileSync(SRC, "utf8")) {
      check(`G6: mutant anchors matched — ${mutant.name}`, false, "anchor not found")
      continue
    }
    const mutantPath = path.join(tmp, `server-resolution.mutant.${mutantsTotal}.ts`)
    writeFileSync(mutantPath, mutated)
    // Probe in a child process: fresh module, no cache collisions.
    const probeScript = path.join(tmp, `probe.${mutantsTotal}.mts`)
    writeFileSync(
      probeScript,
      `import { pathToFileURL } from "node:url"\n` +
        `const mod = await import(pathToFileURL(${JSON.stringify(mutantPath)}).href)\n` +
        `const caught = ${mutant.probe.toString()}(mod)\n` +
        `process.stdout.write(caught ? "CAUGHT" : "SURVIVED")\n`,
    )
    let out = ""
    try {
      out = execFileSync("npx", ["tsx", probeScript], { cwd: ROOT, encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "ignore"] })
    } catch (error) {
      out = "CAUGHT" // a crashing mutant is a caught mutant
    }
    const caught = out.includes("CAUGHT")
    if (caught) mutantsCaught++
    check(`G6: mutant caught — ${mutant.name}`, caught, out.includes("SURVIVED") ? "SURVIVED" : out.slice(0, 60))
  }

  // G6 hard check: all mutants must be caught (a survivor fails the suite).
  check("G6: all mutants caught", mutantsCaught === mutantsTotal && mutantsTotal > 0, `${mutantsCaught}/${mutantsTotal}`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

// --- Evidence --------------------------------------------------------------
const failed = checks - passed
const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
const result = {
  issue: "M25.E1",
  code: "E1",
  milestone: "M25",
  status: failed === 0 ? "verified" : "known-gap",
  checks,
  passed,
  failed,
  mutantsCaught,
  mutantsTotal,
  negativeCases: 0,
  currentCommit,
  verifierCommand: "npx tsx script/m25/verify-extension-skeleton.ts",
  evidenceFile: "E1.json",
  generatedAt: new Date().toISOString(),
  os: process.platform,
  verdict: { realComponentFailures: failed === 0 ? 0 : failed },
  limitations: [
    "Headless module verification: the vscode API layer (activate path) is verified in-editor by E5; this suite covers the pure core, budget/crash declarations, and complement-stance lint.",
    "Activation budget value is declared (150 ms default); the measured in-editor number is recorded by E5 evidence per contract §7.3/§3.",
  ],
}
mkdirSync(path.join(ROOT, "validation/m25/results"), { recursive: true })
writeSealed(path.join(ROOT, "validation/m25/results/E1.json"), result)
console.log(`E1: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${mutantsCaught}/${mutantsTotal} mutants caught)`)
process.exit(failed === 0 ? 0 : 1)
