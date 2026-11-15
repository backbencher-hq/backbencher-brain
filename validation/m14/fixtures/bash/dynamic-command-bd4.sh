#!/usr/bin/env bash
# BD4: a command word that is an unexpanded expression is not a call to a name.
# The pre-wave analyzer emitted `calls: -> "${dotnetPath}"` — a target no symbol
# can ever have. The read of the deciding variable is real and survives.

dotnetPath=/usr/bin/dotnet
pkg_mgr=apt-get

"$dotnetPath" --info
$pkg_mgr install curl
/usr/bin/env true
