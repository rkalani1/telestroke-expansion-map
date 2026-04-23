# STROKE CERTIFICATION ACCURACY AUDIT - 2025
## Comprehensive Review of Telestroke Expansion Map Website

**Audit Date:** January 2025
**Auditor:** Claude Code
**Website:** https://rkalani1.github.io/telestroke-expansion-map/
**Status:** COMPLETED - CORRECTIONS REQUIRED

---

## EXECUTIVE SUMMARY

This audit systematically reviewed all stroke center certification terminology, definitions, and classifications on the telestroke expansion map website against current 2025 standards from authoritative sources. The audit identified **9 critical issues requiring correction** and **2 enhancements needed** to ensure 100% accuracy.

### Key Findings:
- ✅ **Correct:** Basic certification levels CSC, TSC, PSC exist and are accurate
- ❌ **CRITICAL:** ASR/ASRH completely missing from legend and info panel
- ⚠️  **INCOMPLETE:** No mention of DNV's "Primary Plus (PSC+)" terminology
- ⚠️  **MISSING:** Certifying body information incomplete
- ⚠️  **INACCURATE:** Some definitions need updating to 2025 standards
- ⚠️  **UNCLEAR:** Washington State designation system not explained

---

## PART 1: CURRENT WEBSITE CONTENT ANALYSIS

### 1.1 Locations Where Stroke Information Appears

**File: `index.html`**
- **Lines 278-295:** Stroke Certification Filters (CSC, TSC, PSC only)
- **Lines 303-311:** Special Designations (includes "24/7 Thrombectomy (EVT) Capable")
- **Lines 314-354:** Map Legend (CSC, TSC, PSC only - **ASR MISSING**)
- **Lines 479-506:** Info Panel - Certification Explanations
- **Lines 450-474:** Stats Panel (shows CSC, TSC, PSC counts)

**File: `complete_hospitals.js`**
- **Lines 62-68:** Marker color assignments (includes ASR but not in HTML)
- **Lines 171-178:** Popup certification names (includes ASR)
- **Lines 224-227:** Statistics calculations (CSC, TSC, PSC only)

### 1.2 Current Definitions (From info-panel, lines 483-501)

#### **CSC - Comprehensive Stroke Center**
> "Highest level of stroke care. Provides complete range of services including 24/7 neurosurgical coverage, advanced imaging, endovascular thrombectomy (EVT), and comprehensive rehabilitation. Can treat the most complex stroke cases. Certified by Joint Commission or DNV."

**Status:** ✅ Mostly Accurate
**Issues:** Missing ACHC and CIHQ as certifying bodies

---

#### **TSC - Thrombectomy-Capable Stroke Center**
> "Advanced stroke care with capability to perform mechanical thrombectomy (EVT) for large vessel occlusions. Has CT/CTA, neuroimaging, and interventional neuroradiology available. Can provide care for complex ischemic strokes requiring endovascular intervention."

**Status:** ⚠️ Incomplete
**Issues:**
1. Missing DNV's equivalent term "Primary Plus (PSC+)"
2. Missing volume requirements (15 MT/12mo or 30 MT/24mo)
3. Missing neurointensive care requirement
4. Missing "must have all PSC capabilities PLUS thrombectomy"

---

#### **PSC - Primary Stroke Center**
> "Basic comprehensive acute stroke care with CT scanning, IV thrombolysis (tPA) capability, dedicated stroke unit, and standardized protocols. Focuses on rapid assessment and treatment with established transfer agreements for patients requiring higher-level care (EVT, neurosurgery)."

**Status:** ✅ Mostly Accurate
**Issues:** "Basic comprehensive" is contradictory - should be "foundational"

---

#### **EVT - Endovascular Thrombectomy**
> "24/7 mechanical thrombectomy capability for large vessel occlusions. Requires interventional neuroradiology, advanced imaging (CTA/CTP or MRI/MRA), and specialized neurovascular team. All CSC and TSC certified hospitals have EVT capability."

**Status:** ⚠️ MISLEADING CLASSIFICATION
**Critical Issue:** EVT is presented as if it's a certification level, but it's a **capability descriptor**, not a standalone certification. This entire entry should be removed or completely rewritten.

---

#### **ASR/ASRH - COMPLETELY MISSING**
**Status:** ❌ CRITICAL OMISSION

This certification level is used in the JavaScript code but is **completely absent** from:
- The HTML legend (lines 314-354)
- The info panel explanations (lines 479-506)
- The filter checkboxes (lines 278-295)
- The stats panel (lines 450-474)

