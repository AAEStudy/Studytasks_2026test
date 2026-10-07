IMAGE ORDER PREVIEW: seed 20261007, image-order-v1

These CSVs show one full-session presentation order, not replacement stimulus pools.
Do not overwrite lists/ with these previews. The study reads the unchanged master
lists and schedules their exact rows in memory, using a fresh saved seed per session.
Original source CSVs are copied byte-for-byte into originals/ for comparison.

Calibration: 380 comparisons, 190 unique pairs twice in reversed orientation.
Each of 38 ten-trial blocks contains all 20 images exactly once. Each image appears
38 times total, 19 first and 19 second. At least 60 other comparisons separate
repetitions of an exact pair; at least two other comparisons separate appearances
of an image, including block boundaries. No ranks, outcomes or emotional labels
are used to construct the schedule. These are design constraints, not empirically
validated forgetting intervals. This is constrained randomization, not a uniform
draw over every possible permutation.

Independent follow-up shuffles are prepared as the recommended option:
review_list.csv contains each current image once; meta_list.csv contains all 20
images three times, once per independently shuffled 20-item coverage block, with
at least five intervening judgments between repeats. No extra breaks are added.
Practice's 12 comparisons are unchanged. No pictures are replaced or added.

The 60-comparison gap is in scheduled calibration comparisons, not seconds or MRT
trials. Optional participant-requested replays are an explicit exception: they
repeat the same picture(s) immediately, as requested, and remain flagged in data.

The existing six-comparison test limit is applied after generating the full order.
It therefore exercises a randomized prefix, not a complete calibration. Restore
META_CALIBRATION_COMPARISONS = "ALL" for all 380 comparisons. Other timing, MRT
blocks, response controls, confidence wording and saving endpoints are unchanged.

WHY: distribute exposure over time, remove focal-image runs and stable order/key
cues, and make specific prior choices less conveniently retrievable. This does
not prevent learning or prove that final judgments are independent of memory.
No distractors, new measures, rankings or alternative calibration analysis added.

FILES
calibration_pairs.csv: exact ordered stimulus rows in the illustrative new order.
calibration_schedule.csv: adds chunk, original source row and pair spacing.
image_balance.csv: per-image first/second counts and coverage.
review_list.csv, meta_list.csv: independently randomized follow-up previews.
manifest.json: before/after checks and source hashes.

Generation: node scripts/preview-image-order.mjs 20261007
Checks: node --test tests/image-schedule.test.mjs
This example documents one reproducible order; live sessions use their own saved seed.
