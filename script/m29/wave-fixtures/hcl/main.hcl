# PINS the hcl wave fixture pack (M29.R2 wave 3, wave-onboarding lane C).
# Generic HCL (not Terraform): locals declared once and referenced by a block.

locals {
  app_name = "greeter"
  greeting = "hello ${local.app_name}"
}

service "greeter" {
  name    = local.app_name
  message = local.greeting
}