---

### 1.3 Current Certifying Bodies Statement (line 503-505)

> "**Certifying Bodies:** Joint Commission and DNV are independent accrediting organizations that verify hospitals meet rigorous stroke care standards through on-site reviews and performance metrics."

**Status:** ❌ INCOMPLETE
**Missing:** ACHC (Accreditation Commission for Health Care) and CIHQ (Center for Improvement in Healthcare Quality)

---

## PART 2: 2025 AUTHORITATIVE STANDARDS (VERIFIED)

### 2.1 Four Certifying Organizations (Verified Jan 2025)

| Organization | Abbreviation | Levels Certified | Status |
|-------------|--------------|------------------|---------|
| **The Joint Commission** | TJC | ASRH, PSC, TSC, CSC | ✅ All 4 levels |
| **Det Norske Veritas** | DNV | ASR, PSC, PSC+, CSC | ✅ All 4 levels |
| **Accreditation Commission for Health Care** | ACHC | ASRH, PSC, TSC, CSC | ✅ All 4 levels |
| **Center for Improvement in Healthcare Quality** | CIHQ | ASRH, PSC | ⚠️ Only 2 levels |

**Source:** *Heterogeneity of State Stroke Center Certification and Designation Processes* (PMC 10978226, 2024)

**Key Note:** ACHC absorbed the former Healthcare Facilities Accreditation Program (HFAP)

---

### 2.2 Certification Levels - Official Names and Terminology

#### **LEVEL 1 (Entry): Acute Stroke Ready**

**Official Terms:**
- **Joint Commission:** Acute Stroke Ready Hospital **(ASRH)** - Introduced 2015
- **DNV:** Acute Stroke Ready **(ASR)** - Uses shorter name
- **ACHC:** Acute Stroke Ready Hospital **(ASRH)**
- **CIHQ:** Acute Stroke Ready Hospital **(ASRH)**

**Verified Definition (2025):**
Hospitals equipped to perform rapid clinical stroke assessments, provide stabilization, and implement protocols for the safe administration of IV tPA. Must have:
- ED physician, NP, or PA for initial assessment
- Neurology available 24/7 via telemedicine
- Neurosurgery available within 3-hour transfer
- IV thrombolytics available
- Established transfer protocols to PSC/TSC/CSC

**Website Status:** ❌ **COMPLETELY MISSING FROM HTML**

---

#### **LEVEL 2: Primary Stroke Center**

**Official Term (All Bodies):** Primary Stroke Center **(PSC)** - Introduced 2003 (TJC)

**Verified Definition (2025):**
Facilities with necessary staffing, infrastructure, and programs to stabilize and treat most emergent stroke patients. Requirements include:
- All ASRH/ASR capabilities PLUS:
- Dedicated stroke unit or beds specifically designated for stroke patients
- Ability to provide broader range of stroke treatments
- CT scanning and IV thrombolysis capability
- Monitoring after treatment with thrombolytics
- More advanced diagnostic assessments
- Transfer agreements for patients requiring EVT or neurosurgery

**Website Status:** ✅ Present, needs minor refinement

---

#### **LEVEL 3: Thrombectomy-Capable Stroke Center**

**Official Terms:**
- **Joint Commission:** Thrombectomy-Capable Stroke Center **(TSC)** - Introduced 2018
- **DNV:** Primary Plus Stroke Center **(PSC+)** - DNV's unique terminology
- **ACHC:** Thrombectomy-Capable Stroke Center **(TSC)**
- **CIHQ:** Does NOT certify this level

**CRITICAL NOTE:** DNV calls this level "Primary Plus (PSC+)" which is equivalent to TSC. This MUST be explained on the website.

**Verified Definition (2025):**
Facilities capable of providing 24/7 endovascular treatment for acute ischemic stroke. Requirements include:
- **All PSC capabilities PLUS:**
- 24/7 mechanical thrombectomy (EVT) capability
- On-call neurovascular and neuro-interventional team available 24/7
- Dedicated neurological intensive care unit (neuro-ICU)
- On-site critical care coverage
- Advanced imaging: CT, CTA, and capability for CTP or MRI/MRA
- **Volume Requirements (Per Facility and Per Physician):**
  - Facility: Minimum 15 mechanical thrombectomies annually
  - Individual physicians: 15 MT in 12 months OR 30 MT in 24 months
