# Duckies Pop — Playable Ad Submission

**Play it:** https://iagolicht.github.io/duckies-playable/
**Source:** this repository — see [README.md](README.md) for architecture, tooling and how every number was measured.
Also provided as a single self-contained HTML file (`duckies_timer_lose_rigged.html`) that opens with a double-click, no server.

## Concept Introduction

Before designing the playable, I played through more than 100 levels of Duckies Pop to identify the mechanics that are the easiest to understand, most satisfying, and best suited for a short playable ad experience.

I focused on three core mechanics: Wall Bounce, Oysters, and Barrels. They are intuitive, visually satisfying, and closely represent the real game without requiring too much explanation.

The main industry trend I borrowed from is the Near Win / Near Miss structure. The first level is intentionally easier and designed to give the player a quick win. The second level is more challenging but still feels achievable, bringing the player very close to success before time runs out. The experience then ends with a loss popup and a Play Now CTA that redirects to the Duckies Pop store page.

I added a 30-second timer on top of the game's tight move budget, so that time — not moves — is the limit that actually decides the run, creating more urgency. I also shortened the Ducky explosion and respawn flow to reduce downtime and better fit the faster pacing of the timed experience.

I tried to stay as close as possible to the original Duckies Pop gameplay loop, mechanics, UI, animations, and popups. At this stage, I believe a real gameplay playable is the better approach, since making the ad too different from the actual product could hurt downstream KPIs after install.

I created ten different levels during development and selected the two that best supported this flow. The playable can also run only the final Near Miss level if a shorter marketing experience is preferred.

## Additional Iteration

For an additional iteration, I would test the opposite outcome: a Near Miss experience where the player narrowly wins, instead of losing at the end.

This would allow us to compare performance signals between the two experiences and understand which outcome drives stronger results, then iterate further in that direction.

I would also change the map and level layout to make the variation feel distinct while keeping the same core mechanics and overall gameplay structure.

## Additional Concept

An additional concept was a playable where barrels continuously move around the board along a conveyor-like square path. The player would need to destroy all moving barrels before time runs out, making each shot more dynamic by requiring better timing and prediction.

After playing more than 100 levels of Duckies Pop, I did not encounter a similar moving-barrel mechanic. To keep the playable consistent with the actual game experience, I chose not to introduce mechanics that players would not encounter after installing the game.

---

*Assets © Candivore, used solely for this evaluation; the repository and hosted page will be taken down after review on request.*
