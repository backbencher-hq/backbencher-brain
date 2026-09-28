// ide/vscode/src/hub-navigation.ts — M42.H6 (issue #654): the vscode
// bindings over the PURE decision core (hub-navigation-core.ts).
//
// Thin by design: every decision (version validation, fabricated-path guard,
// stale labeling, ack discipline) lives in the core and is exercised
// headless by the verifier; this file supplies the real editor side effects
// and wires one panel's webview to the shared handler.
//
//   1. VALIDATE through the ONE protocol owner — a wrong schema version is a
//      LOUD declared bb/webview: error (never silent coercion);
//   2. REVEAL index-resolved navigate targets (the hub row's machine
//      data-file/data-line/data-symbol-id — no client-side position
//      guessing);
//   3. LABEL stale clicks — navigate carrying staleness reveals AND surfaces
//      the stale marker (honesty follows the click);
//   4. GUARD fabricated paths — outside every workspace root or not on disk
//      → declared error, never a reveal;
//   5. ACK — every handled message answers, the webview never waits silent.

import * as vscode from "vscode"
import type { HubMessage } from "../../../src/lsp/hub_protocol"
import {
  executeHubMessage,
  type HubNavigationDeps,
  type HubNavigationOutcome,
} from "./hub-navigation-core"

export type { HubNavigationOutcome, WorkspaceRoot } from "./hub-navigation-core"
export { executeHubMessage, resolveNavigateTarget } from "./hub-navigation-core"

/** The real vscode bindings. */
export function vscodeDeps(): HubNavigationDeps {
  return {
    workspaceRoots: (vscode.workspace.workspaceFolders ?? []).map((f) => ({ path: f.uri.fsPath })),
    exists: (p) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fs = require("node:fs") as typeof import("node:fs")
        return fs.existsSync(p)
      } catch {
        return false
      }
    },
    reveal: async (file, line, character, symbolId) => {
      const uri = vscode.Uri.file(file)
      const editor = await vscode.window.showTextDocument(uri, { preview: true, preserveFocus: false })
      const pos = new vscode.Position(line, character ?? 0)
      editor.selection = new vscode.Selection(pos, pos)
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport)
      void symbolId // identity carried for focus; the reveal IS the focus
      return { file, line: editor.selection.active.line }
    },
    staleSurface: (status) => {
      void vscode.window.setStatusBarMessage(`⚠️ Backbencher: stale — file changed since indexing (${status})`, 6000)
    },
  }
}

/** Wire one panel's webview to the handler. The refresh action re-renders
 *  the panel from its stored query (the panel supplies the re-render fn). */
export function wireWebviewMessages(
  webview: vscode.Webview,
  deps: HubNavigationDeps,
  refresh: ((msg: Extract<HubMessage, { type: "requestRefresh" }>) => Promise<void>) | undefined,
): vscode.Disposable {
  return webview.onDidReceiveMessage((raw: unknown) => {
    void executeHubMessage(raw, deps, refresh).then((outcome: HubNavigationOutcome) => {
      webview.postMessage(outcome.ack).then(undefined, () => undefined)
    })
  })
}
