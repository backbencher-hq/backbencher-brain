-- script/m29/giant-editor-driver.lua — M29.R3 in-editor leg (issue #538).
--
-- Runs INSIDE headless Neovim against the GIANT corpus workspace (59k files).
-- Attaches bb_lsp, then measures warm p95 per §3 operation with uv.hrtime —
-- the in-editor regime of the contract budgets. Writes measurements JSON to
-- BB29_OUT. This is the wave-editor driver's measurement form: same attach
-- order, N iterations, percentiles computed in-session.

local uv = vim.uv or vim.loop
local out_path = vim.env.BB29_OUT
local ws = vim.env.BB29_WS
local bb_root = vim.env.BB29_ROOT
local target = vim.env.BB29_TARGET_FILE
local hover_line = tonumber(vim.env.BB29_HOVER_LINE)
local hover_char = tonumber(vim.env.BB29_HOVER_CHAR)

assert(out_path and ws and bb_root and target and hover_line and hover_char, "BB29_* env vars required")

local results = { session = {}, measurements = {} }

local function file_exists(p)
  return p ~= nil and vim.fn.filereadable(p) == 1
end

local launch = nil
local candidates = {
  { cmd = { "node", bb_root .. "/dist/lsp/server.js", "--dir", ws } },
  { cmd = { "bun", "run", bb_root .. "/src/lsp/server.ts", "--dir", ws } },
}
for _, c in ipairs(candidates) do
  if file_exists(c.cmd[2]) then launch = c break end
end
if not launch then
  results.session.error = "no server candidate"
  local f = io.open(out_path, "w")
  f:write(vim.json.encode(results))
  f:close()
  vim.cmd("cquit 2")
end
results.session.server = launch.cmd[2]

local client_id = vim.lsp.start({
  name = "bb_lsp",
  cmd = launch.cmd,
  root_dir = ws,
  capabilities = vim.lsp.protocol.make_client_capabilities(),
})

local deadline = uv.now() + 60000
while uv.now() < deadline do
  local c = vim.lsp.get_client_by_id(client_id)
  if c and c.initialized then break end
  vim.wait(100)
end
local client = vim.lsp.get_client_by_id(client_id)
if not client or not client.initialized then
  results.session.error = "client failed to initialize"
  local f = io.open(out_path, "w")
  f:write(vim.json.encode(results))
  f:close()
  vim.cmd("cquit 3")
end

local bufnr = vim.fn.bufadd(target)
vim.fn.bufload(bufnr)
vim.api.nvim_set_current_buf(bufnr)
local main_uri = vim.uri_from_fname(target)
local pos = { line = hover_line, character = hover_char }

local function request(method, params)
  local ok, res = pcall(function()
    return client:request_sync(method, params, 20000, bufnr)
  end)
  if not ok then return nil end
  if res and res.err then return nil end
  return res and res.result or nil
end

-- Warm-up: one request per op before measuring (the warm regime definition).
request("textDocument/hover", { textDocument = { uri = main_uri }, position = pos })
request("textDocument/definition", { textDocument = { uri = main_uri }, position = pos })
request("textDocument/references", { textDocument = { uri = main_uri }, position = pos, context = { includeDeclaration = true } })
request("textDocument/documentSymbol", { textDocument = { uri = main_uri } })
request("workspace/symbol", { query = "Klass0" })

local ITER = 40
local function measure(op, fn)
  local samples = {}
  for _ = 1, ITER do
    local t0 = uv.hrtime()
    fn()
    table.insert(samples, (uv.hrtime() - t0) / 1e6) -- ms
  end
  table.sort(samples)
  local p95 = samples[math.floor(ITER * 0.95)] or samples[ITER]
  local median = samples[math.ceil(ITER * 0.5)]
  table.insert(results.measurements, { op = op, p95WarmMs = p95, medianMs = median, samples = ITER })
end

measure("hover", function()
  request("textDocument/hover", { textDocument = { uri = main_uri }, position = pos })
end)
measure("definition", function()
  request("textDocument/definition", { textDocument = { uri = main_uri }, position = pos })
end)
measure("references", function()
  request("textDocument/references", { textDocument = { uri = main_uri }, position = pos, context = { includeDeclaration = true } })
end)
measure("documentSymbol", function()
  request("textDocument/documentSymbol", { textDocument = { uri = main_uri } })
end)
measure("workspaceSymbol", function()
  request("workspace/symbol", { query = "Klass0" })
end)
measure("prepareCallHierarchy", function()
  request("textDocument/prepareCallHierarchy", { textDocument = { uri = main_uri }, position = pos })
end)

results.session.editor = "headless neovim"
results.session.iterations = ITER
local f = io.open(out_path, "w")
f:write(vim.json.encode(results))
f:close()
vim.cmd("qa!")
