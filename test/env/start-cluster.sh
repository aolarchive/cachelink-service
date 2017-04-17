#!/usr/bin/env bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
OUT=$DIR/../../build/out-cluster.log

# Stop any previous redis.
echo "Cleaning up old redis instances..."
docker kill cachelink_test_redis_cluster
docker rm -f cachelink_test_redis_cluster

# Remove the old log.
rm -f $OUT

# Pull redis image.
echo "Pulling redis cluster image..."
docker pull grokzen/redis-cluster:3.2.7

# Start redis cluster
echo "Starting redis in CLUSTER mode..."
docker run --net host --name cachelink_test_redis_cluster \
	-v $DIR:/cachelink \
	--entrypoint /cachelink/start-cluster-entrypoint.sh \
	grokzen/redis-cluster:3.2.7 > $OUT &
echo -n "Redis running in background. Waiting for redis."

COUNTER=0
READY=0
while [ $COUNTER -lt 25 ]; do
	sleep 1
	echo -n "."
	let COUNTER=COUNTER+1
	LINES=$(grep "Cluster state changed: ok" $OUT | wc -l)
	if [ $LINES -eq 6 ]; then
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
