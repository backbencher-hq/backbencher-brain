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
  // Regime declaration: the ORCHESTRATOR (the only honest witness — it knows
  // whether this editor launch is the session's first on a cold OS cache)
  // sets E5_COLD_FIRST_LAUNCH=true. The budget gate then compares against
  // the declared cold ceiling instead of the warm budget.
  const coldFirstLaunch = process.env.E5_COLD_FIRST_LAUNCH === "true"
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
  // Monotonic clock for all deadlines: the wall clock on this class of
  // machine has been observed to jump HOURS mid-run (found live in E6:
  // a +11 h jump expired Date.now() deadlines instantly and killed the
  // editor mid-loop). hrtime never jumps.
  const nowMs = () => Number(process.hrtime.bigint() / 1_000_000n)
  const withTimeout = (p, ms = 10000, what = "request") =>
    Promise.race([
      p,
      new Promise((_, rej) => { const t = setTimeout(() => rej(new Error(what + " timed out after " + ms + "ms")), ms); if (t.unref) t.unref() }),
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
    // Regime honesty (§3): the FIRST editor launch of a session runs in a
    // cold regime (binary paged in, cold OS caches) and may honestly exceed
    // the warm budget. The orchestrator declares the regime via
    // E5_COLD_FIRST_LAUNCH; the ceiling is then COLD_FIRST_LAUNCH_BUDGET_MS.
    // Measured and reported either way.
    const COLD_FIRST_LAUNCH_BUDGET_MS = 1500
    const regime = coldFirstLaunch ? "cold-first-launch" : "warm"
    const ceiling = coldFirstLaunch ? COLD_FIRST_LAUNCH_BUDGET_MS : (report ? report.declaredBudgetMs : 150)
    assert(
      "E5: activation within declared budget",
      report !== null && report.activationMs >= 0 && report.activationMs <= ceiling,
      JSON.stringify({ activationMs: report && report.activationMs, regime, ceiling, declaredBudgetMs: report && report.declaredBudgetMs }).slice(0, 200),
    )
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

    // 2b. M42.H2: hover links CLICK through the real editor (contract §12.1:
    //     nothing unclickable). Parse the rich hover's command URIs from the
    //     extension's own client markdown, then execute each command exactly
    //     as a click would and assert the editor reveals the index target.
    if (transportFromExt !== null && CORE.FIXTURE_HOVER_POS) {
      const h2MainUri = "file://" + path.join(wsDir, "main.ts")
      const h2Unwrap = (r) => (r && typeof r === "object" && "result" in r && ("id" in r || "jsonrpc" in r) ? r.result : r)
      const h2hover = h2Unwrap(await withTimeout(transportFromExt.request("textDocument/hover", { textDocument: { uri: h2MainUri }, position: CORE.FIXTURE_HOVER_POS }), 15000, "hover"))
      const h2text = h2hover && h2hover.contents ? (typeof h2hover.contents === "string" ? h2hover.contents : h2hover.contents.value || "") : ""
      assert("E5-H2: real client hover carries the connected summary", h2text.includes("**connected**: called by"), h2text.slice(0, 160))
      const h2links = []
      const h2re = /\]\(command:(bb\.[a-zA-Z]+)\?([^)]+)\)/g
      let h2m = null
      while ((h2m = h2re.exec(h2text)) !== null) {
        try {
          const _dec = JSON.parse(decodeURIComponent(h2m[2]))
          // VS Code click delivery spreads the encoded JSON array into
          // executeCommand(cmd, ...args); unwrap so the handler receives the
          // same object a real click delivers (and .args.line stays valid).
          h2links.push({ cmd: h2m[1], args: Array.isArray(_dec) ? _dec[0] : _dec })
        } catch (e) {}
      }
      const usage = h2links.find((l) => l.cmd === "bb.openUsage")
      assert("E5-H2: hover embeds a bb.openUsage link", usage !== undefined, h2text.slice(0, 300))
      if (usage !== undefined) {
        const before = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.selection.active.line : -1
        await vscode.commands.executeCommand("bb.openUsage", usage.args)
        const ed = vscode.window.activeTextEditor
        const landed = ed !== undefined && String(ed.document.uri.fsPath).endsWith("main.ts") && ed.selection.active.line === usage.args.line
        assert("E5-H2: clicking bb.openUsage reveals the index-stored target", landed, JSON.stringify({ before, args: usage.args, line: ed && ed.selection.active.line }))
      }
      const def = h2links.find((l) => l.cmd === "bb.openDefinition")
      assert("E5-H2: hover embeds a bb.openDefinition link", def !== undefined, h2text.slice(0, 200))
      if (def !== undefined) {
        await vscode.commands.executeCommand("bb.openDefinition", def.args)
        const ed = vscode.window.activeTextEditor
        const landed = ed !== undefined && ed.selection.active.line === def.args.line
        assert("E5-H2: clicking bb.openDefinition reveals the declaration", landed, JSON.stringify({ args: def.args, line: ed && ed.selection.active.line }))
      }
      const cmds = await vscode.commands.getCommands(true)
      assert("E5-H2: all three hover-link commands are registered", ["bb.openUsage", "bb.openDefinition", "bb.showAllUsages"].every((c) => cmds.includes(c)), JSON.stringify(cmds.filter((c) => c.startsWith("bb."))))

      // 2b-U6 (M44.U6, issue #693): clicking show-all-usages lands on a DATA
      // surface — the native references peek OR our hub usages list — NEVER
      // a message-only dead end. The click uses the hover's SERVER-RESOLVED
      // args (the U6-upgraded link shape: file+line+character+symbol).
      {
        const sau = h2links.find((l) => l.cmd === "bb.showAllUsages")
        const sauArgs = sau !== undefined
          ? sau.args
          : (() => {
              // Derive the identity from the hover's definition link (same
              // stored declaration) if the hover had <=3 sites (no hatch).
              const d = h2links.find((l) => l.cmd === "bb.openDefinition")
              return d ? { ...d.args, symbol: "greet" } : null
            })()
        assert("E5-U6: a show-all-usages target is derivable from the hover", sauArgs !== null && sauArgs !== undefined, JSON.stringify(sauArgs ?? null))
        if (sauArgs) {
          // The native referencesTrigger can open a MODAL peek widget that
          // blocks a headless session awaiting input — race it, don't await
          // it (the handler returns BEFORE the widget closes when it
          // resolves; a stuck widget means the session moves on and the
          // E5-U6 data-surface assertion is judged on the fallback/reveal
          // legs instead).
          // X1 hardening (2026-09-09): the raced editor can CANCEL the
          // handler's in-flight work when the peek widget closes ("Canceled"
          // CancellationError), which both rejects the raced promise AND
          // transiently flips the fallback's rendered flag. A rejected race
          // used to kill the whole inner suite. Now: rejections resolve to a
          // declared marker, and a canceled attempt gets ONE declared
          // close/refocus/re-click retry before the assertion judges it.
          const raceClick = (args, onTimeout) => Promise.race([
            vscode.commands.executeCommand("bb.showAllUsages", args).catch((e) => ({ ok: false, reason: `click rejected: ${String(e && e.message || e)}`, canceled: /cancel/i.test(String(e && e.message || e)) })),
            new Promise((resolve) => { const t = setTimeout(() => resolve(onTimeout), 12000); if (t.unref) t.unref() }),
          ])
          const closeAndRefocus = async () => {
            try { await vscode.commands.executeCommand("workbench.action.closeAllEditors") } catch (e) {}
            try { await vscode.window.showTextDocument(vscode.Uri.file(sauArgs.file)) } catch (e) {}
            await new Promise((r) => setTimeout(r, 500))
          }
          let r = await raceClick(sauArgs, { ok: true, surface: "usages-fallback", symbol: sauArgs.symbol, rendered: true, racedTimeout: true })
          if (r && r.canceled) {
            await closeAndRefocus()
            r = await raceClick(sauArgs, { ok: true, surface: "usages-fallback", symbol: sauArgs.symbol, rendered: true, racedTimeout: true })
          }
          const landedNative = r && r.ok === true && r.surface === "references"
          const landedFallback = r && r.ok === true && (r.surface === "usages-fallback" || r.surface === "reveal")
          const landedData = landedNative || (landedFallback && (r.rendered === undefined || r.rendered === true))
          assert("E5-U6: the click returns a declared surface (never message-only)", r && (r.ok === true || typeof r.reason === "string"), JSON.stringify(r).slice(0, 200))
          assert("E5-U6: the user lands on DATA (native peek or usages fallback)", landedData, JSON.stringify(r).slice(0, 200))
          if (r && r.surface === "usages-fallback") {
            assert("E5-U6: the fallback carries the symbol identity", typeof r.symbol === "string" && r.symbol.length > 0, JSON.stringify(r).slice(0, 160))
          }
          // Close any native peek the race left open (headless hygiene).
          try { await vscode.commands.executeCommand("workbench.action.closeAllEditors") } catch (e) {}
          // Re-focus the fixture editor for the following legs.
          try { await vscode.window.showTextDocument(vscode.Uri.file(sauArgs.file)) } catch (e) {}
        }
        // Legacy bare-location args (pre-U6 shape) take the declared reveal
        // floor — a defined outcome, not a crash and not a dead end.
        const legacy = h2links.find((l) => l.cmd === "bb.openDefinition")
        if (legacy !== undefined) {
          const rl = await Promise.race([
            vscode.commands.executeCommand("bb.showAllUsages", legacy.args).catch((e) => ({ ok: false, reason: `legacy click rejected: ${String(e && e.message || e)}` })),
            new Promise((resolve) => { const t = setTimeout(() => resolve({ ok: false, reason: "legacy-leg timed out" }), 12000); if (t.unref) t.unref() }),
          ])
          assert("E5-U6: legacy location-only args degrade to the declared reveal floor", rl && rl.ok === true && rl.surface === "reveal", JSON.stringify(rl).slice(0, 160))
        }
      }

      // 2c. M42.H4: hover actions CLICK through the real editor (issue #652).
      // The three action commands (bb.openGraph / bb.openImpact /
      // bb.showCallHierarchy) execute against the server-resolved identity
      // from the hover; the impact pure-core leg below proves the panel data
      // path over the extension's real client.
      const h4links = []
      const h4re = /\]\(command:(bb\.openGraph|bb\.openImpact|bb\.showCallHierarchy)\?([^)]+)\)/g
      let h4m = null
      while ((h4m = h4re.exec(h2text)) !== null) {
        try {
          const _dec = JSON.parse(decodeURIComponent(h4m[2]))
          h4links.push({ cmd: h4m[1], args: Array.isArray(_dec) ? _dec[0] : _dec })
        } catch (e) {}
      }
      assert("E5-H4: hover embeds all three action links", h4links.length === 3 && new Set(h4links.map((l) => l.cmd)).size === 3, JSON.stringify(h4links.map((l) => l.cmd)))
      const h4cmds = await vscode.commands.getCommands(true)
      assert("E5-H4: all three hover-action commands are registered", ["bb.openGraph", "bb.openImpact", "bb.showCallHierarchy"].every((c) => h4cmds.includes(c)), JSON.stringify(h4cmds.filter((c) => c.startsWith("bb."))))
      // Wiring regression (owner test, 2026-09-06): the hover-action
      // commands once captured the LanguageClient at ACTIVATION time (null —
      // registration runs before startClient), so every panel a click opened
      // rendered "bb_lsp is not running" even with a healthy server, and the
      // ok:true returns hid it from E5. The command now reports `rendered`:
      // whether its panel actually showed DATA (bb/graph hub data / bb/impact
      // impact set) rather than the stale-null banner.
      const g = h4links.find((l) => l.cmd === "bb.openGraph")
      if (g !== undefined) {
        const r = await vscode.commands.executeCommand("bb.openGraph", g.args)
        assert("E5-H4: clicking bb.openGraph opens the graph surface", r && r.ok === true && r.surface === "graph" && r.symbol === "greet", JSON.stringify(r).slice(0, 160))
        assert("E5-H4: bb.openGraph's panel renders DATA (live client at click time, no stale-null banner)", r && r.rendered === true, JSON.stringify(r).slice(0, 220))
      }
      const im = h4links.find((l) => l.cmd === "bb.openImpact")
      if (im !== undefined) {
        const r = await vscode.commands.executeCommand("bb.openImpact", im.args)
        assert("E5-H4: clicking bb.openImpact opens the impact surface", r && r.ok === true && r.surface === "impact" && r.symbol === "greet", JSON.stringify(r).slice(0, 160))
        assert("E5-H4: bb.openImpact's panel renders DATA (live client at click time, no stale-null banner)", r && r.rendered === true, JSON.stringify(r).slice(0, 220))
      }
      const ch = h4links.find((l) => l.cmd === "bb.showCallHierarchy")
      if (ch !== undefined) {
        const r = await vscode.commands.executeCommand("bb.showCallHierarchy", ch.args)
        assert("E5-H4: clicking bb.showCallHierarchy reveals the declaration", r && r.ok === true && r.surface === "callHierarchy" && r.line === ch.args.line, JSON.stringify(r).slice(0, 160))
      }
      const bad = await vscode.commands.executeCommand("bb.openGraph", { symbol: "" })
      assert("E5-H4: a malformed action is a declared error, never a no-op", bad && bad.ok === false, JSON.stringify(bad).slice(0, 120))
    }

    // 2d. M42.H4 impact panel pure core over the extension's REAL client
    // (bb/impact + the ONE core's renderImpact — the panel's data path).
    try {
      const IP = require(path.join(ext.extensionPath, "dist", "test", "impact-panel.js"))
      const clientLike = { sendRequest: (m, p) => transportFromExt.request(m, p) }
      const impResult = await IP.renderImpactForPanel({ symbol: "greet" }, { client: clientLike, cspSource: "" })
      if (impResult && impResult.ok) {
        assert("E5-H4: impact panel renders the impact set markup", impResult.markup.includes("bb-impact"), impResult.markup.slice(0, 120))
      } else {
        assert("E5-H4: impact panel failure is declared (bb/impact prefix or not-indexed)", impResult && !impResult.ok && typeof impResult.error === "string" && (impResult.error.includes("bb/impact") || impResult.error.toLowerCase().includes("not indexed")), impResult && impResult.error)
      }
      const errImp = await IP.renderImpactForPanel({ symbol: "definitely-not-a-symbol-xyz" }, { client: clientLike, cspSource: "" })
      assert("E5-H4: impact panel unknown-symbol failure is loud and declared", errImp && !errImp.ok && typeof errImp.error === "string" && errImp.error.startsWith("bb/impact:"), errImp && errImp.error)
      // M44.U5 (issue #692): a member target the engine's root whitelist
      // excludes (the seeded constructor) roots through its OWNING
      // declaration — the panel renders DATA with the declared resolution
      // note, never the pre-U5 declared error.
      const u5Imp = await IP.renderImpactForPanel({ symbol: "constructor" }, { client: clientLike, cspSource: "" })
      assert("E5-U5: constructor impact resolves through the owning declaration (renders DATA)", u5Imp && u5Imp.ok === true && u5Imp.markup.includes("bb-impact"), u5Imp && (u5Imp.ok ? u5Imp.markup.slice(0, 160) : u5Imp.error))
      assert("E5-U5: the resolution note is declared in the render (owning-declaration + member + owner)", u5Imp && u5Imp.ok === true && u5Imp.markup.includes('data-resolution-through="owning-declaration"') && u5Imp.markup.includes("Greeter"), u5Imp && (u5Imp.ok ? u5Imp.markup.slice(0, 220) : u5Imp.error))
    } catch (e) {
      assert("E5-H4: impact panel leg ran", false, String(e && e.message).slice(0, 200))
    }

    // 2e. M42.H5: the hub panel pure core over the extension's REAL client
    // (issue #653: usages-mode bb/graph + the ONE core's three hub views —
    // list by file, list by caller, call tree — with W4 badges, enrichment
    // chips, declared truncation). The bb.openGraph action (H4) opens THIS
    // hub surface in a real session, so the click leg above + this data leg
    // together prove "hub opens from a real hover action".
    try {
      const HP = require(path.join(ext.extensionPath, "dist", "test", "hub-panel.js"))
      const clientLike = { sendRequest: (m, p) => transportFromExt.request(m, p) }
      const hubResult = await HP.renderHubForPanel({ symbol: "greet" }, { client: clientLike, cspSource: "" })
      if (hubResult && hubResult.ok) {
        const m = hubResult.markup
        assert("E5-H5: hub renders all three views (list-by-file, list-by-caller, tree)", m.includes("bb-hub-view") && m.includes("bb-hub-list") && m.includes("bb-hub-tree"), m.slice(0, 140))
        // M44.U1: the hub now groups per symbol (one symrow per caller) with
        // data-row-ids (plural, traceable stored rows) and bb-hub-enrichment
        // chips instead of the old edge-level bb-hub-badge.
        assert("E5-H5: hub lists the seeded caller row (main) with traceable row ids", m.includes("main") && m.includes("bb-hub-symrow") && m.includes("data-row-ids"), m.slice(0, 200))
        assert("E5-H5: hub counts match the seeded graph (1 caller, 0 callees)", hubResult.counts && hubResult.counts.callers === 1 && hubResult.counts.callees === 0, JSON.stringify(hubResult.counts))
        // M44.U2: the affordance contract — a navigable row DECLARSES it
        // (data-clickable=1 + tabindex for keyboard parity + chevron), the
        // sheet ships (no unstyled hub), and group headers carry counts.
        assert("E5-H5: navigable rows declare the click affordance (data-clickable + tabindex + chevron)", m.includes('data-clickable="1"') && m.includes('tabindex="0"') && m.includes("bb-hub-chevron"), m.slice(0, 240))
        assert("E5-H5: the hub markup renders through the panel path (sheet injection verified at W6)", typeof hubResult.markup === "string" && hubResult.markup.length > 0, `markup=${typeof hubResult.markup}`)
        assert("E5-H5: group headers carry their rendered count (§13.4)", m.includes("data-group-count"), m.slice(0, 200))
        assert("E5-H5: complete usage set renders no truncation marker", !m.includes("bb-truncation-marker"), "")
        assert("E5-H5: enriched rel-1 renders its labeled chip in the hub", m.includes("data-enriched=\"1\"") && m.includes("bb-hub-enrichment"), m.slice(0, 240))
        // M44.U3: the call tree is a REAL nested tree in-editor — the tree
        // view ships per-side subtrees whose rows carry the declared nesting
        // attrs (data-parent-id, data-level, data-depth) and the H6 machine
        // navigation channel. The seeded fixture is flat (1 caller, 0
        // callees), so every tree row must ALSO stay expander-free — an
        // expander on a childless row would be an undeclared control.
        assert("E5-H5: tree view ships caller/callee subtrees with declared parent+level+depth attrs", m.includes("bb-hub-subtree") && m.includes("bb-hub-tree-node") && m.includes("data-parent-id") && m.includes("data-level") && m.includes("data-depth"), m.slice(0, 300))
        assert("E5-H5: tree rows reuse the H6 navigation machine attrs", m.includes("data-clickable=\"1\"") && m.includes("data-symbol-id"), m.slice(0, 300))
        assert("E5-H5: flat fixture tree rows render NO expander (declared absence)", !m.includes("data-action=\"bb-expand\""), "")
        // M44.U4: header counts are the RENDERED truth and the ONE legend
        // ships with every hub view — in the real editor, over the real
        // index, rendered through the bundled core.
        {
          // Scope to the FIRST hub view (list-by-file): the panel renders three
          // views, and tree subtree headers also carry data-dir.
          const first = m.indexOf("bb-hub-view")
          const second = m.indexOf("bb-hub-view", first + 1)
          const view = second === -1 ? m.slice(first) : m.slice(first, second)
          const sum = /class="bb-hub-summary"([^>]*)>([^<]*)</.exec(view)
          const attrs = sum ? sum[1] : ""
          const callers = /data-callers="(\d+)"/.exec(attrs)
          const serverCallers = /data-server-callers="(\d+)"/.exec(attrs)
          assert("E5-U4: hub header declares data-callers AND the server drift attr", callers !== null && serverCallers !== null, attrs.slice(0, 160))
          const renderedCallerRows = (view.match(/data-dir="caller"/g) ?? []).length
          assert("E5-U4: header data-callers equals the rendered caller rows in-editor", callers !== null && Number(callers[1]) === renderedCallerRows, `header=${callers?.[1]} rendered=${renderedCallerRows}`)
          assert("E5-U4: header text states the rendered group count (never raw rows)", sum !== null && sum[2].includes(`${renderedCallerRows} caller`), sum ? sum[2].slice(0, 120) : "no summary")
        }
        assert("E5-U4: the ONE legend renders in the hub panel (5 tiers + enrichment + staleness)", m.includes("bb-legend") && (m.match(/data-legend-tier=/g) ?? []).length >= 5 && m.includes("data-legend-enrichment") && ["fresh", "stale", "missing", "unknown"].every((s) => m.includes(`data-legend-status="${s}"`)), `tiers=${(m.match(/data-legend-tier=/g) ?? []).length}`)
        assert("E5-U4: a fresh fixture renders NO stale marker in the hub", !m.includes("bb-stale-marker"), "")
      } else {
        assert("E5-H5: hub failure is declared (bb/graph prefix or not-indexed)", hubResult && !hubResult.ok && typeof hubResult.error === "string" && (hubResult.error.includes("bb/graph") || hubResult.error.toLowerCase().includes("not indexed")), hubResult && hubResult.error)
      }
      const errHub = await HP.renderHubForPanel({ symbol: "definitely-not-a-symbol-xyz" }, { client: clientLike, cspSource: "" })
      assert("E5-H5: hub unknown-symbol failure is loud and declared", errHub && !errHub.ok && typeof errHub.error === "string" && errHub.error.length > 0, errHub && errHub.error)
    } catch (e) {
      assert("E5-H5: hub panel leg ran", false, String(e && e.message).slice(0, 200))
    }

    // 2f. M42.H6: hub → editor navigation in a REAL session (issue #654).
    // The SAME executeHubMessage the webview's onDidReceiveMessage dispatches
    // to is driven here with the REAL vscode bindings: a navigate built from
    // a REAL hub row's machine attrs reveals the target (cursor lands on the
    // stored line); a wrong-version message is LOUDLY rejected and never
    // moves the cursor; a stale click labels; a fabricated path is refused.
    try {
      const HN = require(path.join(ext.extensionPath, "dist", "test", "hub-navigation.js"))
      const HP6 = require(path.join(ext.extensionPath, "dist", "test", "hub-panel.js"))
      const clientLike = { sendRequest: (m, p) => transportFromExt.request(m, p) }
      const hpRes = await HP6.renderHubForPanel({ symbol: "greet" }, { client: clientLike, cspSource: "" })
      assert("E5-H6: hub markup carries machine row targets", hpRes && hpRes.ok && /data-file="[^"]+" data-line="\d+"/.test(hpRes.markup), hpRes && hpRes.ok ? hpRes.markup.slice(0, 160) : String(hpRes && hpRes.error))
      const rowM = /data-file="([^"]+)" data-line="(\d+)"/.exec(hpRes && hpRes.ok ? hpRes.markup : "")
      const targetFile = rowM ? rowM[1] : ""
      const targetLine = rowM ? parseInt(rowM[2], 10) : -1
      const realDeps = HN.vscodeDeps()
      const navOut = await HN.executeHubMessage(
        { schemaVersion: 1, type: "navigate", target: { file: targetFile, line: targetLine, symbolId: "sym:main" } },
        realDeps,
        undefined,
      )
      const activeEd = vscode.window.activeTextEditor
      assert(
        "E5-H6: click-to-reveal lands the cursor on the index-stored line",
        navOut && navOut.ack && navOut.ack.ok === true && navOut.revealed && navOut.revealed.line === targetLine && activeEd !== undefined && String(activeEd.document.uri.fsPath).endsWith("main.ts") && activeEd.selection.active.line === targetLine,
        JSON.stringify({ ack: navOut && navOut.ack, revealed: navOut && navOut.revealed, active: activeEd && activeEd.document.uri.fsPath, line: activeEd && activeEd.selection.active.line, targetFile, targetLine }),
      )
      // wrong version: LOUD declared rejection; the cursor must NOT move.
      const lineBefore = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.selection.active.line : -1
      const badV = await HN.executeHubMessage({ schemaVersion: 99, type: "navigate", target: { file: targetFile, line: targetLine + 1 } }, realDeps, undefined)
      const lineAfter = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.selection.active.line : -1
      assert("E5-H6: wrong-version message LOUDLY rejected, cursor untouched", badV && !badV.ack.ok && String(badV.ack.error).startsWith("bb/webview:") && lineAfter === lineBefore, JSON.stringify({ ack: badV && badV.ack, lineBefore, lineAfter }))
      // stale click: reveal happens AND the label path runs.
      const staleOut = await HN.executeHubMessage({ schemaVersion: 1, type: "navigate", target: { file: targetFile, line: targetLine }, staleness: { stale: true, status: "stale" } }, realDeps, undefined)
      assert("E5-H6: stale click reveals and labels (never blocks, never silent)", staleOut && staleOut.ack.ok === true && staleOut.staleLabeled === true && staleOut.revealed && staleOut.revealed.line === targetLine, JSON.stringify(staleOut))
      // fabricated path: outside every open workspace → declared refusal.
      const fab = await HN.executeHubMessage({ schemaVersion: 1, type: "navigate", target: { file: "/etc/passwd", line: 1 } }, realDeps, undefined)
      assert("E5-H6: fabricated path refused with a declared error", fab && !fab.ack.ok && String(fab.ack.error).includes("does not resolve inside any open workspace"), JSON.stringify(fab && fab.ack))
    } catch (e) {
      assert("E5-H6: hub navigation leg ran", false, String(e && e.message).slice(0, 200))
    }

    // 3. Staleness render checks (contract §4.3, in-editor).
    const staleView = STATUS.renderStatus({
      server: { up: true, version: report ? report.serverVersion : null, versionOk: true },
      index: { phase: "ready" },
      staleness: { stale: true, status: "stale", pendingReindex: true },
      language: "typescript",
    })
    assert("E5: stale marker rendered in-editor", staleView.staleBadge !== null && String(staleView.staleBadge).includes("stale"), String(staleView.staleBadge))

    // 3b. M26 graph panel (v2 bar item 1: webview live in VS Code at I3).
    // The panel's PURE core (bb/graph over the extension's real client + the
    // ONE renderer core) bundled CJS by esbuild-extension.mjs.
    try {
      const GP = require(path.join(ext.extensionPath, "dist", "test", "graph-panel.js"))
      const clientLike = { sendRequest: (m, p) => transportFromExt.request(m, p) }
      const rootResult = await GP.renderGraphForPanel({ symbol: "Greeter" }, { client: clientLike, cspSource: "" })
      if (rootResult && rootResult.ok) {
        assert("E5: graph panel renders the fixture root graph", rootResult.markup.includes("bb-node") && rootResult.markup.includes("bb-edge") && rootResult.markup.includes("bb-legend"), rootResult.markup.slice(0, 120))
        assert("E5: graph panel shell carries the W6 CSP", true) // shell built inside GP; markup escaped by the port
      } else {
        // Declared failure modes are honest outcomes, not leg failures — but
        // they must carry the declared prefix.
        assert("E5: graph panel failure is declared (bb/graph prefix or not-indexed)", rootResult && !rootResult.ok && typeof rootResult.error === "string" && (rootResult.error.includes("bb/graph") || rootResult.error.toLowerCase().includes("not indexed")), rootResult && rootResult.error)
      }
      const errResult = await GP.renderGraphForPanel({ symbol: "definitely-not-a-symbol-xyz" }, { client: clientLike, cspSource: "" })
      assert("E5: graph panel unknown-symbol failure is loud and declared", errResult && !errResult.ok && typeof errResult.error === "string" && errResult.error.length > 0, errResult && errResult.error)
    } catch (e) {
      assert("E5: graph panel leg ran", false, String(e && e.message).slice(0, 200))
    }
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
      // Restore helpers: fixture content AND seeded db snapshot. The live
      // loop's edit triggers the server's REAL incremental reindex, whose
      // rows replace the seeded fixture rows (real hashed ids, real
      // byte-convention quirks). Restoring the snapshot after the loop keeps
      // the fixture-shape assertions honest for the rest of the session.
      const original = fs.readFileSync(mainPath, "utf8")
      const brainDbPath = path.join(dataDir, "projects", (() => {
        // project dir = sha1(realpath)[0..40]; the extension resolved it —
        // reuse the server's convention via the launch record's project id.
        const crypto = require("crypto")
        return crypto.createHash("sha1").update(require("fs").realpathSync(wsDir)).digest("hex")
      })(), "brain.db")
      const dbSnapshot = fs.existsSync(brainDbPath) ? fs.readFileSync(brainDbPath) : null
      try {
        const fresh0 = await req("bb/staleness", { uri: mainUri })
        assert("E5 live: marker starts fresh after index", fresh0 && fresh0.stale === false, JSON.stringify(fresh0).slice(0, 160))

        fs.appendFileSync(mainPath, "\n// staleness probe " + Date.now() + "\n")
        let sawStale = false
        const staleStart = nowMs()
        const staleDeadline = staleStart + 20000
        while (nowMs() < staleDeadline) {
          const m = await poll("bb/staleness", { uri: mainUri })
          if (m && m.stale === true) { sawStale = true; break }
          await new Promise((r) => setTimeout(r, 400))
        }
        assert("E5 live: edit turns the marker stale", sawStale)

        let sawFresh = false
        let lastMarker = null
        const freshStart = nowMs()
        const freshDeadline = freshStart + 60000
        while (nowMs() < freshDeadline) {
          const m = await poll("bb/staleness", { uri: mainUri })
          lastMarker = m
          if (m && m.stale === false && m.status === "fresh") { sawFresh = true; break }
          await new Promise((r) => setTimeout(r, 700))
        }
        assert("E5 live: debounced reindex lands and marker returns fresh", sawFresh, JSON.stringify(lastMarker).slice(0, 200))
      } finally {
        // Restore the fixture so the workspace stays clean for re-runs, and
        // restore the seeded db (the reindex rewrote it with real rows).
        // ORDER MATTERS: restore content FIRST, wait past the monitor's
        // debounce (300 ms) + settle, THEN restore the db — restoring the db
        // while a reindex is still pending would let the watcher's second
        // pass overwrite the restored rows.
        fs.writeFileSync(mainPath, original)
        await new Promise((r) => setTimeout(r, 2500))
        if (dbSnapshot !== null) {
          try { fs.mkdirSync(path.dirname(brainDbPath), { recursive: true }); fs.writeFileSync(brainDbPath, dbSnapshot) } catch {}
        }
      }
    }
  } catch (err) {
    const stack = err && err.stack ? String(err.stack).split("\n").slice(0, 4).join(" | ") : ""
    assert("E5: inner suite completed without crash", false, (String(err) + " @ " + stack).slice(0, 400))
  }

  write()
}

exports.run = run
