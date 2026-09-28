---
fold-: contractor-pack, integration-pack, depot-pack
collapsedMarker: "(+)"
---
- 🛣️ Kāinga District Council · road + lamp board · 29 Sep AM NZST <id:root>
  - ⚠️ FICTION DEMO · NZ twin · no real council assets · ct=PLACEHOLDER until demo:seal <id:banner>
  - Channels · citizen-report (SSS-style) · RAMM/CMMS-class WOs · status back to reporter <id:flow>
  - Roads · reported <id:roads>
    - Tōtara Straight · mid-block · -41.2865, 174.7762 <id:nz-r1>
      - Citizen · https://example.invalid/citizen/KD-12044 · P2 · cycle lane edge <id:nz-r1-url>
      - Fault: pothole · ~350 mm · ~45 mm · cold-mix candidate <id:nz-r1-fault>
      - [ ] Inspect Wed · corridor Kāinga-N <id:nz-r1-next>
    - Pukeko Lane · school gate · -41.2890, 174.7810 <id:nz-r2>
      - Citizen · https://example.invalid/citizen/KD-12061 · P1 · ponding <id:nz-r2-url>
      - [ ] Inspect today · TMP if lane edge open <kind:pending-approve> <id:nz-r2-next>
  - Lamps · night faults <id:lamps>
    - Pole KD-SL-441 · -41.2872, 174.7780 · lamp out <id:nz-l1>
      - CMMS · https://example.invalid/cmms/WO-KD-3301 · P2 <id:nz-l1-url>
      - [ ] Relamp LED · night run Tue <id:nz-l1-open>
    - Pole KD-SL-458 · -41.2881, 174.7795 · dayburner · PE cell <id:nz-l2>
      - [x] PE cell swapped · closed 21:10 <id:nz-l2-done>
  - Lead unlock only <id:secrets>
    - Contractor access pack <private> <id:contractor-pack> (+)
    - Integration unlock pack <encrypted> <id:integration-pack> (+)
    - Depot after-hours pack <encrypted> <id:depot-pack> (+)

--- payloads ---
# PLACEHOLDER = not real ciphertext; host replaces via demo:seal
contractor-pack:
  kid: nz-contractor-1
  alg: demo-aes-gcm
  ct: PLACEHOLDER
integration-pack:
  kid: nz-api-1
  alg: demo-aes-gcm
  ct: PLACEHOLDER
depot-pack:
  kid: nz-depot-1
  alg: demo-aes-gcm
  ct: PLACEHOLDER
---
