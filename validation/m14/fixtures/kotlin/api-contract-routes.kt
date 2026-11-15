package com.acme.core

class UserController {
    @GetMapping("/users")
    fun list(): String = "ok"

    @RequestMapping(value = "/items", method = RequestMethod.POST)
    fun items(): String = "ok"
}
