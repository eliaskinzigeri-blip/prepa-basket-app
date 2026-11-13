import { heart } from "../heart";
import {
  CONTROL_POINT, CP, FTMS_SERVICE, HR_MEASUREMENT, HR_SERVICE, MACHINE_STATUS, RESISTANCE_RANGE, ROWER_DATA,
  clampLevel, inferReportScale, parseCpResponse, parseHeartRate, parseResistanceRange, parseRowerData, rawToLevel, resistanceFactor, toHex,
  type CpResult, type RowerFrame,
} from './ftms';

export type LinkState = 'disconnected' | 'searching' | 'connected';
export type ControlState = 'unknown' | 'control' | 'coach' | 'taken';

export interface RowerSample {
  spm: number;
  paceSec: number;
  watts: number;
  distanceM: number;
  kcal: number;
  hr: number;
  level: number | null;
}

export interface RowerLink {
  readonly isDemo: boolean;
  readonly name: string;
  state: LinkState;
  control: ControlState;
  sample: RowerSample;
  setLevel(level: number): Promise<CpResult>;
  disconnect(): void;
}

type Listener = () => void;

const EMPTY: RowerSample = { spm: 0, paceSec: 0, watts: 0, distanceM: 0, kcal: 0, hr: 0, level: null };

class Hub {
  rower: RowerLink | null = null;
  hrState: LinkState = 'disconnected';
  hrName = '';
  hrValue = 0;
  version = 0;
  log: string[] = [];
  private listeners = new Set<Listener>();

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }
  trace(line: string) {
    this.log.push(`${new Date().toLocaleTimeString('fr-FR')}  ${line}`);
    if (this.log.length > 400) this.log.shift();
  }
}

export const hub = new Hub();

// Ceinture déjà connectée par le module cardio commun : le rameur affiche et enregistre sa FC aussi
heart.subscribe(() => {
  if (hub.hrState === "connected" && hub.hrName !== heart.name) return; // ceinture branchée par l'écran rameur
  if (heart.state === "connected") { hub.hrState = "connected"; hub.hrName = heart.name; hub.hrValue = heart.bpm; }
  else if (hub.hrName === heart.name) { hub.hrState = "disconnected"; hub.hrValue = 0; }
  hub.emit();
});

/** Web Bluetooth est absent de Safari iOS : l'extension beacio le fournit. */
export async function ensureBluetooth(): Promise<boolean> {
  if ('bluetooth' in navigator) return true;
  if (isIOS()) {
    try {
      await import('@beacio/core/auto');
    } catch {
      return false;
    }
  }
  return 'bluetooth' in navigator;
}

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

class BleRower implements RowerLink {
  readonly isDemo = false;
  state: LinkState = 'searching';
  control: ControlState = 'unknown';
  sample: RowerSample = { ...EMPTY };
  private cp: BluetoothRemoteGATTCharacteristic | null = null;
  private factor = 10;
  private reportScale: 1 | 10 | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private pending: ((r: CpResult) => void) | null = null;
  private wanted = true;
  private retry: ReturnType<typeof setTimeout> | null = null;

  constructor(private device: BluetoothDevice) {
    device.addEventListener('gattserverdisconnected', this.onDrop);
  }

  get name() {
    return this.device.name ?? 'Rameur';
  }

  async connect() {
    this.state = 'searching';
    hub.emit();
    const server = await this.device.gatt!.connect();
    const service = await server.getPrimaryService(FTMS_SERVICE);

    const data = await service.getCharacteristic(ROWER_DATA);
    data.addEventListener('characteristicvaluechanged', this.onData);
    await data.startNotifications();

    try {
      const range = await (await service.getCharacteristic(RESISTANCE_RANGE)).readValue();
      const parsed = parseResistanceRange(range);
      this.factor = resistanceFactor(parsed);
      hub.trace(`Plage de résistance ${toHex(range)} → min ${parsed.min}, max ${parsed.max}, facteur ×${this.factor}`);
    } catch {
      hub.trace('Plage de résistance illisible, facteur ×10 par défaut');
    }

    try {
      const status = await service.getCharacteristic(MACHINE_STATUS);
      status.addEventListener('characteristicvaluechanged', this.onStatus);
      await status.startNotifications();
    } catch {
      hub.trace('État machine (0x2ADA) indisponible');
    }

    this.control = await this.takeControl(service);
    this.state = 'connected';
    hub.emit();
  }

  private async takeControl(service: BluetoothRemoteGATTService): Promise<ControlState> {
    try {
      this.cp = await service.getCharacteristic(CONTROL_POINT);
      this.cp.addEventListener('characteristicvaluechanged', this.onCp);
      await this.cp.startNotifications();
    } catch {
      hub.trace('Control Point indisponible : mode coach');
      return 'coach';
    }
    const req = await this.send(CP.requestControl());
    if (req === 'not-permitted') return 'taken';
    if (req !== 'ok') return 'coach';
    await this.send(CP.start());
    return 'control';
  }

