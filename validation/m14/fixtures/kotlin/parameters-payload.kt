class ParamSvc {
    fun apply(amount: Double, percent: Int): Double = amount * (1 - percent / 100)

    fun join(vararg parts: String): String = parts.joinToString(",")
}
