# A `calls` edge exists only where the SAME FILE declares the callee.
#
# The HCL grammar has no function-declaration production: a function is a block,
# and the ecosystem layers the declaration on top of it. docker-bake spells that
# `function "name" { … }` and Terraform 1.8+ spells it `func "name" { … }`; both
# parse as an ordinary one-label block. Measured over 9,329 corpus files /
# 2,035,319 nodes there is exactly ONE declaration of the shape —
# `function "bindir"` at docker/docker-bake.hcl:56 — and 4 call sites for it, so
# that is the spelling read here and `func` is not.
#
# The other 12,968 unqualified `function_call` nodes in that corpus are Terraform
# globals plus 20 namespaced `provider::` calls, and NONE of them declares
# anything a repository can declare. Publishing them as `calls` is exactly the
# fabricated edge the workstream's rule forbids: a fake caller becomes wrong
# refactoring advice in bb_graph and bb_impact. So `merge(…)`, `length(…)` and
# `provider::test::is_true(…)` produce no edge, while `double(…)` — declared
# three lines up — does.
#
# The TARGET is the declaration's index identity (`function.double`), not the bare
# name the file writes, because that is the string the index can bind. The
# call-site spelling rides along in `metadata.hclCallee` so nothing is lost.

function "double" {
  params = [n]
  result = n * 2
}

function "unused" {
  params = []
  result = null
}

locals {
  doubled = double(21)
  # A GLOBAL callee beside a declared one, on purpose: the fixture fails if the
  # two classes are ever collapsed together.
  merged = merge({ a = 1 }, { b = 2 })
  sized = length(local.merged)

  # The reference read INSIDE a call is still a `references` edge. Calling a
  # function and reading an address are two different facts.
  nested = double(length(local.merged))
}

resource "aws_instance" "web" {
  count         = double(2)
  instance_type = "t3.micro"
}