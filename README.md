# FAE Study

Interleaved Metronome Task and image-comparison study.

See [DATA_FORMAT.md](DATA_FORMAT.md) for the current named export schemas,
headers from Lee's analysis scripts, session linkage, Dataverse organization,
and the audit of the supplied Lee and saved-data archives.

Schema v3 saves four compact analysis files plus one diagnostics JSON file.
Image instructed-response results immediately follow the original outcome
columns. Technical fields and repeated session settings are stored in diagnostics.

DataPipe receives **one ZIP per session** using its binary/base64 endpoint.
The ZIP contains the five original files under `MRT/`, `Image_practice/`,
`Calibration/`, `Final_judgments/` and `Diagnostics/`. Enable **binary uploads**
for experiment `9XShb2sstH1d` in DataPipe; keep Psych-DS metadata off.
The ZIP uses STORE (no compression), preserving exact UTF-8 bytes with CRC checks.
This reduces participant-data requests from five to one, without four inter-file waits.
It does not guarantee immunity to Harvard's shared-IP traffic limits.
Confirm the provider is connected and run an end-to-end test before recruitment.
Local backup filenames remain unchanged and contain no folder prefix.

## Study length and mode switch

Ordinary launches now use the **full four-section schedule**. After practice,
each section runs its whole picture set and then one sustained MRT block:

| Section | Picture comparisons | MRT probe intervals | Break afterward |
| --- | ---: | ---: | --- |
| 1 | 90 | 12 | Optional 2 minutes |
| 2 | 100 | 12 | Mandatory minimum 3 minutes |
| 3 | 90 | 12 | Optional 2 minutes |
| 4 | 100 | 12 | Mandatory minimum 5 minutes |

There are 380 comparisons and 48 main probes. The full schedule targets a
42-second mean tapping interval with ±15-second jitter. It is generated once
per session and balanced within each section. Complete 1,300-ms tapping cycles
quantize each block's nominal 8:24 to **8:24.4**, or **33:37.6** across all four
blocks. Probe answers, transitions, instructions, and breaks add to that time.
Do not treat the tapping duration as the total session duration; pilot the full
run to establish the actual completion-time distribution.

Optional breaks can be skipped or ended early. Mandatory breaks disable
Continue until their minimum time has elapsed. **No break restarts the task
automatically or expires a participant's session.** The timers measure elapsed
time, including time with this tab in the background. Quarter, halfway,
three-quarter and primary-task-completion messages accompany the breaks.
The final five-minute break precedes the final instructions, whole-set review
and existing brief SPACE screen, followed by 60 final judgments.

For the **preserved short test**, append `&mode=test` to an existing task URL
from Qualtrics (use `?mode=test` if there are no other parameters). Switch back
with `mode=full` or remove the mode parameter. Keep `subjectID`, `id`, and any
`return` parameter intact. Do not switch modes partway through a run.

The short mode retains the previous six calibration comparisons, one 40-second
MRT interval (31 tapping cycles), all existing practice, 20 review images and
60 final judgments, with the existing presentation and instruction timing.
It has no new overview or scheduled-break screens. A persistent TEST banner,
filenames, and exported `run_mode` identify it. Both modes use the same dual
saving and original-tab questionnaire return. To change the default for all
launches, edit `DEFAULT_RUN_MODE` in `js/study-schedule.mjs` and publish it.

Diagnostics include `study_timing`: the full interval schedule, section plan,
progress events and actual break durations/choices. Scheduled breaks are
separate from participant-triggered MRT P-key pause rows. MRT analysis rows also
identify `mrt_section`, `mrt_interval`, and `mrt_probe_in_section` (zero during
practice). Full-protocol completion requires the scheduled breaks as well as
all task outcomes.

Run data export checks with `node --test tests/data-export.test.mjs`.

## Save to DataPipe and Qualtrics

The separate receiver has passed live export/recovery tests for 64 KiB and 2 MiB
synthetic ZIPs. Normal task launches now attempt **both** destinations: one ZIP
to DataPipe, then the identical frozen ZIP to the separate Qualtrics receiver.
Follow [the receiver setup](qualtrics/README.md) to add the final questionnaire
return, then test with the existing `subjectID`, `id`, and optional `return`
parameters. `saveTo=both` explicitly selects the default. `saveTo=datapipe` and
`saveTo=qualtrics` isolate a destination for troubleshooting.

The DataPipe attempt has a 30-second deadline covering the request and response
body. Queued, rejected, uncertain and timed-out results all allow the Qualtrics
handoff to proceed. A timeout does not prove that DataPipe failed to retain the
upload; its server may still process a received request. No client retries are
added. A Qualtrics retry does not repeat the DataPipe attempt.

The final SPACE gesture opens a separate submission tab while keeping the task
tab in place. After submission, the receiver's End of Survey redirect reaches
the receipt page in that child tab. A matching completion message closes the
child where permitted and makes the original task tab continue to the stored
questionnaire destination. The return field and End of Survey setup are required.
An available IndexedDB backup is committed before the POST. Recovery
uses the same task URL and browser with `&saveTo=qualtrics&resumeSave=1`; it offers
one explicit submission of retained data for that subject, without rerunning tasks.
Local automatic downloads remain enabled. The full schedule needs a pilot with
the real receivers before recruitment. Back navigation does not imply a save
failed or resubmit data.

## Check only the Qualtrics return

After Qualtrics sends you to GitHub, append `&redirectTest=1` to the existing
GitHub address and press Enter. Keep its `subjectID` and `id` parameters. A test
screen displays the actual return destination; press SPACE to run the same
completion callback and 500-ms redirect used at the end of the study. No tasks,
uploads, or file downloads run in this mode. This tests routing, not data saving.
Check that Qualtrics continues the same response after returning.

To enable this mode for all launches while testing, uncomment this assignment
near the top of `main.js`, commit/push it, and wait for Pages to deploy:

```js
// REDIRECT_TEST_ONLY = true;
```

Comment that assignment out again and publish to restore the task flow.
The assignment is commented out by default; ordinary launches run the tasks.

## Convert an existing wide session

Sources are preserved. Supply one session's four files and a separate, new
output directory:

```sh
node scripts/split-session-exports.mjs MRT.tsv practice.csv cali.csv metaJ.csv compact-session
```

The converter verifies exact reconstruction before writing the four compact
analysis files and one diagnostics JSON. It refuses to overwrite source files
or existing outputs. Keep the diagnostics file with its four analysis files.
