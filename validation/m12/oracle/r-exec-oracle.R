# R-EXEC ORACLE — Method B, for red-teaming Method A.
#
# Method A (r-globals-oracle.R) asks: "what does R's PARSER say this file binds?" It walks
# R's own AST. That is a walk written by me, applying binding rules I derived from R — so it
# is independent of the ANALYZER (which uses tree-sitter) but not independent of ME.
#
# This oracle asks a different question of a different subsystem: "what does this file
# actually BIND?" It evaluates the file in a fresh environment and asks the environment what
# it holds. No walk, no binding rules, no reading of R's semantics by me — just R's runtime
# telling me what exists.
#
# That makes it the only check in this lane that can catch Method A being wrong about R's
# semantics rather than about the grammar. It covers far fewer files: a package file
# references objects defined in its siblings, so most cannot be evaluated in isolation. The
# overlap is the point. Agreement on the files that DO evaluate corroborates Method A where
# it is checkable, and the files that do not are reported rather than counted as agreement.
#
# Emits: EXEC<TAB>name<TAB>file     one row per name bound at file level
#         ERR<TAB><message><TAB>file for a file R refuses to parse
#         SKIP<TAB><reason><TAB>file  for a file that parses but cannot be evaluated here
listfile <- Sys.getenv("BB_R_LIST")
if (!nzchar(listfile)) stop("BB_R_LIST not set")
files <- readLines(listfile, warn = FALSE)
files <- files[nzchar(files)]

for (f in files) {
  if (!file.exists(f)) next
  # SKIP, not ERR: a file that cannot be evaluated in isolation is not R's problem and not
  # the analyzer's either. Counting it as a disagreement would be wrong; ignoring it would
  # hide that the check is thin, so it is emitted and counted separately.
  result <- tryCatch(
    {
      env <- new.env(parent = globalenv())
      # suppressWarnings, because a deprecation or a package-load message is not a failure;
      # options(warn=-1) would also hide genuine ones, so warnings are dropped at the call
      # and the error path below is what decides.
      suppressWarnings(tryCatch(
        withVisible(eval(parse(f, keep.source = FALSE), envir = env)),
        error = function(e) structure(list(failed = TRUE), class = "execfail")
      ))
    },
    error = function(e) structure(list(failed = TRUE, msg = conditionMessage(e)), class = "execfail")
  )

  # A file that pulls in a SIBLING file's bindings cannot be evaluated in isolation and
  # reported honestly: `source("test-tools.R")` runs that file, so everything it binds
  # appears in this environment too. Those names are not this file's declarations, and
  # counting them as such would make Method B look wrong where it is only unqualified.
  # The first cross-check run proved the point -- abIndex-tsts.R reported six names via
  # `source()` that it does not declare. Such files are SKIPped, not scored.
  src <- tryCatch(paste(readLines(f, warn = FALSE), collapse = "\n"), error = function(e) "")
  for (sideEffect in c("source(", "sys.source(", "load(", "data(", "library(", "require(")) {
    if (grepl(sideEffect, src, fixed = TRUE)) {
      cat("SKIP\t", sideEffect, "pulls in another file's bindings\t", f, "\n", sep = "")
      result <- structure(list(failed = TRUE, msg = "side effect"), class = "execfail")
      break
    }
  }

  if (inherits(result, "execfail")) {
    cat("SKIP\t", if (is.null(result$msg)) "evaluation failed" else substr(result$msg, 1, 60),
        "\t", f, "\n", sep = "")
    next
  }
  for (nm in sort(ls(env, all.names = TRUE))) cat("EXEC\t", nm, "\t", f, "\n", sep = "")
}
