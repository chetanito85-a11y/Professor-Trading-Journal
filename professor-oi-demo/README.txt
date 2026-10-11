PROFESSOR OI TERMINAL
=====================

Do tarike se chalta hai:
  A) Demo (bina broker):   Start-Professor-OI   -> simulated data
  B) Live (apna broker):   Start-Live-Broker    -> asli option chain
     Browser khulne par Broker page par apne broker ka "Connect" dabao,
     jo details maange wo bharo, "Save & connect". Poori guide: BROKER-SETUP.txt

Demo chalane ka tarika
----------------------
1. Ye poora "professor-oi-demo" folder Desktop par rakho (zip hai to pehle Extract karo).
2. Windows:   "Start-Professor-OI.bat" par double-click karo.
   Mac:       "Start-Professor-OI.command" par double-click karo
              (pehli baar: right-click > Open > Open).
3. Browser apne aap khulega:  http://localhost:8764

- Agar computer mein Python hai, to ye local server par chalega.
- Python nahi hai, to bhi chalega: file seedha browser mein khul jaayegi.
- Ya bas "index.html" par double-click kar do, wo bhi kaafi hai.
- Band karna ho to kaali (terminal) window close kar do,
  ya "Stop-Professor-OI.bat" chalao (sab Professor OI windows ek saath band).
- Purana folder delete nahi ho raha? Pehle Stop-Professor-OI.bat chalao
  ya saari kaali windows aur Notepad band karo. Chalta hua program folder ko lock rakhta hai.

Andar kya hai (21 pages)
------------------------
Overview, Option Chain, Live Chain (broker se asli data), OI Analysis, OI Charts, OI Heatmap,
Market Flow, Buildup Grid,
F&O Scanner (~200 stocks),
Market Structure, Chart + Walls, GEX & Greeks, Volatility Lab, Straddle & Expiry,
Strategy Builder, Signal Backtest, Paper Trading + Risk Manager,
Journal + OI, Alerts (beep + voice), Broker & Data, Blueprint.
Theme: header mein Light / AMOLED Dark / Auto.
Bhasha: menu ke neeche English / Hinglish (phone par header mein EN / HIN).

Dhyan rahe
----------
- Paper trading ke trades page reload karne par reset ho jaate hain (demo).
- Demo mein saara data SIMULATED hai. Asli numbers ke liye Live (B) chalao;
  Live mein saare index pages asli data par chalte hain (har page par LIVE DATA likha aata hai).
- Internet ho to sundar fonts load honge. Bina internet ke bhi chalega,
  bas fonts normal dikhenge.
- Port 8764 busy ho to .bat / .command file mein PORT ki value badal do.
- Live connector port 8765 par chalta hai, demo 8764 par, dono saath chal sakte hain.
