# Languages

What Saathi supports in each language, layer by layer, and how much of it has been checked. Read from `api/src/saathi/languages.py`, `web/src/lib/languages.tsx`, and the code that uses them on 18 Oct 2026.

## The ten languages

| Language | Native name | Code |
| --- | --- | --- |
| Hindi (default, used by the Kamla demo) | हिन्दी | hi-IN |
| English (Indian English) | English | en-IN |
| Bengali | বাংলা | bn-IN |
| Marathi | मराठी | mr-IN |
| Gujarati | ગુજરાતી | gu-IN |
| Punjabi | ਪੰਜਾਬੀ | pa-IN |
| Tamil | தமிழ் | ta-IN |
| Telugu | తెలుగు | te-IN |
| Kannada | ಕನ್ನಡ | kn-IN |
| Malayalam | മലയാളം | ml-IN |

That is Hindi, English, and eight other Indian languages. The profile stores the English name. An unknown name falls back to Hindi (`languages.normalize`).

## Where a language is chosen

- Sign-up, the one-time details page (`/details`), the care desk Profile tab, and the family switcher when adding a person.
- When the phone connects, the server sends the household's language and the phone switches to it.
- The demo phone also has a "Phone language" picker. It changes only the words on that phone. It does not change the Live voice.

## What each language gets

| Layer | What happens | Languages | Where |
| --- | --- | --- | --- |
| **Spoken conversation (Gemini Live)** | The spoken language is set by one line in the system instruction. The same prebuilt voice (Aoede) is used for every language. The speech config has no per-language setting. For languages other than Hindi and English, the prompt asks for everyday home speech in that language and says to follow the parent if they switch to Hindi or English. | All ten | `live/prompts.py` `language_line`, `live/bridge.py` `_live_config` |
| **Words on the parent's phone** | Buttons, status lines, nearby-help labels, and the emergency note are translated. | All ten | `web/src/lib/languages.tsx` |
| **Lines the server or browser speaks itself** | The check after a loud sound ("Did you fall?") and the reply when the model is unreachable are written per language. The browser reads its own lines with the language code. | All ten | `languages.py`, `languages.tsx` |
| **Yes, no, help, and "I am fine" words** | Used for reminder confirmation and distress. Native-script lists exist for Hindi and the eight regional languages. English relies on the built-in English and Roman-Hindi lists. | All ten (see note below) | `languages.py`, `live/bridge.py`, `live/distress.py` |
| **Distress during a call** | Words from every language's help list raise an alert. A negation list ("I did not fall") wins over a help word. | All ten | `live/distress.py` |
| **Post-call extraction** | Gemini Flash reads the transcript with a language-neutral prompt whose examples are Hindi and Hinglish. If the model is unavailable, a rule parser using Roman-script Hindi and English words takes over. | Model: any language Flash reads. Fallback: Roman Hindi and English only | `memory/extract.py` |
| **Family memory** | Episodes are embedded with `text-multilingual-embedding-002`. | Any language the embedding model covers | `memory/vectors.py` |
| **Reading a prescription or report** | The family summary is in English. A second summary is written in the parent's language, in that script. If the page cannot be read, the server's own "could not be read" line is given. | Second summary: nine non-English languages. Unreadable line: nine non-English languages | `files/read_note.py` |
| **Pause and pace comparison on the care desk** | The English sentence is kept. The same comparison is also shown in the profile language. | Hindi and the eight regional languages (not English) | `web/src/lib/languages.tsx` `PACE` |

## What is English only

- **The care desk** (the caretaker's screens, alerts, and messages). The only translated lines are the pace comparison and the second prescription summary.
- **Family-facing insight text and Ask Saathi answers.** They are written in English and checked by SafetyGuard.
- **SafetyGuard.** Its patterns cover English and Roman-script Hindi (for example "dimagi bimari", "manovikar", "avsaad"). It does not have patterns for diagnoses or doses written in other scripts. The only non-English text the family sees is the second prescription summary, which passes through the same English patterns. A dose written with Latin letters and units such as "40 mg" is caught. A diagnosis written in Tamil or Bengali script is not. Treat that second summary as a convenience copy, and the caretaker confirms every line before anything is saved.
- **The on-phone word check** (`web/src/lib/edgeGemma.ts`, offers 112 with no network). Its keyword list is Roman-script Hindi and English only (such as "gir", "dard", "chest", "madad", "bachao"). It does not cover native scripts.

## What has been checked

| Check | Result |
| --- | --- |
| Live voice, spoken to by a person | **Hindi and Marathi.** Hindi is the language of the demo and was checked during development. The team reports that the Live voice was also checked in Marathi (an account with Marathi as its profile language). No automated test covers Marathi, and no voice check is recorded for the other eight languages. |
| Automated tests | Distress, negation, and reminder confirmation tests use Hindi and English. `test_read_note.py` covers the Tamil second summary and the Bengali unreadable line, with the model stubbed. No test covers a native-script distress word, the Live prompt for a non-Hindi language, or a non-Hindi reply. See [TEST_CASES.md](TEST_CASES.md). |
| Extraction eval | All 30 cases are Roman-script Hindi, Hinglish, or English. None uses a native script or another language. |
| Phone screens in each language | Written and present in the code for all ten. No review by a native speaker is recorded. |
| Browser speech in each language | The browser speaks and listens with the language code. Whether a given phone has a voice or recognizer for it depends on the browser and device. Not checked per language. |

## How to describe it accurately

- "Saathi speaks with a parent in Hindi, with English and eight other Indian languages selectable." True. Hindi and Marathi have been checked by voice by the team.
- "The Live voice follows the profile language through its prompt." True. Quality has been checked in Hindi and Marathi only.
- Not supported by the code: a claim that all ten languages are equally tested, that the care desk is multilingual, or that distress and safety checks are validated in every script.

## Adding or changing a language

1. Add a `Language` entry to `api/src/saathi/languages.py`: name, native name, code, the two server lines, and the yes, no, help, and fine lists.
2. Add the matching entry, with all phone words, to `web/src/lib/languages.tsx`, and a `PACE` line if it should have one.
3. Add the "could not be read" line to `_UNREADABLE` in `files/read_note.py`.
4. Add a test, then check the voice with a speaker before listing it as supported.
