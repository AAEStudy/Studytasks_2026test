# Qualtrics automatic task-data storage

The separate receiver has passed real save-and-export tests with both a 64 KiB
and a 2 MiB synthetic payload. The 2 MiB ZIP contained **2,098,041 bytes across
156 embedded-data chunks**. Its saved SHA-256 matched the expected checksum, and
all five original files recovered exactly. This verifies the `__js_fae_…` field
names and the current USF receiver's storage/export behavior for those tests.

Actual-task integration now attempts **both DataPipe and Qualtrics by default**.
The task remains in its shortened configuration: **6 calibration
comparisons and 1 MRT block**. Completing the questionnaire return and an actual
task-data export is the next acceptance check; full-protocol collection is not
yet enabled.

After the DataPipe save attempt, the task independently sends the identical
five-file ZIP to Qualtrics as a normal HTTPS form POST, without an API token.
Qualtrics stores it as encoded text in a survey
response. Participants do not select or upload files. Exporting one response
table restores everyone's original ZIPs and analysis files in one operation.

## Update the existing receiver

Receiver: `https://usf.az1.qualtrics.com/jfe/form/SV_b7rI1T6DVd3u0dw`.

Use the existing receiver survey. Open
[the setup page](FAE_Receiver_Return_Setup.html) for these steps and a button
that copies the complete updated question JavaScript.

1. In **Survey Flow**, add a text embedded-data field named
   `__js_fae_return_url` to the existing embedded-data element **above** the
   receiving question block. Leave its value to be supplied by the submission.
   Keep the existing metadata, 256 ZIP chunk fields and status fields.
2. In the receiving question's **JavaScript** editor, replace all code with the
   freshly generated **FAE_Receiver_JS.js** from this directory, then Save.
   `receiver-question-complete.js` contains the identical complete script.
   The shorter `receiver-question.js` is a development template and cannot be
   pasted on its own. Use a code editor's copy command or the downloaded file,
   avoiding rich-text entities or added backslashes.
3. In Survey Flow, **after** the receiving question block, add a **Branch** with
   both conditions:
   - Embedded Data `__js_fae_receiver_status` **is equal to** `verified`.
   - Embedded Data `__js_fae_return_url` **is not empty**.
4. Inside that branch, add **End of Survey**, then **Customize → Override Survey
   Options → Redirect to a URL**. Enter exactly:

   ```text
   ${e://Field/__js_fae_return_url}
   ```

   Keep response recording enabled. **Do NOT record survey response** must
   remain unchecked. Place the End of Survey element last in that branch.
5. Apply/Save Survey Flow and **Publish** the survey.

Keep the ordinary default thank-you ending outside the branch. Synthetic probes
send no return URL and will continue to show that message.

The JavaScript verifies all chunks, size and checksum, then clicks the survey's
Next/Submit button. Qualtrics' End of Survey redirect handles navigation only
after that submission. The supplied return destination is validated; it is
either the questionnaire survey or the exact task receipt page. Do not replace
this with a `window.location` redirect inside the question JavaScript.

For a fresh receiver, import **FAE_Receiver_JS_Fields.txt** into a new blank
survey using **Tools → Import/Export → Import survey**, keep its one receiving
block, then follow the JavaScript and branch steps above. TXT import does not
install JavaScript. The initial QSF import failed with a generic upload error;
the QSF remains a development artifact, so use TXT import.

## Test the actual task with both saves

Use the normal task launch with its existing participant identifiers and custom
`return` parameter. Both destinations are enabled when no override is supplied;
`saveTo=both` explicitly selects the same behavior. For example:

```text
https://aaestudy.github.io/Studytasks_2026test/?subjectID=ID0007&id=0007&saveTo=both
```

This sends one ZIP to DataPipe and then the same ZIP to the receiver, regardless
of DataPipe reporting stored, queued, rejected, uncertain or timed out. A
30-second deadline covers the DataPipe request and body read; there are no
automatic client retries. Timeout means its storage result is unknown, since
the server may already have received it. For isolated troubleshooting only,
`saveTo=datapipe` or `saveTo=qualtrics` selects just that destination.
The current test configuration remains short. The existing `redirectTest=1` mode
still skips tasks, exports and saves; it is not a storage test.

Check this complete route:

1. Complete the shortened task and press SPACE on its final screen.
2. Confirm DataPipe attempted one ZIP save; a queued result is not proof of
   delivery to Harvard. The Qualtrics receiver should then verify and submit
   automatically.
3. Qualtrics should redirect to the task's `qualtrics/saved.html` receipt page,
   which then returns to the intended questionnaires.
