---
fold-: contractor-pack, integration-pack
collapsedMarker: "(+)"
---
- 🛣️ Northside Borough · public works board · 28 Sep AM ET <id:root>
  - ⚠️ FICTION DEMO · US twin of Cedarvale roads · no real 311/city assets · ct=PLACEHOLDER <id:banner>
  - Channels · 311-style portal + SeeClickFix-class citizen app · CMMS work orders <id:flow>
    - Cleartext OK: lon/lat · public request URLs · priority · asphalt notes <id:flow-clear>
  - Open · intake <id:open>
    - Maple Ave · mid-block bike lane · 45.5122, -122.6587 <id:us-r1>
      - Citizen · https://example.invalid/311/NS-44021 · Pri 2 · photo on file <id:us-r1-url>
      - Fault: pothole · ~16 in wide · ~2 in deep · cold patch candidate <id:us-r1-fault>
      - [ ] Inspect by Wed · sector NW-3 <id:us-r1-next>
    - Cedar St @ school zone · 45.5098, -122.6510 <id:us-r2>
      - Citizen · https://example.invalid/311/NS-44055 · Pri 1 · standing water <id:us-r2-url>
      - [ ] Same-day inspect · cones if edge break <kind:pending-approve> <id:us-r2-next>
  - Scheduled <id:sched>
    - River Rd eastbound · 45.5055, -122.6620 <id:us-s1>
      - CMMS · https://example.invalid/cmms/WO-NS-1888 · Pri 1 · hot mix · lane closure 06:00–09:00 <id:us-s1-url>
      - [ ] Mill & fill Wed · TCP approved <kind:pending-approve> <id:us-s1-job>
  - Closed this week <id:done>
    - Pine Court shoulder · 45.5180, -122.6701 <id:us-d1>
      - Citizen · https://example.invalid/311/NS-43990 · closed · reporter emailed <id:us-d1-url>
      - [x] Cold patch temp · 14-day monitor <id:us-d1-done>
  - Lead unlock only <id:secrets>
    - Contractor access pack <private> <id:contractor-pack> (+)
    - Integration unlock pack <encrypted> <id:integration-pack> (+)

--- payloads ---
# PLACEHOLDER = not real ciphertext; host replaces via demo:seal
contractor-pack:
  kid: us-contractor-1
  alg: demo-aes-gcm
  ct: PLACEHOLDER
integration-pack:
  kid: us-api-1
  alg: demo-aes-gcm
  ct: PLACEHOLDER
---
