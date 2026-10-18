// The languages Saathi speaks with a parent. The profile stores the English name; the server keeps the same list
// in api/src/saathi/languages.py. Each language carries the words on the parent's phone and the lines the
// browser speaks itself when Gemini Live is not reachable.

export type PhoneWords = {
  idle: string;
  connecting: string;
  listening: string;
  thinking: string;
  speaking: string;
  paused: string;
  talk: string;
  resume: string;
  moment: string;
  stop: string;
  pause: string;
  family: string;
  askFamily: string;
  yesTell: string;
  no: string;
  call: string;
  nearby: string;
  close: string;
  hospital: string;
  pharmacy: string;
  people: string;
  park: string;
  food: string;
  helplines: string;
  emergency: string;
  parkLate: string;
  hello: string;
  // Spoken by the browser. `n` is " Name" or "".
  greet: (n: string) => string;
  late: (n: string) => string;
  telling: string;
};

export type Language = { name: string; native: string; code: string; words: PhoneWords };

const hindi: PhoneWords = {
  idle: "बात करने के लिए दबाइए",
  connecting: "जुड़ रही हूँ…",
  listening: "सुन रही हूँ",
  thinking: "सोच रही हूँ…",
  speaking: "बोल रही हूँ",
  paused: "बातचीत रुकी हुई है",
  talk: "बात करें",
  resume: "फिर से शुरू करें",
  moment: "एक पल…",
  stop: "बंद करें",
  pause: "रोकें",
  family: "परिवार",
  askFamily: "परिवार को बताएँ कि आप बात करना चाहते हैं?",
  yesTell: "हाँ, बता दीजिए",
  no: "नहीं",
  call: "कॉल करें",
  nearby: "आस-पास की मदद",
  close: "बंद करें",
  hospital: "अस्पताल",
  pharmacy: "दवा की दुकान",
  people: "अपने लोग",
  park: "पार्क",
  food: "खाना",
  helplines: "हेल्पलाइन",
  emergency: "आपात स्थिति में पहले 112 पर कॉल करें।",
  parkLate: "रात हो गई है। पार्क कल सुबह जाइए।",
  hello: "नमस्ते",
  greet: (n) => `Namaste${n}, aaj aapka din kaisa raha?`,
  late: (n) => `Namaste${n}, raat ho gayi hai. Sab theek hai na?`,
  telling: "Main parivaar ko alert bhej rahi hoon ki aap baat karna chahte hain.",
};

