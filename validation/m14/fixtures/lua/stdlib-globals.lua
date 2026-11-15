-- M60 LUA-57 — the Lua 5.4 BASIC-LIBRARY GLOBALS (reference manual §6.1, "Basic
-- Functions") as a markable class, and the five shapes that look identical but are not.
--
-- THE RULE, in one line: mark `external` when a `calls` or a `uses` edge's TARGET is a
-- bare identifier naming one of the twenty-six documented basic-library globals
-- (`LUA54_GLOBALS`), and this file declares no symbol under that name at or before the
-- edge's line.
--
-- WHY THE BARE SPELLING IS THE STANDARD LIBRARY HERE, WHEN IT IS NOT FOR FIELDS. A
-- member read publishes its final segment (LUA-13), so `table.insert(x)` and a bare
-- `insert(x)` both arrive as target `insert` — and Lua 5.4 publishes no global of that
-- name, which is exactly why the FIELD-name list was measured and rejected. `_G.tostring`
-- IS the documented function, so a bare `tostring` resolves through `_ENV` to it unless
-- this file binds the name. Case I is that guard in the withholding direction and case
-- D1 is it in the marking direction; they are one rule read at two lines.
--
-- Every case uses a DIFFERENT global name: `addRelationship` dedupes on
-- (type, source, target) without the line, so two cases sharing a name would leave the
-- second unpublished and its row would pass for the wrong reason.

-- A  POSITIVE, `calls`. A bare call to a documented basic-library global, with no
--    receiver and no declaration of the name anywhere in this file.
local a = tostring(1)

-- B  POSITIVE, `calls`, a different name — so the rule is a property of the LIST rather
--    than of one name's spelling.
local b = ipairs({})

-- C  POSITIVE, `uses`. A bare READ of a global as a value, never called. The claim is
--    the same one: the name read is the library's, not this file's.
local c = tonumber

-- D1 POSITIVE, and the language's own rule. This file declares `select` on line 66,
--    AFTER this call: a Lua local is visible from its declaration line and is not
--    hoisted, so line 36 still names the standard library.
local d = select(1, 2)

-- E  NOT EXTERNAL — a bare call whose name is NOT a 5.4 basic-library global. `sub` is a
--    standard FIELD (`string.sub`) and Lua 5.4 publishes no global of that name, so a
--    bare `sub(2)` is an undefined global. The same case the sibling fixture's row F
--    makes; repeated here because this list is the one it tests.
local e = sub(2)

-- F  NOT EXTERNAL — `unpack` was a 5.1 basic function and is `table.unpack` in 5.4. A
--    list transcribed from an older manual, or one widened to "any standard name",
--    would claim this row.
local f = unpack({ 1 })

-- G  NOT EXTERNAL — a MEMBER call. `mine.error` is a field of this file's own table; the
--    target has the same spelling as a global and the name-bearing node is the same node
--    type, and only the SHAPE separates them.
local mine = {}
local g = mine.error("x")

-- H  NOT EXTERNAL — a method whose receiver is not an identifier. `next` IS a documented
--    global, so this row rejects a text-only test as surely as G does: the target is
--    spelled `next` and the name-bearing node is the `method` field.
local h = ("x"):next()

-- I  NOT EXTERNAL — the GUARD, withholding. `warn` is declared on line 62, the line above
--    this call, so this file binds the name and the call is not the library's.
local warn = function() end
local i = warn("shadowed")

-- The declaration that arms D1's positive. It is AFTER the read on purpose.
local select = nil
