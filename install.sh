#!/usr/bin/env bash
# Antigravity Memory Skill — installer v1.1.0
#
# Usage:
#   ./install.sh           # global install (default)
#   ./install.sh --global  # global install: ~/.gemini/config/skills/antigravity-memory/
#   ./install.sh --project # project install: ./.agents/skills/antigravity-memory/
#
# Requirements: bash, node >= 18. Works on Linux, macOS, Windows (Git Bash / WSL).
# This script is idempotent: running it again is safe.
#
# What gets installed (allowlist — only these are copied):
#   SKILL.md, scripts/, rules/, references/, memory-templates/, hooks/
# Not installed: README.md, docs/, test/, install.sh  (docs only).
#
# Hooks are MERGED (never overwrite) into the target hooks.json.
# A backup is created at hooks.json.bak before any merge.

set -euo pipefail

# ── helpers ──────────────────────────────────────────────────────────────────

die()  { echo "ERROR: $*" >&2; exit 1; }
info() { echo "[install] $*"; }
warn() { echo "WARN:  $*" >&2; }

# Resolve home directory portably (Git Bash sets both HOME and USERPROFILE;
# pure CMD/PowerShell sets only USERPROFILE).
resolve_home() {
  if [[ -n "${HOME:-}" ]] && [[ -d "$HOME" ]]; then
    echo "$HOME"
  elif [[ -n "${USERPROFILE:-}" ]] && [[ -d "$USERPROFILE" ]]; then
    echo "$USERPROFILE"
  else
    die "Cannot determine home directory (HOME and USERPROFILE are both unset or missing)."
  fi
}

# ── argument parsing ──────────────────────────────────────────────────────────

SCOPE="global"
for arg in "$@"; do
  case "$arg" in
    --global)  SCOPE="global"  ;;
    --project) SCOPE="project" ;;
    *)         die "Unknown argument: $arg  (expected --global or --project)" ;;
  esac
done

# ── path resolution ───────────────────────────────────────────────────────────

SKILL_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_NAME="antigravity-memory"

if [[ "$SCOPE" == "global" ]]; then
  HOME_DIR="$(resolve_home)"
  SKILL_DST="$HOME_DIR/.gemini/config/skills/$SKILL_NAME"
  RULES_DST="$HOME_DIR/.gemini/config/rules"
  HOOKS_DST="$HOME_DIR/.gemini/config/hooks.json"
else
  # Project scope: must be run from inside the workspace root.
  if [[ ! -d ".agents" ]] && [[ ! -d ".agent" ]]; then
    warn "No .agents/ or .agent/ directory found in the current directory."
    warn "Creating .agents/ in: $(pwd)"
    mkdir -p ".agents"
  fi
  WORKSPACE_AGENTS_DIR="$(pwd)/.agents"
  SKILL_DST="$WORKSPACE_AGENTS_DIR/skills/$SKILL_NAME"
  RULES_DST="$WORKSPACE_AGENTS_DIR/rules"
  HOOKS_DST="$WORKSPACE_AGENTS_DIR/hooks.json"
fi

info "Scope      : $SCOPE"
info "Skill src  : $SKILL_SRC"
info "Skill dest : $SKILL_DST"
info "Rules dest : $RULES_DST"
info "Hooks file : $HOOKS_DST"

# ── node check ────────────────────────────────────────────────────────────────

if ! command -v node &>/dev/null; then
  die "node is not in PATH. Install Node.js >= 18 first."
fi
NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  die "Node.js >= 18 required. Found: $(node --version)"
fi
info "Node.js    : $(node --version) ✓"

# ── copy skill files (allowlist) ──────────────────────────────────────────────

mkdir -p "$SKILL_DST"

ALLOWLIST=(SKILL.md scripts references memory-templates hooks)
for item in "${ALLOWLIST[@]}"; do
  src="$SKILL_SRC/$item"
  dst="$SKILL_DST/$item"
  if [[ -f "$src" ]]; then
    cp -f "$src" "$dst"
    info "Copied file : $item"
  elif [[ -d "$src" ]]; then
    cp -rf "$src" "$dst"
    info "Copied dir  : $item/"
  else
    warn "Allowlist item not found (skipping): $item"
  fi
done

# ── copy rule ─────────────────────────────────────────────────────────────────

mkdir -p "$RULES_DST"
RULE_SRC="$SKILL_SRC/rules/memory-always-on.md"
RULE_DST="$RULES_DST/memory-always-on.md"
if [[ -f "$RULE_SRC" ]]; then
  cp -f "$RULE_SRC" "$RULE_DST"
  info "Rule installed: $RULE_DST"
