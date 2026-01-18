# Homebrew Tap for RalfPretzel

This directory contains the Homebrew formula for RalfPretzel.

> **Note:** v1.0.0 has not been released yet. The formula supports HEAD installation from the main branch. Follow the steps below when you're ready to create the v1.0.0 release.

## Setting Up Your Own Tap

To distribute RalfPretzel via Homebrew, you need to create a separate repository for the tap:

### 1. Create the Tap Repository

Create a new GitHub repository named `homebrew-ralfpretzel` under your account.

The naming convention `homebrew-<name>` is required for Homebrew taps.

### 2. Add the Formula

Copy `ralfpretzel.rb` to the root of your `homebrew-ralfpretzel` repository.

### 3. Create a Release

Before the formula works, you need to create a GitHub release:

```bash
# In the ralfpretzel repository
git tag v1.0.0
git push origin v1.0.0
```

### 4. Update the SHA256

After creating the release, get the SHA256 of the tarball:

```bash
curl -sL https://github.com/czaku/ralfpretzel/archive/refs/tags/v1.0.0.tar.gz | shasum -a 256
```

Update the `sha256` field in `ralfpretzel.rb` with this value.

### 5. Users Can Install

Once set up, users can install with:

```bash
# Add the tap
brew tap czaku/ralfpretzel

# Install
brew install ralfpretzel

# Or in one command
brew install czaku/ralfpretzel/ralfpretzel
```

## Development

To test the formula locally:

```bash
# Install from local formula
brew install --build-from-source ./ralfpretzel.rb

# Or install HEAD (latest main branch)
brew install --HEAD czaku/ralfpretzel/ralfpretzel
```

## Updating the Formula

When releasing a new version:

1. Create a new git tag: `git tag v1.x.x && git push origin v1.x.x`
2. Get the new SHA256: `curl -sL https://github.com/czaku/ralfpretzel/archive/refs/tags/v1.x.x.tar.gz | shasum -a 256`
3. Update the `url` and `sha256` in `ralfpretzel.rb`
4. Push to the tap repository