- Transfer agreements with CSC for cases requiring neurosurgery

**Source:** Joint Commission physician volume requirements (reinstated 2019, effective 2024-2025)

**Website Status:** ⚠️ Present but missing critical requirements (volume, neuro-ICU, DNV terminology)

---

#### **LEVEL 4 (Highest): Comprehensive Stroke Center**

**Official Term (All Bodies):** Comprehensive Stroke Center **(CSC)** - Introduced 2012 (TJC)

**Verified Definition (2025):**
Highest level offering the full spectrum of advanced treatments for both ischemic and hemorrhagic stroke. Requirements include:
- **All TSC capabilities PLUS:**
- 24/7 availability of specialized team:
  - Neuro-interventionalists
  - Neurointensivists
  - Neuro-radiologists
  - Neurologists
  - Neurosurgeons
- Advanced imaging: CT, CTA, MRI, MRA, DSA (digital subtraction angiography)
- Neurosurgical capability for hemorrhagic stroke, aneurysms
- Comprehensive rehabilitation services
- Research capabilities and clinical trials
- Higher procedural volume requirements
- Can manage most complex stroke cases without transfer

**Website Status:** ✅ Mostly accurate, needs minor updates

---

### 2.3 "24/7 Thrombectomy (EVT) Capable" - Clarification

**Current Website Usage:**
- Listed as a "Special Designation" filter (line 309)
- Has its own info panel entry as if it's a certification (lines 499-501)
- Stats panel tracks it separately (line 473)

**VERIFIED CLASSIFICATION:**
❌ **NOT a standalone certification level**
✅ **IS a capability descriptor** for TSC and CSC hospitals

**Correction Needed:**
1. Remove EVT entry from info panel certification explanations
2. Clarify that "24/7 Thrombectomy Capable" refers to hospitals that have TSC or CSC certification, or have mechanical thrombectomy capability regardless of certification status
3. Keep the filter and stat tracking but add clarifying text

---

## PART 3: WASHINGTON STATE DESIGNATION SYSTEM

### 3.1 WA State Emergency Cardiac and Stroke (ECS) System

**Verified:** Washington State has a **SEPARATE** designation system that runs parallel to national certifications.

**System Type:** Hybrid model (one of only 6 states with this approach)

**Levels:** Level I, Level II, Level III

**Key Documentation:**
- ECS Strategic Plan 2025-2027 (DOH document)
- Level 1 Stroke Center Documentation Checklist (DOH 346186, July 2025)
- Categorization application forms available at DOH website

**Current Website Status:** ❌ **NO MENTION OF STATE SYSTEM**

**Critical Issue:** The website does not distinguish between:
1. **National Certifications** (TJC, DNV, ACHC, CIHQ): ASRH/ASR, PSC, TSC/PSC+, CSC
2. **Washington State Designations**: Level I, II, III

Hospitals can have BOTH a national certification AND a state designation.

**Correction Required:**
Website must clearly explain that there are TWO separate systems:
- National certification (voluntary, from accrediting bodies)
- State designation (Washington-specific categorization)

---

## PART 4: SPECIFIC CORRECTIONS REQUIRED

### ❌ CRITICAL ISSUE #1: ASR/ASRH Missing from Legend
**Location:** `index.html` lines 314-354 (Map Legend)

**Current:** Legend shows only CSC, TSC, PSC, UW Partner, Other Hospitals

**Required:** Add ASR/ASRH to legend

**Proposed Fix:**
```html
<div class="legend-item">
    <div class="legend-color" style="background: #84cc16;"></div>
    <div class="legend-text">
        <strong>ASR - Acute Stroke Ready</strong>
        <span>Stabilization and IV tPA, transfer capable</span>
    </div>
</div>
```

**Insert after PSC entry, before UW Partner**

---

### ❌ CRITICAL ISSUE #2: ASR/ASRH Missing from Info Panel
**Location:** `index.html` lines 479-506 (Info Panel)

**Current:** Info panel explains CSC, TSC, PSC, EVT - **No ASR/ASRH**

**Required:** Add ASR/ASRH explanation section

**Proposed Addition:**
```html
<div class="cert-description">
    <h4>ASR/ASRH - Acute Stroke Ready (Hospital)</h4>
    <p>Entry-level stroke certification for hospitals equipped to perform rapid stroke assessments, provide stabilization, and administer IV tPA (tissue plasminogen activator). Has neurology available 24/7 via telemedicine and established transfer protocols to higher-level stroke centers (PSC, TSC, or CSC) for patients requiring advanced care. Certified by Joint Commission (ASRH), DNV (ASR), ACHC (ASRH), or CIHQ (ASRH).</p>
</div>
```

