#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)

cd "$ROOT_DIR"

echo "Checking shell syntax"
for script in oneclick-setup.sh scripts/*.sh; do
    if head -n 1 "$script" | grep -q 'bash'; then
        bash -n "$script"
    else
        sh -n "$script"
    fi
done

if command -v shellcheck >/dev/null 2>&1; then
    echo "Running shellcheck"
    shellcheck -e SC2030,SC2031,SC2094 oneclick-setup.sh scripts/*.sh
elif [[ "${NIYAM_REQUIRE_SHELLCHECK:-0}" == "1" ]]; then
    echo "shellcheck is required but was not found on PATH" >&2
    exit 1
else
    echo "shellcheck not found; syntax checks passed and lint was skipped"
fi
