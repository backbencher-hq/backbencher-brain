-- M60 LUA-50 and LUA-51: the two `extends` defects this pass found.
--
-- LUA-50 — a FABRICATED edge. `setmetatable(M, M)` makes M its OWN metatable, which
-- is the lazy `__index` idiom and not inheritance. The `extends` reader guarded the
-- metatable node's TYPE but never compared the two argument NAMES, so it published
-- `extends M -> M` for lazy.nvim/lua/lazy/state.lua:45 and
-- trouble.nvim/lua/trouble/cache.lua:59. A self-edge on a type relation is not
-- expressible in Lua at all.
--
-- LUA-51 — a MISSED edge. `local Command = class({...}, {...}, Parser)` states a
-- supertype in the THIRD argument, because the callee declares
-- `class(prototype, properties, parent)`. The `extends` reader read only
-- `setmetatable` and the `class` branch read only the class's own NAME, so both of
-- argparse's inheritance clauses were invisible.
--
-- The position is not guessed. It is read from the callee's own parameter list, which
-- is why each factory below declares which slot carries the supertype.

--------------------------------------------------------------------------------
-- LUA-50, case 1: a self-metatable. M is its own metatable and extends NOTHING.
--------------------------------------------------------------------------------
local SelfMeta = {}
function SelfMeta.__index(_, key)
  return rawget(SelfMeta, key)
end
return setmetatable(SelfMeta, SelfMeta)

--------------------------------------------------------------------------------
-- LUA-51, case 1: the parent is in THIRD position (luarocks' convention).
--------------------------------------------------------------------------------
local function class_third(prototype, properties, parent)
  local cl = {}
  cl.__index = cl
  if parent then
    cl.__prototype = parent.__prototype
  else
    cl.__prototype = prototype
  end
  return cl
end

local Base = class_third({ kind = "base" }, {})
local Middle = class_third({ kind = "middle" }, {}, Base)
local Leaf = class_third({ kind = "leaf" }, {}, Middle)

--------------------------------------------------------------------------------
-- LUA-51, case 2: the parent is in SECOND position (middleclass's own convention).
-- The same rule has to read BOTH, and a fixed index reads exactly one.
--------------------------------------------------------------------------------
local function class_second(name, super)
  local c = { __name = name }
  if super then c.__super = super end
  return c
end

local Alpha = class_second("Alpha", nil)
local Beta = class_second("Beta", Alpha)

--------------------------------------------------------------------------------
-- THE NEGATIVE CASES. Each of these declares a parameter NAMED `parent` and passes a
-- NAME in that slot, and NONE of them is a type relation. A rule keyed on the
-- parameter name alone would publish four fabricated `extends` edges here; this is
-- what the corpus actually contains (snacks.nvim/lua/snacks/layout.lua:186
-- `_each(widget, parent)`, snacks.nvim/lua/snacks/picker/source/lsp/init.lua:379
-- `add(result, parent)`), and it is why the rule also requires the factory RESULT to
-- be bound to a top-level name — `local Command = class(...)` — which none of these is.
--------------------------------------------------------------------------------
local function each(node, parent)
  if node ~= nil then return parent end
  return nil
end

local function add(item, parent)
  return { item = item, parent = parent }
end

local walked = each({ id = 1 }, nil)
local added = add({ id = 2 }, walked)

--------------------------------------------------------------------------------
-- LUA-50, case 2: a direct self-metatable assigned rather than returned.
--------------------------------------------------------------------------------
local SelfMeta2 = {}
SelfMeta2.__index = SelfMeta2
local bound_self = setmetatable(SelfMeta2, SelfMeta2)