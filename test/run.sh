#!/usr/bin/env bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
TOP=$DIR/..
APP=$TOP/build/test-env/
ENV=$CACHELINK_TEST_MODE

# Remove old files.
echo "Cleaning up old test files..."
rm -rf $APP/test
rm -rf $APP/lib
rm -f $APP/.eslintrc.yml
rm -f $APP/*.env
rm -f $APP/package.json
rm -f $APP/test.log

# Copy new files.
echo "Copying test files..."
mkdir -p $APP/test
cp -r $TOP/lib $APP
cp -r $TOP/test/lib $APP/test
cp $TOP/test/env/*.env $APP
cp $TOP/test/container-test-start.sh $APP/test
cp $TOP/test/eslint.sh $APP/test
cp $TOP/package.json $APP
cp $TOP/.eslintrc.yml $APP
echo "Files copied. Ready to test."

# Start redis.
$DIR/env/start-$ENV.sh

# Run tests in node container on the same network.
docker run -it --rm \
	--net host \
	--name cachelink_test_$ENV \
	-v $APP:/cachelink \
	-w /cachelink \
	-e CACHELINK_TEST_MODE=$ENV \
	node:6 \
	/cachelink/test/container-test-start.sh $@
