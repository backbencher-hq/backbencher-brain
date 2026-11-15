# terragrunt `include` is the ONE construct in the measured corpus that SPLICES another file's
# configuration into this one: terragrunt merges the included file's blocks into the including
# config (which is why remote_state/dependencies declared in a root file are visible in a child).
# Authored BEFORE the analyzer change that publishes it, so the pre-change run is a FAILING run.
include "root" {
  path   = "terragrunt-root.hcl"
  expose = true
}

include "library" {
  path = "./lib/terragrunt-library.hcl"
}

# A computed path names no file this parse can know: the include is still a real include, but a
# `part_of` edge whose target is the expression would be an edge to nothing.
include "computed" {
  path = find_in_parent_folders()
}

# An interpolated template is the same fact in a different spelling: the static halves
# ("${get_terragrunt_dir()}/root.hcl") must not leak as a filename this parse can name.
include "templated" {
  path = "${get_terragrunt_dir()}/root.hcl"
}

# The grammar permits an `include` with no `path` attribute; it names nothing.
include "unnamed" {
  expose = true
}

# A `terraform_remote_state` data source READS state from another stack; it is not a splice of
# that stack's configuration into this file. It must earn no `part_of`.
data "terraform_remote_state" "vpc" {
  backend = "local"
  config = {
    path = "../vpc/terraform.tfstate"
  }
}

# `read_terragrunt_config()` READS another terragrunt config at runtime: a function call, not an
# include block.
locals {
  common = read_terragrunt_config(find_in_parent_folders("common.hcl"))
}

# A module block is NOT a textual splice: the module is a separate unit addressed `module.NAME.*`,
# never merged into this file's own configuration — so it earns `imports`, never `part_of`.
module "fixture" {
  source = "./terragrunt-root.hcl"
}
