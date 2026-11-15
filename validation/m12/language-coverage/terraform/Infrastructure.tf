# Minimal Terraform fixture for the M12 language-coverage gate.
#
# `terraform` is a key in SUPPORTED_LANGUAGES (its wasm case is the HCL grammar)
# but no extension in EXTENSION_LANGUAGE maps to it: `.tf`/`.tfvars`/`.tofu` all
# route to `hcl`. This fixture is the measurement of that, not an assumption —
# the gate indexes it and reports the language that was actually stored.

terraform {
  required_version = ">= 1.0"
}

variable "coverage_region" {
  type    = string
  default = "us-east-1"
}

resource "null_resource" "coverage" {
  triggers = {
    region = var.coverage_region
  }
}
