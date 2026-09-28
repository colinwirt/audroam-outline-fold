---
fold-: contacts-pack, excursion-pack, conference-pack, care-pack
collapsedMarker: "(+)"
---
- 🏫 Jordan Hale · Yr 7 · shared handoff · Ms Rivera ↔ family · week of 22 Sep <id:root>
  - ⚠️ FICTION DEMO · no real student/family PII · ct=PLACEHOLDER until demo:seal <id:banner>
  - Privacy boundary · cleartext rules (AU / Vic-shaped fiction) <id:privacy>
    - Observable strengths + home actions only · no other students named <id:priv-rules>
    - Sensitive packs stay sealed · need-to-know unlock · not for LLM/tutor paste <id:priv-seal>
    - Channel: school portal message · reply by Wed · avoid casual SMS for care topics <id:priv-channel>
  - This week · strengths (observable · factual) <id:strengths>
    - Finished Science poster early · clear labels · glossary terms used correctly <id:str-science>
    - Helped peer with group roles · recess project · stayed on task 15 min <id:str-peer>
    - Reading stamina up · 20 min unbroken Tue · asked one clarifying Q <id:str-read>
    - Maths warm-up · 8/10 fraction-of-a-set visuals · up from Mon 5/10 <id:str-maths>
  - Learning focus · next 5 school days <id:focus>
    - Maths · fraction of a set · concrete → pictorial → abstract <id:focus-maths>
    - Writing · topic sentence before detail · then one evidence sentence <id:focus-write>
    - Cue for home: after reading · ask “what is the main claim?” · one sentence <id:focus-cue>
    - Science · labelled diagram checklist · due Fri <id:focus-sci>
  - Home actions · optional but useful <id:home>
    - [ ] 10 min fraction cards · Mon / Wed · show working on scrap paper <id:home-fractions>
    - [ ] Library bag return · due Thu · overdue stops borrowing <id:home-library>
    - [x] Permission slip for garden day · received · lunch order still open <id:home-garden>
    - [ ] Pack hat + water bottle · sport Thu · house shirt if clean <id:home-sport>
  - Upcoming · calendar safe to share <id:upcoming>
    - Learning showcase · Fri 14:30 hall B · families welcome · 20 min slots <id:up-showcase>
    - [ ] Confirm attendance · by Wed 15:00 · portal RSVP <kind:pending-approve> <id:up-rsvp>
    - Literacy warm-ups · next fortnight · practice window (no scores in cleartext) <id:up-lit>
  - Family / staff unlock only <id:sensitive>
    - Family contact pack <private> <id:contacts-pack> (+)
    - Excursion care pack <private> <id:excursion-pack> (+)
    - Conference prep pack <encrypted> <id:conference-pack> (+)
    - Staff care pack <encrypted> <id:care-pack> (+)

--- payloads ---
# PLACEHOLDER = not real ciphertext; host replaces via demo:seal
contacts-pack:
  kid: tp-contacts-1
  alg: demo-aes-gcm
  ct: PLACEHOLDER
excursion-pack:
  kid: tp-excursion-1
  alg: demo-aes-gcm
  ct: PLACEHOLDER
conference-pack:
  kid: tp-conf-1
  alg: demo-aes-gcm
  ct: PLACEHOLDER
care-pack:
  kid: tp-care-1
  alg: demo-aes-gcm
  ct: PLACEHOLDER
---
