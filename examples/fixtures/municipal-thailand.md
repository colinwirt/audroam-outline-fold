---
fold-: contractor-pack, integration-pack, depot-pack
collapsedMarker: "(+)"
---
- 🛣️ Amphoe fiction · road + lamp board · 29 Sep AM ICT <id:root>
  - ⚠️ FICTION DEMO · Thailand-shaped twin · no real district assets · ct=PLACEHOLDER <id:banner>
  - Channels · Line OA / Traffy Fondue-class citizen report · CMMS WOs · status loop <id:flow>
  - Roads · open <id:roads>
    - Soi fiction 12 · mid-block · 13.7563, 100.5018 <id:th-r1>
      - Citizen · https://example.invalid/citizen/AF-5501 · P2 · photo · motorcycle path <id:th-r1-url>
      - Fault: pothole · ~40 cm · ~5 cm · cold-mix if dry <id:th-r1-fault>
      - [ ] Inspect Wed · zone North-2 <id:th-r1-next>
    - Thanon fiction · school gate · 13.7590, 100.5055 <id:th-r2>
      - Citizen · https://example.invalid/citizen/AF-5519 · P1 · flooding edge <id:th-r2-url>
      - [ ] Inspect today · cones + pump if standing water <kind:pending-approve> <id:th-r2-next>
  - Lamps · night <id:lamps>
    - Pole AF-SL-210 · 13.7571, 100.5030 · lamp out <id:th-l1>
      - CMMS · https://example.invalid/cmms/WO-AF-880 · P2 <id:th-l1-url>
      - [ ] Relamp · night run Tue <id:th-l1-open>
    - Pole AF-SL-218 · 13.7578, 100.5042 · cycling flicker <id:th-l2>
      - [ ] Connector check · open <id:th-l2-open>
  - Lead unlock only <id:secrets>
    - Contractor access pack <private> <id:contractor-pack> (+)
    - Integration unlock pack <encrypted> <id:integration-pack> (+)
    - Depot after-hours pack <encrypted> <id:depot-pack> (+)

--- payloads ---
# PLACEHOLDER = not real ciphertext; host replaces via demo:seal
contractor-pack:
  kid: th-contractor-1
  alg: demo-aes-gcm
  ct: PLACEHOLDER
integration-pack:
  kid: th-api-1
  alg: demo-aes-gcm
  ct: PLACEHOLDER
depot-pack:
  kid: th-depot-1
  alg: demo-aes-gcm
  ct: PLACEHOLDER
---
