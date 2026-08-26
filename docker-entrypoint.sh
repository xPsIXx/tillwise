#!/bin/sh
set -eu

dir="${PGLITE_DATA_DIR:-/data/pglite}"
parent=$(dirname "$dir")

mkdir -p "$dir" 2>/dev/null || true

if [ "$(id -u)" = "0" ]; then
  if [ -d "$parent" ]; then
    chown -R node:node "$parent" 2>/dev/null || true
  fi
  chown -R node:node "$dir" 2>/dev/null || true
  exec gosu node "$@"
fi

exec "$@"
