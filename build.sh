#!/usr/bin/env bash
SOURCE_DIR=$(readlink -f "${BASH_SOURCE[0]}")
cd "$(dirname "$SOURCE_DIR")" || exit
set -xeuo pipefail

# Load Registration's API
curl -s 'https://raw.githubusercontent.com/HackGT/registration/7901e18c3fbedfe4dd81b04067efe7300f9fd9a8/api.graphql' \
     > ./apis/registration.graphql

./node_modules/.bin/apollo-codegen introspect-schema \
                                   ./apis/registration.graphql \
                                   --output ./apis/registration.schema.json

# Generate Types for Queries
./node_modules/.bin/gql2ts \
    -o ./apis/registration.d.ts \
    ./apis/registration.schema.json

# Generate types for our own API
./node_modules/.bin/graphql-typewriter -i ./api.graphql
mv ./api.graphql.types.ts ./server/graphql.types.ts

# Compile
./node_modules/typescript/bin/tsc -p server/
./node_modules/typescript/bin/tsc -p client/

