# FAE data exports and Lee archive audit

Current schema: `fae-export-v2`. Study version: `FAE-2026-10-15-audio-instructions`.

The experiment still saves four files per completed browser session: MRT TSV,
image-practice CSV, calibration CSV, and final-judgment CSV. All have one header
row. Task responses, numerical coding, reaction-time units, and the original
core column positions are preserved. Extra fields follow the core columns.
Use a CSV/TSV reader and select columns by name; do not split lines on commas.
Quoted replay JSON can contain commas and quotation marks.

## Headers taken from Lee's analysis code

Both `pretest_calculation/pretest_calculation/metaEmotion.R` and its posttest
counterpart assign the following exact names. Practice uses the same eight
columns as calibration.

| Position | Practice/calibration header | Meaning in this export |
| --- | --- | --- |
| 1 | subject | Participant identifier, retained as text |
| 2 | systemtime | Accepted comparison response timestamp in seconds; see timing note below |
| 3 | pic1 | First picture's numeric ID |
| 4 | pic2 | Second picture's numeric ID |
| 5 | category | Legacy source pair code, if provided; currently missing |
| 6 | rawchoice | 1 = first picture; 2 = second picture |
| 7 | picchoice | Numeric ID of the chosen picture |
| 8 | RT | Accepted comparison response RT, in seconds |

| Position | Final-judgment header | Meaning in this export |
| --- | --- | --- |
| 1 | subject | Participant identifier |
| 2 | systemtime | Accepted Higher/Lower response timestamp in seconds |
| 3 | pic | Picture's numeric ID |
| 4 | higherlower | 1 = higher; 2 = lower than the participant's emotional median |
| 5 | firstRT | Higher/Lower response RT, in seconds |
| 6 | confidence | 1 = Very unconfident; 2 = Unconfident; 3 = Confident; 4 = Very confident |
| 7 | secondRT | Confidence response RT, in seconds |

The `category` name is retained to match Lee's R code. MATLAB extracts its value
from spreadsheet notes such as `A1` through `A190`; it identifies an unordered
comparison pair, rather than a semantic IAPS category. Lee's supplied R scripts
do not use this field. The current two-column source lists do not supply it, so
the export writes an empty cell instead of `NaN`. The added `pair_key` identifies
the unordered pair from its image IDs, for example `2019_8205`; it does not
pretend to recover Lee's original numbered code.

**Timing note:** Lee's MATLAB `systemtime` was recorded at image onset. This
jsPsych implementation records it when the first judgment is accepted. Its
clock is relative to the first accepted picture response, with the existing
8000-second offset; it is not a Unix or UTC timestamp. The added
`response_time_s` is an explicit alias for this actual response-time convention.
`session_started_at_utc` provides the session's absolute start time.
`time_elapsed_ms` is jsPsych's elapsed time for the exported response record.
No claim of exact stimulus-onset timing equivalence is made.

Comparison images remain 750 ms each. Final single-image presentations and
passive review remain 500 ms; fixation and intertrial intervals remain 500 ms.
For trials with replays, original RT columns measure the final response-screen
presentation. `total_response_rt_s` additionally includes earlier response
screen visits and intervening replay time. Confidence RT is separate.

## Additional image fields

The existing response-control fields remain in their previous order:

```text
response_format_version, image_trial_id, replay_count, replays_remaining,
total_response_rt_s, final_response_rt_s, replay_requests,
fast_response, fast_streak, type1_fast, type1_fast_streak,
speed_reminder_shown, speed_reminder_kinds,
fast_threshold_ms, fast_streak_length, speed_reminder_limit, replay_limit
```

On final rows, `fast_response` and `fast_streak` concern confidence;
`type1_fast` and `type1_fast_streak` concern Higher/Lower. Comparison rows leave
the type1-specific fields blank. Fast responses are flagged, not removed.
Replay requests are saved as properly quoted JSON. Practice has its own five
requests and does not consume the five requests shared by main calibration and
final judgments. `replays_remaining` and each request's `remaining` refer to the
practice allowance on practice rows and the main allowance on calibration/final
rows. Each new replay request also identifies its `budget` as `practice` or
`main`. Existing CSV headers and positions are unchanged.

Final judgments additionally allow at most three requests within the main five;
the main allowance is not replenished at that transition or between chunks.
The final button shows the smaller of the remaining main allowance and the
remaining final-phase allowance.

The existing order-provenance fields follow:

