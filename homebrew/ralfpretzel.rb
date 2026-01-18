# typed: false
# frozen_string_literal: true

# Homebrew formula for RalfPretzel
# Install: brew install czaku/ralfpretzel/ralfpretzel
# Or: brew tap czaku/ralfpretzel && brew install ralfpretzel

class Ralfpretzel < Formula
  desc "Autonomous AI coding loop that orchestrates AI assistants"
  homepage "https://github.com/czaku/ralfpretzel"
  url "https://github.com/czaku/ralfpretzel/archive/refs/tags/v1.0.0.tar.gz"
  sha256 "PLACEHOLDER_SHA256"
  license "MIT"
  head "https://github.com/czaku/ralfpretzel.git", branch: "main"

  depends_on "jq"

  def install
    bin.install "ralfpretzel.sh" => "ralfpretzel"
  end

  def caveats
    <<~EOS
      RalfPretzel requires at least one AI CLI to be installed:
        - Claude Code: https://github.com/anthropics/claude-code
        - OpenCode: https://opencode.ai/docs/
        - Codex, Cursor (agent), or Qwen-Code

      Optional dependencies:
        - yq: for YAML task files (brew install yq)
        - gh: for GitHub issues and PR creation (brew install gh)
        - bc: for cost calculation (usually pre-installed)

      Quick start:
        ralfpretzel --help
        ralfpretzel --prd PRD.md
        ralfpretzel --json prd.json
    EOS
  end

  test do
    assert_match "USAGE:", shell_output("#{bin}/ralfpretzel --help")
    assert_match "version", shell_output("#{bin}/ralfpretzel --version").downcase
  end
end
