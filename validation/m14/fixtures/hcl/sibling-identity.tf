# H3/H4/H11: identity must be unique among siblings WITHOUT losing the address.
#
# `locals` may appear many times in one file; `moved`/`removed`/`import` are
# one-per-move by design; a label-less `data` block once produced an EMPTY name
# (`labels.join(".")` over zero labels is ""); and a file whose stem equals a
# top-level block's address would otherwise give the document and the block one
# identity (308 such sites over the corpus).

locals {
  a = 1
}

locals {
  b = 2
}

locals {
  c = 3
}

# Label-less `data`: the block type is the fallback address, never "".
data {
  foo = "bar"
}

# One-label `resource`: the single label is the address.
resource "aws_s3_bucket" {
  bucket = "b"
}

# Nested blocks repeat too, and keep their type in the identity.
resource "aws_instance" "web" {
  lifecycle {
    create_before_destroy = true
  }

  lifecycle {
    prevent_destroy = true
  }
}
