-- fixture: lua/edge-lines
-- M60 LUA-01 + LUA-13 + LUA-22. The line an edge carries is the line its NAME is
-- written on, not the line the enclosing node opens on. Java states the reason
-- (real-java-analyzer.ts:967-971): an invocation starts at its RECEIVER, so
-- `a.b()\n  .c()` puts c on the line a.b() opened on. tree-sitter-lua has the
-- identical hazard, so the rule transfers unchanged.
--
-- LUA-13: a call split across two lines used to publish its multi-line SOURCE
-- TEXT as the target, which the pool-worker's garbage-target filter deletes — so
-- the edge vanished entirely and a line break silently removed a call from the
-- graph. The multi-line call below is the falsifier for any whole-line
-- implementation: it passes every other row and fails this one.
--
-- LUA-22: a COMPUTED index has no name to record. `dao[key](...)` is an
-- expression, and publishing it as a relationship target is a payload
-- masquerading as a name. It is forbidden below.
local Account = {}
function helper()
  return 1
end

function caller()
  helper()
  local obj = {}
  obj
    .method()
  return obj
end

function dynamic(dao, key)
  return dao[key](dao)
end
