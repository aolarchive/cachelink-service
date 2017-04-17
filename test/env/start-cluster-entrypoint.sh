#!/bin/sh

# --------------------------------------------------------------------
#
# File modified from docker-data/docker-entrypoint.sh in repo
# https://github.com/Grokzen/docker-redis-cluster/
#
# Changed to use localhost to work in host networking mode instead of bridged.
#
# --------------------------------------------------------------------

for port in `seq 7000 7007`; do
	mkdir -p /redis-conf/${port}
	mkdir -p /redis-data/${port}

	if [ -e /redis-data/${port}/nodes.conf ]; then
		rm /redis-data/${port}/nodes.conf
	fi
done

for port in `seq 7000 7005`; do
	PORT=${port} envsubst < /redis-conf/redis-cluster.tmpl > /redis-conf/${port}/redis.conf
done

for port in `seq 7006 7007`; do
	PORT=${port} envsubst < /redis-conf/redis.tmpl > /redis-conf/${port}/redis.conf
done

supervisord -c /etc/supervisor/supervisord.conf
sleep 3

IP=127.0.0.1
echo "yes" | ruby /redis/src/redis-trib.rb create --replicas 1 ${IP}:7000 ${IP}:7001 ${IP}:7002 ${IP}:7003 ${IP}:7004 ${IP}:7005
tail -f /var/log/supervisor/redis*.log
