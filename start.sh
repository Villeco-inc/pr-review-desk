#!/bin/bash
# Starts pr-review-desk in Docker. Checks Docker, installs gh and claude on a Mac when asked,
# logs in to GitHub, asks once for the Claude token, then starts the container.
#
#   ./start.sh                  use the active gh account
#   ./start.sh --user <login>   use another account gh is logged in to, and remember it in .desk/gh-user
#   ./start.sh --no-prompt      never read stdin: every question is a no, and every failure ends on one
#                               "✗ …" line with exit 1 (the menu-bar app shows that line)
#   ./start.sh --tray           (re)install the menu-bar app without asking whether to, from the main clone on
#                               main (a first install still asks whether to launch it at login)
#
# Each step is explained before anything is installed or opened in a browser. Colours, boxes and the animated
# build line are for a terminal only (not with NO_COLOR, TERM=dumb or --no-prompt); the build output goes to
# .desk/start.log.
#
# The GitHub token is read from gh at each start and handed to Docker; it is never written to a file
# (only the login goes into .desk/gh-user).

set -u
cd "$(dirname "$0")" || exit 1

# The login of the last --user, so a restart (or the tray) keeps the same account.
DESK_DIR=".desk"
SAVED_GH_USER=""
[ -f "$DESK_DIR/gh-user" ] && SAVED_GH_USER="$(head -n 1 "$DESK_DIR/gh-user" | tr -d '[:space:]')"

GH_USER=""
NO_PROMPT=""
TRAY_FORCE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --user)
      [ $# -ge 2 ] || { echo "Usage : ./start.sh [--user <login>] [--no-prompt] [--tray]" >&2; exit 2; }
      GH_USER="$2"
      shift 2
      ;;
    --no-prompt)
      NO_PROMPT=1
      shift
      ;;
    --tray)
      TRAY_FORCE=1
      shift
      ;;
    *)
      echo "Option inconnue : $1" >&2
      echo "Usage : ./start.sh [--user <login>] [--no-prompt] [--tray]" >&2
      exit 2
      ;;
  esac
done
# Whether the login comes from .desk/gh-user rather than from --user on this run (for the error message).
GH_USER_SAVED=""
[ -z "$GH_USER" ] && [ -n "$SAVED_GH_USER" ] && GH_USER_SAVED=1
GH_USER="${GH_USER:-$SAVED_GH_USER}"

LOCAL_BIN="$HOME/.local/bin"
CLAUDE_INSTALL="curl -fsSL https://claude.ai/install.sh | bash"
GH_INSTALL_LINUX="https://github.com/cli/cli/blob/trunk/docs/install_linux.md"
OS="$(uname -s)"

# Colours, boxes and animation are for a person at a terminal. DESK_UI=rich stands in for the terminal in tests.
UI="plain"
if [ -z "$NO_PROMPT" ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-}" != "dumb" ] && { [ -t 1 ] || [ "${DESK_UI:-}" = "rich" ]; }; then
  UI="rich"
fi
if [ "$UI" = "rich" ]; then
  BOLD=$'\033[1m' DIM=$'\033[2m' GREEN=$'\033[32m' YELLOW=$'\033[33m' CYAN=$'\033[36m' RESET=$'\033[0m'
  COLS="${COLUMNS:-$(tput cols 2>/dev/null)}"
  case "$COLS" in '' | *[!0-9]*) COLS=80 ;; esac
else
  BOLD="" DIM="" GREEN="" YELLOW="" CYAN="" RESET=""
fi

fail() {
  echo "✗ $*" >&2
  exit 1
}

# Display width of $1 in VLEN, whatever the locale: UTF-8 continuation bytes take no column, ✨ takes two.
vlen() {
  local LC_ALL=C
  local s="${1//[$'\200'-$'\277']/}"
  VLEN=${#s}
  case "$1" in *✨*) VLEN=$((VLEN + 1)) ;; esac
}

# box <colour> <title> [paragraph…]: a framed block at a terminal, the same words as plain lines elsewhere.
box() {
  local colour="$1" title="$2" width line word lines=() n
  shift 2
  LIST_SHOWN=""
  echo
  if [ "$UI" != "rich" ]; then
    [ -z "$title" ] || echo "$title"
    for line in "$@"; do echo "$line"; done
    return
  fi
  width=$((COLS - 4))
  [ "$width" -le 66 ] || width=66
  [ -z "$title" ] || lines+=("$BOLD$title$RESET")
  for line in "$@"; do
    local current=""
    set -f
    for word in $line; do
      vlen "$current $word"
      if [ -n "$current" ] && [ "$VLEN" -gt "$width" ]; then
        lines+=("$current")
        current="$word"
      else
        current="${current:+$current }$word"
      fi
    done
    set +f
    lines+=("$current")
  done
  printf '%s╭%s╮%s\n' "$colour" "$(printf '─%.0s' $(seq 1 $((width + 2))))" "$RESET"
  for line in "${lines[@]}"; do
    vlen "$line"
    n=$VLEN
    case "$line" in "$BOLD"*) vlen "$BOLD$RESET"; n=$((n - VLEN)) ;; esac
    printf '%s│%s %s%*s %s│%s\n' "$colour" "$RESET" "$line" $((width - n)) "" "$colour" "$RESET"
  done
  printf '%s╰%s╯%s\n' "$colour" "$(printf '─%.0s' $(seq 1 $((width + 2))))" "$RESET"
}

