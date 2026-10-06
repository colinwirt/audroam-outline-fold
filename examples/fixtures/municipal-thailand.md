---
fold-: contractor-pack, integration-pack, depot-pack
collapsedMarker: "(+)"
---
- 🛣️ Amphoe Bang Saen Nuea · roads + lamps · 29 Sep AM <id:root>
  - Reports via LINE · work orders in the CMMS · reporter gets status updates <id:flow>
  - Roads · open <id:roads>
    - Soi 12 · mid-block · 13.7563, 100.5018 <id:th-r1>
      - Citizen · https://example.invalid/citizen/AF-5501 · P2 · photo · motorcycle path <id:th-r1-url>
      - Fault: pothole · ~40 cm · ~5 cm · cold-mix if dry <id:th-r1-fault>
      - [ ] Inspect Wed · zone North-2 <id:th-r1-next>
    - Thanon Sukhum · school gate · 13.7590, 100.5055 <id:th-r2>
      - Citizen · https://example.invalid/citizen/AF-5519 · P1 · flooding edge <id:th-r2-url>
      - [ ] Inspect today · cones + pump if standing water <kind:pending-approve> <id:th-r2-next>
  - Lamps · night <id:lamps>
    - Pole AF-SL-210 · 13.7571, 100.5030 · lamp out <id:th-l1>
      - CMMS · https://example.invalid/cmms/WO-AF-880 · P2 <id:th-l1-url>
      - [ ] Relamp · night run Tue <id:th-l1-open>
    - Pole AF-SL-218 · 13.7578, 100.5042 · cycling flicker <id:th-l2>
      - [ ] Connector check · open <id:th-l2-open>
  - Access <id:secrets>
    - Contractor portal login <private> <id:contractor-pack> (+)
    - CMMS API key <encrypted> <id:integration-pack> (+)
    - Depot after-hours code <encrypted> <id:depot-pack> (+)

--- payloads ---
contractor-pack:
  kid: th-contractor-1
  alg: demo-aes-gcm
  ct: in568ZVYigO_aUBxmyiyIWr8cNtNr4jIEn2NXFLTuV7cERFX-m0daWb1zKtLPNiuRPBY0zQX9GhYAofv2VAp4AaPDa18kx4WraLtwfpcXMBNuBLT_NyhxNk
integration-pack:
  kid: th-api-1
  alg: demo-aes-gcm
  ct: xbdJ92PKBEA_PhK2hEd_DAcAQmB5Lnyhk2FD9gF_5yPDmkvZMWWZiGvll7b0Xo-7uJOmAO0xdxKAIm46pXoJF2zwyX6Wjjs
depot-pack:
  kid: th-depot-1
  alg: demo-aes-gcm
  ct: FCpuw4Dzk6BgPVsxviV4aFYlxqYmuAo6qo6mu3_zoDffy87eJ7QmzgYQM0ag__S51c8wxn8iZG0bEEhB-z_1LoU
---
