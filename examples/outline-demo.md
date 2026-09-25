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
  ct: xjxUt4blu4NhjSyB_TeX81yahLQLa68II5C7Yh7EJ1Y67R_y3x8raf8dycxV7_uHDg0I4PLJ640qdklRULDrI18J15DhyIsbtyJ8QYvP7VN_rxXnQg
payroll:
  kid: cafe-payroll-1
  alg: demo-aes-gcm
  ct: CxctqFsCKAjeTg_7rui8xnemiNICQYxHPM-BtPV154wMQa-2FbQ6LNZHJ_9Pw2ezIW8Ar68pEy3j5F3xkWqWgFLItBNAYFV0CFWmhsW0M-l0qUB51OnY9TY4prnbRw
staff-private:
  kid: cafe-staff-1
  alg: demo-aes-gcm
  ct: bbqmcQ5F7I-KKm8_38zQ3vVNdZt7GUB9mOm8msflPipn477YL5zWa62DG7BX-2DW1keeiZYCOEXlJSO6_fNHDJB_s4yOxnJle4kWoyg6bOoi0uzOPCjTSWzwD-9F89BxgFwLAVfMYiyNwRaTwaTcHsfzArwlhQ
sup-private:
  kid: cafe-sup-1
  alg: demo-aes-gcm
  ct: 0A9HCkVgKUdLZVvYsFjbQGvIbm4y_vxeyNrWso_Ga554pMOBvaWYYvVsDH1qhgRpxfKpUiAU8PhQVo_w2lQTrb6x
ins-remote:
  kid: cafe-ins-1
  alg: demo-aes-gcm
  uri: https://example.invalid/sealed/cafe-ins-1.bin
---
