/* ========================================================================
   Regional Hospital Stroke Capabilities — core logic
   ------------------------------------------------------------------------
   Pure functions with no DOM or Leaflet access, shared by app.js in the
   browser and by the unit tests in tests/unit under Node. Loaded as a classic
   script: it defines `StrokeCore` on the global object, or module.exports
   under CommonJS.

   Everything here is about representing what is and is not known:
   - distances are straight-line (great-circle) miles, never road routes;
   - transport minutes are illustrative scenarios with stated assumptions;
   - a missing value is `null`, never 0, and 0 means "on site";
   - an unassessed hospital is never scored as if a gap were verified.
   ======================================================================== */

(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StrokeCore = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EARTH_RADIUS_MI = 3958.8;

  // ------------------------------------------------------------------
  // Vocabularies
  // ------------------------------------------------------------------
  const TIERS = ['CSC', 'TSC', 'PSC', 'ASR'];
  const TIER_NAMES = {
    CSC: 'Comprehensive Stroke Center',
    TSC: 'Thrombectomy-Capable Stroke Center',
    PSC: 'Primary Stroke Center',
    ASR: 'Acute Stroke Ready',
  };
  const CLAIM_STATES = ['affirmative', 'negative', 'no-record-found', 'unknown', 'conflicting', 'not-applicable'];
  const CLAIM_LABELS = {
    affirmative: 'Documented',
    negative: 'Verified absent (within stated scope)',
    'no-record-found': 'No record found in reviewed sources',
    unknown: 'Not assessed',
    conflicting: 'Conflicting evidence',
    'not-applicable': 'Not applicable',
  };

  // Display crosswalk from a state designation onto the national tier ladder.
  // It exists only so a state-designated site can be drawn and filtered with a
  // comparable colour; it is NOT an equivalence of accreditation, and every
  // surface that shows a crosswalked tier also says it rests on a state level.
  const STATE_CROSSWALK = {
    'WA ECS': { I: 'CSC', II: 'PSC', III: 'ASR' },
    'Idaho TSE': { I: 'CSC', 'II+': 'TSC', II: 'PSC', III: 'ASR' },
  };

  // ------------------------------------------------------------------
  // Formatting: 0 is a real value (on site); null is unknown.
  // ------------------------------------------------------------------
  function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }

  function formatMiles(mi) {
    if (!isNum(mi) || mi < 0) return '—';
    if (mi === 0) return '0';
    if (mi < 10) return mi.toFixed(1);
    return String(Math.round(mi));
  }

  // Registry addresses arrive in capitals ("915 ANDERSON DR"). Title-case them
  // for reading, keeping directionals, ordinals, PO and route codes as written.
  const STREET_UPPER = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'PO', 'US', 'SR', 'MT', 'II', 'III']);
  function formatStreet(s) {
    if (typeof s !== 'string' || !s.trim()) return '';
    if (/[a-z]/.test(s)) return s.trim();
    return s.trim().split(/\s+/).map(w => {
      if (STREET_UPPER.has(w.replace(/[.,]/g, ''))) return w;
      if (/^\d+(ST|ND|RD|TH)$/.test(w)) return w.toLowerCase();
      if (/^\d/.test(w)) return w;
      return w.split('-').map(p => p.charAt(0) + p.slice(1).toLowerCase()).join('-');
    }).join(' ');
  }

  function formatMinutes(min) {
    if (!isNum(min) || min < 0) return '—';
    return String(Math.round(min));
  }

  function formatSignedMiles(mi) {
    if (!isNum(mi)) return '—';
    if (Math.abs(mi) < 0.05) return '0';
    const abs = Math.abs(mi);
    const body = abs < 10 ? abs.toFixed(1) : String(Math.round(abs));
    return (mi > 0 ? '+' : '−') + body;
  }

  // ------------------------------------------------------------------
  // Geometry
  // ------------------------------------------------------------------
  function haversineMi(lat1, lon1, lat2, lon2) {
    if (![lat1, lon1, lat2, lon2].every(isNum)) return null;
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLon = (lon2 - lon1) * toRad;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
    return EARTH_RADIUS_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function locationOf(h) {
    const loc = h && h.location;
    if (!loc || !isNum(loc.lat) || !isNum(loc.lng)) return null;
    if (loc.lat < -90 || loc.lat > 90 || loc.lng < -180 || loc.lng > 180) return null;
    return loc;
  }

  function distanceBetween(a, b) {
    const la = locationOf(a);
    const lb = locationOf(b);
    if (!la || !lb) return null;
    if (a.id === b.id) return 0;
    return haversineMi(la.lat, la.lng, lb.lat, lb.lng);
  }

  // ------------------------------------------------------------------
  // Record semantics
  // ------------------------------------------------------------------
  function claimState(claim) {
    return claim && CLAIM_STATES.includes(claim.state) ? claim.state : 'unknown';
  }

  function displayTier(h) {
    return (h && h.derived && TIERS.includes(h.derived.tier)) ? h.derived.tier : null;
  }

  function isEligible(h) {
    return !!(h && h.derived && h.derived.eligibility && h.derived.eligibility.value === 'eligible');
  }

  function isActive(h) {
    return !!(h && h.status && h.status.value === 'active');
  }

  function isExcluded(h) {
    return !!(h && h.derived && h.derived.eligibility && h.derived.eligibility.value === 'excluded');
  }

  // A destination must be an active, located campus that is not excluded
  // (closed, pediatric-only, or documented without a general ED). A documented
  // ED is required of a sending hospital in the analysis set, not of a
  // receiving center whose stroke credential is itself documented; the set's
  // own test (24/7 EVT, CSC/TSC level) does the rest. Out-of-region
  // neighbours are included only when the caller asks for them, so "nearest"
  // always names the set it searched.
  function canBeDestination(h) {
    return !!(h && locationOf(h) && isActive(h) && !isExcluded(h));
  }

  function hasDocumented247Evt(h) {
    return claimState(h && h.evt247) === 'affirmative';
  }

  function isAdvancedCenter(h) {
    const t = displayTier(h);
    return t === 'CSC' || t === 'TSC';
  }

  const DESTINATION_SETS = {
    evt247: {
      key: 'evt247',
      label: 'documented 24/7 EVT center',
      plural: 'documented 24/7 EVT centers',
      test: hasDocumented247Evt,
    },
    advanced: {
      key: 'advanced',
      label: 'CSC/TSC-level center',
      plural: 'CSC/TSC-level centers (national certification, or a state level shown on that tier)',
      test: isAdvancedCenter,
    },
  };

  function destinationSet(hospitals, key, opts) {
    const def = DESTINATION_SETS[key];
    const includeNeighbors = !opts || opts.includeNeighbors !== false;
    return hospitals.filter(h => canBeDestination(h) && def.test(h) && (includeNeighbors || !h.outOfRegion));
  }

  // Nearest member of `set` to `origin`. When the origin is itself in the set
  // the answer is "on site" with distance 0 — a real value, not a missing one.
  function nearestInSet(origin, set) {
    if (!locationOf(origin)) return { status: 'no-location', dest: null, miles: null };
    if (set.some(d => d.id === origin.id)) return { status: 'on-site', dest: origin, miles: 0 };
    let best = null;
    let bestMi = Infinity;
    for (const d of set) {
      const mi = distanceBetween(origin, d);
      if (mi == null) continue;
      if (mi < bestMi || (mi === bestMi && best && d.id < best.id)) { best = d; bestMi = mi; }
    }
    if (!best) return { status: 'no-destination', dest: null, miles: null };
    return { status: 'ok', dest: best, miles: bestMi };
  }

  // ------------------------------------------------------------------
  // Transport scenarios (illustrative; never dispatch or availability)
  // ------------------------------------------------------------------
  // Intervals, kept separate:
  //   DIDO     — sending ED arrival to departure. Transport activation and
  //              loading normally happen inside this window, so they are not
  //              added again on top of it.
  //   leg      — departure from the sending hospital to arrival at the
  //              receiving hospital, by mode.
  //   receiving-centre intervals (arrival to treatment) are not modelled.
  const TRANSPORT_DEFAULTS = {
    didoMin: 60,          // scenario input, not a benchmark or a measured value
    roadFactor: 1.25,     // straight-line to road-distance multiplier
    groundMph: 55,
    groundHandoffMin: 8,  // unload and handover at the receiving hospital
    rotorMph: 140,
    rotorHandoffMin: 15,  // lift-off, landing pad to ED, handover
    rotorMaxMi: 150,      // illustrative one-way range for the scenario
    fixedMph: 250,
    fixedGroundLegsMin: 40, // ambulance legs to and from the airports, combined
    fixedHandoffMin: 20,  // taxi, loading at the aircraft, handover
  };
  const TRANSPORT_RANGES = {
    didoMin: [0, 240, 5], roadFactor: [1, 2, 0.05], groundMph: [30, 70, 1],
    groundHandoffMin: [0, 60, 1], rotorMph: [90, 180, 5], rotorHandoffMin: [0, 60, 1],
    rotorMaxMi: [50, 300, 10], fixedMph: [150, 350, 10], fixedGroundLegsMin: [0, 180, 5],
    fixedHandoffMin: [0, 90, 5],
  };

  function roadNetworkOf(h) {
    const v = h && h.roadNetwork && h.roadNetwork.value;
    return typeof v === 'string' && v && v !== 'unknown' ? v : null;
  }

  // Ground transfer between two campuses is modelled only when both sit on the
  // same documented road network. A ferry crossing or an unknown network makes
  // the ground estimate unavailable rather than plausible-looking.
  function groundFeasibility(origin, dest) {
    if (origin && dest && origin.id === dest.id) return { status: 'on-site' };
    const a = roadNetworkOf(origin);
    const b = roadNetworkOf(dest);
    if (!a || !b) return { status: 'unknown', reason: 'Road connection not documented for ' + (!a ? 'the sending site' : 'the destination') };
    if (a !== b) return { status: 'not-connected', reason: 'No road connection between these sites in the network model (' + a + ' vs ' + b + ')' };
    return { status: 'feasible' };
  }

  function clampParam(key, v) {
    const r = TRANSPORT_RANGES[key];
    if (!r || !isNum(v)) return TRANSPORT_DEFAULTS[key];
    return Math.min(r[1], Math.max(r[0], v));
  }

  function transportParams(p) {
    const out = {};
    for (const k of Object.keys(TRANSPORT_DEFAULTS)) out[k] = clampParam(k, p && p[k] != null ? Number(p[k]) : TRANSPORT_DEFAULTS[k]);
    return out;
  }

  // Minutes for the transport leg by one mode, or null with a reason.
  function legScenario(mode, origin, dest, miles, params) {
    const p = transportParams(params);
    if (!isNum(miles)) return { mode, minutes: null, status: 'unavailable', reason: 'Distance unknown (no verified location)' };
    if (origin && dest && origin.id === dest.id) return { mode, minutes: 0, status: 'on-site', reason: 'Same campus — no interfacility transfer' };
    if (mode === 'ground') {
      const f = groundFeasibility(origin, dest);
      if (f.status !== 'feasible') return { mode, minutes: null, status: f.status, reason: f.reason };
      return { mode, minutes: (miles * p.roadFactor) / p.groundMph * 60 + p.groundHandoffMin, status: 'scenario' };
    }
    if (mode === 'rotor') {
      if (miles > p.rotorMaxMi) return { mode, minutes: null, status: 'out-of-range', reason: `Beyond the ${p.rotorMaxMi}-mi rotor-wing range set for this scenario` };
      return { mode, minutes: miles / p.rotorMph * 60 + p.rotorHandoffMin, status: 'scenario', reason: 'Assumes an aircraft and flyable weather; availability not modelled' };
    }
    if (mode === 'fixed') {
      return { mode, minutes: p.fixedGroundLegsMin + miles / p.fixedMph * 60 + p.fixedHandoffMin, status: 'scenario', reason: 'Assumes airport access at both ends; airports, aircraft and weather not assessed' };
    }
    return { mode, minutes: null, status: 'unavailable', reason: 'Unknown mode' };
  }

  // Which transfer modes the scenario model can describe for one pair, in
  // words. Shown beside the access review and kept out of its score: it is a
  // property of the network model and the scenario range, not of need.
  function transferFeasibility(origin, dest, miles, params) {
    const p = transportParams(params);
    if (!dest) return { ground: 'none', rotor: 'none', fixed: 'none', text: 'No destination in this set' };
    if (origin && origin.id === dest.id) return { ground: 'on-site', rotor: 'on-site', fixed: 'on-site', text: 'On site' };
    if (!isNum(miles)) return { ground: 'unknown', rotor: 'unknown', fixed: 'unknown', text: 'Distance unknown' };
    const g = groundFeasibility(origin, dest).status;
    const ground = g === 'feasible' ? 'road' : g;
    const rotor = miles > p.rotorMaxMi ? 'beyond-range' : 'within-range';
    const words = {
      road: 'ground on a documented road network', 'not-connected': 'no road connection in the network model', unknown: 'road connection unknown',
    };
    const text = `${words[ground] || ground}; rotor-wing ${rotor === 'within-range' ? 'within' : 'beyond'} the ${p.rotorMaxMi}-mi scenario range; fixed-wing airport access not assessed`;
    return { ground, rotor, fixed: 'not-assessed', text: text.charAt(0).toUpperCase() + text.slice(1) };
  }

  function transferScenario(origin, dest, miles, params) {
    const p = transportParams(params);
    return {
      didoMin: p.didoMin,
      endpoint: 'arrival at the receiving hospital',
      legs: ['ground', 'rotor', 'fixed'].map(m => legScenario(m, origin, dest, miles, p)),
    };
  }

  // ------------------------------------------------------------------
  // Access for one hospital: nearest of each destination set, plus hub.
  // ------------------------------------------------------------------
  function computeAccess(h, sets, hub) {
    const out = {
      evt247: nearestInSet(h, sets.evt247 || []),
      advanced: nearestInSet(h, sets.advanced || []),
      hub: null,
    };
    if (hub) {
      if (!locationOf(h) || !locationOf(hub)) out.hub = { status: 'no-location', dest: hub, miles: null };
      else if (hub.id === h.id) out.hub = { status: 'on-site', dest: hub, miles: 0 };
      else out.hub = { status: 'ok', dest: hub, miles: distanceBetween(h, hub) };
    }
    return out;
  }

  // Hub minus nearest documented 24/7 EVT centre, in the same units.
  // Minutes are compared only when both legs use the same mode and both are
  // modelled; otherwise the difference is unavailable and says why.
  function hubDifferential(h, access, params) {
    const hub = access.hub;
    const near = access.evt247;
    if (!hub) return { status: 'no-hub' };
    if (!isNum(hub.miles) || !isNum(near.miles)) {
      return { status: 'unavailable', reason: !isNum(hub.miles) ? 'Distance to the selected center is unknown' : 'No documented 24/7 EVT center distance', miles: null, minutes: [] };
    }
    const sameCenter = near.dest && hub.dest && near.dest.id === hub.dest.id;
    const milesDiff = hub.miles - near.miles;
    if (near.status === 'on-site' && !sameCenter) {
      // A transfer compared with no transfer is not a like-for-like scenario.
      const reason = 'Not compared: this campus is itself a documented 24/7 EVT center (no transfer)';
      return { status: 'ok', sameCenter: false, onSite: true, miles: milesDiff, hubMiles: hub.miles, nearestMiles: 0,
        minutes: ['ground', 'rotor', 'fixed'].map(mode => ({ mode, diff: null, reason })) };
    }
    const minutes = ['ground', 'rotor', 'fixed'].map(mode => {
      const a = legScenario(mode, h, hub.dest, hub.miles, params);
      const b = legScenario(mode, h, near.dest, near.miles, params);
      if (!isNum(a.minutes) || !isNum(b.minutes)) {
        return { mode, diff: null, reason: !isNum(a.minutes) ? `To selected center: ${a.reason}` : `To nearest EVT center: ${b.reason}` };
      }
      return { mode, diff: a.minutes - b.minutes, toHub: a.minutes, toNearest: b.minutes };
    });
    return { status: 'ok', sameCenter: !!sameCenter, miles: milesDiff, hubMiles: hub.miles, nearestMiles: near.miles, minutes };
  }

  // ------------------------------------------------------------------
  // Distance bins for analysis modes (shared by map, legend, exports)
  // ------------------------------------------------------------------
  const DISTANCE_BINS = [
    { key: 'on-site', label: 'On site (0 mi)', test: mi => mi === 0 },
    { key: 'lt50', label: 'Under 50 mi', test: mi => mi > 0 && mi < 50 },
    { key: '50-100', label: '50–100 mi', test: mi => mi >= 50 && mi < 100 },
    { key: '100-150', label: '100–150 mi', test: mi => mi >= 100 && mi < 150 },
    { key: '150plus', label: '150 mi or more', test: mi => mi >= 150 },
  ];
  // Takes a nearestInSet() result ({status, miles}) or a bare number. "On site"
  // means the same campus, not merely 0 mi: two campuses placed at one town
  // centre are 0 mi apart and still a transfer.
  function distanceBin(x) {
    if (x && typeof x === 'object') {
      if (x.status === 'on-site') return 'on-site';
      if (!isNum(x.miles)) return 'unknown';
      if (x.miles === 0) return 'lt50';
      return distanceBin(x.miles);
    }
    if (!isNum(x)) return 'unknown';
    const b = DISTANCE_BINS.find(d => d.test(x));
    return b ? b.key : 'unknown';
  }

  // ------------------------------------------------------------------
  // Access review (public-data scenario ranking)
  // ------------------------------------------------------------------
  const REVIEW_DEFAULTS = { wGap: 30, wEvt: 50, wAdv: 20, wHub: 0, capMi: 200, desertMi: 100 };
  const REVIEW_RANGES = { wGap: [0, 100, 5], wEvt: [0, 100, 5], wAdv: [0, 100, 5], wHub: [0, 100, 5], capMi: [50, 400, 25], desertMi: [25, 250, 5] };
  // Certification gap from *documented* evidence only. "None found" is the
  // reviewed-sources finding, labelled as such wherever it is shown.
  const GAP_VALUES = { none: 1, ASR: 0.65, PSC: 0.35 };

  function reviewParams(p) {
    const out = {};
    for (const k of Object.keys(REVIEW_DEFAULTS)) {
      const r = REVIEW_RANGES[k];
      const v = p && p[k] != null ? Number(p[k]) : REVIEW_DEFAULTS[k];
      out[k] = isNum(v) ? Math.min(r[1], Math.max(r[0], v)) : REVIEW_DEFAULTS[k];
    }
    return out;
  }

  function capabilityAssessed(h) {
    return !!(h && h.derived && h.derived.capability === 'assessed');
  }

  function gapComponent(h) {
    if (!capabilityAssessed(h)) return null;
    const t = displayTier(h);
    if (t === 'CSC' || t === 'TSC') return 0;
    return GAP_VALUES[t || 'none'];
  }

  function scoreOne(h, access, w) {
    const comps = [];
    const cap = w.capMi;
    const add = (key, weight, value, detail) => {
      if (weight <= 0) return;
      comps.push({ key, weight, value, detail });
    };
    const gap = gapComponent(h);
    add('gap', w.wGap, gap, gap == null ? 'capability not assessed' : null);
    const evtMi = access.evt247.miles;
    add('evt', w.wEvt, isNum(evtMi) ? Math.min(evtMi, cap) / cap : null, null);
    const advMi = access.advanced.miles;
    add('adv', w.wAdv, isNum(advMi) ? Math.min(advMi, cap) / cap : null, null);
    if (access.hub) {
      const hm = access.hub.miles;
      add('hub', w.wHub, isNum(hm) ? Math.min(hm, cap) / cap : null, null);
    }
    const usable = comps.filter(c => c.value != null);
    const wSum = usable.reduce((s, c) => s + c.weight, 0);
    if (wSum <= 0) return { score: null, comps };
    for (const c of usable) c.points = 100 * c.weight * c.value / wSum;
    return { score: usable.reduce((s, c) => s + c.points, 0), comps, missing: comps.filter(c => c.value == null).map(c => c.key) };
  }

  // Competition ranking ("1, 2, 2, 4") on scores rounded to 0.1, with a fully
  // deterministic order for display: score, then distance to EVT, then name, then id.
  function rankRows(rows) {
    // A row without a score (no usable weighted component) sorts after every
    // scored row, by miles to EVT.
    const key = r => (r.score == null ? -1 : Math.round(r.score * 10));
    rows.sort((a, b) => {
      const sa = key(a);
      const sb = key(b);
      if (sb !== sa) return sb - sa;
      const ea = isNum(a.evtMi) ? a.evtMi : -1;
      const eb = isNum(b.evtMi) ? b.evtMi : -1;
      if (eb !== ea) return eb - ea;
      return String(a.h.name).localeCompare(String(b.h.name)) || String(a.h.id).localeCompare(String(b.h.id));
    });
    let prev = null;
    rows.forEach((r, i) => {
      const s = r.score == null ? 'none:' + (isNum(r.evtMi) ? r.evtMi : 'x') + ':' + r.h.id : Math.round(r.score * 10);
      r.rank = (prev && prev.s === s) ? prev.rank : i + 1;
      r.tied = !!(prev && prev.s === s);
      if (r.tied) prev.row.tied = true;
      prev = { s, rank: r.rank, row: r };
    });
    return rows;
  }

  function isReviewCandidate(h) {
    if (!isEligible(h) || !locationOf(h) || h.outOfRegion) return false;
    if (hasDocumented247Evt(h) || isAdvancedCenter(h)) return false;
    return true;
  }

  // Returns { ranked, shortlist, error }. `ranked` holds candidates whose
  // capability evidence was assessed; `shortlist` holds eligible candidates
  // whose capability is unknown or conflicting, ordered by geography alone so
  // missing evidence never turns into a high-priority gap.
  // Membership of both lists is fixed by the evidence, never by the weights:
  // every candidate whose capability is not fully assessed is on the
  // verification shortlist, ordered by its geographic score when one can be
  // computed and otherwise by miles to the nearest documented 24/7 EVT center.
  function accessReview(hospitals, accessById, params, opts) {
    const w = reviewParams(params);
    const anyWeight = w.wGap + w.wEvt + w.wAdv + (opts && opts.hasHub ? w.wHub : 0) > 0;
    const ranked = [];
    const shortlist = [];
    for (const h of hospitals) {
      if (!isReviewCandidate(h)) continue;
      const access = accessById[h.id];
      if (!access) continue;
      const assessed = capabilityAssessed(h);
      const wUse = assessed ? w : Object.assign({}, w, { wGap: 0 });
      const s = scoreOne(h, access, wUse);
      const row = { h, access, score: s.score, comps: s.comps, missing: s.missing || [], evtMi: access.evt247.miles, advMi: access.advanced.miles };
      if (!assessed) shortlist.push(row);
      else if (anyWeight && s.score != null) ranked.push(row);
    }
    rankRows(ranked);
    rankRows(shortlist);
    return { ranked, shortlist, error: anyWeight ? null : 'all-weights-zero', params: w };
  }

  // Rank range across weight perturbations (each non-zero weight ×0.5 and
  // ×1.5 in turn): a candidate whose rank swings widely is sensitive to the
  // assumptions, and the table says so.
  function rankSensitivity(hospitals, accessById, params, opts) {
    const w = reviewParams(params);
    const keys = ['wGap', 'wEvt', 'wAdv'].concat(opts && opts.hasHub ? ['wHub'] : []).filter(k => w[k] > 0);
    const ranges = {};
    const base = accessReview(hospitals, accessById, w, opts);
    for (const r of base.ranked) ranges[r.h.id] = [r.rank, r.rank];
    for (const k of keys) {
      for (const f of [0.5, 1.5]) {
        // Raising one weight by half is the same, for a weighted mean, as
        // lowering every other weight to 2/3: this stays inside the slider range
        // where a direct ×1.5 at the maximum would be clamped away.
        const alt = Object.assign({}, w);
        if (f < 1) alt[k] = w[k] * f;
        else for (const j of keys.concat(['wGap', 'wEvt', 'wAdv', 'wHub'])) if (j !== k) alt[j] = w[j] / f;
        const res = accessReview(hospitals, accessById, alt, opts);
        for (const r of res.ranked) {
          const cur = ranges[r.h.id];
          if (cur) { cur[0] = Math.min(cur[0], r.rank); cur[1] = Math.max(cur[1], r.rank); }
        }
      }
    }
    return ranges;
  }

  // ------------------------------------------------------------------
  // Search
  // ------------------------------------------------------------------
  // Clinicians type what they say: "St V", "HMC", "Sacred Heart Spokane".
  function normalizeSearch(str) {
    return String(str || '')
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[.'’ʻ]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\bst\b/g, 'saint')
      .replace(/\bste\b/g, 'sainte')
      .replace(/\bmt\b/g, 'mount')
      .replace(/\bhosp\b/g, 'hospital')
      .replace(/\bmed\b/g, 'medical')
      .replace(/\bctr\b/g, 'center')
      .replace(/\bcentre\b/g, 'center')
      .replace(/\bmem\b/g, 'memorial')
      .replace(/\breg\b/g, 'regional')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokenize(query) {
    return normalizeSearch(query).split(' ').filter(Boolean);
  }

  // Word-prefix match: a one-letter token ("v" in "St V") must start a word.
  function matchesToken(haystack, token) {
    if (!token) return true;
    return haystack === token || haystack.startsWith(token) || haystack.includes(' ' + token);
  }

  function buildSearchFields(h) {
    const names = [h.name, h.officialName, h.cmsName].concat(h.formerNames || []).concat(h.aliases || []);
    const addr = h.address || {};
    // County comes from the curated address when present, else from the
    // coordinates against Census boundaries (derived by the build).
    const county = addr.county || (h.derived && h.derived.county) || null;
    const variants = names.filter(Boolean).map(normalizeSearch).filter(Boolean);
    return {
      variants,
      name: variants.join(' '),
      county: county ? normalizeSearch(county) : '',
      city: addr.city ? normalizeSearch(addr.city) : '',
      all: normalizeSearch([].concat(names, [
        addr.street, addr.city, county, h.state, addr.zip,
        h.system && h.system.value, h.ccn && h.ccn.value, h.npi,
      ]).filter(Boolean).join(' ')),
    };
  }

  // "Lewis County" / "Kenai Peninsula Borough": the words before "county" (or
  // "borough") must be this record's county, as a phrase. Without this the
  // word "county" would match everything and "lewis" would match any street,
  // name or town beginning "Lewis". Returns the remaining tokens, or null when
  // the record is in a different county; undefined when no county phrase.
  const COUNTY_WORDS = ['county', 'borough'];
  function countyPhrase(fields, tokens) {
    const ci = tokens.findIndex(t => COUNTY_WORDS.includes(t));
    if (ci < 1) return undefined;
    for (let j = Math.min(3, ci); j >= 1; j--) {
      if (fields.county && fields.county === tokens.slice(ci - j, ci).join(' ')) {
        return tokens.slice(0, ci - j).concat(tokens.slice(ci + 1));
      }
    }
    return null;
  }

  function matchesQuery(fields, tokens) {
    const rest = countyPhrase(fields, tokens);
    if (rest === null) return false;
    return (rest || tokens).every(t => matchesToken(fields.all, t));
  }

  // Lower is better.
  function searchRank(fields, query, tokens) {
    const q = normalizeSearch(query);
    const name = fields.name;
    const variants = fields.variants || [name];
    if (!q) return 9;
    if (variants.some(v => v === q)) return 0;
    if (variants.some(v => v.startsWith(q))) return 1;
    if (variants.some(v => v.includes(' ' + q))) return 2;
    if (tokens.every(t => matchesToken(name, t))) return 3;
    // A town or county asked for by name outranks an incidental word match.
    if (fields.city && fields.city === q) return 3;
    if (countyPhrase(fields, tokens)) return 3;
    if (name.includes(q)) return 4;
    return 5;
  }

  // ------------------------------------------------------------------
  // CSV — RFC 4180 quoting plus a guard against spreadsheet formula injection
  // ------------------------------------------------------------------
  function csvCell(v) {
    if (v == null) return '';
    let s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v);
    // A cell beginning with = + - @ (or tab/CR) is executed by spreadsheet apps.
    // Numbers are exempt so negative differences stay numeric.
    if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(rows) {
    return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  // ------------------------------------------------------------------
  // URL state
  // ------------------------------------------------------------------
  const MODES = ['capability', 'evt-distance', 'adv-distance', 'hub-distance', 'evidence', 'eligibility'];
  const VIEWS = ['find', 'explore', 'compare', 'data'];
  const TIER_FILTERS = ['csc', 'tsc', 'psc', 'asr', 'none', 'partial', 'unassessed', 'conflicting'];
  const EVIDENCE_FILTERS = ['assessed', 'unassessed', 'conflicting', 'needs-verification'];
  const SCOPES = ['eligible', 'all'];
  const INCLUDES = ['excluded', 'unknown'];
  const STATES = ['WA', 'AK', 'ID', 'MT', 'WY'];
  const THEMES = ['light', 'dark'];
  const BASEMAPS = ['muted', 'terrain', 'standard', 'none'];
  const CAH_FILTERS = ['yes', 'no', 'unknown'];
  const OVERLAYS = ['lines', 'nearest', 'rings'];
  const SORTS = ['relevance', 'name', 'tier', 'evt', 'hub', 'checked'];
  const PRESETS = ['telestroke', 'evt', 'state'];
  const MAX_COMPARE = 4;

  const REVIEW_KEYS = [['wGap', 'wg'], ['wEvt', 'we'], ['wAdv', 'wa'], ['wHub', 'wh'], ['capMi', 'cap'], ['desertMi', 'dm']];
  const TRANSPORT_KEYS = [['didoMin', 'dido'], ['roadFactor', 'rf'], ['groundMph', 'gs'], ['groundHandoffMin', 'gh'], ['rotorMph', 'rs'],
    ['rotorHandoffMin', 'rh'], ['rotorMaxMi', 'rr'], ['fixedMph', 'fs'], ['fixedGroundLegsMin', 'fg'], ['fixedHandoffMin', 'fh']];

  function defaultUiState() {
    return {
      view: 'find', mode: 'capability', q: '', state: 'ALL', tiers: [], evt: false, evidence: [],
      basis: null, cah: null, system: null, scope: 'eligible', include: ['unknown'], evtMin: 0,
      selected: null, hub: null, compare: [], overlays: ['lines'], neighbors: true, sort: 'relevance', preset: null,
      review: Object.assign({}, REVIEW_DEFAULTS), transport: Object.assign({}, TRANSPORT_DEFAULTS),
      view_lat: null, view_lng: null, view_z: null, theme: null, cb: null, basemap: null,
    };
  }

  function snap(v, lo, hi, step) {
    if (!isNum(v)) return null;
    const c = Math.min(hi, Math.max(lo, v));
    const s = Math.round(c / step) * step;
    return Number(s.toFixed(4));
  }

  // Parse a query string into UI state. `ids` is a Set of valid record ids and
  // `systems` a Set of valid system names. Every value is validated; anything
  // malformed is dropped and reported in `ignored`, never thrown.
  function parseUrlState(search, ctx) {
    const ids = (ctx && ctx.ids) || new Set();
    // Retired ids (a record re-identified after a CCN correction) still open
    // the record they now belong to.
    const aliases = (ctx && ctx.aliases) || new Map();
    const systems = (ctx && ctx.systems) || new Set();
    const p = new URLSearchParams(search || '');
    const s = defaultUiState();
    const ignored = [];
    const explicit = {};
    const list = (v) => String(v || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
    const id = (v) => { const x = String(v || '').trim(); return ids.has(x) ? x : aliases.get(x) || null; };

    if (p.has('view')) { const v = p.get('view'); if (VIEWS.includes(v)) s.view = v; else ignored.push('view'); }
    if (p.has('mode')) { const v = p.get('mode'); if (MODES.includes(v)) s.mode = v; else ignored.push('mode'); }
    if (p.has('q')) s.q = String(p.get('q')).slice(0, 120);
    if (p.has('state')) { const v = String(p.get('state')).toUpperCase(); if (v === 'ALL' || STATES.includes(v)) s.state = v; else ignored.push('state'); }

    // Tier filters: new form tier=csc,psc; old links used one flag per pill
    // (csc=1, none=1, census=1, evt=1), which still work.
    const tiers = new Set();
    if (p.has('tier')) {
      for (const t of list(p.get('tier'))) { if (TIER_FILTERS.includes(t)) tiers.add(t); else ignored.push('tier:' + t); }
    }
    for (const t of ['csc', 'tsc', 'psc', 'asr', 'none']) if (p.get(t) === '1') tiers.add(t);
    if (p.get('census') === '1') tiers.add('unassessed');
    s.tiers = TIER_FILTERS.filter(t => tiers.has(t));
    if (p.get('evt') === '1') s.evt = true;

    // ev also takes one needs-verification reason, as nv:<code>.
    if (p.has('ev')) s.evidence = list(p.get('ev')).filter(x => EVIDENCE_FILTERS.includes(x) || /^nv:[a-z0-9-]{2,40}$/.test(x));
    if (p.has('basis')) { const v = p.get('basis'); if (v === 'national' || v === 'state') s.basis = v; else ignored.push('basis'); }
    if (p.has('cah')) { const v = p.get('cah'); if (CAH_FILTERS.includes(v)) s.cah = v; else ignored.push('cah'); }
    if (p.has('sys')) { const v = p.get('sys'); if (systems.has(v)) s.system = v; else ignored.push('sys'); }
    if (p.has('scope')) { const v = p.get('scope'); if (SCOPES.includes(v)) s.scope = v; else ignored.push('scope'); }
    if (p.has('inc')) s.include = p.get('inc') === 'none' ? [] : list(p.get('inc')).filter(x => INCLUDES.includes(x));
    if (p.has('evtdist')) { const v = snap(parseInt(p.get('evtdist'), 10), 0, 250, 25); if (v != null) s.evtMin = v; else ignored.push('evtdist'); }
    if (p.has('sort')) { const v = p.get('sort'); if (SORTS.includes(v)) s.sort = v; else ignored.push('sort'); }
    if (p.has('preset')) { const v = p.get('preset'); if (PRESETS.includes(v)) s.preset = v; else ignored.push('preset'); }

    if (p.has('h')) { const v = id(p.get('h')); if (v) s.selected = v; else ignored.push('h'); }
    if (p.has('hub')) { const v = id(p.get('hub')); if (v) { s.hub = v; explicit.hub = true; } else ignored.push('hub'); }
    if (p.has('cmp')) {
      const raw = String(p.get('cmp')).split(',').map(x => x.trim()).filter(Boolean);
      const valid = [];
      for (const x of raw) { const v = id(x); if (v && !valid.includes(v)) valid.push(v); else ignored.push('cmp:' + x); }
      s.compare = valid.slice(0, MAX_COMPARE);
      if (valid.length > MAX_COMPARE) ignored.push('cmp:over-limit');
    }
    if (p.has('ov')) {
      const raw = p.get('ov') === 'none' ? [] : list(p.get('ov'));
      s.overlays = raw.filter(x => OVERLAYS.includes(x));
      for (const x of raw) if (!OVERLAYS.includes(x)) ignored.push('ov:' + x);
    }
    if (p.has('nb')) s.neighbors = p.get('nb') !== '0';

    // Old scenario links used wc for the certification-gap weight and left out
    // weights at their own defaults (40 to EVT, 20 to CSC/TSC-level); fill those
    // from the old defaults so the link restores the mix it was made with.
    const reviewKeys = REVIEW_KEYS.concat([['wGap', 'wc']]);
    const legacy = [];
    if (p.has('wc')) {
      if (!p.has('we')) s.review.wEvt = 40;
      if (!p.has('wa')) s.review.wAdv = 20;
      legacy.push('weights');
    }
    for (const [k, short] of reviewKeys) {
      if (!p.has(short)) continue;
      const r = REVIEW_RANGES[k];
      const v = snap(parseFloat(p.get(short)), r[0], r[1], r[2]);
      if (v != null) s.review[k] = v; else ignored.push(short);
    }
    for (const [k, short] of TRANSPORT_KEYS) {
      if (!p.has(short)) continue;
      const r = TRANSPORT_RANGES[k];
      const v = snap(parseFloat(p.get(short)), r[0], r[1], r[2]);
      if (v != null) s.transport[k] = v; else ignored.push(short);
    }

    if (p.has('lat') || p.has('lng') || p.has('z')) {
      const lat = parseFloat(p.get('lat'));
      const lng = parseFloat(p.get('lng'));
      // The map zooms in half steps; keep a shared z=7.5 at 7.5.
      const z = snap(parseFloat(p.get('z')), 2, 18, 0.5);
      if (isNum(lat) && isNum(lng) && isNum(z) && lat >= -85 && lat <= 85 && lng >= -180 && lng <= 180 && z >= 2 && z <= 18) {
        s.view_lat = lat; s.view_lng = lng; s.view_z = z; explicit.viewport = true;
      } else ignored.push('viewport');
    }
    if (p.has('theme')) { const v = p.get('theme'); if (THEMES.includes(v)) { s.theme = v; explicit.theme = true; } else ignored.push('theme'); }
    else if (p.get('dark') === '1') { s.theme = 'dark'; explicit.theme = true; }
    if (p.has('cb')) { s.cb = p.get('cb') === '1'; explicit.cb = true; }
    if (p.has('bm')) { const v = p.get('bm'); if (BASEMAPS.includes(v)) { s.basemap = v; explicit.basemap = true; } else ignored.push('bm'); }
    return { state: s, ignored, explicit, legacy };
  }

  // Serialise only what differs from defaults, so links stay short and an old
  // default never gets frozen into a shared link.
  function serializeUrlState(s, opts) {
    const d = defaultUiState();
    const p = new URLSearchParams();
    if (s.view && s.view !== d.view) p.set('view', s.view);
    if (s.mode && s.mode !== d.mode) p.set('mode', s.mode);
    if (s.q) p.set('q', s.q);
    if (s.state && s.state !== 'ALL') p.set('state', s.state);
    if (s.tiers && s.tiers.length) p.set('tier', s.tiers.join(','));
    if (s.evt) p.set('evt', '1');
    if (s.evidence && s.evidence.length) p.set('ev', s.evidence.join(','));
    if (s.basis) p.set('basis', s.basis);
    if (s.cah) p.set('cah', s.cah);
    if (s.system) p.set('sys', s.system);
    if (s.scope && s.scope !== d.scope) p.set('scope', s.scope);
    const inc = (s.include || []).slice().sort().join(',');
    if (inc !== d.include.slice().sort().join(',')) p.set('inc', inc || 'none');
    if (s.evtMin) p.set('evtdist', String(s.evtMin));
    if (s.sort && s.sort !== d.sort) p.set('sort', s.sort);
    if (s.preset) p.set('preset', s.preset);
    if (s.selected) p.set('h', s.selected);
    if (s.hub) p.set('hub', s.hub);
    if (s.compare && s.compare.length) p.set('cmp', s.compare.slice(0, MAX_COMPARE).join(','));
    const ov = (s.overlays || []).slice().sort().join(',');
    if (ov !== d.overlays.slice().sort().join(',')) p.set('ov', ov || 'none');
    if (s.neighbors === false) p.set('nb', '0');
    for (const [k, short] of REVIEW_KEYS) if (s.review && s.review[k] !== REVIEW_DEFAULTS[k]) p.set(short, String(s.review[k]));
    for (const [k, short] of TRANSPORT_KEYS) if (s.transport && s.transport[k] !== TRANSPORT_DEFAULTS[k]) p.set(short, String(s.transport[k]));
    if (isNum(s.view_lat) && isNum(s.view_lng) && isNum(s.view_z)) {
      p.set('lat', s.view_lat.toFixed(4)); p.set('lng', s.view_lng.toFixed(4)); p.set('z', String(s.view_z));
    }
    if (opts && opts.includeDisplay) {
      if (s.theme) p.set('theme', s.theme);
      if (s.cb != null) p.set('cb', s.cb ? '1' : '0');
      if (s.basemap) p.set('bm', s.basemap);
    }
    return p.toString();
  }

  return {
    TIERS, TIER_NAMES, CLAIM_STATES, CLAIM_LABELS, STATE_CROSSWALK,
    TRANSPORT_DEFAULTS, TRANSPORT_RANGES, REVIEW_DEFAULTS, REVIEW_RANGES, GAP_VALUES,
    DISTANCE_BINS, DESTINATION_SETS, MODES, VIEWS, TIER_FILTERS, EVIDENCE_FILTERS, PRESETS, MAX_COMPARE,
    isNum, formatMiles, formatMinutes, formatSignedMiles, formatStreet,
    haversineMi, locationOf, distanceBetween,
    claimState, displayTier, isEligible, isExcluded, isActive, canBeDestination, hasDocumented247Evt, isAdvancedCenter,
    destinationSet, nearestInSet, computeAccess, hubDifferential,
    groundFeasibility, transportParams, legScenario, transferScenario, transferFeasibility,
    distanceBin, reviewParams, gapComponent, capabilityAssessed, isReviewCandidate, accessReview, rankSensitivity, rankRows,
    normalizeSearch, tokenize, matchesToken, buildSearchFields, matchesQuery, searchRank,
    csvCell, toCsv,
    defaultUiState, parseUrlState, serializeUrlState,
  };
}));
