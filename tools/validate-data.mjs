#!/usr/bin/env node
/**
 * Data-integrity validator for the stroke-capabilities datasets.
 *
 * Enforces the invariants documented in METHODOLOGY.md §6 ("Data integrity").
 * Pure Node, no dependencies. Exits 0 when every file passes and 1 otherwise,
 * so it can be wired into CI or a pre-commit / pre-deploy hook.
 *
 *   node tools/validate-data.mjs                  # validate the default datasets
 *   node tools/validate-data.mjs path/to/data.json [more.json ...]
 *   node tools/validate-data.mjs --quiet          # only print on failure
 *
 * A record array is read from the top-level "hospitals" or "facilities" key.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FILES = ['hospitals.json', 'facilities.json'];

const STATES = new Set(['WA', 'AK', 'ID', 'MT', 'WY']);
const CERT_TYPES = new Set(['CSC', 'TSC', 'PSC', 'ASR', null]);
// Generous bounding box for the WWAMI region (includes mainland + Aleutians).
const LAT = { min: 40, max: 72 };
const LON = { min: -180, max: -104 };

function recordsOf(doc) {
  if (Array.isArray(doc.hospitals)) return doc.hospitals;
  if (Array.isArray(doc.facilities)) return doc.facilities;
  return null;
}

/** Returns an array of human-readable invariant violations (empty == valid). */
function validate(records) {
  const violations = [];
  const seen = new Map();

  records.forEach((h, i) => {
    const id = h.cmsId ?? `index ${i}`;
    const where = `${h.name || '(unnamed)'} [${id}]`;

    // METHODOLOGY §6: required, non-empty identity/location fields.
    for (const field of ['name', 'cmsId', 'state', 'address', 'city']) {
      if (h[field] == null || String(h[field]).trim() === '') {
        violations.push(`${where}: empty "${field}"`);
      }
    }

    // METHODOLOGY §6: every CMS ID is unique.
    if (h.cmsId != null) {
      if (seen.has(h.cmsId)) violations.push(`${where}: duplicate cmsId (also ${seen.get(h.cmsId)})`);
      else seen.set(h.cmsId, h.name || id);
    }

    // METHODOLOGY §6: every record has valid latitude/longitude (in region).
    const { latitude: lat, longitude: lon } = h;
    if (typeof lat !== 'number' || Number.isNaN(lat) || typeof lon !== 'number' || Number.isNaN(lon)) {
      violations.push(`${where}: non-numeric latitude/longitude (${lat}, ${lon})`);
    } else if (lat < LAT.min || lat > LAT.max || lon < LON.min || lon > LON.max) {
      violations.push(`${where}: coordinates outside WWAMI range (${lat}, ${lon})`);
    }

    // Schema sanity: known state + known certification tier.
    if (!STATES.has(h.state)) violations.push(`${where}: unexpected state "${h.state}"`);
    if (!CERT_TYPES.has(h.strokeCertificationType)) {
      violations.push(`${where}: invalid strokeCertificationType "${h.strokeCertificationType}"`);
    }

    // METHODOLOGY §6: every CSC and TSC has hasELVO = true.
    if ((h.strokeCertificationType === 'CSC' || h.strokeCertificationType === 'TSC') && h.hasELVO !== true) {
      violations.push(`${where}: ${h.strokeCertificationType} without hasELVO=true`);
    }

    // METHODOLOGY §6: every certified hospital names a certifying body.
    if (h.strokeCertificationType && (h.certifyingBody == null || String(h.certifyingBody).trim() === '')) {
      violations.push(`${where}: certified (${h.strokeCertificationType}) without certifyingBody`);
    }
  });

  return violations;
}

function main() {
  const argv = process.argv.slice(2);
  const quiet = argv.includes('--quiet');
  const files = argv.filter((a) => !a.startsWith('--'));
  const targets = files.length ? files : DEFAULT_FILES;
  let failed = 0;

  for (const file of targets) {
    const path = resolve(REPO_ROOT, file);
    let doc;
    try {
      doc = JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      console.error(`✗ ${file}: cannot read/parse — ${err.message}`);
      failed++;
      continue;
    }

    const records = recordsOf(doc);
    if (!records) {
      console.error(`✗ ${file}: no "hospitals" or "facilities" array found`);
      failed++;
      continue;
    }

    const violations = validate(records);
    if (violations.length) {
      console.error(`✗ ${file}: ${records.length} records, ${violations.length} violation(s):`);
      for (const m of violations) console.error(`    - ${m}`);
      failed++;
    } else {
      const dist = {};
      for (const h of records) dist[h.state] = (dist[h.state] || 0) + 1;
      const distStr = Object.keys(dist).sort().map((s) => `${s}:${dist[s]}`).join(' ');
      if (!quiet) console.log(`✓ ${file}: ${records.length} records, 0 violations  (${distStr})`);
    }
  }

  if (failed) {
    console.error(`\nFAILED: ${failed} file(s) did not pass data-integrity checks.`);
    process.exit(1);
  }
  if (!quiet) console.log(`\nOK: all ${targets.length} dataset(s) passed data-integrity checks.`);
}

main();
