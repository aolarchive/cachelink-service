
-- This script takes a key of a source set and a destination set and moves the
-- source set into the destination set (using a union).

local dest   = KEYS[2]
local key    = KEYS[1]
local result = nil
local call   = redis.call

result = call('sunionstore', dest, dest, key)

if result ~= nil then
	result = call('del', key)
end

return result
