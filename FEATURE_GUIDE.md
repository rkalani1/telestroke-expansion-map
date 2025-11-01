# Telestroke Network Expansion Planning - Feature Guide

Quick reference guide for the 5 expansion planning features.

---

## Feature 1: Show Nearest CSC/TSC Distance

**Button:** "Show Nearest CSC/TSC Distance"

**What it does:**
- Colors all hospital markers by their distance from the nearest Comprehensive (CSC) or Thrombectomy-Capable (TSC) center
- Green: <50 miles
- Yellow: 50-100 miles
- Red: >100 miles

**How to use:**
1. Click the button
2. View the color-coded map
3. Click any marker to see which CSC/TSC is nearest and the exact distance

**Use case:** Quickly identify which hospitals are well-served vs. underserved by advanced stroke centers

---

## Feature 2: Identify EVT Deserts

**Button:** "Identify EVT Deserts (>100mi)"

**What it does:**
- Highlights hospitals that are >100 miles from any 24/7 thrombectomy (EVT) center
- EVT deserts shown with pulsing red markers
- EVT centers shown in green
- Shows total count of hospitals in EVT deserts

**How to use:**
1. Click the button
2. Alert shows count (e.g., "28 hospitals in EVT deserts")
3. Pulsing red markers identify at-risk hospitals
4. Click markers for specific distances

**Use case:** Identify hospitals with limited access to mechanical thrombectomy for large vessel occlusion strokes

---

## Feature 3: Rank Expansion Candidates

**Button:** "Rank Expansion Candidates"

**What it does:**
- Scores all hospitals using objective criteria:
  - No stroke certification: +3 points
  - Not UW partner: +2 points
  - >75 miles from CSC/TSC: +2 points
  - >100 miles from EVT: +1 point
  - Has ASR/PSC: -1 point
- Shows top 20 hospitals in ranked list
- Colors map markers by priority score

**How to use:**
1. Click the button
2. Modal opens with top 20 ranked hospitals
3. Map shows all hospitals color-coded:
   - Red: Score 6+ (highest priority)
   - Orange: Score 4-5
   - Blue: Score 2-3
   - Green: Score 0-1
4. Review details for each hospital
5. Close modal to return to map

**Use case:** Data-driven prioritization for telestroke network expansion

---

## Feature 4: View Distance Matrix

**Button:** "View Distance Matrix"

**What it does:**
- Shows comprehensive table of ALL 103 hospitals with:
  - Hospital name, state, certification
  - UW partner status
  - Nearest CSC/TSC name and distance
  - Nearest EVT center name and distance
- Sortable by any column (click headers)
- Export to CSV for further analysis

**How to use:**
1. Click the button
2. Review full table of all hospitals
3. Click "Export to CSV" to download
4. Click column headers to sort (if implemented)
5. Close modal when done

**Use case:** Comprehensive analysis in spreadsheet format, board presentations, strategic planning

---

## Feature 5: Advanced Multi-Criteria Filter

**Button:** "Advanced Multi-Criteria Filter"

**What it does:**
- Allows complex filtering with multiple criteria (AND logic):
  - NOT a UW Partner (checkbox)
  - NO Stroke Certification (checkbox)
  - Distance from CSC >X miles (slider 0-200)
  - Distance from EVT >X miles (slider 0-200)
  - State filter (WA/ID/AK/All)

**How to use:**
1. Click the button to expand the filter panel
2. Select criteria:
   - Check boxes for UW partner/certification filters
   - Drag sliders to set minimum distances
   - Select state from dropdown
3. Click "Apply Advanced Filters"
4. View filtered results on map and in stats panel
5. Alert shows count of hospitals matching criteria
6. Click "Clear Advanced Filters" to reset

**Use case:** Find specific types of hospitals (e.g., "non-partner hospitals in Washington >100mi from EVT")

---

## Tips for Clinical Directors

### For Strategic Planning Meetings:
1. Use **Feature 3** (Rank Expansion Candidates) to identify top targets
2. Export **Feature 4** (Distance Matrix) to Excel for analysis
3. Use **Feature 5** (Advanced Filters) to explore different scenarios

### For Grant Applications:
1. Use **Feature 2** (EVT Deserts) to document coverage gaps
2. Export **Feature 4** (Distance Matrix) as supporting data
3. Show specific distances from Feature 1 in proposals

### For Board Presentations:
1. Display **Feature 1** (CSC/TSC Distance) to show current state
2. Show **Feature 2** (EVT Deserts) to highlight clinical need
3. Present **Feature 3** (Expansion Ranking) for data-driven recommendations

---

## Keyboard Shortcuts

- **Reset View:** Click "Reset All Filters" button
- **Close Modals:** Click red "Close" button in top-right corner
- **Export Data:** Use "Export to CSV" in any feature that supports it

---

## Data Sources

All distance calculations use the **Haversine formula** with Earth radius = 3959 miles (great-circle distance).

- **CSC/TSC Centers:** 8 total (4 CSC + 4 TSC)
- **EVT Centers:** 8 hospitals with hasELVO=true
- **All Hospitals:** 103 with verified coordinates

---

## Support

For questions about the features or data, refer to the complete **TESTING_REPORT.md** for detailed validation results.
