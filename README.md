# Professor Trading Journal

Lightweight offline Android trading journal. No paid SDKs or third-party libraries.

## Features
- Daily trade log
- BUY/SELL, symbol, timeframe, setup, entry/exit, SL/TP, P/L, RR and risk
- WIN/LOSS/BREAKEVEN
- Emotion tracking
- Mistake tracker: FOMO, Revenge, Overtrading, Late Entry, Moved SL, Early Exit, Wrong Setup, No Confirmation, Over Risk, News Trade, Plan Break
- Monthly win accuracy and P/L
- Trading calendar
- Discipline score
- Mistake frequency analysis
- CSV export
- Offline local storage
- Optional screenshot picker

## Free APK build without installing Android Studio
1. Create a free GitHub account and a new repository.
2. Upload this whole project folder.
3. Open the repository's **Actions** tab.
4. Run **Build Professor Trading Journal APK** (or push a commit).
5. Download the generated **Professor-Trading-Journal-debug-apk** artifact.
6. Extract it and install `app-debug.apk` on your Android phone.

The GitHub Actions workflow builds the debug APK using Java 17, Gradle 8.7 and Android Gradle Plugin 8.6.1. The app itself uses no paid services.
