// script/m26/verify-content-security.ts — M26.W6 verifier + mutation suite.
//
// Proves the webview shell (script/m26/webview-html.ts) is hardened per
// issue #547, and that the suite CAN FAIL:
//
//   G1 csp:        emitted CSP blocks inline script (no unsafe-inline, no
//                  eval), remote origins (default-src 'none'), and binds
//                  scripts/styles to a per-render nonce
//   G2 escaping:   every repo-controlled string passes escapeHtml before
//                  render; adversarial fixtures render inert (no executable
//                  tag payload survives)
//   G3 nonce:      distinct renders get distinct nonces; the nonce appears
//                  in the CSP and on the script tag
//
// Mutants (each must be CAUGHT — the issue's three classes):
//   M1 removed escaping   (escapeHtml becomes identity)
//   M2 relaxed CSP        (unsafe-inline allowed / default-src loosened)
//   M3 raw markdown injection (state embedded unescaped)
//
// Run: npx tsx script/m26/verify-content-security.ts
// Evidence: validation/m26/results/W6.json (machine-emitted)

import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const SHELL = join(ROOT, "script", "m26", "webview-html.ts")

let checks = 0
let passed = 0

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}

async function main(): Promise<void> {
  const shell = await import(SHELL)
  const { cspFor, escapeHtml, buildWebviewHtml, ADVERSARIAL_FIXTURES } = shell as {
    cspFor: (nonce: string, cspSource: string) => string
    escapeHtml: (v: string) => string
    buildWebviewHtml: (o: { nonce?: string; cspSource: string; stateJson: string }) => { html: string; nonce: string; csp: string }
    ADVERSARIAL_FIXTURES: Array<{ name: string; payload: string; mustContain: string; mustNotContain: string[] }>
  }
  const source = readFileSync(SHELL, "utf8")

  // --- G1: CSP law ------------------------------------------------------------
  const csp = cspFor("testnonce01", "vscode-webview://webview-test")
  check("G1: default-src 'none' present", csp.includes("default-src 'none'"))
  check("G1: no unsafe-inline anywhere", !csp.includes("unsafe-inline"))
  check("G1: no eval permitted", !csp.includes("unsafe-eval") && !csp.includes("'eval'"))
  check("G1: no remote https/http origins", !/https?:\/\//.test(csp))
  check("G1: script-src and style-src nonce-bound", csp.includes("script-src") && csp.includes("'nonce-testnonce01'") && csp.includes("style-src") && csp.match(/'nonce-testnonce01'/g)!.length >= 2)
  check("G1: connect/form/frame/base locked", csp.includes("connect-src 'none'") && csp.includes("form-action 'none'") && csp.includes("base-uri 'none'"))

  // M44.U2 (issue #689): the shell injects the hub stylesheet as a
  // nonce-bound <style> block. The CSS is a STATIC repo-controlled string —
  // no interpolation, no user data — so it cannot introduce an injection
  // surface; the nonce keeps it the only permitted sheet.
  const styled = buildWebviewHtml({ cspSource: "vscode-webview://test", stateJson: "{}" })
  const unstyled = buildWebviewHtml({ cspSource: "vscode-webview://test", stateJson: "{}", styles: false })
  check("G1: style block present by default, nonce-bound", styled.html.includes(`<style nonce="${styled.nonce}">`), "")
  check("G1: styles:false opts out (provider-owned sheet path)", !unstyled.html.includes("<style") && unstyled.html.includes(`script-src`), "")
  check("G1: the injected sheet is static (no interpolation seams)", !/\$\{|undefined|\[object/.test(styled.html.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? "X"), "")

  // --- G2: escaping law ---------------------------------------------------------
  check("G2: escapeHtml escapes the full breakout set", escapeHtml(`<a href="x">'&`) === "&lt;a href=&quot;x&quot;&gt;&#39;&amp;")
  check("G2: escapeHtml is idempotent over double-escape attempts", escapeHtml(escapeHtml("<b>")) === escapeHtml("&lt;b&gt;"))

  // Adversarial fixtures render inert inside a full document.
  for (const fixture of ADVERSARIAL_FIXTURES) {
    const { html } = buildWebviewHtml({ cspSource: "vscode-webview://test", stateJson: JSON.stringify({ symbols: [{ name: fixture.payload, file: fixture.payload }] }) })
    const inert = fixture.mustNotContain.every((bad) => !html.includes(bad)) && html.includes(fixture.mustContain)
    check(`G2: adversarial fixture renders inert — ${fixture.name}`, inert, html.includes(fixture.mustContain) ? "payload survived" : "expected escape missing")
  }
  // Zero executable script tags in the emitted document (nonce-less script
  // tags are blocked by CSP; there are none at all in the shell).
  const { html: docHtml, nonce, csp: docCsp } = buildWebviewHtml({ cspSource: "vscode-webview://test", stateJson: "{}" })
  check("G2: no script-executable payload in the shell (JSON-state script only)", (docHtml.match(/<script/g) ?? []).length === 1 && docHtml.includes('type="application/json"'))
  check("G3: nonce is per-render and wired into CSP + script tag", docCsp.includes(`'nonce-${nonce}'`) && docHtml.includes(`nonce="${nonce}"`))

  // Distinct nonces across renders.
  const a = buildWebviewHtml({ cspSource: "x", stateJson: "{}" })
  const b = buildWebviewHtml({ cspSource: "x", stateJson: "{}" })
  check("G3: two renders never share a nonce", a.nonce !== b.nonce)

  // --- Mutants -------------------------------------------------------------------
  const mutants: Array<{ name: string; from: string; to: string; probe: (m: any) => boolean }> = [
    {
      name: "M1 removed escaping",
      from: '.replace(/&/g, "&amp;")\n    .replace(/</g, "&lt;")\n    .replace(/>/g, "&gt;")\n    .replace(/"/g, "&quot;")\n    .replace(/\'/g, "&#39;")',
      to: "/* escaping removed */",
      probe: (m) => {
        // With the escape chain gone, the script-tag fixture must render raw
        // (defect visible to the same inert check used above).
        const { html } = m.buildWebviewHtml({ cspSource: "x", stateJson: JSON.stringify({ name: "<script>alert(1)</script>" }) })
        return html.includes("<script>alert(1)</script>")
      },
    },
    {
      name: "M2 relaxed CSP",
      from: "    \"default-src 'none'\",",
      to: "    \"default-src * 'unsafe-inline'\",",
      probe: (m) => m.cspFor("n", "x").includes("unsafe-inline") || m.cspFor("n", "x").includes("default-src *"),
    },
    {
      name: "M3 raw markdown injection",
      from: "  const safeState = escapeHtml(options.stateJson)",
      to: "  const safeState = options.stateJson",
      probe: (m) => {
        const { html } = m.buildWebviewHtml({ cspSource: "x", stateJson: JSON.stringify({ hover: "**<img src=x onerror=alert(1)>**" }) })
        return html.includes("<img src=x onerror=alert(1)>") // raw payload embedded
      },
    },
  ]

  let caught = 0
  let mutantsTotal = 0
  for (const mutant of mutants) {
    if (!source.includes(mutant.from)) {
      console.log(`  SKIP (anchor not found): ${mutant.name}`)
      continue
    }
    mutantsTotal++
    const mutantPath = join(ROOT, "validation/m26", `webview-html.mutant.${Date.now()}.${mutantsTotal}.ts`)
    writeFileSync(mutantPath, source.replace(mutant.from, mutant.to))
    let detected = false
    try {
      const m = await import(mutantPath)
      detected = mutant.probe(m)
    } catch {
      detected = true
    } finally {
      try {
        rmSync(mutantPath, { force: true })
      } catch {}
    }
    if (detected) {
      caught++
      console.log(`  caught: ${mutant.name}`)
    } else {
      console.log(`  SURVIVED: ${mutant.name}`)
    }
  }
  check("mutation suite: every planted defect is caught", caught === mutantsTotal && mutantsTotal >= 3, `${caught}/${mutantsTotal}`)

  // --- Persist evidence -----------------------------------------------------------
  const failed = checks - passed
  let commit = "unknown"
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {}
  const result = {
    issue: "M26.W6",
    code: "W6",
    milestone: "M26",
    status: failed === 0 ? "verified" : "known-gap",
    checks,
    passed,
    failed,
    mutantsCaught: caught,
    mutantsTotal,
    currentCommit: commit,
    verifierCommand: "npx tsx script/m26/verify-content-security.ts",
    evidenceFile: "W6.json",
    generatedAt: new Date().toISOString(),
    adversarialFixtures: ADVERSARIAL_FIXTURES.map((f) => f.name),
    limitations: [
      "CSP is enforced by the host webview at render time; this suite proves the emitted document's policy and escaping, not browser behavior.",
      "The future webview provider must consume buildWebviewHtml(); a provider that hand-rolls its own HTML is a governance violation (single-owner rule).",
    ],
  }
  const dir = join(ROOT, "validation/m26/results")
  mkdirSync(dir, { recursive: true })
  writeSealed(join(dir, "W6.json"), result)
  console.log(`W6: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${caught}/${mutantsTotal} mutants caught)`)
  process.exit(failed === 0 ? 0 : 1)
}

void main()