else
  warn "Rule file not found: $RULE_SRC"
fi

# ── merge hooks (AGY v2 format: namespaced + type:command) ───────────────────
#
# AGY hooks.json format (verified from data-agent-kit-plugin):
# {
#   "<namespace>": {
#     "<EventName>": [
#       { "type": "command", "command": "...", "timeout": N }
#     ]
#   }
# }
#
# __SKILL_DIR__ is NOT a runtime variable — AGY substitutes the resolved
# absolute path of the skill directory when loading hooks. We replace it
# here with the actual install path so the hook commands are concrete.

HOOKS_SRC="$SKILL_SRC/hooks/hooks.json"
SKILL_DST_NORMALIZED="$SKILL_DST"
# On Windows/Git Bash, node expects either backslashes or forward slashes;
# forward slashes work on all platforms.
if command -v cygpath &>/dev/null; then
  SKILL_DST_NORMALIZED="$(cygpath -m "$SKILL_DST")"
fi

# Build the new hooks block with the resolved skill path replacing __SKILL_DIR__
NEW_HOOKS_CONTENT=$(sed "s|__SKILL_DIR__|$SKILL_DST_NORMALIZED|g" "$HOOKS_SRC")

merge_hooks() {
  local hooks_file="$1"
  local new_block="$2"

  # Merge using Node.js (already verified present).
  # Strategy: deep-merge new_block into existing file.
  # Per-namespace event arrays are concatenated and deduplicated by command value.
  # If hooks_file does not exist or is empty/corrupt, write new_block directly.
  node - "$hooks_file" <<EOF
'use strict';
const fs = require('fs');
const path = require('path');
const hooksFile = process.argv[1];
const newBlock = ${new_block};

let existing = {};
if (fs.existsSync(hooksFile)) {
  try {
    existing = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
    if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) {
      process.stderr.write('WARN: hooks.json has unexpected shape; treating as empty.\\n');
      existing = {};
    }
  } catch (e) {
    process.stderr.write('WARN: hooks.json is corrupt or unreadable; will not overwrite. Error: ' + e.message + '\\n');
    process.exit(0);
  }
  // Backup before any change.
  fs.copyFileSync(hooksFile, hooksFile + '.bak');
}

const merged = Object.assign({}, existing);
for (const [ns, events] of Object.entries(newBlock)) {
  if (!merged[ns]) {
    merged[ns] = {};
  }
  for (const [evt, hookArr] of Object.entries(events)) {
    if (!merged[ns][evt]) {
      merged[ns][evt] = [];
    }
    for (const hook of hookArr) {
      const alreadyPresent = merged[ns][evt].some(
        (h) => h.command === hook.command
      );
      if (!alreadyPresent) {
        merged[ns][evt].push(hook);
      }
    }
  }
}

fs.mkdirSync(path.dirname(hooksFile), { recursive: true });
fs.writeFileSync(hooksFile, JSON.stringify(merged, null, 2) + '\\n', 'utf8');
process.stdout.write('Hooks merged into ' + hooksFile + '\\n');
EOF
}

if [[ -f "$HOOKS_SRC" ]]; then
  merge_hooks "$HOOKS_DST" "$NEW_HOOKS_CONTENT"
else
  warn "Hooks source not found: $HOOKS_SRC"
fi

# ── version drift warning ─────────────────────────────────────────────────────

info ""
info "=== Installation complete ==="
info "Skill version : 1.1.0"
info ""
info "Next steps:"
info "  1. Restart the Antigravity session (or reload customizations) for the"
info "     skill and hooks to take effect."
info "  2. Verify the skill appears in Settings → Customizations → Skills."
info "  3. Verify hooks appear in Settings → Customizations → Hooks."
info "     If hooks don't fire, compare format in $HOOKS_DST against the"
info "     AGY version you're running — the format was updated in AGY 2.x."
info "  4. Run a smoke test: node $SKILL_DST/scripts/memory.js --version"
info "     Expected output: 1.0.1"
info ""
info "Memory store location (default, if no AGMEM_DIR set and no .agents/ in cwd):"
if [[ "$SCOPE" == "global" ]]; then
  HOME_DIR="$(resolve_home)"
  info "  $HOME_DIR/.antigravity-memory/"
else
  info "  $(pwd)/.agents/memory/"
fi
info "Run 'node $SKILL_DST/scripts/memory.js --path' to confirm."
