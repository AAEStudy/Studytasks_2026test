# Harvard Dataverse uploads fail after ZIP bundling; investigate provider filtering and clustered retries

### Summary

Harvard Dataverse uploads repeatedly remain queued in DataPipe and fail with provider HTTP 403 errors. Harvard support has now attributed the problem to ISP traffic filtering: strict request limits during ongoing bot attacks, with a block expected to expire after about 30 minutes. They recommended bundling files into ZIPs to reduce the number of uploads.

I changed the study from five files per participant to **one ZIP per participant** and enabled binary uploads. A ZIP attempt still produced **“Your storage provider was temporarily unavailable.”** I have not captured the raw upstream HTTP response for that newer ZIP attempt, so I cannot confirm that its underlying status was also 403.

Related: #278 covers the recurring Harvard token-validation failure. This report focuses on uploads, provider diagnostics, and retry scheduling.

### Observed evidence

- Experiment: `FAEData`, ID `9XShb2sstH1d`.
- Destination: Harvard Dataverse, dataset `doi:10.7910/DVN/NLTRZD` (database ID `14297987`).
- Earlier queue records contained:

```text
errorCode: "403"
providerErrorCode: "UNAVAILABLE"
failureReason: "Provider error 403: Forbidden"
```

- The dashboard displayed the generic temporary-unavailability message.
- At one point, 20 files were queued; some had undergone multiple retries.
- Earlier recorded retry timestamps clustered around **2026-10-18 21:15:09–21:15:13 UTC**. This clustering raises a concern about synchronized retries, but does not establish the current scheduler's behavior or prove that retries caused another block.
- An isolated tiny JSON submission received HTTP 202 from `https://pipe.jspsych.org/api/data/`:

```json
{
  "error": null,
  "message": "Data received. The upload will be retried automatically.",
  "metadataMessage": ""
}
```

The filename was `Diagnostics_connection_test_20261018T222252Z_83b77322.json`. Large files and simultaneous study submissions were therefore not necessary to reproduce a queued save.

### Troubleshooting already completed

- Five sequential uploads with two-second gaps: all five failed in a run beginning approximately **2026-10-18T22:38:29Z**.
- Isolated tiny JSON submission: queued rather than delivered to Dataverse.
- One bundled ZIP per participant, with binary uploads enabled: still displayed the generic provider-unavailable message.
- Direct upload through Harvard's website to the same dataset: succeeded.
- Direct `GET /api/users/:me` using the current token and no browser cookies: HTTP 200, active account, at **2026-10-19T00:56:10Z**. Regenerating the token did not resolve DataPipe's separate connection failure.
- A point-in-time dataset-lock check returned `{"status":"OK","data":[]}`.
- Failed/queued files have been downloaded as backups.

### Why retries are a concern

If several queued uploads retry together while Harvard applies an IP-based block, they may all fail again. If DataPipe uploads share an outbound IP, this could affect different participants even after each participant sends only one ZIP. Spacing requests in the study browser does not coordinate DataPipe's later retries.

This is a hypothesis to investigate, not a confirmed explanation of DataPipe's implementation.

### Requested investigation

1. Inspect the sanitized upstream status, Content-Type, response body, request ID, and any Retry-After header for failed Harvard requests, including `POST /api/datasets/14297987/add`. Please distinguish an ISP/filter rejection from a Dataverse application error or invalid token.
2. Check whether queued uploads to this provider retry concurrently and whether they share an outbound IP.
3. Consider provider-aware concurrency limits and a shared cooldown/backoff with jitter, so a batch of failures does not all retry together during the same block. Harvard's stated approximately 30-minute block may be relevant; it should not be assumed to be a universal fixed retry interval.
4. Expose useful provider diagnostics and next-retry timing in the dashboard, while clearly distinguishing **accepted/queued by DataPipe** from **delivered to Dataverse**.

Harvard's related infrastructure discussion is https://github.com/IQSS/dataverse.harvard.edu/issues/380.

No API token or participant data is included in this report.
