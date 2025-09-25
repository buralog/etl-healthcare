#!/usr/bin/env bash
set -euo pipefail

: "${SCHEMA_BUCKET:?SCHEMA_BUCKET env var is required (e.g., etl-healthcare-schema-registry)}"
VERSION_PREFIX=${1:-"v1"}  # usage: publish-schemas.sh v1

echo "Publishing events → s3://${SCHEMA_BUCKET}/contracts/${VERSION_PREFIX}/events/"
aws s3 sync libs/contracts/src/events "s3://${SCHEMA_BUCKET}/contracts/${VERSION_PREFIX}/events/" \
  --content-type application/schema+json --delete

echo "Publishing DTOs → s3://${SCHEMA_BUCKET}/contracts/${VERSION_PREFIX}/dto/"
aws s3 sync libs/contracts/src/dto "s3://${SCHEMA_BUCKET}/contracts/${VERSION_PREFIX}/dto/" \
  --content-type application/schema+json --delete

echo "Done. Listing:"
aws s3 ls "s3://${SCHEMA_BUCKET}/contracts/${VERSION_PREFIX}/events/"
aws s3 ls "s3://${SCHEMA_BUCKET}/contracts/${VERSION_PREFIX}/dto/"