  /** Une commande à la fois, et on attend la réponse du rameur. */
  private send(bytes: Uint8Array): Promise<CpResult> {
    const run = () =>
      new Promise<CpResult>((resolve) => {
        const cp = this.cp;
        if (!cp) return resolve('failed');
        const timer = setTimeout(() => {
          this.pending = null;
          hub.trace(`Pas de réponse à ${Array.from(bytes).join(' ')}`);
          resolve('failed');
        }, 2500);
        this.pending = (r) => {
          clearTimeout(timer);
          resolve(r);
        };
        hub.trace(`→ ${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ')}`);
        cp.writeValueWithResponse(bytes as BufferSource).catch(() => {
          clearTimeout(timer);
          this.pending = null;
          resolve('failed');
        });
      });
    const result = this.queue.then(run, run);
    this.queue = result;
    return result;
  }

  async setLevel(level: number) {
    if (this.control !== 'control') return 'not-permitted' as const;
    return this.send(CP.setResistance(clampLevel(level), this.factor));
  }

  private onData = (e: Event) => {
    const dv = (e.target as BluetoothRemoteGATTCharacteristic).value!;
    const f: RowerFrame = parseRowerData(dv);
    if (hub.log.length < 40) hub.trace(`Rower Data ${toHex(dv)}`);
    const s = this.sample;
    if (f.spm !== undefined) s.spm = f.spm;
    if (f.paceSec !== undefined) s.paceSec = f.paceSec;
    if (f.watts !== undefined) s.watts = f.watts;
    if (f.distanceM !== undefined) s.distanceM = f.distanceM;
    if (f.kcal !== undefined && f.kcal !== 0xffff) s.kcal = f.kcal;
    if (f.hr !== undefined && f.hr > 0) s.hr = f.hr;
    if (f.resistanceRaw !== undefined) {
      this.reportScale = inferReportScale(f.resistanceRaw, this.reportScale);
      if (this.reportScale) s.level = rawToLevel(f.resistanceRaw, this.reportScale);
    }
  };

  private onCp = (e: Event) => {
    const dv = (e.target as BluetoothRemoteGATTCharacteristic).value!;
    hub.trace(`← ${toHex(dv)}`);
    const parsed = parseCpResponse(dv);
    if (parsed && this.pending) {
      const p = this.pending;
      this.pending = null;
      p(parsed.result);
    }
  };

  private onStatus = (e: Event) => {
    const dv = (e.target as BluetoothRemoteGATTCharacteristic).value!;
    hub.trace(`État machine ${toHex(dv)}`);
    if (dv.getUint8(0) === 0xff) {
      this.control = 'taken';
      hub.emit();
    }
  };

  private onDrop = () => {
    hub.trace('Connexion perdue');
    this.state = 'disconnected';
    this.cp = null;
    this.pending = null;
    hub.emit();
    if (this.wanted) this.scheduleRetry(1);
  };

  private scheduleRetry(attempt: number) {
    if (attempt > 5 || !this.wanted) return;
    this.retry = setTimeout(() => {
      this.connect().catch(() => {
        this.state = 'disconnected';
        hub.emit();
        this.scheduleRetry(attempt + 1);
      });
    }, 2000 * attempt);
  }

  /** Bouton « Reconnecter » : un tap, sans repasser par la liste d'appareils. */
  reconnect() {
    if (this.retry) clearTimeout(this.retry);
    return this.connect();
  }

  disconnect() {
    this.wanted = false;
    if (this.retry) clearTimeout(this.retry);
    this.device.removeEventListener('gattserverdisconnected', this.onDrop);
    if (this.device.gatt?.connected) this.device.gatt.disconnect();
    this.state = 'disconnected';
  }
}

/** Rameur simulé : le « rameur virtuel » vise ce que l'app lui demande, avec des variations. */
export class SimRower implements RowerLink {
  readonly isDemo = true;
  readonly name = 'Rameur simulé';
  state: LinkState = 'connected';
  control: ControlState = 'control';
  sample: RowerSample = { ...EMPTY, level: 5 };
  /** Allure et cadence que le rameur virtuel cherche à tenir */
  aim = { paceSec: 150, spm: 22, active: true };
  private timer: ReturnType<typeof setInterval>;
  private exactDistance = 0;
  private exactKcal = 0;
  private t = 0;

  constructor(private speed = 1) {
    this.timer = setInterval(() => this.step(0.5 * this.speed), 500);
  }

  private step(dt: number) {
    this.t += dt;
    const s = this.sample;
    if (!this.aim.active) {
      s.spm = 0;
      s.watts = 0;
      s.paceSec = 0;
    } else {
      const wobble = Math.sin(this.t / 7) * 3 + Math.sin(this.t / 2.3) * 1.5;
      const prev = s.paceSec || this.aim.paceSec + 15;
      s.paceSec = Math.round(prev + (this.aim.paceSec + wobble - prev) * 0.35);
      s.spm = Math.round(this.aim.spm + Math.sin(this.t / 5));
      s.watts = Math.round(2.8 / Math.pow(s.paceSec / 500, 3));
      this.exactDistance += (500 / s.paceSec) * dt;
      this.exactKcal += (s.watts * 4 + 300) * (dt / 3600) * 1.0;
      s.distanceM = Math.floor(this.exactDistance);
      s.kcal = Math.floor(this.exactKcal);
      const hrAim = 95 + s.watts * 0.32;
      s.hr = Math.round((s.hr || 90) + (hrAim - (s.hr || 90)) * 0.03 * dt);
    }
  }