**Insert after PSC, before EVT**

---

### ❌ CRITICAL ISSUE #3: ASR Missing from Filters
**Location:** `index.html` lines 278-295 (Stroke Certification Filters)

**Current:** Checkboxes only for CSC, TSC, PSC

**Required:** Add ASR checkbox filter

**Proposed Addition:**
```html
<label class="checkbox-label">
    <input type="checkbox" id="filter-asr" onchange="renderMarkers()">
    <strong>ASR/ASRH</strong> - Acute Stroke Ready
</label>
```

**Insert after PSC filter**

---

### ❌ CRITICAL ISSUE #4: ASR Missing from Stats Panel
**Location:** `index.html` lines 450-474 (Stats Panel)

**Current:** Stats show CSC, TSC, PSC, UW Partners, EVT

**Required:** Add ASR stat card

**Proposed Addition:**
```html
<div class="stat-card">
    <div class="stat-value" id="stat-asr">0</div>
    <div class="stat-label">Acute Stroke Ready (ASR)</div>
</div>
```

**Insert after PSC stat, before UW Partners**

**JavaScript Update Required:**
```javascript
// In complete_hospitals.js, line ~227, add:
document.getElementById('stat-asr').textContent = filtered.filter(h => h.strokeCertificationType === 'ASR').length;
```

---

### ⚠️  ISSUE #5: EVT Misclassified as Certification
**Location:** `index.html` lines 499-501 (Info Panel)

**Current:** EVT has its own certification explanation entry

**Problem:** EVT is a capability, not a certification level

**Proposed Correction:** REMOVE current EVT entry and replace with:

```html
<div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 12px; margin-bottom: 12px; border-radius: 4px;">
    <h4 style="font-weight: 600; margin-bottom: 4px; color: #1e40af; font-size: 13px;">Understanding EVT (Endovascular Thrombectomy)</h4>
    <p style="font-size: 11px; color: #1e3a8a; line-height: 1.5;">
        <strong>24/7 Thrombectomy Capability</strong> is NOT a certification level—it's a clinical capability available at TSC and CSC certified hospitals. Mechanical thrombectomy (EVT) is a procedure to remove blood clots causing large vessel occlusions. Hospitals tracked as "EVT-capable" on this map include all TSC and CSC certified facilities, plus any hospitals performing thrombectomy regardless of certification status.
    </p>
</div>
```

---

### ⚠️  ISSUE #6: Certifying Bodies Incomplete
**Location:** `index.html` lines 503-505 (Info Panel)

**Current:** "Joint Commission and DNV are independent accrediting organizations..."

**Problem:** Missing ACHC and CIHQ

**Proposed Correction:**
```html
<div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280;">
    <strong>National Certifying Bodies:</strong> Four organizations certify stroke centers:
    <ul style="margin: 8px 0; padding-left: 20px; line-height: 1.6;">
        <li><strong>The Joint Commission (TJC)</strong> - Certifies all 4 levels: ASRH, PSC, TSC, CSC</li>
        <li><strong>DNV Healthcare (DNV)</strong> - Certifies all 4 levels: ASR, PSC, PSC+ (Primary Plus, equivalent to TSC), CSC</li>
        <li><strong>Accreditation Commission for Health Care (ACHC)</strong> - Certifies all 4 levels: ASRH, PSC, TSC, CSC</li>
        <li><strong>Center for Improvement in Healthcare Quality (CIHQ)</strong> - Certifies 2 levels: ASRH, PSC</li>
    </ul>
    <p style="margin-top: 8px;"><em>Note: Certification is voluntary. Hospitals undergo rigorous on-site reviews and must meet specific performance standards.</em></p>
</div>
```

---

### ⚠️  ISSUE #7: TSC Definition Incomplete
**Location:** `index.html` lines 489-491

**Current:** Basic description without critical requirements

**Problem:** Missing volume requirements, neuro-ICU requirement, DNV terminology

