// ide/vscode/src/extension.ts — M25.E1 entry (thin client).
//
// The extension stays thin: all intelligence lives in bb_lsp. This file owns
// exactly three E1 responsibilities:
//   1. Activation within the declared budget (contract §7.3): activate()
//      → client ready is measured with a wall clock and reported; a budget
//      miss is surfaced, never hidden. The declared budget is a setting
//      (`bbLsp.activationBudgetMs`) so the number is declared, not folklore.
//   2. LanguageClient wiring per the resolved launch (server-resolution.ts):
//      node + dist preferred, bun + source declared fallback, traceable via
//      bbLsp.trace.server.
//   3. Crash/error surface: a server crash or version mismatch shows a
//      visible message with a restart action — never silent feature absence
//      (issue #499 acceptance criterion).
//
// Activation discipline (budget): activate() only starts the client and
// returns; progress UX is E2 scope. All work here is non-blocking and the
// client start is awaited within the measured window.

import { workspace, window, commands, ExtensionContext, StatusBarAlignment, StatusBarItem, ProgressLocation, MarkdownString } from "vscode"
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  State,
  ErrorAction,
  CloseAction,
} from "vscode-languageclient/node"
import { resolveServerLaunch, versionDecision, ServerLaunch, SourceMode } from "./server-resolution"
import { createAutoIndexMachine, AutoIndexMachine } from "./auto-index"
import { renderStatus, StatusInput, StaleMarkerInput } from "./status-model"

export const BB_ACTIVATION_BUDGET_SETTING = "bbLsp.activationBudgetMs"
export const BB_MIN_SERVER_VERSION_SETTING = "bbLsp.minServerVersion"
export const BB_SERVER_PATH_SETTING = "bbLsp.serverPath"
export const BB_SOURCE_MODE_SETTING = "bbLsp.sourceMode"

export type ActivationReport = {
  /** activate() → control returned to the editor (§7.3 regime), ms. */
  activationMs: number
  /** activate() → client fully handshaken with the server, ms. */
  handshakeMs?: number
  /** Declared budget from settings at activation time. */
  declaredBudgetMs: number
  withinBudget: boolean
  launch: ServerLaunch | null
  serverVersion: string | undefined
  versionOk: boolean
  /** Last client-side connection error, recorded by the errorHandler before
   *  default semantics run — crash evidence is never silent (contract §4). */
  lastClientError?: string
}

let client: LanguageClient | null = null
let activationReport: ActivationReport | null = null
let statusItem: StatusBarItem | null = null
let autoIndex: AutoIndexMachine | null = null
let lastStaleness: StaleMarkerInput | null = null
let lastIndexMessage: string | null = null
let contextRef: ExtensionContext | null = null

/** Readable from tests/commands: the auto-index state machine (E2). */
export function getAutoIndexMachine(): AutoIndexMachine | null {
  return autoIndex
}

/** E5 bridge: the extension's real LanguageClient as the shared
 *  LspTransport (one-library rule — assertions live in the core, this is
 *  the transport adapter). Null before the client exists. */
export function getLspTransport() {
  if (client === null) return null
  return {
    request: (method: string, params: unknown) => client!.sendRequest(method, params),
    notify: (method: string, params?: unknown) => void client!.sendNotification(method, params),
    ready: async () => {
      if (client!.state !== State.Running) await client!.start()
    },
    dispose: async () => {
      /* the client is disposed by deactivation; a test bridge does not own it */
    },
  }
}

/** Readable from tests/commands: the last activation measurement. */
export function getActivationReport(): ActivationReport | null {
  return activationReport
}

function readLaunchConfig(): { mode: SourceMode; serverPath: string; minVersion: string; budgetMs: number } {
  const cfg = workspace.getConfiguration()
  const mode = cfg.get<SourceMode>(BB_SOURCE_MODE_SETTING) ?? "auto"
  const serverPath = cfg.get<string>(BB_SERVER_PATH_SETTING) ?? ""
  const minVersion = cfg.get<string>(BB_MIN_SERVER_VERSION_SETTING) ?? "0.3.0"
  const budgetMs = cfg.get<number>(BB_ACTIVATION_BUDGET_SETTING) ?? 150
  return { mode, serverPath, minVersion, budgetMs }
}

function buildServerOptions(launch: ServerLaunch): ServerOptions {
  return {
    run: { command: launch.runtime, args: [...launch.runtimeArgs, launch.entryPath, "--dir", workspaceRoot()] },
    debug: { command: launch.runtime, args: [...launch.runtimeArgs, launch.entryPath, "--dir", workspaceRoot()] },
  }
}

