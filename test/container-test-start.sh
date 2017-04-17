#!/usr/bin/env bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
TOP=$DIR/..

ENV=$CACHELINK_TEST_MODE

cd $TOP
export NODE_ENV=development

echo "Installing npm dependencies..."
npm install
echo ""

echo "Setting cachelink environment variables..."
set -o allexport
source $DIR/../env-$ENV.env
set +o allexport
env | grep CACHELINK
echo ""

echo "Running tests... $1"
TESTS=$DIR/lib/*
if [ $1 ]; then
	TESTS=$1
fi
$DIR/../node_modules/mocha/bin/mocha $TESTS
CODE=$?
echo ""

echo "Done."
exit $CODE
