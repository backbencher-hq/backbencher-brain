# H11: the document root takes the file stem, so a file whose stem EQUALS a
# top-level block's Terraform address would give the document and the block one
# identity. Measured over the corpus: 308 such sites — `moved.tf` holding
# `moved {}` (13 files), `removed` (9), `worker` (3), `locals` (3), `import` (3).
# This fixture is named `moved.tf` on purpose, so the collision is exercised.
#
# `moved` blocks are one-per-resource-move BY DESIGN, so this file also pins
# sibling disambiguation against a name the document already holds: the root is
# `moved`, the blocks run `moved#2` .. `moved#4`, and every one of them keeps
# `hclAddress: "moved"` so the Terraform address is not lost.
moved {
  from = aws_dynamodb_table.asset_metadata
  to   = module.ddb.aws_dynamodb_table.asset_metadata
}

moved {
  from = aws_iam_policy.lambda_basic_execution
  to   = module.iam.aws_iam_policy.lambda_basic_execution
}

moved {
  from = aws_s3_bucket.static_assets
  to   = module.s3.aws_s3_bucket.static_assets
}