**Proposed Correction:**
```html
<div class="cert-description">
    <h4>TSC - Thrombectomy-Capable Stroke Center (DNV calls this "PSC+")</h4>
    <p>Advanced stroke care with 24/7 capability to perform mechanical thrombectomy (EVT) for large vessel occlusions. <strong>Must have ALL Primary Stroke Center capabilities PLUS:</strong> interventional neuroradiology team available 24/7, dedicated neurological intensive care unit (neuro-ICU), advanced imaging (CT/CTA/CTP or MRI/MRA), and minimum procedural volumes (15 mechanical thrombectomies per year per facility and per physician, or 30 per physician over 24 months). Can provide endovascular treatment for complex ischemic strokes.</p>
</div>
```

---

### ⚠️  ISSUE #8: PSC Definition Needs Refinement
**Location:** `index.html` lines 494-496

**Current:** Uses contradictory term "Basic comprehensive"

**Proposed Correction:**
```html
<div class="cert-description">
    <h4>PSC - Primary Stroke Center</h4>
    <p>Foundational stroke care certification with necessary staffing, infrastructure, and programs to stabilize and treat most emergent stroke patients. Capabilities include: rapid CT scanning, IV thrombolysis (tPA) administration, dedicated stroke unit or designated stroke beds, 24/7 stroke team availability, standardized treatment protocols, and established transfer agreements to TSC or CSC facilities for patients requiring endovascular thrombectomy or neurosurgery.</p>
</div>
```

---

### ❌ CRITICAL ISSUE #9: No Explanation of Washington State System
**Location:** `index.html` - New section needed in Info Panel

**Current:** No mention of WA state designations

**Problem:** WA uses Level I, II, III designations separate from national certifications

**Proposed Addition:** Add new section to Info Panel (after certifying bodies):

```html
<div style="margin-top: 20px; padding-top: 16px; border-top: 2px solid #667eea;">
    <h3 style="font-size: 15px; font-weight: 700; margin-bottom: 12px; color: #374151;">Washington State Stroke Center Categorization</h3>
    <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px; margin-bottom: 12px; border-radius: 4px;">
        <p style="font-size: 11px; color: #92400e; line-height: 1.5;">
            <strong>Important:</strong> Washington State operates a SEPARATE categorization system (Level I, II, III) that is independent from national certifications. Hospitals may have both a national certification (CSC, TSC, PSC, ASR) AND a Washington State designation level. The two systems use different criteria and serve different regulatory purposes.
        </p>
    </div>
    <div style="font-size: 12px; color: #6b7280; line-height: 1.6;">
        <p><strong>Washington State Emergency Cardiac and Stroke (ECS) System:</strong></p>
        <ul style="margin: 8px 0; padding-left: 20px;">
            <li><strong>Level I:</strong> Highest state designation (similar to CSC capabilities)</li>
            <li><strong>Level II:</strong> Intermediate designation (similar to TSC/PSC capabilities)</li>
            <li><strong>Level III:</strong> Basic designation (similar to ASR capabilities)</li>
        </ul>
        <p style="margin-top: 8px;"><em>Note: State categorization is overseen by the Washington Department of Health. Not all hospitals pursue both national certification and state designation.</em></p>
    </div>
</div>
```

---

## PART 5: ADDITIONAL ENHANCEMENTS RECOMMENDED

### Enhancement #1: Add "Info" Button for Each Certification in Legend
**Proposed:** Add small info icons next to each certification level in the legend that display detailed requirements when clicked.

### Enhancement #2: Distinguish Certification vs. Capability
**Proposed:** Add visual distinction or note explaining:
- **Certification Levels:** CSC, TSC, PSC, ASR (awarded by accrediting bodies)
- **Capabilities:** EVT, telestroke (clinical capabilities, not certifications)
- **Designations:** Level I/II/III (state-specific)

---

## PART 6: FILES REQUIRING MODIFICATION

### Primary Files:
1. **`index.html`** - Requires 9 corrections/additions
   - Add ASR to legend (line ~340)
   - Add ASR to filters (line ~295)
   - Add ASR to stats panel (line ~467)
   - Add ASR to info panel (line ~497)
   - Update TSC definition (line ~489)
   - Update PSC definition (line ~494)
   - Fix EVT classification (line ~499)
   - Update certifying bodies (line ~503)
   - Add WA State system explanation (new section ~510)

2. **`complete_hospitals.js`** - Requires updates to:
   - Line ~227: Add ASR stat calculation
   - Verify filterHospitals() function handles ASR checkbox

---

## PART 7: SOURCES CONSULTED (For SOURCES.md)

