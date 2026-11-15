package p

interface IRenderer<T> {
    fun render(value: T?): String
}

abstract class Base<T> : IRenderer<T> {
    fun label(): String {
        return "base"
    }
}

class Impl : Base<Int>() {
    override fun render(value: Int?): String {
        return ""
    }
}

class ByteImpl : Base<Byte>() {
    override fun render(value: Byte?): String {
        return ""
    }
}

interface IConverter {
    fun convert(value: Int?): String
}

class StrictConverter : IConverter {
    override fun convert(value: String?): String {
        return ""
    }
}
