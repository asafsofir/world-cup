# פריסה ציבורית מהירה ל-Railway (v4)

ה-v4 מוכנה לפריסה כשרת אחד שמגיש גם את ה-frontend וגם את ה-API.

## מה צריך לפני שמתחילים
- חשבון Railway
- repository ב-GitHub או תיקייה מקומית עם הקבצים
- מפתח API-Football אם רוצים live אמיתי

## קבצים שכבר מוכנים בפרויקט
- `Dockerfile`
- `railway.json`
- `.env.example`
- `server/server.mjs`
- `public/`

## מסלול קצר
1. פותחים פרויקט חדש ב-Railway.
2. מעלים את התיקייה הזו כ-service (GitHub repo או local directory).
3. מייצרים public domain לשירות.
4. מוסיפים volume persistent.
5. מגדירים משתני סביבה.
6. נכנסים כאדמין ומחליפים סיסמאות.

## הגדרות חשובות
### Volume
המערכת שומרת users/state על הדיסק.
הדרך הפשוטה:
- Mount path: `/data`
- Environment variable: `DATA_ROOT=/data`

### Environment Variables
מינימום:
- `PUBLIC_BASE_URL=https://YOUR-DOMAIN.up.railway.app`
- `SESSION_SECRET=long-random-secret`
- `DATA_ROOT=/data`

ל-live אמיתי:
- `LIVE_PROVIDER=api-football`
- `API_FOOTBALL_KEY=...`
- `WORLDCUP_LEAGUE_ID=...`

### Healthcheck
כבר מוגדר:
- `/healthz`

## אחרי הפריסה
1. פותחים את ה-domain הציבורי.
2. נכנסים עם משתמש האדמין שהגדרת ב-`BOOTSTRAP_ADMIN_USERNAME` וב-`BOOTSTRAP_ADMIN_PASSWORD`.
3. מאפסים סיסמה לאדמין.
4. מגדירים סיסמה שונה לכל חבר.
5. שולחים לכל אחד את הפרטים שלו בפרטי.

## הערה חשובה
ה-v4 עדיין מתאימה יותר לליגה פרטית / קבוצה קטנה. למוצר המונים אמיתי עדיף לעבור בהמשך למסד נתונים אמיתי, queue להתראות, ו-auth חזק יותר.
