---
fold-: courtyard-quotes, payroll, alarm, staff-private, ins-remote
collapsedMarker: "(+)"
---
- ☕ Northside Corner Cafe — ops handoff <id:root>
  - Menu update ideas · spring · P2 · 👍 <id:menu>
    - [ ] Add cold brew flight · board special <kind:pending-approve> <id:menu-coldbrew>
    - [ ] Retire winter pie · low sellers · P3 <kind:pending-approve> <id:menu-pie>
    - [-] Seasonal flat white syrup · supplier TBD <id:menu-syrup>
    - [x] Allergen line on board · approved:Jess · done Wed <id:menu-allergen>
    - pros: weekend tourist traffic · cons: barista training time <id:menu-notes>
    - Board special\nTwo lines (literal backslash-n; 0.2.15) <id:menu-multiline>
  - Seasonal supplier update · Q4 fruit <id:suppliers>
    - Berries · Yarra Valley co-op · ETA next Tue <id:sup-berries>
    - Milk · keep current dairy · no change <id:sup-milk>
    - Coffee · sample bag from Altitude Roasters <id:sup-coffee>
    - [x] Send Friday supplier SMS · approved:sms-bot · auto <id:sup-sms>
    - Order codes / account notes <private> <id:sup-private> (+)
  - Remodel the courtyard · permit in flight · P1 <id:courtyard>
    - [ ] Confirm pavers quote · three bids <kind:pending-approve> <id:courtyard-quotes> (+)
      - Bid A · local mason · ballpark only <id:bid-a>
      - Bid B · landscape crew · includes planters <id:bid-b>
    - [ ] Shade sail colour · match awning <kind:pending-approve> <id:courtyard-sail>
    - [ ] Neighbour note before dig day <kind:pending-approve> <id:courtyard-neighbour>
    - [x] Permit lodged · approved:Sam <id:courtyard-permit>
  - Staff roster · first names only <id:staff>
    - Mon open · Sam · Jess <id:staff-mon>
    - Tue–Wed · Sam · Priya <id:staff-mid>
    - Fri late · Jess · Omar <id:staff-fri>
    - [x] Post Fri late SMS to Omar · approved:sms-bot · auto <id:staff-sms>
    - Close-down checklist\nMop floors · stack chairs\nCash to safe · arm alarm <id:staff-close>
    - Barista handbook excerpt (fiction) · more/less demo\n1. Arrive 6:15 · lights · music low\n2. Purge group heads · 3 sec each\n3. Dial in house blend · 18g in\n4. Target 36g out · 27-30 sec\n5. Taste one shot before doors\n6. Milk jugs chilled · steam wand wiped\n7. Oat · soy · almond on the left\n8. Cups warmed on the machine top\n9. Pastry case filled by 6:45\n10. Label anything cut open today\n11. Allergen board matches the case\n12. Float counted · $200 in the till\n13. Doors open 7:00 sharp\n14. Greet within ten seconds\n15. Repeat the order back\n16. Names on cups · first name only\n17. Flat white · 160ml · thin foam\n18. Latte · 220ml · a little more foam\n19. Cappuccino · chocolate on top\n20. Long black · water first\n21. Cold brew · 12h steep · keep 2 jugs\n22. Chai · house syrup · no powder\n23. Wipe the wand after every jug\n24. Knock box emptied at half full\n25. Backflush at 11:00 and 14:00\n26. Restock cups before the lunch rush\n27. Tables cleared within five minutes\n28. Courtyard umbrellas down if windy\n29. Last coffee order 15:30\n30. Soak portafilters in cleaner\n31. Grinder hopper emptied and brushed\n32. Milk dated and back in the fridge\n33. Floors mopped · chairs up\n34. Lights off · alarm armed · door checked <id:staff-handbook>
    - Full staff list + emergency contacts <private> <id:staff-private> (+)
  - Secrets · manager only <id:secrets>
    - Payroll portal link + pay-run notes <private> <id:payroll> (+)
    - Alarm code / arming notes <encrypted> <id:alarm> (+)
    - Vendor insurance cert (remote blob) <encrypted> <id:ins-remote> (+)

--- payloads ---
alarm:
  kid: cafe-alarm-1
  alg: demo-aes-gcm
  ct: d5GKTRZz_bevxCLla30bezDR9EqnDfFZLbj06WcqP5yxPQ7D1V4ifDUdlTDnrnrucKZDARUhRb8Y264r7gT7PAS9ObvOK8EL3kXZ8EjoWIeEhoHzPA
payroll:
  kid: cafe-payroll-1
  alg: demo-aes-gcm
  ct: F8LoZO7Bj-qYP5R93KlcWQn7rGbTqjYS6dSuNv4dgMsaGyhUsgW1NZq1Ix6a4v9LC8UgF_W6OqEoIAEZfFdZmDCLIpwdOZBFK7AY0YxIRk5qjG7WZkZUpKstqoW7mA
staff-private:
  kid: cafe-staff-1
  alg: demo-aes-gcm
  ct: NgVBgsayYos_Jyj0xUz0BgQbVxpM6_Jc1SZ5byLX8MqfxqWV4WJuruNbdlYoL4JE-voicrmbjdyBTNPLtQGl3m3XoE0SM4qeUcnpqD4JAiA_h6clyuS48hhXRYp6e-XF65SHuDc9pUFoDghrprm2wU5ML_tmelMqmVBjTQ
sup-private:
  kid: cafe-sup-1
  alg: demo-aes-gcm
  ct: -6_IZecRJeIrHro6f02fCt-zlQWOPkmK5U3dQhSp6RvOTy7GbHz0oQvY1p5uSbeBdvvf-_jTPoJq-w_SbtEIgndD
ins-remote:
  kid: cafe-ins-1
  alg: demo-aes-gcm
  uri: https://example.invalid/sealed/cafe-ins-1.bin
---
