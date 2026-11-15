#!/usr/bin/env bash
# Backbencher (bb) installer — https://backbencher.cc/install.sh
#
# Two install channels, in this order:
#   1. npm — `npm install -g @backbencher/brain`. This is the PRIMARY path: it is
#      the artifact every release publishes, so the binary and the package can
#      never disagree about the version.
#   2. GitHub release binary — only when npm is unavailable, or when the caller
#      asks for it with BB_INSTALL_CHANNEL=release. The asset must exist for
#      this OS/arch AND be covered by the release's checksums.txt; an
#      unverified binary is never installed silently.
#
# Pinning: `VERSION=0.1.0 curl -fsSL … | bash` installs that exact npm version
# (or that exact git tag if the release channel is used). Unset VERSION means
# "the current release". Force one channel with BB_INSTALL_CHANNEL=npm|release.
# Set BB_ALLOW_UNVERIFIED=1 only if you deliberately accept a binary that the
# release did not checksum.
#
# Every failure names the exact URL or command that was tried.

set -euo pipefail

# An empty VERSION means "the current release"; a non-empty one pins it.
PINNED=0
if [ -n "${VERSION:-}" ]; then PINNED=1; fi
# The release this installer was cut for. Keep in step with package.json:
# script/m41/generate-site-truth.ts parses this line for the install page.
VERSION="${VERSION:-}"
REPO="backbencher-hq/backbencher-brain"
NPM_PACKAGE="@backbencher/brain"
INSTALL_DIR="${HOME}/.local/bin"
CHANNEL="${BB_INSTALL_CHANNEL:-auto}"

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

HAVE_CURL=0
HAVE_WGET=0
if command -v curl >/dev/null 2>&1; then HAVE_CURL=1; fi
if command -v wget >/dev/null 2>&1; then HAVE_WGET=1; fi

fail() {
    echo "" >&2
    echo "install.sh: $1" >&2
    shift || true
    for line in "$@"; do
        echo "  $line" >&2
    done
    exit 1
}

# download <url> <dest> — silent on failure, caller decides the message.
download() {
    if [ "$HAVE_CURL" = 1 ]; then
        curl -fsSL "$1" -o "$2" 2>/dev/null
    elif [ "$HAVE_WGET" = 1 ]; then
        wget -q "$1" -O "$2" 2>/dev/null
    else
        return 127
    fi
}

# fetch_stdout <url> — prints the body; caller decides the message on failure.
fetch_stdout() {
    if [ "$HAVE_CURL" = 1 ]; then
        curl -fsSL "$1" 2>/dev/null
    elif [ "$HAVE_WGET" = 1 ]; then
        wget -q "$1" -O - 2>/dev/null
    else
        return 127
    fi
}

sha256_of() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | awk '{print $1}'
    else
        return 1
    fi
}

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$ARCH" in
    x86_64)        ARCH_NAME="x64" ;;
    aarch64|arm64) ARCH_NAME="arm64" ;;
    *) fail "unsupported architecture: ${ARCH}" \
            "Prebuilt binaries cover x86_64 and arm64." \
            "Install from npm instead: npm install -g ${NPM_PACKAGE}" ;;
esac

case "$OS" in
    Linux)  OS_NAME="linux" ;;
    Darwin) OS_NAME="darwin" ;;
    *) fail "unsupported operating system: ${OS}" \
            "install.sh covers Linux and macOS. Windows: irm https://backbencher.cc/install.ps1 | iex" \
            "Any OS with Node >= 18: npm install -g ${NPM_PACKAGE}" ;;
esac

BINARY_NAME="bb-${OS_NAME}-${ARCH_NAME}"

echo "Installing Backbencher (bb) for ${OS_NAME}-${ARCH_NAME}…"

