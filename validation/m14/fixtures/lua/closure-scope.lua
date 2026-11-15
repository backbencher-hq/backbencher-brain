-- fixture: lua/closure-scope
-- M60 LUA-19, LUA-20, LUA-21 — three scope rules, one file, because they are the
-- same question asked at three depths: what scope does this declaration belong
-- to, and what can see it.
--
-- LUA-19: a function nested inside another is LEXICALLY LOCAL to it whether or
-- not it carries the `local` keyword. The analyzer tested for the keyword, so
-- `function nested()` inside `outer` was filed with scope "global" and a
-- `contains global -> nested` edge. 47 such edges on luvit alone.
--
-- LUA-20: an ANONYMOUS function establishes a scope too. The walk created a
-- frame only for `function_declaration`, so a closure shared its enclosing frame
-- and its internal `return` was published as the FILE's export — measured:
-- a top-level closure's `return` arrived as the module's public API.
--
-- LUA-21: a closure SEES the enclosing scope's locals, which is what a closure
-- is. The frame held only the closure's own parameters, so an assignment to an
-- UPVALUE looked like a new declaration and emitted a containment edge naming a
-- symbol that does not exist.
local function outer()
  local captured = 1
  local function inner()
    return captured
  end
  return inner
end

local handler = function(payload)
  local copy = payload
  return copy
end

return outer, handler
