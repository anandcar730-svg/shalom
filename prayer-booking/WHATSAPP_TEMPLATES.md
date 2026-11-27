# WhatsApp message templates

WhatsApp only allows plain text to a person who messaged you in the last 24 hours. Every message this
app sends first (confirmation, reminder, cancellation, admin alert) must be an **approved template**.

Create these in **WhatsApp Manager → Account tools → Message templates → Create template**.

For every template: **Category = Utility**, **Type = Text**, no header/footer/buttons.
Use the exact **name** (lowercase, underscores). Create each one in the language shown
(`English` = `en`, `Malayalam` = `ml`). For each `{{n}}`, Meta asks for a sample value; use the samples listed.

Meta rules: the body cannot start or end with a variable, and variables cannot contain line breaks.

---
## 1. `prayer_confirmed`  (English and Malayalam)
Variables: 1 name, 2 center, 3 date/time, 4 minutes, 5 link, 6 expected crowd.
Samples: `Mary`, `Kattakada Shalom`, `Mon, 30 Nov, 4:00 pm`, `30`, `https://pray.example.org/manage.html?t=abc123`, `🟠 Moderate`

**en**
```
🙏 Shalom {{1}}! Your prayer appointment is confirmed.
📍 {{2}}
📅 {{3}} ({{4}} min)
🚦 Expected crowd: {{6}}
We will remind you 1 hour and 30 minutes before. To view, change or cancel your booking, open: {{5}}
Thank you.
```
**ml**
```
🙏 ഷാലോം {{1}}! നിങ്ങളുടെ പ്രാർത്ഥനാ അപ്പോയിന്റ്മെന്റ് സ്ഥിരീകരിച്ചു.
📍 {{2}}
📅 {{3}} ({{4}} മിനിറ്റ്)
🚦 പ്രതീക്ഷിക്കുന്ന തിരക്ക്: {{6}}
1 മണിക്കൂറും 30 മിനിറ്റും മുമ്പ് ഓർമ്മപ്പെടുത്തും. ബുക്കിംഗ് കാണാനോ മാറ്റാനോ റദ്ദാക്കാനോ ഈ ലിങ്ക് തുറക്കുക: {{5}}
നന്ദി.
```

## 2. `prayer_reminder_1h`  (English and Malayalam)
Variables: 1 name, 2 center, 3 date/time. Samples: `Mary`, `Kattakada Shalom`, `Mon, 30 Nov, 4:00 pm`

**en**
```
⏰ 1 hour to go: Shalom {{1}}, your prayer appointment is at {{2}}, {{3}}. God bless you!
```
**ml**
```
⏰ 1 മണിക്കൂർ ബാക്കി: ഷാലോം {{1}}, നിങ്ങളുടെ പ്രാർത്ഥനാ അപ്പോയിന്റ്മെന്റ് {{2}}-ൽ {{3}}. ദൈവം അനുഗ്രഹിക്കട്ടെ!
```

## 2b. `prayer_reminder_30m`  (English and Malayalam)
Same variables and samples as above.

**en**
```
⏰ 30 minutes to go: Shalom {{1}}, your prayer appointment is at {{2}}, {{3}}. God bless you!
```
**ml**
```
⏰ 30 മിനിറ്റ് ബാക്കി: ഷാലോം {{1}}, നിങ്ങളുടെ പ്രാർത്ഥനാ അപ്പോയിന്റ്മെന്റ് {{2}}-ൽ {{3}}. ദൈവം അനുഗ്രഹിക്കട്ടെ!
```

## 2c. `prayer_arrival_check`  (English and Malayalam)  – "Are you here!!" with two buttons
Variables: 1 name, 2 center. Samples: `Mary`, `Kattakada Shalom`.
This template has **two Quick reply buttons**. In the template form scroll to **Buttons**, choose
**Custom** (Quick reply), and add them in this order (the order matters: the first is "I am here", the second is "NO"):

| | English button text | Malayalam button text |
|---|---|---|
| Button 1 | `I am here` | `ഞാൻ എത്തി` |
| Button 2 | `NO` | `ഇല്ല` |

