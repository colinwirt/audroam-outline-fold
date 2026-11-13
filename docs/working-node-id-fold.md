# Working note: node ids and fold state

Checkout `fix/follow-after-fold`, branched from `4a2e754` (v0.7.2).

Two ids. `__sid-N` is the only temporary id. It is the session view key (Map, focus, Follow in text) and, when a line needs a name, `node.id` with `autoId`. Callers that store it are `parse({ sessionIds: true })`, a region row, a zone row, and a fold. The index adopts that string so fold and Follow name one reference. Sync does not write a session id onto a line that does not have one. Serialize does not write `__sid-`. The authored `<id:N>` is the reference that round-trips. When a width, colour, icon, payload, jump, or fold+ entry must survive reload, `assignPersistentId` replaces the session id and renames the fold entry. `__tmp-N` is no longer minted.

```mermaid
sequenceDiagram
  autonumber
  participant Map
  participant Index as SessionIndex
  participant Node
  participant Fold as doc.fold.ids
  participant Ser as serialize
  participant Parse
  participant Follow as Follow in text

  Note over Map,Follow: Fold a line that has no authored id
  Map->>Index: keyOf(node)
  Index-->>Map: session id __sid-4
  Map->>Node: foldRef stores __sid-4 and autoId
  Map->>Fold: toggleFold(__sid-4)
  Note over Fold,Follow: Fold and Follow name the same id
  Map->>Ser: setDoc of the folded tree
  Ser->>Node: write (+) while fold.ids still lists __sid-4
  Ser->>Fold: the layout block omits __sid-4 under fold-
  Ser->>Parse: host setText, parse again
  Parse->>Node: new object, no id, foldMark = collapsed
  Parse->>Index: sync carries __sid-4 by the line map
  Note over Index,Node: Sync does not write __sid-4 back onto the node
  Index-->>Follow: lineOf(__sid-4) is the new line

  Note over Map,Follow: A later edit assigns an authored id while the session id is still on the node
  Map->>Node: assignPersistentId
  Node->>Node: id becomes 12, autoId cleared
  Node->>Fold: the __sid-4 entry is renamed to 12
  Map->>Ser: serialize
  Ser->>Node: the line keeps (+) and gains the authored id
```
