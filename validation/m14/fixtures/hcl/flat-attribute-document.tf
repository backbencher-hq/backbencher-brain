# H5: a flat attribute map is a legitimate HCL document. Every one of these is a
# declaration; before the fix the attribute branch was guarded
# `blockPath.length > 0`, so a top-level attribute had no enclosing block and
# was dropped outright — 126 corpus files with real content produced no symbols
# at all (consul agent config, boundary enos.vars.hcl, every *.tfvars).
region        = "us-east-1"
acl_master_token = "s3cr3t"

acl = {
  enabled = true
  tokens = {
    master = "m"
  }
}

count = 3
list  = ["a", "b"]
nested = {
  deep = {
    deeper = var.not_a_reference_here
  }
}
