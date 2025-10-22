#!/usr/bin/env node

/**
 * Voice Preview Generator for ChatVibes Web UI
 * 
 * This script generates TTS audio files for voice previews using the Wavespeed API.
 * It creates two types of files:
 * 1. Dashboard files: {VoiceId}-welcome-everyone-to-the-stream.mp3
 * 2. Viewer files: {VoiceId}-chat-is-this-real.mp3
 * 
 * Usage: node generate-voice-previews.js
 * 
 * Requirements:
 * - WAVESPEED_API_KEY environment variable must be set
 * - Node.js with fetch support (Node 18+)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const VOICES_DIR = join(__dirname, '..', 'public', 'assets', 'voices');
const WAVESPEED_API_KEY = process.env.WAVESPEED_API_KEY;
const WAVESPEED_API_URL = 'https://api.wavespeed.ai/api/v3/minimax/speech-02-turbo';

// Language-specific texts for each type
const LANGUAGE_TEXTS = {
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

// Default TTS settings (as per README requirements)
const DEFAULT_SETTINGS = {
    speed: 1.0,
    volume: 1,
    pitch: 0,
    emotion: "neutral",
    english_normalization: false,
    enable_sync_mode: false
};

/**
 * Extract language from voice ID (copied from wavespeedVoices.js)
 * @param {string} voiceId - The voice ID
 * @returns {string} - The language name
 */
function extractLanguage(voiceId) {
    // Check for language prefix patterns
    if (voiceId.startsWith('Chinese (Mandarin)_')) return 'Chinese (Mandarin)';
    if (voiceId.startsWith('English_')) return 'English';
    if (voiceId.startsWith('Arabic_')) return 'Arabic';
    if (voiceId.startsWith('Cantonese_')) return 'Cantonese';
    if (voiceId.startsWith('Dutch_')) return 'Dutch';
    if (voiceId.startsWith('French_')) return 'French';
    if (voiceId.startsWith('German_')) return 'German';
    if (voiceId.startsWith('Indonesian_')) return 'Indonesian';
    if (voiceId.startsWith('Italian_')) return 'Italian';
    if (voiceId.startsWith('Japanese_')) return 'Japanese';
    if (voiceId.startsWith('Korean_')) return 'Korean';
    if (voiceId.startsWith('Portuguese_')) return 'Portuguese';
    if (voiceId.startsWith('Russian_')) return 'Russian';
    if (voiceId.startsWith('Spanish_')) return 'Spanish';
    if (voiceId.startsWith('Turkish_')) return 'Turkish';
    if (voiceId.startsWith('Ukrainian_')) return 'Ukrainian';
    if (voiceId.startsWith('Vietnamese_')) return 'Vietnamese';
    if (voiceId.startsWith('Thai_')) return 'Thai';
    if (voiceId.startsWith('Polish_')) return 'Polish';
    if (voiceId.startsWith('Romanian_')) return 'Romanian';
    if (voiceId.startsWith('Greek_') || voiceId.startsWith('greek_')) return 'Greek';
    if (voiceId.startsWith('czech_')) return 'Czech';
    if (voiceId.startsWith('finnish_')) return 'Finnish';
    if (voiceId.startsWith('hindi_')) return 'Hindi';
    if (voiceId.startsWith('Bulgarian_')) return 'Bulgarian';
    if (voiceId.startsWith('Danish_')) return 'Danish';
    if (voiceId.startsWith('Hebrew_')) return 'Hebrew';
    if (voiceId.startsWith('Malay_')) return 'Malay';
    if (voiceId.startsWith('Persian_')) return 'Persian';
    if (voiceId.startsWith('Slovak_')) return 'Slovak';
    if (voiceId.startsWith('Swedish_')) return 'Swedish';
    if (voiceId.startsWith('Croatian_')) return 'Croatian';
    if (voiceId.startsWith('Filipino_')) return 'Filipino';
    if (voiceId.startsWith('Hungarian_')) return 'Hungarian';
    if (voiceId.startsWith('Norwegian_')) return 'Norwegian';
    if (voiceId.startsWith('Slovenian_')) return 'Slovenian';
    if (voiceId.startsWith('Catalan_')) return 'Catalan';
    if (voiceId.startsWith('Nynorsk_')) return 'Nynorsk';
    if (voiceId.startsWith('Tamil_')) return 'Tamil';
    if (voiceId.startsWith('Afrikaans_')) return 'Afrikaans';
    if (voiceId.startsWith('BritishChild_')) return 'English (British Child)';

    // Special cases
    if (voiceId.startsWith('whisper_')) return 'English (Whisper)';
    if (voiceId.startsWith('moss_audio_')) return 'Special Effects';
    if (voiceId.startsWith('conversational_') || voiceId.startsWith('socialmedia_')) return 'English (Conversational)';
    if (['angry_pirate_1', 'massive_kind_troll', 'movie_trailer_deep', 'peace_and_ease', 'Robot_Armor', 'Arrogant_Miss', 'hunyin_6'].includes(voiceId)) {
        return 'Special Characters';
    }

    // Default voices (no prefix) - assume English
    return 'English';
}

