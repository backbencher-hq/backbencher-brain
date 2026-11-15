package com.acme.helpers

import kotlin.math.abs

fun clamp(value: Int, lo: Int, hi: Int): Int = if (value < lo) lo else if (value > hi) hi else value

val DEFAULT_LIMIT: Int = 100

private val internalCounter = 0

fun helper(): Int = abs(DEFAULT_LIMIT)