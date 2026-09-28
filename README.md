# Lived

ההיסטוריה האישית שלך, בציר זמן אחד.

כותבים מה קרה, למשל "אתמול ארוחת ערב עם שרה ב-20:00", או מה מתוכנן, למשל "מחר פגישה עם יוסי ב-10". האפליקציה מבינה לבד את השם, התאריך, השעה, המיקום והקטגוריה. האירוע נשמר בציר הזמן (מה שקרה בחלק "מה היה", ומה שמתוכנן בחלק "בקרוב") ומתווסף ל-Google Calendar.

## קבצים

| קובץ | תפקיד |
| --- | --- |
| `index.html` | כל האפליקציה: ציר הזמן, הכנסת אירוע, מנתח טקסט מובנה, Google Calendar |
| `config.example.js` | תבנית להגדרות הציבוריות (`config.js` לא נשמר ב-Git) |
| `.github/workflows/deploy.yml` | פרסום ל-GitHub Pages ויצירת `config.js` מ-GitHub secrets |
| `ai/worker.js`, `wrangler.toml` | שרת AI קטן (Cloudflare Worker) שמנתח את הטקסט עם Google Gemini API |
| `.env.example` | משתני הסביבה של שרת ה-AI |
| `ai/worker.test.mjs`, `ai/test-live.mjs` | בדיקות: בלי מפתח / מול Gemini האמיתי |
| `sw.js`, `manifest.json`, `icon.svg` | התקנה כאפליקציה ועבודה אופליין |

## איך זה עובד

**איפה נשמר ציר הזמן:** ב-`localStorage` של הדפדפן, במכשיר עצמו. אין שרת ואין מסד נתונים. בנוסף, כל אירוע נשלח גם ל-Google Calendar.

**הבנת הטקסט:**
- כשמוגדר `AI_ENDPOINT`, הטקסט נשלח ל-Worker, שקורא ל-**Google Gemini API** (מודל `gemini-3.1-flash-lite`, Free Tier) עם JSON schema. המודל חייב להחזיר בדיוק `{title, date, time, endTime, location, notes, category}`, והקטגוריה היא אחת מרשימה קבועה.
- ה-Worker בודק את התשובה (תאריך, שעה, קטגוריה). אם משהו לא תקין, אם עבר הזמן הקצוב (9 שניות) או אם נגמרה המכסה החינמית, האפליקציה עוברת אוטומטית למנתח המובנה שרץ בדפדפן.
- המפתח (`GEMINI_API_KEY`) נמצא רק ב-Cloudflare, לא בקוד, לא ב-Git ולא בדפדפן.

**קטגוריות ב-Google Calendar:** ל-Google Calendar אין שדה "קטגוריה", ולכן כל אירוע מקבל:
- **צבע** (`colorId`): לכל קטגוריה צבע משלה מתוך 11 צבעי האירועים של Google.
- `extendedProperties.private.category`: המפתח של הקטגוריה.
- שורת "קטגוריה: …" בתיאור האירוע.

| קטגוריה | צבע ב-Google |
| --- | --- |
| 🍽️ אוכל (food) | Tangerine (6) |
| 🏋️ כושר (fitness) | Basil (10) |
| 💼 עבודה (work) | Blueberry (9) |
| 🎂 יום הולדת (birthday) | Banana (5) |
| ⚽ ספורט (sports) | Sage (2) |
| 🩺 בריאות (health) | Tomato (11) |
| ✈️ נסיעות (travel) | Peacock (7) |
| 🎬 בידור (entertainment) | Grape (3) |
| 🎉 חברים (social) | Flamingo (4) |
| 👨‍👩‍👧 משפחה (family) | Lavender (1) |
| 📚 לימודים (study) | Graphite (8) |
| 📌 אחר (other) | צבע ברירת המחדל של היומן |

הצבע נקבע רק בהוספה ישירה דרך ה-API, כלומר כשמוגדר `GOOGLE_CLIENT_ID`. בלי Client ID האפליקציה פותחת את דף "אירוע חדש" של Google, שאין בו אפשרות לקבוע צבע. שם הקטגוריה מופיעה כאימוג'י בכותרת ובתיאור.

