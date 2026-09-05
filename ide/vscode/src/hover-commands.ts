// ide/vscode/src/hover-commands.ts — M42.H2 (issue #650): hover link actions.
//
// The rich hover body composes command URIs — bb.openUsage, bb.openDefinition,
// bb.showAllUsages — whose args are the index-stored LSP location
// {file, line, character} (0-based, contract §12.1: every target is an
// index-stored location; nothing guessed). THIS module is the client-side
// owner of those commands:
//   - strict arg validation — an unparseable or non-file arg is an ERROR
//     surfaced to the user, never a silent no-op;
//   - bb.openUsage / bb.openDefinition reveal the target and move the cursor;
//   - bb.showAllUsages reveals the hovered symbol, then hands off to the
//     editor's NATIVE references surface (the same surface the "N more"
//     count refers to — one door, whatever the editor ships).
//
// Pure arg parsing is exported headless so the E5 inner test and the drift
// gate can assert the exact contract without spawning a UI.

import * as vscode from "vscode"

export const OPEN_USAGE = "bb.openUsage"
export const OPEN_DEFINITION = "bb.openDefinition"
export const SHOW_ALL_USAGES = "bb.showAllUsages"

export interface HoverLinkArgs {
  file: string
  line: number
  character: number
}

/** Parse the args the hover markdown embeds. Strict: rejects any payload
 *  that is not an object with a string file and integer line/character. */
export function parseHoverLinkArgs(raw: unknown): HoverLinkArgs | null {
  if (typeof raw !== "object" || raw === null) return null
  const a = raw as Record<string, unknown>
  if (typeof a.file !== "string" || a.file.length === 0) return null
  if (typeof a.line !== "number" || !Number.isInteger(a.line) || a.line < 0) return null
  if (typeof a.character !== "number" || !Number.isInteger(a.character) || a.character < 0) return null
  return { file: a.file, line: a.line, character: a.character }
}

/** Reveal a file at an LSP position and move the cursor there. */
export async function revealLocation(args: HoverLinkArgs): Promise<void> {
  const uri = vscode.Uri.file(args.file)
  const pos = new vscode.Position(args.line, args.character)
  const editor = await vscode.window.showTextDocument(uri, { preview: true, preserveFocus: false })
  const range = new vscode.Range(pos, pos)
  editor.selection = new vscode.Selection(pos, pos)
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
}

function register(ctx: vscode.ExtensionContext): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand(OPEN_USAGE, async (raw: unknown) => {
      const args = parseHoverLinkArgs(raw)
      if (args === null) {
        void vscode.window.showErrorMessage("bb_lsp: malformed bb.openUsage link (no navigation).")
        return
      }
      await revealLocation(args)
    }),
    vscode.commands.registerCommand(OPEN_DEFINITION, async (raw: unknown) => {
      const args = parseHoverLinkArgs(raw)
      if (args === null) {
        void vscode.window.showErrorMessage("bb_lsp: malformed bb.openDefinition link (no navigation).")
        return
      }
      await revealLocation(args)
    }),
    vscode.commands.registerCommand(SHOW_ALL_USAGES, async (raw: unknown) => {
      const args = parseHoverLinkArgs(raw)
      if (args === null) {
        void vscode.window.showErrorMessage("bb_lsp: malformed bb.showAllUsages link (no navigation).")
        return
      }
      // Reveal first (always works), then hand off to the native references
      // surface — the editor's own door to the same L3 location set the
      // hover's "N more" counts. Best-effort: a fork without the command
      // still lands the cursor on the symbol (never silent about it).
      await revealLocation(args)
      try {
        await vscode.commands.executeCommand("editor.action.referencesTrigger")
      } catch {
        void vscode.window.showInformationMessage("bb_lsp: this editor has no native references view; cursor placed on the symbol.")
      }
    }),
  )
}

export { register as registerHoverCommands }