function workspaceRoot(): string {
  return workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
}

/** Format the honest launch line for the status surface (E3 renders it later;
 *  E1 keeps it as text and in the output channel). */
export function describeLaunch(launch: ServerLaunch): string {
  const label: Record<ServerLaunch["kind"], string> = {
    "dist-workspace": "compiled dist (workspace)",
    "dist-bundled": "compiled dist (bundled)",
    explicit: launch.isFallback ? "explicit path (source via bun)" : "explicit path (dist)",
    "source-bun": "source via bun (declared fallback)",
  }
  return `${label[launch.kind]} — ${launch.entryPath}`
}

async function startClient(context: ExtensionContext, report: ActivationReport): Promise<void> {
  if (report.launch === null) return
  const serverOptions = buildServerOptions(report.launch)
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "java" },
      { scheme: "file", language: "groovy" },
      { scheme: "file", language: "kotlin" },
      { scheme: "file", language: "scala" },
      { scheme: "file", language: "typescript" },
      { scheme: "file", language: "javascript" },
      { scheme: "file", language: "python" },
    ],
    initializationOptions: {},
    // Hover links must fire (owner test, 2026-09-05): VS Code only executes
    // command: URIs in Markdown that is marked TRUSTED. The rich hover body
    // (bb.openUsage / bb.openDefinition / bb.openGraph / …) is composed by
    // OUR OWN server — self-produced content with our own bb.* commands — so
    // trusting it is safe and is what makes the actions clickable. Middleware
    // stamps every MarkdownString the client hands to the hover UI.
    middleware: {
      provideHover: (document, position, token, next) => {
        const result = next(document, position, token)
        if (result === null || result === undefined) return result
        return Promise.resolve(result).then((hover) => {
          const parts = Array.isArray(hover?.contents) ? hover!.contents : hover?.contents ? [hover!.contents] : []
          for (const part of parts) {
            if (part instanceof MarkdownString) part.isTrusted = true
          }
          return hover
        })
      },
    },
    // Crash evidence, never silence: record WHY the connection closed before
    // delegating to the default handler's semantics. E5's editor leg showed
    // the client stopping mid-session with zero diagnostics — the default
    // handler swallows the reason into an output channel nobody reads.
    errorHandler: {
      error: (error, message, count) => {
        const report = activationReport
        if (report !== null) report.lastClientError = `${error?.message ?? String(error)}${message ? ` :: ${String(message)}` : ""} (count ${String(count)})`
        window.showErrorMessage(`bb_lsp connection error: ${activationReport?.lastClientError ?? "unknown"}`)
        return { action: ErrorAction.Continue }
      },
      closed: () => {
        const report = activationReport
        const prior = report?.lastClientError
        if (report !== null) report.lastClientError = "connection closed" + (prior ? ` after: ${prior}` : " by server (no prior error recorded)")
        window.showErrorMessage("bb_lsp connection closed — navigation features are off. Use 'Restart bb_lsp' to recover.", "Restart bb_lsp").then((choice) => {
          if (choice === "Restart bb_lsp") void commands.executeCommand("bbLsp.restartServer")
        })
        return { action: CloseAction.DoNotRestart }
      },
    },
  }
  client = new LanguageClient("bbLsp", "Backbencher Brain (bb_lsp)", serverOptions, clientOptions)

  // Crash/error surface: never silent. A stopped-unexpectedly client offers
  // a restart action; a version mismatch (checked in onReady) disables
  // features with a visible message carrying the remediation text.
  client.onDidChangeState((event) => {
    if (event.newState === State.Stopped && activationReport !== null && activationReport.versionOk) {
      void window
        .showErrorMessage("bb_lsp server stopped unexpectedly. Navigation features are off.", "Restart bb_lsp")
        .then((choice) => {
          if (choice === "Restart bb_lsp") void commands.executeCommand("bbLsp.restartServer")
        })
    }
  })

  // Trace: the client id "bbLsp" makes vscode-languageclient honor the
  // `bbLsp.trace.server` setting (off/messages/verbose) natively — no manual
  // plumbing needed or allowed here.
  context.subscriptions.push(client)
  await client.start()

  if (client.state === State.Running) {
    // Version-compatibility check: initializeResult.serverInfo.version vs
    // the declared minimum. Mismatch → features off + visible message.
    const initializeResult = client.initializeResult
    const decision = versionDecision(
      initializeResult?.serverInfo?.version,
      readLaunchConfig().minVersion,
    )
    report.serverVersion = initializeResult?.serverInfo?.version
    report.versionOk = decision.ok
    if (!decision.ok) {
      void window.showErrorMessage(decision.message, "Restart bb_lsp").then((choice) => {
        if (choice === "Restart bb_lsp") void commands.executeCommand("bbLsp.restartServer")
      })
    }
  }
}