**en**
```
🙏 Are you here!! {{1}}, your prayer appointment time at {{2}} is now. Please tap a button below.
```
**ml**
```
🙏 നിങ്ങൾ എത്തിയോ!! {{1}}, {{2}}-ലെ നിങ്ങളുടെ പ്രാർത്ഥനാ അപ്പോയിന്റ്മെന്റ് സമയമായി. താഴെയുള്ള ബട്ടൺ അമർത്തുക.
```
When someone taps a button, Meta sends it to your webhook (`https://YOUR-DOMAIN/webhook`).
"I am here" marks them as arrived. "NO" sends them a link to change their booking slot.

## 3. `prayer_cancelled`  (English and Malayalam)  – person cancelled their own booking
Variables: 1 date/time. Sample: `Mon, 30 Nov, 4:00 pm`

**en**
```
Your prayer appointment on {{1}} has been cancelled. You are welcome to book again anytime. 🙏
```
**ml**
```
നിങ്ങളുടെ പ്രാർത്ഥനാ അപ്പോയിന്റ്മെന്റ് ({{1}}) റദ്ദാക്കി. ഏത് സമയത്തും വീണ്ടും ബുക്ക് ചെയ്യാം. 🙏
```

## 4. `prayer_church_cancelled`  (English and Malayalam)  – church cancelled the slot
Variables: 1 name, 2 date/time, 3 link. Samples: `Mary`, `Mon, 30 Nov, 4:00 pm`, `https://pray.example.org`

**en**
```
Shalom {{1}}, we are sorry. Your prayer appointment on {{2}} has been cancelled by the church. Please book another time at {{3}} . God bless you. 🙏
```
**ml**
```
ഷാലോം {{1}}, ക്ഷമിക്കണം. {{2}}-ലെ നിങ്ങളുടെ പ്രാർത്ഥനാ അപ്പോയിന്റ്മെന്റ് സഭ റദ്ദാക്കി. മറ്റൊരു സമയം ഇവിടെ ബുക്ക് ചെയ്യുക: {{3}} . ദൈവം അനുഗ്രഹിക്കട്ടെ. 🙏
```

## 5. `admin_new_booking`  (English only)  – alert to you
Variables: 1 name, 2 phone, 3 place, 4 center, 5 date/time.
Samples: `Mary Thomas`, `+919400318000`, `Kowdiar`, `Thirumala Shalom`, `Tue, 1 Dec, 10:00 am`
```
🆕 New prayer appointment: {{1}} ({{2}}), from {{3}}, at {{4}} on {{5}}. Open the admin page to see all bookings.
```

## 5b. `admin_moved`  (English only)  – someone changed their slot
Variables: 1 name, 2 phone, 3 center, 4 date/time. Samples: `Mary Thomas`, `+919400318000`, `Kattakada Shalom`, `Mon, 30 Nov, 4:00 pm`
```
🔁 Booking moved: {{1}} ({{2}}) is now at {{3}} on {{4}}. Open the admin page to see all bookings.
```

## 6. `admin_cancelled`  (English only)
Variables: 1 name, 2 phone, 3 date/time. Samples: `Mary Thomas`, `+919400318000`, `Tue, 1 Dec, 10:00 am`
```
❌ Booking cancelled: {{1}} ({{2}}) for {{3}}. Open the admin page to see the updated list.
```

---
The app now uses these template names: `prayer_confirmed`, `prayer_reminder_1h`, `prayer_reminder_30m`,
`prayer_arrival_check`, `prayer_cancelled`, `prayer_church_cancelled`, `admin_new_booking`, `admin_moved`, `admin_cancelled`.
(The old `prayer_reminder` template is no longer used.)

Templates are usually approved in minutes to a few hours. When all are **Approved**, set
`META_USE_TEMPLATES=true` in `.env` and restart the app.

Note: a template's Malayalam version must be created separately (add the language to the same template name).
If a Malayalam version is not approved yet, messages for people who chose Malayalam will fail and be logged.
