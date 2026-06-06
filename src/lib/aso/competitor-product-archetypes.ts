import type { AppMetadata, ListingContent } from "@/types/audit";

export interface ArchetypeSearchIntent {
  productCategory: string;
  userIntentSummary: string;
  searchTerms: string[];
  excludeTerms: string[];
  competitorNames: string[];
}

export const VIDEO_CONSUMPTION_SIGNALS =
  /\b(watch|watched|watching|video|videos|movie|movies|tv show|tv shows|film|films|series|episode|episodes|binge|live stream|livestream|live tv|shorts|creator|creators|channel|channels|netflix|disney|hulu|twitch|roku|crunchyroll|anime|documentary|documentaries|screen|screens|stream videos|watch movies)\b/i;

export const MUSIC_AUDIO_SIGNALS =
  /\b(music|musical|podcast|podcasts|song|songs|playlist|playlists|artist|artists|album|albums|audio|listen|listening|radio|station|stations|soundtrack|soundtracks|soundcloud|tidal|deezer|pandora|shazam|audiobook|audiobooks|dj|beats|lyrics|tune|tunes|spotify|discover weekly|offline listening|ad-free music|record label|sing|singing|concert|concerts)\b/i;

export const EDITING_SIGNALS =
  /\b(edit|editor|editing|trim|trimming|splice|capcut|imovie|montage|filter effects|timeline|cut video|crop video|video maker|photo editor|retouch|collage maker|subtitles|caption|captions|export video|render video|green screen|transitions)\b/i;

export const AI_CHAT_SIGNALS =
  /\b(ai assistant|ai chat|chatgpt|chat gpt|llm|language model|gpt-|gpt |copilot|chatbot|chat bot|generative ai|ask ai|ai writer|ai image|prompt|gemini|claude|perplexity|character ai|virtual assistant|smart assistant)\b/i;

export const SOCIAL_SIGNALS =
  /\b(social network|social media|follow|followers|following|feed|reels|stories|story|share photos|share videos|friends|friend request|dm|direct message|profile|timeline|post|posts|like|likes|comment|comments|influencer|viral|snap|snaps|tiktok|instagram|snapchat|threads|be real|bereal)\b/i;

export const MESSAGING_SIGNALS =
  /\b(messaging|messenger|text message|sms|imessage|whatsapp|telegram|signal|group chat|voice call|video call|end-to-end encrypted|chat app|send message|read receipts)\b/i;

export const DATING_SIGNALS =
  /\b(dating|date|dates|match|matches|swipe|swiping|relationship|relationships|singles|soulmate|tinder|bumble|hinge|okcupid|meet people|find love|romance|romantic|hookup|profile photos)\b/i;

export const FOOD_DELIVERY_SIGNALS =
  /\b(food delivery|deliver food|order food|restaurant|restaurants|takeout|take-out|delivery driver|menu|menus|doordash|ubereats|uber eats|grubhub|instacart|deliveroo|dashpass|pickup order|grocery delivery|meal delivery)\b/i;

export const RIDE_HAILING_SIGNALS =
  /\b(ride|rides|rider|riders|driver|drivers|cab|taxi|taxis|pickup|dropoff|drop-off|fare|fares|uber|lyft|waymo|rideshare|ride share|ride-hail|request a ride|get a ride|car service)\b/i;

export const FINANCE_SIGNALS =
  /\b(bank|banking|invest|investing|investment|investments|stock|stocks|trading|trade|trades|portfolio|broker|brokerage|crypto|cryptocurrency|bitcoin|wallet|wallets|payment|payments|pay|send money|transfer money|budget|budgeting|credit score|loan|loans|mortgage|venmo|paypal|cash app|robinhood|coinbase|fidelity|schwab|mint)\b/i;

export const SHOPPING_SIGNALS =
  /\b(shop|shopping|buy|buying|purchase|purchases|cart|checkout|marketplace|seller|sellers|product|products|deals|coupon|coupons|discount|discounts|amazon|ebay|etsy|shopify|temu|shein|wish|retail|store pickup|order tracking|wishlist)\b/i;

export const FITNESS_SIGNALS =
  /\b(workout|workouts|exercise|exercises|fitness|training|trainer|gym|gyms|run|running|runner|runners|steps|step count|calories|calorie|weight loss|yoga|pilates|hiit|cardio|strength|strava|peloton|nike training|fitbit|apple fitness|health kit|activity ring)\b/i;

