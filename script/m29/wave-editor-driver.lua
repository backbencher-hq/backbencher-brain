-- script/m29/wave-editor-driver.lua — M29.R2 S6 in-editor leg (issue #537).
--
-- Runs INSIDE headless Neovim. Attaches bb_lsp to a wave fixture workspace
-- for the language named in BB29_LANG, drives the REAL LSP client
-- (vim.lsp.start) through the wave expectations (BB29_EXPECT JSON path), and
-- writes per-check results to BB29_OUT. This is the M27.N1 pattern made
-- language-generic: the expectations come from the wave pack, not from
-- hardcoded fixture positions.

local uv = vim.uv or vim.loop
local out_path = vim.env.BB29_OUT
local lang = vim.env.BB29_LANG
local ws = vim.env.BB29_WS
local expect_path = vim.env.BB29_EXPECT
local bb_root = vim.env.BB29_ROOT

assert(out_path, "BB29_OUT env var required")
assert(lang, "BB29_LANG env var required")
assert(ws, "BB29_WS env var required")
assert(expect_path, "BB29_EXPECT env var required")
assert(bb_root, "BB29_ROOT env var required")

local expect_raw = assert(io.open(expect_path, "r"))
local expect = vim.json.decode(expect_raw:read("*a"))
expect_raw:close()

local results = { language = lang, session = {}, raw = {}, checks = {} }
local function record(name, ok, detail)
  table.insert(results.checks, { name = name, ok = ok == true, detail = tostring(detail or ""):sub(1, 220) })
end

local function file_exists(p)
  return p ~= nil and vim.fn.filereadable(p) == 1
end

-- Launch order mirrors the shippable adapter: explicit path -> bb root dist ->
-- workspace dist; source fallback via bun. The bb root dist is what a wave
-- run uses (the repo's own compiled server).
local launch = nil
local candidates = {
  { cmd = { "node", bb_root .. "/dist/lsp/server.js", "--dir", ws } },
  { cmd = { "bun", "run", bb_root .. "/src/lsp/server.ts", "--dir", ws } },
}
for _, c in ipairs(candidates) do
  if file_exists(c.cmd[2]) then launch = c break end
end
record("S6: launch order resolves a server", launch ~= nil, launch and launch.cmd[2] or "no candidate")
if not launch then
  local f = io.open(out_path, "w")
  f:write(vim.json.encode(results))
  f:close()
  vim.cmd("cquit 2")
end

local client_id = vim.lsp.start({
  name = "bb_lsp",
  cmd = launch.cmd,
  root_dir = ws,
  capabilities = vim.lsp.protocol.make_client_capabilities(),
})
record("S6: vim.lsp.start launched bb_lsp", client_id ~= nil and client_id > 0, tostring(client_id))

local deadline = uv.now() + 30000
while uv.now() < deadline do
  local c = vim.lsp.get_client_by_id(client_id)
  if c and c.initialized then break end
  vim.wait(100)
end
local client = vim.lsp.get_client_by_id(client_id)
-- detail must be a REPRODUCIBLE fact: `tostring(client)` is a raw Lua table
-- address (table: 0x...) that differs every run, and this file is a hashed
-- input of the R4 precision ledger, so an address here made that ledger's
-- byte-identical drift gate un-passable after any re-run. Record the declared
-- identity instead (id + the initialized flag the check asserts).
record("S6: client initialized", client ~= nil and client.initialized == true, "client_id=" .. tostring(client_id) .. " initialized=" .. tostring(client ~= nil and client.initialized == true))
if not client then
  local f = io.open(out_path, "w")
  f:write(vim.json.encode(results))
  f:close()
  vim.cmd("cquit 3")
end

local caps = client.server_capabilities or {}
record("S6: capabilities advertised", caps.hoverProvider == true and caps.definitionProvider == true and caps.documentSymbolProvider == true, vim.inspect({ h = caps.hoverProvider, d = caps.definitionProvider, s = caps.documentSymbolProvider }))

local ext = expect.ext
local main_file = ws .. "/main." .. ext
local bufnr = vim.fn.bufadd(main_file)
vim.fn.bufload(bufnr)
vim.api.nvim_set_current_buf(bufnr)
vim.bo[bufnr].filetype = expect.editorFiletype or lang

local main_uri = vim.uri_from_fname(main_file)
local hover_pos = { line = expect.hoverLine, character = expect.hoverCharacter or 0 }

local function request(method, params)
  local ok, res = pcall(function()
    return client:request_sync(method, params, 20000, bufnr)
  end)
  if not ok then return { _err = tostring(res) } end
  if res and res.err then return { _err = vim.inspect(res.err) } end
  local r = res and res.result
  if r == vim.NIL then return nil end
  if type(r) ~= "table" then return r end
  -- Deep-normalize: replace every vim.NIL value with nil so no later
  -- indexing can ever hit the truthy-NIL trap (M27.N1 lesson, total form).
  local function deep(x)
    if x == vim.NIL then return nil end
    if type(x) ~= "table" then return x end
    local out = {}
    for k, v in pairs(x) do
      out[k] = deep(v)
    end
    return out
  end
  return deep(r)
end



-- Hover (L2): symbol named, evidence tier present, honest absence elsewhere.
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
local sym = expect.hover.symbol
record("S6: hover renders the symbol", hover ~= nil and hover_text:find(sym, 1, true) ~= nil, hover_text:sub(1, 120))
record("S6: hover carries evidence tier (contract §2)", (hover and hover.data and hover.data.tier ~= nil) or hover_text:find("evidence:", 1, true) ~= nil, hover_text:sub(1, 120))

-- Definition (L3).
local def = request("textDocument/definition", { textDocument = { uri = main_uri }, position = hover_pos })
results.raw.definition = def
local def_line = nil
if type(def) == "table" then
  if def.location and def.location.line then def_line = def.location.line
  elseif def.line then def_line = def.line
  elseif type(def[1]) == "table" and def[1].range then def_line = def[1].range.start.line
  elseif def.range then def_line = def.range.start.line
  end
end
record("S6: definition resolves", def_line ~= nil, vim.inspect(def):sub(1, 160))

-- References (L3).
local refs = request("textDocument/references", { textDocument = { uri = main_uri }, position = hover_pos, context = { includeDeclaration = true } })
results.raw.references = refs
local ref_list = nil
if type(refs) == "table" and refs.locations then ref_list = refs.locations
elseif type(refs) == "table" and #refs > 0 then ref_list = refs end
record("S6: references returns locations", ref_list ~= nil and #ref_list >= (expect.references.minCount or 1), ref_list and tostring(#ref_list) or "none")

-- Symbols (L4): class present, declared absence for a bogus symbol.
local doc_sym = request("textDocument/documentSymbol", { textDocument = { uri = main_uri } })
results.raw.documentSymbol = doc_sym
local sym_list = nil
if type(doc_sym) == "table" and type(doc_sym.symbols) == "table" then sym_list = doc_sym.symbols
elseif type(doc_sym) == "table" and #doc_sym > 0 then sym_list = doc_sym end
local want_class = expect.documentSymbols[1]
local found_class = false
if sym_list then
  for _, s in ipairs(sym_list) do
    if s.name == want_class then found_class = true end
  end
end
record("S6: documentSymbols include the class", found_class, vim.inspect(sym_list and vim.tbl_map(function(s) return s.name end, sym_list) or {}):sub(1, 160))

local ws_sym = request("workspace/symbol", { query = expect.declaredAbsence.symbol })
results.raw.workspaceAbsence = ws_sym
local ws_absent = true
if type(ws_sym) == "table" and #ws_sym > 0 then ws_absent = false
elseif type(ws_sym) == "table" and type(ws_sym.symbols) == "table" and #ws_sym.symbols > 0 then ws_absent = false end
record("S6: declared absence is honored (no fabricated symbols)", ws_absent, vim.inspect(ws_sym):sub(1, 120))

local f = io.open(out_path, "w")
f:write(vim.json.encode(results))
f:close()
vim.cmd("qa!")
