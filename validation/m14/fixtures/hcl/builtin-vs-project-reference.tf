# The BUILTIN / PROJECT reference split, which decides the relationship LABEL.
#
# HCL's reference roots divide exactly the way the house precedent divides them
# at real-sql-analyzer.ts:1569 — a target in a GLOBAL namespace is `uses`, a
# project symbol is `references`. `count`/`each`/`self`/`path`/`terraform`
# resolve to nothing in the index, because no file can declare them;
# `var`/`local`/`module`/`data` and the `<type>.<name>` family all resolve to
# declarations. Publishing both classes as `references` asserted a declaration
# that does not exist — 2,029 edges over the 9,079-file corpus, led by
# `path.module` (506), `each.key` (325), `each.value` (285), `count.index` (214).
#
# Every `uses` row below names a builtin on its line; every `references` row
# names a declaration. The two classes are never mixed.

variable "name" {
  type    = string
  default = "web"
}

data "aws_ami" "chosen" {
  most_recent = true
}

locals {
  full = "${var.name}-suffix"
}

# count / for_each / self / path / terraform — the five builtin roots.
resource "aws_instance" "web" {
  count         = 2
  instance_type = "t3.micro"

  tags = {
    Name   = "${var.name}-${count.index}"
    Serial = "${self.id}-${path.module}"
    Each   = "${each.key}:${each.value}"
    Space  = terraform.workspace
  }

  # A project address on the SAME attribute as a builtin, so the fixture fails if
  # the two are ever collapsed into one class again.
  ami = data.aws_ami.chosen.id

  dynamic "ebs_block_device" {
    for_each = local.devices
    iterator = dev
    content {
      device_name = dev.value.name
      volume_size = count.index
    }
  }

  depends_on = [local.full]
}

locals {
  devices = { root = 20 }

  # Function calls are present here on purpose, and they are the subject of the
  # `calls` RULING: HCL declares no function, class or type of any kind, so
  # every callee below is a member of Terraform's global function namespace and a
  # `calls` edge would dangle. Across 12,977 `function_call` nodes in 9,079 corpus
  # files not ONE callee resolves to a declared symbol — the 5 apparent matches
  # are name collisions (length, file, timestamp, lower, and the type keyword
  # `object` sitting beside a declared `output "object"`). So the analyzer emits
  # no `calls` edge at all, and the reference read INSIDE the call is published.
  ids    = toset([for d in local.devices : d])
  merged = merge(local.devices, { extra = 1 })
  picked = lookup(local.merged_map, "extra", null)
  tags   = merge(local.devices, { for_each_key = each.key })
}