export async function activate(context: ExtensionContext): Promise<unknown> {
  const startedAt = Date.now()
  const { mode, serverPath, minVersion, budgetMs } = readLaunchConfig()
  const launchResult = resolveServerLaunch({
    workspaceRoot: workspaceRoot(),
    extensionRoot: context.extensionUri.fsPath,
    mode,
    explicitServerPath: serverPath,
  })
  const report: ActivationReport = {
    activationMs: 0,
    declaredBudgetMs: budgetMs,
    withinBudget: false,
    launch: "error" in launchResult ? null : launchResult,
    serverVersion: undefined,
    versionOk: false,
  }
  activationReport = report

  statusItem = window.createStatusBarItem(StatusBarAlignment.Right, 90)
  statusItem.name = "Backbencher Brain"
  context.subscriptions.push(statusItem)
  statusItem.text = "$(sync~spin) bb: starting"
  statusItem.show()

  if (report.launch === null) {
    const message = "error" in launchResult ? launchResult.error : "bb_lsp could not be resolved."
    statusItem.text = "$(error) bb: no server"
    statusItem.tooltip = message
    void window.showErrorMessage(message, "Show docs").then((choice) => {
      if (choice === "Show docs") void commands.executeCommand("vscode.open", "https://github.com/backbencher-hq/backbencher-brain")
    })
    report.activationMs = Date.now() - startedAt
    report.withinBudget = report.activationMs <= budgetMs
    return
  }

  commands.registerCommand("bbLsp.restartServer", async () => {
    if (client !== null) await client.stop()
    await startClient(context, activationReport ?? report)
  })
  commands.registerCommand("bbLsp.showGraph", async () => {
    const editor = window.activeTextEditor
    if (editor === undefined) {
      void window.showErrorMessage("Backbencher Graph: open a file and place the cursor on a symbol first.")
      return
    }
    const selection = editor.selection
    const word = editor.document.getText(selection.isEmpty ? editor.document.getWordRangeAtPosition(selection.active) : selection)
    if (word === undefined || word.length === 0) {
      void window.showErrorMessage("Backbencher Graph: place the cursor on a symbol first.")
      return
    }
    const { showGraphPanel } = await import("./graph-panel")
    await showGraphPanel(word, { client, cspSource: "" }, context)
  })
  commands.registerCommand("bbLsp.showServerStatus", () => {
    const r = activationReport
    if (r === null) return
    const lines = [
      `launch: ${r.launch ? describeLaunch(r.launch) : "unresolved"}`,
      `server version: ${r.serverVersion ?? "(not reported)"}`,
      `version ok: ${r.versionOk ? "yes" : "no"}`,
      `activation: ${r.activationMs} ms (declared budget ${r.declaredBudgetMs} ms, ${r.withinBudget ? "within" : "MISSED"})`,
    ]
    void window.showInformationMessage(lines.join("\n"), { modal: false })
  })
  // E3 status surface commands (declared in the manifest).
  commands.registerCommand("bbLsp.showStatusPanel", () => void showStatusPanel())
  commands.registerCommand("bbLsp.indexNow", () => void indexNow())
  // M42.H2 + H4: hover link actions (bb.openUsage / bb.openDefinition /
  // bb.showAllUsages / bb.openGraph / bb.openImpact / bb.showCallHierarchy) —
  // the clickable targets of the rich hover body. The webview actions get the
  // REAL client so panels resolve symbols server-side (never client-guessed).
  const { registerHoverCommands } = await import("./hover-commands")
  // Live getter, NOT a value: this runs before startClient() assigns the
  // module-level client, so capturing `client` here would freeze the hover
  // actions at null and every bb.openGraph / bb.openImpact panel would
  // render "bb_lsp is not running" forever (owner test, 2026-09-06).
  registerHoverCommands(context, { getClient: () => client, cspSource: "" })
  // Staleness follows the active editor; status renders after every change.
  context.subscriptions.push(
    window.onDidChangeActiveTextEditor(() => {
      void refreshStaleness().then(refreshStatus)
    }),
  )

  // Await client start inside the measured window (activation budget).
  // §7.3 measures the extension's OWN synchronous activation cost (resolve
  // launch, construct client, return control to the editor). The server
  // handshake completes asynchronously and is surfaced separately as
  // handshakeMs — the user can act on the editor immediately either way
  // (E2 auto-index runs strictly after this point, non-blocking).
  const clientStart = startClient(context, report)
  await Promise.race([clientStart, new Promise((r) => setTimeout(r, 0))])
  report.activationMs = Date.now() - startedAt
  report.withinBudget = report.activationMs <= budgetMs
  await clientStart.catch(() => {})
  report.handshakeMs = Date.now() - startedAt

  if (report.launch !== null && report.versionOk) {
    statusItem.text = "$(check) bb"
    statusItem.tooltip = `bb_lsp ready — ${describeLaunch(report.launch)} — activation ${report.activationMs} ms (budget ${budgetMs} ms)`
  } else if (report.launch !== null) {
    statusItem.text = "$(error) bb: version"
    statusItem.tooltip = "bb_lsp server version does not satisfy the declared minimum; features off."
  }

  // E2 auto-index flow: started strictly after the measured activation
  // window, never awaited by activate() (non-blocking guarantee).
  if (report.versionOk) beginAutoIndexFlow()

  // E3: initial honest render (server down/no-index render their failures
  // with actions — never a blank or optimistic surface).
  void refreshStaleness().then(refreshStatus)

  // Extension API surface (VS Code: ext.exports IS activate()'s return
  // value). Exposes the inspection/test bridge without reaching into
  // module state.
  return {
    getActivationReport: () => activationReport,
    getAutoIndexMachine: () => autoIndex,
    getLspTransport,
    refreshStatus,
    refreshStaleness,
  }
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop()
}

