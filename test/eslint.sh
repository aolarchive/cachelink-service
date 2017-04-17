#!/usr/bin/env bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
TOP=$DIR/../

ESLINT=$DIR/../node_modules/.bin/eslint

cd $TOP
pwd
$ESLINT --config ./.eslintrc.yml ./lib/*.js