explain() {
  box "$CYAN" "" "$@"
}

# ask <question> [no]: Enter says yes, unless "no" makes no the default. Without stdin (or with --no-prompt) it is a no.
ask() {
  [ -z "$NO_PROMPT" ] || return 1
  local reply="" default="${2:-yes}" hint="[O/n]"
  [ "$default" = "yes" ] || hint="[o/N]"
  LIST_SHOWN=""
  while :; do
    printf '%s%s%s %s ' "$BOLD" "$1" "$RESET" "$hint"
    IFS= read -r reply || { echo; return 1; }
    # A terminal echoes the answer; piped answers are echoed here, so the next line does not overwrite the question.
    [ "$UI" != "rich" ] || [ -t 0 ] || echo "$reply"
    # A typo (a zero for the O of [O/n], a stray space) asks again rather than counting as no.
    case "$(printf '%s' "$reply" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')" in
      o | oui | y | yes) return 0 ;;
      n | non | no) return 1 ;;
      "") [ "$default" = "yes" ]; return ;;
      *) say "Réponds o (oui) ou n (non)." ;;
    esac
  done
}

say() {
  LIST_SHOWN=""
  echo "$@"
}

warn() {
  LIST_SHOWN=""
  echo "$@" >&2
}

# The steps of a run. A first run shows them as a list (redrawn in place while nothing else was printed below it);
# a later run shows one line of checks.
S_DOCKER=0 S_GITHUB=1 S_CLAUDE=2 S_DESK=3 S_TRAY=4
STEP_NAMES=(Docker GitHub Claude Desk "Barre de menus")
STEP_STATES=(todo todo todo todo todo)
STEP_NOTES=("" "" "" "" "")
STEP_COUNT=4
FIRST_RUN=""
LIST_SHOWN=""

steps_show() {
  local i marker
  if [ -n "$LIST_SHOWN" ]; then printf '\033[%dA' "$STEP_COUNT"; else echo; fi
  for ((i = 0; i < STEP_COUNT; i++)); do
    case "${STEP_STATES[$i]}" in
      done) marker="${GREEN}●$RESET" ;;
      doing) marker="${YELLOW}◐$RESET" ;;
      skip) marker="${DIM}–$RESET" ;;
      *) marker="${DIM}○$RESET" ;;
    esac
    printf '\r\033[K  %s %-16s%s%s%s\n' "$marker" "${STEP_NAMES[$i]}" "$DIM" "${STEP_NOTES[$i]}" "$RESET"
  done
  LIST_SHOWN=1
}

step_begin() {
  STEP_STATES[$1]="doing"
  [ "$UI" != "rich" ] || [ -z "$FIRST_RUN" ] || [ -z "$LIST_SHOWN" ] || steps_show
}

# step_end <step> <done|skip> <note>
step_end() {
  STEP_STATES[$1]="$2"
  STEP_NOTES[$1]="$3"
  if [ "$UI" = "rich" ] && [ -n "$FIRST_RUN" ]; then
    steps_show
  elif [ -n "$FIRST_RUN" ] || [ "$1" -ge "$S_DESK" ]; then
    [ "$UI" = "rich" ] && [ "$1" -eq "$S_DESK" ] && return
    if [ "$2" = "done" ]; then say "${GREEN}✓$RESET ${STEP_NAMES[$1]} : $3"; else say "– ${STEP_NAMES[$1]} : $3"; fi
  fi
}

# The later-run summary of the checks: "✓ Docker · ✓ GitHub · ✓ Claude".
checks_line() {
  local i line=""
  for ((i = 0; i < S_DESK; i++)); do line="$line${line:+ · }${GREEN}✓$RESET ${STEP_NAMES[$i]}"; done
  [ -z "$TRAY_STEP" ] || [ ! -d "$TRAY_APP" ] || line="$line · ${GREEN}✓$RESET ${STEP_NAMES[$S_TRAY]}"
  say "$line"
}

# Long commands write to the log; the terminal gets one animated line (spinner, step, progress, time).
LOG="$DESK_DIR/start.log"
SPINNER=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏)

