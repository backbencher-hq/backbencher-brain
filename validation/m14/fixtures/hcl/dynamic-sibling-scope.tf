# H7b: a `dynamic` block's loop local is bound by THAT block and dies with it.
# Binding it for the whole enclosing subtree leaks sideways: a resource with two
# dynamic blocks silences its own second block whenever an unrelated sibling
# happens to bind the same name. Measured over the 9,079-file corpus as 247 lost
# references, 165 of them `assume_role.value` across tf-aws-components' provider
# files — the exact shape below, where the FIRST block's label is `assume_role`
# and the SECOND block's local is `vpc`.
resource "aws_iam_role" "web" {
  dynamic "assume_role" {
    for_each = compact([module.iam_roles.terraform_role_arn])
    content {
      role_arn = assume_role.value
    }
  }

  # `vpc` is bound HERE, by this block. Nothing above binds it, so every
  # `vpc.*` below is a real reference to a resource named `vpc`.
  dynamic "vpc" {
    for_each = var.vpcs
    content {
      id     = vpc.value.id
      subnet = data.aws_subnet.by_id[vpc.value.subnet].id
    }
  }

  # A genuine reference to a resource whose TYPE happens to be a word a dynamic
  # label could also use. Not a loop local: nothing binds it here.
  bucket = aws_s3_bucket.vpc.id

  # Two nested dynamics that DO bind the same name: the inner one shadows the
  # outer for its own subtree, and both suppress within their own content.
  dynamic "outer" {
    for_each = var.outer
    iterator = inner
    content {
      x = inner.value
      dynamic "deeper" {
        for_each = inner.value.children
        content {
          y = inner.value
        }
      }
    }
  }
}

# THE REGRESSION CASE ITSELF. A `dynamic` block labelled `vpc` binds the local
# `vpc` for its own body — and nothing else. The read below is OUTSIDE that
# block but INSIDE the same resource, and `vpc.main` names a real resource whose
# TYPE happens to be `vpc`. A subtree-wide binding silences it; a per-block
# binding does not. This is the shape the corpus measured as 247 lost references
# (165 of them `assume_role.value` across tf-aws-components' provider files), and
# the reason the fixture exists rather than a prose note.
resource "vpc" "main" {
  dynamic "vpc" {
    for_each = var.peers
    content {
      peer_id = vpc.value.id
    }
  }

  primary_cidr = vpc.main.cidr_block
  peer_count   = length(var.peers)
}
