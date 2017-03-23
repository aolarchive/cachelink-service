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

  const config = {
    instanceId: uuid.v4(),
    port: env('CACHELINK_PORT') || 3111,
    redisHost: env('CACHELINK_REDIS_HOST', true),
    redisPort: env('CACHELINK_REDIS_PORT', true),
    redisPrefix: env('CACHELINK_REDIS_PREFIX') || '',
    basicAuthUser: env('CACHELINK_BASIC_AUTH_USER'),
    basicAuthPass: env('CACHELINK_BASIC_AUTH_PASS'),
    broadcast: envArray('CACHELINK_BROADCAST', false, ';') || [],
    broadcastTimeoutSeconds: env('CACHELINK_BROADCAST_TIMEOUT_SECONDS') || 5,
    clearLaterIntervalSeconds: env('CACHELINK_CLEAR_LATER_INTERVAL_SECONDS') || 60,
    clearLaterSyncKey: env('CACHELINK_CLEAR_LATER_SYNC_KEY') || '___clear_later_sync',
    cronChannel: env('CACHELINK_CRON_CHANNEL') || '___cron_channel',
    clearLaterSet: env('CACHELINK_REDIS_CLEAR_LATER_SET') || '___clear_later_set',
    clearNowSet: env('CACHELINK_REDIS_CLEAR_NOW_SET') || '___clear_now_set',
    clearNowAmountPerIteration: env('CACHELINK_REDIS_CLEAR_AMOUNT_PER_ITERATION') || 3,
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
