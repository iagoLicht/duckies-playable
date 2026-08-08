# Every duck on its own clock — per-duck pops, per-pop respawns

**Date:** 2026-08-08
**Status:** implemented
**Reverses:** the "one bang, not a drum roll" rule of 2026-08-07, and the
settle-gated respawn of the same day.

## The problem

Two rules made a turn wait for the whole board:

1. **Pops were held to the slowest victim.** `tickFuses` decided readiness per
   duck but detonated the whole doomed set on one frame, so a blast that caught
   four ducks paid out only once the last of them had finished sliding.
2. **Respawns waited for `boardSettled()`** — nothing in flight, no fuse
   blinking, no pearl climbing. A chain that took two seconds to unwind left the
   board visibly short for all of it, and only then started `RESPAWN_DELAY`.

Both were deliberate, and both cost the ad time it does not have.

### Decisions (user, 2026-08-08)

| question | decision |
| --- | --- |
| when does a doomed duck pop? | **when IT stops moving.** No waiting for the rest of the doomed set. |
| what does a replacement wait for? | **its own pop, and nothing else** — `RESPAWN_DELAY` from the pop that owes it, board state irrelevant. Ducks may land while a chain is still going off. |
| does a contact match still burn its fuse? | **yes.** The 0.6 s blink is the tell that a duck is doomed; only the wait-for-siblings gate goes. |

## Per-duck pops — `world.ts`

The set-wide `ready` flag becomes a per-duck filter. Everything else about
readiness is untouched: a duck still needs to be dead still for
`BLAST_SETTLE_CONFIRM_TICKS`, and a contact match still needs its full fuse on
top of that, so nothing pops mid-glide.

**The two-pass structure stays, and it is load-bearing.** A pop's blast SHOVES
its neighbours, so deciding inside the pop loop would let the first pop knock a
duck already judged ready back to zero settle ticks — and which ducks that hit
would depend on iteration order. Decide who is ready, then pop them.

The stutter the old rule removed is accepted knowingly. It is smaller than it
was when the trade was first made: the fuse is 0.6 s now, not the official's
1.5 s, so victims spread over a much shorter window.

## Per-pop respawns — `director.ts`

`respawnAt` (one board-wide timer) becomes `respawnDue` (a queue of world times,
one entry per duck popped). A `duckPopped` event books a debt at
`world.time + RESPAWN_DELAY`; each step, every debt that has come due is spent
and the field is filled by that many, clamped to `fieldTarget`.

The `boardSettled()` gate is gone entirely — that is the change.

**The fallback matters more than it looks.** When the field is short but nothing
is booked (an authored board opening short, a duck removed some other way), the
whole shortfall is booked at once rather than a single duck. Booking one and
re-arming next tick is exactly the duck-per-delay dribble that was taken out on
2026-08-07, and it would have come back through this path — caught by the
existing "the whole owed batch arrives on one frame" test, which is why that
test is worth keeping.

Note the consequence: because pops are now staggered, their debts come due
staggered, so replacements arrive staggered too. The "one frame" batch survives
only where the pops themselves shared a frame. That is coherent — each duck's
replacement tracks its own pop — but it does partially undo the batching of
2026-08-07.

## Tests

Six tests asserted the removed rules and now assert the new ones:

- `chains.test.ts` — the pair pops on two frames, not one; the knocked partner
  goes on the exact frame its fuse expires (the earliest a contact match ever
  may). The crowd of four bystanders now spreads across several frames, and is
  identified **by colour** rather than by "everything after the first pop" —
  with the pair itself no longer sharing a tick, the old filter swept one of
  them in.
- `director.test.ts` — "a top-up waits for the turn to resolve" becomes "a
  top-up lands MID-CHAIN", and the clam variant likewise. Both now assert the
  refill happens *while* `boardSettled()` is false.

The per-level playthrough bots (120 runs each, all ten levels) pass unchanged,
which is the evidence that no level became unsolvable or softlocked.
