# FAE analysis files and diagnostics

Current export schema: `fae-export-v3`.
Study version: `FAE-2026-10-19-bundle`.

Each completed session saves four compact analysis files and one diagnostics
JSON file. All five share the generated subject ID and session ID in their
filenames. The analysis files contain the original task outcomes, response
checks, essential quality flags and identifiers. Detailed technical fields and
session settings are kept in diagnostics rather than repeated across every row.

## Image comparisons

Practice and calibration retain Lee's original eight columns, in this order:

`subject, systemtime, pic1, pic2, category, rawchoice, picchoice, RT`

`rawchoice` is 1 for the first picture and 2 for the second. `picchoice` is the
chosen image ID. `RT` is in seconds. `category` remains blank when the supplied
pair list has no pair code.

In calibration, the next six columns (9–14) are:

| Column | Meaning |
| --- | --- |
| cal_check_id | Response-check number |
| cal_check_after_trial | Main comparison immediately preceding the check |
| cal_check_expected | Requested response: 1 or 2 |
| cal_check_response | Selected response: 1 or 2 |
| cal_check_correct | Whether the requested response was selected |
| cal_check_rt_ms | Check response time in milliseconds |

The check stays attached to the preceding image-comparison row; it does not
replace the real image choice or add a scored trial. A blank check ID means no
check followed that trial. Practice has no checks and omits these six columns.

Next come `replay_count`, `fast_response` and `speed_reminder_shown`, followed
by row/phase identifiers and the shared fields below.

## Final image judgments

Lee's original seven columns remain first:

`subject, systemtime, pic, higherlower, firstRT, confidence, secondRT`

`higherlower` is 1 for higher and 2 for lower relative to the participant's
emotional middle level. `confidence` is coded 1–4; both RT fields are in seconds.

The next six columns (8–13) are:

`final_check_id, final_check_after_trial, final_check_expected, final_check_response, final_check_correct, final_check_rt_ms`

These have the same meanings as the calibration check fields, with requested
confidence-option numbers 1–4. Checks remain attached to the preceding final
judgment, preserving the 60 scored rows. Next come `confidence_label`,
`replay_count`, `type1_fast`, `fast_response` and `speed_reminder_shown`, followed
by row/phase identifiers and the shared fields below.

## Metronome Task

The established first 19 MRT columns retain their order:

`subject, trial, task, trial_num, RT_from_metronome, omission, performance_rating, probe1_rt, probe2_rt, confidence_rating, pause_time, break_time, instructed_response, instructed_response_expected, instructed_response_correct, instructed_response_rt_ms, confidence_label, main_basis, probe3_rt`

This keeps instructed-response results beside the principal outcomes. The
following analysis fields retain probe order, basis-position counterbalancing
and useful quality indicators:

`probe_order, basis_display_order, basis_layout, probe1_fast, probe3_fast, speed_reminder_shown`

`task` distinguishes practice tapping, main tapping, practice probes, main
thought probes, pauses and instructed responses. Filter rows for the intended
analysis. Tapping offsets and probe RTs retain their existing units and coding;
`instructed_response_rt_ms` is in milliseconds. The complete prior coding and Lee
archive audit are retained in [the schema-v2 reference](docs/EXPORT_SCHEMA_V2.md).

## Shared fields and joining files

At the right of each analysis file are `row_index`, image `phase`, `chunk` and
`trial_index` when present, then:

`session_id, run_mode, configured_tasks_complete, full_protocol_complete, export_schema_version`

Use `subject` and `session_id` to join tasks. Use dataset name plus `row_index`
and `session_id` to join an analysis row to its diagnostics. `row_index` is
one-based within that file. Never join by subject ID alone when repeat test
sessions are possible.

`run_mode` distinguishes the shortened test from the full protocol.
`configured_tasks_complete` indicates completion of the configured task counts;
`full_protocol_complete` also requires the full protocol configuration. These
remain visible in the analysis files so a completed shortened test cannot be
mistaken for full study data.

## Diagnostics

`Diagnostics_<mode>_<subject>_<session>.json` contains the detailed fields
removed from the primary files: replay-request logs, remaining-budget details,
mouse-movement measurements, timing gate settings, image randomization and
source provenance, planned/completed counts, response-format versions, and
technical warning details. Session settings are stored once. Constant fields
within a dataset are stored once rather than repeated in every row.

No study outcome is discarded. `js/analysis-exports.mjs` provides
`restoreWideExports(analysisOutputs, diagnosticsJsonText)` to reconstruct the
previous wide tables, including original header order and all cell values.
This is also the export round-trip verification used in tests.

Diagnostics are generated from the same frozen completed-task snapshot as the
four analysis files. They do not contain the later upload HTTP results; those
remain in the existing status-only browser manifest, `FAE:last-upload-status`.
The external credit/return `id` is not added to any export.

## Saving and compatibility

Each participant ZIP contains these folder paths:

| File | Folder inside ZIP |
| --- | --- |
| MRT TSV | `MRT/` |
| Image-practice CSV | `Image_practice/` |
| Calibration CSV | `Calibration/` |
| Final-judgment CSV | `Final_judgments/` |
| Diagnostics JSON | `Diagnostics/` |

Keep Psych-DS metadata off in the DataPipe experiment to avoid extra metadata writes.
Local backup filenames and diagnostics' analysis-file references stay bare,
so browsers do not turn path separators into altered download names. Match the
filename within each folder; file contents and schema are unchanged.

The five files are now submitted in one `FAE_<mode>_<subject>_<session>.zip`
through `/api/base64/`. Enable binary uploads in DataPipe. Folder paths are
inside the ZIP; each entry preserves the original UTF-8 file bytes. ZIP STORE
avoids compression overhead. There is one save trial and one bundle status,
with no per-file waits or client retries. HTTP 201 is stored; 202 is queued,
not confirmed as delivered to Dataverse. The change reduces data submissions
but cannot prevent shared-IP blocking or coordinate other participants.
Normal launches also submit the identical frozen ZIP to the separate Qualtrics
receiver after the DataPipe attempt. DataPipe has a 30-second request/body
deadline, so a stalled upload cannot indefinitely block the Qualtrics handoff.
Queued, rejected and uncertain results all proceed to that second destination.
Qualtrics retries reuse the staged ZIP and do not resend DataPipe uploads.
Local downloads remain enabled during testing; a rejected or unconfirmed
DataPipe result also forces backups if that configuration is later disabled.
The same frozen bytes are used for both uploads and local backups. Redirect-only
quick mode skips every export and upload, including diagnostics. See
[the receiver setup](qualtrics/README.md) for the required Survey Flow return
and batch recovery of the original files from a Qualtrics response export.

The leading Lee outcome columns and their numerical coding are unchanged.
Scripts should read the header row and select named columns. Scripts that
expect the complete old column count or old technical column positions need
updating, or can use the reconstructed wide files. Existing saved sessions are
not silently altered; any converted copy must be kept separate from its source.

## Verified conversion example

The supplied SID5657893781 test session retains all 63 MRT rows, 12 image-practice
rows, 6 calibration rows and 60 final-judgment rows, including the one incorrect
calibration response check. The primary widths change from 51/85/85/84 columns
to 31/20/26/27 respectively. Its four primary files total 33,801 bytes rather
than 74,831 bytes; including the 25,945-byte diagnostics file, the total is
59,746 bytes. Reconstructing the four original files reproduces their bytes
exactly. These measurements concern this test session, not a full-length run.

Use `scripts/split-session-exports.mjs` for a separate, verified conversion of
existing files; see the README command. No existing Dataverse files are edited
or resubmitted by this change.
