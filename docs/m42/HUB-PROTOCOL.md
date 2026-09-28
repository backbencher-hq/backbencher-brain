# bb/webview — the hub→editor postMessage contract (M42.H6)

Schema version: **1**. Declared error prefix: `bb/webview:`.

Generated from `src/lsp/hub_protocol.ts` — this document is a claim the verifier
derives from the live module, so a hand edit or a protocol change without
regeneration fails `script/m42/verify-hub-navigation.ts` (byte-identical drift gate).

## navigate

click a hub usage row → the editor reveals that symbol at that line

| field | kind | required | note |
|---|---|---|---|
| `schemaVersion` | number | yes | must equal 1 — a mismatch is a loud declared error, never silent coercion |
| `type` | "navigate" | yes |  |
| `target.file` | string (absolute) | yes | index-resolved — the renderer's machine attrs, never parsed from display text |
| `target.line` | integer ≥ 0 | yes | 0-based LSP line of the target symbol (stored by the index) |
| `target.character` | integer ≥ 0 | no |  |
| `target.symbolId` | string | no | symbol identity for focus — never a guess |
| `staleness` | {stale: boolean, status: string} | no | a stale target is labeled stale AT the reveal — honesty follows the click |

## requestRefresh

the webview asks the panel to re-query the server for a symbol

| field | kind | required | note |
|---|---|---|---|
| `schemaVersion` | number | yes |  |
| `type` | "requestRefresh" | yes |  |
| `symbol` | string | yes |  |
| `file` | string | no |  |

## ack

the editor's answer to a webview message

| field | kind | required | note |
|---|---|---|---|
| `schemaVersion` | number | yes |  |
| `type` | "ack" | yes |  |
| `ok` | boolean | yes |  |
| `error` | string (bb/webview: prefix) | no | present exactly when !ok |

## Bridge script

buildBridgeScript() generates the nonce-bound webview script — the shapes the webview sends are the shapes this module validates.

