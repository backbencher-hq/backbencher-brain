package reads

var Global int
var _ = 1

const Limit = 100

type Point struct {
	X int
}

type Color int

const (
	Red Color = iota
	Green
)

func takes(v int) int {
	return v
}

func apply(f func(int) int, v int) int {
	return f(v)
}

func target_fn(v int) int {
	return v + Global
}

func shadowed(Global int) int {
	return Global
}

func reader() int {
	total := Global + Limit
	p := Point{X: total}
	return takes(total) + p.X + target_fn(total)
}

func withlocal() int {
	total := 1
	{
		total := 2
		_ = total
	}
	return total
}

func loopmod(items []int) int {
	sum := 0
	for i, v := range items {
		sum += v + i
	}
	return sum
}

func usecase(c Color) int {
	switch c {
	case Red:
		return Limit
	default:
		return Global
	}
}

func usetmpl() int {
	return identity[int](Global)
}

func identity[T any](v T) T {
	return v
}

func hiddenHelper() int {
	return 1
}

func ShownCaller() int {
	return hiddenHelper() + takes(Global)
}

type Ordered interface {
	~int | ~string
}

type AnyValue interface {
	int | string
}

// GO9 (second review): assignment LHS is a WRITE — single, multi and
// compound targets alike (`a, b = 1, 2` with no reads emits nothing;
// index bases/indices still read).
var wa int
var wb int

func writeonly() {
	wa, wb = 1, 2
}

func writeplain() {
	wa = 3
}

// GO10 (second review): only parameter NAMES bind — an array length is a
// value read (`f(a [N]int)` reads the file const N).
const N = 10

func sized(a [N]int) int {
	return N
}

// GO11 (second review): map-literal keys are key expressions and read
// (`Red: 1` reads the file const); struct-literal keys never do.
type Color int

const Red Color = 1

type Point struct {
	X int
}

func keyed() int {
	m := map[Color]int{Red: 1}
	p := Point{X: m[Red]}
	return p.X
}
