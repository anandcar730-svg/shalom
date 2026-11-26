# Prayer Slot Booking – Shalom Church

Admin publishes prayer slots; people book them on the website; everyone gets updates on WhatsApp.

## Run
```bash
cd prayer-booking
npm install
cp .env.example .env     # then edit ADMIN_PASSWORD, BASE_URL, ADMIN_WHATSAPP
npm start
```
Requires Node 22.13+ (uses the built-in `node:sqlite`, no database to install).

- Public booking page: `/`
- Admin page: `/admin.html` (password from `.env`)
- Cancel/view link (sent on WhatsApp): `/manage.html?t=<token>`

## How it works
- **Admin** adds slots (date, times, minutes, people per slot, optional weekly repeat), sees who booked
  (with a tap-to-chat WhatsApp link and their prayer request), cancels a booking, or deletes a slot
  (booked people are notified automatically).
- **Users** pick an open slot, enter name + WhatsApp number (+ optional prayer request).
  Seats are checked inside a database transaction, so a slot can never be overbooked.
- **WhatsApp messages**: booking confirmation (with cancel link), admin alert for each new/cancelled
  booking, cancellation by church, and a reminder within 24h of the slot.

## Turn on real WhatsApp sending
Without a provider, messages are only printed in the server log (dry run). Pick one in `.env`:

1. **Meta WhatsApp Cloud API** (free tier): set `WHATSAPP_PROVIDER=meta`, `META_PHONE_NUMBER_ID`, `META_ACCESS_TOKEN`.
2. **Twilio**: set `WHATSAPP_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`.

Note: WhatsApp only allows free-form messages within 24h of the user's last message. For messages
sent outside that window (reminders, church cancellations) you must register **message templates**
with your provider and send those instead; the plain-text sending here works for testing and for
users who recently messaged your number.

## Deploying
The main church site is static (GitHub Pages), so this app needs a Node host such as Render,
Railway or Fly.io (mount a persistent disk for `data/`). Then link to it from the website,
e.g. `<a href="https://your-app-url">Book a Prayer</a>`, and set `BASE_URL` to that address.
