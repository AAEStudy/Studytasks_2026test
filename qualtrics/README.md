# Qualtrics → tasks → the same Qualtrics response

Replace the redirect question's entire JavaScript with
[`launch-task.js`](launch-task.js). This file is a paste-in question script;
it is not loaded by the GitHub task page and must be installed in Qualtrics.

## Qualtrics setup

1. In Survey Options → Responses, enable **Allow respondents to finish later**.
   Keep incomplete responses open longer than the complete session, including
   breaks (for example, 24 hours rather than one hour).
2. Put the redirect on a **Text/Graphic question on its own page**, after the
   initial instructions. Participants must have advanced through a preceding
   page so that Qualtrics has saved progress. Do not put unanswered questions on
   the redirect page. Keep the post-task questionnaire pages after this page;
   do not end/submit the survey to launch the tasks.
3. Ensure `subjectID` has already been assigned as Embedded Data before this
   page. Keep the same subject ID for the whole response. `id` can be blank;
   it is passed separately when present. `ResponseID` is the built-in Qualtrics
   response identifier, distinct from the study's subject ID.
4. Open the redirect question's JavaScript editor, replace the old script
   completely with `launch-task.js`, save, and **publish the survey changes**.
   The replacement ignores the old shared `alreadyRedirected` storage flag.
5. Test the published survey in the same browser throughout. A test begun before
   publication may retain the old survey version, so start a fresh test session
   and keep that session's browser context for its whole round trip.

## How the handoff works

The script captures the current Qualtrics URL, including its original query
string. It sends that URL to GitHub as the encoded `return` parameter, with
`returnMode=resume`. Completion, response ID, and subject ID markers are carried
in the URL **fragment** (after `#`). The task preserves the return query exactly
in this mode; it does not add `subjectID` or `id` to that query.

On return, the question script checks the fragment against the active Qualtrics
response and subject. A matching return advances to the next questionnaire page.
Invalid or mismatched return information shows a recovery message instead of
silently advancing or sending the participant through the tasks again. No
browser-wide “already redirected” flag determines completion.

The markers do not reopen a response. Qualtrics must still resume the open
response using its cookie. A lost, expired, or unavailable session cookie cannot
be repaired by a subject ID or a completion flag. An existing non-FAE fragment
is treated as an unsupported URL configuration rather than overwritten.

## Quick routing test

You can test the round trip without completing all the tasks:

1. Start a fresh published-survey test and reach the GitHub task page.
2. In that page's browser console, read its supplied return URL:

   ```js
   new URL(window.location.href).searchParams.get("return")
   ```

3. Open that returned URL in the **same tab/browser context**. This deliberately
   simulates task completion for the routing test; it does not test uploads or
   actual task completion.
4. Confirm that the redirect question advances to the first post-task
   questionnaire and that Qualtrics continues the **same ResponseID**, rather
   than creating a second response. Also test a real completed shortened task
   before recruitment.

Automated tests verify the URL preservation, matching rules, and page-script
control flow in a simulated Qualtrics environment. They do not verify the live
survey's settings, layout API, or cookie-based resumption.

## Basis and limits

Qualtrics documents that [progress is saved when respondents advance to another
page](https://www.qualtrics.com/support/survey-platform/survey-module/survey-options/partial-completion/),
and that [finish-later resumption uses cookies in the same
browser](https://www.qualtrics.com/support/survey-platform/survey-module/survey-options/survey-experience/).
Its [cookie documentation](https://www.qualtrics.com/support/survey-platform/getting-started/browser-cookies/)
describes the session-cookie name as a hash involving query parameters. Preserving
the original query and using a fragment is an engineering precaution based on
that documentation, not a Qualtrics guarantee of successful resumption. The
response check prevents an unnoticed mismatch but cannot repair a lost session.
