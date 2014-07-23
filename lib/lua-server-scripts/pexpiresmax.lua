
-- This script takes several keys and assumes they are sets.
-- Then it will iterate over each member of each set, assume the member is a key, find its TTL
-- and set the TTL of the containing set equal to the max member TTL.
-- This scripts also takes a single argument which is a prefix for all keys in all sets.

local prefix  = ARGV[1] or ''
local call    = redis.call
local insert  = table.insert
local results = { }

for ki, key in ipairs(KEYS) do

	local set_keys = call('smembers', key)
	local max_pttl = -1

	for i, set_key in ipairs(set_keys) do
		local pttl = call('pttl', prefix .. set_key)
		if pttl > max_pttl then
			max_pttl = pttl
		end
	end

	if max_pttl > 0 then
		call('pexpire', key, max_pttl)
	end

	insert(results, ki, max_pttl)

end

return results
