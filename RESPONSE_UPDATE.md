# Judgment Controls and Image Replays

## Separate whole-set review page and confidence reminder (October 17, 2026)

Final instructions now have four pages: the judgment rule, confidence, viewing
pictures again, and reviewing the whole picture set. Their minimum viewing times
are 20, 20, 15, and 20 seconds. Only the fourth page offers BEGIN PICTURE REVIEW.
The review directions begin "First, you will review the whole picture set" and
explain that no response is needed before the final one by one judgments.

The confidence reminder now says: "Remember, you can use the full range of
answer options to indicate your level of confidence." This replaces the request
to try to use all ratings. The median instruction now refers to "the positive
feelings you get from each picture in the whole set," avoiding "responses" as a
possible reference to earlier answers. The repeated question now asks: "Does this
picture bring you a positive feeling that is higher or lower than the median for
the whole picture set?" The wording "brings you" follows the original Chinese
instructions' 帶給你. The post-review SPACE boundary, replay allowances, response
requirements, trial counts, CSV headers, and coding remain unchanged.
Image response format: `emotion-mouse-replay-v12-final-review-page`.

## Numeric comparison checks and aligned questions (October 17, 2026)

Calibration response checks now request the numeric key directly: "To ensure
quality responses are being given, please select 1." (or 2). Their hint says
"Press 1 or 2 to indicate your response." Neither sentence identifies a picture.
This separates the response instruction from the image comparison already made.

Ordinary comparisons and checks now share the same page frame and question/key
spacing, including the space reserved at the bottom of ordinary comparisons for
View again. Question and key positions match across the transition. Only scored
comparisons retain the replay button. Numeric coding, check frequency, and export
columns are unchanged. The ordinary comparison question's tense is unchanged.
Current image response format:
`emotion-mouse-replay-v11-comparison-check-layout`.

## Simpler final-picture response checks (October 15, 2026)

Final picture-judgment instructed-response checks now say "Click your answer."
They retain the 600-ms minimum and require a fresh primary mouse click, but no
longer require 100 pixels of cursor movement. Ordinary confidence ratings keep
both the minimum time and movement requirement. Their instruction now specifies
"Each confidence response" when describing the movement rule.

The four answer options, layout, three checks at phase thirds, and scored trial
counts are unchanged. Existing export fields record a zero movement minimum on
checks and preserve the actual observed movement. No headers or column positions
change. Current image response format:
`emotion-mouse-replay-v10-final-check-clicks`.

## Clear boundary after picture review (October 15, 2026)

The final picture-judgment instructions now begin by noting that participants
are near the end of the tasks, that one very important part remains, and that
it should take about 5–7 minutes. They ask participants to give their full
attention and effort before the whole-set review starts, using the wording
"Please do your best to give your full attention and effort to this final part."
The review introduction explains that the images appear in one sequence, with
no response needed, and asks participants to keep in mind the feelings from the
whole set as it is displayed, rather than just one or two images. The estimate allows
for 60 self-paced judgment/confidence pairs, their fixed presentation intervals,
the review, and brief response checks; actual completion time will vary.

After the last review picture, a separate self-paced screen reminds participants
to keep the feeling from the whole picture set in mind and press SPACE to begin
the final picture judgments. The first judgment picture appears only after
that response, giving review and judgment a clear boundary. This screen adds
no scored image response and does not alter replay allowances or CSV columns.
Current image response format: `emotion-mouse-replay-v9-review-transition`.

## Independent final replays and longer instruction viewing (October 15, 2026)

Final-judgment instruction pages one and two now require 20 seconds each on
first viewing. The third page, covering View again and the upcoming picture
review, requires 15 seconds. All three precede the passive whole-set review.
The review is followed by the separate SPACE-to-begin screen described above.

Main image comparisons have five View again uses, and final judgments have a
separate three uses. Practice retains five uses of its own. Spending any one
allowance does not consume another. The buttons, instructions, and recorded
remaining counts use the allowance for the current phase; no pool resets when
another chunk is built. Each final use repeats the current picture before its
judgment. The passive whole-set review and confidence screens retain their
existing response requirements.

Image exports keep all column names and positions. `replay_limit` and
`replays_remaining` now describe the relevant phase's pool, and request JSON
uses the budget labels practice, comparison, and final. Current image response
format: `emotion-mouse-replay-v8-independent-final-replays`. This supersedes
the shared comparison/final allowance described in earlier updates below.

