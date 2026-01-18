#!/bin/bash
# ============================================
# RalfPretzel Installer
# ============================================
# Install: curl -fsSL https://raw.githubusercontent.com/czaku/ralfpretzel/main/install.sh | bash
# ============================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
REPO="czaku/ralfpretzel"
INSTALL_DIR="${RALFPRETZEL_INSTALL_DIR:-$HOME/.local/bin}"
SCRIPT_NAME="ralfpretzel"

# Helpers
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Banner
echo ""
echo -e "${BLUE}╔═══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║${NC}         RalfPretzel Installer             ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}    Autonomous AI Coding Loop             ${BLUE}║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════╝${NC}"
echo ""

# Detect OS
detect_os() {
  case "$(uname -s)" in
    Darwin*) echo "macos" ;;
    Linux*)  echo "linux" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *) echo "unknown" ;;
  esac
}

OS=$(detect_os)
info "Detected OS: $OS"

# Check dependencies
check_deps() {
  local missing=()

  # Required
  if ! command -v jq &>/dev/null; then
    missing+=("jq")
  fi

  if ! command -v curl &>/dev/null && ! command -v wget &>/dev/null; then
    missing+=("curl or wget")
  fi

  # Check for at least one AI CLI
  local has_ai=false
  for cli in claude opencode codex agent qwen; do
    if command -v "$cli" &>/dev/null; then
      has_ai=true
      break
    fi
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    error "Missing required dependencies: ${missing[*]}\nPlease install them first."
  fi

  if [[ "$has_ai" == "false" ]]; then
    warn "No AI CLI found (claude, opencode, codex, agent, qwen)"
    warn "You'll need to install at least one before using RalfPretzel"
  fi

  success "Dependencies check passed"
}

# Create install directory
create_install_dir() {
  if [[ ! -d "$INSTALL_DIR" ]]; then
    info "Creating install directory: $INSTALL_DIR"
    mkdir -p "$INSTALL_DIR"
  fi
}

# Download the script
download_script() {
  local url="https://raw.githubusercontent.com/$REPO/main/ralfpretzel.sh"
  local dest="$INSTALL_DIR/$SCRIPT_NAME"

  info "Downloading RalfPretzel..."

  if command -v curl &>/dev/null; then
    curl -fsSL "$url" -o "$dest"
  elif command -v wget &>/dev/null; then
    wget -qO "$dest" "$url"
  else
    error "Neither curl nor wget found"
  fi

  chmod +x "$dest"
  success "Downloaded to $dest"
}

# Add to PATH instructions
path_instructions() {
  local shell_rc=""
  local in_path=false

  # Check if already in PATH
  if echo "$PATH" | tr ':' '\n' | grep -q "^$INSTALL_DIR$"; then
    in_path=true
  fi

  if [[ "$in_path" == "true" ]]; then
    success "$INSTALL_DIR is already in your PATH"
    return
  fi

  # Detect shell
  case "$SHELL" in
    */zsh)  shell_rc="$HOME/.zshrc" ;;
    */bash)
      if [[ "$OS" == "macos" ]]; then
        shell_rc="$HOME/.bash_profile"
      else
        shell_rc="$HOME/.bashrc"
      fi
      ;;
    */fish) shell_rc="$HOME/.config/fish/config.fish" ;;
    *) shell_rc="$HOME/.profile" ;;
  esac

  echo ""
  warn "$INSTALL_DIR is not in your PATH"
  echo ""
  echo "Add it by running:"
  echo ""
  if [[ "$SHELL" == */fish ]]; then
    echo -e "  ${GREEN}echo 'set -gx PATH $INSTALL_DIR \$PATH' >> $shell_rc${NC}"
  else
    echo -e "  ${GREEN}echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> $shell_rc${NC}"
  fi
  echo ""
  echo "Then reload your shell:"
  echo ""
  echo -e "  ${GREEN}source $shell_rc${NC}"
  echo ""
}

# Verify installation
verify_install() {
  local installed="$INSTALL_DIR/$SCRIPT_NAME"

  if [[ -x "$installed" ]]; then
    local version
    version=$("$installed" --version 2>&1 | head -1 || echo "installed")
    success "RalfPretzel installed successfully!"
    echo ""
    echo "  Version: $version"
    echo "  Location: $installed"
    echo ""
  else
    error "Installation verification failed"
  fi
}

# Usage instructions
print_usage() {
  echo "Quick start:"
  echo ""
  echo -e "  ${GREEN}ralfpretzel --help${NC}              # Show all options"
  echo -e "  ${GREEN}ralfpretzel --prd PRD.md${NC}        # Run with Markdown PRD"
  echo -e "  ${GREEN}ralfpretzel --json prd.json${NC}     # Run with JSON PRD"
  echo -e "  ${GREEN}ralfpretzel --yaml tasks.yaml${NC}   # Run with YAML tasks"
  echo ""
  echo "Documentation: https://github.com/$REPO"
  echo ""
}

# Main
main() {
  check_deps
  create_install_dir
  download_script
  verify_install
  path_instructions
  print_usage
}

# Handle flags
case "${1:-}" in
  --uninstall|-u)
    if [[ -f "$INSTALL_DIR/$SCRIPT_NAME" ]]; then
      rm "$INSTALL_DIR/$SCRIPT_NAME"
      success "RalfPretzel uninstalled"
    else
      warn "RalfPretzel not found at $INSTALL_DIR/$SCRIPT_NAME"
    fi
    exit 0
    ;;
  --help|-h)
    echo "RalfPretzel Installer"
    echo ""
    echo "Usage:"
    echo "  curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | bash"
    echo ""
    echo "Options:"
    echo "  --uninstall, -u   Remove RalfPretzel"
    echo "  --help, -h        Show this help"
    echo ""
    echo "Environment variables:"
    echo "  RALFPRETZEL_INSTALL_DIR   Installation directory (default: ~/.local/bin)"
    echo ""
    exit 0
    ;;
  *)
    main
    ;;
esac
