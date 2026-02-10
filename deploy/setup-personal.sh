#!/bin/bash
# Host-native OpenClaw setup for personal VM.
# Idempotent — safe to re-run for updates.
#
# First run:  installs Node.js, Docker, tools, clones repo, builds, starts.
# Re-run:     pulls latest code, rebuilds, regenerates config, restarts.
#
# Usage:
#   ./deploy/setup-personal.sh              # from repo root
#   ssh oracle "cd /opt/openclaw && ./deploy/setup-personal.sh"  # remote
set -euo pipefail

REPO_URL="${OPENCLAW_REPO:-https://github.com/fntune/openclaw.git}"
INSTALL_DIR="/opt/openclaw"
STATE_DIR="$HOME/.openclaw"
ENV_FILE="$INSTALL_DIR/.env"
CONFIG_TEMPLATE="config/openclaw.admin.json5"
SYSTEMD_UNIT="openclaw"
NODE_MAJOR=22

# --- Colors ---
info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m==>\033[0m %s\n' "$*"; }
err()   { printf '\033[1;31m==>\033[0m %s\n' "$*" >&2; }

# --- Helpers ---
has() { command -v "$1" &>/dev/null; }

needs_sudo() {
  if [ "$(id -u)" -ne 0 ]; then
    SUDO="sudo"
  else
    SUDO=""
  fi
}

# =============================================================================
# Section: Node.js + pnpm
# =============================================================================
section_install_node() {
  if has node && [[ "$(node -v)" == v${NODE_MAJOR}.* ]]; then
    info "Node.js $(node -v) already installed"
  else
    info "Installing Node.js $NODE_MAJOR..."
    curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | $SUDO bash -
    $SUDO apt-get install -y nodejs
    info "Node.js $(node -v) installed"
  fi

  # Enable corepack for pnpm
  if ! has pnpm; then
    info "Enabling pnpm via corepack..."
    $SUDO corepack enable
  fi
  info "pnpm $(pnpm -v) ready"
}

# =============================================================================
# Section: Docker (for mcp-atlassian sidecar only)
# =============================================================================
section_install_docker() {
  if has docker; then
    info "Docker already installed"
  else
    info "Installing Docker..."
    curl -fsSL https://get.docker.com | $SUDO sh
    $SUDO usermod -aG docker "$USER"
    info "Docker installed (re-login for group membership)"
  fi
}

# =============================================================================
# Section: Tools (gh, tailscale, etc.)
# =============================================================================
section_install_tools() {
  # GitHub CLI
  if ! has gh; then
    info "Installing GitHub CLI..."
    $SUDO mkdir -p -m 755 /etc/apt/keyrings
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | $SUDO tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | $SUDO tee /etc/apt/sources.list.d/github-cli.list >/dev/null
    $SUDO apt-get update -qq
    $SUDO apt-get install -y gh
  else
    info "gh CLI already installed"
  fi

  # Tailscale
  if ! has tailscale; then
    info "Installing Tailscale..."
    curl -fsSL https://tailscale.com/install.sh | $SUDO sh
  else
    info "Tailscale already installed"
  fi

  # Basic utilities
  $SUDO apt-get install -y -qq jq git curl unzip 2>/dev/null || true
}

# =============================================================================
# Section: Clone or pull
# =============================================================================
section_clone_or_pull() {
  if [ -d "$INSTALL_DIR/.git" ]; then
    info "Pulling latest from origin/main..."
    cd "$INSTALL_DIR"
    git fetch origin
    git reset --hard origin/main
  else
    info "Cloning $REPO_URL → $INSTALL_DIR..."
    $SUDO mkdir -p "$(dirname "$INSTALL_DIR")"
    $SUDO chown "$USER:$USER" "$(dirname "$INSTALL_DIR")"
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  fi
  info "At commit: $(git log --oneline -1)"
}

# =============================================================================
# Section: Build
# =============================================================================
section_build() {
  info "Installing dependencies..."
  cd "$INSTALL_DIR"
  pnpm install --frozen-lockfile

  info "Building..."
  pnpm build

  info "Building UI..."
  OPENCLAW_PREFER_PNPM=1 pnpm ui:build

  info "Build complete"
}

# =============================================================================
# Section: .env file
# =============================================================================
section_env() {
  if [ -f "$ENV_FILE" ]; then
    info ".env exists — keeping current secrets"
  else
    warn "No .env file found at $ENV_FILE"
    warn "Create it manually with your secrets, then re-run this script."
    warn "Required variables:"
    cat <<'VARS'
      OPENCLAW_GATEWAY_TOKEN=<token>
      GOOGLE_API_KEY=<key>
      MODEL_PRIMARY=google/gemini-3-flash-preview
      JARVIS_URL=https://jarvis-dot-jarvis-ml-dev.uc.r.appspot.com
      JARVIS_API_KEY=<key>
      JIRA_URL=https://jarvisml.atlassian.net
      JIRA_USERNAME=<email>
      JIRA_API_TOKEN=<token>
      CONFLUENCE_URL=https://jarvisml.atlassian.net/wiki
      CONFLUENCE_USERNAME=<email>
      CONFLUENCE_API_TOKEN=<token>
      MCP_ATLASSIAN_URL=http://localhost:8081/sse
VARS
    exit 1
  fi
}

# =============================================================================
# Section: Config generation
# =============================================================================
section_config() {
  info "Generating config..."
  mkdir -p "$STATE_DIR"

  # Source .env and export all vars
  set -a
  source "$ENV_FILE"
  set +a

  # Render config template → openclaw.json
  node "$INSTALL_DIR/deploy/render-config.mjs" \
    "$INSTALL_DIR/$CONFIG_TEMPLATE" \
    "$STATE_DIR/openclaw.json"

  info "Config written to $STATE_DIR/openclaw.json"
}

# =============================================================================
# Section: Workspace directories
# =============================================================================
section_workspace() {
  info "Setting up workspace directories..."
  mkdir -p "$STATE_DIR/workspace/sourabh/memory"
  mkdir -p "$STATE_DIR/workspace/analyst"
  mkdir -p "$STATE_DIR/workspace/jira"

  # Create default AGENTS.md if missing
  if [ ! -f "$STATE_DIR/workspace/sourabh/AGENTS.md" ]; then
    warn "No AGENTS.md found — create one at $STATE_DIR/workspace/sourabh/AGENTS.md"
  fi
}

# =============================================================================
# Section: Systemd service
# =============================================================================
section_systemd() {
  info "Setting up systemd service..."

  # Install service file
  $SUDO cp "$INSTALL_DIR/deploy/openclaw-personal.service" /etc/systemd/system/${SYSTEMD_UNIT}.service

  # Patch User= to current user and paths to actual HOME
  $SUDO sed -i "s|User=ubuntu|User=$USER|" /etc/systemd/system/${SYSTEMD_UNIT}.service
  $SUDO sed -i "s|/home/ubuntu|$HOME|" /etc/systemd/system/${SYSTEMD_UNIT}.service

  $SUDO systemctl daemon-reload
  $SUDO systemctl enable "$SYSTEMD_UNIT"
  $SUDO systemctl restart "$SYSTEMD_UNIT"

  # Wait for health
  info "Waiting for gateway..."
  for i in $(seq 1 12); do
    if curl -sf http://localhost:18789/health 2>/dev/null | grep -q status; then
      info "Gateway healthy!"
      return 0
    fi
    sleep 5
  done
  warn "Gateway health check timed out — check: journalctl -u $SYSTEMD_UNIT -f"
}

# =============================================================================
# Section: MCP Atlassian sidecar (Docker)
# =============================================================================
section_mcp_atlassian() {
  if [ ! -f "$INSTALL_DIR/deploy/docker-compose.sidecar.yml" ]; then
    info "No sidecar compose file — skipping mcp-atlassian"
    return 0
  fi

  info "Starting mcp-atlassian sidecar..."
  docker compose -f "$INSTALL_DIR/deploy/docker-compose.sidecar.yml" up -d --remove-orphans

  # Wait for healthy
  for i in $(seq 1 6); do
    if docker compose -f "$INSTALL_DIR/deploy/docker-compose.sidecar.yml" ps 2>/dev/null | grep -q healthy; then
      info "mcp-atlassian healthy"
      return 0
    fi
    sleep 5
  done
  warn "mcp-atlassian health check timed out"
}

# =============================================================================
# Main
# =============================================================================
main() {
  needs_sudo
  info "OpenClaw Personal Setup"
  echo

  section_install_node
  section_install_docker
  section_install_tools
  section_clone_or_pull
  section_build
  section_env
  section_workspace
  section_config
  section_mcp_atlassian
  section_systemd

  echo
  info "Done! Gateway running at http://localhost:18789"
  info "State dir: $STATE_DIR"
  info "Logs: journalctl -u $SYSTEMD_UNIT -f"
  info ""
  info "To update: cd $INSTALL_DIR && ./deploy/setup-personal.sh"
}

main "$@"
