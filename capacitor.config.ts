// App iPhone native (Capacitor) : l'app web compilée (dist) dans une coquille iOS, avec Bluetooth natif,
// Face ID et rappels locaux. L'IPA est fabriquée par GitHub Actions (.github/workflows/ios.yml).
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "fr.prepabasket.app",
  appName: "Prépa Basket",
  webDir: "dist",
  ios: { contentInset: "never", backgroundColor: "#050a1f" },
  plugins: {
    LocalNotifications: { iconColor: "#5b3cff" },
  },
};

export default config;
