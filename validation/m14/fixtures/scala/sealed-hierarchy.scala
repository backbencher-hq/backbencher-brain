package com.acme.core

sealed trait Result
case class Success(value: String) extends Result
case class Failure(error: String) extends Result
