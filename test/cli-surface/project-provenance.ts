// test/cli-surface/project-provenance.ts — every answer must say WHICH project it answered about.
//
// THE DEFECT THIS GUARDS. bb can be started with `--dir` pointing at project X while the
// caller is working in project Y. It then answers about X, with no error and no warning, and
// a query for a symbol that exists only in Y returns "no results" — which reads exactly like
// "that symbol does not exist".
//
// Measured, on this machine: an MCP server launched with `--dir /home/ishaq2321/ProxiCall`
// answered `bb_search runArm` with `totalMatches=0`, while the same binary pointed at
// backbencher-brain returned 6 matches. A whole session was spent concluding bb was
// unhelpful, when it had been answering about a different repository the entire time.
//
// A "no results" that is really "wrong repository" is the most dangerous shape of wrong
// answer: it is confident, it is well-formed, and it tells the caller to stop looking.
//
// The rule this suite enforces: an answer that came from a project other than the one the
// caller is rooted in must SAY SO. (Full re-rooting is a larger design change; declaration
// is the part that makes the failure visible instead of silent.)
//
//   npx tsx test/cli-surface/run-all.ts project-provenance.ts

import { writeFileSync, mkdirSync, utimesSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createSuite, guard, isolatedDataDir, dataDirPath, bb, FIXED_MTIME, REPO_ROOT } from "./harness.ts"

const suite = createSuite("project-provenance")

/** A tiny project whose symbol name is unique to it. */
function makeProject(tag: string, symbol: string): string {
  const root = mkdtempSync(path.join(tmpdir(), `bb-prov-${tag}-`))
  mkdirSync(path.join(root, "src"), { recursive: true })
  const f = path.join(root, "src", "index.ts")
  writeFileSync(f, `export function ${symbol}(x: number): number {\n  return x + 1\n}\n`)
  utimesSync(f, FIXED_MTIME, FIXED_MTIME)
  writeFileSync(path.join(root, "package.json"), `{\n  "name": "prov-${tag}",\n  "version": "1.0.0"\n}\n`)
  return root
}

guard(suite, async () => {
  isolatedDataDir("prov")

  const alpha = makeProject("alpha", "alphaOnlySymbol")
  const beta = makeProject("beta", "betaOnlySymbol")

  suite.section("index both projects")
  const ia = bb(["index", alpha, "--no-setup"], { cwd: alpha })
  suite.check("alpha indexed", ia.code === 0, ia.err.slice(0, 200))
  const ib = bb(["index", beta, "--no-setup"], { cwd: beta })
  suite.check("beta indexed", ib.code === 0, ib.err.slice(0, 200))

  suite.section("each project answers for itself")
  const own = bb(["mcp", "--help"], { cwd: REPO_ROOT })

  // The MCP answer path: drive the server the way a host does.
  const { spawnSync } = await import("node:child_process")
  function mcpSearch(dir: string, query: string): string {
    const script = `
      const { spawn } = require("node:child_process")
      const p = spawn(${JSON.stringify(path.join(REPO_ROOT, "bin", "bb"))}, ["mcp", "--dir", ${JSON.stringify(dir)}], { stdio: ["pipe","pipe","pipe"] })
      let buf = ""
      p.stdout.on("data", (b) => { buf += b.toString() })
      const send = (o) => p.stdin.write(JSON.stringify(o) + "\\n")
      send({ jsonrpc:"2.0", id:1, method:"initialize", params:{ protocolVersion:"2024-11-05", capabilities:{}, clientInfo:{name:"t",version:"1"} } })
      setTimeout(() => { send({ jsonrpc:"2.0", method:"notifications/initialized" }); send({ jsonrpc:"2.0", id:2, method:"tools/call", params:{ name:"bb_search", arguments:{ query: ${JSON.stringify(query)}, mode:"symbols", limit:5 } } }) }, 1200)
      setTimeout(() => {
        for (const line of buf.split("\\n")) { if (!line.trim().startsWith("{")) continue; try { const e = JSON.parse(line); if (e.id === 2) { console.log(e.result && e.result.content && e.result.content[0] ? e.result.content[0].text : JSON.stringify(e)); break } } catch {} }
        p.kill(); process.exit(0)
      }, 9000)
    `
    // The child server MUST share this suite's $BB_DATA_DIR, or it looks in ~/.bb, finds no
    // index, and every assertion below is about the wrong thing. Measured: without this the
    // "cross-project miss" case passed because the refusal happened to name the directory --
    // a true assertion for a false reason, which is the failure mode this whole file exists
    // to prevent.
    const r = spawnSync(process.execPath, ["-e", script], {
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, NO_COLOR: "1", BB_LOG_LEVEL: "error", BB_DATA_DIR: dataDirPath() },
    })
    return (r.stdout ?? "") + (r.stderr ?? "")
  }

  const alphaOwn = mcpSearch(alpha, "alphaOnlySymbol")
  suite.check("server pointed at alpha finds alphaOnlySymbol", /alphaOnlySymbol/.test(alphaOwn), alphaOwn.slice(0, 200))

  const betaOwn = mcpSearch(beta, "betaOnlySymbol")
  suite.check("server pointed at beta finds betaOnlySymbol", /betaOnlySymbol/.test(betaOwn), betaOwn.slice(0, 200))

  suite.section("the defect: a wrong-project answer must be VISIBLE, not silent")
  // Server serves beta, caller asks for a symbol that exists only in alpha.
  const crossAnswer = mcpSearch(beta, "alphaOnlySymbol")

  // The answer legitimately has no matches. What must NOT happen is an answer that looks
  // like "alphaOnlySymbol does not exist" with nothing saying the server was pointed at beta.
  const namesProject =
    crossAnswer.includes(beta) || new RegExp(path.basename(beta)).test(crossAnswer)
  suite.check(
    "a cross-project miss declares the project it was actually answering about",
    namesProject,
    `answer did not name ${path.basename(beta)}: ${crossAnswer.slice(0, 300)}`,
  )

  suite.section("and a hit must be attributable too")
  const betaHit = mcpSearch(beta, "betaOnlySymbol")
  suite.check(
    "a successful answer declares its project as well",
    new RegExp(path.basename(beta)).test(betaHit),
    `answer did not name ${path.basename(beta)}: ${betaHit.slice(0, 300)}`,
  )

  suite.finish()
})
