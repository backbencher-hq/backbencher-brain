-- M60 LUA-40 / LUA-41 — a name READ as a value, and a member read WITHOUT
-- calling it. Authored from the roles the parse tree records, not from the
-- analyzer's output: every `uses` row below is an identifier in a value
-- position, and every `references` row is the field of a qualified read whose
-- receiver is not itself read on its own account.
--
-- The lines that matter are the ones where a name appears but must NOT be
-- published, because those are the exclusions the two rules exist to enforce:
--   L18 `config` is DECLARED        -> contains, never uses
--   L22 `limit` is DECLARED         -> contains, never uses
--   L22 `config.retries`            -> references->retries; `config` is the
--                                      RECEIVER of the qualified name, so it is
--                                      not also a uses
--   L24 `helper.record(...)`        -> calls->record; neither `helper` nor
--                                      `record` is a uses or a references
--   L29 `helper.missing`            -> references->missing; `helper` is a
--                                      receiver here too
local config = { retries = 3 }
local helper = {}

local function apply(name)
  local limit = config.retries
  local total = limit + 1
  helper.record(name, total)
  return total
end

local function never()
  return helper.missing
end

return { apply = apply, never = never }
