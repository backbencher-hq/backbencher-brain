package com.acme.claim

import kotlin.math.abs

fun abs(x: Int): Int = x

fun useShadowed(): Int = abs(1)