**Google Calendar:** OAuth 2.0 בדפדפן דרך Google Identity Services, בהרשאה `calendar.events` בלבד.
- ה-Client ID הוא ערך ציבורי מעצם הגדרתו, ובאפליקציית דפדפן אין Client Secret בכלל.
- ההגנה על ה-Client ID היא רשימת ה-Authorized JavaScript origins שמוגדרת ב-Google Cloud, לא הסתרה.
- בלי Client ID, "שמירה" פותחת את Google Calendar עם האירוע ממולא, והמשתמש לוחץ שם "שמירה".

## הגדרות לפני פרסום

### GitHub → Settings → Secrets and variables → Actions → **Secrets**

| שם | חובה? | מה זה |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | לא | OAuth Client ID מסוג *Web application*. בלעדיו האפליקציה פותחת את Google Calendar עם האירוע ממולא. |
| `AI_ENDPOINT` | לא | כתובת ה-Worker, למשל `https://lived-ai.<account>.workers.dev`. בלעדיו פועל המנתח המובנה. |

הם נשמרים כ-secrets כדי שלא יופיעו ב-repo, ו-GitHub מסתיר אותם בלוגים של Actions (שהם ציבוריים ב-repo ציבורי). חשוב לדעת: שני הערכים עדיין מגיעים לדפדפן דרך `config.js` באתר החי, כי Google Sign-In צריך את ה-Client ID בצד הלקוח. ההגנה על ה-Client ID היא רשימת ה-Authorized JavaScript origins ב-Google Cloud, לא הסתרה.

בנוסף: Settings → Pages → Source: **GitHub Actions**.

### Google Cloud Console
1. APIs & Services → מפעילים את **Google Calendar API**.
2. OAuth consent screen: מגדירים את האפליקציה ומוסיפים את ה-scope `.../auth/calendar.events`.
3. Credentials → Create OAuth client ID → *Web application*.
4. ב-**Authorized JavaScript origins** מוסיפים רק את כתובת האתר, למשל `https://eithan1710.github.io`, ו-`http://localhost:8000` לפיתוח.
5. לא צריך Client Secret ולא redirect URI, כי זרם ה-token של GIS לא משתמש בהם.

### שרת ה-AI: Cloudflare Worker (תוכנית Workers Free מספיקה)

| משתנה | סוג | איפה |
| --- | --- | --- |
| `GEMINI_API_KEY` | **secret** | Cloudflare → lived-ai → Settings → Variables and Secrets (או `npx wrangler secret put GEMINI_API_KEY`) |
| `ALLOWED_ORIGINS` | var | `wrangler.toml`: כתובות האתר שמורשות לקרוא ל-Worker |
| `GEMINI_MODEL` | var | `wrangler.toml` (ברירת מחדל `gemini-3.1-flash-lite`) |

1. ב-[Google AI Studio](https://aistudio.google.com/apikey) יוצרים API key **בפרויקט שאין בו billing**. כך הוא מוגבל ל-Free Tier: כשהמכסה נגמרת מקבלים שגיאה 429, לא חיוב.
2. מפרסמים: ב-Cloudflare → Workers & Pages → Create → **Import a repository** → בוחרים את ה-repo. ה-Root directory נשאר ריק (`/`), וה-Deploy command הוא `npx wrangler deploy`. הקובץ `wrangler.toml` מפרסם רק את `ai/worker.js`, ואף קובץ של האתר לא עולה. אחר כך מוסיפים את הסוד `GEMINI_API_KEY` ב-Settings → Variables and Secrets.
   אפשר גם מהטרמינל: `npx wrangler deploy` ואז `npx wrangler secret put GEMINI_API_KEY`.
3. את הכתובת שמתקבלת (`https://lived-ai.<account>.workers.dev`) שמים ב-GitHub secret `AI_ENDPOINT`, ומריצים שוב את ה-Deploy.

בדיקה מול Gemini האמיתי: `cp .env.example .env`, ממלאים את המפתח, ומריצים `node ai/test-live.mjs`.

**חשוב על ה-Free Tier של Gemini:**
- חינמי כל עוד לא מפעילים billing בפרויקט.
- יש מגבלות קצב ומכסה יומית, ו-Google משנה אותן מדי פעם. המספרים העדכניים מופיעים ב-[Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).
- ב-Free Tier, ‏Google רשאית להשתמש בטקסט שנשלח כדי לשפר את המוצרים שלה.

## פיתוח מקומי

```sh
cp config.example.js config.js   # ממלאים ערכים אם רוצים
python3 -m http.server 8000
```