# "42 s" or "1 min 12 s".
duration() {
  if [ "$1" -lt 60 ]; then echo "$1 s"; else echo "$(($1 / 60)) min $(($1 % 60)) s"; fi
}

# Progress read from the log, from line $PROGRESS_FROM (where the running command started writing): BuildKit's
# "#N [stage n/m] …" lines (n is padded to the width of m; steps summed over the stages seen) or SwiftPM's "[n/m] …".
# Prints "done total" on the first line, then the current step (or the last line when no step is known).
log_progress() {
  tail -n +"${PROGRESS_FROM:-1}" "$LOG" 2>/dev/null | awk '
    /^#[0-9]+ \[[^]]*[0-9]+\/[0-9]+\]/ {
      s = $0; sub(/^#[0-9]+ \[/, "", s); sub(/\].*/, "", s)
      stage = s; sub(/ *[0-9]+\/[0-9]+$/, "", stage)
      count = s; sub(/.*[^0-9\/]/, "", count); split(count, a, "/")
      if (!(stage in total)) { total[stage] = a[2]; t += a[2] }
      if (a[1] + 0 > seen[stage] + 0) { d += a[1] - seen[stage]; seen[stage] = a[1] }
      current = $0; sub(/^#[0-9]+ /, "", current)
      next
    }
    /^\[[0-9]+\/[0-9]+\]/ {
      s = $0; sub(/^\[/, "", s); sub(/\].*/, "", s); split(s, a, "/")
      d = a[1]; t = a[2]; current = $0
      next
    }
    NF { last = $0 }
    END { print d + 0, t + 0; print (current != "" ? current : last) }
  '
}

progress_line() {
  local label="$1" elapsed="$2" tick="$3" done total current bar="" i=0 room time
  { read -r done total; IFS= read -r current; } < <(log_progress)
  done="${done:-0}" total="${total:-0}"
  if [ "$total" -gt 0 ]; then
    [ "$done" -le "$total" ] || done="$total"
    while [ "$i" -lt 12 ]; do
      if [ "$i" -lt $((done * 12 / total)) ]; then bar="${bar}█"; else bar="${bar}░"; fi
      i=$((i + 1))
    done
    bar="$bar $done/$total  "
  fi
  time="$(duration "$elapsed")"
  # Log lines are shown in ASCII only, so cutting them never splits a character.
  current="$(printf '%s' "${current:-}" | LC_ALL=C tr -cd ' -~')"
  vlen "x $label  $bar$time  "
  room=$((COLS - 1 - VLEN))
  if [ "$room" -lt 4 ]; then
    current=""
  elif [ "${#current}" -gt "$room" ]; then
    current="${current:0:$((room - 3))}..."
  fi
  printf '\r\033[K%s%s%s %s  %s%s%s%s  %s%s' "$YELLOW" "${SPINNER[$((tick % 10))]}" "$RESET" "$label" \
    "$GREEN" "$bar" "$RESET$DIM" "$time" "$current" "$RESET"
}

# run_logged <label> <command…>: appends the command's output to the log and returns its status.
run_logged() {
  local label="$1" pid status start=$SECONDS tick=0
  shift
  PROGRESS_FROM=$(($(wc -l <"$LOG") + 1))
  if [ "$UI" != "rich" ]; then
    echo "${label}…"
    "$@" >>"$LOG" 2>&1 </dev/null
    return
  fi
  "$@" >>"$LOG" 2>&1 </dev/null &
  pid=$!
  # A background command ignores Ctrl-C: pass it on, as a foreground one would have received it.
  trap 'kill "$pid" 2>/dev/null; printf "\r\033[K\033[?25h\n"; exit 130' INT TERM
  printf '\033[?25l'
  while kill -0 "$pid" 2>/dev/null; do
    progress_line "$label" $((SECONDS - start)) "$tick"
    tick=$((tick + 1))
    sleep 0.1
  done
  wait "$pid"
  status=$?
  trap - INT TERM
  printf '\r\033[K\033[?25h'
  return "$status"
}

# The last lines of the log from line $1 on, indented on stderr, so the ✗ line that follows stays the last one.
log_tail() {
  echo "Dernières lignes de $LOG :" >&2
  tail -n +"${1:-1}" "$LOG" | tail -n 15 | sed 's/^/    /' >&2
}

# A tool installed in ~/.local/bin works for this run even when that folder is not on PATH yet.
find_tool() {
  if command -v "$1" >/dev/null 2>&1; then
    command -v "$1"
  elif [ -x "$LOCAL_BIN/$1" ]; then
    echo "$LOCAL_BIN/$1"
  fi
}

path_hint() {
  case ":$PATH:" in *":$LOCAL_BIN:"*) ;; *)
    say "  $LOCAL_BIN n'est pas dans ton PATH. Ajoute cette ligne à ton ~/.zshrc (ou ~/.bashrc) :"
    echo '    export PATH="$HOME/.local/bin:$PATH"'
    ;;
  esac
}

