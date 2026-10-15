#!/bin/bash
# Starts pr-review-desk in Docker. Checks Docker, installs gh and claude on a Mac when asked,
# logs in to GitHub, asks once for the Claude token, then starts the container.
#
#   ./start.sh                  use the active gh account
#   ./start.sh --user <login>   use another account gh is logged in to
#
# The GitHub token is read from gh at each start and handed to Docker; it is never written to a file.

set -u
cd "$(dirname "$0")" || exit 1

GH_USER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --user)
      [ $# -ge 2 ] || { echo "Usage : ./start.sh [--user <login>]" >&2; exit 2; }
      GH_USER="$2"
      shift 2
      ;;
    *)
      echo "Option inconnue : $1" >&2
      echo "Usage : ./start.sh [--user <login>]" >&2
      exit 2
      ;;
  esac
done

LOCAL_BIN="$HOME/.local/bin"
CLAUDE_INSTALL="curl -fsSL https://claude.ai/install.sh | bash"
OS="$(uname -s)"

fail() {
  echo "✗ $*" >&2
  exit 1
}

ask() {
  local reply=""
  printf '%s [o/N] ' "$1"
  IFS= read -r reply || reply=""
  case "$reply" in o | O | oui | Oui | y | Y | yes) return 0 ;; *) return 1 ;; esac
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
    echo "  $LOCAL_BIN n'est pas dans ton PATH. Ajoute cette ligne à ton ~/.zshrc (ou ~/.bashrc) :"
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
  echo "✓ gh $tag installé dans $LOCAL_BIN"
  path_hint
}

ensure_gh() {
  GH="$(find_tool gh)"
  [ -n "$GH" ] && return
  if command -v brew >/dev/null 2>&1; then
    ask "gh (GitHub CLI) n'est pas installé. L'installer avec Homebrew ?" ||
      fail "Installe gh avec « brew install gh », puis relance ./start.sh."
    brew install gh || fail "« brew install gh » a échoué."
  else
    ask "gh (GitHub CLI) n'est pas installé. Télécharger la version officielle depuis GitHub ?" ||
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

ensure_claude() {
  CLAUDE="$(find_tool claude)"
  [ -n "$CLAUDE" ] && return
  ask "claude (Claude Code) n'est pas installé. L'installer avec l'installeur officiel ?" ||
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

# 1. Docker: checked first, never installed.
command -v docker >/dev/null 2>&1 || fail "Docker n'est pas installé. Installe Docker Desktop (https://www.docker.com/products/docker-desktop/), puis relance ./start.sh."
docker info >/dev/null 2>&1 || fail "Docker ne tourne pas. Démarre Docker Desktop, attends qu'il soit prêt, puis relance ./start.sh."

# On Linux nothing is installed: name every missing tool at once.
if [ "$OS" != "Darwin" ]; then
  MISSING=""
  [ -z "$(find_tool gh)" ] && MISSING="$MISSING
  gh (GitHub CLI) : https://github.com/cli/cli/blob/trunk/docs/install_linux.md"
  ! has_claude_token && [ -z "$(find_tool claude)" ] && MISSING="$MISSING
  claude (Claude Code) : $CLAUDE_INSTALL"
  [ -z "$MISSING" ] || fail "Installe d'abord :$MISSING
puis relance ./start.sh."
fi

# 2. GitHub: installed if needed, then logged in.
ensure_gh
GH_TOKEN="$(gh_token)"
if [ -z "$GH_TOKEN" ]; then
  echo "Connexion à GitHub : suis les instructions de gh auth login."
  "$GH" auth login --hostname github.com --web || fail "La connexion GitHub a échoué. Relance ./start.sh pour réessayer (ou lance « gh auth login »)."
  GH_TOKEN="$(gh_token)"
  [ -n "$GH_TOKEN" ] || fail "gh n'a pas de token${GH_USER:+ pour $GH_USER}. Lance « gh auth login », puis relance ./start.sh."
fi
export GH_TOKEN
echo "✓ GitHub connecté"

# 3. Claude: only needed while .env has no token.
if ! has_claude_token; then
  ensure_claude
  echo "Génération du token Claude : suis les instructions de claude setup-token."
  "$CLAUDE" setup-token || fail "claude setup-token a échoué."
  printf 'Colle ici le token affiché (sk-ant-…), il ne s’affichera pas : '
  CLAUDE_TOKEN=""
  IFS= read -rs CLAUDE_TOKEN || CLAUDE_TOKEN=""
  echo
  [ -n "$CLAUDE_TOKEN" ] || fail "Aucun token collé. Relance ./start.sh pour réessayer."
  save_claude_token "$CLAUDE_TOKEN"
  echo "✓ Token Claude enregistré dans .env"
fi

# 4. Start.
docker compose up -d --build || fail "docker compose up a échoué."
PORT="${HOST_PORT:-$(sed -n 's/^HOST_PORT=//p' .env 2>/dev/null | tail -n 1)}"
echo "✓ pr-review-desk tourne : http://localhost:${PORT:-37703}"
