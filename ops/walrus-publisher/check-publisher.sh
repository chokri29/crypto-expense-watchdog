#!/usr/bin/env sh
set -eu

PUBLISHER_URL=${1:?Usage: check-publisher.sh https://publisher.example.com}
case "$PUBLISHER_URL" in
  https://*) ;;
  *) echo "Publisher URL must use HTTPS" >&2; exit 2 ;;
esac

echo "Checking authenticated publisher API discovery endpoint..."
curl --fail --silent --show-error "${PUBLISHER_URL%/}/v1/api" >/dev/null
echo "Publisher HTTPS endpoint responded. This does NOT verify wallet funding or a successful blob write."
