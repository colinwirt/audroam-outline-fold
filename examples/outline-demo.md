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
