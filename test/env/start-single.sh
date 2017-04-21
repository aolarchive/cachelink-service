#!/usr/bin/env bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
OUT_DIR="$(dirname "$(dirname $DIR)")/build"
OUT="$OUT_DIR/out-single.log"

mkdir -p $OUT_DIR

# Stop any previous redis.
echo "Cleaning up old redis instances..."
docker kill cachelink_test_redis_single
docker rm -f cachelink_test_redis_single

# Remove the old log.
rm -f $OUT

# Pull redis image.
echo "Pulling redis image..."
docker pull redis:3

# Start redis.
echo "Starting redis in SINGLE mode..."
docker run --net host --name cachelink_test_redis_single redis:3 > $OUT &
echo -n "Redis running in background. Waiting for redis."

COUNTER=0
READY=0
while [ $COUNTER -lt 25 ]; do
	sleep 1
	echo -n "."
	let COUNTER=COUNTER+1
	LINES=$(grep "The server is now ready to accept connections" $OUT | wc -l)
	if [ $LINES -eq 1 ]; then
		READY=1
		break
	fi
done
echo ""

if [ $READY -ne 1 ]; then
	echo "Could not start redis. Exiting!"
	exit 1;
fi

echo "Redis is ready!"