export const WELLNESS_SIGNALS =
  /\b(meditation|meditate|mindful|mindfulness|sleep|sleeping|relax|relaxation|stress|anxiety|breathing|breathwork|calm|headspace|wellness|mental health|self care|self-care|journal|journaling|mood|therapy|therapist|affirmation|affirmations)\b/i;

export const NAVIGATION_SIGNALS =
  /\b(navigation|navigate|gps|maps|map|directions|route|routes|routing|traffic|turn-by-turn|turn by turn|satnav|sat nav|waze|google maps|apple maps|transit|public transit|commute|commuter|offline maps|speed camera|parking|parkings)\b/i;

export const EDUCATION_SIGNALS =
  /\b(learn|learning|lesson|lessons|course|courses|class|classes|study|studying|quiz|quizzes|flashcard|flashcards|language learning|duolingo|khan academy|skill|skills|tutorial|tutorials|homework|student|students|teacher|teachers|education|educational|certification|certify|practice problems|coding tutorial)\b/i;

export const BOOKS_READING_SIGNALS =
  /\b(read|reading|book|books|ebook|ebooks|novel|novels|kindle|library|libraries|audiobook player|chapter|chapters|page turn|literature|story|stories|author|authors|goodreads|scribd|comics|manga|magazine|magazines)\b/i;

export const GAMING_SIGNALS =
  /\b(game|games|gaming|gamer|gamers|play|player|players|multiplayer|matchmaking|level|levels|quest|quests|battle|battles|arcade|puzzle|puzzles|rpg|fps|strategy game|casual game|leaderboard|leaderboards|roblox|minecraft|fortnite|clash|chess|sudoku)\b/i;

export const VPN_SECURITY_SIGNALS =
  /\b(vpn|virtual private network|encrypt|encrypted|encryption|privacy|private browsing|proxy|password manager|password|passwords|2fa|two-factor|authenticator|security|secure|antivirus|malware|firewall|nordvpn|expressvpn|1password|lastpass|bitwarden)\b/i;

export const PRODUCTIVITY_EMAIL_SIGNALS =
  /\b(email|emails|inbox|outbox|mailbox|mail|gmail|outlook|yahoo mail|calendar|calendars|schedule|scheduling|meeting|meetings|invite|invites|attachment|attachments|compose|unread|spam folder|workspace|microsoft 365|google workspace)\b/i;

export const PRODUCTIVITY_NOTES_SIGNALS =
  /\b(notes|note-taking|note taking|notebook|notebooks|docs|document|documents|wiki|task|tasks|todo|to-do|checklist|checklists|notion|evernote|obsidian|bear|reminder|reminders|organize|organization|project|projects|kanban|whiteboard)\b/i;

export const PHOTO_CAMERA_SIGNALS =
  /\b(camera|cameras|photo|photos|photography|photographer|selfie|selfies|portrait|portraits|filter|filters|preset|presets|lightroom|vsco|snapseed|raw photo|lens|lenses|shutter|exposure|hdr|photo editor|picture|pictures|gallery|album)\b/i;

export const TRAVEL_SIGNALS =
  /\b(travel|trip|trips|flight|flights|hotel|hotels|booking|bookings|airbnb|vacation|vacations|itinerary|itineraries|airport|airports|airline|airlines|rental car|hostel|hostels|expedia|tripadvisor|luggage|passport|destination|destinations)\b/i;

export const WEATHER_SIGNALS =
  /\b(weather|forecast|forecasts|radar|temperature|temperatures|rain|snow|storm|storms|hurricane|humidity|wind|winds|uv index|hourly forecast|10-day|weather channel|weather app|meteorology|alerts|weather alert)\b/i;

export const STREAM_SUBSCRIBE_SIGNALS =
  /\b(stream|streaming|streamed|subscribe|subscription|subscriber|subscribers|membership|premium plan)\b/i;

export interface ProductArchetype {
  id: string;
  priority: number;
  productCategory: string;
  namePatterns: RegExp;
  genreHints: string[];
  signals: RegExp;
  antiSignals?: RegExp;
  requiresAll?: RegExp[];
  userIntentSummary: (name: string) => string;
  searchTerms: (name: string) => string[];
  excludeTerms: string[];
  competitorNames: string[];
}

