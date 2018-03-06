#!/usr/bin/env bash
SOURCE_DIR=$(readlink -f "${BASH_SOURCE[0]}")
cd "$(dirname "$SOURCE_DIR")" || exit
set -xeuo pipefail

# Load Registration's API
curl -s 'https://raw.githubusercontent.com/HackGT/registration/master/api.graphql' \
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

# Generate types for client side queries and responses
./node_modules/.bin/apollo-codegen introspect-schema \
                                   ./api.graphql \
                                   --output ./apis/checkin.schema.json
./node_modules/.bin/gql2ts \
	-o ./apis/checkin.d.ts \
	./apis/checkin.schema.json

# Compile
./node_modules/typescript/bin/tsc -p server/
./node_modules/typescript/bin/tsc -p client/

# Bundle client side js
./node_modules/.bin/browserify ./client/js/main.js -o ./client/js/bundle.js