# Docker Bake's `inherits` is the ONLY construct in the HCL corpus that expresses `extends`.
#
# A `target "child" { inherits = ["parent", …] }` block names other DECLARATIONS as its parents.
# Authored BEFORE the analyzer change that reads it, so the pre-change run is a FAILING run and a
# regression is visible rather than assumed.
#
# `_common` and `_platforms` are the conventional ABSTRACT bases (leading underscore, no output of
# their own); `binary` is a functional target and is still inherited by `cross`, which is why the
# merge-vs-derivation question is stated in the fixture rather than hidden by it.
target "_common" {
  dockerfile = "Dockerfile"
}

target "binary" {
  inherits = ["_common"]
  output   = ["bin/"]
}

target "cross" {
  inherits = ["binary", "_platforms"]
}

# Declared BELOW its child on purpose: docker-bake's own `binary-cross` inherits `_platforms`,
# which is declared lower in docker-bake.hcl, so a same-file resolution has to work in both
# directions or it drops real inheritance.
target "_platforms" {
  platforms = ["linux/amd64"]
}

# A parent that this file does NOT declare. The edge would dangle — nothing can bind
# `target.not_declared_here` — so the analyzer must publish nothing for it.
target "external_parent" {
  inherits = ["not_declared_here"]
}
