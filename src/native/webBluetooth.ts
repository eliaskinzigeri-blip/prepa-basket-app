// App iPhone native (Capacitor) : WKWebView n'a pas Web Bluetooth. Ce module recrée la petite partie de l'API
// navigator.bluetooth dont l'app se sert (choix d'un appareil, GATT, notifications, lecture, écriture) au-dessus du
// Bluetooth natif d'iOS (@capacitor-community/bluetooth-le). La ceinture cardio, le rameur et la balance marchent
// ainsi sans changer leur code.
import { BleClient, type ScanResult } from "@capacitor-community/bluetooth-le";

const KNOWN = "pb.ble.known.v1";
const BASE = "-0000-1000-8000-00805f9b34fb";

/** 0x180d, "heart_rate"… → UUID complet en minuscules. */
function uuid(u: BluetoothServiceUUID | BluetoothCharacteristicUUID): string {
  if (typeof u === "number") return `0000${u.toString(16).padStart(4, "0")}${BASE}`;
  const s = String(u).toLowerCase();
  if (/^[0-9a-f]{4}$/.test(s)) return `0000${s}${BASE}`;
  if (/^[0-9a-f]{8}$/.test(s)) return `${s}${BASE}`;
  const named: Record<string, number> = { heart_rate: 0x180d, heart_rate_measurement: 0x2a37, weight_scale: 0x181d, body_composition: 0x181b, fitness_machine: 0x1826 };
  return named[s] != null ? uuid(named[s]) : s;
}

const notFound = (what: string) => new DOMException(`${what} introuvable`, "NotFoundError");
const toView = (v: BufferSource) => (v instanceof DataView ? v : ArrayBuffer.isView(v) ? new DataView(v.buffer, v.byteOffset, v.byteLength) : new DataView(v as ArrayBuffer));

let ready: Promise<void> | null = null;
const init = () => (ready ??= BleClient.initialize({ androidNeverForLocation: true }));

class Characteristic extends EventTarget {
  value: DataView | null = null;
  constructor(private device: Device, readonly service: Service, readonly uuid: string, readonly properties: BluetoothCharacteristicProperties) { super(); }
  async startNotifications() {
    await BleClient.startNotifications(this.device.id, this.service.uuid, this.uuid, (v) => {
      this.value = v;
      this.dispatchEvent(new Event("characteristicvaluechanged"));
    });
    return this;
  }
  async stopNotifications() { await BleClient.stopNotifications(this.device.id, this.service.uuid, this.uuid); return this; }
  async readValue() { this.value = await BleClient.read(this.device.id, this.service.uuid, this.uuid); return this.value; }
  writeValueWithResponse(v: BufferSource) { return BleClient.write(this.device.id, this.service.uuid, this.uuid, toView(v)); }
  writeValueWithoutResponse(v: BufferSource) { return BleClient.writeWithoutResponse(this.device.id, this.service.uuid, this.uuid, toView(v)); }
  writeValue(v: BufferSource) { return this.properties.write ? this.writeValueWithResponse(v) : this.writeValueWithoutResponse(v); }
}

class Service {
  constructor(private device: Device, readonly uuid: string, private chars: { uuid: string; properties: Record<string, boolean> }[]) {}
  async getCharacteristic(u: BluetoothCharacteristicUUID) {
    const id = uuid(u);
    const c = this.chars.find((x) => x.uuid.toLowerCase() === id);
    if (!c) throw notFound("Caractéristique");
    const p = c.properties;
    return new Characteristic(this.device, this, id, {
      broadcast: !!p.broadcast, read: !!p.read, writeWithoutResponse: !!p.writeWithoutResponse, write: !!p.write, notify: !!p.notify,
      indicate: !!p.indicate, authenticatedSignedWrites: !!p.authenticatedSignedWrites, reliableWrite: false, writableAuxiliaries: false,
    } as BluetoothCharacteristicProperties);
  }
}

class Gatt {
  connected = false;
  private services: { uuid: string; characteristics: { uuid: string; properties: Record<string, boolean> }[] }[] = [];
  constructor(readonly device: Device) {}
  async connect() {
    await init();
    await BleClient.connect(this.device.id, () => {
      this.connected = false;
      this.device.dispatchEvent(new Event("gattserverdisconnected"));
    }, { timeout: 15000 });
    this.connected = true;
    this.services = (await BleClient.getServices(this.device.id)) as unknown as typeof this.services;
    return this;
  }
  disconnect() { this.connected = false; BleClient.disconnect(this.device.id).catch(() => undefined); }
  async getPrimaryService(u: BluetoothServiceUUID) {
    const id = uuid(u);
    const s = this.services.find((x) => x.uuid.toLowerCase() === id);
    if (!s) throw notFound("Service");
    return new Service(this.device, id, s.characteristics);
  }
}

