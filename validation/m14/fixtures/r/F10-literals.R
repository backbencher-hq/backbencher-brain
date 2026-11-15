# Literals the grammar must accept, including C99 hex floats.
hex_int <- 0xff
hex_exp <- 0x1p+53
hex_frac <- 0x1.8p+3
dec <- 1e5
dec2 <- 1E-5
lng <- 42L
cplx <- 1i
chr <- "text"
raw <- r"(raw \n string)"
missing_default <- function(a, b = 2, ...) NULL
