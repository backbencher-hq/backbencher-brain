// validation/m12/fixtures/go/Negative.go
// M12.22 Go negative fixture:
//   - function-local var/const declarations are NOT symbols (LocalsAreNotSymbols)
//   - function parameters are NOT symbols (ParamsAreNotSymbols)
//   - anonymous struct/function literals are NOT symbols (AnonTypesAreNotSymbols)
//   - builtin calls (append, len, make) produce NO calls edges (BuiltinsAreFiltered)
//   - stdlib method calls DO produce leaf-target calls (strings.ToUpper -> ToUpper)
//   - field-type dependency edges are NOT emitted (no uses struct -> []*User)
//   - package-level contains edges are NOT emitted (no contains pkg -> X)
package counter

import (
	"strings"
)

var fileLevel = 0 // package-level variable IS a symbol

type Counter struct {
	total int
}

func (c *Counter) bump(amount int) int {
	local := amount * 2     // local — NO symbol
	const step = 1          // local const — NO symbol
	c.total += local + step
	return c.total
}

func (c *Counter) snapshot() int {
	anon := struct {
		value int
	}{value: c.total} // anonymous struct — NO symbol, NO fields as symbols
	_ = anon
	return c.total
}

func (c *Counter) operate(items []int) []int {
	var out []int
	for _, it := range items {
		out = append(out, it*2)      // append — builtin, NO calls edge
	}
	out = append(out, len(items))    // len — builtin, NO calls edge
	return out
}

func (c *Counter) title() string {
	return strings.ToUpper("counter") // stdlib leaf call -> calls title -> ToUpper
}