## Audio requirement and headphone preference (October 15, 2026)

The opening sound check states that audio must be on and asks participants to
use headphones if available, with speakers permitted otherwise. Audio-on,
headphones, and speakers receive bold emphasis. Sample playback and volume
adjustment controls are unchanged.

## Five speed reminders per group (October 15, 2026)

The speed-warning cap is now five for the general group shared by MRT and image
comparisons, and a separate five for final image judgments. Earlier warnings
cannot consume final-phase warnings. The three-response streak and strict
250-ms threshold are unchanged. Each row's `speed_reminder_limit` records five;
warnings remain reminders rather than automatic data exclusions. No five-second
delay has been added.

## Final replay allowance and independent speed reminders (October 15, 2026)

Final image judgments permit three View again requests, separate from the five
requests available for main image comparisons. Instructions and
the remaining-use button use the current cap. Practice retains its own allowance.

Final judgments previously shared a two-warning allowance with all earlier
tasks, allowing those tasks to exhaust the final phase's warnings. Final
Higher/Lower and confidence responses now use the independent final_judgment
group, with its own five-warning allowance. The earlier tasks keep their shared
general allowance. Three consecutive Higher/Lower responses below 250 ms
request a warning after the completed judgment/confidence pair and any response
check. Final confidence retains its 600-ms and 100-pixel movement requirements.
The warning does not alter accepted answers or their RTs. No new five-second
delay is applied. The assigned warning group is saved in raw events and a new
CSV field appended after all existing columns. Current image response format:
`emotion-mouse-replay-v7-final-controls`.

## Quality-check introduction (October 15, 2026)

Instructed-response checks now begin: "To ensure quality responses are being
given, please select..." This wording is used for metronome confidence-format
checks, final picture confidence-format checks, and calibration picture checks.
The requested answers, response controls, frequency, and scoring are unchanged.

## Picture-review wording (October 15, 2026)

The final instruction page now says: "During the review, keep in mind the
emotional feelings the whole set brings you." A brief SPACE-to-begin screen
now separates review from final judgments, as described in the latest update.

## Neutral focus-rating time reference (October 15, 2026)

The focus recap now says: "Your focus rating should refer to the **preceding
15 seconds or so of tapping**." This replaces the instruction to "think back"
with a source-neutral reference to the same period. It does not direct
participants to retrieve memories when forming their rating.

## Horizontal basis options and assigned order (October 14, 2026)

The main-basis question now presents three equal horizontal columns with each
keyboard letter below its description. All options use the same text styling;
the question retains the shared probe formatting. The existing option wording
and C/F/O response meanings remain unchanged.

Each new session has a 50/50 probability of receiving memory-first or
feeling-first order, with other last. Shared state retains that assignment
through practice repeats and main chunks. Recruitment totals are not forced to
match exactly. The assignment and horizontal layout are recorded in raw probe
data and every saved MRT row. `basis_display_order` and `basis_layout` are
appended after the prior TSV columns so existing field positions are preserved.
See [DATA_FORMAT.md](DATA_FORMAT.md) for values. Current MRT response format:
`mrt-probes-v13-basis-horizontal`.

## Restored metronome directions and pause behavior (October 14, 2026)

The opening sound check requires audio on, preferring headphones when available
and allowing speakers otherwise. Four
recap pages, each requiring 10 seconds on first viewing, explain synchronizing
SPACEBAR presses with the constant-paced sounds, accuracy as temporal closeness,
focus ratings for the last 15 seconds or so, the basis question, and confidence.
The focus and confidence pages ask participants to use the full response range
as appropriate. The existing focus, basis, confidence order, numeric options,
and confidence prompt are unchanged.

Participants are reminded to press P for an external interruption and P again
to resume. P now works during both the response window and the + feedback in
practice and main tapping. Pausing cancels the pending sound and stops any
sound already playing. A valid tap before a pause is saved once; a partial
cycle interrupted before a tap does not create an omission. Resuming begins a
fresh cycle. Ordinary early taps still receive the scheduled sound, preserving
the normal 1300-ms cycle and signed timing scores.

