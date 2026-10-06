---
fold-: portal-pack, recovery-pack, assessment-pack
collapsedMarker: "(+)"
---
- 📚 Mira Vale · study board · week of 22–28 Sep · Willow Creek High + Bayshore Uni <id:root>
  - Method · Cornell notes + outline <id:method>
    - Cue column = questions written *after* notes · not headings <id:method-cue>
    - Cover notes · recite aloud · then check · 5 Rs: record · reduce · recite · reflect · review <id:method-5r>
    - Summary strip = 2–3 sentences from memory · one page at a time <id:method-sum>
    - Spaced recall · Bio cues Mon/Wed · COMP cues Tue/Thu · phone DND during blocks <id:method-spaced>
  - School · Biology · cell membranes · Yr 11 · Willow Creek High <id:bio>
    - Notes · fluid mosaic · phospholipid bilayer · selective permeability · embedded proteins <id:bio-notes>
      - Passive: O₂ · CO₂ · small nonpolar · osmosis via aquaporins <id:bio-notes-pass>
      - Active / facilitated: ions · glucose · channels or pumps + energy or gradient <id:bio-notes-act>
      - Tonicity: hypertonic → water *out* · hypotonic → water *in* · isotonic = net zero <id:bio-notes-ton>
    - Cue: what crosses freely vs needs a channel or pump? <id:bio-cue1>
    - Cue: hypertonic bath — which way does water move · why? <id:bio-cue2>
    - Cue: why does a red blood cell burst in distilled water? <id:bio-cue3>
    - [ ] Worksheet 4 · due Fri · ch.5 end · diagram + 3 cue answers <id:bio-ws>
    - [x] Membrane diagram labelled · peer-reviewed Mon · uploaded <id:bio-diagram>
    - Summary: membranes gate traffic; gradients + protein helpers decide direction <id:bio-sum>
  - Uni · COMP101 · sorting · Bayshore University · lab week 3 <id:comp>
    - Notes · bubble O(n²) · insertion O(n²) · merge O(n log n) · quick avg O(n log n) worst O(n²) <id:comp-notes>
      - Stable: merge · insertion · (typical) bubble · equal keys stay ordered <id:comp-stable>
      - When n is tiny · prefer simple in-place · less constant overhead <id:comp-tiny>
      - Merge needs O(n) aux · quick in-place but pivot choice matters <id:comp-space>
    - Cue: which of ours are *stable*? name two <id:comp-cue1>
    - Cue: worst-case merge vs quick — which is bounded · why? <id:comp-cue2>
    - Cue: when is bubble acceptable in production? <id:comp-cue3>
    - [ ] Lab 3 · implement merge · autograder Fri 17:00 <kind:pending-approve> <id:comp-lab>
    - [-] Optional stretch · visualiser gif for tute slides <id:comp-stretch>
    - Study buddy · Thu 19:00 library L2 · cue card deck <id:comp-buddy>
    - Summary: pick sort by size · stability · memory budget — not textbook order <id:comp-sum>
  - Exam week <id:guard>
    - No all-nighters before Bio quiz · sleep beats cramming <id:guard-sleep>
    - 25-min recall blocks · phone on DND · 5-min break <id:guard-dnd>
    - Bio quiz Mon 9:00 · room S4 · bring calculator <id:guard-seal>
  - Logins <id:secrets>
    - School portal <private> <id:portal-pack> (+)
    - Account recovery codes <encrypted> <id:recovery-pack> (+)
    - Exam portal access <encrypted> <id:assessment-pack> (+)

--- payloads ---
portal-pack:
  kid: study-portal-1
  alg: demo-aes-gcm
  ct: LCCmgzLPkV5og2gl1dTR0_jSLqPxUWd7NEWugRJQ9eS9f3S6GR3FFx68whdjd-H6dj624dWuJyMHx1QZPXGXLYfCU22VkrWDkhl-SFEUIYq7_t8AcXk_ornDMhfn
recovery-pack:
  kid: study-recovery-1
  alg: demo-aes-gcm
  ct: lHcx8GoM3xaFmeHFJ7ZuDpS3Z8TafbdX0th-TkWBwjJU05Rb8j9TidZt1shgg7Nhu2Wv5uj_gtn6XT6mhuFINNX1MLAO0JHIIi0CNKvZYwwnL2plpHRkdANJoimac6KGrlja10Rlj_Wohw7C-R0
assessment-pack:
  kid: study-assess-1
  alg: demo-aes-gcm
  ct: HK6YQ7O1mToFfGKfy94IHSmyXZ_j2k1fM0QDpfhfqRqcKbOVbHKN5kvSElA08ZuYQMVVVJUgI7BE4WVaxLMprVre_hkGs6eaSSPZW8ahXSLX0uXpltDCtVl9
---
