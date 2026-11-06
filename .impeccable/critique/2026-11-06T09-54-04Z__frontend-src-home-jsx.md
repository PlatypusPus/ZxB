---
target: ZenithXBeans website
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
target_identity: "file:E:\\ZenithXBeans\\frontend\\src\\Home.jsx"
target_fingerprint: "sha256:4bc8db72cdf6fa833b8816f477ec2843a1cd3ed85e0dea19194a3cec142455e6"
target_path: "E:\\ZenithXBeans\\frontend\\src\\Home.jsx"
timestamp: 2026-11-06T09-54-04Z
slug: frontend-src-home-jsx
---
Method: dual-agent (A: design review · B: detector + browser)

## Design Health Score: 25/40 (before fixes)
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of status | 3 | Pre-auction projector shows no time |
| 2 | Real-world match | 3 | "8 of 5 + subs" unclear |
| 3 | User control | 2 | Signup lost on UPI app switch |
| 4 | Consistency | 3 | .mono class name vs label voice |
| 5 | Error prevention | 2 | Submit possible with no UPI ID; screenshot not marked required |
| 6 | Recognition | 3 | Base prices unsorted |
| 7 | Flexibility | 2 | No accelerators outside admin |
| 8 | Minimalist | 3 | Repeated card grids on Persuade pages |
| 9 | Error recovery | 2 | No focus to first error; dead-end leader link |
| 10 | Help | 2 | Refund policy/terms referenced but not published |

## Specificity verdict
Live surfaces (projector, leader, stamp, tile timer) are authored; Home and Draft below the hero fall back to SaaS template sections (01/02/03 card rows, card grids, FAQ). The auction itself is never shown on the marketing pages.

## Priority issues
- [P0] Signup state lost when leaving for the UPI app (fixed: sessionStorage draft, returning-user notice)
- [P1] Payment step under-designed (fixed: numbered pay panel, payee, required screenshot, submit blocked without UPI ID). Open: rulebook/refund/privacy pages don't exist.
- [P1] Projector not room-legible; dead pre-show (fixed: 1.3vw floors, plurals, event date). Open: proper lobby with 8 slots, countdown, QR.
- [P2] Persuade pages repeat template sections and never show the auction (open)
- [P2] Errors don't move focus; leader invalid link dead end (fixed)

## Detector
CLI clean. Browser: ink-on-red contrast 4.04:1 (fixed, red → #cc2a1a), live-dot blink ignores reduced motion (fixed), placeholder contrast (fixed), signup h1→h3 skip (fixed), long FAQ measure (minor, open).
