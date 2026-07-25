#!/usr/bin/env bash
# PostToolUse: runs eslint on the just-edited file and, for each metric warning,
# INJECTS THE FIX INSTRUCTION into the agent's context — not just the number.
# "The good kind of prompt injection": the sensor's message says HOW to fix it.
# Agnostic: uses `npx eslint` (any project with an eslintrc).
set -euo pipefail

input=$(cat)
file_path=$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write((JSON.parse(s).tool_input||{}).file_path||"")}catch{process.stdout.write("")}})')
[ -z "$file_path" ] && exit 0

case "$file_path" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs) ;;
  *) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}"

report=$(npx eslint "$file_path" 2>/dev/null \
  | grep -iE 'complexity|max-depth|max-lines-per-function|max-params|max-nested-callbacks' || true)

[ -z "$report" ] && exit 0

# build the fix instruction per rule that appeared
fixes=""
add() { fixes="$fixes
  - $1"; }
printf '%s' "$report" | grep -qi 'complexity' && add "complexity: too many paths. Extract the branches into smaller named functions (early-return for guard cases; one function per responsibility). Target: <= 10."
printf '%s' "$report" | grep -qi 'max-lines-per-function' && add "max-lines-per-function: the function is too long. Break it into named steps; extract cohesive blocks into helpers. Target: <= 120 lines."
printf '%s' "$report" | grep -qi 'max-depth' && add "max-depth: deep nesting. Use early-return/guard clauses to flatten; extract the inner block. Target: <= 4."
printf '%s' "$report" | grep -qi 'max-params' && add "max-params: too many parameters. Group them into a typed options object. Target: <= 5."
printf '%s' "$report" | grep -qi 'max-nested-callbacks' && add "max-nested-callbacks: nested callbacks. Use async/await or extract named callbacks. Target: <= 3."

echo "[harness] $file_path exceeded a metric. New code is born within the limit; when refactoring legacy above it, bring it within. Warnings:"
echo "$report"
echo ""
echo "HOW TO FIX:$fixes"

exit 0
