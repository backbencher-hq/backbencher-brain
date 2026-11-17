#!/usr/bin/env bash
# Re-create the JavaScript measurement corpus under .corpus/ at the EXACT commits the
# verification pages were measured against. The corpus is gitignored, so it CAN be deleted by
# any cleanup of this shared checkout — it was deleted once during the campaign, which is why
# this script exists: recovery must be one command, not a research task.
#
#   bash script/m14/clone-js-corpus.sh [--dest=.corpus]
set -u
DEST=".corpus"
for a in "$@"; do case "$a" in --dest=*) DEST="${a#--dest=}";; esac; done
mkdir -p "$DEST"
clone_at() { name="$1"; url="$2"; commit="$3"; if [ -d "$DEST/$name/.git" ]; then echo "  $name present"; return; fi; if git clone --depth 1 --single-branch --quiet "$url" "$DEST/$name" 2>/dev/null; then if [ -n "$commit" ] && ! git -C "$DEST/$name" reset --hard "$commit" --quiet 2>/dev/null; then echo "  $name WARN: cloned but could not reset to $commit (shallow clone)"; else echo "  $name $(git -C "$DEST/$name" rev-parse --short HEAD)"; fi; else echo "  $name FAILED"; fi; }
clone_at "axios" "https://github.com/axios/axios.git" "c0d4c900515a55bd1e258eee16adb25c404d56ed"
clone_at "bootstrap" "https://github.com/twbs/bootstrap" "c1f9b9db4dd14d5353e34462ec589cdf8c7270d3"
clone_at "chartjs" "https://github.com/chartjs/Chart.js.git" "56682e54a082bc7a83d4e3c04f779ef0e0021a4f"
clone_at "consul" "https://github.com/hashicorp/consul.git" "913703ef5dfdb325536820a30fb039a683fa0b21"
clone_at "express" "https://github.com/expressjs/express.git" "43fca52d28a422c8be48fd489cbd4f2d6152bab6"
clone_at "jquery" "https://github.com/jquery/jquery.git" "6ff7ce6ff3e66ea3c99713238bf0ade6b103b3c3"
clone_at "lodash" "https://github.com/lodash/lodash.git" "a666ba591064c8011988275790ad7d625279f09c"
clone_at "moment" "https://github.com/moment/moment.git" "c2a703a4d84aa57ee2722ff8fb4a8016279fb3c4"
clone_at "mongoose" "https://github.com/Automattic/mongoose.git" "a8204d30c4db4ba1138bc75a879c79cf5127670d"
clone_at "nomad" "https://github.com/hashicorp/nomad.git" "3a9af341c94ee3b08826f8057195e11ef55cd6d7"
clone_at "preact" "https://github.com/preactjs/preact.git" "34b99c691166a28fffcb8e279c79a1669156552f"
clone_at "prettier" "https://github.com/prettier/prettier.git" "3c329a708d715932b7a71195f6bb20a2feac2db5"
clone_at "proxicall" "https://github.com/ishaq2321/ProxiCall.git" "3b6ebd409f1b1d235776cd72d3ad0809992ed060"
clone_at "ramda" "https://github.com/ramda/ramda.git" "f4b2e35ff433e18c751326b82acc3c6ab3585e18"
clone_at "react" "https://github.com/facebook/react.git" "6ff257439b3919fc8dcc643b635e09d62fa74d0e"
clone_at "socket.io" "https://github.com/socketio/socket.io.git" "cbbcb195f8230560d65231e24f9242f0e4f7c710"
clone_at "svelte" "https://github.com/sveltejs/svelte.git" "26786e92985842a6d563c67049a43bc5857bf792"
clone_at "three" "https://github.com/mrdoob/three.js.git" "fad374c211d3fd8759cebe41f09e40975a6de04b"
clone_at "underscore" "https://github.com/jashkenas/underscore.git" "5c1e5f686f8500af9c9d15614ed60289d6d35d6b"
clone_at "vault" "https://github.com/hashicorp/vault.git" "c848fd3dc7d44fc1fe8edc7eb4e193db1da1a323"
clone_at "vue" "https://github.com/vuejs/vue.git" "9e88707940088cb1f4cd7dd210c9168a50dc347c"
clone_at "webpack" "https://github.com/webpack/webpack.git" "df7ef44f1e990f4d579bc74f45444b9b3eb7b392"
