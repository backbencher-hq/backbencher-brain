variable "region" {
  type    = string
  default = "us-east-1"
}

resource "aws_instance" "web" {
  ami   = var.ami_id
  count =
}