export const LANGUAGES: Language[] = [
  { name: "Hindi", native: "हिन्दी", code: "hi-IN", words: hindi },
  {
    name: "English",
    native: "English",
    code: "en-IN",
    words: {
      idle: "Tap to talk",
      connecting: "Connecting…",
      listening: "Listening",
      thinking: "Thinking…",
      speaking: "Saathi is speaking",
      paused: "Paused",
      talk: "Talk",
      resume: "Resume",
      moment: "One moment…",
      stop: "Stop",
      pause: "Pause",
      family: "Family",
      askFamily: "Tell your family you want to talk?",
      yesTell: "Yes, tell them",
      no: "No",
      call: "Call",
      nearby: "Nearby help",
      close: "Close",
      hospital: "Hospitals",
      pharmacy: "Medical shops",
      people: "My people",
      park: "Parks",
      food: "Food",
      helplines: "Helplines",
      emergency: "In an emergency, call 112 first.",
      parkLate: "It is late. A park is better in the morning.",
      hello: "Namaste",
      greet: (n) => `Namaste${n}, how has your day been?`,
      late: (n) => `Namaste${n}, it is late now. Is everything all right?`,
      telling: "I am letting your family know that you want to talk.",
    },
  },
  {
    name: "Bengali",
    native: "বাংলা",
    code: "bn-IN",
    words: {
      idle: "কথা বলতে চাপুন",
      connecting: "যুক্ত হচ্ছে…",
      listening: "শুনছি",
      thinking: "ভাবছি…",
      speaking: "বলছি",
      paused: "থামানো আছে",
      talk: "কথা বলুন",
      resume: "আবার শুরু করুন",
      moment: "এক মুহূর্ত…",
      stop: "শেষ করুন",
      pause: "থামান",
      family: "পরিবার",
      askFamily: "পরিবারকে জানাব যে আপনি কথা বলতে চান?",
      yesTell: "হ্যাঁ, জানান",
      no: "না",
      call: "কল করুন",
      nearby: "কাছাকাছি সাহায্য",
      close: "বন্ধ করুন",
      hospital: "হাসপাতাল",
      pharmacy: "ওষুধের দোকান",
      people: "আপনজন",
      park: "পার্ক",
      food: "খাবার",
      helplines: "হেল্পলাইন",
      emergency: "জরুরি অবস্থায় আগে 112-তে ফোন করুন।",
      parkLate: "রাত হয়ে গেছে। পার্কে কাল সকালে।",
      hello: "নমস্কার",
      greet: (n) => `নমস্কার${n}, আজ আপনার দিন কেমন কাটল?`,
      late: (n) => `নমস্কার${n}, রাত হয়ে গেছে। সব ঠিক আছে তো?`,
      telling: "আমি পরিবারকে জানাচ্ছি যে আপনি কথা বলতে চান।",
    },
  },
  {
    name: "Marathi",
    native: "मराठी",
    code: "mr-IN",
    words: {
      idle: "बोलण्यासाठी दाबा",
      connecting: "जोडत आहे…",
      listening: "ऐकतेय",
      thinking: "विचार करतेय…",
      speaking: "बोलतेय",
      paused: "थांबवले आहे",
      talk: "बोला",
      resume: "पुन्हा सुरू करा",
      moment: "एक क्षण…",
      stop: "बंद करा",
      pause: "थांबवा",
      family: "कुटुंब",
      askFamily: "तुम्हाला बोलायचं आहे असं कुटुंबाला सांगू का?",
      yesTell: "हो, सांगा",
      no: "नाही",
      call: "कॉल करा",
      nearby: "जवळपास मदत",
      close: "बंद करा",
      hospital: "रुग्णालय",
      pharmacy: "औषधांचे दुकान",
      people: "आपली माणसं",
      park: "बाग",
      food: "जेवण",
      helplines: "हेल्पलाइन",
      emergency: "आणीबाणीत आधी 112 वर कॉल करा.",
      parkLate: "रात्र झाली आहे. बागेत उद्या सकाळी.",
      hello: "नमस्कार",
      greet: (n) => `नमस्कार${n}, आज तुमचा दिवस कसा गेला?`,
      late: (n) => `नमस्कार${n}, रात्र झाली आहे. सगळं ठीक आहे ना?`,
      telling: "तुम्हाला बोलायचं आहे असं मी कुटुंबाला कळवतेय.",
    },
  },
  {
    name: "Gujarati",
    native: "ગુજરાતી",
    code: "gu-IN",
    words: {
      idle: "વાત કરવા માટે દબાવો",
      connecting: "જોડાઈ રહ્યું છે…",
      listening: "સાંભળું છું",
      thinking: "વિચારું છું…",
      speaking: "બોલું છું",
      paused: "થોભાવ્યું છે",
      talk: "વાત કરો",
      resume: "ફરી શરૂ કરો",
      moment: "એક પળ…",
      stop: "બંધ કરો",
      pause: "થોભાવો",
      family: "પરિવાર",
      askFamily: "પરિવારને કહું કે તમે વાત કરવા માંગો છો?",
      yesTell: "હા, કહો",
      no: "ના",
      call: "કૉલ કરો",
      nearby: "નજીકમાં મદદ",
      close: "બંધ કરો",
      hospital: "હોસ્પિટલ",
      pharmacy: "દવાની દુકાન",
      people: "પોતાના લોકો",
      park: "બગીચો",
      food: "જમવાનું",
      helplines: "હેલ્પલાઇન",
      emergency: "કટોકટીમાં પહેલા 112 પર ફોન કરો.",
      parkLate: "રાત થઈ ગઈ છે. બગીચે કાલે સવારે.",
      hello: "નમસ્તે",
      greet: (n) => `નમસ્તે${n}, આજે તમારો દિવસ કેવો રહ્યો?`,
      late: (n) => `નમસ્તે${n}, રાત થઈ ગઈ છે. બધું બરાબર છે ને?`,
      telling: "હું પરિવારને જણાવું છું કે તમે વાત કરવા માંગો છો.",
    },
  },
  {
    name: "Punjabi",
    native: "ਪੰਜਾਬੀ",
    code: "pa-IN",
    words: {
      idle: "ਗੱਲ ਕਰਨ ਲਈ ਦਬਾਓ",
      connecting: "ਜੁੜ ਰਿਹਾ ਹੈ…",
      listening: "ਸੁਣ ਰਹੀ ਹਾਂ",
      thinking: "ਸੋਚ ਰਹੀ ਹਾਂ…",
      speaking: "ਬੋਲ ਰਹੀ ਹਾਂ",
      paused: "ਰੁਕਿਆ ਹੋਇਆ ਹੈ",
      talk: "ਗੱਲ ਕਰੋ",
      resume: "ਫਿਰ ਸ਼ੁਰੂ ਕਰੋ",
      moment: "ਇੱਕ ਪਲ…",
      stop: "ਬੰਦ ਕਰੋ",
      pause: "ਰੋਕੋ",
      family: "ਪਰਿਵਾਰ",
      askFamily: "ਪਰਿਵਾਰ ਨੂੰ ਦੱਸਾਂ ਕਿ ਤੁਸੀਂ ਗੱਲ ਕਰਨਾ ਚਾਹੁੰਦੇ ਹੋ?",
      yesTell: "ਹਾਂ, ਦੱਸੋ",
      no: "ਨਹੀਂ",
      call: "ਕਾਲ ਕਰੋ",
      nearby: "ਨੇੜੇ ਮਦਦ",
      close: "ਬੰਦ ਕਰੋ",
      hospital: "ਹਸਪਤਾਲ",
      pharmacy: "ਦਵਾਈ ਦੀ ਦੁਕਾਨ",
      people: "ਆਪਣੇ ਲੋਕ",
      park: "ਪਾਰਕ",
      food: "ਖਾਣਾ",
      helplines: "ਹੈਲਪਲਾਈਨ",
      emergency: "ਐਮਰਜੈਂਸੀ ਵਿੱਚ ਪਹਿਲਾਂ 112 'ਤੇ ਫ਼ੋਨ ਕਰੋ।",
      parkLate: "ਰਾਤ ਹੋ ਗਈ ਹੈ। ਪਾਰਕ ਕੱਲ੍ਹ ਸਵੇਰੇ।",
      hello: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ",
      greet: (n) => `ਸਤ ਸ੍ਰੀ ਅਕਾਲ${n}, ਅੱਜ ਤੁਹਾਡਾ ਦਿਨ ਕਿਵੇਂ ਰਿਹਾ?`,
      late: (n) => `ਸਤ ਸ੍ਰੀ ਅਕਾਲ${n}, ਰਾਤ ਹੋ ਗਈ ਹੈ। ਸਭ ਠੀਕ ਹੈ ਨਾ?`,
      telling: "ਮੈਂ ਪਰਿਵਾਰ ਨੂੰ ਦੱਸ ਰਹੀ ਹਾਂ ਕਿ ਤੁਸੀਂ ਗੱਲ ਕਰਨਾ ਚਾਹੁੰਦੇ ਹੋ।",
    },
  },
  {
    name: "Tamil",
    native: "தமிழ்",
    code: "ta-IN",
    words: {
      idle: "பேச அழுத்தவும்",
      connecting: "இணைக்கிறது…",
      listening: "கேட்கிறேன்",
      thinking: "யோசிக்கிறேன்…",
      speaking: "பேசுகிறேன்",
      paused: "இடைநிறுத்தப்பட்டது",
      talk: "பேச",
      resume: "தொடர",
      moment: "ஒரு நிமிடம்…",
      stop: "முடிக்க",
      pause: "நிறுத்த",
      family: "குடும்பம்",
      askFamily: "நீங்கள் பேச விரும்புவதாக குடும்பத்திடம் சொல்லட்டுமா?",
      yesTell: "ஆம், சொல்லுங்கள்",
      no: "வேண்டாம்",
      call: "அழைக்கவும்",
      nearby: "அருகில் உதவி",
      close: "மூட",
      hospital: "மருத்துவமனை",
      pharmacy: "மருந்துக்கடை",
      people: "நம்மவர்கள்",
      park: "பூங்கா",
      food: "சாப்பாடு",
      helplines: "உதவி எண்கள்",
      emergency: "அவசரத்தில் முதலில் 112-ஐ அழைக்கவும்.",
      parkLate: "இரவு ஆகிவிட்டது. பூங்கா நாளை காலை.",
      hello: "வணக்கம்",
      greet: (n) => `வணக்கம்${n}, இன்று உங்கள் நாள் எப்படி இருந்தது?`,
      late: (n) => `வணக்கம்${n}, இரவு ஆகிவிட்டது. எல்லாம் நலமா?`,
      telling: "நீங்கள் பேச விரும்புவதாக உங்கள் குடும்பத்திடம் சொல்கிறேன்.",
    },
  },
  {
    name: "Telugu",
    native: "తెలుగు",
    code: "te-IN",
    words: {
      idle: "మాట్లాడటానికి నొక్కండి",
      connecting: "కలుపుతోంది…",
      listening: "వింటున్నాను",
      thinking: "ఆలోచిస్తున్నాను…",
      speaking: "మాట్లాడుతున్నాను",
      paused: "ఆపబడింది",
      talk: "మాట్లాడండి",
      resume: "కొనసాగించండి",
      moment: "ఒక్క క్షణం…",
      stop: "ముగించండి",
      pause: "ఆపండి",
      family: "కుటుంబం",
      askFamily: "మీరు మాట్లాడాలనుకుంటున్నారని కుటుంబానికి చెప్పనా?",
      yesTell: "అవును, చెప్పండి",
      no: "వద్దు",
      call: "కాల్ చేయండి",
      nearby: "దగ్గరలో సహాయం",
      close: "మూసివేయండి",
      hospital: "ఆసుపత్రి",
      pharmacy: "మందుల షాపు",
      people: "మనవాళ్ళు",
      park: "పార్కు",
      food: "భోజనం",
      helplines: "హెల్ప్‌లైన్",
      emergency: "అత్యవసరంలో ముందుగా 112కి కాల్ చేయండి.",
      parkLate: "రాత్రి అయింది. పార్కుకి రేపు ఉదయం.",
      hello: "నమస్కారం",
      greet: (n) => `నమస్కారం${n}, ఈరోజు మీ రోజు ఎలా గడిచింది?`,
      late: (n) => `నమస్కారం${n}, రాత్రి అయింది. అంతా బాగానే ఉందా?`,
      telling: "మీరు మాట్లాడాలనుకుంటున్నారని మీ కుటుంబానికి చెబుతున్నాను.",
    },
  },
  {
    name: "Kannada",
    native: "ಕನ್ನಡ",
    code: "kn-IN",
    words: {
      idle: "ಮಾತನಾಡಲು ಒತ್ತಿ",
      connecting: "ಸಂಪರ್ಕಿಸುತ್ತಿದೆ…",
      listening: "ಕೇಳುತ್ತಿದ್ದೇನೆ",
      thinking: "ಯೋಚಿಸುತ್ತಿದ್ದೇನೆ…",
      speaking: "ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ",
      paused: "ವಿರಾಮದಲ್ಲಿದೆ",
      talk: "ಮಾತನಾಡಿ",
      resume: "ಮತ್ತೆ ಶುರು ಮಾಡಿ",
      moment: "ಒಂದು ಕ್ಷಣ…",
      stop: "ಮುಗಿಸಿ",
      pause: "ನಿಲ್ಲಿಸಿ",
      family: "ಕುಟುಂಬ",
      askFamily: "ನೀವು ಮಾತನಾಡಲು ಬಯಸುತ್ತೀರಿ ಎಂದು ಕುಟುಂಬಕ್ಕೆ ತಿಳಿಸಲೇ?",
      yesTell: "ಹೌದು, ತಿಳಿಸಿ",
      no: "ಬೇಡ",
      call: "ಕರೆ ಮಾಡಿ",
      nearby: "ಹತ್ತಿರದ ಸಹಾಯ",
      close: "ಮುಚ್ಚಿ",
      hospital: "ಆಸ್ಪತ್ರೆ",
      pharmacy: "ಔಷಧಿ ಅಂಗಡಿ",
      people: "ನಮ್ಮವರು",
      park: "ಉದ್ಯಾನ",
      food: "ಊಟ",
      helplines: "ಸಹಾಯವಾಣಿ",
      emergency: "ತುರ್ತು ಸಂದರ್ಭದಲ್ಲಿ ಮೊದಲು 112ಕ್ಕೆ ಕರೆ ಮಾಡಿ.",
      parkLate: "ರಾತ್ರಿ ಆಯಿತು. ಉದ್ಯಾನಕ್ಕೆ ನಾಳೆ ಬೆಳಿಗ್ಗೆ.",
      hello: "ನಮಸ್ಕಾರ",
      greet: (n) => `ನಮಸ್ಕಾರ${n}, ಇವತ್ತು ನಿಮ್ಮ ದಿನ ಹೇಗಿತ್ತು?`,
      late: (n) => `ನಮಸ್ಕಾರ${n}, ರಾತ್ರಿ ಆಯಿತು. ಎಲ್ಲಾ ಚೆನ್ನಾಗಿದೆಯಾ?`,
      telling: "ನೀವು ಮಾತನಾಡಲು ಬಯಸುತ್ತೀರಿ ಎಂದು ನಿಮ್ಮ ಕುಟುಂಬಕ್ಕೆ ತಿಳಿಸುತ್ತಿದ್ದೇನೆ.",
    },
  },
  {
    name: "Malayalam",
    native: "മലയാളം",
    code: "ml-IN",
    words: {
      idle: "സംസാരിക്കാൻ അമർത്തുക",
      connecting: "ബന്ധിപ്പിക്കുന്നു…",
      listening: "കേൾക്കുന്നു",
      thinking: "ആലോചിക്കുന്നു…",
      speaking: "സംസാരിക്കുന്നു",
      paused: "നിർത്തിവെച്ചിരിക്കുന്നു",
      talk: "സംസാരിക്കുക",
      resume: "തുടരുക",
      moment: "ഒരു നിമിഷം…",
      stop: "നിർത്തുക",
      pause: "ഇടവേള",
      family: "കുടുംബം",
      askFamily: "നിങ്ങൾക്ക് സംസാരിക്കണമെന്ന് കുടുംബത്തെ അറിയിക്കട്ടെ?",
      yesTell: "അതെ, അറിയിക്കൂ",
      no: "വേണ്ട",
      call: "വിളിക്കുക",
      nearby: "അടുത്തുള്ള സഹായം",
      close: "അടയ്ക്കുക",
      hospital: "ആശുപത്രി",
      pharmacy: "മരുന്നുകട",
      people: "സ്വന്തക്കാർ",
      park: "പാർക്ക്",
      food: "ഭക്ഷണം",
      helplines: "ഹെൽപ്പ്‌ലൈൻ",
      emergency: "അടിയന്തര ഘട്ടത്തിൽ ആദ്യം 112-ൽ വിളിക്കുക.",
      parkLate: "രാത്രിയായി. പാർക്കിൽ നാളെ രാവിലെ.",
      hello: "നമസ്കാരം",
      greet: (n) => `നമസ്കാരം${n}, ഇന്ന് നിങ്ങളുടെ ദിവസം എങ്ങനെയുണ്ടായിരുന്നു?`,
      late: (n) => `നമസ്കാരം${n}, രാത്രിയായി. എല്ലാം ശരിയല്ലേ?`,
      telling: "നിങ്ങൾക്ക് സംസാരിക്കണമെന്ന് ഞാൻ കുടുംബത്തെ അറിയിക്കുന്നു.",
    },
  },
];

