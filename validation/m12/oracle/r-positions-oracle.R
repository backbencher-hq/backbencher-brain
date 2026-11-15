# R-POSITIONS-ORACLE v1 — every identifier R's own parser saw, and exactly where.
#
# r-globals-oracle.R answers "which names does this file bind?". This one answers
# "where did R's parser put every identifier, and what did it call it?" — which is
# what the line-number claim actually rests on. Until now the line audit checked
# that an edge's line *contained* its target's text; that passes just as happily on
# a substring inside a string literal or a comment. R's token stream does not: a
# token is an identifier by construction, because R's lexer produced it.
#
# getParseData() is the source of truth and it is not a reimplementation of
# anything:
#
#   * `line1`/`col1`/`line2`/`col2` are R's own record of where each token is.
#   * R's columns are 1-based BYTES. Verified, not assumed: for `café <- 1` R
#     reports the SYMBOL at col 1..5 (é is two bytes) and tree-sitter reports the
#     same node as bytes 0..4. So the two coordinate systems are directly
#     comparable and a column can be checked exactly, not approximately.
#   * R distinguishes LEFT_ASSIGN (`<-`, `<<-`), EQ_ASSIGN (`=`) and RIGHT_ASSIGN
#     (`->`, `->>`) as distinct token types, so assignment direction is readable
#     from the token stream without consulting the AST at all.
#
# Nothing is executed. Only parse() runs, and a file R cannot parse is reported as
# REJECTED rather than skipped.
#
# Emits one row per identifier-bearing terminal:
#   POS \t line1 \t col1 \t line2 \t col2 \t name \t rawText \t tokenType \t file
# and REJECTED \t \t \t \t \t \t \t file for a file R refuses.
#
# The `text` field is escaped. A backticked name or a string constant may contain a
# TAB or a NEWLINE, and an unescaped one would split a row and silently misalign every
# field after it -- a corrupted row reads as a missing token, which would turn a real
# disagreement into a silent pass. Backslashes are escaped first so the unescape is
# unambiguous.
#
# For STR_CONST the quote characters are stripped as well as the backticks, because in
# R a NAME very often lives inside a string rather than beside it. That is R's own rule,
# measured here rather than assumed:
#
#     setClass(Matrix, representation())            ERROR: object 'Matrix' not found
#     setClass("Matrix", representation())          OK
#     setClass("Q", representation(Dim = integer))  ERROR: element 1 of the
#                                                   representation was not a single
#                                                   character string
#
# So in S4 the class name and the slot name are STRINGS, and R's only record of where
# they are is the interior of a STR_CONST. A consumer that needs to know whether a name
# was written bare or inside a string must read the tokenType: the text alone cannot
# say, and the distinction matters.

listfile <- Sys.getenv("BB_R_LIST")
if (!nzchar(listfile)) stop("BB_R_LIST not set")
files <- readLines(listfile, warn = FALSE)
files <- files[nzchar(files)]

# The terminals that denote a name. SYMBOL is a variable name, SYMBOL_FORMALS a
# parameter, SYMBOL_FUNCTION_CALL/SYMBOL_SUB the callee/subscript position,
# STR_CONST a backticked name, SLOT the name after `@`, and FUNCTION_KW is
# deliberately absent: `function` is a keyword, not a name.
# SYMBOL_PACKAGE is here for a reason that cost a cluster of 927 false alarms to learn.
# R lexes
#
#     base::sign
#
# as FOUR tokens -- SYMBOL_FUNCTION_CALL `prod`, '(' , SYMBOL_PACKAGE `base`, NS_GET `::`,
# SYMBOL_FUNCTION_CALL `sign`. The package name is carried by SYMBOL_PACKAGE and by
# nothing else: NS_GET's own text is the two-character string "::" and carries no name at
# all. A harness listing only the SYMBOL family therefore cannot see that a line
# references the `base` namespace, and every `imports` edge whose evidence is a `pkg::fn`
# call presents as an edge pointing at nothing.
#
# Verified against R 4.4.3 rather than assumed -- this is the third token type R has for
# a thing R code obviously contains, after SYMBOL_SUB for an argument name and STR_CONST
# for a name written as a string.
# BREAK and NEXT are here because R is asymmetric about three functions that are all
# callable and all legal, and the asymmetry is R's own:
#
#     return(1)   -> SYMBOL_FUNCTION_CALL   (a NAME)
#     break()     -> BREAK                  (a keyword)
#     next        -> NEXT                   (a keyword)
#
# `break()` parses and runs; it is a call to the reserved word `break`. So the oracle has
# to record those two tokens as names or every `break()` call in the corpus looks like an
# edge pointing at a line that never mentions `break`. A fourth R token type the analyzer
# also needs is not a name at all and is absent here: FUNCTION, the `function` keyword.
NAME_TOKENS <- c("SYMBOL", "SYMBOL_FORMALS", "SYMBOL_FUNCTION_CALL",
                 "SYMBOL_SUB", "SYMBOL_PACKAGE", "STR_CONST", "SLOT",
                 "BREAK", "NEXT")

