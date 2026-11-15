terraform {
  required_version = ">= 1.3.0"
  backend "s3" {
    bucket = "my-state-bucket"
    key    = "terraform.tfstate"
  }
}

provider "aws" {
  region = var.region
}

variable "region" {
  type        = string
  default     = "us-east-1"
  description = "AWS region"
}

variable "instance_count" {
  type    = number
  default = 2
}

variable "environment" {
  type = string
}

variable "allowed_cidrs" {
  type = list(string)
}

variable "vpc_cidr" {
  type = string
}

variable "instance_ids" {
  type = list(string)
}

locals {
  name_prefix = "app-${var.region}"
  common_tags = {
    Environment = var.environment
    Owner       = "platform"
  }
  instance_arns = [
    for i in var.instance_ids : "arn:aws:ec2:${var.region}:${i}"
  ]
}

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]
}

resource "aws_instance" "web" {
  count         = var.instance_count
  ami           = data.aws_ami.ubuntu.id
  instance_type = "t3.micro"
  tags          = local.common_tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group" "web" {
  name        = "${local.name_prefix}-sg"
  description = "Web security group"

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidrs
  }

  depends_on = [aws_instance.web]
}

output "instance_ip" {
  value = aws_instance.web.public_ip
}

module "network" {
  source = "./modules/network"
  cidr   = var.vpc_cidr
}
