-- M60 LUA-54 — cause C: which standard-library member reads are external, and
-- which seven look identical but are not.
--
-- WHY THIS FILE IS MOSTLY NEGATIVE
--
-- The mark is a claim that an edge names something outside this file. A wrong
-- claim is worse than no claim: it moves a name out of `unresolved` without
-- moving anything toward truth, and the incoming arbiter's PASS then means less
-- than it did. So the positive rows are the easy half and the forbid rows are the
-- half that can actually catch a regression.
--
-- THE RULE, in one line: mark `external` when the edge's TARGET is the field of a
-- dot/method index whose RECEIVER is an IDENTIFIER naming one of the eight
-- documented Lua 5.4 standard tables, and this file declares no symbol under that
-- receiver at or before the edge's line.
--
-- THE TRAP THIS FILE IS BUILT AROUND: this analyzer publishes the FINAL SEGMENT of
-- a member read (LUA-13), so `table.insert(x)` and a bare `insert(x)` BOTH arrive
-- with target `insert`. Lua 5.4 publishes no global named `insert`. A name-list
-- rule cannot tell them apart and marks both; that rule was measured at 16,195
-- edges against this rule's population. Line 60 is that case, and it is forbidden.
--
-- Every case below uses a DIFFERENT member name on purpose. `addRelationship`
-- dedupes on (type, source, target) without the line (LUA-01b), so two cases
-- sharing a member name would leave the second case unpublished and its forbid row
-- would pass for the wrong reason — which is exactly the "a short page is never
-- mistaken for a complete one" failure in fixture form.
--
-- Nothing here declares a function; every line is a read or a call.
local mine = {}
local shadow = {}

-- A  POSITIVE. `string.format` — the receiver is the identifier `string`, which
--    this file does not declare anywhere at or before this line. `calls`.
local r1 = string.format("%d", 1)

-- B  POSITIVE. `table.concat` — the same rule on a different documented table.
local r2 = table.concat({ "a", "b" }, ",")

-- C  NOT EXTERNAL — a METHOD index whose receiver is a LITERAL. `("abc"):byte(1)`
--    is a `method_index_expression` and its `method` field is the name-bearing
--    node, so it is the shape the rule accepts, but the receiver here is a
--    parenthesized string and not an identifier at all. A rule that matched on the
--    presence of a field node rather than on the receiver would claim this
--    reaches the standard library.
local r3 = ("abc"):byte(1)

-- D  NOT EXTERNAL — the receiver is a file-local table. `mine.insert` is this
--    file's own table, and `insert` is a documented standard field name, so this
--    row rejects the name-list rule as surely as line 60 does.
local r4 = mine.insert("k", "v")

-- E  NOT EXTERNAL — the same, with a receiver whose name shadows nothing at all.
local r5 = shadow.append("k", "v")

-- F  NOT EXTERNAL — A BARE CALL, and the row the whole rule exists for. `sub` is
--    in the documented standard FIELD list because `string.sub` is; but there is
--    no receiver at all, so this is an undefined GLOBAL named `sub`.
local r6 = sub(2)

-- G  NOT EXTERNAL — A BRACKET SUBSCRIPT. `mine["sorted"]` has a string key and no
--    receiver identifier, so there is nothing for the rule to read.
local r7 = mine["sorted"]

-- H  POSITIVE INSIDE A COMPUTED SUBSCRIPT. `mine[io.open(...)]` writes a real
--    standard-library call in the subscript, so THAT edge is a documented read and
--    is marked — the enclosing `uses` on the subscript is not, because the
--    subscript is a computed value and the name it denotes is not in the tree. The
--    distinction is that the mark follows the node, not the statement.
local r8 = mine[io.open("/dev/null")]

-- I  NOT EXTERNAL — A CHAIN. The outer access's receiver is a CALL, not an
--    identifier, so `len` is not a standard field; and the inner `string.format`
--    is not published as an edge of its own, so there is nothing here to mark.
local r9 = string.format("%d", 1):len()

-- K  NOT EXTERNAL — a receiver that is NEITHER a documented table NOR declared
--    anywhere in this file. This is the case that isolates the receiver test from
--    the guard, and it is here because cases D and E turned out NOT to: their
--    receivers are file-local, so the guard alone withholds the mark and the
--    receiver test is never exercised by them. The mutant that drops the
--    receiver-name test survived on the first run of this fixture for exactly that
--    reason. Here there is no declaration to shadow anything, so with only the
--    guard K would be MARKED; only the receiver test excludes it.
local r12 = undeclared_table.count("k")

-- J  NOT EXTERNAL — THE GUARD. This file DECLARES `string` on the next line, so
--    every `string.*` access below reads the file's own table and not the standard
--    library. This is the row that makes A's mark a claim rather than a constant:
--    same receiver name, same field names, opposite answer, decided by a line.
local string = {}
local r10 = string.char(65)
local r11 = string.rep("x", 3)