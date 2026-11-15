package genconstruct

type Box[T any] struct {
	v T
}

const DefaultSize = 8

func MakeBox() Box[int] {
	return Box[int]{v: DefaultSize}
}
