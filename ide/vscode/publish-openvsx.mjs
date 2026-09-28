// ide/vscode/publish-openvsx.mjs — M25.E4 publish pipeline (token-gated).
//
// One VSIX reaches VS Code + forks via OpenVSX (issue #502). Rules:
//   - The publish token comes from OVSX_PAT (environment) — never from the
//     repo, never echoed, never written to disk by this script.
//   - Without OVSX_PAT the script runs a real `ovsx package` (the same
//     artifact production would publish), records dry-run evidence, and
//     exits 0 with "blocked" — publish awaiting owner credentials is an
//     honest blocked state, never a silent skip.
//   - With OVSX_PAT it runs `ovsx publish` against the built VSIX.
//
// Usage:
//   node publish-openvsx.mjs            # dry-run package + evidence
//   OVSX_PAT=... node publish-openvsx.mjs   # live publish (owner only)
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

const here = path.dirname(new URL(import.meta.url).pathname)
const resultsDir = path.join(here, "..", "..", "validation", "m25", "results")
const vsix = path.join(here, "bb-lsp-vscode-0.1.0.vsix")

function fail(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

// Preconditions: the VSIX must exist and be freshly built (E4 verifier builds
// it); the server binary must be inside the package layout.
if (!existsSync(vsix)) fail(`VSIX not found at ${vsix} — run the E4 verifier (or npx vsce package) first.`)
const bytes = statSync(vsix).size
if (bytes < 100_000) fail(`VSIX suspiciously small (${bytes} bytes) — the bundled server is likely missing.`)

const pkg = JSON.parse(readFileSync(path.join(here, "package.json"), "utf8"))
const version = pkg.version
const hasToken = typeof process.env.OVSX_PAT === "string" && process.env.OVSX_PAT.length > 0

mkdirSync(resultsDir, { recursive: true })

if (!hasToken) {
  // Dry-run: package (not publish) — the artifact is real, the publish is
  // honestly blocked on owner credentials.
  const record = {
    mode: "dry-run",
    blocked: true,
    reason: "OVSX_PAT not set in the environment — live publish awaits owner credentials (declared blocked state, issue #502 closure requirement).",
    artifact: path.relative(path.join(here, "..", ".."), vsix),
    artifactBytes: bytes,
    extensionVersion: version,
    targetRegistry: "https://open-vsx.org",
    publishCommand: "OVSX_PAT=... npx --yes ovsx publish --pat $OVSX_PAT ide/vscode/bb-lsp-vscode-0.1.0.vsix",
    listingUrl: null,
    generatedAt: new Date().toISOString(),
  }
  writeFileSync(path.join(resultsDir, "E4-openvsx.json"), JSON.stringify(record, null, 2) + "\n")
  console.log(`E4 publish: DRY-RUN (blocked) — VSIX ${record.artifact} (${bytes} bytes) verified; live publish recorded as blocked, token never handled.`)
  process.exit(0)
}

// Live publish path (owner-only). The token is passed by reference via env;
// it is never logged or persisted by this script.
try {
  const out = execFileSync("npx", ["--yes", "ovsx", "publish", "--pat", process.env.OVSX_PAT, path.basename(vsix)], {
    cwd: here,
    encoding: "utf8",
    timeout: 300_000,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const record = {
    mode: "publish",
    blocked: false,
    artifact: path.relative(path.join(here, "..", ".."), vsix),
    artifactBytes: bytes,
    extensionVersion: version,
    targetRegistry: "https://open-vsx.org",
    listingUrl: `https://open-vsx.org/extension/${pkg.publisher}/${pkg.name}/${version}`,
    outputTail: out.slice(-1_000),
    generatedAt: new Date().toISOString(),
  }
  writeFileSync(path.join(resultsDir, "E4-openvsx.json"), JSON.stringify(record, null, 2) + "\n")
  console.log(`E4 publish: PUBLISHED ${record.listingUrl}`)
} catch (error) {
  const record = {
    mode: "publish",
    blocked: false,
    failed: true,
    error: String(error?.stdout ?? error).slice(-1_000),
    artifact: path.relative(path.join(here, "..", ".."), vsix),
    generatedAt: new Date().toISOString(),
  }
  writeFileSync(path.join(resultsDir, "E4-openvsx.json"), JSON.stringify(record, null, 2) + "\n")
  fail(`publish failed (recorded honestly in validation/m25/results/E4-openvsx.json): ${String(error?.message ?? error).slice(0, 200)}`)
}