Pause rows retain their existing format, with duration in seconds. The restored
participant warning says: "If you pause for too long or more than 3 times, we
won't be able to use your data." This is an instruction; the task does not
automatically terminate or exclude data at a duration or count threshold, and
no numeric definition of "too long" has been introduced. MRT response
format: `mrt-probes-v12-recap-pause`.

The comparison replay page now says: "You may use it up to **5 times during the
main trials**. Practice uses **do not count**." The practice-complete screen
uses the same short explanation. The separate five-use practice allowance and
the three-use cap for final judgments remain in place.

## Practice replay allowance (October 14, 2026)

Picture practice now has its own allowance of five View again uses. Spending
them leaves all five main-comparison uses and three final-judgment uses
available. None of the allowances resets when a new chunk is built.

The practice replay page, practice-complete screen, and final instruction page
state that practice uses do not count toward the main-task allowance. The
button and saved remaining count use the relevant allowance for that phase;
replay-request JSON also identifies the practice/main budget. CSV column names
are unchanged. Current image response format:
`emotion-mouse-replay-v6-practice-budget`. This supersedes earlier descriptions
of one allowance shared with practice below.

## Metronome tap feedback and confidence wording (October 14, 2026)

The MRT confidence question now reads: "How confident are you that the level of
focus to the task you indicated was accurate?" Practice and main probes use
the same wording.

Practice previously displayed the + confirmation unconditionally after its
response window, including after omissions, for an additional 650 ms. The +
now appears only after a recorded SPACE press with a valid reaction time.
An omission remains blank and adds no feedback interval, matching the main
task's 1300-ms cycle. The practice and main paths reset response state at the
start of each trial and suppress confirmation after a pause. Successful taps
retain their remaining-cycle feedback and signed timing score.

Omissions were already saved as omissions; the misleading practice feedback
did not create scored SPACE presses. MRT response format at that update:
`mrt-probes-v11-tap-feedback`.

## Final instructions, confidence movement, and response checks (October 14, 2026)

The comparison wording now closely follows the original Chinese instructions:
choose which image produced a more positive emotional feeling, respond
intuitively, and judge your own feeling rather than the image's apparent
positive or negative nature. The authorized alternation with the Metronome
Task remains in place.

Final-judgment instructions now appear before the passive picture-set review.
Three pages introduce the new variation and subjective median, explain
confidence, and describe replay/review. Their minimum viewing times are
20, 20, and 15 seconds. Large text and selective bold/underlined emphasis mark
the key directions. After the review, the first final trial begins directly.

Every confidence screen and confidence-format response check now requires
600 ms plus at least 100 CSS pixels of displacement from the cursor's position
at that screen's onset. A fresh primary mouse press must occur after both
requirements are met. Earlier movement, a stationary click, a held press, and
keyboard-generated clicks cannot submit the response. Normal image-comparison
key responses and Higher/Lower mouse judgments retain their response methods.

The final phase allows three replay requests, separate from the main-comparison
five-request allowance. Its button displays the actual usable count. Each
request still repeats only the current image and cannot be made during
confidence.

Instructed-response checks are distributed by the size of each image phase.
Final judgments have a third question at each third of the phase: after pairs
20, 40, and 60, using the same four confidence buttons and a rotating requested
answer. Calibration has a second question at each quarter: after comparisons
95, 190, 285, and 380 in the full protocol, using the same 1/2 keyboard options
and alternating requested answers. Checkpoints scale to the configured phase
length, round upward, and continue across task chunks. Practice does not advance
them. No extra image or blank presentation is inserted.

These are separate check records. Their results are appended to the preceding
scored row in the corresponding CSV, so the exports retain 60 actual picture
judgment/confidence rows and the configured number of actual comparisons. The new
fields are documented in [DATA_FORMAT.md](DATA_FORMAT.md). This section supersedes
earlier descriptions of final-confidence movement and replay limits below.

## Metronome probe order and response check (October 14, 2026)

Both practice and main probes now ask for task focus, then the main basis for
that rating, then confidence. The basis screen adds: "Press C, F, or O to
indicate your response." The confidence question remains: "How confident are you that the level of focus to the task you indicated was accurate?" The recap pages follow the same
order as the questions.

The occasional instructed-response check follows confidence and uses its same
four mouse options and layout. Its target rotates among Very unconfident,
Unconfident, Confident, and Very confident. The check is separate from the
participant's confidence judgment and does not replace it. It retains the
confidence screen's 600-ms minimum and 100-pixel cursor-movement requirement.

