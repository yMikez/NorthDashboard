/* global */
/* Mock data seed — 90 days of DR nutra operation.
   Deterministic (seeded PRNG) so reloads show stable data. */

(function () {
  // Mulberry32 PRNG
  function mulberry32(seed) {
    return function () {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = mulberry32(42);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const weighted = (arr) => {
    const tot = arr.reduce((s, [, w]) => s + w, 0);
    let r = rand() * tot;
    for (const [v, w] of arr) { r -= w; if (r <= 0) return v; }
    return arr[0][0];
  };

  // ---------- dimensions ----------
  const COUNTRIES = [
    { code: 'US', name: 'United States', weight: 46 },
    { code: 'CA', name: 'Canada',        weight: 14 },
    { code: 'UK', name: 'United Kingdom', weight: 13 },
    { code: 'AU', name: 'Australia',      weight: 11 },
    { code: 'DE', name: 'Germany',        weight: 7  },
    { code: 'NZ', name: 'New Zealand',    weight: 4  },
    { code: 'IE', name: 'Ireland',        weight: 3  },
    { code: 'NL', name: 'Netherlands',    weight: 2  },
  ];
  const PLATFORMS = [
    { id: 'digistore24', name: 'Digistore24', weight: 55, class: 'plat-d24' },
    { id: 'clickbank',   name: 'ClickBank',   weight: 45, class: 'plat-cb'  },
  ];
  const PAYMENT_METHODS = [
    ['Visa', 42], ['Mastercard', 28], ['Amex', 9],
    ['PayPal', 14], ['Discover', 4], ['Apple Pay', 3]
  ];
  const TRAFFIC = [
    ['Facebook', 34], ['YouTube', 22], ['Google', 16],
    ['Native',  12], ['TikTok', 9], ['Email', 5], ['Other', 2]
  ];
  const STATUSES = [
    ['approved',  81], ['pending', 6], ['refunded', 10], ['chargeback', 3]
  ];

  // ---------- products / offers ----------
  const PRODUCTS = [
    { id: 'fx-60',  name: 'FocusRx · 60ct',    sku: 'NS-FX60',  price: 79,  type: 'frontend', funnel: 'fx' },
    { id: 'fx-up1', name: 'FocusRx · 3-pack',  sku: 'NS-FX3P',  price: 197, type: 'upsell',   funnel: 'fx' },
    { id: 'fx-up2', name: 'FocusRx · 6-pack',  sku: 'NS-FX6P',  price: 347, type: 'upsell',   funnel: 'fx' },
    { id: 'fx-dn',  name: 'FocusRx · Sample',  sku: 'NS-FXSM',  price: 39,  type: 'downsell', funnel: 'fx' },
    { id: 'fx-bp',  name: 'Boost · Order Bump',sku: 'NS-FXBP',  price: 19,  type: 'bump',     funnel: 'fx' },

    { id: 'sx-60',  name: 'SleepCore · 60ct',  sku: 'NS-SX60',  price: 69,  type: 'frontend', funnel: 'sx' },
    { id: 'sx-up1', name: 'SleepCore · 3-pack',sku: 'NS-SX3P',  price: 177, type: 'upsell',   funnel: 'sx' },
    { id: 'sx-up2', name: 'SleepCore · 6-pack',sku: 'NS-SX6P',  price: 317, type: 'upsell',   funnel: 'sx' },
    { id: 'sx-bp',  name: 'Melatonin · Bump',  sku: 'NS-SXBP',  price: 17,  type: 'bump',     funnel: 'sx' },

    { id: 'mx-60',  name: 'MetaLean · 60ct',   sku: 'NS-MX60',  price: 89,  type: 'frontend', funnel: 'mx' },
    { id: 'mx-up1', name: 'MetaLean · 3-pack', sku: 'NS-MX3P',  price: 217, type: 'upsell',   funnel: 'mx' },
    { id: 'mx-up2', name: 'MetaLean · 6-pack', sku: 'NS-MX6P',  price: 377, type: 'upsell',   funnel: 'mx' },
    { id: 'mx-dn',  name: 'MetaLean · Sample', sku: 'NS-MXSM',  price: 49,  type: 'downsell', funnel: 'mx' },
    { id: 'mx-bp',  name: 'Thermo · Bump',     sku: 'NS-MXBP',  price: 23,  type: 'bump',     funnel: 'mx' },
  ];

  // ---------- affiliates ----------
  const AFF_FIRST = ['Marcus','Elena','Kai','Sierra','Jonas','Priya','Dmitri','Noa','Ren','Otis','Iris','Thalia','Leo','Vera','Amelia','Finn','Hugo','Mila','Ezra','Yara'];
  const AFF_LAST  = ['Valdez','Cruz','Nakamura','Rowe','Keller','Shah','Volkov','Halim','Okafor','Byrne'];
  const NICKS = ['perf-max','roas-king','dailyscale','native-wolf','ctr-bandit','yt-spend','tiktok-lab','fb-ops','affilab','nativegrid','pixel-bros','adops.co','scale-lane','fastfunnel','mediabuy.io','rampup','topfeed','offers.cc','cpa-jet','flux-traffic'];

  const affiliates = [];
  const NUM_AFFILIATES = 34;
  for (let i = 0; i < NUM_AFFILIATES; i++) {
    const first = AFF_FIRST[i % AFF_FIRST.length];
    const last = AFF_LAST[(i * 3) % AFF_LAST.length];
    const nick = NICKS[i % NICKS.length] + (i < NICKS.length ? '' : String(i + 1).padStart(2,'0'));
    const archetype = weighted([
      ['hero', 8],     // high volume, high approval, low refund
      ['solid', 12],   // steady
      ['average', 8],  // middling
      ['risky', 4],    // high refund/chargeback
      ['burner', 2],   // terrible
    ]);
    const tierWeight = {
      hero: 3.2, solid: 1.6, average: 1.0, risky: 0.55, burner: 0.2
    }[archetype];
    const approvalBase = { hero: 0.82, solid: 0.74, average: 0.64, risky: 0.48, burner: 0.32 }[archetype];
    const refundBase   = { hero: 0.04, solid: 0.06, average: 0.09, risky: 0.15, burner: 0.22 }[archetype];
    const cbBase       = { hero: 0.003, solid: 0.006, average: 0.009, risky: 0.018, burner: 0.028 }[archetype];
    affiliates.push({
      id: 'AF' + String(7000 + i * 17).slice(-4),
      name: `${first} ${last}`,
      nickname: nick,
      platform: weighted([['digistore24', 1.2], ['clickbank', 1]]),
      archetype,
      tierWeight,
      approvalBase,
      refundBase,
      cbBase,
      topCountry: pick(COUNTRIES).code,
      topTraffic: weighted(TRAFFIC),
      cpaRate: 0.55 + rand() * 0.15, // 55-70% of gross
      joinedDaysAgo: Math.floor(20 + rand() * 400),
    });
  }

  // ---------- time series ----------
  const TODAY = new Date('2026-04-23T12:00:00Z');
  const DAYS = 90;
  const startDate = new Date(TODAY.getTime() - DAYS * 24 * 3600 * 1000);

  // daily volume curve: base + growth trend + weekend bump + weekly seasonality + noise
  function volumeForDay(dayIdx /* 0..89 */) {
    const date = new Date(startDate.getTime() + dayIdx * 24 * 3600 * 1000);
    const dow = date.getUTCDay(); // 0=Sun
    const weekendBump = (dow === 0 || dow === 6) ? 1.18 : 1.0;
    const trend = 1 + dayIdx * 0.004; // ~40% growth over 90d
    const weekly = 1 + 0.08 * Math.sin((dayIdx / 7) * Math.PI * 2);
    const shock = dayIdx === 52 ? 0.6 : (dayIdx === 68 ? 1.35 : 1); // VSL change, promo spike
    const noise = 0.88 + rand() * 0.24;
    return 220 * trend * weekendBump * weekly * shock * noise;
  }

  // Generate orders
  const orders = [];
  let orderIdx = 0;
  for (let d = 0; d < DAYS; d++) {
    const vol = volumeForDay(d);
    const nOrders = Math.round(vol);
    const dayDate = new Date(startDate.getTime() + d * 24 * 3600 * 1000);
    for (let i = 0; i < nOrders; i++) {
      // Choose a checkout: initiated -> maybe completed -> maybe upsells
      // For the purposes of the dataset, we emit approved/pending/refund/chargeback
      const aff = weighted(affiliates.map(a => [a, a.tierWeight]));
      const funnel = weighted([['fx', 3], ['sx', 2], ['mx', 1.6]]);
      const fe = PRODUCTS.find(p => p.funnel === funnel && p.type === 'frontend');
      const platform = aff.platform;
      const country = weighted(COUNTRIES.map(c => [c.code, c.weight]));
      const paymentMethod = weighted(PAYMENT_METHODS);
      const trafficSource = aff.topTraffic;

      const approvalProb = Math.min(0.96, aff.approvalBase + (weekendBump(dayDate) ? 0 : 0));
      // Status distribution modulated by archetype
      const statusRoll = rand();
      let status;
      if (statusRoll < approvalProb) status = 'approved';
      else if (statusRoll < approvalProb + aff.refundBase) status = 'refunded';
      else if (statusRoll < approvalProb + aff.refundBase + aff.cbBase) status = 'chargeback';
      else status = 'pending';

      // For approved, consider upsells
      const takesUp1 = status === 'approved' && rand() < 0.33;
      const takesUp2 = takesUp1 && rand() < 0.18;
      const takesBump = status === 'approved' && rand() < 0.24;
      const takesDown = (status !== 'approved') && rand() < 0.06; // small downsell save

      const orderGroupId = 'ORD-' + String(10000 + orderIdx).padStart(6,'0');

      // Emit FE line
      const baseOrder = {
        id: orderGroupId + '-00',
        orderGroup: orderGroupId,
        platform,
        productId: fe.id,
        productType: 'frontend',
        affiliateId: aff.id,
        country,
        currency: 'USD',
        grossAmount: fe.price,
        netAmount: status === 'approved' ? fe.price * 0.92 : (status === 'refunded' ? -fe.price * 0.5 : 0),
        fees: fe.price * 0.08,
        cpaPaid: status === 'approved' ? fe.price * aff.cpaRate : 0,
        status,
        paymentMethod,
        createdAt: new Date(dayDate.getTime() + Math.floor(rand() * 24 * 3600 * 1000)).toISOString(),
        trafficSource,
      };
      orders.push(baseOrder);
      orderIdx++;

      if (takesBump) {
        const bump = PRODUCTS.find(p => p.funnel === funnel && p.type === 'bump');
        if (bump) orders.push({
          ...baseOrder,
          id: orderGroupId + '-01',
          productId: bump.id, productType: 'bump',
          grossAmount: bump.price,
          netAmount: status === 'approved' ? bump.price * 0.92 : 0,
          fees: bump.price * 0.08,
          cpaPaid: status === 'approved' ? bump.price * aff.cpaRate : 0,
        });
      }
      if (takesUp1) {
        const up1 = PRODUCTS.find(p => p.funnel === funnel && p.id.endsWith('up1'));
        if (up1) orders.push({
          ...baseOrder,
          id: orderGroupId + '-02',
          productId: up1.id, productType: 'upsell',
          grossAmount: up1.price,
          netAmount: up1.price * 0.92,
          fees: up1.price * 0.08,
          cpaPaid: up1.price * aff.cpaRate * 0.8,
        });
      }
      if (takesUp2) {
        const up2 = PRODUCTS.find(p => p.funnel === funnel && p.id.endsWith('up2'));
        if (up2) orders.push({
          ...baseOrder,
          id: orderGroupId + '-03',
          productId: up2.id, productType: 'upsell',
          grossAmount: up2.price,
          netAmount: up2.price * 0.92,
          fees: up2.price * 0.08,
          cpaPaid: up2.price * aff.cpaRate * 0.7,
        });
      }
      if (takesDown) {
        const dn = PRODUCTS.find(p => p.funnel === funnel && p.type === 'downsell');
        if (dn) orders.push({
          ...baseOrder,
          id: orderGroupId + '-04',
          productId: dn.id, productType: 'downsell',
          status: 'approved',
          grossAmount: dn.price,
          netAmount: dn.price * 0.92,
          fees: dn.price * 0.08,
          cpaPaid: dn.price * aff.cpaRate,
        });
      }
    }
  }

  function weekendBump(d) {
    const dow = d.getUTCDay();
    return dow === 0 || dow === 6;
  }

  // Funnel event counts (for Funnel Analytics) — align roughly with order data
  function funnelEventsForRange(dayFrom, dayTo, funnel) {
    // volumes shrink by stage
    let landing = 0, vsl = 0, checkInit = 0, checkDone = 0, approved = 0, up1Shown = 0, up1Acc = 0, up2Shown = 0, up2Acc = 0;
    for (let d = dayFrom; d <= dayTo; d++) {
      const vol = volumeForDay(d);
      const funnelShare = funnel === 'fx' ? 0.48 : funnel === 'sx' ? 0.32 : 0.20;
      const lps = Math.round(vol / funnelShare * 14); // landing views per order-seed
      landing += lps;
      vsl += Math.round(lps * 0.68);
      checkInit += Math.round(lps * 0.14);
      checkDone += Math.round(lps * 0.102);
      approved += Math.round(lps * 0.083);
      up1Shown += Math.round(lps * 0.083);
      up1Acc += Math.round(lps * 0.031);
      up2Shown += Math.round(lps * 0.031);
      up2Acc += Math.round(lps * 0.009);
    }
    return { landing, vsl, checkInit, checkDone, approved, up1Shown, up1Acc, up2Shown, up2Acc };
  }

  // ---------- public API ----------
  window.MOCK = {
    TODAY,
    startDate,
    DAYS,
    COUNTRIES,
    PLATFORMS,
    PAYMENT_METHODS,
    TRAFFIC,
    PRODUCTS,
    affiliates,
    orders,
    volumeForDay,
    funnelEventsForRange,
  };
})();