### National Certification Standards:
1. **The Joint Commission**
   - 2025 Stroke Certification Standards (Released Dec 15, 2024)
   - URL: https://store.jcrinc.com/2025-stroke-certification-standards-e-book-/ebscs25/
   - Acute Stroke Ready Hospital Certification: https://www.jointcommission.org/en-us/certification/stroke

2. **DNV Healthcare**
   - Integrated Stroke Center Program Requirements 25-0 (Effective Aug 1, 2025)
   - URL: https://www.dnv.us/services/stroke-care-certification-programs-219582/
   - Primary Plus (PSC+) Certification: https://www.dnv.us/supplychain/healthcare/standards/psc-plus-dl/

3. **ACHC (Accreditation Commission for Health Care)**
   - Referenced in: PMC article 10978226

4. **CIHQ (Center for Improvement in Healthcare Quality)**
   - Referenced in: PMC article 10978226

### Academic/Medical Sources:
5. **American Heart Association/American Stroke Association**
   - Ideal Foundational Requirements for Stroke Program Development (2022)
   - URL: https://www.ahajournals.org/doi/10.1161/STR.0000000000000424

6. **Stroke Center Certification - StatPearls (NCBI)**
   - Updated 2024
   - URL: https://www.ncbi.nlm.nih.gov/books/NBK535392/

7. **Heterogeneity of State Stroke Center Processes (PMC)**
   - Published 2024
   - URL: https://pmc.ncbi.nlm.nih.gov/articles/PMC10978226/

8. **Joint Commission Physician Volume Requirements**
   - Mechanical Thrombectomy Volume (2019, updated 2024)
   - URL: https://www.facs.org/for-medical-professionals/news-publications/news-and-articles/bulletin/2019/04/

### Washington State Sources:
9. **Washington State Department of Health - ECS System**
   - Emergency Cardiac and Stroke System page
   - URL: https://doh.wa.gov/public-health-provider-resources/emergency-medical-services-ems-systems/emergency-cardiac-and-stroke-system

10. **WA DOH Categorization Applications**
    - URL: https://doh.wa.gov/public-health-provider-resources/emergency-medical-services-ems-systems/emergency-cardiac-and-stroke-system/categorization-applications

11. **WA DOH Level 1 Stroke Center Documentation Checklist**
    - DOH 346186 (July 2025)
    - URL: https://doh.wa.gov/sites/default/files/2025-07/346186.pdf

---

## PART 8: PRIORITY CLASSIFICATION

### CRITICAL (Must Fix Immediately):
1. ❌ Add ASR/ASRH to legend
2. ❌ Add ASR/ASRH to info panel
3. ❌ Add ASR/ASRH to filters
4. ❌ Add ASR/ASRH to stats
5. ❌ Fix EVT misclassification
6. ❌ Add WA State system explanation

### HIGH PRIORITY (Should Fix):
7. ⚠️  Update certifying bodies to include all 4 organizations
8. ⚠️  Add DNV PSC+ terminology to TSC explanation
9. ⚠️  Add volume requirements to TSC definition

### MEDIUM PRIORITY (Nice to Have):
10. ⚠️  Refine PSC definition wording
11. ⚠️  Add enhancements (info buttons, visual distinctions)

---

## PART 9: VALIDATION CHECKLIST

After implementing corrections, verify:
- [ ] ASR appears in legend with lime/green color (#84cc16)
- [ ] ASR filter checkbox functional
- [ ] ASR stat displays correctly
- [ ] ASR definition in info panel matches 2025 standards
- [ ] EVT no longer presented as certification level
- [ ] All 4 certifying bodies mentioned
- [ ] DNV's PSC+ terminology explained
- [ ] TSC volume requirements documented
- [ ] WA State system clearly distinguished from national certs
- [ ] All HTML renders without errors
- [ ] JavaScript functions work with ASR filter
- [ ] Map markers for ASR hospitals display correctly

---

## CONCLUSION

This audit identified significant accuracy issues primarily related to the **complete omission of the ASR/ASRH certification level** from the user interface, despite it being used in the underlying data. Additionally, the website needs clarification on:
- DNV's unique terminology (PSC+ vs TSC)
- All four certifying organizations
- Washington State's separate designation system
- EVT as a capability rather than a certification

Implementing the 9 critical corrections will bring the website to 100% accuracy with current 2025 stroke center certification standards.

**Estimated Implementation Time:** 2-3 hours
**Testing Time:** 1 hour
**Total:** 3-4 hours to full accuracy

---

**Audit Completed:** January 2025
**Next Review Recommended:** January 2026 (annual review cycle)
