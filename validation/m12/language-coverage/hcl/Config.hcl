# Generic HCL configuration — deliberately NOT Terraform.
#
# Why this file exists: `.tf`/`.tfvars`/`.tofu` used to route to the `hcl` language and
# this repository's only HCL fixtures were Terraform files, so the `hcl` lane was
# "covered" by files that are not HCL. After the M12 reachability fix routes those
# extensions to `terraform` (a language the registry declares and the router could not
# previously reach), the coverage gate correctly reported `hcl(NO-FIXTURE)` — the lane
# had no witness of its own. This is one: HCL as consumed by Terragrunt/Packer-style
# tooling, with no provider/resource blocks.

variable "region" {
  type        = string
  default     = "eu-west-1"
  description = "Deployment region"
}

locals {
  name_prefix = "bb-${var.region}"
  tags = {
    owner   = "platform"
    service = "indexer"
  }
}

remote_state {
  backend = "s3"
  config = {
    bucket = "state-bucket"
    key    = "env/${local.name_prefix}.tfstate"
    region = var.region
  }
}
