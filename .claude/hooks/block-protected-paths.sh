#!/usr/bin/env bash
# PreToolUse (Edit|Write): blocks edits to the repo's "untouchable production" paths.
# Makes the "don't change X without intent" rule physical, not advice.
#
# CONFIG: edit PROTECTED below with YOUR repo's patterns (regex, forward-slash paths — the script
# normalizes Windows \). Examples:
#   Prisma:      'prisma/schema\.prisma$|prisma/migrations/'
#   generated:   'dist/|build/|\.next/'
#   lockfiles:   'package-lock\.json$|pnpm-lock\.yaml$'
#   native:      'android/app/src/main/java/.*Print.*'
# Leave empty ('') to block nothing (default: assume nothing).
PROTECTED='(^|/)(build|dist-mcp|out|release)/|package-lock.json$'

set -euo pipefail
[ -z "$PROTECTED" ] && exit 0

input=$(cat)
file_path=$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write((JSON.parse(s).tool_input||{}).file_path||"")}catch{process.stdout.write("")}})')
[ -z "$file_path" ] && exit 0

norm=$(printf '%s' "$file_path" | tr '\\' '/')

if printf '%s' "$norm" | grep -qiE "$PROTECTED"; then
  reason="Blocked: $file_path is a protected zone of this repo (see PROTECTED in .claude/hooks/block-protected-paths.sh). Change it only with the owner's explicit intent."
  printf '%s' "$reason" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:s}}))})'
  exit 0
fi

exit 0
