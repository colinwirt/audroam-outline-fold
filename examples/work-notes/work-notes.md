---
fold-: deploy-pack, secrets-store
collapsedMarker: "(+)"
---
- 💼 Lumen Analytics · squad handoff · Alex → Priya · 28 Sep 22:40 <id:root>
  - Done this shift <id:done>
    - [x] Invoice export CSV · ticket LA-1842 · merged main · staging green <id:done-csv>
    - [x] Staging smoke · payments happy path · 12/12 · no flaky retries <id:done-smoke>
    - Decision: keep legacy column `amt_cents` one more sprint · Finance still maps offline <id:done-decision>
    - Decision rationale: drop would break Q3 reconciler · revisit after LA-1850 sign-off <id:done-why>
  - In progress <id:wip>
    - Refunds webhook · retry backoff · PR #418 draft · https://example.invalid/pr/418 · ~70% <id:wip-webhook>
      - Next: idempotency key on 409 · then review from Sam <id:wip-webhook-next>
    - Copy tweak on empty-state · waiting on design <id:wip-empty>
      - Figma · https://example.invalid/figma/empty-state-v3 <id:wip-empty-figma>
  - Blockers <id:block>
    - Wait on Finance sign-off · LA-1850 · owner: Kai · hard due Tue 11:00 · escalate: Maya <id:block-finance>
    - Staging Redis flap · paged 21:12 · auto-recovered · watching error budget <id:block-redis>
      - Watch: repeat Tue AM peak · dashboard https://example.invalid/dash/payments-p99 <id:block-redis-watch>
  - System health · last 24h <id:health>
    - payments API p99 · 180 ms vs 7d avg 160 ms · within SLO <id:health-p99>
    - error budget tier-1 payments · ~72% remaining · was 80% at shift start · watch Redis <id:health-eb>
  - Next 12h · Priya <id:next>
    - [ ] Land PR #418 · then flip feature flag `refunds_v2` <kind:pending-approve> <id:next-flag>
    - [ ] Ping Kai if Finance silent by 11:00 · escalate Maya if no reply by 12:00 <id:next-ping>
    - Risk: flag-on without Finance OK → reverse via runbook R-12 · no hot-patch prod <id:next-risk>
    - Alex back Wed 09:00 · async only unless live P0 <id:next-return>
  - Links <id:links>
    - Board · sprint 19 · Doing · https://example.invalid/board/s19 <id:link-board>
    - Runbook R-12 · feature-flag rollback · https://example.invalid/rb/R-12 <id:link-runbook>
    - Incident · Redis flap log · https://example.invalid/inc/redis-2809 <id:link-inc>
    - PR #418 · https://example.invalid/pr/418 <id:link-pr>
  - Access <id:secrets>
    - Deploy key <encrypted> <id:deploy-pack> (+)
    - Staging admin login <private> <id:secrets-store> (+)

--- payloads ---
deploy-pack:
  kid: work-deploy-1
  alg: demo-aes-gcm
  ct: O4hGfWJcgELIo4UHVzlZ4cnXSeKel2Eavg6QaePX50XPWx6tHH4O8RtqLOXtU4sB3fj9jr6DW8WxDUn--uY3zo2zAe9h3SJYB4UmIlB1MEOaVcBHgs3vg0eczIN0urv667iQ5sJtyK7GZpzPfuFnvhjP5WRP
secrets-store:
  kid: work-store-1
  alg: demo-aes-gcm
  ct: Zsn5lrIvOcoOkxKIJpIP9JcilXDzL-E2FTiF8dExSUDH2liCNtPS7ysSwUrK9rQpz0PreS0uoFNitCtJH09mpKRW57P3T3T2-N-1xm2YFq47WyirtsRhQPML2F9UzPw0uyBvVaU
---
