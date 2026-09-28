---
fold-: contractor-pack, integration-pack, depot-pack
collapsedMarker: "(+)"
---
- 🕳️ Shire of Cedarvale · road faults board · 29 Sep AM <id:root>
  - ⚠️ FICTION DEMO · no real LGA assets · no live tickets · ct=PLACEHOLDER until demo:seal <id:banner>
  - Workflow · report → inspect → schedule → close · status back to reporter <id:flow>
    - Citizen-report app (SSS-style) · photo + geotag · triage into CMMS (BEIMS-class) WO <id:flow-sss>
    - Cleartext OK: lon/lat · public ticket URLs · P1/P2 · material · never integration secrets <id:flow-clear>
    - Risk fiction: depth · road hierarchy · traffic · water pooling bumps priority <id:flow-risk>
  - Reported · awaiting inspect <id:reported>
    - Ironbark Way · mid-block · collector · -33.7012, 150.9124 <id:ph-r1>
      - Citizen ticket · https://example.invalid/citizen/CV-88421 · P2 · photo · bike lane edge <id:ph-r1-url>
      - Fault: pothole · ~400 mm wide · ~50 mm deep · dry · cold-mix candidate if inspect OK <id:ph-r1-fault>
      - [ ] Inspect by Wed · roads mid · nearest segment IB-W-12 <id:ph-r1-next>
    - Curlew Crescent · outside oval entry · -33.6988, 150.9201 <id:ph-r2>
      - Citizen ticket · https://example.invalid/citizen/CV-88455 · P1 · water pooling · school pickup <id:ph-r2-url>
      - Fault: depression + edge break · ~80 mm deep · make-safe if over intervention <id:ph-r2-fault>
      - [ ] Inspect today · traffic control if lane edge open <kind:pending-approve> <id:ph-r2-next>
  - Inspected · triage done <id:inspected>
    - Banksia Parade · chainage ~0.8 km · arterial approach · -33.7055, 150.9050 <id:ph-i1>
      - CMMS WO · https://example.invalid/cmms/WO-CV-1902 · P2 · linked citizen CV-88102 <id:ph-i1-url>
      - [x] Inspected Mon · cold-mix candidate · depth 60 mm · width ~350 mm · dry OK <id:ph-i1-insp>
      - Map pin · -33.7055, 150.9050 · eastbound shoulder <id:ph-i1-map>
  - Scheduled · crew booked <id:scheduled>
    - Ridgeway Link · eastbound · distributor · -33.7101, 150.9188 <id:ph-s1>
      - CMMS WO · https://example.invalid/cmms/WO-CV-1888 · P1 · hot-mix preferred <id:ph-s1-url>
      - [ ] Hot-mix patch · Wed 06:00–09:00 · lane closure · VMS · TCP approved <kind:pending-approve> <id:ph-s1-job>
      - Enterprise CMMS mirror · https://example.invalid/eam/WO-10442 · same job · do not double-book <id:ph-s1-eam>
  - Done · closed this week <id:done>
    - Wattle Bend Rd · shoulder · local access · -33.6940, 150.8995 <id:ph-d1>
      - Citizen ticket · https://example.invalid/citizen/CV-87990 · closed Tue · reporter notified <id:ph-d1-url>
      - [x] Cold-mix temp · monitor 14 days · re-open if failure · before/after photo on file <id:ph-d1-done>
      - CMMS close · https://example.invalid/cmms/WO-CV-1871 · Closed · monitor child open <id:ph-d1-cmms>
  - Board summary · 2 reported · 1 inspected · 1 scheduled · 1 closed · P1 oval + Ridgeway <id:board-sum>
  - Lead unlock only <id:secrets>
    - Contractor access pack <private> <id:contractor-pack> (+)
    - Integration unlock pack <encrypted> <id:integration-pack> (+)
    - Depot after-hours pack <encrypted> <id:depot-pack> (+)

--- payloads ---
# PLACEHOLDER = not real ciphertext; host replaces via demo:seal
contractor-pack:
  kid: pot-contractor-1
  alg: demo-aes-gcm
  ct: PLACEHOLDER
integration-pack:
  kid: pot-api-1
  alg: demo-aes-gcm
  ct: PLACEHOLDER
depot-pack:
  kid: pot-depot-1
  alg: demo-aes-gcm
  ct: PLACEHOLDER
---
