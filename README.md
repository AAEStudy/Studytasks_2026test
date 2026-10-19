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

The current quick-test configuration has six calibration comparisons and one
MRT block. Exported filenames and rows identify it as `test`.

Run data export checks with `node --test tests/data-export.test.mjs`.

## Test saving directly to Qualtrics

The separate receiver has passed live export/recovery tests for 64 KiB and 2 MiB
synthetic ZIPs. Follow [the receiver setup](qualtrics/README.md) to add the final
questionnaire return, then append `&saveTo=qualtrics` to the task launch URL while
preserving its `subjectID`, `id`, and optional `return` parameters. This option
sends the existing five-file ZIP to the receiver instead of DataPipe. The normal
launch still uses DataPipe pending the actual-task save-and-return test.

The receiver submits before its End of Survey redirect returns to the task's
receipt page, which continues to the original questionnaire destination.
An available IndexedDB backup is committed before leaving the task. Recovery
uses the same task URL and browser with `&saveTo=qualtrics&resumeSave=1`; it offers
one explicit submission of retained data for that subject, without rerunning tasks.

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
