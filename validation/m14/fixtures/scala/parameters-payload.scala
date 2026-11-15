class ParamSvc {
  def apply(amount: Double, percent: Int): Double = amount * (1 - percent / 100)

  def join(parts: String*): String = parts.mkString(",")
}
