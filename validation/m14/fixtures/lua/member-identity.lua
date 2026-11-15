-- fixture: lua/member-identity
-- M60 LUA-15. A member's identity is its container plus its OWN name, and the two
-- are recorded once. The analyzer used to file `function Buffer:initialize()` as
-- name "Buffer:initialize" AND ownerName "Buffer" — the container stored twice,
-- once inside the name. M49 W2's ruling is that a member's identity is its
-- container, not its bare name; the old shape satisfied neither reading.
--
-- The user-visible consequence was not cosmetic: a call edge carries the callee's
-- own NAME, so it could never be joined to a declaration filed as
-- "Buffer:initialize". Call-to-declaration resolution failed for every method in
-- the language, silently, with both sides looking well-formed.
--
-- Expectations are authored from the identity contract and from M49 W2, not from
-- the analyzer's output. The forbidden entries are the pre-fix behaviour.
local Buffer = {}
local M = {}

function Buffer:initialize(length)
  self.len = length
end

function Buffer.readUInt8(self)
  return 0
end

function M.new(opts)
  return setmetatable({}, M)
end

function plain(x)
  return x
end
