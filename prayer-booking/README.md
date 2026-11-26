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

## Appointment rules
- Visitors book a **personal prayer appointment** with name, WhatsApp number and place (no prayer-request field).
- Only **today and tomorrow** can be booked (India time). Anything later is hidden and refused by the server.
- Three centers: **Kattakada Shalom** (any day), **Thirumala Shalom** (Tuesdays and Saturdays only) and
  **Poovar Shalom** (Tuesdays only). Because only today and tomorrow can be booked, Thirumala and Poovar open
  for booking on the day before and on the day itself, and not otherwise.
  The admin cannot add slots for those centers on other weekdays, and the server refuses such bookings even if a slot exists.
  Edit the `CENTERS` table in `server.js` (and `CENTERS` in `public/index.html`) to change names or days.
- Reminders go out 2 hours before the appointment, only for bookings made 3+ hours ahead.
- Existing slots from before this change are treated as Kattakada.

## How it works
- **Admin** picks a center and adds slots (date, times, minutes, people per slot, optional weekly repeat).
  The Bookings tab shows who booked (name, tap-to-chat WhatsApp number, place), filterable by center.
  Admin can cancel a booking or delete a slot; booked people are notified automatically.
- **Visitors** choose a center, then today or tomorrow, then a time, and enter name, WhatsApp number and place.
  Seats are checked inside a database transaction, so a slot can never be overbooked.
- **WhatsApp messages**: confirmation (with cancel link), admin alert for each new or cancelled booking,
  cancellation by the church, and a reminder 2 hours before.

## Turn on real WhatsApp sending
Without a provider, messages are only printed in the server log (dry run). Pick one in `.env`:

1. **Meta WhatsApp Cloud API** (free tier): set `WHATSAPP_PROVIDER=meta`, `META_PHONE_NUMBER_ID`, `META_ACCESS_TOKEN`.
2. **Twilio**: set `WHATSAPP_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`.

Note: WhatsApp only allows free-form messages within 24h of the user's last message. For messages
sent outside that window (reminders, church cancellations) you must register **message templates**
with your provider and send those instead; the plain-text sending here works for testing and for
users who recently messaged your number.

## Deploying
The main church site is static (GitHub Pages), so this app runs as its own Node service.
See **[DEPLOY.md](./DEPLOY.md)** for the full Oracle Cloud + Nginx + HTTPS + Meta WhatsApp
Cloud API walkthrough. `index.html` already links "Book a Prayer" to `https://pray.shalomchurch.co.in`
in the navbar, hero and prayer-request section — update those if your subdomain differs.

## Seeing bookings
Admins see every booking (name, WhatsApp number, prayer request) per slot on `/admin.html`,
with a tap-to-chat WhatsApp link per person. No separate dashboard needed.
