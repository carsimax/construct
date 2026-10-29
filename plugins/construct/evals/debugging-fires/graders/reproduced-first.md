---
type: regex
target: trace
pattern: '(?<![\s\S])(?:(?!"subagent_type":\s*"construct:(?:worker|oracle)"|"name":\s*"(?:Edit|Write)"[^\n]*paginate\.js)[\s\S])*?(?:ℹ fail [1-9]|✖ paginate)'
---