function intentTemplate(
  arch: Omit<
    ProductArchetype,
    "id" | "priority" | "namePatterns" | "genreHints" | "signals" | "antiSignals" | "requiresAll"
  >,
): Pick<
  ProductArchetype,
  | "productCategory"
  | "userIntentSummary"
  | "searchTerms"
  | "excludeTerms"
  | "competitorNames"
> {
  return arch;
}

export const PRODUCT_ARCHETYPES: ProductArchetype[] = [
  {
    id: "video_streaming",
    priority: 10,
    namePatterns:
      /\b(youtube|netflix|disney\+?|hulu|twitch|hbo max|max|peacock|paramount\+?|prime video|amazon prime video|crunchyroll|plex|roku|pluto tv|tubi|discovery\+?|espn|d\+)\b/i,
    genreHints: ["photo & video", "entertainment"],
    signals: VIDEO_CONSUMPTION_SIGNALS,
    antiSignals: new RegExp(
      `${EDITING_SIGNALS.source}|${MUSIC_AUDIO_SIGNALS.source}`,
      "i",
    ),
    requiresAll: [STREAM_SUBSCRIBE_SIGNALS],
    ...intentTemplate({
      productCategory: "video streaming / consumption",
      userIntentSummary: (name) =>
        `Watch, stream, and discover video content — same job as ${name}.`,
      searchTerms: (name) => [
        "video streaming",
        "watch videos online",
        "short video app",
        "live stream app",
        `${name} alternative`,
      ],
      excludeTerms: [
        "video editor",
        "video editing",
        "video maker",
        "capcut",
        "splice",
        "inshot",
        "imovie",
        "music player",
        "podcast app",
        "photo editor",
      ],
      competitorNames: ["TikTok", "Twitch", "Instagram", "Netflix"],
    }),
  },
  {
    id: "music_audio",
    priority: 20,
    namePatterns:
      /\b(spotify|apple music|youtube music|amazon music|pandora|soundcloud|tidal|deezer|shazam|iheart|iheartradio|audible|podcast|pocket casts|overcast|castro|siriusxm|qobuz|napster|bandcamp)\b/i,
    genreHints: ["music"],
    signals: MUSIC_AUDIO_SIGNALS,
    antiSignals: VIDEO_CONSUMPTION_SIGNALS,
    ...intentTemplate({
      productCategory: "music & audio streaming",
      userIntentSummary: (name) =>
        `Listen to music, podcasts, and audio — same job as ${name}.`,
      searchTerms: (name) => [
        "music streaming",
        "listen to music",
        "music player",
        "podcast app",
        `${name} alternative`,
      ],
      excludeTerms: [
        "netflix",
        "disney",
        "disney+",
        "prime video",
        "amazon prime video",
        "watch movies",
        "tv shows",
        "movies and tv",
        "video streaming",
        "live tv",
        "hulu",
        "video editor",
      ],
      competitorNames: [
        "Apple Music",
        "YouTube Music",
        "Pandora",
        "SoundCloud",
        "Amazon Music",
      ],
    }),
  },
  {
    id: "video_editing",
    priority: 30,
    namePatterns:
      /\b(capcut|splice|inshot|imovie|vn video|lumafusion|premiere rush|videoleap|kinemaster|filmora|canva video|adobe rush)\b/i,
    genreHints: ["photo & video"],
    signals: EDITING_SIGNALS,
    antiSignals: VIDEO_CONSUMPTION_SIGNALS,
    ...intentTemplate({
      productCategory: "video editing / creation",
      userIntentSummary: (name) =>
        `Edit and produce videos on mobile — same job as ${name}.`,
      searchTerms: (name) => [
        "video editor",
        "edit videos",
        "video maker",
        `${name} alternative`,
        "capcut",
      ],
      excludeTerms: [
        "streaming",
        "watch movies",
        "live tv",
        "netflix",
        "music streaming",
        "video player only",
      ],
      competitorNames: ["CapCut", "InShot", "Splice", "iMovie"],
    }),
  },
  {
    id: "ai_chat",
    priority: 40,
    namePatterns:
      /\b(chatgpt|claude|gemini|copilot|perplexity|character ai|poe|replika|chaton|nova|ask ai|you\.com|pi ai|meta ai)\b/i,
    genreHints: ["productivity", "utilities"],
    signals: AI_CHAT_SIGNALS,
    antiSignals: MESSAGING_SIGNALS,
    ...intentTemplate({
      productCategory: "AI chat assistant",
      userIntentSummary: (name) =>
        `AI-powered chat and assistant — same job as ${name}.`,
      searchTerms: (name) => [
        "AI chat assistant",
        "AI assistant app",
        `${name} alternative`,
        "chatbot app",
      ],
      excludeTerms: [
        "email client",
        "calendar",
        "cloud storage",
        "file manager",
        "vpn",
        "password manager",
        "dating",
      ],
      competitorNames: ["ChatGPT", "Claude", "Gemini", "Perplexity"],
    }),
  },
  {
    id: "messaging",
    priority: 50,
    namePatterns:
      /\b(whatsapp|telegram|signal|messenger|imessage|wechat|line|viber|discord|slack|teams|google chat|snapchat chat)\b/i,
    genreHints: ["social networking", "utilities"],
    signals: MESSAGING_SIGNALS,
    antiSignals: DATING_SIGNALS,
    ...intentTemplate({
      productCategory: "messaging / communication",
      userIntentSummary: (name) =>
        `Send messages and communicate — same job as ${name}.`,
      searchTerms: (name) => [
        "messaging app",
        "chat app",
        "text message app",
        `${name} alternative`,
      ],
      excludeTerms: [
        "dating",
        "social feed",
        "video editor",
        "email client",
        "ai assistant",
      ],
      competitorNames: ["WhatsApp", "Telegram", "Signal", "Messenger"],
    }),
  },
  {
    id: "dating",
    priority: 60,
    namePatterns:
      /\b(tinder|bumble|hinge|okcupid|match\.com|coffee meets bagel|badoo|grindr|happn|plenty of fish|pof)\b/i,
    genreHints: ["lifestyle", "social networking"],
    signals: DATING_SIGNALS,
    ...intentTemplate({
      productCategory: "dating / relationships",
      userIntentSummary: (name) =>
        `Meet people and date — same job as ${name}.`,
      searchTerms: (name) => [
        "dating app",
        "meet singles",
        "online dating",
        `${name} alternative`,
      ],
      excludeTerms: [
        "messaging app",
        "social media",
        "food delivery",
        "job search",
        "fitness",
      ],
      competitorNames: ["Tinder", "Bumble", "Hinge", "OkCupid"],
    }),
  },
  {
    id: "food_delivery",
    priority: 70,
    namePatterns:
      /\b(doordash|uber eats|ubereats|grubhub|instacart|deliveroo|postmates|seamless|caviar|gopuff|dashpass)\b/i,
    genreHints: ["food & drink"],
    signals: FOOD_DELIVERY_SIGNALS,
    antiSignals: RIDE_HAILING_SIGNALS,
    ...intentTemplate({
      productCategory: "food & grocery delivery",
      userIntentSummary: (name) =>
        `Order food or groceries for delivery — same job as ${name}.`,
      searchTerms: (name) => [
        "food delivery",
        "order food",
        "grocery delivery",
        `${name} alternative`,
      ],
      excludeTerms: [
        "ride share",
        "taxi",
        "restaurant pos",
        "recipe app",
        "fitness",
      ],
      competitorNames: ["DoorDash", "Uber Eats", "Grubhub", "Instacart"],
    }),
  },
  {
    id: "ride_hailing",
    priority: 80,
    namePatterns: /\b(uber(?! eats)|lyft|waymo|grab|bolt|didi|via rides|curb taxi)\b/i,
    genreHints: ["travel", "navigation"],
    signals: RIDE_HAILING_SIGNALS,
    antiSignals: FOOD_DELIVERY_SIGNALS,
    ...intentTemplate({
      productCategory: "ride hailing / transportation",
      userIntentSummary: (name) =>
        `Request rides and get around — same job as ${name}.`,
      searchTerms: (name) => [
        "ride share app",
        "taxi app",
        "request a ride",
        `${name} alternative`,
      ],
      excludeTerms: [
        "food delivery",
        "restaurant menu",
        "flight booking",
        "car rental only",
      ],
      competitorNames: ["Uber", "Lyft", "Waymo", "Bolt"],
    }),
  },
  {
    id: "finance",
    priority: 90,
    namePatterns:
      /\b(venmo|paypal|cash app|robinhood|coinbase|fidelity|schwab|etrade|webull|chase|bank of america|wells fargo|revolut|wise|monzo|mint|credit karma|sofi|acorns|betterment)\b/i,
    genreHints: ["finance"],
    signals: FINANCE_SIGNALS,
    ...intentTemplate({
      productCategory: "finance / banking / investing",
      userIntentSummary: (name) =>
        `Manage money, pay, or invest — same job as ${name}.`,
      searchTerms: (name) => [
        "mobile banking",
        "investing app",
        "send money",
        `${name} alternative`,
      ],
      excludeTerms: [
        "shopping",
        "food delivery",
        "crypto miner",
        "accounting software",
        "tax filing only",
      ],
      competitorNames: ["Venmo", "PayPal", "Cash App", "Robinhood"],
    }),
  },
  {
    id: "shopping",
    priority: 100,
    namePatterns:
      /\b(amazon(?! prime video| music| audible)|ebay|etsy|shopify|temu|shein|wish|target|walmart|best buy|aliexpress|mercari|poshmark|depop)\b/i,
    genreHints: ["shopping"],
    signals: SHOPPING_SIGNALS,
    antiSignals: VIDEO_CONSUMPTION_SIGNALS,
    ...intentTemplate({
      productCategory: "shopping / e-commerce",
      userIntentSummary: (name) =>
        `Shop and buy products online — same job as ${name}.`,
      searchTerms: (name) => [
        "online shopping",
        "buy products",
        "marketplace app",
        `${name} alternative`,
      ],
      excludeTerms: [
        "food delivery",
        "ride share",
        "video streaming",
        "banking",
        "coupon browser only",
      ],
      competitorNames: ["Amazon", "eBay", "Temu", "Shopify"],
    }),
  },
  {
    id: "fitness",
    priority: 110,
    namePatterns:
      /\b(strava|peloton|nike training|nike run|adidas running|fitbit|myfitnesspal|strong|hevy|zwift|whoop|garmin connect|apple fitness)\b/i,
    genreHints: ["health & fitness", "sports"],
    signals: FITNESS_SIGNALS,
    antiSignals: FOOD_DELIVERY_SIGNALS,
    ...intentTemplate({
      productCategory: "fitness / workout tracking",
      userIntentSummary: (name) =>
        `Track workouts and stay fit — same job as ${name}.`,
      searchTerms: (name) => [
        "workout app",
        "fitness tracker",
        "running app",
        `${name} alternative`,
      ],
      excludeTerms: [
        "meditation only",
        "food delivery",
        "diet meal delivery",
        "doctor telehealth",
      ],
      competitorNames: ["Strava", "Peloton", "Nike Training Club", "Fitbit"],
    }),
  },
  {
    id: "wellness",
    priority: 120,
    namePatterns: /\b(calm|headspace|insight timer|ten percent happier|balance|fabulous|betterhelp|talkspace)\b/i,
    genreHints: ["health & fitness", "lifestyle"],
    signals: WELLNESS_SIGNALS,
    antiSignals: FITNESS_SIGNALS,
    ...intentTemplate({
      productCategory: "wellness / meditation / sleep",
      userIntentSummary: (name) =>
        `Relax, sleep, or improve mental wellness — same job as ${name}.`,
      searchTerms: (name) => [
        "meditation app",
        "sleep app",
        "mindfulness app",
        `${name} alternative`,
      ],
      excludeTerms: [
        "workout tracker",
        "food delivery",
        "fitness coach",
        "therapy booking only",
      ],
      competitorNames: ["Calm", "Headspace", "Insight Timer", "Balance"],
    }),
  },
  {
    id: "navigation",
    priority: 130,
    namePatterns: /\b(google maps|apple maps|waze|maps\.me|here wego|sygic|tomtom|citymapper|transit app|moovit)\b/i,
    genreHints: ["navigation", "travel"],
    signals: NAVIGATION_SIGNALS,
    antiSignals: RIDE_HAILING_SIGNALS,
    ...intentTemplate({
      productCategory: "navigation / maps",
      userIntentSummary: (name) =>
        `Navigate and get directions — same job as ${name}.`,
      searchTerms: (name) => [
        "maps and navigation",
        "gps navigation",
        "directions app",
        `${name} alternative`,
      ],
      excludeTerms: [
        "ride share",
        "food delivery",
        "flight booking",
        "weather only",
      ],
      competitorNames: ["Google Maps", "Waze", "Apple Maps", "Citymapper"],
    }),
  },
  {
    id: "education",
    priority: 140,
    namePatterns:
      /\b(duolingo|khan academy|babbel|busuu|memrise|quizlet|photomath|brilliant|coursera|udemy|skillshare|linkedin learning|masterclass)\b/i,
    genreHints: ["education"],
    signals: EDUCATION_SIGNALS,
    ...intentTemplate({
      productCategory: "education / learning",
      userIntentSummary: (name) =>
        `Learn skills or study — same job as ${name}.`,
      searchTerms: (name) => [
        "learn app",
        "language learning",
        "online courses",
        `${name} alternative`,
      ],
      excludeTerms: [
        "kids game only",
        "flashlight",
        "calculator only",
        "dating",
      ],
      competitorNames: ["Duolingo", "Khan Academy", "Babbel", "Quizlet"],
    }),
  },
  {
    id: "books_reading",
    priority: 150,
    namePatterns: /\b(kindle|audible|apple books|google play books|scribd|goodreads|wattpad|hoopla|libby|overdrive)\b/i,
    genreHints: ["books"],
    signals: BOOKS_READING_SIGNALS,
    antiSignals: MUSIC_AUDIO_SIGNALS,
    ...intentTemplate({
      productCategory: "books / reading",
      userIntentSummary: (name) =>
        `Read books and long-form content — same job as ${name}.`,
      searchTerms: (name) => [
        "ebook reader",
        "read books",
        "audiobook app",
        `${name} alternative`,
      ],
      excludeTerms: [
        "music streaming",
        "video streaming",
        "news feed only",
        "pdf scanner",
      ],
      competitorNames: ["Kindle", "Audible", "Apple Books", "Scribd"],
    }),
  },
  {
    id: "gaming",
    priority: 160,
    namePatterns:
      /\b(roblox|minecraft|fortnite|clash of clans|clash royale|call of duty mobile|pubg|among us|candy crush|subway surfers|pokemon go|genshin impact)\b/i,
    genreHints: ["games"],
    signals: GAMING_SIGNALS,
    ...intentTemplate({
      productCategory: "mobile game",
      userIntentSummary: (name) => `Play and enjoy games — same job as ${name}.`,
      searchTerms: (name) => [
        "mobile game",
        "popular game",
        `${name} alternative`,
        "multiplayer game",
      ],
      excludeTerms: [
        "game guide",
        "cheats for",
        "wallpaper",
        "mod installer",
      ],
      competitorNames: ["Roblox", "Minecraft", "Fortnite", "Clash of Clans"],
    }),
  },
  {
    id: "vpn_security",
    priority: 170,
    namePatterns:
      /\b(nordvpn|expressvpn|surfshark|protonvpn|1password|lastpass|bitwarden|dashlane|lookout|mcafee|norton)\b/i,
    genreHints: ["utilities", "productivity"],
    signals: VPN_SECURITY_SIGNALS,
    ...intentTemplate({
      productCategory: "VPN / security / passwords",
      userIntentSummary: (name) =>
        `Protect privacy and secure accounts — same job as ${name}.`,
      searchTerms: (name) => [
        "vpn app",
        "password manager",
        "security app",
        `${name} alternative`,
      ],
      excludeTerms: [
        "antivirus pc only",
        "cleaner junk",
        "battery saver",
        "dating",
      ],
      competitorNames: ["NordVPN", "1Password", "ExpressVPN", "Bitwarden"],
    }),
  },
  {
    id: "productivity_email",
    priority: 180,
    namePatterns: /\b(gmail|outlook|yahoo mail|spark mail|superhuman|proton mail|fastmail|blue mail)\b/i,
    genreHints: ["productivity", "business"],
    signals: PRODUCTIVITY_EMAIL_SIGNALS,
    antiSignals: AI_CHAT_SIGNALS,
    ...intentTemplate({
      productCategory: "email / calendar productivity",
      userIntentSummary: (name) =>
        `Manage email and schedule — same job as ${name}.`,
      searchTerms: (name) => [
        "email app",
        "calendar app",
        "inbox app",
        `${name} alternative`,
      ],
      excludeTerms: [
        "ai chatbot",
        "dating",
        "notes app only",
        "vpn",
      ],
      competitorNames: ["Gmail", "Outlook", "Spark", "Proton Mail"],
    }),
  },
  {
    id: "productivity_notes",
    priority: 190,
    namePatterns: /\b(notion|evernote|obsidian|bear|todoist|things|any\.do|microsoft onenote|google keep|craft docs)\b/i,
    genreHints: ["productivity"],
    signals: PRODUCTIVITY_NOTES_SIGNALS,
    ...intentTemplate({
      productCategory: "notes / docs / tasks",
      userIntentSummary: (name) =>
        `Capture notes and organize work — same job as ${name}.`,
      searchTerms: (name) => [
        "notes app",
        "task manager",
        "docs app",
        `${name} alternative`,
      ],
      excludeTerms: [
        "email client",
        "pdf editor only",
        "calendar only",
        "ai chat only",
      ],
      competitorNames: ["Notion", "Evernote", "Todoist", "Obsidian"],
    }),
  },
  {
    id: "photo_camera",
    priority: 200,
    namePatterns:
      /\b(vsco|lightroom|snapseed|halide|pro camera|dazz cam|prequel|facetune|touchretouch|afterlight)\b/i,
    genreHints: ["photo & video"],
    signals: PHOTO_CAMERA_SIGNALS,
    antiSignals: VIDEO_CONSUMPTION_SIGNALS,
    ...intentTemplate({
      productCategory: "photo / camera",
      userIntentSummary: (name) =>
        `Capture and edit photos — same job as ${name}.`,
      searchTerms: (name) => [
        "photo editor",
        "camera app",
        "photo filters",
        `${name} alternative`,
      ],
      excludeTerms: [
        "video streaming",
        "watch movies",
        "social network only",
        "wallpaper",
      ],
      competitorNames: ["VSCO", "Lightroom", "Snapseed", "Halide"],
    }),
  },
  {
    id: "travel",
    priority: 210,
    namePatterns:
      /\b(airbnb|booking\.com|expedia|hotels\.com|tripadvisor|kayak|skyscanner|hopper|vrbo|trivago|google flights)\b/i,
    genreHints: ["travel"],
    signals: TRAVEL_SIGNALS,
    antiSignals: NAVIGATION_SIGNALS,
    ...intentTemplate({
      productCategory: "travel booking",
      userIntentSummary: (name) =>
        `Book trips, stays, or flights — same job as ${name}.`,
      searchTerms: (name) => [
        "book hotels",
        "flight booking",
        "travel app",
        `${name} alternative`,
      ],
      excludeTerms: [
        "gps navigation",
        "ride share",
        "food delivery",
        "weather only",
      ],
      competitorNames: ["Airbnb", "Booking.com", "Expedia", "Tripadvisor"],
    }),
  },
  {
    id: "weather",
    priority: 220,
    namePatterns:
      /\b(the weather channel|accuweather|weather underground|carrot weather|clime|weathermate|dark sky)\b/i,
    genreHints: ["weather"],
    signals: WEATHER_SIGNALS,
    ...intentTemplate({
      productCategory: "weather forecast",
      userIntentSummary: (name) =>
        `Check weather forecasts — same job as ${name}.`,
      searchTerms: (name) => [
        "weather app",
        "weather forecast",
        "radar app",
        `${name} alternative`,
      ],
      excludeTerms: [
        "news app",
        "travel booking",
        "climate news only",
        "widget theme",
      ],
      competitorNames: [
        "The Weather Channel",
        "AccuWeather",
        "Carrot Weather",
        "Clime",
      ],
    }),
  },
  {
    id: "social_network",
    priority: 230,
    namePatterns:
      /\b(instagram|tiktok|snapchat|facebook|threads|bereal|pinterest|reddit|linkedin|x formerly twitter|twitter|bebop|lemon8)\b/i,
    genreHints: ["social networking"],
    signals: SOCIAL_SIGNALS,
    antiSignals: MESSAGING_SIGNALS,
    ...intentTemplate({
      productCategory: "social / sharing app",
      userIntentSummary: (name) =>
        `Connect and share with others — same job as ${name}.`,
      searchTerms: (name) => [
        "social media app",
        "share photos videos",
        `${name} alternative`,
        "short video social",
      ],
      excludeTerms: [
        "video editor",
        "email client",
        "password manager",
        "weather",
        "dating only",
      ],
      competitorNames: ["Instagram", "TikTok", "Snapchat", "X"],
    }),
  },
];

