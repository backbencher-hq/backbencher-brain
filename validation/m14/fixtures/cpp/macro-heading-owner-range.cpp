// D14: an owner symbol's range must span the edges it owns.
//
// Taken from the measured nlohmann-json site
// `tests/src/unit-class_const_iterator.cpp:14-15`, where TEST_CASE's opening brace
// sits on its OWN LINE rather than beside the macro invocation:
//
//     14  TEST_CASE("const_iterator class")
//     15  {
//     16      SECTION("construction")
//     ...
//
// That brace placement is the whole defect. The analyzer's macro-heading recovery
// builds its range from the HEADING node — the macro invocation — and on this shape
// that node ends at line 14, while the recovered `function_definition` (and every
// edge its body emits) runs on to the closing brace hundreds of lines later. At
// HEAD the symbol was published as `1-1` and owned edges at lines 3, 5 and 6.
//
// MEASURED corpus-wide before the fix: 39,787 macro-heading edges outside their
// owner's range, across 1,076 offending symbols, of 234,111 owner-checkable edges.
// After it: 0.

// The defect case. The brace is on the next line, as in the measured source.
TEST_CASE("outer")
{
    SECTION("inner")
    {
        int total = helper(1);
        consume(total);
    }
}

// The CONTROL, and the reason this pin is not one-sided: when the brace is on the
// same line as the invocation, the heading node and the recovered definition
// coincide, so the range was already correct. A fix that simply widened every
// macro heading to some fixed number of lines would pass the case above and would
// not be caught by anything here.
TEST_CASE("same line")
{
    int total = helper(2);
    consume(total);
}

// A second defect case with a deeper body, so a fix that special-cases one nesting
// level fails here.
TEST_CASE("deep")
{
    SECTION("one")
    {
        SECTION("two")
        {
            SECTION("three")
            {
                consume(helper(3));
            }
        }
    }
}