install_gh_release() {
  local arch tag name tmp expected actual
  case "$(uname -m)" in arm64) arch=arm64 ;; x86_64) arch=amd64 ;; *) fail "Architecture non prise en charge : $(uname -m)" ;; esac
  tag="$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p' | head -n 1)"
  [ -n "$tag" ] || fail "Impossible de trouver la dernière version de gh sur GitHub."
  name="gh_${tag}_macOS_${arch}"
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/$name.zip" "https://github.com/cli/cli/releases/download/v$tag/$name.zip" || fail "Le téléchargement de gh a échoué."
  curl -fsSL -o "$tmp/checksums.txt" "https://github.com/cli/cli/releases/download/v$tag/gh_${tag}_checksums.txt" ||
    fail "Le téléchargement des sommes de contrôle de gh a échoué."
  expected="$(awk -v f="$name.zip" '$2 == f { print $1 }' "$tmp/checksums.txt")"
  actual="$(shasum -a 256 "$tmp/$name.zip" | awk '{ print $1 }')"
  if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
    rm -rf "$tmp"
    fail "La somme de contrôle de gh ne correspond pas : installation annulée."
  fi
  unzip -q "$tmp/$name.zip" -d "$tmp" || fail "L'archive de gh est illisible."
  mkdir -p "$LOCAL_BIN"
  cp "$tmp/$name/bin/gh" "$LOCAL_BIN/gh" && chmod +x "$LOCAL_BIN/gh"
  rm -rf "$tmp"
  say "✓ gh $tag installé dans $LOCAL_BIN"
  path_hint
}

ensure_gh() {
  GH="$(find_tool gh)"
  [ -n "$GH" ] && return
  if [ -n "$NO_PROMPT" ]; then
    [ "$OS" = "Darwin" ] || fail "gh n'est pas installé. Installe-le ($GH_INSTALL_LINUX), puis relance ./start.sh."
    fail "gh n'est pas installé. Lance ./start.sh dans un terminal pour l'installer."
  fi
  if command -v brew >/dev/null 2>&1; then
    explain "gh (GitHub CLI) permet au Desk de lire tes PR avec ton compte GitHub. Il n'est pas installé : je l'installe avec Homebrew (brew install gh)."
    ask "Installer gh ?" ||
      fail "Installe gh avec « brew install gh », puis relance ./start.sh."
    brew install gh || fail "« brew install gh » a échoué."
  else
    explain "gh (GitHub CLI) permet au Desk de lire tes PR avec ton compte GitHub. Il n'est pas installé : je télécharge la version officielle depuis GitHub, je vérifie sa somme de contrôle et je le mets dans $LOCAL_BIN."
    ask "Installer gh ?" ||
      fail "Installe gh avec « brew install gh » ou depuis https://github.com/cli/cli/releases/latest, puis relance ./start.sh."
    install_gh_release
  fi
  GH="$(find_tool gh)"
  [ -n "$GH" ] || fail "gh reste introuvable après l'installation."
}

gh_token() {
  if [ -n "$GH_USER" ]; then
    "$GH" auth token --user "$GH_USER" 2>/dev/null
  else
    "$GH" auth token 2>/dev/null
  fi
}

no_gh_token() {
  if [ -n "$GH_USER_SAVED" ]; then
    fail "gh n'a pas de token pour $GH_USER (compte retenu dans $DESK_DIR/gh-user). Relance ./start.sh --user <ton-login>, ou supprime $DESK_DIR/gh-user."
  fi
  fail "gh n'a pas de token${GH_USER:+ pour $GH_USER}. Lance « gh auth login », puis relance ./start.sh."
}

ensure_claude() {
  CLAUDE="$(find_tool claude)"
  [ -n "$CLAUDE" ] && return
  explain "claude (Claude Code) crée le token Claude. Il n'est pas installé : je l'installe avec l'installeur officiel ($CLAUDE_INSTALL), dans $LOCAL_BIN."
  ask "Installer claude ?" ||
    fail "Installe claude avec « $CLAUDE_INSTALL », puis relance ./start.sh."
  curl -fsSL https://claude.ai/install.sh | bash || fail "L'installation de claude a échoué."
  CLAUDE="$(find_tool claude)"
  [ -n "$CLAUDE" ] || fail "claude reste introuvable après l'installation."
  path_hint
}

# An empty value, quoted or not, is no token: Compose reads CLAUDE_CODE_OAUTH_TOKEN="" as empty too.
EMPTY_TOKEN_LINE="^CLAUDE_CODE_OAUTH_TOKEN=[[:space:]]*(\"\"|'')?[[:space:]]*\$"

