# Cluster mobile

A native iOS and Android shell (Capacitor) for Cluster. It opens a small
connect screen, checks the address is a Cluster server (`/health/live`),
remembers it, then loads that server's web app full screen. The web app
detects the shell (`data-native-shell="mobile"`) and switches to phone
navigation; **Switch server** in the account menu returns to the connect
screen.

## Build

```
cd apps/mobile
npm install
npx cap sync
npx cap open android   # Android Studio: Run, or Build › Build APK
npx cap open ios       # Xcode on a Mac: Run, or Product › Archive
```

The app ID is `dev.azurestudios.cluster`. Updates to Cluster's UI arrive
from your server; the shell only needs rebuilding for native changes.
