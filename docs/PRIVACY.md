# Privacy

This is a prototype policy. It is not a DPDP or HIPAA certification.

| Data | Where | How long, as a starting policy |
| --- | --- | --- |
| Raw audio | Transient buffers for the open session and a short impact clip | Not stored as a recording in this design |
| Transcripts | Firestore | 7 days |
| Summaries, observations, analytics | Firestore and BigQuery daily numbers | 30 days |
| Verified facts and active reminders | Firestore | Until deleted |
| Family-episode embeddings | Firestore, household scoped | Same lifetime as the episode |
| Push text | The phone lock screen | Generic. No name, quote, or medicine |
| Account profile | Firestore `users/<uid>`, written by `GET` and `PUT /api/v1/me` | Until the account is deleted. Role, names, language, and family code |
| Photos and documents | Cloud Storage, with metadata in Firestore `households/<id>/files` | Until deleted. Prescriptions, reports, bills, medicine strips, identity proofs, and insurance are always private |
| Private file links | Signed by the API with `LINK_SIGNING_SECRET`, kept in Secret Manager (`saathi-link-signing`) | 30 minutes. A tampered or expired link is refused |
| Parent's position | Firestore `households/<id>/place/current`, rounded to about 100 m, saved once after the parent taps Allow location; never saved for the shared demo | Until the family taps Forget the position, or it is replaced. Sent to the Places API (New) only to search hospitals, parks, food, and medical shops within 5 km. The city on the care desk is the fallback and is not a GPS point |
| Places results | The API process, for one hour | Not written to Firestore. A failed Places call returns no places; helplines and trusted people still return |
| Extra family members | Firestore, on the caretaker's `users/<uid>` document, field `households`, plus a household record `hh-...` | Until removed. At most 10 households on one account. The list is written only by `POST /api/v1/me/households` |
| Consent | Firestore `users/<uid>.consentAt`, set when Create account is submitted with the agreement box ticked | Until the account is deleted |
| Demo visitor counter | Firestore `_usage/<day>/demo_visitors/<hash>` | A daily, salted hash of the caller's address, not the address. Counts demo voice sessions (three a day) |

The worker's `/internal/retention` route applies the 7-day and 30-day rows: it clears the words from session records after 7 days (the measurements stay) and deletes observations, Firestore daily numbers, and BigQuery `daily_metrics` rows after 30 days. Cloud Scheduler job `saathi-retention` calls it daily at 21:30 UTC once `deployment/scripts/setup_cloud.ps1` has been run. Family episodes are verified facts and stay until deleted.

The browser cannot read or write Firestore. Rules deny every client. The API checks household and role on each request. The storage bucket stays private. A shared photo is served by the API from a public folder path, not by a public bucket grant.

BigQuery rows use a pseudonymous household id. They are still linkable to the household. They do not contain quotes, names, medicine labels, or transcripts.

Caretaker memories and conversation corrections are both visible on the care desk. A caretaker memory shows the caretaker's name. A conversation correction shows `conversation`. Create account requires the agreement box. Pausing or revoking consent is not implemented in this build.

Logs carry request ids and stage timing. They do not carry transcripts, names, quotes, medicine labels, or tokens.

A closed Progressive Web App does not record the room. The microphone is used while a session is open.
