# Negative fixture: syntax errors are owned by ASTEngine (tree-sitter
# ERROR/MISSING), never re-emitted by the analyzer. What the analyzer MUST still
# do is descend through the damaged region so the blocks that survived are
# emitted — the swallow class (#907).
resource "aws_s3_bucket" "good_one" {
  bucket = "ok"
}

resource "aws_s3_bucket" "broken" {
  bucket =
}

resource "aws_s3_bucket" "also_good" {
  bucket = var.still_reachable
}
