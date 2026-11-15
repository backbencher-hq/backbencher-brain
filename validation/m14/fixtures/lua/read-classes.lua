-- M60 LUA-46 / LUA-47 — every read CLASS, and the boundary between them.
--
-- Two defects this file exists to pin, both found in wave 2 by measuring the
-- corpus rather than by reading the analyzer, and both of the shape the
-- workstream calls a double publication or a fabricated edge.
--
-- LUA-46 — a WRITE was published as a READ. `emitMemberRead` excluded an
-- assignment target with `pt === "assignment_statement" && isSameNode(parent.namedChild(0), node)`,
-- but the wired grammar puts every target inside a `variable_list`, so the
-- target's PARENT is `variable_list` and the test could never match. Measured
-- over 3,252 corpus files: 14,833 qualified assignment targets each published a
-- `references` edge for a member that was written and never read.
--
-- LUA-47 — a READ was published TWICE. `emitNameRead` excluded `namedChild(0)` of
-- a `dot_index_expression`, which is the RECEIVER. The FIELD is `namedChild(1)`
-- and reached `uses` as well, while `emitMemberRead` published the same member as
-- `references` and `processCall` published it as `calls`. Measured over 400
-- corpus files: 8,041 member edges carried both a `uses` and a `references` edge
-- for the same member on the same line.
--
-- The previous fixture for this pair, lua/name-reads, was GREEN over both
-- defects. Its forbid rows named `config` and `helper` — both RECEIVERS — and no
-- row for `retries` or `record`, which are both FIELDS. A suite that pins the
-- head of a qualified name and says nothing about its tail is green on a
-- double publication of the tail. Every one of those four cases is a forbid row
-- below, and the lines are numbered so a reader can check them against the file.
--
-- Nothing here is a declaration, a callee, a field key or a module path; each
-- line is one read class and the comments say which class it is.
local bare = "value"
local key = "member"
local tbl = {}
local other = {}

-- L37  a BARE read: `bare` is a name read in a value position and is nothing
--      else. `uses`.
local read_bare = bare

-- L42  a MEMBER read: `tbl.member` names a member of a table. `references`,
--      and NOT `uses` — the member belongs to the qualified access, which is
--      already published under the label that names the access.
local read_member = tbl.member

-- L47  a CHAINED member read: `tbl.inner.member` is two nested index
--      expressions, so there are two members and each is `references` exactly
--      once. `inner` is the table of the outer read, not a bare name.
local read_chain = tbl.inner.member

-- L52  a CALLEE member: `tbl:callee()` is a `calls` edge and nothing else. Not
--      `references` (it is called, not merely read) and not `uses` (the member
--      is named by the access).
local read_callee = tbl:callee()

-- L55  a CALLEE member written with a dot: the same rule, the other spelling.
tbl.plain()

-- L60  a LITERAL subscript: `tbl["literal"]` writes the member's name as a
--      string, so it is a `references` edge and there is no identifier to
--      double-publish.
local read_literal = tbl["literal"]

-- L67  a VARIABLE-HELD subscript: `tbl[key]` READS `key`. The subscript is a
--      variable, so reading it is a genuine bare-name read and stays `uses`,
--      while the member itself has no written name and so is not `references`.
--      This asymmetry is deliberate and is the reason the two index forms are
--      separate branches rather than one.
local read_subscript = tbl[key]

-- L71  a WRITE to a member: `tbl.member = 1` names no read of `member`. Under
--      LUA-46 this published `references -> member`. It must publish nothing.
tbl.member = 1

-- L75  a WRITE to a member through a chain: `tbl.inner.member = 1` writes two
--      members and reads neither.
tbl.inner.member = 1

-- L80  a MULTI-TARGET write: `other.a, other.b = 1, 2` writes two members and
--      reads neither, which is the shape the dead `assignment_statement`
--      exclusion was written for.
other.a, other.b = 1, 2

-- L84  a READ on the right-hand side of a write to the same member. The read is
--      `references`; the write on L42 adds nothing.
tbl.member = tbl.other

-- L87  a declaration's target list binds two names and reads neither.
local first, second = 1, 2

return {
  read_bare = read_bare,
  read_member = read_member,
  read_chain = read_chain,
  read_callee = read_callee,
  read_literal = read_literal,
  read_subscript = read_subscript,
  first = first,
  second = second,
}