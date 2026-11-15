# F19-bracket-generics.R — R's replacement generics are NAMED with angle brackets.
#
# `$<-`, `[[<-`, `[<-` and `names<-` are base R's own replacement functions, and R
# registers S3 methods for them by the ordinary `generic.class` dotted-name
# convention:
#
#     `$<-.data.frame`      `[[<-.data.frame`      `[<-.tibble`
#
# Every one of those names contains `<` or `>`. The analyzer emits the `implements`
# edge for each, because the convention and `name.indexOf(".") > 0` both hold and
# nothing about them is a guess beyond the convention every dotted name carries.
#
# `filterNoiseRelationships` (`src/ast/pool-worker.ts:652`) drops any relationship
# whose target leaf matches /[{}`<>\n\r\t]/, which is the template-literal-garbage
# rule. Measured over the admitted R corpus: 129 relationships deleted by it, 53 of
# them `implements`. This file's expectation pins the survivors AND, through
# `knownProductionLoss`, pins the loss as a three-way assertion so it cannot go
# unrecorded and cannot outlive its measurement.
#
# The forms are the ones `R6/tests/testthat/test-s3-methods.R` writes, which is where
# the measurement found them: a backticked dotted assignment whose target side is a
# `function_definition`.

`$<-.AC` <- function(x, name, value) stop("no `$` assignment")
`[[<-.AC` <- function(x, i, value) stop("no `[[` assignment")
`[<-.AC` <- function(x, i, value) stop("no `[` assignment")
`names<-.AC` <- function(x, value) stop("no names assignment")

# The plain forms carry no bracket, so they SURVIVE production `parseFile` and are
# asserted as ordinary expectations. They are here so the fixture fails if a fix to
# the shared filter OVER-corrects and starts deleting these too.
`$.AC` <- function(x, name) stop("no `$` read")
`[[.AC` <- function(x, i) stop("no `[[` read")

# A replacement function DEFINED and CALLED, which is the second shape the corpus
# measurement found: Matrix/R/index.R both defines `diag<-` and calls it, and produced
# `diag<- -calls-> diag<-`.
`diag<-` <- function(m) m

assign_or_replace <- function(m) {
  `diag<-`(m)
  m
}
