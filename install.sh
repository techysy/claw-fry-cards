#!/usr/bin/env bash
# 🍤 claw-fry-cards — one-line installer
#
#   curl -fsSL https://raw.githubusercontent.com/techysy/claw-fry-cards/main/install.sh | bash
#
# What it does:
#   1. Locates an OpenClaw CLI (OPENCLAW_BIN override → `openclaw` on PATH → `npx` fallback)
#   2. Installs the plugin from npm (FRY_VERSION override, default: latest)
#   3. Verifies the plugin shows up in `openclaw plugins list`
#
# It does NOT restart the gateway — run `openclaw gateway restart` yourself.
# A restart may kill the process running this script if it was launched from
# inside a gateway turn (e.g. by an agent mid-conversation).
#
# Env overrides:
#   OPENCLAW_BIN=/path/to/openclaw   skip auto-detection
#   FRY_VERSION=2.0.4                install a specific version (default: latest)
set -euo pipefail

REPO="techysy/claw-fry-cards"
PKG="claw-fry-cards"
VERSION="${FRY_VERSION:-}"

say()  { printf '\033[1;36m▸\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- OpenClaw CLI
declare -a OC=()

find_openclaw() {
  if [ -n "${OPENCLAW_BIN:-}" ]; then
    [ -x "$OPENCLAW_BIN" ] || die "OPENCLAW_BIN is not executable: $OPENCLAW_BIN"
    OC=("$OPENCLAW_BIN"); return
  fi

  if command -v openclaw >/dev/null 2>&1; then
    OC=(openclaw); return
  fi

  # npm users without a global CLI can still drive OpenClaw through npx.
  if command -v npx >/dev/null 2>&1; then
    OC=(npx -y openclaw); return
  fi

  die "OpenClaw CLI not found. Install OpenClaw first, or set OPENCLAW_BIN=/path/to/openclaw"
}

find_openclaw
SPEC="$PKG${VERSION:+@$VERSION}"

say "OpenClaw CLI: ${OC[*]}"
say "installing $SPEC (npm)"
"${OC[@]}" plugins install "$SPEC" --force --accept-capabilities

# ---------------------------------------------------------------- verify
if "${OC[@]}" plugins list 2>/dev/null | grep -q "$PKG"; then
  ok "$PKG installed and registered"
  VERSION_INSTALL="latest"; [ -n "$VERSION" ] && VERSION_INSTALL="$VERSION"
  ok "installed: $VERSION_INSTALL"
else
  warn "install command finished but plugin not found in plugins list — check the output above"
  exit 1
fi

warn "not restarting the gateway — run \`${OC[*]} gateway restart\` yourself"
say "done. Next: see https://github.com/$REPO#-配置 for channel config (appId/appSecret + streaming)"
