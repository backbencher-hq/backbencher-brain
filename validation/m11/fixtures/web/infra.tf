terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "instance_count" {
  type    = number
  default = 2
}

locals {
  environment = "prod"
  tags = {
    Project = "orders"
    Env     = local.environment
  }
}

provider "aws" {
  region = var.region
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
  tags       = local.tags
}

resource "aws_subnet" "public" {
  count           = 2
  vpc_id          = aws_vpc.main.id
  cidr_block      = "10.0.${count.index}.0/24"
  map_public_ip_on_launch = true
}

resource "aws_instance" "web" {
  count         = var.instance_count
  ami           = "ami-123456"
  instance_type = "t3.micro"
  subnet_id     = aws_subnet.public[0].id
  tags = {
    Name = "web-${count.index}"
  }
}

data "aws_ami" "ubuntu" {
  most_recent = true
  filter {
    name   = "name"
    values = ["ubuntu-*"]
  }
}

output "vpc_id" {
  value = aws_vpc.main.id
}

output "web_ips" {
  value = aws_instance.web[*].private_ip
}

module "database" {
  source  = "terraform-aws-modules/rds/aws"
  version = "6.0.0"
  name    = "orders-db"
}
