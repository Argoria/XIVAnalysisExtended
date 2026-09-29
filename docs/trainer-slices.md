# Trainer delivery slices

## Current delivery

This delivery implements the comparison foundation and evidence-backed session review. It does not claim verified encounter failure rules or opener correctness.

1. **Deep metric integrity — implemented; live parity outstanding.** Results carry per-metric measured, incomplete, unsupported, not-applicable, or error states. Dependency failures invalidate affected metrics, while independent measurements survive. Aggregates count measured coverage separately from loaded results. A successful process exit is not evidence that every module succeeded. The original runner `.handle` failure still needs a real event-stream reproduction; the existing error-capture workaround is not a verified root-cause fix.
2. **Attempt classification — implemented.** Short duration alone never scraps an attempt. A conservative early multi-player death-cluster heuristic suggests review; suspected resets remain included. Manual normal/scrapped overrides require a reason and are saved per report/fight in this browser. Confirmed scrapped pulls are excluded by default from summaries, player histories, matrix comparisons, and coaching. They remain visible in the sidebar and pull table for review.
3. **Checkpoints — foundation implemented; encounter verification outstanding.** Selected checkpoints take precedence over incidental later casts. Vamp Fatale's Sadistic Screech occurrences are provisional, name-matched anchors. Reaching the cast does not establish mechanic completion. HP is captured only from a valid casting-boss resource snapshot; unavailable snapshots never fall back to terminal HP. Other encounters expose provisional observed casts. Filters are scoped by encounter and difficulty.
4. **Comparable pull review — implemented.** Duration, checkpoint, measured-uptime coverage, and scrapped inclusion filters control the comparison set. DPS/rDPS/nDPS/cDPS are selectable. The pull table sorts by progression, HP, duration, raid metric, uptime, or deaths. Partial raid damage sums remain unavailable. Player history uses the selected damage metric. The player × pull matrix switches between deaths, DPS-family metrics, and measured uptime. Raw best values remain raw values, not a composite skill score; choose comparable progression/duration before interpretation.
5. **Session review — available-evidence portion implemented.** Review prompts link recurring killing abilities, first-death sequences, measured checklist issues, and measured suggestions to concrete player/pull examples. Progression examples and selected-player uptime examples remain encounter-specific. Denominators describe loaded/evaluated evidence; missing findings do not establish success.

## Next implementation boundary

5. **Mechanic opportunities and failures.** Capture and verify real ability IDs and player hit evidence for the first supported encounter. Define eligible players and occurrence windows; distinguish required damage, observed hits, confirmed failures, and deaths. Add per-opportunity counts and most/least failure rankings only after these rules are verified. No generic damage-taken count may stand in for mechanic failure.
6. **Opener execution.** Compare real GNB and AST engine output with upstream, then extract expected/observed job-specific action windows. Wipe-truncated windows remain incomplete. Add correct/evaluated opener counts and evidence links. Generic checklist totals do not mean opener correctness.
7. **Remaining coaching.** Once rules exist, add mechanic reach/completion consistency, nonfatal failures, and opener patterns to the review prompts.

## Validation boundary

Focused fixtures cover failed/dependent metrics, exclusions and manual overrides, invalid saved data, checkpoint occurrence/HP provenance, comparison ordering, partial data, and coaching denominators. Type checking and the application production build are independent of the upstream engine installation.

Real-log FFLogs and XIVAnalysis parity require credentials and the pinned vendor dependencies. Local fixture success, synthetic demo output, or a successful application build do not substitute for that check. The next live check should include a short wipe, long pull/clear, and death/resurrection for GNB and AST, then the Vamp Fatale checkpoint sequence.
