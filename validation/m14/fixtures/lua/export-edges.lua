-- M60 LUA-42 / LUA-43 — the module SURFACE as an edge, and the evidence tier on
-- every edge. `exports` was measured at 0 edges over 3,250 corpus files while the
-- same method already published 5,167 export NAMES into `result.exports`: the
-- surface existed, was named, and no edge said so, so `bb_graph` could not answer
-- "what does this module export" from the graph at all.
--
-- The shapes here are the four the analyzer can NAME. The two it cannot are on
-- separate lines below and are the point of the fixture: a surface with no written
-- name must stay silent rather than be invented from a filename.
local M = {}

-- M60 LUA-47 (wave 2): a genuine BARE-NAME read, added because the wave-2 fix
-- removed the fixture's only `uses` edge and left `expectEvidenceClasses` with
-- no site to assert the `uses` tier on. The runner refuses a vacuous tier
-- assertion rather than skipping it, which is the correct refusal and the
-- reason this line exists rather than a deletion of the `uses` expectation.
--
-- `shared` and `offset` are read as VALUES and are not members, not callees and
-- not declarations, so they are `uses` under the role contract — the one shape
-- that is unambiguously a bare read. Before LUA-47 this line was `M.greet` and
-- `M.farewell` inside the return, which are FIELDS; they are `exports`, and
-- publishing them again as `uses` is the double publication LUA-47 removed.
local shared = "greeting"
local offset = 1

function M.greet()
  return shared .. tostring(offset)
end

function M.farewell()
  return "bye"
end

-- `return "literal"` below: a value, not a name. No `exports` edge, and no
-- `global -[exports]-> literal`.
if false then
  return "literal"
end

return {
  greet = M.greet,
  farewell = M.farewell,
}
