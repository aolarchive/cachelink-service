# cachelink service

[![Build Status](https://travis-ci.org/aol/cachelink-service.svg?branch=master)](https://travis-ci.org/aol/cachelink-service)

This service fronts a Redis cache and adds the ability to set cache key associations. It should be used primarily
for *sets* and *clears*. Gets should always go directly to Redis in production for fast access.

## Running

This service requires Redis 2.8 or newer.

```
bin/cachelink path/to/config.json
```

See config options below.

## Why?

This service provides the ability to maintain associations between cache keys for deep cache busting.

For example: if you set a key, `X` with associations `Y` and `Z`, clearing key `Y` or `Z` will also clear `X`. 

This is useful in cases where you have a cached result that contains other results. For example, 
a cached article object, `A`, containing a gallery object, `G`. When the gallery, `G`, is updated or deleted, the 
cache should be cleared for both `A` and `G`. 

Most of the time these relationships are maintained outside of cache (in a relational database, for example) so 
there is no need for associations in cache. However, there are several cases where dynamically generated lists or 
sets should also be cleared when a nested value is updated. In these cases, this service will handle 
maintaining those associations.

## How it Works

This service uses Redis sets to maintain associations. It keeps a forward association set (the "contains" set) and 
a backward association set (the "in" set). As an example, assume we have the following objects:

```
Acme = { name: "Acme", address: { ... }, ... }
John = { name: "John", employer: E }
```

We can associate `John` to `Acme` when we set cache:

```
cache.set({ key:"John", data:John, millis:TTL, associations:["Acme"] })
```

Now in redis we have the three keys:

1. The data: `d:John` = `{ name: "John", employer: E }`
2. A "contains" set for each association: `c:Acme` = `["John"]`
3. The "in" set for the key: `i:John` = `["Acme"]`

If `"Acme"` is cleared, the service will read its "contains" set to determine which keys to recursively clear.
If `"John"` was associated to another parent, it would also be cleared.

If `"John"` is cleared, it will be deleted and the key will removed from all sets defined in the "in" set.

Related forward and backward association sets are kept up to date whenever a cache key is set.

## Clear Later

This service also supports the notion of clearing a cache key at a later time. 
Clients can request a key be cleared later. The service adds those keys to a set then uses an internal cron to perform
a clear of all those keys on a regular interval (this is configurable).

This is useful for cache keys which have the potential to be invalidated in quick succession. This will
de-dupe those clears and schedule them to happen at a regular interval. 
This enables cache to maintain a good hit-rate for those keys, even while being cleared quickly.

## API

- Get an item: `GET /:key`
	```
	GET /foo
	=>
	'fooValue'
	```

- Get multiple items: `GET /?k=:key1&k=:key2&...`
	```
	GET /?k=foo&k=bar&k=baz
	=>
	["fooValue", "barValue", "bazValue"]
	```

- Set an item: `PUT /`
	```
	PUT /
	{"key":"foo", "data":"fooValue", "seconds":1.5, "associations":["bar", "baz"]}
	=>
	{"success": true, /* ...details... */}
	```

- Clear an item: `DELETE /:key`
	```
	DELETE /foo
	=>
	{"success": true, /* ...details... */}
	```
	You can also specify the amount of association levels to clear:
	```
	DELETE /foo?levels=all
	DELETE /foo?levels=none
	DELETE /foo?levels=3
	```

- Clear an item later: `PUT /clear-later`
	```
	PUT /clear-later
	{"keys":["foo", "bar"]}
	=>
	{"success": true, /* ...details... */}
	```

## Config Options

```
{
	  port     : // the port to run the service on
	, redis {
		  host   : // the redis host
		, port   : // the redis port
		, prefix : // (optional) a prefix to use for redis keys
	}
	, broadcast                  : // an array of HTTP endpoints to broadcast to during cache sets, clears, and clear-laters
	, broadcastTimeout           : // (optional, defaults to 5 seconds) how long to wait for a response when broadcasting
	, clearLaterInterval         : // (optional, defaults to 1 minute) how often to clear all keys in the "clear-later" set
	, clearLaterSyncKey          : // (optional) a redis key to use for synchronizing the cron
	, cronChannel                : // (optional) a redis channel to use for cron cluster synchronization
	, clearLaterSet              : // (optional) a redis key to use for the "clear-later" set
	, clearNowSet                : // (optional) a redis key to use for the "clear-now" set
	, clearNowAmountPerIteration : // (optional, defaults to 3) how many keys to pop and clear per iteration during the clear-now process
}
```