# ---------------------------------------------------------------------------
# Channel 1 (primary): npm. Version-exact, no platform assets to go missing.
# ---------------------------------------------------------------------------
install_via_npm() {
    local spec
    if [ "$PINNED" = 1 ]; then
        spec="${NPM_PACKAGE}@${VERSION}"
    else
        spec="${NPM_PACKAGE}@latest"
    fi
    echo "Installing ${spec} with npm…"
    npm install -g "$spec"
}

install_via_release() {
    local tag url checksums_url expected actual
    if [ "$PINNED" = 1 ]; then
        tag="v${VERSION}"
    else
        local api="https://api.github.com/repos/${REPO}/releases/latest"
        local json
        if ! json="$(fetch_stdout "$api")"; then
            fail "no published GitHub release found for ${REPO} (${api})" \
                "Install from npm instead: npm install -g ${NPM_PACKAGE}@latest" \
                "Or build from source: https://github.com/${REPO}#from-source"
        fi
        tag="$(printf '%s' "$json" | tr ',' '\n' | awk -F'"' '/tag_name/ {print $4; exit}')"
        if [ -z "$tag" ]; then
            fail "could not read a release tag from ${api}" \
                "Install from npm instead: npm install -g ${NPM_PACKAGE}@latest"
        fi
    fi

    url="https://github.com/${REPO}/releases/download/${tag}/${BINARY_NAME}"
    checksums_url="https://github.com/${REPO}/releases/download/${tag}/checksums.txt"

    if ! download "$url" "${TEMP_DIR}/${BINARY_NAME}"; then
        local hint="Install from npm instead: npm install -g ${NPM_PACKAGE}"
        if [ "$PINNED" = 1 ]; then hint="${hint}@${VERSION}"; else hint="${hint}@latest"; fi
        fail "no prebuilt ${OS_NAME}-${ARCH_NAME} binary at ${url}" \
            "$hint" \
            "Or build from source: https://github.com/${REPO}#from-source"
    fi

    if ! download "$checksums_url" "${TEMP_DIR}/checksums.txt"; then
        if [ "${BB_ALLOW_UNVERIFIED:-0}" = "1" ]; then
            echo "WARNING: ${tag} publishes no checksums.txt — installing an UNVERIFIED binary (BB_ALLOW_UNVERIFIED=1)." >&2
        else
            fail "release ${tag} has no checksums.txt (${checksums_url}); refusing to install an unverified binary" \
                "Install from npm instead: npm install -g ${NPM_PACKAGE}" \
                "Override deliberately with BB_ALLOW_UNVERIFIED=1"
        fi
    else
        expected="$(awk -v name="$BINARY_NAME" '$2 == name { print $1; exit }' "${TEMP_DIR}/checksums.txt")"
        if [ -z "$expected" ]; then
            fail "checksums.txt in ${tag} has no entry for ${BINARY_NAME}; refusing to install an unverified binary" \
                "Released checksums: ${checksums_url}" \
                "Install from npm instead: npm install -g ${NPM_PACKAGE}"
        fi
        if ! actual="$(sha256_of "${TEMP_DIR}/${BINARY_NAME}")"; then
            fail "no sha256sum/shasum available to verify ${url}" \
                "Install from npm instead: npm install -g ${NPM_PACKAGE}" \
                "Override deliberately with BB_ALLOW_UNVERIFIED=1"
        fi
        if [ "$expected" != "$actual" ]; then
            fail "checksum verification failed for ${url}" \
                "expected sha256 ${expected}" \
                "got      sha256 ${actual}"
        fi
        echo "Checksum verified (sha256 ${expected})."
    fi

    mkdir -p "$INSTALL_DIR"
    mv "${TEMP_DIR}/${BINARY_NAME}" "${INSTALL_DIR}/bb"
    chmod +x "${INSTALL_DIR}/bb"
    INSTALLED_VIA="release"
}

INSTALLED_VIA=""