const GENERIC_EXCLUDES = [
  "wallpaper",
  "ringtone",
  "guide for",
  "tips for",
  "cheats for",
  "mod apk",
  "unlocker",
];

function hasGenreHint(metadata: AppMetadata, hints: string[]): boolean {
  if (hints.length === 0) return false;
  const primary = metadata.primaryGenreName?.toLowerCase() ?? "";
  const genres = (metadata.genres ?? []).map((g) => g.toLowerCase());
  return hints.some((h) => primary === h || genres.includes(h));
}

function scoreArchetype(
  arch: ProductArchetype,
  metadata: AppMetadata,
  blurb: string,
  name: string,
): number {
  if (arch.antiSignals?.test(blurb) || arch.antiSignals?.test(name)) {
    return 0;
  }

  if (arch.requiresAll?.some((r) => !r.test(blurb) && !r.test(name))) {
    return 0;
  }

  const genreMatch = hasGenreHint(metadata, arch.genreHints);
  const signalMatch = arch.signals.test(blurb) || arch.signals.test(name);

  if (!genreMatch && !signalMatch) return 0;

  let score = 0;
  if (genreMatch) score += 40;
  if (signalMatch) score += 50;
  if (genreMatch && signalMatch) score += 10;

  if (arch.genreHints.length > 0 && !genreMatch && signalMatch) {
    score -= 5;
  }

  return score >= 45 ? score + (1000 - arch.priority) / 1000 : 0;
}

