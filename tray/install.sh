#!/bin/bash
# Builds and installs the menu-bar app, then starts it (start.sh, or the tray itself after an update).
#
#   tray/install.sh <clone>                 build, install and start
#   tray/install.sh <clone> --login         first install: launch at login (the default)
#   tray/install.sh <clone> --no-login      first install: no launch at login
#   tray/install.sh <clone> --build-only    compile only, install nothing (start.sh asks its question after it)
#
# The LaunchAgent (launch at login) is decided on the first install only: later installs keep the user's choice
# and ignore --login / --no-login.
# A build failure ends on one line and exit 1 before anything installed is touched: the running tray stays.
# The (re)start comes last, because it kills the running tray, which may be the reader of our output; the new
# tray terminates any older one still running.

set -uo pipefail
trap '' PIPE

USAGE="Usage : tray/install.sh <clone> [--login | --no-login | --build-only]"
[ $# -ge 1 ] && [ $# -le 2 ] && [ -d "$1" ] || { echo "$USAGE" >&2; exit 2; }
MODE="${2:---login}"
case "$MODE" in --login | --no-login | --build-only) ;; *) echo "$USAGE" >&2; exit 2 ;; esac
CLONE="$(cd "$1" && pwd -P)"

LABEL="com.villeco.pr-review-desk.tray"
APPS="$HOME/Applications"
APP="$APPS/PR Review Desk.app"
SUPPORT="$HOME/Library/Application Support/PR Review Desk"
AGENT="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

fail() {
  echo "$*" >&2
  exit 1
}

swift build -c release --package-path "$CLONE/tray" ||
  fail "Le tray n'a pas pu être compilé (Command Line Tools de Xcode absents ou trop anciens ?) : xcode-select --install, ou mets-les à jour dans Réglages Système > Mise à jour de logiciels"
BIN="$(swift build -c release --package-path "$CLONE/tray" --show-bin-path)/DeskTray"
[ -x "$BIN" ] || fail "Le tray compilé est introuvable : $BIN"
[ "$MODE" != "--build-only" ] || exit 0
TREE="$(git -C "$CLONE" rev-parse HEAD:tray 2>/dev/null)" || fail "$CLONE n'est pas un clone git du Desk."

# The bundle is assembled next to its destination (same volume), so the swap is two renames.
mkdir -p "$APPS" || fail "Impossible de créer $APPS"
STAGE="$(mktemp -d "$APPS/.PR Review Desk.XXXXXX")" || fail "Impossible de créer un dossier temporaire dans $APPS"
trap 'rm -rf "$STAGE"' EXIT
NEW="$STAGE/PR Review Desk.app"
mkdir -p "$NEW/Contents/MacOS" "$NEW/Contents/Resources" &&
  cp "$BIN" "$NEW/Contents/MacOS/DeskTray" &&
  chmod 755 "$NEW/Contents/MacOS/DeskTray" &&
  cp "$CLONE/tray/Resources/Info.plist" "$NEW/Contents/Info.plist" &&
  cp "$CLONE/tray/Resources/AppIcon.icns" "$NEW/Contents/Resources/AppIcon.icns" ||
  fail "L'assemblage de l'app a échoué."
codesign --force -s - "$NEW" || fail "La signature de l'app a échoué."

FIRST_INSTALL=1
if [ -e "$APP" ]; then
  FIRST_INSTALL=""
  mv "$APP" "$STAGE/ancienne.app" || fail "Impossible de remplacer $APP"
fi
if ! mv "$NEW" "$APP"; then
  [ -n "$FIRST_INSTALL" ] || mv "$STAGE/ancienne.app" "$APP"
  fail "Impossible d'installer $APP"
fi

json_string() {
  printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"
}
mkdir -p "$SUPPORT" &&
  printf '{"clonePath": %s, "trayTree": %s}\n' "$(json_string "$CLONE")" "$(json_string "$TREE")" >"$SUPPORT/config.json.tmp" &&
  mv "$SUPPORT/config.json.tmp" "$SUPPORT/config.json" ||
  fail "Impossible d'écrire $SUPPORT/config.json"

write_agent() {
  local program
  program="$(printf '%s' "$APP/Contents/MacOS/DeskTray" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g')"
  mkdir -p "$(dirname "$AGENT")" && cat >"$AGENT.tmp" <<EOF && mv "$AGENT.tmp" "$AGENT"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>$LABEL</string>
	<key>ProgramArguments</key>
	<array>
		<string>$program</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<false/>
</dict>
</plist>
EOF
}

if [ -n "$FIRST_INSTALL" ] && [ "$MODE" = "--login" ]; then
  write_agent || fail "Impossible d'écrire $AGENT"
elif [ -n "$FIRST_INSTALL" ]; then
  # A LaunchAgent left behind by a deleted bundle would contradict the no just given.
  rm -f "$AGENT" || fail "Impossible de supprimer $AGENT"
fi
if [ ! -f "$AGENT" ]; then
  # Launch at login turned off: nothing for launchd to start.
  open -n "$APP" || fail "Impossible d'ouvrir $APP"
elif launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  launchctl kickstart -k "$DOMAIN/$LABEL" || fail "launchctl kickstart a échoué."
else
  launchctl bootstrap "$DOMAIN" "$AGENT" || fail "launchctl bootstrap a échoué."
fi
