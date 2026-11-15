# H7: a `dynamic` block's `iterator` declares exactly the kind of block-local a
# `for`-intro does. Before the fix only `for_intro` identifiers were tracked, so
# `r.cidr` was published as a reference to a symbol that does not exist. Corpus
# measurement: `dynamic` occurs 360 times.
resource "aws_security_group" "web" {
  dynamic "ingress" {
    for_each = var.rules
    iterator = r
    content {
      cidr_blocks = [r.cidr]
      from_port   = r.port
    }
  }

  # No `iterator`, so the default name is the block LABEL and must be suppressed
  # just the same — the label is the loop variable in that form.
  dynamic "egress" {
    for_each = var.egress_rules
    content {
      cidr_blocks = [egress.cidr]
    }
  }

  # A real reference next to the suppressed ones.
  vpc_id = var.vpc_id
}

# The for-expression form, for contrast: `s` must not be published either.
locals {
  ids = [for s in var.subnets : s.id]
}