// Voice list from wavespeedVoices.js
const WAVESPEED_VOICE_IDS = [
    "Wise_Woman", "Friendly_Person", "Inspirational_girl", "Deep_Voice_Man", "Calm_Woman", "Casual_Guy", "Lively_Girl", "Patient_Man", "Young_Knight", "Determined_Man", "Lovely_Girl", "Decent_Boy", "Imposing_Manner", "Elegant_Man", "Abbess", "Sweet_Girl_2", "Exuberant_Girl",
    "English_expressive_narrator", "English_radiant_girl", "English_magnetic_voiced_man", "English_compelling_lady1", "English_Aussie_Bloke", "English_captivating_female1", "English_Upbeat_Woman", "English_Trustworth_Man", "English_CalmWoman", "English_UpsetGirl", "English_Gentle-voiced_man", "English_Whispering_girl_v3", "English_Diligent_Man", "English_Graceful_Lady", "English_Husky_MetalHead", "English_ReservedYoungMan", "English_PlayfulGirl", "English_ManWithDeepVoice", "English_GentleTeacher", "English_MaturePartner", "English_FriendlyPerson", "English_MatureBoss", "English_Debator", "whisper_man", "English_Abbess", "English_LovelyGirl", "whisper_woman_1", "English_Steadymentor", "English_Deep-VoicedGentleman", "English_DeterminedMan", "English_Wiselady", "English_CaptivatingStoryteller", "English_AttractiveGirl", "English_DecentYoungMan", "English_SentimentalLady", "English_ImposingManner", "English_SadTeen", "English_ThoughtfulMan", "English_PassionateWarrior", "English_DecentBoy", "English_WiseScholar", "English_Soft-spokenGirl", "English_SereneWoman", "English_ConfidentWoman", "English_PatientMan", "English_Comedian", "English_GorgeousLady", "English_BossyLeader", "English_LovelyLady", "English_Strong-WilledBoy", "English_Deep-tonedMan", "English_StressedLady", "English_AssertiveQueen", "English_AnimeCharacter", "English_Jovialman", "English_WhimsicalGirl", "English_CharmingQueen", "English_Kind-heartedGirl", "English_FriendlyNeighbor", "English_Sweet_Female_4", "English_Magnetic_Male_2", "English_Lively_Male_11", "English_Friendly_Female_3", "English_Steady_Female_1", "English_Lively_Male_10", "English_Magnetic_Male_12", "English_Steady_Female_5", "English_Insightful_Speaker", "English_patient_man_v1", "English_Persuasive_Man", "English_Explanatory_Man", "English_intellect_female_1", "English_energetic_male_1", "English_witty_female_1", "English_Lucky_Robot", "English_Cute_Girl", "English_Sharp_Commentator", "English_Honest_Man",
    "angry_pirate_1", "massive_kind_troll", "movie_trailer_deep", "peace_and_ease",
    "moss_audio_6dc281eb-713c-11f0-a447-9613c873494c", "moss_audio_c12a59b9-7115-11f0-a447-9613c873494c", "moss_audio_076697ad-7144-11f0-a447-9613c873494c", "moss_audio_737a299c-734a-11f0-918f-4e0486034804", "moss_audio_19dbb103-7350-11f0-ad20-f2bc95e89150", "moss_audio_7c7e7ae2-7356-11f0-9540-7ef9b4b62566", "moss_audio_570551b1-735c-11f0-b236-0adeeecad052", "moss_audio_ad5baf92-735f-11f0-8263-fe5a2fe98ec8", "moss_audio_cedfd4d2-736d-11f0-99be-fe40dd2a5fe8", "moss_audio_a0d611da-737c-11f0-ad20-f2bc95e89150", "moss_audio_4f4172f4-737b-11f0-9540-7ef9b4b62566", "moss_audio_62ca20b0-7380-11f0-99be-fe40dd2a5fe8",
    "conversational_female_1_v1", "conversational_female_2_v1", "socialmedia_female_1_v1",
    "BritishChild_male_1_v1", "BritishChild_female_1_v1",
    "Chinese (Mandarin)_Reliable_Executive", "Chinese (Mandarin)_News_Anchor", "Chinese (Mandarin)_Unrestrained_Young_Man", "Chinese (Mandarin)_Mature_Woman", "Arrogant_Miss", "Chinese (Mandarin)_Kind-hearted_Antie", "Robot_Armor", "hunyin_6", "Chinese (Mandarin)_HK_Flight_Attendant", "Chinese (Mandarin)_Humorous_Elder", "Chinese (Mandarin)_Gentleman", "Chinese (Mandarin)_Warm_Bestie", "Chinese (Mandarin)_Stubborn_Friend", "Chinese (Mandarin)_Sweet_Lady", "Chinese (Mandarin)_Southern_Young_Man", "Chinese (Mandarin)_Wise_Women", "Chinese (Mandarin)_Gentle_Youth", "Chinese (Mandarin)_Warm_Girl", "Chinese (Mandarin)_Male_Announcer", "Chinese (Mandarin)_Kind-hearted_Elder", "Chinese (Mandarin)_Cute_Spirit", "Chinese (Mandarin)_Radio_Host", "Chinese (Mandarin)_Lyrical_Voice", "Chinese (Mandarin)_Straightforward_Boy", "Chinese (Mandarin)_Sincere_Adult", "Chinese (Mandarin)_Gentle_Senior", "Chinese (Mandarin)_Crisp_Girl", "Chinese (Mandarin)_Pure-hearted_Boy", "Chinese (Mandarin)_Soft_Girl", "Chinese (Mandarin)_IntellectualGirl", "Chinese (Mandarin)_Warm_HeartedGirl", "Chinese (Mandarin)_Laid_BackGirl", "Chinese (Mandarin)_ExplorativeGirl", "Chinese (Mandarin)_Warm-HeartedAunt", "Chinese (Mandarin)_BashfulGirl",
    "Arabic_CalmWoman", "Arabic_FriendlyGuy",
    "Cantonese_ProfessionalHost（F)", "Cantonese_GentleLady", "Cantonese_ProfessionalHost（M)", "Cantonese_PlayfulMan", "Cantonese_CuteGirl", "Cantonese_KindWoman", "Cantonese_Narrator", "Cantonese_WiselProfessor", "Cantonese_IndifferentStaff",
    "Dutch_kindhearted_girl", "Dutch_bossy_leader",
    "French_Male_Speech_New", "French_Female_News Anchor", "French_CasualMan", "French_MovieLeadFemale", "French_FemaleAnchor", "French_MaleNarrator", "French_Female Journalist", "French_Female_Speech_New",
    "German_FriendlyMan", "German_SweetLady", "German_PlayfulMan",
    "Indonesian_SweetGirl", "Indonesian_ReservedYoungMan", "Indonesian_CharmingGirl", "Indonesian_CalmWoman", "Indonesian_ConfidentWoman", "Indonesian_CaringMan", "Indonesian_BossyLeader", "Indonesian_DeterminedBoy", "Indonesian_GentleGirl",
    "Italian_BraveHeroine", "Italian_Narrator", "Italian_WanderingSorcerer", "Italian_DiligentLeader", "Italian_ReliableMan", "Italian_AthleticStudent", "Italian_ArrogantPrincess",
    "Japanese_Whisper_Belle", "Japanese_IntellectualSenior", "Japanese_DecisivePrincess", "Japanese_LoyalKnight", "Japanese_DominantMan", "Japanese_SeriousCommander", "Japanese_ColdQueen", "Japanese_DependableWoman", "Japanese_GentleButler", "Japanese_KindLady", "Japanese_CalmLady", "Japanese_OptimisticYouth", "Japanese_GenerousIzakayaOwner", "Japanese_SportyStudent", "Japanese_InnocentBoy", "Japanese_GracefulMaiden",
    "Korean_PowerfulGirl", "Korean_BossyMan", "Korean_SweetGirl", "Korean_CheerfulBoyfriend", "Korean_EnchantingSister", "Korean_ShyGirl", "Korean_ReliableSister", "Korean_StrictBoss", "Korean_SassyGirl", "Korean_ChildhoodFriendGirl", "Korean_PlayboyCharmer", "Korean_ElegantPrincess", "Korean_BraveFemaleWarrior", "Korean_BraveYouth", "Korean_CalmLady", "Korean_EnthusiasticTeen", "Korean_SoothingLady", "Korean_IntellectualSenior", "Korean_LonelyWarrior", "Korean_MatureLady", "Korean_InnocentBoy", "Korean_CharmingSister", "Korean_AthleticStudent", "Korean_BraveAdventurer", "Korean_CalmGentleman", "Korean_WiseElf", "Korean_CheerfulCoolJunior", "Korean_DecisiveQueen", "Korean_ColdYoungMan", "Korean_MysteriousGirl", "Korean_QuirkyGirl", "Korean_ConsiderateSenior", "Korean_CheerfulLittleSister", "Korean_DominantMan", "Korean_AirheadedGirl", "Korean_ReliableYouth", "Korean_FriendlyBigSister", "Korean_GentleBoss", "Korean_ColdGirl", "Korean_HaughtyLady", "Korean_CharmingElderSister", "Korean_IntellectualMan", "Korean_CaringWoman", "Korean_WiseTeacher", "Korean_ConfidentBoss", "Korean_AthleticGirl", "Korean_PossessiveMan", "Korean_GentleWoman", "Korean_CockyGuy", "Korean_ThoughtfulWoman", "Korean_OptimisticYouth",
    "Portuguese_AnxiousMan", "Portuguese_Matureresearcher", "Portuguese_Optimisticyouth", "Portuguese_CuteElf", "Portuguese_EnergeticGirl", "Portuguese_FunnyGuy", "Portuguese_Nuttylady", "Portuguese_Deep-tonedMan", "Portuguese_SentimentalLady", "Portuguese_BossyLeader", "Portuguese_Wiselady", "Portuguese_Strong-WilledBoy", "Portuguese_Deep-VoicedGentleman", "Portuguese_UpsetGirl", "Portuguese_PassionateWarrior", "Portuguese_AnimeCharacter", "Portuguese_ConfidentWoman", "Portuguese_AngryMan", "Portuguese_CaptivatingStoryteller", "Portuguese_Godfather", "Portuguese_ReservedYoungMan", "Portuguese_SmartYoungGirl", "Portuguese_Kind-heartedGirl", "Portuguese_Pompouslady", "Portuguese_Grinch", "Portuguese_Debator", "Portuguese_SweetGirl", "Portuguese_AttractiveGirl", "Portuguese_ThoughtfulMan", "Portuguese_PlayfulGirl", "Portuguese_GorgeousLady", "Portuguese_LovelyLady", "Portuguese_SereneWoman", "Portuguese_SadTeen", "Portuguese_MaturePartner", "Portuguese_Comedian", "Portuguese_NaughtySchoolgirl", "Portuguese_Narrator", "Portuguese_ToughBoss", "Portuguese_Fussyhostess", "Portuguese_Dramatist", "Portuguese_Steadymentor", "Portuguese_Jovialman", "Portuguese_CharmingQueen", "Portuguese_SantaClaus", "Portuguese_Rudolph", "Portuguese_Arnold", "Portuguese_CharmingSanta", "Portuguese_Ghost", "Portuguese_HumorousElder", "Portuguese_CalmLeader", "Portuguese_GentleTeacher", "Portuguese_EnergeticBoy", "Portuguese_ReliableMan", "Portuguese_SereneElder", "Portuguese_GrimReaper", "Portuguese_AssertiveQueen", "Portuguese_WhimsicalGirl", "Portuguese_StressedLady", "Portuguese_FriendlyNeighbor", "Portuguese_CaringGirlfriend", "Portuguese_PowerfulSoldier", "Portuguese_FascinatingBoy", "Portuguese_RomanticHusband", "Portuguese_StrictBoss", "Portuguese_InspiringLady", "Portuguese_PlayfulSpirit", "Portuguese_ElegantGirl", "Portuguese_CompellingGirl", "Portuguese_PowerfulVeteran", "Portuguese_SensibleManager", "Portuguese_ThoughtfulLady", "Portuguese_TheatricalActor", "Portuguese_FragileBoy", "Portuguese_ChattyGirl", "Portuguese_Conscientiousinstructor", "Portuguese_RationalMan", "Portuguese_WiseScholar", "Portuguese_FrankLady", "Portuguese_DeterminedManager", "Portuguese_CharmingLady",
    "Russian_HandsomeChildhoodFriend", "Russian_BrightHeroine", "Russian_AmbitiousWoman", "Russian_ReliableMan", "Russian_CrazyQueen", "Russian_PessimisticGirl", "Russian_AttractiveGuy", "Russian_Bad-temperedBoy",
    "Spanish_FriendlyNeighbor", "Spanish_FragileBoy", "Spanish_UpsetGirl", "Spanish_Soft-spokenGirl", "Spanish_CharmingQueen", "Spanish_Nuttylady", "Spanish_ElegantGirl", "Spanish_FascinatingBoy", "Spanish_FunnyGuy", "Spanish_PlayfulSpirit", "Spanish_TheatricalActor", "Spanish_SereneWoman", "Spanish_MaturePartner", "Spanish_CaptivatingStoryteller", "Spanish_Narrator", "Spanish_WiseScholar", "Spanish_Kind-heartedGirl", "Spanish_DeterminedManager", "Spanish_BossyLeader", "Spanish_ReservedYoungMan", "Spanish_ConfidentWoman", "Spanish_ThoughtfulMan", "Spanish_Strong-WilledBoy", "Spanish_SophisticatedLady", "Spanish_RationalMan", "Spanish_AnimeCharacter", "Spanish_Deep-tonedMan", "Spanish_Fussyhostess", "Spanish_SincereTeen", "Spanish_FrankLady", "Spanish_Comedian", "Spanish_Debator", "Spanish_ToughBoss", "Spanish_Wiselady", "Spanish_Steadymentor", "Spanish_Jovialman", "Spanish_SantaClaus", "Spanish_Rudolph", "Spanish_Intonategirl", "Spanish_Arnold", "Spanish_Ghost", "Spanish_HumorousElder", "Spanish_EnergeticBoy", "Spanish_WhimsicalGirl", "Spanish_StrictBoss", "Spanish_ReliableMan", "Spanish_SereneElder", "Spanish_AngryMan", "Spanish_AssertiveQueen", "Spanish_CaringGirlfriend", "Spanish_PowerfulSoldier", "Spanish_PassionateWarrior", "Spanish_ChattyGirl", "Spanish_RomanticHusband", "Spanish_CompellingGirl", "Spanish_PowerfulVeteran", "Spanish_SensibleManager", "Spanish_ThoughtfulLady",
    "Turkish_CalmWoman", "Turkish_Trustworthyman",
    "Ukrainian_CalmWoman", "Ukrainian_WiseScholar",
    "Vietnamese_Serene_Man", "Vietnamese_female_4_v1", "Vietnamese_male_1_v2", "Vietnamese_kindhearted_girl",
    "Thai_Optimistic_girl", "Thai_male_1_sample8", "Thai_Tender_Woman", "Thai_male_2_sample2", "Thai_female_1_sample1", "Thai_female_2_sample2",
    "Polish_male_1_sample4", "Polish_male_2_sample3", "Polish_female_1_sample1", "Polish_female_2_sample3",
    "Romanian_male_1_sample2", "Romanian_male_2_sample1", "Romanian_female_1_sample4", "Romanian_female_2_sample1",
    "Greek_female_1_sample1", "greek_male_1a_v1", "Greek_female_2_sample3",
    "czech_male_1_v1", "czech_female_5_v7", "czech_female_2_v2",
    "finnish_male_3_v1", "finnish_female_4_v1", "finnish_male_1_v2",
    "hindi_male_1_v2", "hindi_female_2_v1", "hindi_female_1_v2",
    "Bulgarian_male_2_v1", "Bulgarian_female_1_v1",
    "Danish_male_1_v1", "Danish_female_1_v1",
    "Hebrew_male_1_v1", "Hebrew_female_1_v1",
    "Malay_male_1_v1", "Malay_female_1_v1", "Malay_female_2_v1",
    "Persian_male_1_v1", "Persian_female_1_v1",
    "Slovak_male_1_v1", "Slovak_female_1_v1",
    "Swedish_male_1_v1", "Swedish_female_1_v1",
    "Croatian_male_1_v1", "Croatian_female_1_v1",
    "Filipino_male_1_v1", "Filipino_female_1_v1",
    "Hungarian_male_1_v1", "Hungarian_female_1_v1",
    "Norwegian_male_1_v1", "Norwegian_female_1_v1",
    "Slovenian_male_1_v1", "Slovenian_female_1_v2",
    "Catalan_male_1_v1", "Catalan_female_1_v1",
    "Nynorsk_male_1_v1", "Nynorsk_female_1_v1",
    "Tamil_male_1_v1", "Tamil_female_1_v1",
    "Afrikaans_male_1_v1", "Afrikaans_female_1_v1"
];

