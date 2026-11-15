-- fixture: lua/order-independent-ctor
-- M60 LUA-06. A relationship must not depend on where its declaration sits in
-- the file. `declaredTables` was filled during the same traversal that read it,
-- so whether a constructor call produced an edge depended on whether the table's
-- declaration appeared EARLIER. Proven with two files differing only in
-- statement order: declare-then-call produced the edge, call-then-declare
-- produced NOTHING. Same semantics, different graph — so the edge was a fact
-- about the traversal, not about the program.
--
-- Both orders are in this file, and the expectation requires BOTH to produce the
-- edge at their own call's line. A whole-line implementation, or one that
-- restores the order dependence, fails on exactly one of them.
Widget.new()
local Widget = {}
function Widget:new()
  return setmetatable({}, Widget)
end

Gadget.new()
local Gadget = {}
function Gadget:new()
  return setmetatable({}, Gadget)
end