has_claude_token() {
  [ -f .env ] && grep -E '^CLAUDE_CODE_OAUTH_TOKEN=' .env | grep -Evq "$EMPTY_TOKEN_LINE"
}

# Fills an empty CLAUDE_CODE_OAUTH_TOKEN line in place, or adds the line; every other byte is kept as is.
save_claude_token() {
  if [ ! -f .env ]; then
    (umask 077 && printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$1" >.env)
  elif grep -Eq "$EMPTY_TOKEN_LINE" .env; then
    local ends_with_newline="" updated
    [ "$(tail -c 1 .env)" = "" ] && ends_with_newline=1
    updated="$(mktemp)"
    TOKEN="$1" awk -v pattern="$EMPTY_TOKEN_LINE" -v final_newline="$ends_with_newline" '
      { line = $0 }
      line ~ pattern && !done { line = "CLAUDE_CODE_OAUTH_TOKEN=" ENVIRON["TOKEN"]; done = 1 }
      { printf "%s%s", (NR > 1 ? "\n" : ""), line }
      END { if (final_newline) printf "\n" }
    ' .env >"$updated"
    cat "$updated" >.env
    rm -f "$updated"
  else
    [ -s .env ] && [ "$(tail -c 1 .env)" != "" ] && printf '\n' >>.env
    printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$1" >>.env
  fi
}

# The menu-bar app (macOS only, never without a terminal): offered once, rebuilt when tray/ changed.
TRAY_APP="$HOME/Applications/PR Review Desk.app"
TRAY_CONFIG="$HOME/Library/Application Support/PR Review Desk/config.json"
TRAY_AGENT="$HOME/Library/LaunchAgents/com.villeco.pr-review-desk.tray.plist"
TRAY_RUNNING=""
TRAY_NEW=""

# Reads one string value from the tray's config.json with sed alone (no jq, node or python guaranteed).
tray_config() {
  [ -f "$TRAY_CONFIG" ] || return 0
  sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$TRAY_CONFIG" | head -n 1 | sed 's#\\/#/#g'
}

# The main clone is not a git worktree: both git dirs are the same folder.
tray_not_main() {
  local gitdir common branch
  gitdir="$(cd "$(git rev-parse --git-dir 2>/dev/null)" 2>/dev/null && pwd -P)"
  common="$(cd "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null && pwd -P)"
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
  if [ -z "$gitdir" ] || [ "$gitdir" != "$common" ]; then
    TRAY_WHERE="worktree $(pwd -P)"
  elif [ "$branch" != "main" ]; then
    TRAY_WHERE="${branch:-inconnue}"
  else
    return 1
  fi
}

# Swift 6 builds the tray: needs recent Command Line Tools. Returns 1 when the tray must be skipped this run.
# Outdated tools are not offered xcode-select --install: it does not update installed ones.
tray_ensure_clt() {
  local major
  if xcode-select -p >/dev/null 2>&1 && command -v swift >/dev/null 2>&1; then
    major="$(swift --version 2>/dev/null | sed -n 's/.*Swift version \([0-9][0-9]*\).*/\1/p' | head -n 1)"
    [ -n "$major" ] && [ "$major" -lt 6 ] || return 0
    warn "⚠ Les Command Line Tools de Xcode sont trop anciennes pour construire le tray (Swift 6 requis) : xcode-select --install, ou mets-les à jour dans Réglages Système > Mise à jour de logiciels. Le tray est sauté pour ce lancement."
    return 1
  fi
  explain "Les Command Line Tools de Xcode servent à compiler l'icône sur ce Mac. macOS ouvre une fenêtre : clique Installer, puis attends la fin (quelques minutes). J'attends ici."
  ask "Installer les Command Line Tools ?" || return 1
  xcode-select --install >/dev/null 2>&1
  say "En attente de la fin de l'installation des Command Line Tools…"
  local deadline=$((SECONDS + ${DESK_CLT_WAIT_SECONDS:-1800}))
  until xcode-select -p >/dev/null 2>&1; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      warn "⚠ Les Command Line Tools ne sont pas prêtes : le tray est sauté pour ce lancement."
      return 1
    fi
    sleep "${DESK_CLT_POLL_SECONDS:-5}"
  done
}

# install.sh starts the app (launchd or open -n): it counts as started once its process shows up.
tray_wait_running() {
  local deadline=$((SECONDS + ${DESK_TRAY_WAIT_SECONDS:-10}))
  until pgrep -f "$TRAY_APP/Contents/MacOS/DeskTray" >/dev/null 2>&1; do
    [ "$SECONDS" -lt "$deadline" ] || return 1
    sleep 0.5
  done
}

