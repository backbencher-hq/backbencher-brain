-- M60 LUA-44 — `overrides`, in the two shapes Lua actually writes.
--
-- Shape 1, `lua_redefinition`: the same name declared twice in one chunk. Lua
--   resolves chunk-level names last-wins, so the later `function` replaces the
--   earlier one. `greet` is declared at L56 and again at L60 — two
--   `function_declaration`s, which is the shape probe B1 counts.
--
--   NOT `local greet = function() end` followed by `function greet() end`: the
--   first binds an anonymous `function_definition` to a LOCAL, and a
--   `function_definition` carries no name field, so the two are not two
--   declarations of one label and no override edge is claimed for them.
--
-- Shape 2, `lua_inherited_member`: a member `Derived` declares that it also
--   inherits from `Base` through a named metatable. `Base.run` is declared at
--   L31, `Derived.run` at L38, and `setmetatable(Derived, mt)` at L50 closes
--   the link — so `Derived.run` overrides `Base.run`.
--
-- Both shapes are asserted, and the forbid rows are the two ways a wrong
-- implementation shows up: publishing `Derived -> Base` for a member that is NOT
-- shared (shape 2 must intersect the member sets, not just the tables), and
-- publishing an override where only an `extends` link exists.
--
-- Shape 1's TARGET is asserted in both forms, because the two must be joinable:
-- `Derived -> run` at L42 uses the MEMBER's own name so it pairs with the
-- `contains` edge `Derived -> run` for the same declaration, and the dotted
-- `Derived -> Derived.run` is FORBIDDEN — that is the qualified path doing the
-- name's job, which is what LUA-15's member-identity fixture forbids for symbols
-- and what would stop a consumer joining the two edge types on (source, target).
local Base = {}

function Base.run(x)
  return x
end

local Derived = {}
local mt = { __index = Base }

function Derived.run(x)
  return x * 2
end

function Derived.run(x)
  return x * 3
end

function Derived.stop()
  return nil
end

setmetatable(Derived, mt)

local function early()
  return 1
end

function greet()
  return 2
end

function greet()
  return 3
end

return { Derived = Derived, greet = greet }
