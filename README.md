# EventAi

כותבים אירוע ← ה-AI מבין אותו ← הוא נכנס ל-Google Calendar.

> "פגישה עם יוסי מחר ב-14:00 בתל אביב"

האפליקציה מזהה לבד את שם האירוע, התאריך, השעה, המיקום והקטגוריה, מציגה כרטיס קצר לאישור, ובלחיצה אחת מוסיפה אותו ליומן.

## קבצים

| קובץ | מה יש בו |
| --- | --- |
| `index.html` | כל האפליקציה: מסך אחד, מנתח טקסט מובנה, חיבור ל-Google Calendar |
| `ai/worker.js` | (אופציונלי) שרת קטן שמנתח את הטקסט עם Claude |
| `sw.js`, `manifest.json` | התקנה כאפליקציה בטלפון ועבודה אופליין |

## הגדרות (בראש הסקריפט ב-`index.html`)

```js
const CONFIG = {
  GOOGLE_CLIENT_ID: '',   // אופציונלי
  AI_ENDPOINT: ''         // אופציונלי
};
```

**בלי שום הגדרה** הכל עובד: הניתוח רץ בדפדפן, ו"הוסף ליומן" פותח את Google Calendar עם האירוע כבר ממולא (לוחצים "שמירה").

**`GOOGLE_CLIENT_ID`** — הוספה ישירה ליומן בלחיצה אחת, בלי לעבור ל-Google Calendar:
1. ב-[Google Cloud Console](https://console.cloud.google.com/apis/credentials) יוצרים OAuth Client ID מסוג *Web application*.
2. מוסיפים את כתובת האתר כ-Authorized JavaScript origin.
3. מפעילים את Google Calendar API ומדביקים את ה-Client ID ב-`CONFIG`.

**`AI_ENDPOINT`** — ניתוח עם מודל שפה (Claude) במקום המנתח המובנה:
```sh
wrangler deploy ai/worker.js --name eventai-ai
wrangler secret put ANTHROPIC_API_KEY
```
ומדביקים את כתובת ה-Worker ב-`CONFIG`. אם השרת לא זמין, האפליקציה חוזרת אוטומטית למנתח המובנה.
