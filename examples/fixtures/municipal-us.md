---
fold-: contractor-pack, integration-pack
collapsedMarker: "(+)"
---
- 🛣️ Northside Borough · public works board · 28 Sep AM <id:root>
  - Requests via 311 portal + citizen app · CMMS work orders <id:flow>
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
  - Access <id:secrets>
    - Contractor portal login <private> <id:contractor-pack> (+)
    - CMMS API key <encrypted> <id:integration-pack> (+)

--- payloads ---
contractor-pack:
  kid: us-contractor-1
  alg: demo-aes-gcm
  ct: 8aSkah5dXCqsfwcBiOJglVVMEmu2C3MlFzvBoV55frHmo5mXwxcC2ouxYU5BC6pN_e55IJi1Mjihmb0gtDjXRsstAKc6lgryOKxA_HXaWNs1CKeTefM
integration-pack:
  kid: us-api-1
  alg: demo-aes-gcm
  ct: _nzyrrKkaHv_UPOGSROf3CjOC-OmwIPNUwMg5CdawXoh-8WlFzig9avY5iMcK7xS-DClhPlJIeovSCv-8e9Ou2RQQM0csW0
---
