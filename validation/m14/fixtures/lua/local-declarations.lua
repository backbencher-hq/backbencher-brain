-- fixture: lua/local-declarations
-- M60 LUA-00. The analyzer asked for a `name_list` field, which the pinned
-- tree-sitter-lua grammar does not have, and the lookup sat behind a
-- `|| namedChild(0)` fallback. A variable_declaration's first named child is
-- either a variable_list directly (`local solo`) or an assignment_statement
-- whose own first named child is that variable_list (`local a, b = 1, 2`) — so
-- the sloppy lookup and the correct one coincided on every shape in a 1,510-file
-- corpus, and the corpus error metric could not see it. Only a field-set
-- comparison could, which is what script/m60/verify-lua-grasped-fields.ts is for.
--
-- This fixture pins the OBSERVABLE consequence, because a source-level fact
-- cannot be pinned by a behavioural fixture: the plainest declarations in the
-- language must be extracted, in every shape the grammar produces.
local solo
local a, b = 1, 2
local t = { key = 1, other = 2 }
local s = "text"
d, e = 4, 5
