# פרסום לכתובת ציבורית עם GitHub + Railway

זה המסלול המהיר ביותר לפרויקט במבנה הנוכחי: repo ציבורי חינמי ב-GitHub ודיפלוימנט ל-Railway עם domain ציבורי ו-volume.

## 1) יצירת repo ציבורי ב-GitHub
1. כנס ל-`https://github.com/new`
2. צור repo חדש, למשל `worldcup-predictor-2026`
3. השאר אותו Public
4. העלה את כל תוכן התיקייה הזו לשורש ה-repo

## 2) דיפלוי ל-Railway
1. פתח פרויקט חדש ב-Railway
2. בחר `Deploy from GitHub repo`
3. חבר את ה-repo שיצרת
4. ודא שה-Service מזהה את `package.json` בשורש

## 3) Variables שחייבים להגדיר
- `BOOTSTRAP_ADMIN_USERNAME=admin`
- `BOOTSTRAP_ADMIN_PASSWORD=<סיסמת אדמין חזקה>`
- `BOOTSTRAP_ADMIN_DISPLAY_NAME=מנהל`
- `SESSION_SECRET=<מחרוזת אקראית ארוכה>`
- `PUBLIC_BASE_URL=https://<your-domain>.up.railway.app`
- `DATA_ROOT=/app/server/data`
- `SEED_SAMPLE_USERS=false`

אופציונלי ללייב:
- `LIVE_PROVIDER=api-football`
- `API_FOOTBALL_KEY=<your-key>`
- `WORLDCUP_LEAGUE_ID=<league-id>`
- `WORLDCUP_SEASON=2026`

## 4) חיבור Volume
1. צור Volume
2. חבר אותו ל-service
3. mount path: `/app/server/data`

## 5) פתיחת Domain ציבורי
1. בתוך Railway פתח את ה-service
2. הוסף `Generated Domain`
3. העתק את הכתובת
4. עדכן אותה גם ב-`PUBLIC_BASE_URL`
5. בצע redeploy

## 6) התחברות ראשונה
- שם המשתמש והסיסמה של האדמין הם בדיוק מה שהגדרת ב-`BOOTSTRAP_ADMIN_USERNAME` ו-`BOOTSTRAP_ADMIN_PASSWORD`
- אם לא הגדרת סיסמה, המערכת תדפיס סיסמה חד-פעמית ללוגים של Railway בעלייה הראשונה

## 7) הזמנת חברים
1. היכנס כאדמין
2. צור משתמש לכל חבר
3. שלח לכל חבר רק את פרטי ההתחברות שלו
4. כל החברים משתמשים באותה כתובת ציבורית

## הערה
במבנה הנוכחי Railway הוא מסלול ההשקה המהיר ביותר כי האפליקציה משתמשת בשרת Node ובנתונים שנשמרים על הדיסק. אם בעתיד נרצה שכבה חינמית וסקיילבילית יותר, נעביר את המשתמשים וה-state ל-Supabase ונוכל להגיש את ה-frontend מ-Vercel.
