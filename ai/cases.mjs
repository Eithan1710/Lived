// Test sentences with the expected result, shared by:
//   ai/test-live.mjs       (Gemini directly, with GEMINI_API_KEY)
//   ai/check-endpoint.mjs  (the deployed worker; run by .github/workflows/ai-check.yml)
//   the built-in parser test (browser)
// Expected dates are relative to "today", so the tests work any day.
// Result shape (same as the worker): {title, date, time, endDate, endTime, location, notes, category}

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

export function buildCases(today = new Date()){
  const t = new Date(today); t.setHours(12, 0, 0, 0);
  const plus = n => { const d = new Date(t); d.setDate(d.getDate() + n); return ymd(d); };
  const next = dow => plus((dow - t.getDay() + 7) % 7 || 7);          // next such weekday, not today
  const coming = dow => plus((dow - t.getDay() + 7) % 7);              // today counts
  const last = dow => plus(-(((t.getDay() - dow + 7) % 7) || 7));      // most recent before today
  // nearest occurrence of a day/month (past or future), like "20 באוקטובר" without a year
  const near = (mo, day) => {
    const c = [-1, 0, 1].map(k => new Date(t.getFullYear() + k, mo - 1, day, 12));
    return ymd(c.reduce((a, b) => Math.abs(b - t) < Math.abs(a - t) ? b : a));
  };
  const md = (mo, day) => near(mo, day);
  const range = (mo, d1, d2) => { const s = near(mo, d1); return [s, s.slice(0, 8) + pad(d2)]; };

  return [
    // the real-life examples
    {text: 'טיול עם חברים: נחל קיבוצים + דירה בעפולה + הר תבור בתאריך 25 עד ה26 בסטפמבר',
      title: /^טיול עם חברים$/, date: range(9, 25, 26)[0], endDate: range(9, 25, 26)[1], time: '', location: /קיבוצים.*תבור|תבור.*קיבוצים/, category: ['travel', 'social']},
    {text: 'טיול עם שרה 25-26.9', title: /^טיול עם שרה$/, date: range(9, 25, 26)[0], endDate: range(9, 25, 26)[1], time: '', category: ['travel']},
    // single-day, English
    {text: 'Dinner with Sarah tomorrow at 8pm', title: /dinner with sarah/i, date: plus(1), time: '20:00', category: ['food']},
    {text: 'Gym today at 6', title: /gym/i, date: plus(0), time: '18:00', category: ['fitness']},
    {text: 'Meeting with John next Tuesday at 10', title: /meeting with john/i, date: [next(2), plus(((2 - t.getDay() + 7) % 7 || 7) + 7)], time: '10:00', category: ['work']},
    {text: "Mom's birthday on October 20", title: /birthday/i, date: md(10, 20), time: '', category: ['birthday']},
    {text: 'Barcelona game Sunday at 9pm', title: /barcelona/i, date: [coming(0), next(0)], time: '21:00', category: ['sports']},
    {text: 'Dentist appointment tomorrow at 14:30', title: /dentist/i, date: plus(1), time: '14:30', category: ['health']},
    {text: 'Concert in Tel Aviv next Friday', title: /concert/i, date: [next(5), plus(((5 - t.getDay() + 7) % 7 || 7) + 7)], time: '', location: /tel aviv/i, category: ['entertainment']},
    {text: 'Yesterday I had dinner with Sarah at 8pm', title: /^dinner with sarah$/i, date: plus(-1), time: '20:00', category: ['food']},
    {text: 'Lunch with the team last Friday at 1pm', title: /lunch/i, date: last(5), time: '13:00', category: ['food', 'work']},
    // single-day, Hebrew
    {text: 'אתמול ארוחת ערב עם שרה ב-20:00', title: /^ארוחת ערב עם שרה$/, date: plus(-1), time: '20:00', category: ['food']},
    {text: 'פגישה עם יוסי מחר ב-14:00 בתל אביב', title: /^פגישה עם יוסי$/, date: plus(1), time: '14:00', location: /תל אביב/, category: ['work']},
    {text: 'הייתי בהופעה של עומר אדם בקיסריה ביום חמישי שעבר', title: /הופעה של עומר אדם/, date: last(4), time: '', location: /קיסריה/, category: ['entertainment']},
    {text: 'ארוחת צהריים עם אבא ביום שישי בצהריים', title: /ארוחת צהריים עם אבא/, date: [coming(5), next(5)], time: '12:00', category: ['food', 'family']},
    {text: 'ריצה בפארק הירקון מחר בבוקר', title: /^ריצה$/, date: plus(1), time: '09:00', location: /פארק הירקון/, category: ['fitness']},
    {text: 'רופא שיניים ב-3.10 ב-8:30', title: /רופא שיניים/, date: md(10, 3), time: '08:30', category: ['health']},
    {text: 'מבחן במתמטיקה ביום שלישי ב-9', title: /מבחן/, date: [coming(2), next(2)], time: '09:00', location: /^$/, category: ['study']},
    {text: 'מסיבה אצל דני הערב ב-22:00', title: /מסיבה אצל דני/, date: plus(0), time: '22:00', category: ['social']},
    {text: 'קפה עם מיכל לפני 3 ימים', title: /^קפה עם מיכל$/, date: plus(-3), time: '', category: ['food', 'social']},
    {text: 'שבת משפחתית אצל סבתא בחיפה 3.10', title: /שבת משפחתית/, date: md(10, 3), time: '', location: /חיפה/, category: ['family']},
    {text: 'פגישת צוות מחר ב-10-12', title: /פגישת צוות/, date: plus(1), time: '10:00', endTime: '12:00', category: ['work']},
    // multi-day
    {text: 'חופשה באילת 3-6 באוקטובר', title: /חופשה/, date: range(10, 3, 6)[0], endDate: range(10, 3, 6)[1], time: '', location: /אילת/, category: ['travel']},
    {text: 'טיסה לברצלונה 10-15 בנובמבר', title: /ברצלונה/, date: range(11, 10, 15)[0], endDate: range(11, 10, 15)[1], time: '', category: ['travel']},
    {text: 'מילואים 12/10 עד 20/10', title: /^מילואים$/, date: range(10, 12, 20)[0], endDate: range(10, 12, 20)[1], time: ''},
    {text: 'כנס מ-12 באוקטובר ב-9:00 עד 14 באוקטובר ב-17:00', title: /^כנס$/, date: md(10, 12), endDate: md(10, 14), time: '09:00', endTime: '17:00', category: ['work']},
    {text: 'Vacation in Greece Oct 10-15', title: /vacation/i, date: range(10, 10, 15)[0], endDate: range(10, 10, 15)[1], time: '', location: /greece/i, category: ['travel']},
    {text: 'Camping trip tomorrow for 3 days', title: /camping/i, date: plus(1), endDate: plus(3), time: '', category: ['travel']},
  ];
}

// Returns a list of problems ([] = pass).
export function check(ev, exp){
  const p = [];
  if(!ev) return ['no result'];
  const inList = (v, e) => Array.isArray(e) ? e.includes(v) : v === e;
  if(exp.title && !exp.title.test(ev.title || '')) p.push(`title "${ev.title}"`);
  if(exp.date && !inList(ev.date, exp.date)) p.push(`date ${ev.date} (expected ${[].concat(exp.date).join(' or ')})`);
  if((exp.endDate || '') !== (ev.endDate || '')) p.push(`endDate "${ev.endDate || ''}" (expected "${exp.endDate || ''}")`);
  if(exp.time !== undefined && ev.time !== exp.time) p.push(`time "${ev.time}" (expected "${exp.time}")`);
  if(exp.endTime && ev.endTime !== exp.endTime) p.push(`endTime "${ev.endTime}" (expected "${exp.endTime}")`);
  if(exp.location && !exp.location.test(ev.location || '')) p.push(`location "${ev.location}"`);
  if(exp.category && !exp.category.includes(ev.category)) p.push(`category ${ev.category} (expected ${exp.category.join(' or ')})`);
  return p;
}
