// P2P networking via PeerJS (global `Peer` from lib/peerjs.min.js).
// Host claims a short match code; the joiner dials it directly.

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusables
const ID_PREFIX = 'voltage-duel-';

function makeCode() {
  let c = '';
  for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

// Optional local/self-hosted PeerServer override (used by tests):
// localStorage.setItem('voltage.peerhost', JSON.stringify({host:'127.0.0.1',port:9000,path:'/'}))
function peerOptions() {
  try {
    const o = JSON.parse(localStorage.getItem('voltage.peerhost') || 'null');
    if (o && o.host) return { ...o, secure: o.secure ?? false };
  } catch { /* fall through to PeerJS cloud */ }
  return {};
}

export class Net {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.isHost = false;
    this.code = null;
    this.onMessage = null;      // cb(obj)
    this.onConnected = null;
    this.onClosed = null;       // peer left / connection lost
    this.onError = null;        // cb(text)
    this._closing = false;
  }

  get connected() { return !!this.conn && this.conn.open; }

  host() {
    this.destroy();
    this._closing = false;
    this.isHost = true;
    this.code = makeCode();
    this.peer = new Peer(ID_PREFIX + this.code, peerOptions());
    this.peer.on('open', () => { /* code is live; UI already shows it */ });
    this.peer.on('connection', (conn) => {
      if (this.conn) { conn.close(); return; } // 1v1 only
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
    });
    this.peer.on('error', (e) => this._error(e));
  }

  _wire(conn) {
    this.conn = conn;
    conn.on('open', () => this.onConnected?.());
    conn.on('data', (d) => this.onMessage?.(d));
    conn.on('close', () => { if (!this._closing) this.onClosed?.(); });
    conn.on('error', (e) => this._error(e));
  }

  _error(e) {
    if (this._closing) return;
    const type = e?.type || '';
    let msg = 'CONNECTION ERROR';
    if (type === 'peer-unavailable') msg = 'MATCH CODE NOT FOUND';
    else if (type === 'unavailable-id') msg = 'CODE COLLISION — TRY AGAIN';
    else if (type === 'network' || type === 'server-error' || type === 'socket-error') msg = 'CANNOT REACH MATCH SERVER';
    this.onError?.(msg, type);
  }

  send(obj) {
    if (this.connected) this.conn.send(obj);
  }

  destroy() {
    this._closing = true;
    try { this.conn?.close(); } catch { /* already closed */ }
    try { this.peer?.destroy(); } catch { /* already destroyed */ }
    this.conn = null;
    this.peer = null;
    this.code = null;
  }
}
