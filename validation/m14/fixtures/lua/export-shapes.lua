-- fixture: lua/export-shapes
-- M60 LUA-09 — the shapes a Lua module can publish its surface through.
--
-- Only `return <ident>` was ever handled. Every other shape below published
-- NOTHING, and by a grammar-based census of the two pinned corpora
-- (script/m60/lua-export-census.ts, off the wired wasm, not a regex) that was 366
-- of Kong's 1,309 files and 33 of Luvit's 199, carrying 1,377 nameable exports —
-- the single largest remaining source of missing exports.
--
-- The rule this file pins, in one line: a return reachable WITHOUT ENTERING A
-- FUNCTION is a possible module surface, and the module publishes the union of
-- what every such return can name. The boundary is the FUNCTION, not the block
-- structure — which is why the return inside the loop counts, and the one inside
-- the function below does not.
--
-- The negatives are in the same file on purpose: a fixture that only asserts
-- what should appear cannot catch fabrication, and fabrication is the failure
-- that matters most here.

-- NEGATIVE: inside a function, so not a module export (LUA-20).
local function handler()
  return { hidden = 1 }
end

-- NEGATIVE: a positional-only literal names nothing. Publishing "1"/"2"/"3"
-- would invent three names no source text supports. Not reached as a return, so
-- this line only pins that it is a table, not a surface.
local positional = { 1, 2, 3 }

-- POSITIVE: a file-scope `do` block. The wired grammar builds this as
-- `chunk > do_statement > block > …`, two levels below chunk, which is why the
-- first version of the census missed it and called a correct analyzer export
-- spurious.
do
  if cond then
    return { fromDoBlock = true }
  end
end

-- POSITIVE: a loop body's return also exits the chunk, so it is part of the
-- possible surface — the same union rule as the if/else above.
for _, v in ipairs(list) do
  return { fromLoop = v }
end

-- POSITIVE: the dominant real-world shape, and the last statement, so this is
-- the module's primary return.
return {
  alpha = 1,
  beta = 2,
  -- a string key is a name too, and is published UNQUOTED
  ["gamma"] = 3,
  -- a positional entry has no name and must publish nothing: naming it would
  -- mean inventing "4"
  4,
  -- one level only. `nested` is the export; `deep` is a member of nested, and
  -- flattening it would invent a top-level export.
  nested = { deep = 5 },
  handler = handler,
  positional = positional,
}
