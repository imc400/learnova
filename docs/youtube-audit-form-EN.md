# YouTube API Audit — Answers (ENGLISH form, ?hl=en)

**Project:** Aulia · Project Number `81836469922` · Project ID `learnova-498716`
**Form:** YouTube API Services – Audit and Quota Extension Form
**Use the English version:** https://support.google.com/youtube/contact/yt_api_form?hl=en
(the es-419 build is buggy: "(Cambio 8a)" + simulated upload)

> ✅ Public app on its own domain · /privacidad and /terminos live · YouTube attribution visible. Production URL: https://aulia.ai · Demo account + screenshots ready.

---

## Section 1 — Request Type
**Complete a compliance audit to request for additional quota** ✅

---

## Section 2 — Organization & Contact

- **Organization / Developer name:** Aulia
- **Website / API Client URL:** https://aulia.ai
- **Contact email:** igblancora@gmail.com
- **Country:** Chile
- **Google Cloud Project Number:** 81836469922
- **Project ID:** learnova-498716
- **Describe your organization's work as it relates to YouTube:**
Aulia is a B2C educational platform. We use the YouTube Data API v3 to curate and embed — via the official YouTube IFrame Player — the best free educational video for each step of the personalized, AI-generated learning paths we create. YouTube is the source of the video component of every lesson.

---

## Section 3 — Business Model

- **Business model:**
Subscription-based educational SaaS (freemium). Free plan (1 path), monthly Pro plan (USD 15), and single-path purchase (USD 19). Payments processed via Flow.cl (Chile).
- **Do you commercialize YouTube data?**
No. We do not sell, sublicense, or charge for YouTube data or videos. Videos are shown for free, embedded inside the educational experience; what the user pays for is the AI-generated path and the AI tutor (Aulia's own value). YouTube content is not behind the paywall: it is embedded with the official player, with ads enabled and YouTube attribution.
- **Independent value:**
Aulia provides its own value (AI-generated curriculum, quizzes, live tutor, progress tracking); it is not a YouTube clone and does not replace YouTube. It benefits YouTube creators by directing a qualified educational audience to their videos, with attribution and a "Watch on YouTube" link.
- **Do you derive metrics from YouTube data?**
No. We do not compute or display our own metrics derived from YouTube data. We only use official metadata (title, channel, language, duration, captions) for curation; any statistics (views/likes) are used transiently in memory for ranking and are neither stored nor shown to the user.

---

## Section 4 — API Client

- **API Client name:** Aulia (Next.js web application).
- **Where can we find the API Client?**
https://aulia.ai — the YouTube integration is visible on any lesson page: https://aulia.ai/app/rutas/<pathId>/leccion/<lessonId>
- **Project Number / ID:** 81836469922 / learnova-498716
- **Publicly or privately available?**
Privately (after free sign-up/login). We provide a demo account for reviewers.
- **Demo account access:**
Email: demo@learnova.app — Password: Learnova2026!
Steps: 1) Sign in. 2) Open a ready learning path. 3) Open any lesson → the embedded YouTube video appears with attribution and a "Watch on YouTube" link.
Direct lesson example (after login): https://aulia.ai/app/rutas/1cf3d446-744f-4edf-a9b4-2e646f07eabc/leccion/b1b240ed-6b7f-4aab-aacc-4ca75bd3629a
- **Use case category:** Video discovery / education (curation and embedded playback of educational videos).
- **YouTube API Services used:** YouTube Data API v3 (search.list, videos.list) + IFrame Player.
- **Does this API Client use OAuth / Google credential auth?**
No. Server-side API Key only; we do not access any user's Google/YouTube account.
- **Multiple platforms?** Web only (responsive) for now.
- **Uses YouTube Reporting/Analytics API?** No.

---

## Section 5 — Use Cases & Quota Extension

- **Use case (concrete):**
For each learning path a user generates, the AI creates ~25–45 lessons. For each lesson we make ONE search.list call (100 units) to find candidate videos, and ONE videos.list call per batch of 50 IDs (1 unit) to fetch metadata and filter by language/duration/embeddability. We then embed the best video with the official IFrame Player.
- **Quota math per path:** ~45 lessons × (100u search.list + 1u videos.list) ≈ 4,545 → rounded to ~4,600 units per generated path.
- **Mitigations already implemented (efficient use):**
(a) Search cache (youtube_search_cache) storing IDs per query+language (21-day TTL) → repeated searches don't spend 100u.
(b) "Thick-head cache" (skeleton_cache) reusing the curriculum across users with the same topic/level/language, maximizing search-cache hits.
(c) `fields` parameter to request only the fields we use.
(d) 50-ID batching for videos.list.
- **Volume & projection:**
Currently launching. Growth via paid ads (Meta) in Chile/LatAm. 6-month projection: ~150–200 new paths/day. 200 paths/day × 4,600u ≈ 920,000 units/day (plus the daily metadata-refresh job, ~1,000 u/day across tens of thousands of videos).
- **Requested quota:** 1,000,000 units/day.
**Justification:** Covers ~200 paths/day of generation + the compliance job (metadata refresh/deletion under 30 days) + acquisition-campaign spikes, with reasonable margin for projected growth. The default quota (10,000 u/day) only allows ~2 paths/day, which blocks the product.
- **Data refresh frequency:** Video metadata refreshed/deleted automatically every day (25-day cutoff, 30-day max retention). Searches (IDs only) cached up to 21 days.
- **OAuth question (per project): No** ✅

---

## Section 6 — Evidence & Documentation

Since this form may simulate uploads, provide proof BOTH via URLs (Google reviews the live site) AND by attaching the screenshots if upload works:

- **Privacy Policy URL:** https://aulia.ai/privacidad
- **Terms of Service URL:** https://aulia.ai/terminos
- **Primary access URL:** https://aulia.ai
- **Screenshots (on Desktop):**
  - `aulia-1-politica-privacidad.png` → Privacy Policy with YouTube clauses + link to Google's Privacy Policy
  - `aulia-2-pagina-principal-footer.png` → page showing the Privacy Policy link + YouTube branding/attribution
  - `aulia-3-terminos.png` → Terms of Service
  - `aulia-4-reproductor-youtube.png` → IFrame player embedded in a lesson + attribution + "Watch on YouTube"
- **Code compliance statement:**
We use a server-side API Key only (no OAuth), the unmodified IFrame Player (youtube-nocookie.com), we do NOT scrape, we do NOT download or re-host audio/video, and we refresh/delete metadata before 30 days.

---

## Section 7 — Attestations (check ALL)

1. We comply with the YouTube API Services Terms of Service and the Developer Policies.
2. We maintain a published, accessible Privacy Policy (https://aulia.ai/privacidad) that discloses our use of the YouTube API Services and links to Google's Privacy Policy.
3. Our Terms (https://aulia.ai/terminos) link the YouTube Terms of Service and state that by using the app the user accepts them.
4. We display the YouTube Brand Features and attribution on every page that shows YouTube content, with a clickable logo back to YouTube, without modifying the player or hiding attribution.
5. We do NOT store audiovisual content; we store public metadata for a maximum of 30 days, with automatic refresh/deletion and disabling of dead videos.
6. We do NOT scrape or circumvent quota limits.
7. If Google terminates our access, we will stop using and delete the API data.
8. We comply with Google's EU User Consent Policy for EU users.
9. We do not request OAuth or sensitive user data.
