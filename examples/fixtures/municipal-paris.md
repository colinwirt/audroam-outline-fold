---
fold-: contractor-pack, integration-pack
collapsedMarker: "(+)"
---
- 🛣️ Mairie de Valmont · Voirie nord · signalements · 29 sep matin <id:root>
  - Signalements via l’app citoyenne · ordres de travail dans la GMAO · retour au signaleur <id:flow>
  - Ouverts <id:open>
    - Rue des Tilleuls · milieu de trottoir · 48.8845, 2.3261 <id:fr-r1>
      - Citoyen · https://example.invalid/signal/VN-2201 · P2 · photo · piste cyclable <id:fr-r1-url>
      - Défaut: nid-de-poule · ~40 cm · ~5 cm · enrobé à froid si OK <id:fr-r1-fault>
      - [ ] Inspection mercredi · secteur N3 <id:fr-r1-next>
    - Avenue du Parc · entrée école · 48.8820, 2.3310 <id:fr-r2>
      - Citoyen · https://example.invalid/signal/VN-2218 · P1 · flaque <id:fr-r2-url>
      - [ ] Inspection jour même · balisage si bord cassé <kind:pending-approve> <id:fr-r2-next>
  - Planifiés <id:sched>
    - Quai des Mariniers · sens est · 48.8795, 2.3188 <id:fr-s1>
      - GMAO · https://example.invalid/cmms/OT-VN-990 · P1 · enrobé à chaud · 06h–09h <id:fr-s1-url>
      - [ ] Patch mercredi · circulation alternée <kind:pending-approve> <id:fr-s1-job>
  - Clos <id:done>
    - Impasse des Saules · 48.8860, 2.3220 <id:fr-d1>
      - Citoyen · https://example.invalid/signal/VN-2102 · clos · notifié <id:fr-d1-url>
      - [x] Froid temporaire · suivi 14 j <id:fr-d1-done>
  - Accès <id:secrets>
    - Identifiants portail prestataire <private> <id:contractor-pack> (+)
    - Clé API GMAO <encrypted> <id:integration-pack> (+)

--- payloads ---
contractor-pack:
  kid: fr-contractor-1
  alg: demo-aes-gcm
  ct: SnKZSMYEChVPENWoMJfzFgdStSgq_hurK-CE1g1Op7aBBZHQ1o1se385s8x0qCrc9EeyUvEQuLmhe370yuOx0cX3DvYlnzQ2RDnXOfvLhRd4p_lz6kKQ9vo
integration-pack:
  kid: fr-api-1
  alg: demo-aes-gcm
  ct: Q9GWQyFN_vz6PjoCikw2jsEc-ufUwhJmIKtznurqpxg-ay7sskYwAHzLFdYIXqSUD0GIV3M8IHGi31ih98CWw2ET2_hDljyo
---