# A first install compiles, asks about launch at login, then installs with the answer; a reinstall keeps that choice.
tray_install() {
  local first="" flag="" from note label="Compilation de l'icône"
  tray_ensure_clt || { step_end "$S_TRAY" skip "sautée pour ce lancement"; return 0; }
  [ -d "$TRAY_APP" ] || first=1
  from=$(($(wc -l <"$LOG") + 1))
  if [ -n "$first" ]; then
    if ! run_logged "$label" tray/install.sh "$(pwd -P)" --build-only; then
      tray_failed "$from"
      return 0
    fi
    say "${DIM}Elle peut se lancer seule à chaque ouverture de session ; ça se change ensuite dans son menu (« Lancer au démarrage du Mac »).$RESET"
    if ask "La lancer au démarrage du Mac ?"; then flag="--login"; else flag="--no-login"; fi
    label="Installation de l'icône"
  fi
  if ! run_logged "$label" tray/install.sh "$(pwd -P)" ${flag:+"$flag"}; then
    tray_failed "$from"
    return 0
  fi
  if ! tray_wait_running; then
    warn "⚠ L'icône ne s'est pas lancée. Ouvre « PR Review Desk » dans ~/Applications, ou relance ./start.sh --tray."
    step_end "$S_TRAY" skip "installée, pas lancée"
    return 0
  fi
  TRAY_RUNNING=1
  TRAY_NEW="$first"
  note="démarrée"
  [ -n "$first" ] || note="mise à jour · démarrée"
  if [ "$flag" = "--login" ] || { [ -z "$first" ] && [ -f "$TRAY_AGENT" ]; }; then note="$note · au démarrage du Mac"; fi
  step_end "$S_TRAY" done "$note"
}

tray_failed() {
  log_tail "$1"
  warn "⚠ L'installation du tray a échoué : le Desk tourne quand même."
  step_end "$S_TRAY" skip "pas installée"
}

# Runs once the Desk is up: a tray started earlier would find it down and run its own start.sh beside this one.
tray_step() {
  [ -n "$TRAY_STEP" ] || return 0
  local attached tree
  if [ -d "$TRAY_APP" ]; then
    attached="$(tray_config clonePath)"
    if [ -n "$attached" ] && [ "$attached" != "$(pwd -P)" ]; then
      # A no is remembered apart from a no to the icon, which a later uninstall must not inherit: only --tray asks again.
      if [ -z "$TRAY_FORCE" ] && [ -f "$DESK_DIR/tray-reattach-declined" ]; then
        step_end "$S_TRAY" skip "rattachée à un autre clone"
        return 0
      fi
      say "Le tray est rattaché à un autre clone : $attached"
      ask "Rattacher le tray à ce clone-ci ?" no || {
        mkdir -p "$DESK_DIR" && : >"$DESK_DIR/tray-reattach-declined"
        step_end "$S_TRAY" skip "rattachée à un autre clone"
        return 0
      }
      rm -f "$DESK_DIR/tray-declined" "$DESK_DIR/tray-reattach-declined"
      tray_install
      return 0
    fi
  fi
  if [ -n "$TRAY_FORCE" ]; then
    rm -f "$DESK_DIR/tray-declined"
    [ ! -d "$TRAY_APP" ] || say "Mise à jour du tray…"
    tray_install
  elif [ -d "$TRAY_APP" ]; then
    tree="$(git rev-parse HEAD:tray 2>/dev/null)" || return 0
    [ "$tree" != "$(tray_config trayTree)" ] || return 0
    say "Mise à jour du tray…"
    tray_install
  else
    [ ! -f "$DESK_DIR/tray-declined" ] || return 0
    explain "Desk dans la barre de menus (recommandé) : une icône près de l'horloge : elle démarre le Desk avec le Mac, montre s'il tourne, l'ouvre et le met à jour en un clic, et lance une review depuis un lien de PR copié." \
      "Je la compile sur ce Mac et je l'installe dans ~/Applications."
    if ask "Installer l'icône près de l'horloge ?"; then
      tray_install
    else
      mkdir -p "$DESK_DIR" && : >"$DESK_DIR/tray-declined"
      step_end "$S_TRAY" skip "pas installée (./start.sh --tray pour l'ajouter)"
    fi
  fi
}

TRAY_STEP=""
if [ "$OS" = "Darwin" ] && [ -z "$NO_PROMPT" ] && [ -f tray/install.sh ]; then
  # Checked before anything else, so --tray from a worktree or a branch fails fast.
  if tray_not_main; then
    [ -z "$TRAY_FORCE" ] || fail "Le tray s'installe depuis le clone principal, sur main (ici : $TRAY_WHERE)."
  else
    TRAY_STEP=1
    STEP_COUNT=5
  fi
fi

