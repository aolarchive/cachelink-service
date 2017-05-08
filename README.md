# cachelink

This service fronts a Redis cache and adds the ability to set cache key associations. It should be used primarily
for *sets* and *clears*. Gets should always go directly to Redis in production for fast access.

[![NPM Version](https://badge.fury.io/js/cachelink-service.svg)](https://badge.fury.io/js/cachelink-service)
[![Build Status](https://travis-ci.org/aol/cachelink-service.svg?branch=master)](https://travis-ci.org/aol/cachelink-service)

## Running

This service requires Redis 3 or newer.

```
bin/cachelink
```

See environment config options below.

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

### Get an Item

```
GET /foo
```
Returns
```
fooValue
```

### Get Multiple Items

```
GET /?k=foo&k=bar&k=baz
```
Returns
```
["fooValue", "barValue", "bazValue"]
```

### Set an Item

```
PUT /
{
  "key": "foo",
  "data": "fooValue",
  "seconds": 1.5,
  "associations": ["bar", "baz"]
}
```
Returns
```
{
  "success": true,
  ...
}
```

### Clear an Item

```
DELETE /foo
```
Returns
```
{
  "success": true,
  ...
}
```

You can also specify the amount of association levels to clear:
```
DELETE /foo?levels=all
DELETE /foo?levels=none
DELETE /foo?levels=3
```

### Clear an Item Later

```
PUT /clear-later
{
  "keys": ["foo", "bar"]
}
```
Returns
```
{
  "success": true,
  ...
}
```

## Config Environment Variables

| Variable | |
| :--- | :--- |
| `CACHELINK_PORT` | _Optional_, defaults to `3111`. The port to run the service on. |
| `CACHELINK_REDIS_NODES` | Redis node information. Should be a semicolon-delimited list of `host:port` values. Should have a single entry unless in cluster mode, for example: `redis-host-1:6381;redis-host-2:6382;redis-host-3:6383`. |
| `CACHELINK_REDIS_CLUSTER` | _Optional_. Whether to use redis cluster. Defaults to `false`. |
| `CACHELINK_REDIS_PREFIX` | _Optional_. A prefix for all redis keys. |
| `CACHELINK_BASIC_AUTH_USER` | _Optional_. A username to validate for basic auth. |
| `CACHELINK_BASIC_AUTH_PASS` | _Optional_. A password to validate for basic auth. |
| `CACHELINK_BROADCAST` | _Optional_. A semicolon-delimited list of other cachelink base URIs to broadcast to (should exclude this cluster). |
| `CACHELINK_BROADCAST_TIMEOUT_SECONDS` | _Optional_, defaults to `5` seconds. Timeout for broadcasts in seconds. |
| `CACHELINK_CLEAR_LATER_INTERVAL_SECONDS` | _Optional_, defaults to `60` seconds. How often to clear all keys in the "clear-later" set. |
| `CACHELINK_CLEAR_LATER_SYNC_KEY` | _Optional_. The redis key to use when synchronizing the cron. |
| `CACHELINK_CRON_CHANNEL` | _Optional_. The redis channel to use for cron cluster. |
| `CACHELINK_REDIS_CLEAR_LATER_SET` | _Optional_. The redis key to use for the "clear-later" set. |
| `CACHELINK_REDIS_CLEAR_NOW_SET` | _Optional_. The redis key to use for the "clear-now" set. |
| `CACHELINK_REDIS_CLEAR_AMOUNT_PER_ITERATION` | _Optional_, defaults to 3. How many keys to pop and clear per iteration during the clear-now process. |
| `CACHELINK_REQUEST_SIZE_LIMIT` | _Optional_, defaults to `10mb`. The request size limit for incoming cachelink requests. |
| `CACHELINK_HTTPS_PRIVATE_KEY` | _Optional_, defaults to nothing. HTTPS private key in PEM format. This is required for HTTPS. |
| `CACHELINK_HTTPS_CERTIFICATE` | _Optional_, defaults to nothing. HTTPS cert chain in PEM format. This is required for HTTPS. |
| `CACHELINK_HTTPS_CA` | _Optional_, defaults to nothing. Optionally override the trusted CA certificates. Default is to trust the well-known CAs curated by Mozilla. |
| `CACHELINK_HTTPS_REQUEST_CERT` | _Optional_, defaults to `true`. Whether to authenticate the remote peer by requesting a certificate. This is only used when HTTPS is on. |
| `CACHELINK_HTTPS_REJECT_UNAUTHORIZED` | _Optional_, defaults to `true`. If `true` the server will reject any connection which is not authorized with the list of supplied CAs. This option only has an effect if `CACHELINK_HTTPS_REQUEST_CERT` is `true`. This is only used when HTTPS is on. |


## License

[The MIT License (MIT)](https://github.com/aol/cachelink-service/blob/master/LICENSE)

Copyright © 2017 AOL, Inc. All rights reserved.
