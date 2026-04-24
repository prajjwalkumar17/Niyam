#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)
DIST_DIR=${NIYAM_DIST_DIR:-"$ROOT_DIR/.dist"}
VERSION=$(node -p "require('$ROOT_DIR/package.json').version")
ARTIFACT="$DIST_DIR/niyam-selfhost-$VERSION.tgz"

mkdir -p "$DIST_DIR"

tar \
    --exclude=.git \
    --exclude=.env \
    --exclude=.env.* \
    --exclude=node_modules \
    --exclude=.dist \
    --exclude=.deploy \
    --exclude=.local \
    --exclude=playwright-report \
    --exclude=test-results \
    --exclude='data/*.db' \
    --exclude='data/*.db-shm' \
    --exclude='data/*.db-wal' \
    -czf "$ARTIFACT" \
    -C "$ROOT_DIR" .

printf 'Created %s\n' "$ARTIFACT"
