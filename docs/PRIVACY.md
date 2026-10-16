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

The browser cannot read or write Firestore. Rules deny every client. The API checks household and role on each request.

BigQuery rows use a pseudonymous household id. They are still linkable to the household. They do not contain quotes, names, medicine labels, or transcripts.

Caretaker facts and conversation facts are both visible on the care desk, with their source. Consent can be paused or revoked. Revoke stops new sessions and new sharing.

Logs carry request ids and stage timing. They do not carry transcripts, names, quotes, medicine labels, or tokens.

A closed Progressive Web App does not record the room. The microphone is used while a session is open.