case "${CHANNEL}" in
    npm)
        command -v npm >/dev/null 2>&1 \
            || fail "BB_INSTALL_CHANNEL=npm but npm is not on PATH" \
                    "Install Node.js >= 18 (https://nodejs.org) and re-run." \
                    "Or use a release binary: BB_INSTALL_CHANNEL=release curl -fsSL https://backbencher.cc/install.sh | bash"
        install_via_npm || fail "npm install -g ${NPM_PACKAGE} failed (see npm output above)"
        INSTALLED_VIA="npm"
        ;;
    release)
        install_via_release
        ;;
    auto|"")
        if command -v npm >/dev/null 2>&1; then
            if install_via_npm; then
                INSTALLED_VIA="npm"
            else
                echo "npm install failed; falling back to a GitHub release binary." >&2
                install_via_release
            fi
        else
            echo "npm is not on PATH; using a GitHub release binary instead." >&2
            install_via_release
        fi
        ;;
    *)
        fail "unknown BB_INSTALL_CHANNEL='${CHANNEL}'" \
            "Accepted values: auto (default), npm, release."
        ;;
esac

echo ""

# Create default config with bb_* tool permissions (no TUI permission prompts)
CONFIG_DIR="$HOME/.config/opencode"
CONFIG_FILE="$CONFIG_DIR/opencode.json"
mkdir -p "$CONFIG_DIR"
if [ ! -f "$CONFIG_FILE" ]; then
  cat > "$CONFIG_FILE" << 'CONFEOF'
{
  "$schema": "https://backbencher.cc/config.json",
  "permission": {
    "bb_search": "allow",
    "bb_ask": "allow",
    "bb_analyze": "allow",
    "bb_graph": "allow",
    "bb_impact": "allow",
    "bb_visualize": "allow",
    "bb_patterns": "allow",
    "bb_security": "allow",
    "bb_doc": "allow",
    "bb_cross_language": "allow",
    "bb_migrate": "allow",
    "bb_health": "allow",
    "bb_index": "allow",
    "bb_edit": "allow",
    "bb_annotate": "allow",
    "bb_annotations": "allow"
  }
}
CONFEOF
  echo "Default config created with bb_* tool permissions"
else
  # Merge bb_* permissions into existing config
  TMPFILE=$(mktemp)
  node -e "
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync('$CONFIG_FILE','utf8'));
    cfg.permission = cfg.permission || {};
    // The 16 public tools this release serves.
    const tools = ['bb_search','bb_ask','bb_analyze','bb_graph','bb_impact','bb_visualize','bb_patterns','bb_security','bb_doc','bb_cross_language','bb_migrate','bb_health','bb_index','bb_edit','bb_annotate','bb_annotations'];
    // Pre-public aliases are gone; stale entries make agents call dead names.
    const legacy = ['bb_select','bb_relationships','bb_update','bb_delete','bb_insert','bb_write','bb_refresh','bb_refactor','bb_test_quality','bb_test_suggestions'];
    tools.forEach(t => { if (!cfg.permission[t]) cfg.permission[t] = 'allow'; });
    legacy.forEach(t => { delete cfg.permission[t]; });
    fs.writeFileSync('$TMPFILE', JSON.stringify(cfg, null, 2));
  " 2>/dev/null && mv "$TMPFILE" "$CONFIG_FILE" || echo "Skipped config merge (no node)"
fi

echo ""
if [ "${INSTALLED_VIA}" = "npm" ]; then
    if command -v bb >/dev/null 2>&1; then
        echo "✅ Installed via npm. Run: bb --version"
    else
        NPM_PREFIX="$(npm prefix -g 2>/dev/null || echo "your npm global prefix")"
        echo "✅ Installed via npm."
        echo "   bb is not on PATH yet — add ${NPM_PREFIX}/bin to PATH, then run: bb --version"
    fi
else
    echo "✅ Installed to ${INSTALL_DIR}/bb"
    case ":${PATH}:" in
        *":${INSTALL_DIR}:"*) echo "Run: bb --version" ;;
        *) echo "Add ${INSTALL_DIR} to your PATH, then run: bb --version" ;;
    esac
fi
