#!/bin/bash
set -euo pipefail
cd `dirname "$0"`
yarn build
cd dist/
pythonwebserver 8080
