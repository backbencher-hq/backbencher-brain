# F24 — R5 reference classes declared as STATEMENTS, not only as assignments.
#
# R5's `setRefClass("Name", ...)` registers the generator under the DECLARED name whether
# or not the call is bound to a variable. r-Rcpp/R/00_classes.R declares `C++Field`,
# `C++OverloadedMethods` and `C++Constructor` as bare statements at file level, and the
# analyzer published NONE of them: the only path that recognised the constructor was the
# assignment-RHS one, so those classes, their fields and their `contains=` edges were all
# invisible.
#
# This file pins BOTH spellings, because a fix that added the statement path without
# excluding the assignment path would publish every assigned R5 class TWICE — which is why
# the counts here are exact (`expectSymbolCount`/`expectRelationshipCount`), not `>= 1`.

# --- statement form at file level (the shape the corpus writes) ----------------------
setRefClass(
  "BareField",
  fields = list(pointer = "externalptr", size = "integer")
)
setRefClass("BareChild", contains = "BareField")
setRefClass("BareComposed", contains = c("SlotProviderA", "SlotProviderB"))

# --- qualified statement form: the callee's package qualifier is not part of the name --
methods::setRefClass("QualifiedField", fields = list(y = "numeric"))

# --- assignment form: still ONE symbol and ONE edge, never two -----------------------
AssignedField <- setRefClass("AssignedField", fields = list(x = "numeric"))
AssignedChild <- setRefClass("AssignedChild", contains = "AssignedField")

# --- runtime-computed class name: no publishable identity, so nothing is invented -----
factory <- function(Class) setRefClass(Class, fields = list(z = "numeric"))