# Backslash FIRST, then the whitespace escapes. The order matters and is easy to get
# wrong: escape backslashes last and the escapes this function just wrote get escaped
# again, turning `\t` into `\\t`. Four explicit steps beat four nested gsub() calls,
# because the order is then visible in the code instead of implied by nesting.
#
# fixed = TRUE throughout, so the patterns are matched LITERALLY. Without it "\\" is a
# regex, and a regex that ends in a backslash does not compile ("Trailing backslash")
# -- which is what happened before this was pinned down by running it.
esc <- function(x) {
  x <- gsub("\\", "\\\\", x, fixed = TRUE) # one backslash -> two
  x <- gsub("\t", "\\t", x, fixed = TRUE)          # TAB   -> \t
  x <- gsub("\n", "\\n", x, fixed = TRUE)          # LF    -> \n
  gsub("\r", "\\r", x, fixed = TRUE)               # CR    -> \r
}
# Strip ONE matching pair of quote characters. Matching matters: the string 'a"b'
# contains a double quote, and stripping the two characters independently would
# corrupt it into `a"b` minus its real delimiters.
unquote <- function(x) {
  n <- nchar(x)
  if (n >= 2) {
    a <- substr(x, 1, 1)
    b <- substr(x, n, n)
    if (a %in% c("`", "\"", "'") && a == b) return(substr(x, 2, n - 1))
  }
  x
}


for (f in files) {
  if (!file.exists(f)) next
  parsed <- tryCatch(parse(f, keep.source = TRUE), error = function(err) NULL)
  if (is.null(parsed)) {
    cat("REJECTED\t\t\t\t\t\t\t", f, "\n", sep = "")
    next
  }
  pd <- tryCatch(getParseData(parsed), error = function(err) NULL)
  if (is.null(pd)) {
    cat("REJECTED\t\t\t\t\t\t\t", f, "\n", sep = "")
    next
  }
  # One defensive tryCatch around the whole row build: an odd node is dropped
  # rather than aborting the run, and a dropped row can only ever reduce what the
  # comparison is allowed to pass, never let a bad answer through.
  tryCatch({
    keep <- pd$terminal & pd$token %in% NAME_TOKENS & !is.na(pd$text)
    rows <- pd[keep, c("line1", "col1", "line2", "col2", "text", "token"), drop = FALSE]
    for (i in seq_len(nrow(rows))) {
      # The RAW token text and the NAME are both emitted, as separate fields, and the
      # consumer is not asked to recover one from the other. Reconstructing a delimiter
      # downstream is guesswork: a token may be wrapped in " or ' or `, and a string may
      # contain the other two. R already knows which, so R says so.
      cat("POS\t", rows$line1[i], "\t", rows$col1[i], "\t",
          rows$line2[i], "\t", rows$col2[i], "\t",
          esc(unquote(rows$text[i])), "\t", esc(rows$text[i]), "\t",
          rows$token[i], "\t", f, "\n", sep = "")
    }
  }, error = function(err) NULL)
}
