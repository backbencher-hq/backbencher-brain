interface Runner {
    fun go()
}

class P {
    fun run() {
        val r = object : Runner {
            override fun go() {
                println("hi")
            }
        }
        r.go()
    }
}
