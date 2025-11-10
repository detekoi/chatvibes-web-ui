/**
 * Language-specific TTS preview examples
 * Used to populate preview text fields based on selected language
 */

type LanguageExamples = {
    dashboard: string;
    viewer: string;
};

const LANGUAGE_EXAMPLES: Record<string, LanguageExamples> = {
    'English': {
        dashboard: "Welcome, everyone, to the stream!",
        viewer: "Chat is this real?"
    },
    'Chinese (Mandarin)': {
        dashboard: "欢迎大家来到直播间！",
        viewer: "Chat，这是真的吗？"
    },
    'Arabic': {
        dashboard: "مرحباً بكم جميعاً في البث المباشر!",
        viewer: "شات، هل هذا حقيقي؟"
    },
    'Cantonese': {
        dashboard: "歡迎大家嚟到直播間！",
        viewer: "Chat，呢個係咪真㗎？"
    },
    'Dutch': {
        dashboard: "Welkom iedereen bij de stream!",
        viewer: "Chat, is dit echt?"
    },
    'French': {
        dashboard: "Bienvenue à tous sur le stream !",
        viewer: "Chat, est-ce que c'est vrai ?"
    },
    'German': {
        dashboard: "Willkommen alle zum Stream!",
        viewer: "Chat, ist das echt?"
    },
    'Indonesian': {
        dashboard: "Selamat datang semuanya di stream!",
        viewer: "Chat, apakah ini nyata?"
    },
    'Italian': {
        dashboard: "Benvenuti tutti allo stream!",
        viewer: "Chat, è vero?"
    },
    'Japanese': {
        dashboard: "みなさん、配信へようこそ！",
        viewer: "チャット、これマジ？"
    },
    'Korean': {
        dashboard: "모두 방송에 오신 것을 환영합니다!",
        viewer: "채팅, 이거 진짜야?"
    },
    'Portuguese': {
        dashboard: "Bem-vindos todos à transmissão!",
        viewer: "Chat, isso é real?"
    },
    'Russian': {
        dashboard: "Добро пожаловать на стрим!",
        viewer: "Чат, это правда?"
    },
    'Spanish': {
        dashboard: "¡Bienvenidos todos al directo!",
        viewer: "Chat, ¿esto es real?"
    },
    'Turkish': {
        dashboard: "Herkese yayına hoş geldiniz!",
        viewer: "Chat, bu gerçek mi?"
    },
    'Ukrainian': {
        dashboard: "Ласкаво просимо на стрім!",
        viewer: "Чат, це правда?"
    },
    'Vietnamese': {
        dashboard: "Chào mừng mọi người đến với stream!",
        viewer: "Chat, cái này có thật không?"
    },
    'Thai': {
        dashboard: "ยินดีต้อนรับทุกคนสู่สตรีม!",
        viewer: "แชท นี่จริงหรือเปล่า?"
    },
    'Polish': {
        dashboard: "Witamy wszystkich na streamie!",
        viewer: "Chat, czy to prawda?"
    },
    'Romanian': {
        dashboard: "Bun venit tuturor la stream!",
        viewer: "Chat, este adevărat?"
    },
    'Greek': {
        dashboard: "Καλώς ήρθατε όλοι στο stream!",
        viewer: "Chat, είναι αλήθεια;"
    },
    'Czech': {
        dashboard: "Vítejte všichni na streamu!",
        viewer: "Chat, je to pravda?"
    },
    'Finnish': {
        dashboard: "Tervetuloa kaikki streamiin!",
        viewer: "Chat, onko tämä totta?"
    },
    'Hindi': {
        dashboard: "सभी का स्ट्रीम में स्वागत है!",
        viewer: "चैट, क्या यह सच है?"
    },
    'Bulgarian': {
        dashboard: "Добре дошли всички в стрийма!",
        viewer: "Чат, това истина ли е?"
    },
    'Danish': {
        dashboard: "Velkommen alle til streamen!",
        viewer: "Chat, er det rigtigt?"
    },
    'Hebrew': {
        dashboard: "ברוכים הבאים כולם לסטרים!",
        viewer: "צ'אט, זה אמיתי?"
    },
    'Malay': {
        dashboard: "Selamat datang semua ke stream!",
        viewer: "Chat, betul ke ni?"
    },
    'Persian': {
        dashboard: "به استریم خوش آمدید، همه!",
        viewer: "چت، این واقعیه؟"
    },
    'Slovak': {
        dashboard: "Vitajte všetci na streame!",
        viewer: "Chat, je to pravda?"
    },
    'Swedish': {
        dashboard: "Välkommen alla till streamen!",
        viewer: "Chat, är det sant?"
    },
    'Croatian': {
        dashboard: "Dobrodošli svi na stream!",
        viewer: "Chat, je li to istina?"
    },
    'Filipino': {
        dashboard: "Maligayang pagdating sa lahat sa stream!",
        viewer: "Chat, totoo ba ito?"
    },
    'Hungarian': {
        dashboard: "Üdvözöljük mindenkit a streamben!",
        viewer: "Chat, ez igaz?"
    },
    'Norwegian': {
        dashboard: "Velkommen alle til streamen!",
        viewer: "Chat, er det sant?"
    },
    'Slovenian': {
        dashboard: "Dobrodošli vsi na stream!",
        viewer: "Chat, ali je to res?"
    },
    'Catalan': {
        dashboard: "Benvinguts tots al directe!",
        viewer: "Xat, això és real?"
    },
    'Nynorsk': {
        dashboard: "Velkommen alle til streamen!",
        viewer: "Chat, er det sant?"
    },
    'Tamil': {
        dashboard: "அனைவருக்கும் ஸ்ட்ரீமில் வரவேற்கிறோம்!",
        viewer: "சாட், இது உண்மையா?"
    },
    'Afrikaans': {
        dashboard: "Welkom almal by die stream!",
        viewer: "Chat, is dit waar?"
    },
    'English (British Child)': {
        dashboard: "Welcome, everyone, to the stream!",
        viewer: "Chat is this real?"
    },
    'English (Whisper)': {
        dashboard: "Welcome, everyone, to the stream!",
        viewer: "Chat is this real?"
    },
    'English (Conversational)': {
        dashboard: "Welcome, everyone, to the stream!",
        viewer: "Chat is this real?"
    },
    'Special Effects': {
        dashboard: "Welcome, everyone, to the stream!",
        viewer: "Chat is this real?"
    },
    'Special Characters': {
        dashboard: "Welcome, everyone, to the stream!",
        viewer: "Chat is this real?"
    }
};

