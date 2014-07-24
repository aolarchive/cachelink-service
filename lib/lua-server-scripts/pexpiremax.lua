
-- This script takes several keys and finds the max PTTL of all of them.
-- It will then assign that TTL to the first key in the list given.

local call     = redis.call
local insert   = table.insert
local max_pttl = -1

for ki, key in ipairs(KEYS) do

	local pttl = call('pttl', key)
	if pttl > max_pttl then
		max_pttl = pttl
	end

end

if max_pttl > 0 then
	call('pexpire', KEYS[1], max_pttl)
end

return max_pttl
