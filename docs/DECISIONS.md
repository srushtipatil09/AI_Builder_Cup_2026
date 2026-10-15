# Decisions

Short records. The current choice is the last line of each one.

## D1. One image, two Cloud Run services

The voice API and the post-call worker scale differently. One image, selected with `APP_MODULE`, keeps the deploy small. The worker is private.

## D2. Cloud Tasks, not a second event bus

The post-call job is one HTTP call that must be safe to retry. Cloud Tasks names that job by session id. Pub/Sub and Eventarc are for fan-out. This prototype does not build both.

## D3. Firestore is the record. BigQuery is the comparison.

The care desk reads Firestore. BigQuery stores daily numbers and the drift query. Quotes and names stay out of BigQuery.

## D4. The pause is measured in the browser

Gemini Live does not emit a response-gap field. An AudioWorklet timestamps playback end and speech start on one clock.

## D5. Family contact is a question, not a chat import

Saathi asks when a named person has gone quiet and stores the answer as an episode with an embedding. It does not read WhatsApp.

## D6. Firestore vector search for this deadline

A household has dozens of episodes. Firestore vector search can hold that index. A Vertex AI Vector Search endpoint is the later scale path.

## D7. Distress is a question, then a rule

A cry or a loud sound during an open session makes Saathi ask what happened. The family is told immediately if the person asks for help, or if nobody answers. The sentence does not invent a confirmed fall.

## D8. Two fronts, one app

The landing page is for everyone. At 1024px and wider the signed-in app is the care desk. Below that it is the chat, and only the chat. Revised 15 Oct 2026: the phone no longer has a Care desk button, so the parent's screen has the least friction. The desk is five tabs: Profile, Routine, Ask Saathi, Reminders, and Trusted Contacts. Revised again 15 Oct 2026: the caretaker side is its own app at `/care`, for phone and desktop, with its own demo on the landing page.

## D9. A closed app does not listen

Check-in delivery is a Firebase notification. Speech starts after the app is open. This is the limit of a Progressive Web App.

## D10. Nest is M16

Conversational Actions ended on 13 June 2023. The Sunday demo does not show a Nest Hub. The later milestone re-reads the Home docs before any linking button is treated as real.

## D11. Research numbers are cited, not measured here

Holt-Lunstad 2015, the 2025 WHO commission, and LASI may appear on a slide with their sources. They are not results of this prototype. Rat Park is not an impact citation.

## D12. Latest Google features, picked for a small bill

Live audio is the costly part, so it runs only inside a 240 second session on request-billed Cloud Run that scales to zero. Flash does the clip label, extraction, and insight. Implicit context caching is left on. An explicit cache is created only when the shared prefix is at least 4,096 tokens, which is the Gemini 3 minimum. Firestore vector search replaces a Vector Search replica. BigQuery stays on-demand with a 100 MiB byte cap. GPUs, provisioned throughput, Agent Engine, and BigQuery editions stay out.

## D13. Two kinds of account, joined by a family code

Signup cannot tell an older adult from a caretaker, so it asks first, and the role stays with the account; Log in does not ask again. The caretaker creates the household and shares a family code. The parent joins after signing in, can skip that step, and can join later from the chat. The join link carries only the code. Roles route to separate apps: `/care` for the caretaker, `/app` for the parent.