```text
schedule_version, schedule_seed, schedule_stage, schedule_position,
schedule_source_row, schedule_block, schedule_pair_occurrence,
schedule_min_pair_intervening, schedule_min_image_intervening,
schedule_source_sha256, schedule_followup_shuffle, schedule_review_order
```

Positions, source rows, and blocks are one-based. The actual completed review
order is stored on the first final-judgment confidence row. Source hashes cover
the normalized source CSV text. These fields support reconstruction of the
randomized schedule and identification of authorized procedural adaptations.

New image fields then follow:

| Header | Meaning |
| --- | --- |
| row_index | One-based row within this exported file, excluding the header |
| phase | practice, calibration, or meta |
| chunk | Interleaved task chunk, where applicable |
| trial_index | jsPsych global response-record index |
| time_elapsed_ms | jsPsych elapsed time at that response record |
| pair_key | Stable unordered image-pair key; empty for single-image judgments |
| confidence_label | Final confidence's verbal label; empty for comparison rows |
| response_time_s | Explicit alias of the legacy systemtime value |

The following fields are appended after the existing session columns. Original
column positions remain intact:

| Header | Meaning |
| --- | --- |
| final_replay_limit | Final-phase cap: 3, within the overall limit of 5 |
| final_replays_remaining | Remaining final-phase allowance; the button also respects the overall remaining allowance |
| certainty_min_ms | Minimum confidence-screen time: 600 ms |
| certainty_min_move_px | Required fresh cursor displacement: 100 CSS px |
| certainty_max_move_px | Observed maximum displacement from the cursor's position at confidence-screen onset |
| final_check_id | One-based final-phase instructed-response check ID |
| final_check_after_trial | Completed final trial preceding the check: 20, 40, or 60 |
| final_check_presentation | confidence_options; the third question uses the confidence response format |
| final_check_expected / final_check_response | Requested and selected confidence-format response, coded 1–4 |
| final_check_correct | Whether the instructed response was followed |
| final_check_rt_ms | Response-check RT in milliseconds |
| final_check_min_ms / final_check_min_move_px | Check's response requirements: 600 ms and 100 CSS px |
| final_check_max_move_px | Observed cursor displacement on the check screen |
| cal_check_id | One-based calibration instructed-response check ID |
| cal_check_after_trial | Completed main comparison preceding the check, counting across chunks |
| cal_check_expected / cal_check_response | Requested and selected 1/2 key response |
| cal_check_correct | Whether the calibration response instruction was followed |
| cal_check_rt_ms | Calibration response-check RT in milliseconds |
| speed_reminder_group | Appended last: final_judgment for final decisions/confidence; general for scored comparisons |

From `emotion-mouse-replay-v7-final-controls`, final judgments have an independent
allowance of five speed reminders. Earlier MRT and comparison reminders share
a general allowance of five. The final group has its own streaks, pending
requests, and displayed-warning count. Three consecutive Higher/Lower responses
strictly below 250 ms request a reminder after the completed decision, confidence,
and any instructed check. A normal response resets that question type's streak.
Confidence remains subject to its 600-ms and 100-pixel gate, so its responses
cannot fall below the 250-ms fast threshold. RTs are timing flags, not exclusions;
they start at the response screen after picture presentation. No five-second
warning delay is added in this update. Raw warning events record their group
and within-group `reminder_number`; the appended CSV field preserves every
existing column position.

The `final_check_*` fields are populated only on the scored final row immediately
preceding the check. The original emotion/confidence responses remain intact.
Final checks have their own raw event, `meta_instructed_response`, and are not
additional scored image judgments. The final CSV therefore retains 60 actual
judgments.
Confidence movement fields concern the actual confidence answer; check movement
has separate fields. Comparison rows leave final-confidence/check fields blank.

Image-phase checkpoints are spaced by phase length: one per quarter of
calibration and one per third of final judgments. Positions round upward and
continue across chunks. Calibration checks are second questions after main
comparisons and have their own raw event,
`calibration_instructed_response`. The six `cal_check_*` fields are populated on
the actual comparison row immediately preceding each check. Practice has no
checks. A full run has 4 calibration checks (after comparisons 95, 190, 285,
380) and 3 final checks (after judgments 20, 40, 60), while retaining 380 actual
calibration rows and 60 actual final rows. Shortened test phases scale the same
fractions to their configured lengths.

## Session fields shared by all four files

