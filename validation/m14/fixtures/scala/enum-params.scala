enum Planet(val mass: Double) {
  case Earth extends Planet(5.9)
  case Mars extends Planet(0.6)
}

object Planet {
  def of(m: Double): Planet = Planet(mass = m)
}