# A first run is one with something to set up: it gets the full list of steps and their explanations.
if ! has_claude_token || [ -z "$(find_tool gh)" ] ||
  { [ -n "$TRAY_STEP" ] && [ ! -d "$TRAY_APP" ] && { [ -n "$TRAY_FORCE" ] || [ ! -f "$DESK_DIR/tray-declined" ]; }; }; then
  FIRST_RUN=1
fi
if [ -n "$FIRST_RUN" ]; then
  ROUTE="Docker → GitHub → Claude → Desk"
  [ -z "$TRAY_STEP" ] || ROUTE="$ROUTE → Barre de menus"
  box "$BOLD" "PR Review Desk  installation" "$ROUTE"
  STEP_STATES[$S_DOCKER]="doing"
  [ "$UI" != "rich" ] || steps_show
else
  say "${BOLD}PR Review Desk$RESET"
fi

# 1. Docker: checked first, never installed.
DOCKER_DOWN="Docker n'est pas démarré."
command -v docker >/dev/null 2>&1 || fail "Docker n'est pas installé. Installe un client Docker (OrbStack, Docker Desktop, Colima…), puis relance ./start.sh."
docker_answers() {
  DOCKER_INFO="$(docker info 2>/dev/null)"
}
if ! docker_answers; then
  [ -z "$NO_PROMPT" ] || fail "$DOCKER_DOWN"
  say "Docker ne tourne pas. Démarre-le, puis reviens ici."
  until docker_answers; do
    printf 'Appuie sur Entrée pour vérifier à nouveau (Ctrl-C pour quitter). '
    IFS= read -r _ || { echo; fail "$DOCKER_DOWN"; }
  done
fi

# The port must be free, unless this app's own container already holds it (a restart).
PORT="${HOST_PORT:-$(sed -n 's/^HOST_PORT=//p' .env 2>/dev/null | tail -n 1)}"
PORT="${PORT:-37703}"
# Docker names the folder of the Compose project whose container publishes the port; the project
# name alone would mistake another checkout in a folder with the same name for this one.
PORT_OWNER="$(docker ps --filter "publish=$PORT" --format '{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null | head -n 1)"
if [ "$PORT_OWNER" != "$(pwd -P)" ] && { [ -n "$PORT_OWNER" ] || { command -v nc >/dev/null 2>&1 && nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1; }; }; then
  FREE="$((PORT + 1))"
  while [ "$FREE" -lt "$((PORT + 20))" ] && nc -z 127.0.0.1 "$FREE" >/dev/null 2>&1; do FREE="$((FREE + 1))"; done
  fail "Le port $PORT est déjà utilisé (une autre instance de pr-review-desk ?). Ajoute HOST_PORT=$FREE dans .env, puis relance ./start.sh."
fi
case "$DOCKER_INFO" in
  *"Operating System: OrbStack"*) step_end "$S_DOCKER" done "OrbStack répond" ;;
  *"Operating System: Docker Desktop"*) step_end "$S_DOCKER" done "Docker Desktop répond" ;;
  *) step_end "$S_DOCKER" done "répond" ;;
esac

# On Linux nothing is installed: name every missing tool at once.
if [ "$OS" != "Darwin" ] && [ -z "$NO_PROMPT" ]; then
  MISSING=""
  [ -z "$(find_tool gh)" ] && MISSING="$MISSING
  gh (GitHub CLI) : $GH_INSTALL_LINUX"
  ! has_claude_token && [ -z "$(find_tool claude)" ] && MISSING="$MISSING
  claude (Claude Code) : $CLAUDE_INSTALL"
  [ -z "$MISSING" ] || fail "Installe d'abord :$MISSING
puis relance ./start.sh."
fi

# The git protocol gh records at login: the one this clone already uses (else the one gh has), so gh asks
# nothing about git before opening the browser. With SSH it also skips its offer to upload a key.
gh_login_protocol() {
  case "$(git remote get-url origin 2>/dev/null)" in
    git@github.com:* | ssh://*github.com/*) echo ssh ;;
    https://github.com/*) echo https ;;
    *) if [ "$("$GH" config get git_protocol -h github.com 2>/dev/null)" = ssh ]; then echo ssh; else echo https; fi ;;
  esac
}

