"""The languages Saathi can speak with a parent. The profile stores the English name ("Hindi", "Tamil", ...).

Gemini Live's native-audio model picks its spoken language from the system instruction, so the name and the
native name here go into the prompt. The short phrases are what the server says itself when the model is not
reachable, and the word lists widen the yes, no and help checks beyond Hindi and English.
"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Language:
    name: str
    native: str
    code: str
    # Said by the server itself: the spoken check after a loud sound, and the reply when the model is unreachable.
    fall_check: str
    listening: str
    yes: list[str] = field(default_factory=list)
    no: list[str] = field(default_factory=list)
    # "Save me", "help", "I fell". Any of these raises a Level 3 alert, so only unambiguous phrases.
    help: list[str] = field(default_factory=list)
    # "I did not fall", "I am fine". A negation wins over a help word.
    fine: list[str] = field(default_factory=list)


DEFAULT = "Hindi"

LANGUAGES: dict[str, Language] = {
    lang.name: lang
    for lang in [
        Language(
            "Hindi", "हिन्दी", "hi-IN",
            fall_check="Kya hua? Gir gaye kya? Main yahin hoon.",
            listening="Ji, main sun rahi hoon. Aaj aapka din kaisa raha?",
            yes=["हाँ", "हां", "जी", "ठीक है", "बिल्कुल"],
            no=["नहीं", "मत", "रहने दो"],
            help=["बचाओ", "मदद करो", "मैं गिर गई", "मैं गिर गया"],
            fine=["गिरी नहीं", "गिरा नहीं", "मैं ठीक हूँ", "मैं ठीक हूं"],
        ),
        Language(
            "English", "English", "en-IN",
            fall_check="What happened? Did you fall? I am right here.",
            listening="I am listening. How has your day been?",
        ),
        Language(
            "Bengali", "বাংলা", "bn-IN",
            fall_check="কী হলো? পড়ে গেছেন? আমি এখানেই আছি।",
            listening="আমি শুনছি। আজ আপনার দিন কেমন কাটল?",
            yes=["হ্যাঁ", "হাঁ", "ঠিক আছে", "আচ্ছা"],
            no=["না", "থাক", "বাতিল"],
            help=["বাঁচাও", "সাহায্য করো", "পড়ে গেছি"],
            fine=["পড়িনি", "ঠিক আছি"],
        ),
        Language(
            "Marathi", "मराठी", "mr-IN",
            fall_check="काय झालं? पडलात का? मी इथेच आहे.",
            listening="मी ऐकतेय. आज तुमचा दिवस कसा गेला?",
            yes=["हो", "होय", "ठीक आहे", "चालेल"],
            no=["नाही", "नको", "थांबा"],
            help=["वाचवा", "मदत करा", "मी पडले", "मी पडलो"],
            fine=["पडले नाही", "पडलो नाही", "मी ठीक आहे"],
        ),
        Language(
            "Gujarati", "ગુજરાતી", "gu-IN",
            fall_check="શું થયું? પડી ગયા? હું અહીં જ છું.",
            listening="હું સાંભળું છું. આજે તમારો દિવસ કેવો રહ્યો?",
            yes=["હા", "હાં", "બરાબર", "ઠીક છે"],
            no=["ના", "નહીં", "રહેવા દો"],
            help=["બચાવો", "મદદ કરો", "હું પડી ગઈ", "હું પડી ગયો"],
            fine=["પડી નથી", "પડ્યો નથી", "ઠીક છું"],
        ),
        Language(
            "Punjabi", "ਪੰਜਾਬੀ", "pa-IN",
            fall_check="ਕੀ ਹੋਇਆ? ਡਿੱਗ ਗਏ? ਮੈਂ ਇੱਥੇ ਹੀ ਹਾਂ।",
            listening="ਮੈਂ ਸੁਣ ਰਹੀ ਹਾਂ। ਅੱਜ ਤੁਹਾਡਾ ਦਿਨ ਕਿਵੇਂ ਰਿਹਾ?",
            yes=["ਹਾਂ", "ਹਾਂਜੀ", "ਠੀਕ ਹੈ"],
            no=["ਨਹੀਂ", "ਨਾ", "ਰਹਿਣ ਦਿਓ"],
            help=["ਬਚਾਓ", "ਮਦਦ ਕਰੋ", "ਮੈਂ ਡਿੱਗ ਪਈ", "ਮੈਂ ਡਿੱਗ ਪਿਆ"],
            fine=["ਨਹੀਂ ਡਿੱਗੀ", "ਨਹੀਂ ਡਿੱਗਿਆ", "ਮੈਂ ਠੀਕ ਹਾਂ"],
        ),
        Language(
            "Tamil", "தமிழ்", "ta-IN",
            fall_check="என்ன ஆச்சு? கீழே விழுந்துட்டீங்களா? நான் இங்கேயே இருக்கேன்.",
            listening="நான் கேட்டுக்கிட்டு இருக்கேன். இன்னைக்கு உங்க நாள் எப்படி இருந்தது?",
            yes=["ஆமா", "ஆமாம்", "சரி"],
            no=["வேண்டாம்", "இல்லை", "இல்ல"],
            help=["காப்பாத்துங்க", "காப்பாற்றுங்கள்", "விழுந்துட்டேன்"],
            fine=["விழலை", "விழவில்லை", "நல்லா இருக்கேன்"],
        ),
        Language(
            "Telugu", "తెలుగు", "te-IN",
            fall_check="ఏమైంది? కింద పడ్డారా? నేను ఇక్కడే ఉన్నాను.",
            listening="నేను వింటున్నాను. ఈరోజు మీ రోజు ఎలా గడిచింది?",
            yes=["అవును", "సరే", "ఔను"],
            no=["వద్దు", "కాదు", "లేదు"],
            help=["కాపాడండి", "కింద పడ్డాను"],
            fine=["పడలేదు", "బాగానే ఉన్నాను"],
        ),
        Language(
            "Kannada", "ಕನ್ನಡ", "kn-IN",
            fall_check="ಏನಾಯಿತು? ಬಿದ್ದಿರಾ? ನಾನು ಇಲ್ಲೇ ಇದ್ದೇನೆ.",
            listening="ನಾನು ಕೇಳುತ್ತಿದ್ದೇನೆ. ಇವತ್ತು ನಿಮ್ಮ ದಿನ ಹೇಗಿತ್ತು?",
            yes=["ಹೌದು", "ಸರಿ", "ಆಗಲಿ"],
            no=["ಬೇಡ", "ಇಲ್ಲ"],
            help=["ಕಾಪಾಡಿ", "ಬಿದ್ದುಬಿಟ್ಟೆ"],
            fine=["ಬಿದ್ದಿಲ್ಲ", "ಚೆನ್ನಾಗಿದ್ದೇನೆ"],
        ),
        Language(
            "Malayalam", "മലയാളം", "ml-IN",
            fall_check="എന്തു പറ്റി? വീണോ? ഞാൻ ഇവിടെത്തന്നെ ഉണ്ട്.",
            listening="ഞാൻ കേൾക്കുന്നുണ്ട്. ഇന്ന് നിങ്ങളുടെ ദിവസം എങ്ങനെയുണ്ടായിരുന്നു?",
            yes=["അതെ", "ശരി", "ഉവ്വ്"],
            no=["വേണ്ട", "ഇല്ല"],
            help=["രക്ഷിക്കണേ", "സഹായിക്കണേ", "ഞാൻ വീണു"],
            fine=["വീണില്ല", "കുഴപ്പമില്ല"],
        ),
    ]
}


def normalize(name: str | None) -> str:
    """A known language name, or Hindi."""
    for known in LANGUAGES:
        if (name or "").strip().lower() == known.lower():
            return known
    return DEFAULT


def get(name: str | None) -> Language:
    return LANGUAGES[normalize(name)]


def all_words(kind: str) -> list[str]:
    """Every language's yes, no, help or fine words, for checks that do not know the household's language."""
    return [w for lang in LANGUAGES.values() for w in getattr(lang, kind)]
