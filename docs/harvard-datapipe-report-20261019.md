# Harvard Dataverse uploads fail after ZIP bundling; investigate overlapping retries

I’ve emailed datapipe@jspsych.org about these recurring failures and am summarizing the findings here for visibility. Related connection issue: #278.

**What we’ve established**

- DataPipe accepted a tiny standalone JSON submission with **HTTP 202**, but it remained queued. Earlier queue records showed `errorCode: "403"`, `providerErrorCode: "UNAVAILABLE"`, and `Provider error 403: Forbidden`. The dashboard instead displayed “Your storage provider was temporarily unavailable.”
- Five sequential uploads with two-second gaps all failed. Switching to **one ZIP per participant**, with binary uploads enabled, still produced the generic provider-unavailable message. I have not captured the upstream HTTP status for that ZIP attempt.
- The same current Harvard token returned **HTTP 200** from a direct `GET /api/users/:me` request without browser cookies, while DataPipe rejected the connection. Regenerating the token did not resolve it.
- A direct upload through Harvard’s website to the same dataset succeeded, and a point-in-time dataset-lock check returned no locks.

**Harvard’s response and our follow-up concern**

Harvard support attributed the problem to their ISP’s strict traffic filtering during ongoing bot attacks. They said the block should expire after approximately **30 minutes** and recommended ZIP bundles to reduce upload requests.

Earlier retry timestamps clustered within a few seconds. If queued files retry together—and particularly if uploads share an outbound IP—they may all fail again during the block or potentially trigger another limit. That remains a concern to investigate, not a confirmed cause. Client-side spacing cannot coordinate DataPipe’s server-side retries.

**Could you investigate:**

1. The actual upstream errors for both token validation and uploads, rather than only the generic dashboard messages.
2. Whether Harvard-bound retries overlap or share an outbound IP, and whether a provider-wide cooldown, limited concurrency, and staggered retries would help.

Survey, experiment, dataset and account identifiers are omitted here; I can provide them privately.