Each three-question probe is saved after confidence, once all three responses
are available. Existing reaction-time columns retain their original meanings;
`probe_order` records the displayed order. The original task-focus numeric
response scale is unchanged.

## Opening and metronome sound check (October 14, 2026)

The opening screen now offers a metronome sample for checking device volume,
with a Play/Stop button and instructions to choose a clearly audible level that
is comfortable to listen to for a while. It uses the actual task sound and
the same 1300-ms spacing, plays only on request, and can be replayed. The sample
stops after five beats, when stopped manually, on leaving the page, or when the
tab loses focus/is hidden. No sample continues into the instruction pages.

SPACE begins the instructions; browser audio-enabling details are not shown to
participants. The sound check appears once at the start of the session.

Task transitions now use the destination task name as the heading, followed by
a brief statement about the upcoming trials and a SPACE prompt to continue to
the next set. The headings are "Metronome Task" and "Image Comparison Task".
Transition events and task timing remain unchanged.

## Image-comparison instruction pages (October 14, 2026)

Before picture practice, the comparison instructions are split into two pages.
The main directions require 20 seconds of viewing; the separate "Viewing
pictures again" page requires 10 seconds. Next/Start is disabled until the
required viewing time is reached, keyboard navigation cannot skip a page, and
the pages do not advance automatically. Previous pages can be reread.

The replay explanation now states that View again should be used only when
absolutely needed because a missed or forgotten picture prevents an accurate
comparison. Practice has five uses of its own; the main allowance is five
across calibration and final judgments. Stimulus timing and response codes
are unchanged. Image response format at that update:
`emotion-mouse-replay-v3-timed-instructions`; the current update uses
`emotion-mouse-replay-v6-practice-budget`.

The MRT confidence prompt is now: "How confident are you that the level of focus to the task you indicated was accurate?" Practice and main probes use this same wording.

**Current export format:** the October 14 `fae-export-v2` update supersedes the
headerless format described in the historical sections below. See
[DATA_FORMAT.md](DATA_FORMAT.md) for exact Lee-derived headers, session fields,
and current file organization. Four task files are still saved.

## Viewing and Neutral Labels (October 9, 2026)

Practice and calibration comparison images now last 750 ms each, including
participant-requested replays. Final single-image judgments and their replays,
and the passive whole-set review, retain 500 ms presentations. Fixations and
inter-trial intervals remain 500 ms.

The shared replay allowance is now five requests across practice, calibration,
and final judgments. This is not five requests per comparison or five full-set
review passes. Instructions, the remaining-use button, and exported replay-limit
metadata all read the same setting.

The browser tab is `FAE Study`. Participant-facing transition labels are
`Tapping task` and `Picture comparisons`; researcher-facing data labels remain
unchanged. The existing image schedule, MRT settings, confidence wording,
short-run controls, and saving/redirect settings are unchanged.

## Files

Replace `index.html`, `main.js`, `mrt.js`, and `metaemotion.js` together. Add
`js/response-controls.js` at that exact relative path. No stimulus lists or
images change in this update.

### Instruction and Layout Follow-Up

The replay control is now smaller and fixed in the bottom-right corner on
practice, calibration, and final first-judgment screens. The response content
has a separate scrollable area above it, keeping the control clear of the
questions even on short screens.

Practice, calibration, practice-end, review, and final-judgment instructions
now share a text-based layout. Replay directions are integrated into those
instructions. The outdated image-based claim about rests every ten rounds is
removed; the actual schedule is unchanged. The old instruction images remain
in the repository but are no longer used or preloaded.

The final confidence prompt is restored verbatim from the original uploaded
`metaemotion.js`: "Confidence (1 = very unconfident ... 4 = very confident)"
(displayed with the original ellipsis character). Only the response direction
changes from "Press" to "Click" for the mouse controls. No codes, response
methods, timing, replay limits, or export columns change in this follow-up.

## Behavior

- MRT source question: "When you chose your task-focus rating, what did you mainly base it on?"
- C: "My memory of what I had been thinking about."
- F: "A feeling of how focused or unfocused I had been."
- O: "Something other than these two."
- Instructions refer to the same period as the task-focus question. Memories can
  concern task-related or unrelated thoughts; a feeling need not involve recalled thoughts.
