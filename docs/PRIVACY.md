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
| Private file links | Signed by the API (`LINK_SIGNING_SECRET`) | 30 minutes. A tampered or expired link is refused |

The 7-day and 30-day rows above are a starting policy. This build does not yet delete transcripts or summaries on that clock.

The browser cannot read or write Firestore. Rules deny every client. The API checks household and role on each request. The storage bucket stays private. A shared photo is served by the API from a public folder path, not by a public bucket grant.

BigQuery rows use a pseudonymous household id. They are still linkable to the household. They do not contain quotes, names, medicine labels, or transcripts.

Caretaker memories and conversation corrections are both visible on the care desk. A caretaker memory shows the caretaker's name. A conversation correction shows `conversation`. Pausing or revoking consent is not implemented in this build.

Logs carry request ids and stage timing. They do not carry transcripts, names, quotes, medicine labels, or tokens.

A closed Progressive Web App does not record the room. The microphone is used while a session is open.
