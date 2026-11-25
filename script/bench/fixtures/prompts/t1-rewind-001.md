The shopping cart in `src/cart.js` has a pricing bug: quantity discounts are never
applied.

The intended rule is: a line with a quantity of 10 or more gets a 10% discount on that
line's value (price × qty). Lines below the threshold get no discount.

Fix the bug so the test suite passes.

Run the tests with:
    node --test "test/*.test.js"

Do not change the tests.
