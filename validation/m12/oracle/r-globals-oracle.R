# R-ORACLE v2 — R's PARSER, R's AST, no execution.
#
# R's own parse() builds the AST, so R's grammar and R's desugaring of the
# rightward assignment forms are already applied. This file then walks that AST and
# collects the names bound at file level. The walk is a plain traversal, not a
# reimplementation of R's scoping rules.
#
# Why not `eval` + `ls()`? That is the more authoritative question, but only 389 of
# 1,174 corpus files could be evaluated in a sandbox (package files reference each
# other and error). 753 unevaluated files is a hole, not coverage. Parsing needs no
# stubs and covers everything.
#
# Why not a purely top-level syntactic rule? Because it is WRONG: it reports that
# `(Mv <- Matrix.Version())` in Matrix/tests/Simple.R binds nothing, when R binds
# Mv and the very next line of that file uses it. The walk descends, so
# parenthesised and `if`-guarded assignments are seen.
#
# Not descended into, because the name is not a file-level binding:
#   * `function` forms      — the body is a local scope
#   * the first argument of `local()` — a fresh environment
#   * `for` loop variables  — a loop control, deleted when the loop ends
#
# Every step is wrapped so that an unusual node is skipped rather than aborting the
# run: a partially-collected file is still reported, and the wrapper never invents
# a name.
#
# Emits: OK \t name \t file     (one row per file-level binding)
#         REJECTED \t \t file   (R itself cannot parse the file)

ASSIGN_OPS <- c("<-", "=", "<<-")

# Safe element access. R's AST can hold the empty symbol (a missing argument);
# touching it raises "argument is missing", so it is filtered out here.
node_at <- function(x, i) {
  r <- tryCatch({
    if (i > length(x)) NULL else {
      v <- x[[i]]
      if (is.symbol(v) && !nzchar(as.character(v))) NULL else v
    }
  }, error = function(e) NULL)
  r
}

# Is this `if` condition statically FALSE, so the `then` branch never runs?
#
# Found by a red-team cross-check against a second R method -- this oracle EVALUATED each
# file and asked the resulting environment what it held, which shares no code and no rules
# with this walk. It disagreed on 8 files, and every one of those disagreements was a name
# this walk reported and R never bound. Two causes, both real:
#
#     Matrix/data/CAex.R   if (FALSE) { sNms <- ...; L <- ... }   -- never executes
#     Matrix/R/Cholesky.R   rm(.def.unpacked, .def.packed)        -- removed again at top level
#
# So the walk was wrong about R's SEMANTICS in exactly the way a fixture suite written beside
# the analyzer can be, and the differential was reporting agreement rather than
# verification. Only the LITERAL constants are treated as dead: R's parser does not constant
# fold, and a variable that happens to hold FALSE is not statically knowable.
isStaticallyFalse <- function(cond) {
  if (is.name(cond)) {
    nm <- as.character(cond)
    return (nm %in% c("F", "FALSE", "false"))
  }
  if (is.logical(cond) && length(cond) == 1L) return (is.na(cond) || !cond)
  FALSE
}

collect <- function(x, out) {
  if (!is.call(x)) return(invisible(NULL))
  op <- tryCatch(as.character(node_at(x, 1))[1], error = function(e) NA_character_)
  if (is.na(op)) return(invisible(NULL))
  n <- length(x)

  # A statically dead `if`: the branch R never evaluates contributes no binding. The live
  # branch is still collected, so `if (FALSE) {...} else {...}` is answered correctly.
  if (identical(op, "if") && n >= 3L) {
    cond <- node_at(x, 2)
    if (isStaticallyFalse(cond)) {
      if (n >= 4L) collect(node_at(x, 4), out)   # the else branch
      return(invisible(NULL))
    }
  }

  # `rm(a, b)` at file level UNBINDS. A name declared and then removed is not a binding the
  # file leaves behind, and Method B -- which evaluates the file -- does not report it. A
  # package that defines a helper, uses it to register methods, and removes it is the normal
  # idiom, so this is not a rare shape: Cholesky.R does it twice.
  if (identical(op, "rm") && n >= 2L) {
    for (i in seq.int(2L, n)) {
      a <- node_at(x, i)
      if (is.name(a)) {
        nm <- as.character(a)
        if (exists(nm, envir = out, inherits = FALSE)) rm(list = nm, envir = out)
      }
    }
    return(invisible(NULL))
  }

  if (op %in% ASSIGN_OPS && n == 3L) {
    # The TARGET side can itself contain an assignment that binds at file level:
    # R evaluates the subscript first, so `tru[i.lt <- 1] <- v` binds BOTH i.lt
    # and tru (verified on R 4.4.3). An earlier version of this oracle descended
    # only into the value and silently lost every such name.
    tgtNode <- node_at(x, 2)
    if (is.call(tgtNode)) collect(tgtNode, out)
    # R normalizes a rightward assignment so the bound name is element 2
    # (`2 -> b` is stored as `<-`(b, 2)). Element 2 being a symbol is exactly the
    # condition under which R makes a binding at all; `name -> value` leaves a
    # non-symbol there and R raises "invalid (do_set) left-hand side".
    tgt <- node_at(x, 2)
    # The target may be a NAME or a quoted STRING, and R binds both:
    #     "%+replace%" <- function(e1, e2) ...   # ggplot2/R/theme-current.R:130
    # A character literal is not a name in R's AST, so requiring `is.name` here made this
    # oracle miss a binding R makes -- the same blind spot the analyzer had, which is how
    # both agreed on a false negative. Found by the exec cross-check.
    if (is.name(tgt)) assign(as.character(tgt), TRUE, envir = out)
    else if (is.character(tgt) && length(tgt) == 1L && nzchar(tgt)) assign(tgt, TRUE, envir = out)
    val <- node_at(x, 3)
    if (is.call(val)) collect(val, out)
    return(invisible(NULL))
  }

  if (identical(op, "function")) {
    # A `function` node is (function, <formals>, <body>). Both the formals and the
    # body live in the function's own frame: a default value is evaluated lazily
    # there, and nothing assigned in the body escapes. Nothing is descended into.
    return(invisible(NULL))
  }

  if (identical(op, "for")) {
    b <- node_at(x, 4)
    if (is.call(b)) collect(b, out)
    return(invisible(NULL))
  }

  if (identical(op, "local")) return(invisible(NULL))

  for (i in seq_len(n)) {
    child <- node_at(x, i)
    if (is.call(child)) collect(child, out)
  }
  invisible(NULL)
}

listfile <- Sys.getenv("BB_R_LIST")
if (!nzchar(listfile)) stop("BB_R_LIST not set")
files <- readLines(listfile, warn = FALSE)
files <- files[nzchar(files)]

for (f in files) {
  if (!file.exists(f)) next
  parsed <- tryCatch(parse(f, keep.source = FALSE), error = function(err) NULL)
  if (is.null(parsed)) {
    cat("REJECTED\t\t", f, "\n", sep = "")
    next
  }
  found <- new.env(parent = emptyenv())
  top <- as.list(parsed)
  for (e in top) tryCatch(collect(e, found), error = function(err) NULL)
  for (nm in sort(ls(found, all.names = TRUE))) {
    cat("OK\t", nm, "\t", f, "\n", sep = "")
  }
}