| Header | Meaning |
| --- | --- |
| export_schema_version | fae-export-v2 |
| study_version | FAE-2026-10-15-audio-instructions |
| session_id | Shared unique ID for this browser run |
| session_started_at_utc | ISO UTC start time |
| run_mode | full for 380 calibration comparisons and 35 MRT blocks; otherwise test |
| practice_trials_planned / practice_trials_completed | Configured and observed image-practice comparisons |
| calibration_trials_planned / calibration_trials_completed | Configured and observed calibration comparisons |
| calibration_trials_full | Full source pool: 380 |
| meta_trials_planned / meta_trials_completed | Configured and observed completed judgment-plus-confidence pairs |
| review_images_planned / review_images_completed | Configured and observed review presentations |
| mrt_blocks_planned / mrt_blocks_completed | Configured blocks and completed main three-question probes |
| configured_tasks_complete | All configured task counts were completed |
| full_protocol_complete | Full mode and all configured task counts completed |

These completion flags report counts, not response quality or exclusion
decisions. Practice MRT probes do not count as main MRT blocks. The present
GitHub configuration remains a **test**: 6 calibration comparisons and 1 MRT
block, with 12 picture-practice comparisons, 20 review pictures, and 60 final
judgments. A completed short test therefore has `configured_tasks_complete`
true and `full_protocol_complete` false. It cannot provide Lee-style full
calibration ground truth.

MRT's existing column names and task values remain unchanged. Its exporter adds
`row_index` followed by the shared session fields, then `probe_order`,
`basis_display_order`, and `basis_layout`. Missing/sparse array cells
are empty; tabs, line breaks, and quotes are escaped. Use `row_index` with
`session_id` for unique records, because repeating tapping practice can repeat
legacy trial numbers. Exclude `practice trial` and `practice_probe` rows from
main behavioral analyses, while retaining them for practice auditing.

MRT `RT_from_metronome` remains a signed timing difference in milliseconds;
`probe1_rt`, `probe2_rt`, `probe3_rt`, and `pause_time` are in seconds. Main probe
`performance_rating` is 1–6 and `confidence_rating` is 1–4. `main_basis` uses
`remembered_thoughts`, `general_feeling`, or `other`. Instruction-check RT
`instructed_response_rt_ms` is explicitly in milliseconds.

From `mrt-probes-v11-tap-feedback`, practice omissions no longer display a false
`+` confirmation or add an extra 650-ms feedback interval. Both practice and main
confirmations require a valid recorded SPACE press. Omission rows still have an
empty `RT_from_metronome` and `omission = TRUE`; successful taps retain the
signed millisecond score. The confidence prompt uses the requested full wording
about whether the indicated level of focus to the task was accurate.

From `mrt-probes-v12-recap-pause`, P also pauses during the + feedback in both
practice and main tapping, cancelling pending audio. A valid tap before the
pause remains one scored tap; a partial cycle paused before a tap adds no
omission. Each pause still produces a `task = pause` row with its duration in
`pause_time` seconds. The restored warning about long pauses or more than three
pauses does not add automatic termination or data exclusion; no duration cutoff
has been set. Column names and units are unchanged.

From `mrt-probes-v13-basis-horizontal`, the basis options appear in three equal
horizontal columns, with their keyboard letters below the descriptions.
At the first MRT builder call, each session is randomly assigned with equal
probability to memory-first or feeling-first; other remains last. The assignment
is stored in shared state and retained through practice repeats and every main
chunk. This provides approximate balance across sessions without enforcing
equal recruitment counts. C always means remembered thoughts, F means a feeling,
and O means another source. Wording, scoring, and question order are unchanged.

Two fields are appended after the complete previous MRT TSV schema, preserving
all prior column positions. `basis_display_order` is
`remembered_thoughts,general_feeling,other` or
`general_feeling,remembered_thoughts,other`; `basis_layout` is `horizontal`.
Both are included on every saved MRT row and the raw three-question probes and
response checks. These fields let analyses account for assigned visual order.
Image CSV schemas are unchanged.

Practice and main probes now appear in the order focus, basis, confidence.
`probe_order` records `focus,basis,confidence`. The legacy RT field names retain
their content meanings: `probe1_rt` is focus, `probe2_rt` is confidence, and
`probe3_rt` is basis; the numbers no longer describe display position. Raw
jsPsych records use `probe_question` for the actual displayed position and
`probe_kind` to identify the question. One aggregate probe row is saved only
after all three responses are available.

Every tenth main probe is followed by a separate instructed-response check
with the same four mouse options as confidence. Its response and expected
response use codes 1–4 corresponding to the confidence labels above; correctness
and `instructed_response_rt_ms` are saved separately. This check does not replace
or alter `confidence_rating`. Practice does not advance the main check counter.

