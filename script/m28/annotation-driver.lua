-- script/m28/annotation-driver.lua — M28.A2 in-editor leg (issue #627).
--
-- Runs INSIDE headless Neovim. Attaches bb_lsp to the fixture workspace and
-- asserts that AGENT ANNOTATIONS SURFACE IN THE EDITOR, author-labeled:
--   1. the hover for the annotated symbol renders the annotation section
--      with the enforced author label (an agent note never reads as fact)
--   2. an unannotated symbol's hover renders NO annotation section
--      (declared absence — nothing fabricated)
--   3. bb/graph carries the root's annotations with author_class provenance
-- Writes results as JSON to the path in BB28_OUT. Exit 0 = session completed
-- (assertions are judged by the outer verifier).

local uv = vim.uv or vim.loop
local out_path = vim.env.BB28_OUT
assert(out_path, "BB28_OUT env var required")

local ws = vim.env.BB28_WS
assert(ws, "BB28_WS env var required")
ws = vim.fs.normalize(ws)

local results = { assertions = {}, session = {}, raw = {} }
local function record(name, ok, detail)
  table.insert(results.assertions, { name = name, ok = ok == true, detail = tostring(detail or "") })
end

-- Launch the REAL server through the dist entry (the N1 adapter's declared
-- order, dist mode): one server, one index, the editor is just a door.
local bb_lsp_root = vim.env.BB_LSP_ROOT
local entry = bb_lsp_root .. "/dist/lsp/server.js"
local f = io.open(entry, "r")
if not f then
  record("A2: dist server exists", false, entry)
  local fh = io.open(out_path, "w")
  fh:write(vim.json.encode(results))
  fh:close()
  vim.cmd("cquit 2")
  return
end
f:close()

local client_id = vim.lsp.start({
  name = "bb_lsp",
  cmd = { "node", entry, "--dir", ws },
  root_dir = ws,
  capabilities = vim.lsp.protocol.make_client_capabilities(),
})
record("A2: vim.lsp.start launched bb_lsp", client_id ~= nil and client_id > 0, tostring(client_id))

local deadline = uv.now() + 30000
while uv.now() < deadline do
  local c = vim.lsp.get_client_by_id(client_id)
  if c and c.initialized then break end
  vim.wait(100)
end
local client = vim.lsp.get_client_by_id(client_id)
record("A2: client initialized", client ~= nil and client.initialized == true, tostring(client))
if not client then
  local fh = io.open(out_path, "w")
  fh:write(vim.json.encode(results))
  fh:close()
  vim.cmd("cquit 3")
  return
end

local bufnr = vim.fn.bufadd(ws .. "/main.ts")
vim.fn.bufload(bufnr)
vim.api.nvim_set_current_buf(bufnr)
vim.bo[bufnr].filetype = "typescript"
local main_uri = vim.uri_from_fname(ws .. "/main.ts")

local function request(method, params)
  local ok, res = pcall(function()
    return client:request_sync(method, params, 20000, bufnr)
  end)
  if not ok then return { _err = tostring(res) } end
  if res and res.err then return { _err = vim.inspect(res.err) } end
  return res and res.result or nil
end

-- Position inside greet() — the annotated symbol (0-based line 1, char 2).
local greet_pos = { line = 1, character = 2 }

-- 1. Hover on the ANNOTATED symbol renders the annotation section.
local hover = request("textDocument/hover", { textDocument = { uri = main_uri }, position = greet_pos })
results.raw.hover = hover
local hover_text = ""
if hover and hover.contents then
  if type(hover.contents) == "string" then hover_text = hover.contents
  elseif hover.contents.value then hover_text = hover.contents.value end
end
record("A2: hover renders the annotation section", hover_text:find("notes", 1, true) ~= nil, hover_text:sub(1, 200))
record("A2: annotation carries the enforced agent author label", hover_text:find("agent note by", 1, true) ~= nil, hover_text:sub(1, 240))
record("A2: annotation body text renders verbatim", hover_text:find("legacy shim", 1, true) ~= nil, hover_text:sub(1, 240))
record("A2: annotation provenance is labeled, not index-derived", hover_text:find("provenance recorded", 1, true) ~= nil, hover_text:sub(1, 240))

-- 2. Hover on the UNANNOTATED symbol renders NO annotation section.
-- main() sits at 0-based line 7 (function main()); char 2 is inside it.
local main_hover = request("textDocument/hover", { textDocument = { uri = main_uri }, position = { line = 7, character = 2 } })
results.raw.main_hover = main_hover
local main_text = ""
if main_hover and main_hover.contents then
  if type(main_hover.contents) == "string" then main_text = main_hover.contents
  elseif main_hover.contents.value then main_text = main_hover.contents.value end
end
record("A2: unannotated symbol hover works", main_hover ~= nil and main_text:find("main", 1, true) ~= nil, main_text:sub(1, 120))
record("A2: unannotated symbol renders NO annotation section (declared absence)", main_text:find("notes", 1, true) == nil, main_text:sub(1, 200))

-- 3. bb/graph carries the root's annotations with provenance.
local graph = request("workspace/executeCommand", { command = "__unused__" })
results.raw.graph_error_probe = graph ~= nil or false -- executeCommand may not exist; bb/graph goes via custom request
local ok_graph, graph_res = pcall(function()
  return client:request_sync("bb/graph", { schemaVersion = 2, symbol = "Greeter" }, 20000, bufnr)
end)
local graph_result = nil
if ok_graph and graph_res and not graph_res.err then graph_result = graph_res.result end
results.raw.graph = graph_result
if graph_result then
  local anns = graph_result.annotations or {}
  record("A2: bb/graph carries annotations for the root", #anns >= 1, vim.inspect(anns):sub(1, 200))
  local labeled = false
  for _, a in ipairs(anns) do
    if a.author_class == "agent" and a.tool_identity ~= nil and a.tool_identity ~= "" then labeled = true end
  end
  record("A2: bb/graph annotations are author-labeled with tool identity", labeled, vim.inspect(anns):sub(1, 200))
else
  record("A2: bb/graph request answered", false, ok_graph and vim.inspect(graph_res) or "pcall failed")
end

local fh = io.open(out_path, "w")
fh:write(vim.json.encode(results))
fh:close()
vim.cmd("qa!")
