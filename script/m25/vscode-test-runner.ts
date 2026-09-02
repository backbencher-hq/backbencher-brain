// script/m25/vscode-test-runner.ts — M25.V1: the vscode-test runner (executed
// by E5 inside a pinned VS Code; E6 adapts the same core for forks).
//
// TRANSPORT ADAPTER ONLY (one-library rule, issue #505): every feature
// assertion and the budget gate come from script/m25/feature-assertions.ts.
// This file owns exactly:
//   1. launching a pinned VS Code via @vscode/test-electron,
//   2. bridging the editor's LSP client (the extension's LanguageClient) to
//      the core's LspTransport,
//   3. recording the pinned editor version + OS + machine with the run.
//
// Execution model: E5 runs `npx tsx script/m25/run-vscode-e2e.ts` which
// compiles this adapter into the extension-host test; the adapter itself
// imports NO assertion logic of its own (lint-verified by verify-harness-core).
import type { LspTransport } from "./feature-assertions"

/** The pinned editor version for I3 evidence (declared, not folklore). */
export const PINNED_VSCODE_VERSION = "1.85.0"

/**
 * Bridge the extension's LanguageClient to the shared LspTransport. The
 * bridge is the ONLY editor-specific code in the whole assertion stack.
 */
export function languageClientTransport(client: {
  sendRequest(method: string, param: unknown): Promise<any>
  sendNotification(method: string, params?: unknown): Thenable<void>
  state: number
  start(): Promise<any>
  stop(): Thenable<void>
}): LspTransport {
  return {
    request: (method, params) => client.sendRequest(method, params),
    notify: (method, params) => void client.sendNotification(method, params),
    ready: async () => {
      if (client.state !== 2 /* State.Running */) await client.start()
    },
    dispose: async () => {
      await client.stop()
    },
  }
}

/** The record every in-editor run attaches (machine + versions, contract §3). */
export function editorRunProvenance(editorVersion: string): {
  editorVersion: string
  pinned: string
  os: string
  node: string
  at: string
} {
  return {
    editorVersion,
    pinned: PINNED_VSCODE_VERSION,
    os: `${process.platform} ${process.arch}`,
    node: process.version,
    at: new Date().toISOString(),
  }
}