/**
 * Generate filename for voice preview
 * @param {string} voiceId - The voice ID
 * @param {string} type - Either 'dashboard' or 'viewer'
 * @returns {string} - The filename
 */
function generateFilename(voiceId, type) {
    const text = type === 'dashboard' ? 'welcome-everyone-to-the-stream' : 'chat-is-this-real';
    return `${voiceId}-${text}.mp3`;
}

/**
 * Check if file already exists and is in the correct language
 * @param {string} filename - The filename to check
 * @param {string} expectedLanguage - The expected language for this voice
 * @returns {boolean} - True if file exists and is correct, false if needs regeneration
 */
function shouldSkipFile(filename, expectedLanguage) {
    const filePath = join(VOICES_DIR, filename);
    
    if (!existsSync(filePath)) {
        return false; // File doesn't exist, need to generate
    }
    
    // Check file size - if it's too small (like the 63-byte files), regenerate
    const stats = statSync(filePath);
    if (stats.size < 1000) { // Less than 1KB is probably broken
        console.log(`  🔄 File ${filename} is too small (${stats.size} bytes), regenerating...`);
        return false;
    }
    
    // For now, assume existing files are correct
    // In the future, we could add language detection by analyzing the audio content
    console.log(`✓ Skipping ${filename} (already exists, ${stats.size} bytes)`);
    return true;
}

