# An override block's `target` is an `overrides` edge, and NOT a `references`
# edge.
#
# Terraform has a dedicated spelling for replacing a declaration's values:
# `override_resource` / `override_data` / `override_module`, each carrying a
# `target` attribute naming what it replaces. Measured over 9,329 corpus files:
# 71 such blocks in 33 files, 68 of them carrying a `target`, and 51 of those 68
# binding to a block-declared name under the indexer's own resolution rules.
#
# Before this the `target` was published as an ordinary `references` read, which
# is the NEIGHBOURING label — Terraform does not read the declaration it
# overrides, it replaces its values. So the edge is retyped and the `references`
# edge is SUPPRESSED rather than duplicated: the graph gains no edge, and a
# consumer following `references` is no longer told that an override block reads
# the thing it overwrites.
#
# The SOURCE is the override block's own qualified path, not whatever block
# encloses it: `run "test" { override_resource { … } }` below publishes
# `run.test.override_resource -> aws_instance.first`, because the block that
# replaces the values is the actor.

resource "aws_instance" "first" {
  ami = "ami-1"
}

resource "aws_instance" "second" {
  ami = "ami-2"
}

resource "aws_secretsmanager_secret" "creds" {
  name = "creds"
}

module "child" {
  source = "./child"
}

# A top-level override block: the document root owns it.
override_resource {
  target = aws_instance.second

  values = {
    ami = "ami-overridden"
  }
}

# `data.x.y` is a THREE-segment target for a data source, and it resolves the
# same way: the dotted tail after the first dot is the declared address.
override_data {
  target = data.aws_secretsmanager_secret.creds
  values = {}
}

override_module {
  target = module.child
  outputs = {
    string = "testfile"
  }
}

# Nested inside a `run` block, and the source is the OVERRIDE block — not `run`.
run "test" {
  command = plan

  override_resource {
    target = aws_instance.first
    values = {
      ami = "ami-mocked"
    }
  }

  assert {
    condition     = aws_instance.first.ami == "ami-mocked"
    error_message = "the override must win"
  }
}