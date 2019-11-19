#!/bin/bash
set -euo pipefail
cd `dirname "$0"`
# FIXME add something so we can only run once at a time.
yarn build
cd dist/
pythonwebserver 8080
