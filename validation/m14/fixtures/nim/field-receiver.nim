# NIM field-receiver fixture — the PREMISES of the B1 ambiguity ceiling.
#
# WHY THIS FILE EXISTS. `field-type-ceiling.mts` measures that a per-file field-type
# rule could recover 42 of 8,175 ambiguous edges (0.51%), and the lane decided on that
# number NOT to build the rule. A decision resting on a measurement is only as durable
# as the measurement, and this measurement reads two things off the published
# ParseResult that no other fixture pins:
#
#   1. a member-access edge carries its RECEIVER — `meta.fieldAccessExpression` —
#      and a UFCS call edge carries `meta.callExpression`. Without these keys the
#      ceiling reads 0, and "we measured the fix and it was worth 42 edges" silently
#      becomes "the fix looked worthless" for a reason that has nothing to do with Nim.
#   2. the SOURCE callable publishes its parameters WITH TYPES — `c: Character`.
#      Without the type, a receiver cannot be resolved to a qualifier at all, and the
#      ceiling falls to 0 by a mechanism nobody would notice.
#
# So this fixture pins the inputs, not the fix. It asserts no new edge type and no new
# name surface; if it ever needed to, the ceiling decision would have to be reopened.
#
# The construct is the corpus case the ceiling names, reproduced so both premises and
# the collision are in one file: `id` is a field of BOTH `Character` and `Starship`,
# which is what makes the bare target `id` ambiguous within its own file, and
# `charToResp` reaches the `Character` one through a parameter declared `c: Character`.

type
  Character = ref object
    id: string
    name: string

  Starship = ref object
    id: string
    name: string

proc charToResp(c: Character): string =
  ## The read the ceiling rule would retarget: `c.id` currently emits `uses -> id`.
  ## Nim resolves it to `Character.id` and the file says so, twice — the receiver is
  ## spelled `c.id` and `c` is declared `c: Character` in this very parameter list.
  result = c.id

proc shipToResp(s: Starship): string =
  ## The same leaf name, the OTHER declaration. An edge naming bare `id` from here is
  ## ambiguous with the line above for exactly this reason, and this proc is what makes
  ## the name collision real rather than hypothetical.
  result = s.id

proc charName(c: Character): string =
  ## A second member on the same receiver, so the rule is not pinned on one field name.
  result = c.name