// ---------------------------------------------------------------------------
// E3: status surface. The single render path for the status bar — every fact
// goes through status-model.renderStatus so the render laws (stale ⇒ visible
// badge, unknown ⇒ never fresh, undeclared ⇒ never invented, failure ⇒
// action) hold everywhere. Issue #501.
// ---------------------------------------------------------------------------

/** Ask the server for the active file's staleness. Declared absence (the
 *  M24 server surface has no bb/staleness method yet) renders as UNKNOWN —
 *  treated as stale, never as fresh (silence is guilt). */
async function refreshStaleness(): Promise<void> {
  const editor = window.activeTextEditor
  if (client === null || client.state !== State.Running || editor === undefined) {
    lastStaleness = null
    return
  }
  try {
    const marker = (await client.sendRequest("bb/staleness", { uri: editor.document.uri.toString() })) as StaleMarkerInput | null
    lastStaleness = marker
  } catch {
    // Declared absence or transport failure: unknown, treated as stale.
    lastStaleness = { stale: true, status: "unknown", pendingReindex: false }
  }
}

/** Build the honest StatusInput from live state and render it. */
export function refreshStatus(): void {
  if (statusItem === null) return
  const input: StatusInput = {
    server: {
      up: client !== null && client.state === State.Running,
      version: activationReport?.serverVersion ?? null,
      versionOk: activationReport?.versionOk ?? false,
    },
    // Law-budget (contract §6/§7.3): the measured activation cost is user-
    // visible on the status surface — a budget miss degrades the badge and
    // the tooltip says so; it is never hidden behind a clean check.
    budget: activationReport
      ? { activationMs: activationReport.activationMs, declaredBudgetMs: activationReport.declaredBudgetMs, withinBudget: activationReport.withinBudget }
      : null,
    index: { phase: autoIndex?.state.phase ?? "no-index" },
    staleness: lastStaleness,
    language: window.activeTextEditor?.document.languageId ?? null,
  }
  const view = renderStatus(input)
  statusItem.text = view.badge
  const lines = [...view.tooltipLines]
  if (lastIndexMessage !== null) lines.push(`last event: ${lastIndexMessage}`)
  lines.push(...view.perLanguage.map((p) => `${p.language}: ${p.level} (${p.description})`))
  if (view.staleBadge !== null) lines.unshift(`⚠ STALE MARKER ACTIVE — results for this file may be wrong`)
  statusItem.tooltip = lines.join("\n")
  statusItem.command = "bbLsp.showStatusPanel"
}

/** The full panel: every fact, the per-language evidence table, and the
 *  remediation actions for any failure state (law-failure). */
