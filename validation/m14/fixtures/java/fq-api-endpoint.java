package com.acme.web;

@org.springframework.web.bind.annotation.RestController
public class FqApiController {

    private final FqApiController self = this;

    @org.springframework.web.bind.annotation.RequestMapping("/api")
    public void base() { }

    @org.springframework.web.bind.annotation.GetMapping("/users")
    public java.util.List<String> users() {
        return null;
    }
}
