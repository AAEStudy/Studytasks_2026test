# FAE Study

Interleaved Metronome Task and image-comparison study.

See [DATA_FORMAT.md](DATA_FORMAT.md) for the current named export schemas,
headers from Lee's analysis scripts, session linkage, Dataverse organization,
and the audit of the supplied Lee and saved-data archives.

Schema v3 saves four compact analysis files plus one diagnostics JSON file.
Image instructed-response results immediately follow the original outcome
columns. Technical fields and repeated session settings are stored in diagnostics.

DataPipe experiment `ThTYlS6YRHym` saves **five separate text files** in real
Google Drive subfolders: `MRT/`, `Image_practice/`, `Calibration/`,
`Final_judgments/` and `Diagnostics/`. Files are uploaded in order through
`/api/data/`, with one second between completed attempts. Each name contains
the subject, run mode, and unique session ID. No ZIP is sent to Drive.

Keep **Psych-DS metadata off** in this new DataPipe experiment: when enabled,
DataPipe flattens slash-containing names instead of using these subfolders.
Binary uploads are not needed for these text files. Enable data collection.
If a DataPipe session cap is set, allow five uploads per participant (for
example, at least 1,500 for 300 participants), because its counter is per file.

## Study length and mode switch

Ordinary launches use the **full four-section schedule**. After practice,
each section runs its whole picture set and then one sustained MRT block:

| Section | Picture comparisons | MRT probe intervals | Break afterward |
| --- | ---: | ---: | --- |
| 1 | 90 | 12 | Optional 2 minutes |
| 2 | 100 | 12 | Mandatory minimum 3 minutes |
| 3 | 90 | 12 | Optional 2 minutes |
| 4 | 100 | 12 | Mandatory minimum 3 minutes |

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
The final three-minute break precedes the final instructions, whole-set review
and existing brief SPACE screen, followed by 60 final judgments.

For the **preserved short test**, append `&mode=test` to an existing task URL
from Qualtrics (use `?mode=test` if there are no other parameters). Restore full
mode with `mode=full` or remove the mode parameter. Keep `subjectID`, `id`, and any
`return` parameter intact. Do not switch modes partway through a run.

The short mode retains the previous six calibration comparisons, one 40-second
MRT interval (31 tapping cycles), all existing practice, 20 review images and
60 final judgments, with the existing presentation and instruction timing.
It has no new overview or scheduled-break screens. A persistent TEST banner,
filenames, and exported `run_mode` identify it. Both modes use the same Drive saves,
Qualtrics fallback, and original-tab questionnaire return. To change the default for all
launches, edit `DEFAULT_RUN_MODE` in `js/study-schedule.mjs` and publish it.

Diagnostics include `study_timing`: the full interval schedule, section plan,
progress events and actual break durations/choices. Scheduled breaks are
separate from participant-triggered MRT P-key pause rows. MRT analysis rows also
identify `mrt_section`, `mrt_interval`, and `mrt_probe_in_section` (zero during
practice). Full-protocol completion requires the scheduled breaks as well as
all task outcomes.

Run data export checks with `node --test tests/data-export.test.mjs`.

## Save to DataPipe and Qualtrics

Normal launches use `saveTo=drive`: all five confirmed stored responses return
directly to the questionnaires in the same tab, without opening a submission
tab or constructing a ZIP. If any file is queued, rejected, uncertain, missing,
or timed out, the final SPACE gesture starts the existing Qualtrics backup
submission. That fallback contains the complete five-file session ZIP, with
exactly the same frozen text bytes as the Drive files. A fallback submission
may therefore overlap files already stored in Drive; match by session ID.

`saveTo=both` explicitly sends the five files to Drive and the full ZIP to the
receiver on every run. `saveTo=datapipe` and `saveTo=qualtrics` isolate a
destination for troubleshooting. Unknown values retain the normal Drive route.
Keep the existing `subjectID`, `id`, and optional `return` URL parameters.

Each DataPipe request and body read has a 30-second deadline. No client retries
are added: a timed-out request may already have reached the server, and a 202
response is retained in DataPipe's retry queue rather than a stored Drive file.
All five attempts finish before fallback selection. A Qualtrics retry does not
repeat any DataPipe attempt.

When needed, the Qualtrics save tab opens within the final SPACE gesture.
Popup denial displays **Open submission window**. After submission, the
receiver's End of Survey receipt closes the child where permitted and returns
the original tab to the saved questionnaire destination. The existing receiver
configuration remains required; see [the receiver setup](qualtrics/README.md).
An available IndexedDB backup is committed before the fallback POST. Recovery
uses the same task URL and browser with `&saveTo=qualtrics&resumeSave=1`.

Participant file downloads and their instructions remain disabled in both
modes, including after failed or unconfirmed uploads. Pilot the new Drive route
and confirm all five folders/files before recruitment. The full schedule and
its break/progress behavior are preserved behind `mode=full`.

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
