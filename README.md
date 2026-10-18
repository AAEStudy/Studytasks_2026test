# FAE Study

Interleaved Metronome Task and image-comparison study.

See [DATA_FORMAT.md](DATA_FORMAT.md) for the current named export schemas,
headers from Lee's analysis scripts, session linkage, Dataverse organization,
and the audit of the supplied Lee and saved-data archives.

Schema v3 saves four compact analysis files plus one diagnostics JSON file.
Image instructed-response results immediately follow the original outcome
columns. Technical fields and repeated session settings are stored in diagnostics.

DataPipe uploads go to `MRT/`, `Image_practice/`, `Calibration/`,
`Final_judgments/` and `Diagnostics/` inside the same Dataverse dataset.
Keep Psych-DS metadata off for this routing. Each save waits for its DataPipe
response, then pauses two seconds before the next file (eight added seconds
across five uploads). This is precautionary spacing, not a remedy for HTTP 403.
Local backup filenames remain unchanged and contain no folder prefix.

The current quick-test configuration has six calibration comparisons and one
MRT block. Exported filenames and rows identify it as `test`.

Run data export checks with `node --test tests/data-export.test.mjs`.

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
