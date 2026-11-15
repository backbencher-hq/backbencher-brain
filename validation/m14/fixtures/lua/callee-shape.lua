-- fixture: lua/callee-shape
-- LUA-56. `callee()` already decided WHICH of the grammar's callee forms this call has,
-- and the fact was thrown away: a `calls` edge published the callee's own name with no
-- record of whether that name was written as a BARE IDENTIFIER (resolved through the
-- file's lexical scope and then `_ENV` — a local, an upvalue, or a runtime global) or as
-- the FIELD of a RECEIVER the edge does not name (`M.member()`, `M:method()`,
-- `M["bracketed"]()` — LUA-13).
--
-- The distinction is the reason no externality marker can be attached to the target
-- alone: for an identifier callee the target is the name the language will look up,
-- while for an indexed callee it is a field of a table whose identity the edge does not
-- carry, so "this name is declared nowhere" says nothing about whether it is external.
--
-- The two rows below are the falsifier for a whole-file implementation: `member`,
-- `method` and `bracketed` are all declared in THIS file, so a rule that keyed on
-- "declared in this file" would call them internal for the wrong reason — and
-- `unknownGlobal` is declared nowhere, which is the case the shape has to separate.
local M = {}

function M.member()
  return 1
end

function M:method()
  return 1
end

function M.bracketed()
  return 1
end

local function helper()
  return 1
end

local fn = function()
  return 1
end

function caller(a)
  helper()
  fn()
  M.member()
  M:method()
  M["bracketed"]()
  unknownGlobal(a)
  return a
end

-- LUA-22's negative arm: a COMPUTED index has no name, so it must produce NO call edge.
-- The field is an identifier here, not a string literal, which is the whole test.
function dynamic(dao, key)
  return dao[key](dao)
end

-- LUA-29's negative arm: a call ON A CALL has no name either. Publishing the payload
-- `require("x")` as a target is the defect class these two rows forbid.
function callOnCall()
  return require("x")()
end
