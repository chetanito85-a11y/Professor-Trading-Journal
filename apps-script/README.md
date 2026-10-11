# ⚡ Z2H Option Chain: Ready to Run

Dhan API se live option chain laata hai. `UI` sheet mein table dikhata hai, `FINAL_VIEW` mein har minute ek row likhta hai, aur us row par Z2H entry/exit engine chalata hai. Saara code ek hi file `Code.gs` mein hai.

## Chalane ka tareeka (3 step)

1. **Code paste karo:** Google Sheet → **Extensions → Apps Script** kholo. Purani code files delete karo (`index.html` rehne do), `Code.gs` mein ye poora code paste karo aur **Save (Ctrl+S)** dabao.
2. **Sheet reload karo:** upar naya menu **⚡ Z2H** aayega. Usme **🚀 Setup (1 click)** dabao.
   - Pehli baar Google permission maangega: **Continue → apna account → Advanced → Go to … (unsafe) → Allow**. Apni script ke liye ye normal hai.
   - Permission ke baad **🚀 Setup** ek baar aur dabao.
3. **Setup ke 3 sawaal ka jawab do:** Dhan Client ID, Dhan Access Token, aur S&R URL. S&R URL nahi hai to khaali chhod do.

Bas. Setup baaki kaam khud karta hai:
- `UI` aur `FINAL_VIEW` sheets banata hai
- B1 mein symbol ka dropdown lagata hai
- Dhan se nearest expiry laake B2 mein daalta hai
- har minute ka auto-run trigger lagata hai
- pehla run turant chalata hai

## ⚡ Z2H menu

| Button | Kaam |
|---|---|
| 🚀 Setup (1 click) | Token save, sheets, expiry, triggers, pehla run. Dobara dabane par duplicate trigger nahi banta |
| ▶️ Abhi chalao | Market band ho tab bhi abhi ek run chalata hai |
| 🔑 Token update | Dhan ka naya token daalo. Script check karke batati hai ki token sahi hai ya nahi |
| 📅 Expiry refresh | B2 mein nearest expiry aur aage ki expiries ka dropdown |
| ♻️ Position reset | Open Z2H position haath se saaf karta hai |
| ⏹️ Auto run band karo | Triggers hata deta hai |

## Apne aap kya hota hai

- **Market time:** auto run sirf **Mon–Fri 09:15–15:30 IST** mein chalta hai. Free Google account mein triggers din bhar mein lagbhag 90 minute hi chal sakte hain. NSE holidays ki pehchaan nahi hai, us din bhi chalega (koi nuksaan nahi).
- **Expiry:** B2 khaali ho, expiry nikal gayi ho, ya symbol badla ho, to nearest expiry khud aa jaati hai. Dropdown se koi aur expiry chuno to wahi chalti hai.
- **Reset:** symbol, expiry ya din badalne par saari state reset hoti hai: delta, voting, history aur open position. Pehle run mein ΔCE/ΔPE `0` aata hai.

## Error aaye to

| Kahan | Message | Kya karo |
|---|---|---|
| `UI!A4` | `❌ TOKEN MISSING` / `❌ ERROR TOKEN` | ⚡ Z2H → 🔑 Token update |
| `UI!A4` | `❌ EXPIRY NAHI MILI` | ⚡ Z2H → 📅 Expiry refresh |
| `UI!A4` | `❌ API ERROR 400` | Agla run nayi expiry khud le aayega |
| `UI!W1` | `SR_API_URL MISSING` | Setup dobara chalao aur S&R URL daalo |

Web app (`doGet`) use karte ho to code badalne ke baad **Deploy → Manage deployments → ✏️ → New version → Deploy** karna hoga.
