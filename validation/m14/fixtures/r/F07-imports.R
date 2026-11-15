# Dependencies: library with options, require with character.only, source, sourceCpp,
# namespace access with :: and :::.
library(dplyr, warn.conflicts = FALSE)
require(methods, character.only = TRUE)
library("stats")
source("helpers.R")
sourceCpp("code.cpp")
dplyr::filter(df, x > 1)
internal:::secret()
