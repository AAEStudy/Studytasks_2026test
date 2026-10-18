# FAE Study

Interleaved Metronome Task and image-comparison study.

See [DATA_FORMAT.md](DATA_FORMAT.md) for the current named export schemas,
headers from Lee's analysis scripts, session linkage, Dataverse organization,
and the audit of the supplied Lee and saved-data archives.

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
