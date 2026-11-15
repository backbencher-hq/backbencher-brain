// M49/M37 #867 fixture, second defect class found by the same corpus sweep.
// The analyzer gives import references the placeholder source "root" and then
// rewrites them onto the file's primary top-level TYPE. The candidate search
// only asked "no ownerName && kind is class/interface/enum", so a top-level
// function's anonymous object — which had NO owner before the #867 ruling —
// became the file's primary type and claimed every import edge of the file
// (measured: kotlinx-coroutines/reactor/Flux.kt, 8 import edges attributed to
// anonymous_Subscription). This file has NO top-level class, so the correct
// answer is the "root" placeholder itself; the anon type must never take it.

package com.acme.hasno

import kotlin.coroutines.Continuation

fun topLevel(): Continuation<Unit>? {
    val r = object : Runnable {
        override fun run() { }
    }
    return null
}