# 2. GitHub: installed if needed, then logged in.
step_begin "$S_GITHUB"
ensure_gh
GH_TOKEN="$(gh_token)"
if [ -z "$GH_TOKEN" ]; then
  if [ -n "$NO_PROMPT" ]; then
    [ -n "$GH_USER" ] || fail "GitHub n'est pas connecté. Lance ./start.sh dans un terminal."
    no_gh_token
  fi
  if [ "$(gh_login_protocol)" = ssh ]; then
    GH_LOGIN_ARGS=(--git-protocol ssh --skip-ssh-key)
    GIT_NOTE=""
  else
    GH_LOGIN_ARGS=(--git-protocol https)
    GIT_NOTE=" gh te demandera aussi s'il doit configurer Git avec ce compte : réponds oui si tu pousses en HTTPS."
  fi
  explain "Le Desk lit tes PR et publie tes commentaires avec ton compte GitHub. gh ouvre github.com dans ton navigateur : entre le code affiché ici, puis autorise l'accès.$GIT_NOTE Le token reste chez gh ; le Desk le relit à chaque démarrage, sans l'écrire dans un fichier."
  ask "Me connecter à GitHub ?" || {
    [ -z "$GH_USER" ] || no_gh_token
    fail "Sans connexion GitHub, le Desk ne voit pas tes PR. Lance « gh auth login », puis relance ./start.sh."
  }
  "$GH" auth login --hostname github.com --web "${GH_LOGIN_ARGS[@]}" || fail "La connexion GitHub a échoué. Relance ./start.sh pour réessayer (ou lance « gh auth login »)."
  GH_TOKEN="$(gh_token)"
  [ -n "$GH_TOKEN" ] || no_gh_token
fi
export GH_TOKEN
# Only the login is remembered, and only once gh has vouched for it.
if [ -n "$GH_USER" ] && [ "$GH_USER" != "$SAVED_GH_USER" ]; then
  mkdir -p "$DESK_DIR" && printf '%s\n' "$GH_USER" >"$DESK_DIR/gh-user"
fi
# The active login, read from gh's own settings (no network): only shown, never relied on.
GH_LOGIN="$GH_USER"
[ -n "$GH_LOGIN" ] ||
  GH_LOGIN="$(sed -n '/^github.com:/,/^[^[:space:]]/s/^[[:space:]]*user:[[:space:]]*//p' "${GH_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/gh}/hosts.yml" 2>/dev/null | head -n 1)"
step_end "$S_GITHUB" done "${GH_LOGIN:-connecté}"

# 3. Claude: only needed while .env has no token.
step_begin "$S_CLAUDE"
if ! has_claude_token; then
  [ -z "$NO_PROMPT" ] || fail "Le token Claude manque. Lance ./start.sh dans un terminal."
  explain "Le Desk a besoin d'un token Claude pour lancer les reviews. J'ouvre claude.ai dans ton navigateur : connecte-toi et colle le token. Gardé dans .env, sur ce Mac seulement."
  ask "Créer le token Claude ?" ||
    fail "Sans token Claude, le Desk ne peut pas lancer de reviews. Relance ./start.sh quand tu es prêt (ou mets le token de « claude setup-token » dans .env : CLAUDE_CODE_OAUTH_TOKEN=…)."
  ensure_claude
  "$CLAUDE" setup-token || fail "claude setup-token a échoué."
  printf 'Colle ici le token affiché (sk-ant-…), il ne s’affichera pas : '
  CLAUDE_TOKEN=""
  IFS= read -rs CLAUDE_TOKEN || CLAUDE_TOKEN=""
  echo
  [ -n "$CLAUDE_TOKEN" ] || fail "Aucun token collé. Relance ./start.sh pour réessayer."
  save_claude_token "$CLAUDE_TOKEN"
fi
step_end "$S_CLAUDE" done "token enregistré"
[ -n "$FIRST_RUN" ] || checks_line

# 4. Start. The checkout's commit is baked into the image so /api/health can tell which version runs.
step_begin "$S_DESK"
DESK_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo inconnue)"
export DESK_COMMIT
mkdir -p "$DESK_DIR" && : >"$LOG"
export BUILDKIT_PROGRESS=plain
if ! run_logged "Construction du Desk" docker compose up -d --build; then
  log_tail
  fail "docker compose up a échoué."
fi
URL="http://localhost:$PORT"
step_end "$S_DESK" done "$URL"
step_begin "$S_TRAY"
tray_step
if [ -n "$FIRST_RUN" ] && [ -n "$TRAY_STEP" ] && [ "${STEP_STATES[$S_TRAY]}" = "doing" ]; then
  if [ -d "$TRAY_APP" ]; then step_end "$S_TRAY" done "à jour"; else step_end "$S_TRAY" skip "pas installée (./start.sh --tray pour l'ajouter)"; fi
fi

# 5. Ready: where to open the Desk, and on a first install what the icon is for.
READY=("$URL")
if [ -n "$FIRST_RUN" ] && [ -n "$TRAY_RUNNING" ]; then
  READY+=("Ou clique l'icône en haut à droite." "Astuce : copie un lien de PR, puis ouvre le menu de l'icône pour lancer sa review.")
  [ -z "$TRAY_NEW" ] || READY+=("Le lancement au démarrage se change dans ce menu : « Lancer au démarrage du Mac ».")
fi
box "$GREEN" "✨ C'est prêt" "${READY[@]}"