4. Confirm the participant/credit ID is correct. If the normal launch has a
   custom return URL, confirm its query parameters and resume destination too.
5. Export the receiver response and recover it with the command below. Confirm
   the five actual files and task metadata, rather than only a completion screen.

Before recruitment, repeat with the intended full protocol and measure the ZIP
size against the application limit. Both saves are enabled now, but full-protocol
trial counts remain separate from this storage change.

## Export and recover all sessions

In the receiver's **Data & Analysis → Export & Import → Export Data**, choose
**CSV**, enable **Download all fields**, and choose **Export values**. Use the
original CSV; opening and resaving it in Excel can change long field values.
Unzip Qualtrics' download first if it packages that CSV in a ZIP.

From the repository root:

```sh
python3 scripts/restore-qualtrics-bundles.py responses.csv restored
```

The script uses only Python's standard library and makes no network requests.
Qualtrics JSON exports containing a `responses` array also work. Each restored
session contains its original ZIP and the original `MRT`, `Image_practice`,
`Calibration`, `Final_judgments` and `Diagnostics` files. Filenames, bytes,
analysis columns and column order remain intact.

Repeated recovery checks and skips identical sessions. It refuses conflicting
overwrites and reports incomplete or corrupted records; valid sessions still
recover, and the command exits with status 2 when any record is rejected.
Reconcile expected session IDs with recorded responses to identify submissions
that never arrived.

## Browser backup and explicit recovery

Before POST, the task attempts to commit the completed payload to IndexedDB on
the task's origin. Each record keeps the original questionnaire return URL and
a random receipt nonce. A matching post-submission receipt removes only that
session's retained payload, then continues to the original questionnaires.

If IndexedDB cannot retain the payload, the task tries a sessionStorage receipt
containing only return metadata. If both stores fail, it sends the payload with
a direct questionnaire return. These fallbacks allow the primary submission;
they do **not** claim that a payload backup exists.

To recover a retained completed session, use the same browser and exact original
`subjectID`, adding both `saveTo=qualtrics` and `resumeSave=1` to the task URL:

```text
https://aaestudy.github.io/Studytasks_2026test/?subjectID=ID0007&saveTo=qualtrics&resumeSave=1
```

The recovery page requires an explicit button press and sends only the oldest
pending session for that participant. It does not restart the tasks or replay
uploads automatically. If browser Back restores an interrupted saving page,
the task also offers an explicit retry. A server may have saved a response even
if its receipt was interrupted, so a retry can create duplicate receiver rows;
the recovery script handles identical session data idempotently.

Browser storage can be unavailable or cleared. A form POST begins navigation;
it does not provide the original task page with a server save acknowledgement.
The completion redirect and checksum-verified export remain the relevant checks.

## Capacity and development checks

- Chunk size: **18,000 ASCII bytes**, below Qualtrics' documented 20,000-byte
  per-field limit.
- Declared slots: **256**; application limit: **3,456,000 ZIP bytes**. This is
  our cap, not a statement of Qualtrics' aggregate capacity.
- Base64 adds about one third to the ZIP's transfer/storage size.
- Local checks cover integrity rejection, actual ZIP recovery, 300 synthetic
  sessions, receipt nonces, storage fallback and task routing. The real 64 KiB
  and 2 MiB tests additionally establish save/export integrity for this receiver.
- The new actual-task route and final return must still pass the live acceptance
  check above before recruitment.

Rebuild generated receiver files and the self-contained synthetic test page
after changing the codec or receiver template:

```sh
node scripts/build-qualtrics-receiver.mjs
node scripts/build-offline-qualtrics-probe.mjs
node scripts/build-qualtrics-return-setup.mjs
```

The downloadable **FAE_Receiver_Test_v2.html** requires no server or installation.
It supports synthetic payload tests and expected-details JSON downloads. The
actual-task route above is now the next test, since both synthetic sizes passed.

## Primary documentation

- [Start a survey with a POST request](https://www.qualtrics.com/support/common-use-case/survey-projects/customizing-your-survey/starting-a-survey-with-a-post-request/)
- [Embedded data and its per-field limit](https://www.qualtrics.com/support/survey-platform/survey-module/survey-flow/standard-elements/embedded-data/)
- [Question JavaScript](https://www.qualtrics.com/support/survey-platform/survey-module/question-options/add-javascript/)
- [End of Survey redirects](https://www.qualtrics.com/support/survey-platform/survey-module/survey-flow/standard-elements/end-of-survey-element/)
- [TXT import](https://www.qualtrics.com/support/survey-platform/survey-module/survey-tools/import-and-export-surveys/)