## File organization and Dataverse behavior

Filenames use the task prefix, test/full mode, participant ID, UTC timestamp
including seconds/milliseconds, and a random session identifier. For example:

```text
Meta_emotion_cali_test_PARTICIPANT_SESSION.csv
Meta_emotion_metaJ_test_PARTICIPANT_SESSION.csv
Meta_emotion_practice_test_PARTICIPANT_SESSION.csv
MRT_test_PARTICIPANT_SESSION.tsv
```

All four files share the same session suffix. The local download and DataPipe
uploads use the same frozen completed-task snapshot, so their data bytes agree.
Participant identifiers and session identifiers are distinct: one person can
have multiple browser runs without filename collisions.

Recommended organization is one study-level `FAEData` dataset for linked
attention and emotion components. Use task prefixes and, after collection,
Dataverse file tags/paths to group components. A separate pilot/test dataset is
useful when setting up main collection. Separate consent/identity lookup files
from deidentified behavioral data according to their access requirements.
Separate task-specific datasets are not needed merely to organize one linked
cross-domain study. This update does not change the DataPipe experiment ID or
create/move datasets or existing files.

Dataverse can ingest CSV/TSV into a tabular representation and provides both
original and converted downloads. Its ingestion treats the first row as
variable names. The uploaded October 1 ZIP contains original, headerless image
CSVs with all their rows intact. Every additional column in those copies maps
to the task's existing response metadata; no unexplained Dataverse-added column
was found. Headers improve review and ingestion without inserting a fake
placeholder column. Original uploads remain the reference when checking a
converted download. Missing numeric cells are blank, not literal `null`, which
Dataverse can interpret as zero.

DataPipe requires unique filenames. Its dashboard counts accepted submissions;
with four file submissions per participant, do not treat that count as the
number of complete participants. Use unique session IDs and completion fields.
The upload path has not been exercised against the live dataset in this audit;
one end-to-end pilot should confirm the installation's validation settings and
four resulting files. No analysis scripts or existing participant files were
rewritten.

## Audit of supplied files and original analysis assumptions

| Supplied October 1 file | Observations verified |
| --- | --- |
| Image practice | 12 rows; all raw choices match chosen image IDs |
| Calibration | 6 rows; choices match chosen IDs; only a shortened test prefix |
| Final judgments | 60 rows; 20 images each shown three times; valid 1/2 judgments and 1–4 confidence |
| MRT | 30 practice taps, 31 main taps, and one main thought probe |

The original archive contains 33 pretest and 33 posttest calibration files,
each with all 380 directed pairs over 20 images. Its 66 final files each contain
60 judgments. The original calibration scripts require that complete pair
matrix; six comparisons cannot replace it. Final confidence rows in the current
export retain the preceding first judgment and both RTs, as required.

When updating analysis later:

1. Read the new image CSVs with headers and explicitly select the original core
   names. Lee's headerless imports followed by assigning only eight/seven names
   are incompatible with these expanded files unchanged.
2. Join each final picture to its own participant/session's calibration-derived
   emotional distance. Do not rely on image-row positions or normative IAPS
   valence. Treat alphanumeric participant IDs as strings.
3. Review an existing Lee-script pitfall: `psych2` is created within the
   calibration loop and then reused in a separate final-judgment loop without
   reloading each participant's ground truth. The supplied pretest script's
   relevant statements are at lines 87 and 117; posttest at 87 and 119. A new
   participant-plus-image join avoids carrying the last participant's values
   forward. Define an explicit policy for exact median ties, which the original
   greater-than/less-than branches leave unclassified.
4. Correct any prior description of Lee's runtime calibration as fixed-focal
   blocked presentation. `meta_emotion_cali.m` already uses `randperm` at line
   80; practice/review are randomized too. Fixed-focal grouping occurs in the
   source spreadsheet, not the runtime order. The present adaptation adds
   constrained spacing, balanced coverage blocks, and MRT interleaving.

Official format references:

- https://guides.dataverse.org/en/latest/user/tabulardataingest/csv-tsv.html
- https://guides.dataverse.org/en/latest/user/dataset-management.html
- https://pipe.jspsych.org/docs/experiments/sending-data
- https://pipe.jspsych.org/docs/experiments/validation

Verification: `node --test tests/data-export.test.mjs` checks exact Lee headers,
core codes and RT values, quoted/multiline round-trips, empty tables, unique row
and session IDs, short/full completion flags, and byte-identical upload/download
payloads. Tests do not submit fabricated participant data to the live dataset.
