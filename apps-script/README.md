# Option Chain: Google Apps Script

Dhan API se live option chain laata hai. `UI` sheet mein table dikhata hai, `FINAL_VIEW` mein har run ki row likhta hai, aur us row par Z2H entry/exit engine chalata hai.

## Files

| File | Kya karti hai |
|---|---|
| `OptionChain.gs` | `loadOptionChain` (main trigger), UI table `A5:M90`, active range `O:R`, FINAL_VIEW `A:N` + `P:Y`, voting |
| `History.gs` | har strike ki OI% / VOL% history, direction, top panel `I1:L4` |
| `EntryExit.gs` | Z2H entry/exit engine, FINAL_VIEW `Z:AG` + S&R snapshot `AH:AI`, headers |
| `SRFetch.gs` | `fetchSRToUI_Z2H`: S&R API se UI `S:V` |

`doGet()` ke liye aapki purani `index.html` jaisi hai waisi rehne do. Wo is folder mein nahi hai.

## Lagane ka tareeka

1. Apps Script project mein jo purani `.gs` files ye functions rakhti thin, unhe delete karo. Unki jagah ye 4 files banao aur poora content paste karo. Ek function do files mein reh gaya to jo file baad mein load hogi, wahi chalegi, isliye purani copy mat chhodna.
2. ⚙️ **Project Settings**:
   - Time zone: `(GMT+05:30) India Standard Time`
   - **Script Properties** mein ye 3 add karo:

     | Property | Value |
     |---|---|
     | `DHAN_TOKEN` | Dhan access token |
     | `DHAN_CLIENT_ID` | Dhan client id |
     | `SR_API_URL` | S&R web app ka `/exec` URL |

   Token expire ho to sirf yahan value badlo.
3. Triggers (⏰):
   - `loadOptionChain`: time-driven, har 1 minute
   - `fetchSRToUI_Z2H`: jaise pehle lagaya tha
   - `blinkRun` (optional): sirf C3 blink ke liye
4. `UI!B1` mein symbol (`NIFTY` / `BANKNIFTY` / `FINNIFTY`) aur `UI!B2` mein expiry daalo. Date cell chalega, ya text `YYYY-MM-DD`.

## Dhyan rakhne wali baatein

- Symbol, expiry ya din badalte hi saari state reset hoti hai: delta, voting, duration, strike history **aur open Z2H position bhi**. Pehle run mein ΔCE/ΔPE `0` aata hai.
- Position haath se band karni ho to editor se `resetEntryExit_Z2H` chalao.
- Errors `UI!A4` mein dikhte hain (`❌ ERROR TOKEN`, `❌ TOKEN MISSING`, `❌ EXPIRY YYYY-MM-DD CHAHIYE` …). S&R ke errors `UI!W1` mein aate hain.
- Pehle run ke baad **Executions → Logs** mein Dhan ka response dekh lo. Usme `previous_oi` / `previous_close_price` aate hain to CHNG OI aur CHNG columns sahi bhare jaayenge.
