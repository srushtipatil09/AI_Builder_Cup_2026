# Decisions

Short records. The current choice is the last line of each one.

## D1. One image, two Cloud Run services

The voice API and the post-call worker scale differently. One image, selected with `APP_MODULE`, keeps the deploy small. The worker is private.

## D2. Cloud Tasks, not a second event bus

The post-call job is one HTTP call that must be safe to retry. Cloud Tasks names that job by session id. Pub/Sub and Eventarc are for fan-out. This prototype does not build both.

## D3. Firestore is the record. BigQuery is the comparison.

The care desk reads Firestore. BigQuery stores daily numbers and the drift query. Quotes and names stay out of BigQuery.

## D4. The pause is measured in the browser

Gemini Live does not emit a response-gap field. The AudioWorklet records the parent's last loud frame, and the page stores the wait until the first reply audio. The median of those waits is `response_gap_ms`. The live chat does not estimate speaking rate.

## D5. Family contact is a question, not a chat import

Saathi asks when a named person has gone quiet and stores the answer as an episode with an embedding. It does not read WhatsApp.

## D6. Firestore vector search for this deadline

A household has dozens of episodes. Firestore vector search can hold that index. A Vertex AI Vector Search endpoint is the later scale path.

## D7. Distress is a question, then a rule

A cry or a loud sound during an open session makes Saathi ask what happened. The family is told immediately if the person asks for help, or if nobody answers. The sentence does not invent a confirmed fall.

## D8. Two fronts, one app

The landing page is for everyone. Role chooses the signed-in app: `/care` for a caretaker, `/app` for a parent. On the care desk, 1024px and wider uses a sidebar and a narrower window uses bottom tabs. Width does not put a parent on the desk. The desk is five tabs: Profile, Routine, Ask Saathi, Reminders, and Trusted Contacts. The landing page offers both demos. Earlier on 15 Oct 2026 the split was by window width; that routing is no longer what the app does.

## D9. A closed app does not listen

Check-in delivery is a Firebase notification. Speech starts after the app is open. This is the limit of a Progressive Web App.

## D10. Nest is M16

Conversational Actions ended on 13 June 2023. The Sunday demo does not show a Nest Hub. The later milestone re-reads the Home docs before any linking button is treated as real.

## D11. Research numbers are cited, not measured here

Holt-Lunstad 2015, the 2025 WHO commission, and LASI may appear on a slide with their sources. They are not results of this prototype. Rat Park is not an impact citation.

## D12. Latest Google features, picked for a small bill

Live audio is the costly part, so it runs only inside a 240 second session on request-billed Cloud Run that scales to zero. The running defaults are Live `gemini-live-2.5-flash-native-audio` (voice `Aoede`), Flash `gemini-2.5-flash` for the clip label, extraction, and insight, and embeddings `text-multilingual-embedding-002`. `use_explicit_context_cache` allows an explicit cache only at 4,096 tokens or more. The Live path does not call it. Firestore vector search replaces a Vector Search replica. BigQuery stays on-demand with a 100 MiB byte cap. GPUs, provisioned throughput, Agent Engine, and BigQuery editions stay out.

## D13. Two kinds of account, joined by a family code

Signup cannot tell an older adult from a caretaker, so it asks first, and the role stays with the account; Log in does not ask again. The caretaker creates the household and shares a family code. The parent joins after signing in, can skip that step, and can join later from the chat. The join link carries only the code. Roles route to separate apps: `/care` for the caretaker, `/app` for the parent. Profiles and family codes are stored in Firestore through the API, so a new device can restore them.

## D14. Photos and documents stay in a private bucket

Uploads go to Cloud Storage through the API. The bucket name is `UPLOADS_BUCKET`, or `{project}-media` when that is empty. The object path is who uploaded, public or private, the account id, the category, then the file name. Prescriptions, medical reports, medical bills, medicine strips, identity proofs, and insurance are always private. A private file opens with a link the API signs for a household member; the link lasts 30 minutes (`LINK_SIGNING_SECRET`). A photo the family chose to share is served by the API without sign-in, and only from the public folders. The bucket itself is not public.

## D15. ADK is optional. SafetyGuard is not

Caregiver sentences always pass `compose_family_insight`. The three insight tools run in a fixed order by default. An ADK `root_agent` words the notice only when `google-adk` is installed and `INSIGHT_USE_ADK` is left on. Any failure uses the fixed order. The model does not choose the household, the tier, or the evidence ids. Tier 1 does not call the agent.

## D16. Nearby help is a place and a button, not advice

The parent asks. `find_nearby` uses the Places API (New) for a hospital, a medical shop, a park, or food, and returns trusted people and the helplines 112, 108, and 14567 from stored data. `offer_call` shows a Call button. The number is resolved on the server. The model does not dial and does not invent a number. The stored position is one point rounded to about 100 metres, and only after the parent allows it. The shared demo does not keep a position. After 9 pm a park is not offered.

## D17. One caretaker, many households

Signup cannot tell an older adult from a caretaker, so the role stays with the account. A caretaker may look after up to 10 people. Each added member is a new household (`hh-...`) with its own desk and family code. `POST /api/v1/me/households` is the only writer of that list.

## D18. Seeing a reminder is not doing it

The lock screen says the line the family wrote and never a dose. A phone that accepts the push sets `seenOn`. `confirmedOn` is set when the parent agrees in their own words. A bare "ji" is not agreement. A later desk save must not clear either field.

## D19. The spoken language is a profile field

Ten languages have a Live prompt line and server phrases for the distress check, listening fallback, and yes, no, help, and fine. Hindi is the default. The Kamla demo uses it. The same list is what the phone speaks when Gemini Live is not the voice.

## D20. The reply does not wait for a lookup

The Live socket opens when the chat page opens. Talk sends start on that connection. The household, memories, reminders, recent summaries, and the family thread are already in the system instruction. Microphone audio is forwarded as 16 kHz PCM. Reply audio is 24 kHz PCM, played gapless, and dropped if the parent talks over Saathi. Extraction and drift run after the socket closes.

## D21. The phone keeps a copy. Firestore keeps the record

Redux holds the desk and the slower reads. Both are written to versioned localStorage and shared across tabs of this browser. Log out deletes them. A private file link is never stored there. A push is "seen". The parent's own agreement is "confirmed".


