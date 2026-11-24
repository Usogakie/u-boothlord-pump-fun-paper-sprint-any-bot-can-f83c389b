// Dip-buy sniper for agent-fun/replay/v2: buy a new curve once at 0.01 SOL
// after it pumps >=15% off create then retraces >=30% off its peak (real
// reserve 2-5 SOL, first trade >=1 SOL, within 600 slots). Exit +30%/-5%,
// trailing -8% off a +10% peak, or age >200 slots. Deterministic.
import { createInterface } from "node:readline";
const B = 10000n, SZ = 10000000n, LO = 2000000000n, HI = 5000000000n, FT = 1000000000n;
const I = (x: any) => BigInt(x);
let H: any, cash = 0n, cid = 0;
const C = new Map, S = new Map, P = new Map, held = new Map, pend = new Map;
const bought = new Set, bp = new Set, sp = new Set;
const cmp = (a: bigint, b: bigint, c: bigint, d: bigint, x: number) => {
  const l = a * d * B, r = c * b * (B + BigInt(x));
  return l > r ? 1 : l < r ? -1 : 0;
};
const tf = () => I(H.fees.base_fee_lamports) + I(H.fees.priority_fee_lamports);
const fc = () => {
  let f = cash;
  for (const p of pend.values()) { f -= tf(); if (p.side === "buy") f -= I(p.amount); }
  return f;
};
function onB(b: any) {
  const o: any[] = [], slot = b.slot;
  for (const f of b.fills) {
    const p = pend.get(f.client_id);
    if (!p) continue;
    pend.delete(f.client_id);
    if (p.side === "buy") { bp.delete(p.mint); if (f.status === "filled") bought.add(p.mint); }
    else sp.delete(p.mint);
  }
  cash = I(b.account.cash_lamports);
  P.clear();
  for (const p of b.account.positions) P.set(p.mint, { t: I(p.token_amount), c: I(p.cost_lamports) });
  for (const e of b.events) {
    if (e.event === "CompleteEvent") { const cu = C.get(e.mint); if (cu) cu.d = true; continue; }
    let cu = C.get(e.mint);
    if (!cu) { cu = { q: 0n, w: 0n, r: 0n, t: 0n, d: false }; C.set(e.mint, cu); }
    cu.q = I(e.virtual_quote_reserves); cu.w = I(e.virtual_token_reserves);
    if (e.event === "CreateEvent") {
      cu.r = 0n; cu.t = I(e.real_token_reserves);
      if (!S.has(e.mint)) S.set(e.mint, { s: e.slot, a: cu.q, b: cu.w, f: 0n, p: cu.q, o: cu.w });
    } else {
      cu.r = I(e.real_quote_reserves); cu.t = I(e.real_token_reserves);
      const s = S.get(e.mint);
      if (!s) S.set(e.mint, { s: e.slot, a: cu.q, b: cu.w, f: I(e.sol_amount), p: cu.q, o: cu.w });
      else {
        if (!s.f) s.f = I(e.sol_amount);
        if (cu.q * s.o > s.p * cu.w) { s.p = cu.q; s.o = cu.w; }
      }
    }
  }
  for (const [m, p] of P) {
    const cu = C.get(m);
    if (!cu || cu.d || sp.has(m)) continue;
    let h = held.get(m);
    if (!h) { h = { e: slot, p: p.c, o: p.t }; held.set(m, h); }
    if (cu.q * h.o > h.p * cu.w) { h.p = cu.q; h.o = cu.w; }
    const x = cmp(cu.q, cu.w, p.c, p.t, 3000) >= 0 || cmp(cu.q, cu.w, p.c, p.t, -500) <= 0 ||
      (cmp(h.p, h.o, p.c, p.t, 1000) >= 0 && cmp(cu.q, cu.w, h.p, h.o, -800) <= 0) || slot - h.e > 200;
    if (x) {
      o.push({ side: "sell", client_id: "o" + ++cid, mint: m, token_amount: p.t.toString(), max_slippage_bps: 500 });
      sp.add(m);
    }
  }
  let k = new Set([...P.keys(), ...bp]).size;
  if (k < 5) for (const e of b.events) {
    if (e.event === "CompleteEvent") continue;
    const m = e.mint;
    if (bought.has(m) || bp.has(m) || P.has(m)) continue;
    const s = S.get(m);
    if (!s || slot - s.s > 600) continue;
    const cu = C.get(m);
    if (!cu || cu.d || cu.r < LO || cu.r > HI || s.f < FT) continue;
    if (cmp(s.p, s.o, s.a, s.b, 1500) < 0) continue;
    if (cmp(cu.q, cu.w, s.p, s.o, -3000) > 0) continue;
    if (SZ > fc() - tf()) continue;
    o.push({ side: "buy", client_id: "o" + ++cid, mint: m, quote_lamports: SZ.toString(), max_slippage_bps: 500 });
    bp.add(m);
    if (++k >= 5) break;
  }
  for (const r of o) pend.set(r.client_id, { mint: r.mint, side: r.side, amount: r.side === "buy" ? r.quote_lamports : "0" });
  return o;
}
const rl = createInterface({ input: process.stdin });
rl.on("line", (l) => {
  const m = JSON.parse(l);
  if (m.type === "hello") { H = m; cash = I(m.capital.lamports); }
  else if (m.type === "batch") process.stdout.write(JSON.stringify({ type: "reply", seq: m.seq, orders: onB(m) }) + "\n");
  else if (m.type === "done") process.exit(0);
});
