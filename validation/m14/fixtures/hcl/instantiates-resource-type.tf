# Synthetic source pinning the `instantiates` shape: a `resource` / `data` block instantiates the
# PROVIDER TYPE its first label names (`resource "aws_instance" "web"` instantiates the type
# `aws_instance`). The type is declared by a provider binary, in no repository, so the edge target
# is the label as written and the whole-corpus arm classifies it unresolved/external — that is the
# corpus-unexercised fact, not a reason to publish nothing.
#
# Authored BEFORE the analyzer change, so the pre-change run is a FAILING run.
resource "aws_instance" "web" {
  ami           = "ami-0123456789"
  instance_type = "t3.micro"
}

resource "aws_s3_bucket" "logs" {
  bucket = "example-logs-bucket"
}

data "aws_ami" "latest" {
  most_recent = true
}

# A nested block is a MEMBER, not an instantiation: `lifecycle` names no type.
resource "aws_db_instance" "db" {
  engine = "postgres"

  lifecycle {
    create_before_destroy = true
  }
}

# A `module` block names a SOURCE, not a type: it earns `imports`, never `instantiates`.
module "network" {
  source = "./modules/network"
}

# A `dynamic` block generates members for the enclosing resource; it instantiates no type.
resource "aws_security_group" "sg" {
  dynamic "ingress" {
    for_each = var.rules
    content {
      from_port = ingress.value
    }
  }
}

# A `variable` is a declaration of a value, not an instantiation.
variable "rules" {
  type = list(number)
}
