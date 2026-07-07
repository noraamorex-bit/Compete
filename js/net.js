// P2P networking via PeerJS (global `Peer` from lib/peerjs.min.js).
// Host claims a short match code; the joiner dials it directly.
//
// Signaling: PeerJS's public cloud by default. It can be flaky, so this layer
// surfaces the exact failure stage/type (see onDiag) and can be pointed at a
// different signaling server or given custom ICE servers via localStorage —
// no rebuild required:
//   localStorage['voltage.peerhost'] = '{"host":"1.2.3.4","port":9000,"path":"/"}'
//   localStorage['voltage.ice']      = '[{"urls":"turn:host:3478","username":"u","credential":"p"}]'

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusables
const ID_PREFIX = 'voltage-duel-';
const CONNECT_TIMEOUT_MS = 20000;

// STUN is enough for most home networks; TURN relays around strict NATs.
// Override entirely with localStorage['voltage.ice'] if these ever rot.
const DEFAULT_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

function makeCode() {
  let c = '';
  for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

function iceServers() {
  try {
    const custom = JSON.parse(localStorage.getItem('voltage.ice') || 'null');
    if (Array.isArray(custom) && custom.length) return custom;
  } catch { /* use defaults */ }
  return DEFAULT_ICE;
}

function peerOptions() {
  const base = { config: { iceServers: iceServers() }, debug: 1 };
  try {
    const o = JSON.parse(localStorage.getItem('voltage.peerhost') || 'null');
    if (o && o.host) return { ...base, ...o, secure: o.secure ?? false };
  } catch { /* fall through to PeerJS cloud */ }
  return base;
}

export class Net {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.isHost = false;
    this.code = null;
    this.onMessage = null;      // cb(obj)
    this.onOpen = null;         // registered with the signaling server
    this.onConnected = null;    // data channel open
    this.onClosed = null;       // peer left / connection lost
    this.onError = null;        // cb(text, type)
    this.onDiag = null;         // cb(line) — human-readable progress log
    this._closing = false;
    this._connectTimer = null;
    this._serverRetries = 0;
  }

  get connected() { return !!this.conn && this.conn.open; }

  _diag(line) {
    const msg = `[duel] ${line}`;
    // eslint-disable-next-line no-console
    console.log(msg);
    this.onDiag?.(line);
  }

  host() {
    this.destroy();
    this._closing = false;
    this.isHost = true;
    this.code = makeCode();
    this._diag(`hosting as ${this.code} — contacting signaling server…`);
    this._makePeer(ID_PREFIX + this.code);
    this.peer.on('open', (id) => { this._diag(`registered (${id}) — waiting for rival`); this.onOpen?.(); });
    this.peer.on('connection', (conn) => {
      this._diag('rival dialing in');
      if (this.conn && this.conn.open) { conn.close(); return; }
      this._wire(conn);
    });
    return this.code;
  }

  join(code) {
    this.destroy();
    this._closing = false;
    this.isHost = false;
    this.code = code.toUpperCase().trim();
    this._diag(`joining ${this.code} — contacting signaling server…`);
    this._makePeer(undefined);
    this.peer.on('open', (id) => {
      this._diag(`registered (${id}) — dialing host`);
      const conn = this.peer.connect(ID_PREFIX + this.code, { reliable: true });
      this._wire(conn);
      this._connectTimer = setTimeout(() => {
        if (!this.connected && !this._closing) {
          this._fail('CONNECTION TIMED OUT — BOTH RETRY, OR SWITCH NETWORKS', 'timeout');
        }
      }, CONNECT_TIMEOUT_MS);
    });
  }

  _makePeer(id) {
    this.peer = new Peer(id, peerOptions());
    this.peer.on('disconnected', () => {
      if (this._closing) return;
      this._diag('signaling link dropped — reconnecting…');
      try { this.peer.reconnect(); } catch { /* peer destroyed */ }
    });
    this.peer.on('error', (e) => this._error(e));
  }

  _wire(conn) {
    this.conn = conn;
    conn.on('open', () => {
      clearTimeout(this._connectTimer);
      this._diag('data channel open — connected!');
      this.onConnected?.();
    });
    conn.on('data', (d) => this.onMessage?.(d));
    conn.on('close', () => { if (!this._closing) this.onClosed?.(); });
    conn.on('error', (e) => this._error(e));
    conn.on('iceStateChanged', (state) => {
      this._diag(`ice: ${state}`);
      if (this._closing) return;
      if (state === 'failed') {
        this._fail(this.connected ? 'CONNECTION LOST'
          : 'P2P BLOCKED BY NETWORK — TRY A DIFFERENT WI-FI/HOTSPOT', 'ice-failed');
      }
    });
  }

  _fail(msg, type) {
    clearTimeout(this._connectTimer);
    this.onError?.(msg, type);
  }

  _error(e) {
    if (this._closing) return;
    const type = e?.type || 'unknown';
    this._diag(`error: ${type}${e?.message ? ` — ${e.message}` : ''}`);

    // Transient signaling hiccup: the cloud sometimes drops the first attempt.
    // Silently retry a couple of times before surfacing anything to the user.
    if ((type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed')
        && !this.connected && this._serverRetries < 2) {
      this._serverRetries++;
      this._diag(`signaling retry ${this._serverRetries}/2…`);
      const wasHost = this.isHost;
      const code = this.code;
      const retries = this._serverRetries;
      setTimeout(() => {
        if (this._closing) return;
        if (wasHost) this._rehost(code);
        else this.join(code);
        this._serverRetries = retries; // survive the destroy() inside join()
      }, 800 * this._serverRetries);
      return;
    }

    let msg;
    if (type === 'peer-unavailable') msg = 'MATCH CODE NOT FOUND — CHECK THE CODE';
    else if (type === 'unavailable-id') msg = 'CODE TAKEN — CREATE A NEW MATCH';
    else if (type === 'invalid-id' || type === 'invalid-key') msg = 'SIGNALING REJECTED — RETRY';
    else if (type === 'ssl-unavailable') msg = 'SECURE CONNECT FAILED — RETRY';
    else if (type === 'browser-incompatible') msg = 'BROWSER LACKS WEBRTC SUPPORT';
    else if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') {
      msg = 'MATCH SERVER UNREACHABLE — RETRY IN A MOMENT';
    } else {
      msg = `CONNECTION ERROR [${type}] — RETRY`;
    }
    clearTimeout(this._connectTimer);
    this.onError?.(msg, type);
  }

  // Re-register the host under the same code after a transient failure.
  _rehost(code) {
    this._closing = false;
    this.isHost = true;
    this.code = code;
    this._makePeer(ID_PREFIX + code);
    this.peer.on('open', (id) => { this._diag(`re-registered (${id})`); this.onOpen?.(); });
    this.peer.on('connection', (conn) => {
      if (this.conn && this.conn.open) { conn.close(); return; }
      this._wire(conn);
    });
  }

  send(obj) {
    if (this.connected) this.conn.send(obj);
  }

  destroy() {
    this._closing = true;
    this._serverRetries = 0;
    clearTimeout(this._connectTimer);
    try { this.conn?.close(); } catch { /* already closed */ }
    try { this.peer?.destroy(); } catch { /* already destroyed */ }
    this.conn = null;
    this.peer = null;
    this.code = null;
  }
}
