import json
import os

with open('../dashboard/public/models/clinical/model.json') as f:
    data = json.load(f)

weights = data['weightsManifest'][0]['weights']
total_floats = 0
for w in weights:
    shape = w['shape']
    cnt = 1
    for dim in shape:
        cnt *= dim
    total_floats += cnt

expected_bytes = total_floats * 4
actual_bytes = os.path.getsize('../dashboard/public/models/clinical/group1-shard1of1.bin')

print(f"JSON expects {total_floats} floats ({expected_bytes} bytes).")
print(f"BIN file is {actual_bytes} bytes.")
if expected_bytes == actual_bytes:
    print("MATCH!")
else:
    print("MISMATCH!")