  async setLevel(level: number) {
    await new Promise((r) => setTimeout(r, 40));
    this.sample.level = clampLevel(level);
    return 'ok' as const;
  }

  disconnect() {
    clearInterval(this.timer);
    this.state = 'disconnected';
  }
}

export function startDemo(speed = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('x')) || 1 : 1) {
  hub.rower?.disconnect();
  hub.rower = new SimRower(speed);
  hub.emit();
  return hub.rower;
}

export type ConnectError = 'cancelled' | 'unsupported' | 'not-ftms' | 'busy' | 'failed';

export class BleError extends Error {
  constructor(public code: ConnectError) {
    super(code);
  }
}

/** À appeler dans un geste de l'utilisateur (exigence de Web Bluetooth). */
export async function connectRower(): Promise<{ id: string; name: string }> {
  if (!(await ensureBluetooth())) throw new BleError('unsupported');
  let device: BluetoothDevice;
  try {
    device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [FTMS_SERVICE] }, { namePrefix: 'DOMYOS' }],
      optionalServices: [FTMS_SERVICE],
    });
  } catch (e) {
    if ((e as DOMException).name === 'NotFoundError') throw new BleError('cancelled');
    throw new BleError('failed');
  }
  return attach(device);
}

/** Reconnexion au dernier rameur sans liste, quand le navigateur le permet. */
export async function reconnectKnownRower(id: string): Promise<{ id: string; name: string } | null> {
  if (!(await ensureBluetooth()) || !navigator.bluetooth.getDevices) return null;
  const device = (await navigator.bluetooth.getDevices()).find((d) => d.id === id);
  if (!device) return null;
  return attach(device);
}

async function attach(device: BluetoothDevice) {
  hub.rower?.disconnect();
  const rower = new BleRower(device);
  hub.rower = rower;
  try {
    await rower.connect();
  } catch (e) {
    rower.disconnect();
    hub.rower = null;
    hub.emit();
    hub.trace(`Échec de connexion : ${(e as Error).message}`);
    throw new BleError((e as DOMException).name === 'NotFoundError' ? 'not-ftms' : 'failed');
  }
  if (rower.control === 'taken') throw new BleError('busy');
  return { id: device.id, name: rower.name };
}

export function reconnectCurrent() {
  const r = hub.rower;
  if (r instanceof BleRower) return r.reconnect();
  return Promise.resolve();
}

export async function connectHeartRate(): Promise<{ id: string; name: string }> {
  if (!(await ensureBluetooth())) throw new BleError('unsupported');
  let device: BluetoothDevice;
  try {
    device = await navigator.bluetooth.requestDevice({ filters: [{ services: [HR_SERVICE] }] });
  } catch (e) {
    if ((e as DOMException).name === 'NotFoundError') throw new BleError('cancelled');
    throw new BleError('failed');
  }
  hub.hrState = 'searching';
  hub.emit();
  try {
    const server = await device.gatt!.connect();
    const service = await server.getPrimaryService(HR_SERVICE);
    const ch = await service.getCharacteristic(HR_MEASUREMENT);
    ch.addEventListener('characteristicvaluechanged', (e) => {
      hub.hrValue = parseHeartRate((e.target as BluetoothRemoteGATTCharacteristic).value!);
    });
    await ch.startNotifications();
    device.addEventListener('gattserverdisconnected', () => {
      hub.hrState = 'disconnected';
      hub.hrValue = 0;
      hub.emit();
    });
    hub.hrState = 'connected';
    hub.hrName = device.name ?? 'Ceinture cardio';
    hub.emit();
    return { id: device.id, name: hub.hrName };
  } catch {
    hub.hrState = 'disconnected';
    hub.emit();
    throw new BleError('failed');
  }
}

export function connectErrorMessage(code: ConnectError): string | null {
  switch (code) {
    case 'cancelled':
      return null;
    case 'unsupported':
      return "Ce navigateur ne gère pas le Bluetooth. Ouvre Prépa Basket dans Chrome ou Edge, ou dans Safari avec l'extension beacio sur iPhone.";
    case 'not-ftms':
      return "Cet appareil n'est pas compatible : il n'expose pas le service FTMS.";
    case 'busy':
      return 'Une autre app pilote déjà le rameur. Ferme Kinomap ou EXR, puis relance la connexion.';
    default:
      return "La connexion a échoué. Rame quelques coups pour réveiller la console, puis relance la recherche.";
  }
}
