package fixture

func target(x int) int {
	return x + 1
}

func helper() int {
	return target(1)
}
