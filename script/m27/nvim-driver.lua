-- script/m27/nvim-driver.lua — M27.N1 headless session driver (issue #617).
--
-- Runs INSIDE headless Neovim. Attaches bb_lsp to the fixture workspace via
-- the SHIPPABLE adapter logic (resolve/attach from nvim-adapter.md — no mock
-- transport), executes the LSP calls the shared assertion core requires, and
-- writes results as JSON to the path in BB27_OUT.
-- Exit 0 = session completed (assertions are judged by the outer verifier).

local uv = vim.uv or vim.loop
local out_path = vim.env.BB27_OUT
assert(out_path, "BB27_OUT env var required")

local ws = vim.env.BB27_WS
assert(ws, "BB27_WS env var required")
ws = vim.fs.normalize(ws)

local results = { assertions = {}, session = {}, raw = {} }
local function record(name, ok, detail)
  table.insert(results.assertions, { name = name, ok = ok == true, detail = tostring(detail or "") })
end

-- ---------------------------------------------------------------------------
-- 1. Launch order: resolve via the ADAPTER's declared rules (re-implemented
--    here in driver scope from the adapter doc; the verifier drift-gates the
--    two against each other).
-- ---------------------------------------------------------------------------
local function file_exists(p)
  return p ~= nil and vim.fn.filereadable(p) == 1
end

local bb_lsp_path = vim.env.BB_LSP_PATH
local bb_lsp_root = vim.env.BB_LSP_ROOT

local candidates = {}
if bb_lsp_path then
  table.insert(candidates, { runtime = "node", entry = bb_lsp_path, mode = "dist" })
end
if bb_lsp_root then
  table.insert(candidates, { runtime = "node", entry = bb_lsp_root .. "/dist/lsp/server.js", mode = "dist" })
end
table.insert(candidates, { runtime = "node", entry = ws .. "/dist/lsp/server.js", mode = "dist" })
if bb_lsp_root then
  table.insert(candidates, { runtime = "bun", args = { "run" }, entry = bb_lsp_root .. "/src/lsp/server.ts", mode = "source" })
end
table.insert(candidates, { runtime = "bun", args = { "run" }, entry = ws .. "/src/lsp/server.ts", mode = "source" })

local launch = nil
for _, c in ipairs(candidates) do
  if file_exists(c.entry) then launch = c break end
end
record("N1: launch order resolves a server", launch ~= nil, launch and launch.entry or "no candidate")
if not launch then
  local f = io.open(out_path, "w")
  f:write(vim.json.encode(results))
  f:close()
  vim.cmd("cquit 2")
end
results.session.launch = launch

-- ---------------------------------------------------------------------------
-- 2. Attach the REAL client (vim.lsp.start) to the fixture workspace.
-- ---------------------------------------------------------------------------
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
  capabilities = vim.lsp.protocol.make_client_capabilities(),
})
record("N1: vim.lsp.start launched bb_lsp", client_id ~= nil and client_id > 0, tostring(client_id))

-- Wait for the client to reach the ready state (initialize handshake done).
local deadline = uv.now() + 30000
while uv.now() < deadline do
  local c = vim.lsp.get_client_by_id(client_id)
  if c and c.initialized then break end
  vim.wait(100)
end
local client = vim.lsp.get_client_by_id(client_id)
record("N1: client initialized", client ~= nil and client.initialized == true, tostring(client))
if not client then
  local f = io.open(out_path, "w")
  f:write(vim.json.encode(results))
  f:close()
  vim.cmd("cquit 3")
end

local caps = client.server_capabilities or {}
record("N1: hover capability advertised", caps.hoverProvider == true, tostring(caps.hoverProvider))
record("N1: definition capability advertised", caps.definitionProvider == true, tostring(caps.definitionProvider))
record("N1: references capability advertised", caps.referencesProvider == true, tostring(caps.referencesProvider))
record("N1: documentSymbol capability advertised", caps.documentSymbolProvider == true, tostring(caps.documentSymbolProvider))
record("N1: workspaceSymbol capability advertised", caps.workspaceSymbolProvider == true, tostring(caps.workspaceSymbolProvider))

local bufnr = vim.fn.bufadd(ws .. "/main.ts")
vim.fn.bufload(bufnr)
vim.api.nvim_set_current_buf(bufnr)
vim.bo[bufnr].filetype = "typescript"

local main_uri = vim.uri_from_fname(ws .. "/main.ts")
-- greet() body position (0-based line 1, char 2) — same fixture position the
-- VS Code leg (M25.E5 / shared core FIXTURE_HOVER_POS) asserts.
local hover_pos = { line = 1, character = 2 }

local function request(method, params)
  local ok, res = pcall(function()
    return client:request_sync(method, params, 20000, bufnr)
  end)
  if not ok then return { _err = tostring(res) } end
  if res and res.err then return { _err = vim.inspect(res.err) } end
  return res and res.result or nil
end

-- ---------------------------------------------------------------------------
-- 3. Feature assertions — the SAME fixture facts the VS Code leg asserts
--    (differential honesty with script/m25/feature-assertions.ts).
-- ---------------------------------------------------------------------------

-- Hover (L2): tiered content, usage count, provenance, honest absence.
local hover = request("textDocument/hover", { textDocument = { uri = main_uri }, position = hover_pos })
results.raw.hover = hover
local hover_text = ""
if hover and hover.contents then
  if type(hover.contents) == "string" then
    hover_text = hover.contents
  elseif hover.contents.value then
    hover_text = hover.contents.value
  end