export async function showStatusPanel(): Promise<void> {
  const input: StatusInput = {
    server: {
      up: client !== null && client.state === State.Running,
      version: activationReport?.serverVersion ?? null,
      versionOk: activationReport?.versionOk ?? false,
    },
    // Law-budget (contract §6/§7.3): the measured activation cost is user-
    // visible on the status surface — a budget miss degrades the badge and
    // the tooltip says so; it is never hidden behind a clean check.
    budget: activationReport
      ? { activationMs: activationReport.activationMs, declaredBudgetMs: activationReport.declaredBudgetMs, withinBudget: activationReport.withinBudget }
      : null,
    index: { phase: autoIndex?.state.phase ?? "no-index" },
    staleness: lastStaleness,
    language: window.activeTextEditor?.document.languageId ?? null,
  }
  const view = renderStatus(input)
  const lines = [
    "Backbencher Brain — status (every fact carries its claim level)",
    "",
    ...view.tooltipLines,
    "",
    "per-language evidence levels (declared, drift-gated):",
    ...view.perLanguage.map((p) => `  ${p.language.padEnd(12)} ${p.level.padEnd(4)} ${p.description}`),
  ]
  if (view.actions.length > 0) {
    const choice = await window.showInformationMessage(lines.join("\n"), ...view.actions.map((a) => a.title))
    const action = view.actions.find((a) => a.title === choice)
    if (action !== undefined) void commands.executeCommand(action.command)
  } else {
    void window.showInformationMessage(lines.join("\n"))
  }
}

// ---------------------------------------------------------------------------
// E2: auto-index on open. Fire-and-forget AFTER the activation budget window
// (issue #500: editor startup never blocked). Consent before any indexing;
// scale estimate shown in the consent dialog; progress notification with a
// working cancel that terminates the index process.
// ---------------------------------------------------------------------------

/** User-invoked indexing (also the panel's failure remediation). */
export async function indexNow(): Promise<void> {
  if (autoIndex === null) {
    beginAutoIndexFlow()
    return
  }
  if (autoIndex.state.phase === "awaiting-consent") {
    const ai = autoIndex
    await window.withProgress(
      { location: ProgressLocation.Notification, title: "bb_lsp: indexing workspace", cancellable: true },
      async (_progress, token) => {
        token.onCancellationRequested(() => ai.cancel())
        const done = new Promise<void>((resolve) => {
          const off = ai.onProgress((event) => {
            if (event.phase === "ready" || event.phase === "cancelled" || event.phase === "failed") {
              off()
              resolve()
            }
          })
        })
        await ai.decideConsent(true)
        await done
      },
    )
  } else if (autoIndex.state.phase !== "indexing" && autoIndex !== null) {
    await autoIndex.start("granted")
  }
  refreshStatus()
}

// ---------------------------------------------------------------------------
// E2: auto-index on open. Fire-and-forget AFTER the activation budget window
// (issue #500: editor startup never blocked). Consent before any indexing;
// scale estimate shown in the consent dialog; progress notification with a
// working cancel that terminates the index process.
// ---------------------------------------------------------------------------

export function beginAutoIndexFlow(): void {
  const root = workspaceRoot()
  // Declared mode surface (manifest `bbLsp.autoIndexMode`); the machine also
  // accepts BB_AUTOINDEX_MODE for headless/E5 runs. Default: ask.
  const settingMode = workspace.getConfiguration().get<"ask" | "never">("bbLsp.autoIndexMode") ?? "ask"
  const machine = createAutoIndexMachine({
    root,
    // Precedence (declared): an explicitly-set BB_AUTOINDEX_MODE in the
    // process env (headless/test orchestrators) wins over the workspace
    // setting — otherwise the extension silently overrides its caller.
    env: { ...process.env, BB_AUTOINDEX_MODE: process.env.BB_AUTOINDEX_MODE ?? settingMode },
  })
  autoIndex = machine
  const unsubscribe = machine.onProgress((event) => {
    lastIndexMessage = event.message
    refreshStatus()
  })
  void machine.start("not-granted").then(async () => {
    if (machine.state.phase === "ready") return // existing index — nothing to ask
    if (machine.state.phase !== "awaiting-consent") return // declined mode or failure
    const scale = machine.state.scale
    const choice = await window.showInformationMessage(
      `Backbencher Brain found no index for this workspace. ${scale.message}\n\nBuild the index now? (${scale.files} source files)`,
      "Index now",
      "Not now",
    )
    if (choice !== "Index now") {
      unsubscribe()
      return // no indexing without explicit consent
    }
    // Progress surface with a cancel that actually terminates the process.
    await window.withProgress(
      { location: ProgressLocation.Notification, title: "bb_lsp: indexing workspace", cancellable: true },
      async (_progress, token) => {
        token.onCancellationRequested(() => machine.cancel())
        const done = new Promise<void>((resolve) => {
          const off = machine.onProgress((event) => {
            if (event.phase === "ready" || event.phase === "cancelled" || event.phase === "failed") {
              off()
              resolve()
            }
          })
        })
        await machine.decideConsent(true)
        await done
      },
    )
    unsubscribe()
  })
}

// Re-exported for the harness (V1/E5) to assert on without reaching into
// private state.
export { ProgressLocation }
