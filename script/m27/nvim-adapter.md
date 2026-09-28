# bb_lsp in Neovim (M27.N1 adapter)

Pure configuration — no plugin required. bb_lsp attaches through Neovim's
built-in LSP client (`vim.lsp.start_client`); the server does the rest
(tiered hover, definition, references, symbols, call hierarchy, staleness via
`bb/staleness`).

## Launch order (declared — same order as the VS Code extension resolves)

1. `bb_lsp_path` (explicit override, set before requiring this config) —
   the owner override.
2. `<workspace>/dist/lsp/server.js` — the workspace's own backbencher-brain
   checkout, compiled dist (preferred).
3. `<backbencher-checkout>/dist/lsp/server.js` — any installed checkout found
   via `bb_lsp_root` (set before requiring).
4. `<workspace>/src/lsp/server.ts` via `bun run` — declared, labeled fallback
   (source mode; hover renders a source-mode note).

Everything else is refused loudly: bb_lsp never guesses.

## Config (drop into your init.lua or a ftplugin)

```lua
-- bb_lsp.lua — attach the Backbencher Brain language server
-- Usage: require('bb_lsp').attach() (or call from a FileType autocmd)
local M = {}

-- Declared launch order (see header). Empty = resolved at attach time.
M.bb_lsp_path = vim.env.BB_LSP_PATH or nil
M.bb_lsp_root = vim.env.BB_LSP_ROOT or nil

local function file_exists(p)
  return p ~= nil and vim.fn.filereadable(p) == 1
end

--- Resolve the bb_lsp entry. Returns {runtime, runtime_args, entry, mode}
--- or nil + a loud reason. Mirrors ide/vscode/src/server-resolution.ts.
function M.resolve(workspace_root)
  local candidates = {}
  if M.bb_lsp_path then
    table.insert(candidates, { runtime = "node", args = {}, entry = M.bb_lsp_path, mode = "dist" })
  end
  if M.bb_lsp_root then
    table.insert(candidates, { runtime = "node", args = {}, entry = M.bb_lsp_root .. "/dist/lsp/server.js", mode = "dist" })
  end
  table.insert(candidates, { runtime = "node", args = {}, entry = workspace_root .. "/dist/lsp/server.js", mode = "dist" })
  if M.bb_lsp_root then
    table.insert(candidates, { runtime = "bun", args = { "run" }, entry = M.bb_lsp_root .. "/src/lsp/server.ts", mode = "source" })
  end
  table.insert(candidates, { runtime = "bun", args = { "run" }, entry = workspace_root .. "/src/lsp/server.ts", mode = "source" })

  for _, c in ipairs(candidates) do
    if file_exists(c.entry) then
      return c
    end
  end
  vim.notify(
    "bb_lsp: no server found. Looked for bb_lsp_path, <bb_lsp_root>/dist/lsp/server.js, "
      .. "<workspace>/dist/lsp/server.js, and the bun source fallback. "
      .. "Install backbencher-brain or set BB_LSP_PATH.",
    vim.log.levels.WARN
  )
  return nil
end

--- Attach bb_lsp to the current buffer's workspace. Idempotent per root.
function M.attach()
  local ws = vim.fn.getcwd()
  local launch = M.resolve(ws)
  if not launch then
    return nil
  end
  local cmd
  if launch.runtime == "bun" then
    cmd = { "bun", "run", launch.entry, "--dir", ws }
  else
    cmd = { "node", launch.entry, "--dir", ws }
  end
  local client_id = vim.lsp.start({
    name = "bb_lsp",
    cmd = cmd,
    root_dir = ws,
    -- bb_lsp is a stdio server; capabilities come from the server itself.
    capabilities = vim.lsp.protocol.make_client_capabilities(),
  }, { reuse_client = function(client, _cfg) return client.name == "bb_lsp" and client.root_dir == ws end })
  return client_id
end

vim.api.nvim_create_autocmd("FileType", {
  pattern = { "typescript", "typescriptreact", "javascript", "javascriptreact", "java", "scala", "kotlin", "groovy", "python", "rust", "go", "c", "cpp", "csharp", "ruby", "php", "dart", "haskell", "zig", "vue", "svelte" },
  callback = function() M.attach() end,
  desc = "Attach bb_lsp (Backbencher Brain)",
})

return M
```

## What works in Neovim (honest surface)

- **hover** (`K`) — tiered evidence, usage count, staleness marker
- **definition / references** (`gd` / `gr`)
- **document symbols / workspace symbols**
- **call hierarchy** (incoming/outgoing)
- **staleness** via the private `bb/staleness` request

Not in Neovim (v3 scope): the graph webview — it is a VS Code panel
(M26, D-6). The capability matrix records this delta per editor.

## Verification

`npx tsx script/m27/verify-nvim.ts` drives the REAL Neovim headless with this
exact config (no mock transport) against the shared fixture workspace, and
asserts the same fixture answers the VS Code leg asserts. Evidence:
`validation/m27/results/N1.json`.