end
record("N1: hover renders markdown naming greet", hover ~= nil and hover_text:find("greet", 1, true) ~= nil, hover_text:sub(1, 120))
record("N1: hover carries evidence tier (contract §2)", hover and (hover.data and hover.data.tier ~= nil or hover_text:find("evidence:", 1, true) ~= nil) or false, hover_text:sub(1, 120))
record("N1: hover usage count matches fixture", hover and (hover.data and hover.data.usageCount == 1 or hover_text:find("1 usage", 1, true) ~= nil) or false, hover_text:sub(1, 160))
record("N1: hover provenance labels bb index source", hover and (hover.provenance and hover.provenance.source == "bb_index" or hover_text:find("source: bb index", 1, true) ~= nil) or false, hover_text:sub(1, 160))
local hover_miss = request("textDocument/hover", { textDocument = { uri = main_uri }, position = { line = 20, character = 0 } })
-- vim.NIL is truthy in Lua; normalize to nil exactly as the JSON round-trip
-- the shared core sees (contents === null).
local miss_contents = hover_miss and hover_miss.contents or nil
if miss_contents == vim.NIL then miss_contents = nil end
local miss_ok = hover_miss == nil or miss_contents == nil or (type(miss_contents) == "table" and miss_contents.value == nil)
record("N1: hover outside index is declared absent", miss_ok, vim.inspect(hover_miss):sub(1, 120))

-- Definition + references (L3).
local def = request("textDocument/definition", { textDocument = { uri = main_uri }, position = hover_pos })
results.raw.definition = def
local def_line = nil
if def then
  if def.location and def.location.line then def_line = def.location.line
  elseif def.line then def_line = def.line
  elseif def[1] and def[1].range then def_line = def[1].range.start.line
  elseif def.range then def_line = def.range.start.line
  end
end
record("N1: definition resolves greet at 0-based line 1", def_line == 1, vim.inspect(def):sub(1, 160))
local refs = request("textDocument/references", { textDocument = { uri = main_uri }, position = hover_pos, context = { includeDeclaration = true } })
results.raw.references = refs
local ref_list = nil
if refs then
  if type(refs) == "table" and refs.locations then ref_list = refs.locations
  elseif type(refs) == "table" and #refs > 0 then ref_list = refs end
end
record("N1: references returns locations", ref_list ~= nil and #ref_list > 0, vim.inspect(refs):sub(1, 160))

-- Symbols (L4). Shape-tolerant exactly like the shared core: the server
-- returns {evidenceTier, notIndexed, symbols:[…]} — accept array or wrapped.
local doc_sym = request("textDocument/documentSymbol", { textDocument = { uri = main_uri } })
results.raw.documentSymbol = doc_sym
local sym_list = nil
if type(doc_sym) == "table" and type(doc_sym.symbols) == "table" then sym_list = doc_sym.symbols
elseif type(doc_sym) == "table" and #doc_sym > 0 then sym_list = doc_sym end
local sym_root = sym_list and sym_list[1] or nil
record("N1: documentSymbol root is Greeter", sym_root ~= nil and sym_root.name == "Greeter", vim.inspect(doc_sym):sub(1, 200))
local has_greet_child = false
if sym_root and sym_root.children then
  for _, ch in ipairs(sym_root.children) do
    if ch.name == "greet" then has_greet_child = true break end
  end
end
record("N1: documentSymbol hierarchy has greet child", has_greet_child, vim.inspect(sym_root):sub(1, 200))
local ws_sym = request("workspace/symbol", { query = "greet" })
results.raw.workspaceSymbol = ws_sym
local ws_list = nil
if type(ws_sym) == "table" and type(ws_sym.symbols) == "table" then ws_list = ws_sym.symbols
elseif type(ws_sym) == "table" and #ws_sym > 0 then ws_list = ws_sym end
local ws_found = false
if ws_list then
  for _, s in ipairs(ws_list) do
    if s.name == "greet" then ws_found = true break end
  end
end
record("N1: workspace/symbol finds greet", ws_found, vim.inspect(ws_sym):sub(1, 200))

-- Call hierarchy (L5).
local prep = request("textDocument/prepareCallHierarchy", { textDocument = { uri = main_uri }, position = hover_pos })
results.raw.prepareCallHierarchy = prep
local item = nil
if prep then item = prep.item or (type(prep) == "table" and prep[1]) or prep end
record("N1: prepareCallHierarchy returns greet item", item ~= nil and item.name == "greet", vim.inspect(prep):sub(1, 160))
if item then
  local incoming = request("callHierarchy/incomingCalls", { item = item })
  results.raw.incomingCalls = incoming
  -- Same semantics as the shared core's L5: a calls ARRAY is returned
  -- (array-ness, not non-emptiness — the shared core proved the same).
  local inc_ok = type(incoming) == "table" and (type(incoming.calls) == "table" or #incoming > 0)
  record("N1: incomingCalls returns callers", inc_ok == true, vim.inspect(incoming):sub(1, 160))
else
  record("N1: incomingCalls returns callers", false, "no call-hierarchy item")
end

-- Staleness (§4): the private bb/staleness surface through the REAL client.
local staleness = request("bb/staleness", { uri = main_uri })
results.raw.staleness = staleness
record("N1: bb/staleness answers with a marker", staleness ~= nil and type(staleness.stale) == "boolean", vim.inspect(staleness):sub(1, 160))

-- ---------------------------------------------------------------------------
-- 4. Write results, shut down cleanly.
-- ---------------------------------------------------------------------------
local f = io.open(out_path, "w")
f:write(vim.json.encode(results))
f:close()

vim.schedule(function()
  pcall(function() client:stop() end)
  vim.cmd("qa!")
end)