- MRT certainty retains its four verbal choices and both activation conditions:
  600 ms elapsed and 100 px displacement from the cursor position at question onset.
- Final emotion judgments use mouse clicks for Higher/Lower and for confidence
  1-4. Their original meaning, confidence endpoints, and response codes remain.
  Final confidence requires 600 ms and 100 px of fresh cursor displacement.
  The Higher/Lower judgment has no minimum RT or movement requirement.
- Final emotion answers require a fresh primary mouse click. Keyboard-generated
  clicks and the second click of a double-click cannot submit another answer.
- Practice and calibration comparisons still use number keys 1 and 2.

## Settings

`js/response-controls.js` holds the shared settings:

```javascript
const STUDY_RESPONSE_SETTINGS = Object.freeze({
  fastThresholdMs: 250,
  fastStreakLength: 3,
  maxSpeedReminders: 5,
  imageReplayLimit: 5,
  finalImageReplayLimit: 3
});
```

An RT strictly below 250 ms is flagged, not discarded. Three consecutive fast
responses of the same question type request a reminder. A slower response resets
that type's streak. Practice comparisons, calibration comparisons, final emotion
judgments, final emotion confidence, MRT task focus, and MRT source ratings each
have separate streaks. Metronome taps and gated MRT certainty are not screened.

Reminders appear after a completed comparison or final judgment/confidence pair.
For MRT, the reminder appears within the existing resume screen. There is no
additional MRT continuation screen. At most five reminder presentations occur
within the general group, shared by MRT and comparisons. Final judgments have
their own five-reminder allowance. A presentation can cover more than one
question type within its group.

## Replays

Practice has five replay requests of its own. Main image comparisons have five,
and final emotion judgments have a separate three. They do not reset between chunks.
A request repeats the original
image(s) in the same order: 750 ms per image for practice/calibration and 500 ms
for final judgments, with 500 ms fixations in both cases. A two-image
comparison costs one request, not two. Requests create no additional scored
responses and do not change the planned trial count.

The replay control is available before the first judgment, never during
confidence. Passive review is unchanged. The remaining count is shown on the
button, which becomes disabled at zero. Every request is retained in the final
scored row's replay log, including repeated requests on the same item.

## Export Compatibility

The same four files and saving workflow remain. The earlier emotion CSVs were headerless;
current exports include named headers as documented in `DATA_FORMAT.md`.
Their original first eight columns (practice/calibration) and first seven columns
(final judgments) retain their order and coding. New fields are appended in this
order:

| Appended Position | Field |
| --- | --- |
| 1 | response_format_version |
| 2 | image_trial_id |
| 3 | replay_count |
| 4 | replays_remaining |
| 5 | total_response_rt_s |
| 6 | final_response_rt_s |
| 7 | replay_requests (JSON, CSV-escaped) |
| 8 | fast_response |
| 9 | fast_streak |
| 10 | type1_fast |
| 11 | type1_fast_streak |
| 12 | speed_reminder_shown |
| 13 | speed_reminder_kinds |
| 14 | fast_threshold_ms |
| 15 | fast_streak_length |
| 16 | speed_reminder_limit |
| 17 | replay_limit |

These response-control fields occupy the first 25 columns of pair CSVs and the
first 24 columns of final-judgment CSVs. The image-order update described
below appends 12 more columns, for totals of 37 and 36 respectively.
Use a CSV parser rather than splitting on commas, because replay JSON contains
commas. Older rows are not rescaled or rewritten; their missing metadata stays
blank when exported.

`total_response_rt_s` runs from the initial first-judgment response-screen onset
to the submitted answer, including intervening replays. `final_response_rt_s`
and the original judgment RT measure the final response-screen presentation only.
The final emotion file also retains its separate original confidence RT column.
On final-judgment rows, `fast_response`/`fast_streak` refer to confidence, while
`type1_fast`/`type1_fast_streak` refer to the Higher/Lower judgment. Pair rows leave
the type1-specific fields blank. Reminders annotate the completed sequence.

Replay JSON contains `request_index`, `image_trial_id`, `elapsed_ms`,
`screen_rt_ms`, `remaining`, and the ordered `pictures` paths. Trial IDs identify
items within a session, not image identities or necessarily presentation order.

