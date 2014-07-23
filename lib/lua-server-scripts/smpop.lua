
-- This script takes a key which is a set, and a single integer argument.
-- It will call "spop" on the set the given amount of times and return all the results.

local key     = KEYS[1]
local amount  = ARGV[1] or 1
local call    = redis.call
local insert  = table.insert
local results = { }

for i=1,amount do

	local value = call('spop', key)

	if value == nil then
		break
	end

	insert(results, value)

end

return results