type PaceNumbers = { earlierPause: string; earlierPace: number; recentPause: string; recentPace: number };

// The care desk keeps the English sentence. This is the same comparison in the profile language.
// English is omitted so the line is not repeated. Hindi is the demo. The other eight follow the same list as the phone.
const PACE: Record<string, (n: PaceNumbers) => string> = {
  Hindi: (n) =>
    `पहले के दिन: जवाब से पहले लगभग ${n.earlierPause} सेकंड, और लगभग ${n.earlierPace} शब्द प्रति मिनट। ये तीन दिन: लगभग ${n.recentPause} सेकंड, और लगभग ${n.recentPace} शब्द प्रति मिनट।`,
  Bengali: (n) =>
    `আগের দিনগুলো: উত্তরের আগে প্রায় ${n.earlierPause} সেকেন্ড, এবং প্রায় ${n.earlierPace} শব্দ প্রতি মিনিটে। এই তিন দিন: প্রায় ${n.recentPause} সেকেন্ড, এবং প্রায় ${n.recentPace} শব্দ প্রতি মিনিটে।`,
  Marathi: (n) =>
    `आधीचे दिवस: उत्तर देण्यापूर्वी सुमारे ${n.earlierPause} सेकंद, आणि सुमारे ${n.earlierPace} शब्द प्रति मिनिट. हे तीन दिवस: सुमारे ${n.recentPause} सेकंद, आणि सुमारे ${n.recentPace} शब्द प्रति मिनिट.`,
  Gujarati: (n) =>
    `અગાઉના દિવસો: જવાબ પહેલાં લગભગ ${n.earlierPause} સેકંડ, અને લગભગ ${n.earlierPace} શબ્દ પ્રતિ મિનિટ. આ ત્રણ દિવસ: લગભગ ${n.recentPause} સેકંડ, અને લગભગ ${n.recentPace} શબ્દ પ્રતિ મિનિટ.`,
  Punjabi: (n) =>
    `ਪਹਿਲੇ ਦਿਨ: ਜਵਾਬ ਤੋਂ ਪਹਿਲਾਂ ਲਗਭਗ ${n.earlierPause} ਸਕਿੰਟ, ਅਤੇ ਲਗਭਗ ${n.earlierPace} ਸ਼ਬਦ ਪ੍ਰਤੀ ਮਿੰਟ। ਇਹ ਤਿੰਨ ਦਿਨ: ਲਗਭਗ ${n.recentPause} ਸਕਿੰਟ, ਅਤੇ ਲਗਭਗ ${n.recentPace} ਸ਼ਬਦ ਪ੍ਰਤੀ ਮਿੰਟ।`,
  Tamil: (n) =>
    `முந்தைய நாட்கள்: பதிலுக்கு முன் சுமார் ${n.earlierPause} வினாடி, நிமிடத்திற்கு சுமார் ${n.earlierPace} சொற்கள். இந்த மூன்று நாட்கள்: சுமார் ${n.recentPause} வினாடி, நிமிடத்திற்கு சுமார் ${n.recentPace} சொற்கள்.`,
  Telugu: (n) =>
    `మునుపటి రోజులు: సమాధానానికి ముందు దాదాపు ${n.earlierPause} సెకన్లు, నిమిషానికి దాదాపు ${n.earlierPace} పదాలు. ఈ మూడు రోజులు: దాదాపు ${n.recentPause} సెకన్లు, నిమిషానికి దాదాపు ${n.recentPace} పదాలు.`,
  Kannada: (n) =>
    `ಹಿಂದಿನ ದಿನಗಳು: ಉತ್ತರದ ಮೊದಲು ಸುಮಾರು ${n.earlierPause} ಸೆಕೆಂಡು, ನಿಮಿಷಕ್ಕೆ ಸುಮಾರು ${n.earlierPace} ಪದಗಳು. ಈ ಮೂರು ದಿನ: ಸುಮಾರು ${n.recentPause} ಸೆಕೆಂಡು, ನಿಮಿಷಕ್ಕೆ ಸುಮಾರು ${n.recentPace} ಪದಗಳು.`,
  Malayalam: (n) =>
    `മുൻ ദിവസങ്ങൾ: മറുപടിക്ക് മുമ്പ് ഏകദേശം ${n.earlierPause} സെക്കൻഡ്, മിനിറ്റിൽ ഏകദേശം ${n.earlierPace} വാക്കുകൾ. ഈ മൂന്ന് ദിവസം: ഏകദേശം ${n.recentPause} സെക്കൻഡ്, മിനിറ്റിൽ ഏകദേശം ${n.recentPace} വാക്കുകൾ.`,
};

export function paceComparison(name: string | undefined, numbers: PaceNumbers): { text: string; code: string } | null {
  const language = languageFor(name);
  const line = PACE[language.name];
  if (!line) return null;
  return { text: line(numbers), code: language.code };
}

export function languageFor(name: string | undefined): Language {
  const wanted = (name ?? "").trim().toLowerCase();
  return LANGUAGES.find((l) => l.name.toLowerCase() === wanted) ?? LANGUAGES[0];
}

// The <option> list for every language picker.
export function LanguageOptions() {
  return (
    <>
      {LANGUAGES.map((l) => (
        <option key={l.name} value={l.name}>
          {l.name === "English" ? "English" : `${l.name} · ${l.native}`}
        </option>
      ))}
    </>
  );
}
