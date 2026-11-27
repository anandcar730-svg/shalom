# Deploying to Oracle Cloud + Meta WhatsApp Cloud API

This covers putting the app on your Oracle Cloud VM behind your domain, and wiring real
WhatsApp sending through Meta's Cloud API.

Replace `pray.shalomchurch.co.in` below with your real subdomain everywhere.

## 1. DNS
Point an A record for your subdomain at your Oracle Cloud instance's public IP:
```
pray.shalomchurch.co.in   A   <your-instance-public-ip>
```

## 2. Oracle Cloud instance networking
Two firewalls sit in front of the app — both must allow 80/443:
- **OCI Security List / NSG** (console): add ingress rules for `0.0.0.0/0`, TCP 80 and 443.
- **The instance's own firewall** (Oracle Linux images ship `firewalld` on by default):
  ```bash
  sudo firewall-cmd --permanent --add-service=http
  sudo firewall-cmd --permanent --add-service=https
  sudo firewall-cmd --reload
  ```

## 3. Install Node.js 22+ on the VM
```bash
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -   # Oracle Linux / RHEL
sudo dnf install -y nodejs
# Debian/Ubuntu instead:
# curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
# sudo apt-get install -y nodejs
node -v   # confirm 22.13+
```

## 4. Get the app onto the server
```bash
sudo mkdir -p /opt/prayer-booking && sudo chown $USER /opt/prayer-booking
git clone --branch claude/admiring-shannon-q0k9v8 https://github.com/anandcar730-svg/shalom.git /tmp/shalom
cp -r /tmp/shalom/prayer-booking/* /opt/prayer-booking/
cd /opt/prayer-booking
npm install --omit=dev
cp .env.example .env
```
(Once this branch is merged to `main`, clone `main` instead. To update later: re-clone or `git pull`
into `/tmp/shalom` and re-copy, then `sudo systemctl restart prayer-booking`.)

Edit `.env`:
```ini
PORT=3000
BASE_URL=https://pray.shalomchurch.co.in
ADMIN_PASSWORD=<pick a strong password>
ADMIN_WHATSAPP=919400328000
WHATSAPP_PROVIDER=meta
META_PHONE_NUMBER_ID=<from step 6>
META_ACCESS_TOKEN=<from step 6>
```

## 5. Run it as a service (systemd)
```bash
sudo tee /etc/systemd/system/prayer-booking.service > /dev/null <<'EOF'
[Unit]
Description=Shalom Church Prayer Booking
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/prayer-booking
ExecStart=/usr/bin/node server.js
Restart=on-failure
User=opc
EnvironmentFile=/opt/prayer-booking/.env

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now prayer-booking
sudo systemctl status prayer-booking   # should say "active (running)"
```
(`User=opc` is the default Oracle Linux user — change it if yours differs.)

## 6. Nginx reverse proxy + HTTPS
```bash
sudo dnf install -y nginx || sudo apt-get install -y nginx
sudo tee /etc/nginx/conf.d/prayer-booking.conf > /dev/null <<'EOF'
server {
    listen 80;
    server_name pray.shalomchurch.co.in;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
sudo systemctl enable --now nginx
sudo nginx -t && sudo systemctl reload nginx

# HTTPS certificate (free, auto-renewing)
sudo dnf install -y certbot python3-certbot-nginx || sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d pray.shalomchurch.co.in
```
Certbot edits the Nginx config to redirect HTTP→HTTPS and sets up auto-renewal. Visit
`https://pray.shalomchurch.co.in` to confirm the booking page loads.

## 7. Meta WhatsApp Cloud API setup
1. Go to **developers.facebook.com** → log in with (or create) a Facebook account for the church →
   **My Apps** → **Create App** → type **Business** → name it e.g. "Shalom Church Prayer".
2. In the app dashboard, find **WhatsApp** under "Add products" and click **Set up**.
3. This creates a **test WhatsApp Business Account (WABA)** with a free test phone number.
   Under **API Setup** you'll see:
   - A **temporary access token** (valid ~24h — fine for testing, not for production).
   - A **Phone Number ID** (copy this into `META_PHONE_NUMBER_ID`).
4. Add your own WhatsApp number as a **recipient** (test numbers can only message pre-approved
   numbers) and send a test message from that same page to confirm it works.
5. **For production** (real church number, no 24h-token limit):
   - **Business verification**: in Meta Business Suite, verify your church as a business
     (legal name, address, phone — can take a few days).
   - **Add your real WhatsApp number**: WhatsApp → API Setup → add phone number, verify by SMS/call.
     This becomes the number people see messages from.
   - **Permanent token**: Business Settings → System Users → create a system user → assign it to
     your WhatsApp app with `whatsapp_business_messaging` permission → **Generate token** (set
     expiration to "Never"). Put this in `META_ACCESS_TOKEN`.
6. **Message templates**: see `WHATSAPP_TEMPLATES.md` for the exact names and text to create. Once all are
   approved, add `META_USE_TEMPLATES=true` to `.env` and restart. Until then, set it to `false` and
   only people who messaged your number in the last 24 hours receive messages.

## 7b. Webhook (needed for the "I am here" / "NO" buttons)
The app sends the arrival question with two buttons. When a person taps one, Meta sends the tap to your server.
1. In `.env` set `META_VERIFY_TOKEN` to any long random text you invent, and `META_APP_SECRET` to the **App secret**
   (Meta app dashboard, **App settings**, **Basic**, **App secret**, click Show). Restart the app.
2. In the Meta app dashboard open **WhatsApp**, then **Configuration**, find **Webhook**, click **Edit**:
   - **Callback URL**: `https://pray.shalomchurch.co.in/webhook` (your real domain)
   - **Verify token**: the same text as `META_VERIFY_TOKEN`
   - Click **Verify and save**. (The app answers Meta's check automatically.)
3. Under **Webhook fields**, subscribe to **messages**.
4. The page needs HTTPS (see step 6) and the app must be running, or "Verify and save" will fail.
Meta only delivers real customer messages to the webhook once the app is **Published (Live)**.

## 7c. Reception account
Set `RECEPTION_PASSWORD` in `.env` (different from `ADMIN_PASSWORD`) and restart. Reception opens
`https://pray.shalomchurch.co.in/reception.html`. The admin creates extra slots (Manage slots, Slot type = Extra).

## 8. Verify end to end
1. Open `https://pray.shalomchurch.co.in/admin.html`, log in, add a slot for a few minutes from now.
2. Book it from `https://pray.shalomchurch.co.in/` using your own WhatsApp number.
3. Confirm you get the confirmation message on WhatsApp (and the admin alert on `ADMIN_WHATSAPP`).
4. Check `journalctl -u prayer-booking -f` on the server if a message doesn't arrive — it logs
   `[whatsapp] send failed: ...` with Meta's exact error (e.g. recipient not in test allow-list).

## 9. Point the website at it
Once this is live, confirm the three links already added in `index.html` point at the right URL —
they currently use `https://pray.shalomchurch.co.in`:
- Navbar: "Book a Prayer"
- Hero button: "🙏 Book a Prayer"
- Prayer section: "📅 Book a Prayer Slot"

If your subdomain ends up different, search-and-replace that URL in `index.html` (3 occurrences).
