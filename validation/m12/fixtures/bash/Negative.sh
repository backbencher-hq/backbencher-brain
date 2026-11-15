#!/bin/bash
valid_fn() {
  echo "ok"
}
broken_fn() {
  echo "unclosed quote
}
