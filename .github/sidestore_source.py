# Source SideStore (format AltStore 2) de Prépa Basket : décrit la dernière IPA compilée, pour que SideStore
# propose chaque nouvelle compilation comme une mise à jour. Les autorisations viennent de l'Info.plist de l'IPA.
# Usage : python .github/sidestore_source.py PrepaBasket.ipa <version> <build> <url de l'IPA> source.json
import json
import os
import plistlib
import sys
import zipfile
from datetime import datetime, timezone

ipa, version, build, url, out = sys.argv[1:6]
REPO = "eliaskinzigeri-blip/prepa-basket-app"
with zipfile.ZipFile(ipa) as z:
    info = plistlib.loads(z.read("Payload/App.app/Info.plist"))

# Le numéro de l'IPA doit être celui annoncé par la source
assert info["CFBundleShortVersionString"] == version, (info["CFBundleShortVersionString"], version)
assert str(info["CFBundleVersion"]) == build, (info["CFBundleVersion"], build)

privacy = {k: v for k, v in info.items() if k.startswith("NS") and k.endswith("UsageDescription")}
source = {
    "name": "Prépa Basket",
    "identifier": "fr.prepabasket.source",
    "subtitle": "Préparation basket pour ado",
    "sourceURL": f"https://raw.githubusercontent.com/{REPO}/sidestore/source.json",
    "iconURL": f"https://raw.githubusercontent.com/{REPO}/main/native-ios/AppIcon-1024.png",
    "website": "https://prepa-basket.vercel.app",
    "tintColor": "#5b3cff",
    "apps": [{
        "name": "Prépa Basket",
        "bundleIdentifier": info["CFBundleIdentifier"],
        "developerName": "Prépa Basket",
        "subtitle": "Programme, shoot, détente, sommeil et nutrition",
        "localizedDescription": "Programme d'entraînement adapté au club et aux matchs, analyse du shoot et de la détente à la caméra, ceinture cardio, sommeil, VFC du matin et nutrition.",
        "iconURL": f"https://raw.githubusercontent.com/{REPO}/main/native-ios/AppIcon-1024.png",
        "tintColor": "#5b3cff",
        "category": "health",
        "versions": [{
            "version": version,
            "buildVersion": build,
            "date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "localizedDescription": f"Compilation {build}",
            "downloadURL": url,
            "size": os.path.getsize(ipa),
            "minOSVersion": info.get("MinimumOSVersion", "14.0"),
        }],
        "appPermissions": {"entitlements": [], "privacy": privacy},
    }],
    "news": [],
}
with open(out, "w", encoding="utf-8") as f:
    json.dump(source, f, ensure_ascii=False, indent=2)
print(f"source : {version} ({build}), {len(privacy)} autorisations")
