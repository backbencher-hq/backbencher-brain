resource "aws_instance" "web" {
  ami = "ami-123"

  # H1: the grammar wraps comparison and arithmetic operands in
  # `operation` -> `binary_operation`, whose children are the SAME
  # variable_expr + get_attr sibling run that an `expression` carries. Before the
  # fix the path reader was gated on `node.type === "expression"`, so every
  # reference below was silently dropped. Measured: 758 corpus attributes.
  is_restored = var.db_snapshot_identifier != null
  max_open    = var.db_max_open_connections >= 5
  compound    = var.extra_users >= 0 && floor(var.extra_users) == var.extra_users
  negated     = !var.enabled
  offset      = -1
  interpolated = "${var.prefix}-suffix"
  sum         = var.a + var.b

  tags = merge(var.common_tags, {
    Name = "${var.project}-${var.environment}"
  })

  subnet_ids = [for s in data.aws_subnet.default : s.id if contains(local.allowed, s.availability_zone)]

  depends_on = [aws_s3_bucket.logs, module.networking]
}

variable "db_snapshot_identifier" {
  type    = string
  default = null
}

variable "db_max_open_connections" {
  type    = number
  default = 5
}

variable "extra_users" {
  type    = number
  default = 0
}

variable "enabled" {
  type    = bool
  default = true
}

variable "prefix" {
  type = string
}

variable "project" {
  type = string
}

variable "environment" {
  type = string
}

variable "a" {
  type = number
}

variable "b" {
  type = number
}

variable "common_tags" {
  type = map(string)
}

locals {
  allowed = ["us-east-1a", "us-east-1b"]
}

data "aws_subnet" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.main.id]
  }
}

data "aws_vpc" "main" {
  id = "vpc-123"
}

resource "aws_s3_bucket" "logs" {
  bucket = "${var.project}-logs"
}

module "networking" {
  source = "terraform-aws-modules/vpc/aws"
  vpc_id = data.aws_vpc.main.id
}
