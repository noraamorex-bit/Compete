// P2P networking via PeerJS (global `Peer` from lib/peerjs.min.js).
// Star topology: the host claims a short match code and accepts up to N-1
// joiners; game-level relaying between joiners happens in duel.js.
//
// Signaling/ICE overrides (no rebuild needed):
//   localStorage['voltage.peerhost'] = '{"host":"1.2.3.4","port":9000,"path":"/"}'
//   localStorage['voltage.ice']      = '[{"urls":"turn:host:3478","username":"u","credential":"p"}]'

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusables
const ID_PREFIX = 'voltage-duel-';
const CONNECT_TIMEOUT_MS = 20000;

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
    this.isHost = false;
    this.code = null;
    this.maxPlayers = 2;

    // Host side: slot → { conn, open }
    this.conns = new Map();
    this._nextSlot = 1;
    // Client side: single link to the host.
    this.hostConn = null;

    // Callbacks (wired by duel.js):
    this.onOpen = null;             // registered with signaling server
    this.onPeerJoined = null;       // host: cb(slot) — data channel open
    this.onPeerLeft = null;         // host: cb(slot)
    this.onHostMessage = null;      // client: cb(msg)
    this.onPeerMessage = null;      // host: cb(slot, msg)
    this.onConnectedToHost = null;  // client: channel open
    this.onHostLost = null;         // client: link to host gone
    this.onError = null;            // cb(text, type)
    this.onDiag = null;

    this._closing = false;
    this._connectTimer = null;
    this._serverRetries = 0;
  }

  get connected() {
    return this.isHost ? this.openCount > 0 : !!this.hostConn && this.hostConn.open;
  }

  get openCount() {
    let n = 0;
    for (const c of this.conns.values()) if (c.open && c.conn.open) n++;
    return n;
  }

  get playerCount() { return (this.isHost ? this.openCount : 0) + 1; }

  _diag(line) {
    console.log(`[duel] ${line}`);
    this.onDiag?.(line);
  }

  // ---------- Host ----------

  host(maxPlayers) {
    this.destroy();
    this._closing = false;
    this.isHost = true;
    this.maxPlayers = maxPlayers;
    this.code = makeCode();
    this._nextSlot = 1;
    this._diag(`hosting as ${this.code} (${maxPlayers}p) — contacting signaling server…`);
    this._makePeer(ID_PREFIX + this.code);
    this.peer.on('open', (id) => { this._diag(`registered (${id}) — waiting for players`); this.onOpen?.(); });
    this.peer.on('connection', (conn) => this._acceptPeer(conn));
    return this.code;
  }

  _acceptPeer(conn) {
    if (this.openCount + 1 >= this.maxPlayers) {
      this._diag('lobby full — rejecting extra join');
      conn.on('open', () => { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); });
      return;
    }
    const slot = this._nextSlot++;
    const entry = { conn, open: false };
    this.conns.set(slot, entry);
    this._diag(`player dialing in → slot ${slot}`);
    conn.on('open', () => {
      entry.open = true;
      this._diag(`slot ${slot} connected`);
      this.onPeerJoined?.(slot);
    });
    conn.on('data', (d) => this.onPeerMessage?.(slot, d));
    const gone = () => {
      if (this._closing || !this.conns.has(slot)) return;
      this.conns.delete(slot);
      this._diag(`slot ${slot} left`);
      if (entry.open) this.onPeerLeft?.(slot);
    };
    conn.on('close', gone);
    conn.on('error', (e) => { this._diag(`slot ${slot} error: ${e?.type || e}`); gone(); });
    conn.on('iceStateChanged', (s) => { if (s === 'failed') gone(); });
  }

  sendToSlot(slot, obj) {
    const e = this.conns.get(slot);
    if (e && e.open && e.conn.open) e.conn.send(obj);
  }

  broadcast(obj, exceptSlot = -1) {
    for (const [slot, e] of this.conns) {
      if (slot !== exceptSlot && e.open && e.conn.open) e.conn.send(obj);
    }
  }

  dropSlot(slot) {
    const e = this.conns.get(slot);
    if (!e) return;
    this.conns.delete(slot);
    try { e.conn.close(); } catch { /* already closed */ }
  }

  // ---------- Client ----------

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
      this.hostConn = conn;
      conn.on('open', () => {
        clearTimeout(this._connectTimer);
        this._diag('data channel open — connected to host');
        this.onConnectedToHost?.();
      });
      conn.on('data', (d) => this.onHostMessage?.(d));
      conn.on('close', () => { if (!this._closing) this.onHostLost?.(); });
      conn.on('error', (e) => this._error(e));
      conn.on('iceStateChanged', (state) => {
        this._diag(`ice: ${state}`);
        if (this._closing) return;
        if (state === 'failed') {
          this._fail(this.connected ? 'CONNECTION LOST'
            : 'P2P BLOCKED BY NETWORK — TRY A DIFFERENT WI-FI/HOTSPOT', 'ice-failed');
        }
      });
      this._connectTimer = setTimeout(() => {
        if (!this.connected && !this._closing) {
          this._fail('CONNECTION TIMED OUT — BOTH RETRY, OR SWITCH NETWORKS', 'timeout');
        }
      }, CONNECT_TIMEOUT_MS);
    });
  }

  sendToHost(obj) {
    if (this.hostConn && this.hostConn.open) this.hostConn.send(obj);
  }

  // ---------- Shared ----------

  _makePeer(id) {
    this.peer = new Peer(id, peerOptions());
    this.peer.on('disconnected', () => {
      if (this._closing) return;
      this._diag('signaling link dropped — reconnecting…');
      try { this.peer.reconnect(); } catch { /* destroyed */ }
    });
    this.peer.on('error', (e) => this._error(e));
  }

  _fail(msg, type) {
    clearTimeout(this._connectTimer);
    this.onError?.(msg, type);
  }

  _error(e) {
    if (this._closing) return;
    const type = e?.type || 'unknown';
    this._diag(`error: ${type}${e?.message ? ` — ${e.message}` : ''}`);

    if ((type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed')
        && !this.connected && this._serverRetries < 2) {
      this._serverRetries++;
      this._diag(`signaling retry ${this._serverRetries}/2…`);
      const wasHost = this.isHost;
      const code = this.code;
      const max = this.maxPlayers;
      const retries = this._serverRetries;
      setTimeout(() => {
        if (this._closing) return;
        if (wasHost) this._rehost(code, max);
        else this.join(code);
        this._serverRetries = retries;
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

  _rehost(code, maxPlayers) {
    this._closing = false;
    this.isHost = true;
    this.code = code;
    this.maxPlayers = maxPlayers;
    this._makePeer(ID_PREFIX + code);
    this.peer.on('open', (id) => { this._diag(`re-registered (${id})`); this.onOpen?.(); });
    this.peer.on('connection', (conn) => this._acceptPeer(conn));
  }

  destroy() {
    this._closing = true;
    this._serverRetries = 0;
    clearTimeout(this._connectTimer);
    for (const e of this.conns.values()) {
      try { e.conn.close(); } catch { /* closed */ }
    }
    this.conns.clear();
    try { this.hostConn?.close(); } catch { /* closed */ }
    try { this.peer?.destroy(); } catch { /* destroyed */ }
    this.hostConn = null;
    this.peer = null;
    this.code = null;
  }
}
