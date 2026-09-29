// Headless bot that joins the server and exercises the protocol, including garbage input.
// Usage: node tests/e2e/bot.mjs [ws-url] [name]
import WebSocket from 'ws';
import { WS, sleep, suite, uniqueName } from './lib.mjs';
const url = process.argv[2] || WS;
const name = process.argv[3] || uniqueName('Bot');
const { check, finish } = suite('bot');

const ws = new WebSocket(url);
ws.binaryType = 'arraybuffer';
const got = [];
let welcome = null;
ws.on('message', (data, isBinary) => {
  if (isBinary) { got.push({ t: 'snap-bin', n: new DataView(data.buffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data).getUint16(1) }); return; }
  const m = JSON.parse(data.toString());
  got.push(m);
  if (m.t === 'welcome') welcome = m;
});
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
ws.send(JSON.stringify({ t: 'hello', v: 1, name, look: { skin: '#ffcc99' } }));
await sleep(1500);
check('welcome received', !!welcome, welcome ? `seed=${welcome.seed} eid=${welcome.eid} pos=${welcome.you.x.toFixed(1)},${welcome.you.y},${welcome.you.z.toFixed(1)}` : '');
if (!welcome) { ws.close(); finish(); process.exit(); }
const you = welcome.you;

// garbage must be ignored, not crash
ws.send('not json {{{');
ws.send(Buffer.from([9, 9, 9]));
ws.send(JSON.stringify({ t: 'dig', x: 'a', y: null }));
ws.send(JSON.stringify({ t: 'inv', action: { a: 'click', slot: 99999, button: 0 } }));
ws.send(JSON.stringify({ t: 'place', x: 1e9, y: 5, z: 0, facing: 'x' }));

// dig the block under our feet (hand, dirt/grass ~0.9s)
const bx = Math.floor(you.x), by = Math.floor(you.y) - 1, bz = Math.floor(you.z);
await sleep(1000);
ws.send(JSON.stringify({ t: 'dig', x: bx, y: by, z: bz }));
await sleep(500);
const blocks = got.filter(m => m.t === 'blocks').flatMap(m => m.list);
check('dig broadcast', blocks.length >= 5 && blocks[3] === 0, JSON.stringify(blocks.slice(0, 10)));
await sleep(1500);
const inv = [...got].reverse().find(m => m.t === 'inv');
const count = inv ? inv.inv.slots.filter(Boolean).reduce((a, s) => a + s.count, 0) : 0;
check('drop picked up into inventory', count >= 1, inv ? JSON.stringify(inv.inv.slots.filter(Boolean)) : 'no inv msg');

// an out-of-reach dig is refused with the real block (a predicted hole must be undone, not left as a ghost)
const far = { x: bx + 8, y: by, z: bz };
const n0 = got.length;
ws.send(JSON.stringify({ t: 'dig', ...far }));
await sleep(400);
const reply = got.slice(n0).filter(m => m.t === 'blocks').flatMap(m => m.list);
check('out-of-reach dig answered with the real block', reply[0] === far.x && reply[1] === far.y && reply[2] === far.z && Number.isInteger(reply[3]), JSON.stringify(reply.slice(0, 5)));

// speed hack is corrected
ws.send(JSON.stringify({ t: 'move', x: you.x + 500, y: you.y, z: you.z, yaw: 0, pitch: 0, flags: 1 }));
await sleep(300);
check('teleport hack corrected', got.some(m => m.t === 'pos'));

// chat
ws.send(JSON.stringify({ t: 'chat', text: 'hello world' }));
await sleep(300);
check('chat echoed', got.some(m => m.t === 'chat' && m.text === 'hello world'));
check('snapshots/spawns flowing', got.some(m => m.t === 'spawn' || m.t === 'snap-bin'), got.filter(m => m.t === 'spawn').length + ' spawn msgs');
ws.close();
await sleep(200);
finish();
