# F23 — the composition clause's TWO shapes, pinned in BOTH directions.
#
# R writes a class's member-set relation as `contains=`, and the clause has two shapes
# that are different constructs:
#
#   contains = c("A", "B")   a LIST: several member providers, no single base
#   contains = "A"           ONE class: a supertype
#
# The list shape is the fleet's `mixes_in` (compose a member set, no single base); the
# one-class shape is a conformance supertype and stays `extends`. A relabel that widened
# `mixes_in` onto the one-class shape would publish a false edge, and a revert that put
# the list shape back on `extends` would delete a true one — so both are pinned here.

# --- S4: the list shape composes two member providers -------------------------------
setClass("ComposedTwo", contains = c("SlotsA", "SlotsB"))

# --- S4: the ONE-class shape names a supertype (string and identifier spellings) -----
setClass("OneBase", contains = "SlotsA")
setClass("OneBaseIdent", contains = SlotsA)

# --- R5: the same keyword on setRefClass splits the same way ------------------------
# The ASSIGNMENT form is the one the corpus writes and the analyzer reads (`value <-
# setRefClass(...)`); a bare `setRefClass("Name", ...)` statement publishes no class at
# all, which is a separate, reported gap and NOT a reason to loosen this pin.
RefComposed <- setRefClass("RefComposed", contains = c("SlotsA", "SlotsB"))
RefOne <- setRefClass("RefOne", contains = "SlotsA")

# --- R6: inherit= is IS-A conformance, never a composition clause --------------------
R6Base <- R6Class("R6Base", public = list())
R6Child <- R6Class("R6Child", inherit = R6Base, public = list())

# --- S7: parent= is IS-A conformance, never a composition clause ---------------------
S7Child <- S7::new_class("S7Child", parent = R6Base)
