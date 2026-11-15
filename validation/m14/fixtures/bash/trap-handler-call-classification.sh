#!/usr/bin/env bash
# Round 7: a trap handler's `calls` edge is a call, and it was the ONE call the
# analyzer published without saying whether the callee leaves the file.
#
# Two emission sites write `RelationshipType.Calls`. The main command site sets
# `isFunctionCall`/`isExternalCommand`/`resolvedWithinFile` on all 54,995 corpus
# edges; the trap site set none of them, so 223 edges — 123 of which name a
# function THIS file declares — arrived with no classification at all.
#
# The fixture pins both directions, because a fix that hard-coded either value
# would satisfy one half of it:
#
#   line 33  handler calls `cleanup`, declared ABOVE -> local
#   line 34  handler calls `rm`, never declared       -> external
#   line 35  handler calls `log` (declared above) and `sync_now` (declared
#            ABOVE TOO, but the trap reads like a call-before-definition case to
#            anyone implementing this with a walk instead of the pre-pass) -> both local
#   line 36  same two names a second time, so the classification is a property of
#            the NAME and not of the site

cleanup() {
  echo bye
}

log() {
  echo "$1"
}

sync_now() {
  echo syncing
}

trap 'cleanup' EXIT
trap 'rm -f "$1"' ERR
trap 'log interrupted; sync_now' TERM
trap 'cleanup; sync_now' HUP