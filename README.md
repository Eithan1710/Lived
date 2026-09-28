# Lived

ההיסטוריה האישית שלך, בציר זמן אחד.

כותבים מה קרה, למשל "אתמול ארוחת ערב עם שרה ב-20:00", או מה מתוכנן, למשל "מחר פגישה עם יוסי ב-10". האפליקציה מבינה לבד את השם, התאריך, השעה, המיקום והקטגוריה. האירוע נשמר בציר הזמן (מה שקרה בחלק "מה היה", ומה שמתוכנן בחלק "בקרוב") ומתווסף ל-Google Calendar.

## קבצים

| קובץ | תפקיד |
| --- | --- |
| `index.html` | כל האפליקציה: ציר הזמן, הכנסת אירוע, מנתח טקסט מובנה, Google Calendar |
| `config.example.js` | תבנית להגדרות הציבוריות (`config.js` לא נשמר ב-Git) |
| `.github/workflows/deploy.yml` | פרסום ל-GitHub Pages ויצירת `config.js` מ-GitHub secrets |
| `ai/worker.js`, `ai/wrangler.toml` | (אופציונלי) שרת שמנתח את הטקסט עם Claude דרך Anthropic API |
| `sw.js`, `manifest.json`, `icon.svg` | התקנה כאפליקציה ועבודה אופליין |

## איך זה עובד

**איפה נשמר ציר הזמן:** ב-`localStorage` של הדפדפן, במכשיר עצמו. אין שרת ואין מסד נתונים. בנוסף, כל אירוע נשלח גם ל-Google Calendar.

**הבנת הטקסט:**
- ברירת המחדל היא מנתח מובנה שרץ בדפדפן, בלי שום API, מפתח או חשבון חיצוני.
- אם מוגדר `AI_ENDPOINT`, הטקסט נשלח ל-Worker שקורא ל-Anthropic API (מודל `claude-haiku-4-5-20251001`) עם **המפתח שלך**, שנשמר כ-secret ב-Cloudflare.
- אם ה-Worker לא זמין, האפליקציה חוזרת אוטומטית למנתח המובנה.

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

### סוד אמיתי: Cloudflare, רק אם משתמשים ב-AI

| משתנה | סוג | איפה |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | **secret** | `cd ai && npx wrangler secret put ANTHROPIC_API_KEY` |
| `ALLOWED_ORIGINS` | var | `ai/wrangler.toml`: כתובות האתר שמורשות לקרוא ל-Worker |

```sh
cd ai
npx wrangler deploy
npx wrangler secret put ANTHROPIC_API_KEY
```

המפתח לא נמצא בקוד, לא ב-Git ולא בדפדפן. ה-Worker מסרב לבקשות ממקורות שלא ברשימה. מומלץ להגדיר גם תקרת הוצאה בחשבון Anthropic.

## פיתוח מקומי

```sh
cp config.example.js config.js   # ממלאים ערכים אם רוצים
python3 -m http.server 8000
```
