package p

@org.springframework.stereotype.Service
class FqController {

    @org.springframework.web.bind.annotation.GetMapping("/users")
    fun users(): String = "u"
}
