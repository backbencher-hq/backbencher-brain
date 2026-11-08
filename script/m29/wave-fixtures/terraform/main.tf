# PINS the terraform wave fixture pack (M29.R2 wave 3, wave-onboarding lane C).
# A variable, a resource that references it, and an output that renders it.

variable "app_name" {
  type        = string
  description = "Name of the application."
  default     = "greeter"
}

resource "null_resource" "greeter" {
  triggers = {
    name = var.app_name
  }
}

output "greeting" {
  description = "Greeting rendered from the variable."
  value       = "hello ${var.app_name}"
}
