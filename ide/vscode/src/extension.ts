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

import { workspace, window, commands, ExtensionContext, StatusBarAlignment, StatusBarItem, ProgressLocation } from "vscode"
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  State,
} from "vscode-languageclient/node"
import { resolveServerLaunch, versionDecision, ServerLaunch, SourceMode } from "./server-resolution"
import { createAutoIndexMachine, AutoIndexMachine } from "./auto-index"

export const BB_ACTIVATION_BUDGET_SETTING = "bbLsp.activationBudgetMs"
export const BB_MIN_SERVER_VERSION_SETTING = "bbLsp.minServerVersion"
export const BB_SERVER_PATH_SETTING = "bbLsp.serverPath"
export const BB_SOURCE_MODE_SETTING = "bbLsp.sourceMode"

export type ActivationReport = {
  /** activate() → client running, measured wall-clock milliseconds. */
  activationMs: number
  /** Declared budget from settings at activation time. */
  declaredBudgetMs: number
  withinBudget: boolean
  launch: ServerLaunch | null
  serverVersion: string | undefined
  versionOk: boolean
}

let client: LanguageClient | null = null
let activationReport: ActivationReport | null = null
let statusItem: StatusBarItem | null = null
let autoIndex: AutoIndexMachine | null = null

/** Readable from tests/commands: the auto-index state machine (E2). */
export function getAutoIndexMachine(): AutoIndexMachine | null {
  return autoIndex
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
    ],
    initializationOptions: {},
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

export async function activate(context: ExtensionContext): Promise<void> {
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

  // Await client start inside the measured window (activation budget).
  await startClient(context, report)
  report.activationMs = Date.now() - startedAt
  report.withinBudget = report.activationMs <= budgetMs

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
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop()
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
    env: { ...process.env, BB_AUTOINDEX_MODE: settingMode },
  })
  autoIndex = machine
  const unsubscribe = machine.onProgress((event) => {
    if (statusItem !== null) {
      const phaseText: Record<typeof event.phase, string> = {
        estimating: "$(sync~spin) bb: estimating",
        "awaiting-consent": "$(question) bb: consent",
        indexing: "$(sync~spin) bb: indexing",
        ready: "$(check) bb",
        cancelled: "$(circle-slash) bb: paused",
        failed: "$(error) bb: index failed",
      }
      statusItem.text = phaseText[event.phase]
      statusItem.tooltip = event.message
    }
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
