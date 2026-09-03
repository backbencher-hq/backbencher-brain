// script/m25/e5-inner.js — M25.E5 inner test (runs INSIDE the VS Code
// extension host, CJS, standard runTests contract: exports.run).
//
// Bridges the extension's REAL LanguageClient to the shared LspTransport and
// executes the shared assertion core + staleness render checks. Writes
// results to E5_OUT for the outer driver.
const vscode = require("vscode")
const fs = require("fs")
const path = require("path")

// Resolved at bundle time by the outer driver (paths substituted below).
const CORE = require("E5_CORE_PATH")
const STATUS = require("E5_STATUS_PATH")

async function run() {
  const outPath = process.env.E5_OUT
  const wsDir = process.env.E5_WS
  const dataDir = process.env.E5_DATA
  const results = { checks: [], measurements: [], activation: null }
  // Incremental breadcrumb: every check is persisted the moment it lands, so
  // a hang anywhere leaves its exact last-completed step on disk instead of a
  // silent timeout (a hung run taught us this the hard way).
  const write = () => fs.writeFileSync(outPath, JSON.stringify(results, null, 2))
  const assert = (name, ok, detail) => {
    results.checks.push({ name, ok, detail })
    write()
  }
  // No request may hang the suite: 10 s ceiling, then a loud failure that the
  // outer try/catch records (never a silent infinite wait).
  const withTimeout = (p, ms = 10000, what = "request") =>
    Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error(what + " timed out after " + ms + "ms")), ms)),
    ])

  try {
    // 1. Extension activation + honest activation report (E1 surface).
    const ext = vscode.extensions.getExtension("backbencher.bb-lsp-vscode")
    if (!ext) {
      assert("E5: extension present", false, "backbencher.bb-lsp-vscode not found")
      write()
      return
    }
    await ext.activate()
    assert("E5: extension activates", true)
    const api = ext.exports
    const report = api && api.getActivationReport ? api.getActivationReport() : null
    results.activation = report
    assert("E5: activation report exists", report !== null && report !== undefined)
    assert("E5: server launched and version ok", report !== null && report.versionOk === true, JSON.stringify(report).slice(0, 200))
    assert("E5: activation within declared budget", report !== null && report.withinBudget === true, JSON.stringify(report).slice(0, 200))
    const transportFromExt = api && api.getLspTransport ? api.getLspTransport() : null
    assert("E5: extension exposes its LanguageClient transport", transportFromExt !== null)

    // 2. Shared assertion core over the extension's REAL client transport
    //    (the same server the extension resolved, the editor stack included).
    //    skipLifecycle: the host already performed initialize/shutdown.
    if (transportFromExt !== null) {
      results.measurements = await withTimeout(
        CORE.runFeatureAssertions(
          { transport: transportFromExt, workspaceDir: wsDir, skipLifecycle: true },
          (name, ok, detail) => assert(name, ok, detail),
        ),
        120000,
        "shared assertion core",
      )
      write()
    }

    // 3. Staleness render checks (contract §4.3, in-editor).
    const staleView = STATUS.renderStatus({
      server: { up: true, version: report ? report.serverVersion : null, versionOk: true },
      index: { phase: "ready" },
      staleness: { stale: true, status: "stale", pendingReindex: true },
      language: "typescript",
    })
    assert("E5: stale marker rendered in-editor", staleView.staleBadge !== null && String(staleView.staleBadge).includes("stale"), String(staleView.staleBadge))
    const freshView = STATUS.renderStatus({
      server: { up: true, version: report ? report.serverVersion : null, versionOk: true },
      index: { phase: "ready" },
      staleness: { stale: false, status: "fresh", pendingReindex: false },
      language: "typescript",
    })
    assert("E5: fresh marker clears the badge", freshView.staleBadge === null)

    // 4. LIVE staleness loop through the extension's running server (§4.3):
    //    edit main.ts on disk -> marker turns stale -> monitor's debounced
    //    reindex lands -> marker returns fresh. The first bb/staleness
    //    request starts the monitor + watcher inside the server (declared
    //    lazy init).
    if (transportFromExt !== null) {
      const mainPath = path.join(wsDir, "main.ts")
      const mainUri = "file://" + mainPath
      const req = async (method, params) => {
        const r = await withTimeout(transportFromExt.request(method, params), 10000, method)
        return r && typeof r === "object" && "result" in r && ("id" in r || "jsonrpc" in r) ? r.result : r
      }
      // Polling helper: the FIRST staleness request triggers the monitor's
      // lazy init + worker-pool spin-up server-side, which can exceed the
      // per-request ceiling — a poll timeout is a retryable condition, not a
      // suite failure (the loop's deadline governs, not one slow call).
      const poll = async (method, params) => {
        for (let attempt = 0; ; attempt++) {
          try {
            return await req(method, params)
          } catch (err) {
            if (attempt >= 2) throw err
            await new Promise((r) => setTimeout(r, 1000))
          }
        }
      }
      // Restore helper: original fixture content.
      const original = fs.readFileSync(mainPath, "utf8")
      try {
        const fresh0 = await req("bb/staleness", { uri: mainUri })
        assert("E5 live: marker starts fresh after index", fresh0 && fresh0.stale === false, JSON.stringify(fresh0).slice(0, 160))

        fs.appendFileSync(mainPath, "\n// staleness probe " + Date.now() + "\n")
        let sawStale = false
        const staleDeadline = Date.now() + 20000
        while (Date.now() < staleDeadline) {
          const m = await poll("bb/staleness", { uri: mainUri })
          if (m && m.stale === true) { sawStale = true; break }
          await new Promise((r) => setTimeout(r, 400))
        }
        assert("E5 live: edit turns the marker stale", sawStale)

        let sawFresh = false
        let lastMarker = null
        const freshDeadline = Date.now() + 60000
        while (Date.now() < freshDeadline) {
          const m = await poll("bb/staleness", { uri: mainUri })
          lastMarker = m
          if (m && m.stale === false && m.status === "fresh") { sawFresh = true; break }
          await new Promise((r) => setTimeout(r, 700))
        }
        assert("E5 live: debounced reindex lands and marker returns fresh", sawFresh, JSON.stringify(lastMarker).slice(0, 200))
      } finally {
        // Restore the fixture so the workspace stays clean for re-runs.
        fs.writeFileSync(mainPath, original)
      }
    }
  } catch (err) {
    const stack = err && err.stack ? String(err.stack).split("\n").slice(0, 4).join(" | ") : ""
    assert("E5: inner suite completed without crash", false, (String(err) + " @ " + stack).slice(0, 400))
  }

  write()
}

exports.run = run
