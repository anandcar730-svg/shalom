// WhatsApp sender. Providers: "meta" (WhatsApp Cloud API) or "twilio".
// With no provider configured, messages are only logged (handy for testing).
const provider = (process.env.WHATSAPP_PROVIDER || '').toLowerCase();

async function sendMeta(to, text) {
  const { META_PHONE_NUMBER_ID: id, META_ACCESS_TOKEN: token } = process.env;
  const r = await fetch(`https://graph.facebook.com/v21.0/${id}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
  });
  if (!r.ok) throw new Error(`Meta ${r.status}: ${await r.text()}`);
}

async function sendTwilio(to, text) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: tok, TWILIO_WHATSAPP_FROM: from } = process.env;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: from, To: `whatsapp:+${to}`, Body: text }),
  });
  if (!r.ok) throw new Error(`Twilio ${r.status}: ${await r.text()}`);
}

// Business-initiated messages must be pre-approved templates (see WHATSAPP_TEMPLATES.md).
// With META_USE_TEMPLATES=true the Meta provider sends `tpl` = { name, lang, params: [...] };
// otherwise (or for Twilio / dry-run) the plain `text` is used.
const useTemplates = String(process.env.META_USE_TEMPLATES || '').toLowerCase() === 'true';

async function sendMetaTemplate(to, tpl) {
  const { META_PHONE_NUMBER_ID: id, META_ACCESS_TOKEN: token } = process.env;
  const clean = (v) => String(v).replace(/[\n\r\t]+/g, ' ').replace(/ {4,}/g, '   ').trim() || '-';
  const r = await fetch(`https://graph.facebook.com/v21.0/${id}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to, type: 'template',
      template: {
        name: tpl.name, language: { code: tpl.lang || 'en' },
        components: [
          { type: 'body', parameters: (tpl.params || []).map((p) => ({ type: 'text', text: clean(p) })) },
          // quick-reply buttons: the payload comes back to our webhook when the person taps one
          ...(tpl.buttons || []).map((payload, i) => ({ type: 'button', sub_type: 'quick_reply', index: String(i), parameters: [{ type: 'payload', payload }] })),
        ],
      },
    }),
  });
  if (!r.ok) throw new Error(`Meta template ${tpl.name}/${tpl.lang} ${r.status}: ${await r.text()}`);
}

// Never throws: a failed message must not break a booking.
async function sendWhatsApp(to, text, tpl) {
  if (!to) return false;
  try {
    if (provider === 'meta' && useTemplates && tpl) await sendMetaTemplate(to, tpl);
    else if (provider === 'meta') await sendMeta(to, text);
    else if (provider === 'twilio') await sendTwilio(to, text);
    else { console.log(`[whatsapp:dry-run] -> ${to}\n${text}\n`); return false; }
    return true;
  } catch (e) {
    console.error('[whatsapp] send failed:', e.message);
    return false;
  }
}

module.exports = { sendWhatsApp };
