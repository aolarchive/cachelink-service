const uuid = require('uuid');

module.exports = function buildConfig(environment) {

  const errors = [];

  function env(prop, required) {
    const value = (environment || process.env)[prop];
    if (!value && required) {
      errors.push(`"${prop}" required`);
    }
    return value;
  }

  function envArray(prop, required, delimiter) {
    const value = env(prop, required);
    return value && value.split(delimiter || ';').filter(v => Boolean(v));
  }

  function envBool(prop, defaultVal) {
    const value = env(prop, false);
    return value === undefined
      ? (defaultVal || false)
      : (value && value !== '0' && value !== 'false' && value !== 'no');
  }

  const config = {

    // The instance of this node.
    instanceId: uuid.v4(),

    // Port to run the service on.
    port: env('CACHELINK_PORT') || 3111,

    // Redis node information. Should be a semicolon-delimiter list of host:port values.
    redisNodes: envArray('CACHELINK_REDIS_NODES', true),
    // Whether to use redis cluster.
    redisCluster: envBool('CACHELINK_REDIS_CLUSTER', false),
    // Redis auth password.
    redisAuth: env('CACHELINK_REDIS_PASS'),
    // Redis key prefix.
    redisPrefix: env('CACHELINK_REDIS_PREFIX') || '',

    // Basic authentication credentials.
    basicAuthUser: env('CACHELINK_BASIC_AUTH_USER'),
    basicAuthPass: env('CACHELINK_BASIC_AUTH_PASS'),

    // Broadcast settings.
    broadcast: envArray('CACHELINK_BROADCAST', false, ';') || [],
    broadcastTimeoutSeconds: env('CACHELINK_BROADCAST_TIMEOUT_SECONDS') || 5,

    // How often to clear keys which are added to the "clear later" set.
    clearLaterIntervalSeconds: env('CACHELINK_CLEAR_LATER_INTERVAL_SECONDS') || 60,

    // All of the cron redis keys should be tagged with {cron} as to stay on the same redis node.
    // This allows cron set operations to continue to function.
    clearLaterSyncKey: `${env('CACHELINK_CLEAR_LATER_SYNC_KEY') || '___clear_later_sync'}{cron}`,
    cronChannel: `${env('CACHELINK_CRON_CHANNEL') || '___cron_channel'}{cron}`,
    clearLaterSet: `${env('CACHELINK_REDIS_CLEAR_LATER_SET') || '___clear_later'}{cron}`,
    clearNowSet: `${env('CACHELINK_REDIS_CLEAR_NOW_SET') || '___clear_now'}{cron}`,

    // Amount of keys each redis instance will pop to clear during the clear now process.
    clearNowAmountPerIteration: env('CACHELINK_REDIS_CLEAR_AMOUNT_PER_ITERATION') || 3,

    // Max HTTP request size.
    requestSizeLimit: env('CACHELINK_REQUEST_SIZE_LIMIT') || '10mb',
  };

  if (config.basicAuthUser && config.basicAuthPass) {
    config.basicAuth = { user: config.basicAuthUser, pass: config.basicAuthPass };
  }

  if (errors.length) {
    throw new Error(`config_errors: ${errors.join(', ')}`);
  }

  return config;
};