export function listingBlurb(
  metadata: AppMetadata,
  listing?: ListingContent,
): string {
  const parts = [
    metadata.trackName,
    listing?.subtitle,
    listing?.promotionalText,
    listing?.description?.slice(0, 1200),
    metadata.itunesDescription?.slice(0, 1200),
  ].filter(Boolean);
  return parts.join("\n");
}

export function classifyProductArchetype(
  metadata: AppMetadata,
  listing?: ListingContent,
): ProductArchetype {
  const blurb = listingBlurb(metadata, listing).toLowerCase();
  const name = metadata.trackName.trim();

  for (const arch of PRODUCT_ARCHETYPES) {
    if (arch.namePatterns.test(name)) return arch;
  }

  let best: ProductArchetype | null = null;
  let bestScore = 0;
  for (const arch of PRODUCT_ARCHETYPES) {
    const score = scoreArchetype(arch, metadata, blurb, name);
    if (score > bestScore) {
      bestScore = score;
      best = arch;
    }
  }

  if (best && bestScore >= 45) return best;

  return {
    id: "generic",
    priority: 9999,
    productCategory: metadata.primaryGenreName ?? "mobile app",
    namePatterns: /^$/i,
    genreHints: [],
    signals: /^$/i,
    userIntentSummary: (appName) => `Same core use case as ${appName}.`,
    searchTerms: (appName) =>
      [
        appName,
        `${appName} alternative`,
        metadata.primaryGenreName
          ? `${metadata.primaryGenreName} app`
          : "popular app",
      ].filter((t, i, a) => t && a.indexOf(t) === i),
    excludeTerms: GENERIC_EXCLUDES,
    competitorNames: [metadata.trackName.trim()],
  };
}

export function intentFromArchetype(
  arch: ProductArchetype,
  metadata: AppMetadata,
): ArchetypeSearchIntent {
  const name = metadata.trackName.trim();
  return {
    productCategory: arch.productCategory,
    userIntentSummary: arch.userIntentSummary(name),
    searchTerms: arch.searchTerms(name),
    excludeTerms: arch.excludeTerms,
    competitorNames: arch.competitorNames,
  };
}
