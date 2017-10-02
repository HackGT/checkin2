#!/usr/bin/env bash
SOURCE_DIR=$(readlink -f "${BASH_SOURCE[0]}")
cd "$(dirname "$SOURCE_DIR")" || exit
set -xeuo pipefail

# Load Registration's API
curl -s 'https://raw.githubusercontent.com/HackGT/registration/graphql-v2/api.graphql' \
     > ./apis/registration.graphql

./node_modules/.bin/apollo-codegen introspect-schema \
                                   ./apis/registration.graphql \
                                   --output ./apis/registration.schema.json

# Generate Types for Queries
./node_modules/.bin/gql2ts \
    -o ./apis/registration.d.ts \
    ./apis/registration.schema.json

# Compile
./node_modules/typescript/bin/tsc -p server/
./node_modules/typescript/bin/tsc -p client/