/**
 * Map language select values to language example keys
 * The HTML select uses values like "auto", "Chinese", "Chinese,Yue"
 * but our examples use keys like "English", "Chinese (Mandarin)", "Cantonese"
 */
function mapLanguageValueToKey(languageValue: string): string {
    const mapping: Record<string, string> = {
        'auto': 'English',
        'Automatic': 'English',
        'Chinese': 'Chinese (Mandarin)',
        'Chinese,Yue': 'Cantonese',
        'English': 'English',
        'Arabic': 'Arabic',
        'Russian': 'Russian',
        'Spanish': 'Spanish',
        'French': 'French',
        'Portuguese': 'Portuguese',
        'German': 'German',
        'Turkish': 'Turkish',
        'Dutch': 'Dutch',
        'Ukrainian': 'Ukrainian',
        'Vietnamese': 'Vietnamese',
        'Indonesian': 'Indonesian',
        'Japanese': 'Japanese',
        'Italian': 'Italian',
        'Korean': 'Korean',
        'Thai': 'Thai',
        'Polish': 'Polish',
        'Romanian': 'Romanian',
        'Greek': 'Greek',
        'Czech': 'Czech',
        'Finnish': 'Finnish',
        'Hindi': 'Hindi',
        'Bulgarian': 'Bulgarian',
        'Danish': 'Danish',
        'Hebrew': 'Hebrew',
        'Malay': 'Malay',
        'Persian': 'Persian',
        'Slovak': 'Slovak',
        'Swedish': 'Swedish',
        'Croatian': 'Croatian',
        'Filipino': 'Filipino',
        'Hungarian': 'Hungarian',
        'Norwegian': 'Norwegian',
        'Slovenian': 'Slovenian',
        'Catalan': 'Catalan',
        'Nynorsk': 'Nynorsk',
        'Tamil': 'Tamil',
        'Afrikaans': 'Afrikaans',
    };

    return mapping[languageValue] || 'English';
}

/**
 * Get the default example text for a given language
 * @param language - The language value from select (e.g., "auto", "Spanish", "Chinese,Yue")
 * @param context - Either "dashboard" (for streamer) or "viewer"
 * @returns The example text, or English default if not found
 */
function getLanguageExample(language: string, context: 'dashboard' | 'viewer' = 'dashboard'): string {
    // Map the select value to the example key
    const languageKey = mapLanguageValueToKey(language);
    const examples = LANGUAGE_EXAMPLES[languageKey];

    if (examples && examples[context]) {
        return examples[context];
    }

    // Fallback to English if language not found
    const fallback = LANGUAGE_EXAMPLES['English'];
    return fallback ? fallback[context] : '';
}

/**
 * Get all available languages that have examples
 * @returns Array of language names
 */
function getAvailableLanguages(): string[] {
    return Object.keys(LANGUAGE_EXAMPLES);
}

export {
    LANGUAGE_EXAMPLES,
    getLanguageExample,
    getAvailableLanguages
};