/**
 * Submit TTS request to Wavespeed API
 * @param {string} voiceId - The voice ID
 * @param {string} text - The text to synthesize
 * @param {string} language - The language for language boost
 * @returns {Promise<string>} - The request ID
 */
async function submitTTSRequest(voiceId, text, language) {
    const payload = {
        text,
        voice_id: voiceId,
        ...DEFAULT_SETTINGS
    };
    
    // Add language boost for supported languages only
    // Some languages cause 400 errors, so we'll be selective
    const supportedLanguages = {
        'Chinese (Mandarin)': 'Chinese',
        'Arabic': 'Arabic',
        'Cantonese': 'Chinese,Yue',
        'Dutch': 'Dutch',
        'French': 'French',
        'German': 'German',
        'Indonesian': 'Indonesian',
        'Italian': 'Italian',
        'Japanese': 'Japanese',
        'Korean': 'Korean',
        'Portuguese': 'Portuguese',
        'Russian': 'Russian',
        'Spanish': 'Spanish',
        'Turkish': 'Turkish',
        'Ukrainian': 'Ukrainian',
        'Vietnamese': 'Vietnamese',
        'Thai': 'Thai',
        'Polish': 'Polish',
        'Romanian': 'Romanian',
        'Greek': 'Greek',
        'Czech': 'Czech',
        'Finnish': 'Finnish',
        'Hindi': 'Hindi'
        // Removed languages that cause 400 errors:
        // Bulgarian, Danish, Hebrew, Malay, Persian, Slovak, Swedish, 
        // Croatian, Filipino, Hungarian, Norwegian, Slovenian, Catalan, 
        // Nynorsk, Tamil, Afrikaans
    };
    
    if (language !== 'English' && language !== 'English (British Child)' && 
        language !== 'English (Whisper)' && language !== 'English (Conversational)' &&
        language !== 'Special Effects' && language !== 'Special Characters') {
        
        const languageBoost = supportedLanguages[language];
        if (languageBoost) {
            payload.language_boost = languageBoost;
        }
    }

    const response = await fetch(WAVESPEED_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${WAVESPEED_API_KEY}`
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        if (response.status === 403) {
            throw new Error(`403 Forbidden - Voice ${voiceId} may not be available`);
        }
        if (response.status === 429) {
            throw new Error(`429 Too Many Requests - Rate limited`);
        }
        if (response.status === 400) {
            // Try to get more details about the 400 error
            try {
                const errorData = await response.json();
                throw new Error(`400 Bad Request - ${errorData.message || 'Invalid request parameters'}`);
            } catch {
                throw new Error(`400 Bad Request - Voice ${voiceId} may not support this language or text`);
            }
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    
    // According to the API docs, the response structure is:
    // { code: 200, message: "success", data: { id: "task_id", ... } }
    if (result.code === 200 && result.data && result.data.id) {
        return result.data.id;
    }
    
    throw new Error(`Unexpected response format: ${JSON.stringify(result)}`);
}

/**
 * Poll for TTS result
 * @param {string} requestId - The request ID
 * @returns {Promise<Buffer>} - The audio data
 */
async function pollForResult(requestId) {
    const maxAttempts = 30; // 30 seconds max
    const pollInterval = 1000; // 1 second

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const response = await fetch(`https://api.wavespeed.ai/api/v3/predictions/${requestId}/result`, {
            headers: {
                'Authorization': `Bearer ${WAVESPEED_API_KEY}`
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to get result: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();

        // According to the API docs, the result structure is:
        // { code: 200, message: "success", data: { status: "completed", outputs: ["url_or_base64"], ... } }
        if (result.code === 200 && result.data) {
            if (result.data.status === 'completed' && result.data.outputs && result.data.outputs.length > 0) {
                const output = result.data.outputs[0];
                
                // Check if it's a URL or base64 data
                if (typeof output === 'string' && output.startsWith('http')) {
                    // It's a URL, download the audio file
                    console.log(`  🔗 Downloading audio from: ${output}`);
                    const audioResponse = await fetch(output);
                    if (!audioResponse.ok) {
                        throw new Error(`Failed to download audio: ${audioResponse.status} ${audioResponse.statusText}`);
                    }
                    const audioData = Buffer.from(await audioResponse.arrayBuffer());
                    return audioData;
                } else if (typeof output === 'string') {
                    // It's base64 data
                    const audioData = Buffer.from(output, 'base64');
                    return audioData;
                } else {
                    throw new Error(`Unexpected output format: ${typeof output}`);
                }
            } else if (result.data.status === 'failed') {
                throw new Error(`TTS generation failed: ${result.data.error || 'Unknown error'}`);
            }
        }

        // Still processing, wait and try again
        await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error('TTS generation timed out');
}

/**
 * Generate audio file for a voice and type
 * @param {string} voiceId - The voice ID
 * @param {string} type - Either 'dashboard' or 'viewer'
 * @returns {Promise<{success: boolean, madeApiCall: boolean}>} - Result object
 */
async function generateAudioFile(voiceId, type) {
    const filename = generateFilename(voiceId, type);
    const language = extractLanguage(voiceId);
    
    // Skip if file already exists and is correct
    if (shouldSkipFile(filename, language)) {
        return { success: true, madeApiCall: false };
    }

    // Get language-specific text
    const languageTexts = LANGUAGE_TEXTS[language] || LANGUAGE_TEXTS['English'];
    const text = type === 'dashboard' ? languageTexts.dashboard : languageTexts.viewer;
    
    try {
        console.log(`🎤 Generating ${filename} (${language})...`);
        console.log(`  📝 Text: ${text}`);
        
        // Submit TTS request
        const requestId = await submitTTSRequest(voiceId, text, language);
        console.log(`  📝 Request submitted: ${requestId}`);
        
        // Poll for result
        const audioData = await pollForResult(requestId);
        
        // Save file
        writeFileSync(join(VOICES_DIR, filename), audioData);
        console.log(`  ✅ Saved ${filename} (${audioData.length} bytes)`);
        
        return { success: true, madeApiCall: true };
    } catch (error) {
        if (error.message.includes('429 Too Many Requests')) {
            console.log(`  ⏳ Rate limited, waiting 5 seconds...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            return { success: false, madeApiCall: true }; // Will retry on next iteration
        }
        console.log(`  ❌ Failed to generate ${filename}: ${error.message}`);
        return { success: false, madeApiCall: true };
    }
}

/**
 * Main function
 */
async function main() {
    // Check API key
    if (!WAVESPEED_API_KEY) {
        console.error('❌ Error: WAVESPEED_API_KEY environment variable is required');
        process.exit(1);
    }

    // Ensure voices directory exists
    if (!existsSync(VOICES_DIR)) {
        mkdirSync(VOICES_DIR, { recursive: true });
        console.log(`📁 Created voices directory: ${VOICES_DIR}`);
    }

    console.log(`🚀 Starting voice preview generation...`);
    console.log(`📊 Total voices: ${WAVESPEED_VOICE_IDS.length}`);
    console.log(`📁 Output directory: ${VOICES_DIR}`);
    console.log('');

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    // Generate files for each voice
    for (let i = 0; i < WAVESPEED_VOICE_IDS.length; i++) {
        const voiceId = WAVESPEED_VOICE_IDS[i];
        const language = extractLanguage(voiceId);
        console.log(`[${i + 1}/${WAVESPEED_VOICE_IDS.length}] Processing ${voiceId} (${language})...`);

        let madeApiCall = false;

        // Generate dashboard file
        const dashboardResult = await generateAudioFile(voiceId, 'dashboard');
        if (dashboardResult.success) {
            successCount++;
        } else {
            errorCount++;
        }
        if (dashboardResult.madeApiCall) {
            madeApiCall = true;
        }

        // Add delay between requests only if we made an API call
        if (madeApiCall) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Generate viewer file
        const viewerResult = await generateAudioFile(voiceId, 'viewer');
        if (viewerResult.success) {
            successCount++;
        } else {
            errorCount++;
        }
        if (viewerResult.madeApiCall) {
            madeApiCall = true;
        }

        // Add delay between voices only if we made an API call
        if (madeApiCall) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log(''); // Empty line for readability
    }

    // Summary
    console.log('📊 Generation Summary:');
    console.log(`  ✅ Successful: ${successCount}`);
    console.log(`  ❌ Failed: ${errorCount}`);
    console.log(`  📁 Total files processed: ${WAVESPEED_VOICE_IDS.length * 2}`);
    console.log('');
    console.log('🎉 Voice preview generation complete!');
}

// Run the script
main().catch(error => {
    console.error('💥 Fatal error:', error.message);
    process.exit(1);
});