class Device extends EventTarget {
  readonly gatt: Gatt;
  constructor(readonly id: string, readonly name: string | undefined) { super(); this.gatt = new Gatt(this); }
  async forget() { /* rien à oublier côté iOS */ }
}

function remember(d: Device) {
  try {
    const list: { id: string; name?: string }[] = JSON.parse(localStorage.getItem(KNOWN) ?? "[]");
    localStorage.setItem(KNOWN, JSON.stringify([{ id: d.id, name: d.name }, ...list.filter((x) => x.id !== d.id)].slice(0, 10)));
  } catch { /* stockage indisponible */ }
}

/** Un appareil vu au scan correspond-il à l'un des filtres (service annoncé ou début du nom) ? */
function matches(r: ScanResult, filters: BluetoothLEScanFilter[]): boolean {
  const name = r.localName ?? r.device.name ?? "";
  const ads = (r.uuids ?? []).map((x) => x.toLowerCase());
  return filters.some((f) =>
    (!f.namePrefix || name.startsWith(f.namePrefix)) && (!f.name || name === f.name)
    && (!f.services?.length || f.services.every((s) => ads.includes(uuid(s)))));
}

/** Fenêtre de choix : les appareils trouvés pendant le scan, à toucher pour se connecter. */
function picker(filters: BluetoothLEScanFilter[] | null): Promise<Device> {
  return new Promise((resolve, reject) => {
    const found = new Map<string, ScanResult>();
    const box = document.createElement("div");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Choisir un appareil Bluetooth");
    box.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(5,10,31,.82);display:flex;align-items:flex-end;justify-content:center;padding:16px;font:500 16px/1.35 system-ui,sans-serif;color:#fff";
    const sheet = document.createElement("div");
    sheet.style.cssText = "width:100%;max-width:480px;background:#101b45;border-radius:22px;padding:18px 16px calc(16px + env(safe-area-inset-bottom));display:grid;gap:10px";
    sheet.innerHTML = `<b style="font-size:18px">Choisis ton appareil</b><span style="opacity:.7;font-size:14px">Recherche en cours… Allume l'appareil et garde-le près du téléphone.</span><div data-list style="display:grid;gap:8px;max-height:50vh;overflow:auto"></div>`;
    const list = sheet.querySelector("[data-list]") as HTMLDivElement;
    const cancel = document.createElement("button");
    cancel.textContent = "Annuler";
    cancel.style.cssText = "min-height:48px;border-radius:14px;border:1px solid rgba(255,255,255,.2);background:transparent;color:#fff;font:inherit";
    sheet.appendChild(cancel);
    box.appendChild(sheet);
    document.body.appendChild(box);
    const done = async (fn: () => void) => { await BleClient.stopLEScan().catch(() => undefined); box.remove(); fn(); };
    cancel.onclick = () => done(() => reject(new DOMException("Choix annulé", "NotFoundError")));
    const render = () => {
      list.replaceChildren(...[...found.values()].map((r) => {
        const b = document.createElement("button");
        b.textContent = r.localName ?? r.device.name ?? "Appareil sans nom";
        b.style.cssText = "min-height:52px;text-align:left;padding:0 14px;border-radius:14px;border:0;background:#5b3cff;color:#fff;font:inherit";
        b.onclick = () => done(() => { const d = new Device(r.device.deviceId, r.localName ?? r.device.name); remember(d); resolve(d); });
        return b;
      }));
    };
    init().then(() => BleClient.requestLEScan({}, (r) => {
      if (filters && !matches(r, filters)) return;
      if (!found.has(r.device.deviceId)) { found.set(r.device.deviceId, r); render(); }
    })).catch(() => done(() => reject(new DOMException("Bluetooth indisponible : active-le dans Réglages.", "NotSupportedError"))));
    // Arrêt du scan après 30 s pour la batterie ; la liste reste affichée
    setTimeout(() => BleClient.stopLEScan().catch(() => undefined), 30_000);
  });
}

const bluetooth = {
  async getAvailability() { return true; },
  async requestDevice(o: { filters?: BluetoothLEScanFilter[]; acceptAllDevices?: boolean }) {
    return picker(o.acceptAllDevices ? null : o.filters ?? null);
  },
  /** Appareils déjà choisis une fois : retrouvés sans fenêtre de choix. */
  async getDevices() {
    try {
      await init();
      const known: { id: string; name?: string }[] = JSON.parse(localStorage.getItem(KNOWN) ?? "[]");
      if (!known.length) return [];
      const got = await BleClient.getDevices(known.map((k) => k.id));
      return got.map((d) => new Device(d.deviceId, d.name ?? known.find((k) => k.id === d.deviceId)?.name));
    } catch { return []; }
  },
};

/** Installe navigator.bluetooth dans l'app native (ne fait rien dans un navigateur). */
export function installNativeBluetooth() {
  if ("bluetooth" in navigator) return;
  Object.defineProperty(navigator, "bluetooth", { value: bluetooth, configurable: true });
}
