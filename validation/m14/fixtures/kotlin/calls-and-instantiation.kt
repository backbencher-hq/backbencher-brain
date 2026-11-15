package com.acme.core

class Factory {
    fun make(): MutableList<Int> {
        val list = ArrayList<Int>()
        list.add(1)
        return list
    }

    fun helper() {}
    
    fun caller() {
        helper()
        make()
    }
}
