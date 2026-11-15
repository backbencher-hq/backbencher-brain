-- M60 LUA-48 and LUA-49 — bindings and non-bindings.
--
-- Authored from the two role contracts, not copied from a run. Every shape below
-- exists because the corpus contains it; the line comments name the corpus file.
-- What makes the fixture non-vacuous is the FORBID half: an implementation that
-- published a `contains` for every assignment target, or an `extends` for every
-- `setmetatable` call, satisfies every positive row here and fails every forbid row.

local M = {}

-- LUA-48a: `setmetatable(M, mt)` where `mt` is a DIFFERENT declared table. This is
-- the relation, and it must be published.
local Base = {}
local Derived = {}
setmetatable(Derived, Base)

-- LUA-48b: `setmetatable(M, M)` sets M's metatable to ITSELF. Corpus:
-- `return setmetatable(M, M)` at lazy.nvim/lua/lazy/state.lua:45 and
-- `local ret = setmetatable(M, M)` at trouble.nvim/lua/trouble/cache.lua:59. A table
-- is not its own base, so this must publish NOTHING. Corpus: `contains`-style
-- self-inheritance at 2 sites, both at confidence 1.0.
setmetatable(M, M)

-- LUA-49a: a generic-for clause BINDS its names. The re-assignment inside the body
-- declares nothing. Corpus: `line = line:match("(.-)%%") or line` inside
-- `for _, line in ipairs(...)` at snacks.nvim/lua/snacks/image/doc.lua:131.
function M.scrub(lines)
  for _, line in ipairs(lines) do
    line = line:match("(.-)%%") or line
    print(line)
  end
  -- LUA-49b: a NUMERIC for binds its name the same way. Corpus:
  -- `i = i + 1` inside `for i = 1, 3` — same defect class.
  for i = 1, 3 do
    i = i + 1
    print(i)
  end
  -- LUA-49c: `for k, v in pairs(t)` binds TWO names.
  for k, v in pairs(M) do
    k = k
    v = tostring(v)
  end
  -- LUA-49d: AFTER the loop the binding is over, so this assignment IS a fresh
  -- declaration and MUST be published. This row is what makes the fixture able to
  -- fail a fix that over-suppresses: `for i = 1, 3 do i = i + 1 end` and this line
  -- differ only in the loop having closed, and a rule that remembered the name
  -- forever would drop the edge below while satisfying every forbid row above.
  local after = 1
  print(after)
  return after
end

-- LUA-49e: the same rule at FILE SCOPE, where the `frame.callable` guard does not
-- apply. Corpus: `_, v = next(v)` inside a file-scope `for _, v in ipairs(...)` at
-- kong/kong/db/schema/entities/clustering_data_planes.lua:7, and
-- `l = l:sub(2)` inside a file-scope `for l in p:iter()` at
-- plenary.nvim/lua/plenary/scandir.lua:22. Seven fabricated `contains` edges over
-- the 4-repo oracle draw, all of this shape.
for _, v in ipairs(M) do
  v = tostring(v)
end

-- LUA-49f: and after a file-scope loop the name is free again.
v = nil

return M