MRT's TSV retains its existing columns and adds `fast_threshold_ms`,
`fast_streak_length`, `speed_reminder_limit`, `probe1_fast`, `probe3_fast`,
`speed_reminder_shown`, and `speed_reminder_kinds`. MRT source values remain
categorical: `remembered_thoughts`, `general_feeling`, or `other`.

Versions: `mrt-probes-v3` and `emotion-mouse-replay-v1`.

## Deployment Checks

Automated Chrome checks cover response coding, MRT activation/held-event rules,
single MRT resume, speed streaks and reminder cap, shared replay budget and image
order, replay/RT exports, CSV escaping, and desktop/narrow-screen button layouts.
The local download path and DataPipe payloads are tested without submitting
participant data. A live Dataverse save and Qualtrics return still need a pilot;
the redirect remains disabled in the existing test configuration. Safari and
Firefox have not been tested in this update.

The short-run settings in `main.js` remain six calibration comparisons and one
MRT block, with the original full settings commented beside them. Review and
final judgments still use their own complete configured lists.

## Image-Order Update

All four `lists/` CSVs and every image asset remain unchanged. `js/image-schedule.mjs`
creates presentation orders in memory from the existing source rows. It never
independently samples pairs or constructs a different comparison pool.

- Calibration retains all 380 directed rows: 190 unordered pairs, each presented
  twice with reversed first/second positions. Each image is first 19 times and
  second 19 times.
- Every ten-comparison coverage block contains all 20 images exactly once. At the
  current ten-comparison chunk size, these coincide with calibration chunks.
- Repeated pairs have at least 60 intervening scheduled calibration comparisons.
  Any image has at least two intervening comparisons before appearing again,
  including coverage-block boundaries. The short test limit is applied only after
  generating the complete schedule; a six-trial test prefix is not a full calibration.
- The default follow-up order independently shuffles review and final
  judgments. Review still shows all 20 images once. Final judgments still have 60
  items, with each image once in each independently shuffled 20-item coverage block
  and at least five intervening judgments between repeats. No new break or instruction
  marks those coverage blocks. Practice remains unchanged.
- Optional participant-requested replays remain an explicitly logged exception to
  spacing rules. They intentionally replay the same image(s) immediately.

Construction starts with a randomized round-robin factorization and reverses each
pair on its other appearance. Random alternating-cycle exchanges between blocks,
plus block-order exchanges, break up the initial matching groups while retaining
image coverage and pair spacing. Trial order is then randomized within blocks,
subject to boundary image spacing. This is constrained randomization, not a uniform
sample of all permutations. The spacing thresholds are design choices, not validated
memory-erasure intervals.

`IMAGE_SCHEDULE_SEED = null` in `main.js` chooses a new saved unsigned 32-bit seed
per session; set it to `20261007` to reproduce the example preview. A local seeded
PRNG leaves `Math.random` and MRT's randomization stream untouched.
`SHUFFLE_REVIEW_AND_META_JUDGMENTS = false` keeps the original review/final order
while still shuffling calibration. Neither option changes stimuli or counts.

The 12 added export fields follow the previous response-control fields:

1. schedule_version
2. schedule_seed
3. schedule_stage
4. schedule_position
5. schedule_source_row
6. schedule_block
7. schedule_pair_occurrence
8. schedule_min_pair_intervening
9. schedule_min_image_intervening
10. schedule_source_sha256
11. schedule_followup_shuffle
12. schedule_review_order

Positions, blocks and source data-row indices are one-based (excluding the CSV
header). `schedule_block` identifies the fixed coverage block, while the existing
`chunk` field remains the actual interleaved calibration chunk. Source hashes are
SHA-256 of CSV text after the existing BOM/newline normalization. The first final
judgment's completed confidence row includes the actual review order as JSON;
later rows leave that field blank. Final confidence rows carry their first judgment's
schedule metadata through replays. Earlier export columns and response codes stay
in place; old rows with no schedule information retain blank schedule fields.

Audit previews and byte-identical source copies are generated with:
`node scripts/preview-image-order.mjs 20261007`

Run invariant and shortened-run checks with:
`node --test tests/image-schedule.test.mjs`

The preview is illustrative. Do not replace source lists with preview lists.
The image-order update did not change MRT timing, number of blocks, task ordering,
replay limits, confidence wording, or DataPipe/Qualtrics settings. The later viewing
and replay changes are described above. Reducing systematic
order cues does not establish that learned rankings or prior-response memories
cannot influence final judgments.
