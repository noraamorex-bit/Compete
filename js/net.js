// P2P networking via PeerJS (global `Peer` from lib/peerjs.min.js).
// Host claims a short match code; the joiner dials it directly.
// STUN + free TURN relays so NATed devices (phones on cellular, strict
// routers) can still connect — without TURN, ICE dies after ~15s.

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusables
const ID_PREFIX = 'voltage-duel-';
const CONNECT_TIMEOUT_MS = 20000;

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // Open Relay Project — free public TURN (openrelay.metered.ca).
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turns:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

function makeCode() {
  let c = '';
  for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

// Optional self-hosted PeerServer override (also used by tests):
// localStorage.setItem('voltage.peerhost', JSON.stringify({host:'127.0.0.1',port:9000,path:'/'}))
function peerOptions() {
  const base = { config: { iceServers: ICE_SERVERS } };
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
    this._closing = false;
    this._connectTimer = null;
  }

  get connected() { return !!this.conn && this.conn.open; }

  host() {
    this.destroy();
    this._closing = false;
    this.isHost = true;
    this.code = makeCode();
    this.peer = new Peer(ID_PREFIX + this.code, peerOptions());
    this.peer.on('open', () => this.onOpen?.());
    this.peer.on('disconnected', () => { if (!this._closing) this.peer?.reconnect(); });
    this.peer.on('connection', (conn) => {
      // 1v1 only — but let a fresh attempt replace a stale, never-opened one.
      if (this.conn && this.conn.open) { conn.close(); return; }
      this._wire(conn);
    });
    this.peer.on('error', (e) => this._error(e));
    return this.code;
  }

  join(code) {
    this.destroy();
    this._closing = false;
    this.isHost = false;
    this.code = code.toUpperCase().trim();
    this.peer = new Peer(peerOptions());
    this.peer.on('open', () => {
      const conn = this.peer.connect(ID_PREFIX + this.code, { reliable: true });
      this._wire(conn);
      // If the data channel never opens (NAT/ICE dead end), say so.
      this._connectTimer = setTimeout(() => {
        if (!this.connected && !this._closing) {
          this._fail('CONNECTION TIMED OUT — BOTH RETRY, OR SWITCH NETWORKS');
        }
      }, CONNECT_TIMEOUT_MS);
    });
    this.peer.on('disconnected', () => { if (!this._closing) this.peer?.reconnect(); });
    this.peer.on('error', (e) => this._error(e));
  }

  _wire(conn) {
    this.conn = conn;
    conn.on('open', () => {
      clearTimeout(this._connectTimer);
      this.onConnected?.();
    });
    conn.on('data', (d) => this.onMessage?.(d));
    conn.on('close', () => { if (!this._closing) this.onClosed?.(); });
    conn.on('error', (e) => this._error(e));
    conn.on('iceStateChanged', (state) => {
      if (this._closing) return;
      if (state === 'failed') {
        this._fail(this.connected
          ? 'CONNECTION LOST'
          : 'P2P BLOCKED BY NETWORK — TRY A DIFFERENT WI-FI/HOTSPOT');
      }
    });
  }

  _fail(msg) {
    clearTimeout(this._connectTimer);
    this.onError?.(msg, 'ice');
  }

  _error(e) {
    if (this._closing) return;
    const type = e?.type || '';
    let msg = 'CONNECTION ERROR — TRY AGAIN';
    if (type === 'peer-unavailable') msg = 'MATCH CODE NOT FOUND';
    else if (type === 'unavailable-id') msg = 'CODE COLLISION — CREATE AGAIN';
    else if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') {
      msg = 'MATCH SERVER UNREACHABLE — RETRY IN A MOMENT';
    }
    clearTimeout(this._connectTimer);
    this.onError?.(msg, type);
  }

  send(obj) {
    if (this.connected) this.conn.send(obj);
  }

  destroy() {
    this._closing = true;
    clearTimeout(this._connectTimer);
    try { this.conn?.close(); } catch { /* already closed */ }
    try { this.peer?.destroy(); } catch { /* already destroyed */ }
    this.conn = null;
    this.peer = null;
    this.code = null;
  }
}
