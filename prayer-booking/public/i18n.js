// Visitor-page translations. Add a language by adding a block here and a button with data-lang.
const I18N = {
  en: {
    back: '← Back to website', bookSlot: 'Book a slot',
    heroTitle: '🙏 Book a Personal Prayer', heroSub: "Pick a day and time that suits you. We'll confirm on WhatsApp.",
    step1: 'Choose a day', step2: 'Choose a time', step3: 'Your details',
    loading: 'Loading…', loadFail: 'Could not load slots. Please refresh.', none: 'No slots are open right now. Please check back soon.',
    morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening',
    full: 'Full', available: 'Available', spotsLeft: (n) => `${n} spot${n > 1 ? 's' : ''} left`,
    yourSlot: 'Your prayer slot', min: 'min',
    name: 'Your name', namePh: 'e.g. Mary Thomas', phone: 'WhatsApp number', phoneHint: "We'll send your confirmation and a reminder to this number.",
    req: 'Prayer request', optional: '(optional)', reqPh: "Share what you'd like us to pray for",
    confirm: 'Confirm my booking', booking: 'Booking…',
    errName: 'Please enter your name.', errPhone: 'Please enter your 10-digit WhatsApp number.', errGeneric: 'Something went wrong. Please try again.',
    doneTitle: 'Your prayer is booked!', doneWa: '💬 A confirmation has been sent to your WhatsApp.', viewCancel: 'View or cancel booking', another: 'Book another slot',
    mTitle: 'Your prayer booking', mBooked: 'Your prayer is booked', mPast: 'This prayer has taken place', mCancelled: 'Booking cancelled',
    mShalom: 'Shalom', mWhen: 'Date and time', mCancel: 'Cancel this booking', mAgain: 'Tap again to confirm cancel',
    mHint: 'You will get a WhatsApp message confirming the cancellation.', mBookPrayer: 'Book a prayer slot',
  },
  ml: {
    back: '← വെബ്സൈറ്റിലേക്ക്', bookSlot: 'സമയം ബുക്ക് ചെയ്യുക',
    heroTitle: '🙏 വ്യക്തിപരമായ പ്രാർത്ഥന ബുക്ക് ചെയ്യുക', heroSub: 'നിങ്ങൾക്ക് സൗകര്യമുള്ള ദിവസവും സമയവും തിരഞ്ഞെടുക്കുക. വാട്സ്ആപ്പിൽ ഞങ്ങൾ സ്ഥിരീകരിക്കും.',
    step1: 'ദിവസം തിരഞ്ഞെടുക്കുക', step2: 'സമയം തിരഞ്ഞെടുക്കുക', step3: 'നിങ്ങളുടെ വിവരങ്ങൾ',
    loading: 'ലോഡ് ചെയ്യുന്നു…', loadFail: 'സമയങ്ങൾ ലോഡ് ചെയ്യാൻ കഴിഞ്ഞില്ല. പേജ് റീഫ്രഷ് ചെയ്യുക.', none: 'ഇപ്പോൾ ഒഴിവുള്ള സമയങ്ങളില്ല. കുറച്ചു കഴിഞ്ഞ് വീണ്ടും നോക്കുക.',
    morning: 'രാവിലെ', afternoon: 'ഉച്ചയ്ക്ക്', evening: 'വൈകുന്നേരം',
    full: 'നിറഞ്ഞു', available: 'ഒഴിവുണ്ട്', spotsLeft: (n) => `${n} ഒഴിവ്`,
    yourSlot: 'നിങ്ങളുടെ പ്രാർത്ഥനാ സമയം', min: 'മിനിറ്റ്',
    name: 'നിങ്ങളുടെ പേര്', namePh: 'ഉദാ: മേരി തോമസ്', phone: 'വാട്സ്ആപ്പ് നമ്പർ', phoneHint: 'സ്ഥിരീകരണവും ഓർമ്മപ്പെടുത്തലും ഈ നമ്പറിലേക്ക് അയയ്ക്കും.',
    req: 'പ്രാർത്ഥനാ വിഷയം', optional: '(ഓപ്ഷണൽ)', reqPh: 'ഞങ്ങൾ എന്തിനുവേണ്ടി പ്രാർത്ഥിക്കണമെന്ന് എഴുതുക',
    confirm: 'ബുക്കിംഗ് സ്ഥിരീകരിക്കുക', booking: 'ബുക്ക് ചെയ്യുന്നു…',
    errName: 'നിങ്ങളുടെ പേര് നൽകുക.', errPhone: '10 അക്ക വാട്സ്ആപ്പ് നമ്പർ നൽകുക.', errGeneric: 'എന്തോ പിഴവ് സംഭവിച്ചു. വീണ്ടും ശ്രമിക്കുക.',
    doneTitle: 'നിങ്ങളുടെ പ്രാർത്ഥന ബുക്ക് ചെയ്തു!', doneWa: '💬 സ്ഥിരീകരണം നിങ്ങളുടെ വാട്സ്ആപ്പിലേക്ക് അയച്ചിട്ടുണ്ട്.', viewCancel: 'ബുക്കിംഗ് കാണുക / റദ്ദാക്കുക', another: 'മറ്റൊരു സമയം ബുക്ക് ചെയ്യുക',
    mTitle: 'നിങ്ങളുടെ പ്രാർത്ഥനാ ബുക്കിംഗ്', mBooked: 'നിങ്ങളുടെ പ്രാർത്ഥന ബുക്ക് ചെയ്തു', mPast: 'ഈ പ്രാർത്ഥന കഴിഞ്ഞു', mCancelled: 'ബുക്കിംഗ് റദ്ദാക്കി',
    mShalom: 'ഷാലോം', mWhen: 'തീയതിയും സമയവും', mCancel: 'ബുക്കിംഗ് റദ്ദാക്കുക', mAgain: 'ഉറപ്പിക്കാൻ ഒരിക്കൽ കൂടി തൊടുക',
    mHint: 'റദ്ദാക്കിയതിന്റെ സ്ഥിരീകരണം വാട്സ്ആപ്പിൽ ലഭിക്കും.', mBookPrayer: 'പ്രാർത്ഥനാ സമയം ബുക്ക് ചെയ്യുക',
  },
};
let LANG = 'en';
try { LANG = localStorage.getItem('lang') || (/^ml/i.test(navigator.language || '') ? 'ml' : 'en'); } catch {}
if (!I18N[LANG]) LANG = 'en';
const t = (k, ...a) => { const v = I18N[LANG][k] ?? I18N.en[k] ?? k; return typeof v === 'function' ? v(...a) : v; };
const locale = () => (LANG === 'ml' ? 'ml-IN' : 'en-IN');
function applyI18n() {
  document.documentElement.lang = LANG;
  document.querySelectorAll('[data-i18n]').forEach((e) => { e.textContent = t(e.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach((e) => { e.placeholder = t(e.dataset.i18nPh); });
  document.querySelectorAll('[data-lang]').forEach((b) => b.classList.toggle('on', b.dataset.lang === LANG));
}
function setLang(l) {
  LANG = l; try { localStorage.setItem('lang', l); } catch {}
  applyI18n(); if (window.onLang) window.onLang();
}
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
  applyI18n();
});
