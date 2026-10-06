---
fold-: depot-pack, cmms-pack, cabinet-pack
collapsedMarker: "(+)"
---
- 💡 Shire of Cedarvale · streetlamp night run · crew B → C · 28 Sep 22:15–01:30 <id:root>
  - Run rules · council-owned LED / HPS <id:rules>
    - Spot faults by **pole ID** · not street-name-only · log closed vs open + parts <id:rules-pole>
    - Fault classes: lamp out · dayburner · cycling · structural/RTC · vegetation · whole-spur/fuse <id:rules-fault>
    - Priority: make-safe first · fuse / multi-dark next · PE-cell dayburner → day shift · veg → Parks <id:rules-pri>
    - Pole coordinates are lat, lon · work orders link to the CMMS <id:rules-map>
  - Banksia Parade · LED circuit BP-N · major collector <id:banksia>
    - Pole CV-SL-1204 · -33.7048, 150.9062 · lamp out · night dark <id:bp-1204>
      - [x] Relamp LED driver · done 21:40 · van stock · WO https://example.invalid/cmms/WO-CV-2011 <id:bp-1204-done>
    - Pole CV-SL-1211 · -33.7051, 150.9070 · dayburner · PE cell suspect <id:bp-1211>
      - [ ] Swap PE cell · open · ETA Tue day shift · minor ~15 min <id:bp-1211-open>
      - CMMS · https://example.invalid/cmms/WO-CV-2014 · P2 · 2 business days <id:bp-1211-url>
    - Pole CV-SL-1218 · -33.7054, 150.9078 · cycling · flicker ~40s <id:bp-1218>
      - [ ] Inspect connector · open · torque kit + spare driver <id:bp-1218-open>
      - CMMS · https://example.invalid/cmms/WO-CV-2015 · P2 <id:bp-1218-url>
  - Curlew Circuit · mixed HPS/LED · loop C2 · school-zone approach <id:curlew>
    - Pole CV-SL-2088 · -33.6985, 150.9195 · whole spur dark · fuse at cabinet C2? <id:cc-2088>
      - [ ] Check fuse · cabinet C2 · pending traffic control · make-safe if live hazard <kind:pending-approve> <id:cc-2088-fuse>
      - CMMS · https://example.invalid/cmms/WO-CV-2008 · P1 · multi-dark · notify road auth if >2BD <id:cc-2088-url>
      - Ownership council · not network utility · no underground ticket yet <id:cc-2088-own>
    - Pole CV-SL-2093 · -33.6989, 150.9202 · mast arm dent · vehicle strike note <id:cc-2093>
      - [x] Make-safe tape + tag · done 23:05 · structural WO raised · column follow-up <id:cc-2093-safe>
      - CMMS · https://example.invalid/cmms/WO-CV-2009 · structural · day crew · 28 days <id:cc-2093-url>
  - Ironbark Way · park path lights · council-owned · low hierarchy <id:ironbark>
    - Pole CV-SL-3310 · -33.7018, 150.9130 · vegetation blocking · trim → Parks <id:iw-3310>
      - [ ] Parks assist · Wed AM · no EWP trim without Parks OK <id:iw-3310-trim>
      - CMMS · https://example.invalid/cmms/WO-CV-2018 · P3 · linked Parks PK-441 <id:iw-3310-url>
    - Summary: 2 closed · 4 open · priority fuse on Curlew · PE cell + cycling on Banksia <id:run-sum>
  - Access <id:secrets>
    - Depot gate code <encrypted> <id:depot-pack> (+)
    - CMMS night login <private> <id:cmms-pack> (+)
    - Cabinet key numbers <encrypted> <id:cabinet-pack> (+)

--- payloads ---
depot-pack:
  kid: lamp-depot-1
  alg: demo-aes-gcm
  ct: f9cNBMThdVmi7lEEe6cXtEmZ2PIDiw4TWK7LQvU-fyjUwQJXa6WY5ATzkJfI24QfZa-f5k7jnAhyulqVBl3DoGZRMUCEIzPOGVz36mY6PD0wOpwKY6E6_mvrxHxM9O6C_UTh
cmms-pack:
  kid: lamp-cmms-1
  alg: demo-aes-gcm
  ct: wmxGcHnlF0aPe3cDcjNpDwVXC_HmqNLZAAWtwhby4Pkx4q8Q6Ce5bgIGYySCnjzCKrSYoSVypEZ_8-uhBO8Fg0F3boeZ1dKbYrjde8FkMjNntsGb
cabinet-pack:
  kid: lamp-cab-1
  alg: demo-aes-gcm
  ct: qW1mo-rAVYtulzMeOT6JBPV319tvIamsPYt2WoJAOT5GtNjv5AUUftWkMmUNsgfMb12h30KUBG5bJUlNF1gRLcEnriNphZdioA8Eb-PL_n7o0AGnOJ6WaqEBS4yXafsMXYPVVXgO
---
