---
fold-: contractor-pack, integration-pack, depot-pack
collapsedMarker: "(+)"
---
- 🛣️ Kāinga District Council · roads + lamps · 29 Sep AM <id:root>
  - Reports come in from the council app · work orders in RAMM · reporter gets status updates <id:flow>
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
  - Access <id:secrets>
    - Contractor portal login <private> <id:contractor-pack> (+)
    - RAMM API key <encrypted> <id:integration-pack> (+)
    - Depot after-hours code <encrypted> <id:depot-pack> (+)

--- payloads ---
contractor-pack:
  kid: nz-contractor-1
  alg: demo-aes-gcm
  ct: Kk-6VvRt_jZuP4ksNUkq8ibROmdSXYeGVtt6lJQ9XYfQzNvd64DtHsiH_N36ZKih18fEBKTKsF87ixFjMJ6yfG8sCzcnuE07gYL5nDgSgdi6U4dM_YpnbLw
integration-pack:
  kid: nz-api-1
  alg: demo-aes-gcm
  ct: JaCkRmMfxzRm8YCg9TDJGXzMTjuY_SDR3HPFHivPYrWKZr1H0dmAgUJYgXHcnrS7a4_ZwWAuQAYxV9CpbbpZDUSQyxsYEHc
depot-pack:
  kid: nz-depot-1
  alg: demo-aes-gcm
  ct: eDIT-NxUZK1_U8K7cP9Xi--4OmXjqaepM6EJy53AfNsy5bhe5ptz0PJtBq37MiQt9tbdYOSHlKi9jQV_dO-a2IE
---
