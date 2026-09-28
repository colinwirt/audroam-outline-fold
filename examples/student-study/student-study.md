---
fold-: portal-pack, recovery-pack, assessment-pack
collapsedMarker: "(+)"
---
- 📚 Mira Vale — study board · week of 22–28 Sep · Willow Creek High + Bayshore Uni <id:root>
  - ⚠️ FICTION DEMO · no real student accounts · ct=PLACEHOLDER until demo:seal <id:banner>
  - Method · Cornell + outline (tutor-safe) <id:method>
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
    - [x] Membrane diagram labelled · peer-reviewed Mon · lodged LMS <id:bio-diagram>
    - Summary: membranes gate traffic; gradients + protein helpers decide direction <id:bio-sum>
  - Uni · COMP101 · sorting · Bayshore University · lab week 3 <id:comp>
    - Notes · bubble O(n²) · insertion O(n²) · merge O(n log n) · quick avg O(n log n) worst O(n²) <id:comp-notes>
      - Stable: merge · insertion · (typical) bubble · equal keys stay ordered <id:comp-stable>
      - When n is tiny · prefer simple in-place · less constant overhead <id:comp-tiny>
      - Merge needs O(n) aux · quick in-place but pivot choice matters <id:comp-space>
    - Cue: which of ours are *stable*? name two <id:comp-cue1>
    - Cue: worst-case merge vs quick — which is bounded · why? <id:comp-cue2>
    - Cue: when is bubble acceptable in production? (almost never — teaching only) <id:comp-cue3>
    - [ ] Lab 3 · implement merge · autograder Fri 17:00 AEST <kind:pending-approve> <id:comp-lab>
    - [-] Optional stretch · visualiser gif for tutor slides <id:comp-stretch>
    - Study buddy · Thu 19:00 library L2 · cue card deck <id:comp-buddy>
    - Summary: pick sort by size · stability · memory budget — not textbook order <id:comp-sum>
  - Exam week guardrails · cleartext only <id:guard>
    - No all-nighters before Bio quiz · sleep beats cram for membrane cues <id:guard-sleep>
    - Phone DND during 25-min recall blocks · then 5-min break <id:guard-dnd>
    - Account unlock packs stay sealed — never paste into chat or tutor pastebins <id:guard-seal>
  - Student unlock only <id:secrets>
    - School portal unlock pack <private> <id:portal-pack> (+)
    - Account recovery pack <encrypted> <id:recovery-pack> (+)
    - Timed assessment unlock pack <encrypted> <id:assessment-pack> (+)

--- payloads ---
# PLACEHOLDER = not real ciphertext; host replaces via demo:seal
portal-pack:
  kid: study-portal-1
  alg: demo-aes-gcm
  ct: PLACEHOLDER
recovery-pack:
  kid: study-recovery-1
  alg: demo-aes-gcm
  ct: PLACEHOLDER
assessment-pack:
  kid: study-assess-1
  alg: demo-aes-gcm
  ct: PLACEHOLDER
---
