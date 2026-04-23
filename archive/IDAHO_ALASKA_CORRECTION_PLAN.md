# Idaho & Alaska Stroke Certification Correction Plan

## COMPARISON: Current Database vs. Required Corrections

### IDAHO HOSPITALS - ANALYSIS

#### ✅ MATCHES (Correctly certified or no changes needed):
1. **Benewah Community Hospital** (St. Maries) - ✅ No cert (correct)
2. **Boundary Community Hospital** (Bonners Ferry) - ✅ ASR (correct - Level III equivalent)
3. **Clearwater Valley Hospital & Clinics** (Orofino) - ✅ ASR (correct - matches "Clearwater Valley Health")
4. **Kootenai Health** (Coeur d'Alene) - ✅ PSC (correct - needs DNV note added)
5. **St. Mary's Hospital** (Cottonwood) - ✅ ASR (correct - matches "St. Mary's Health")
6. **Shoshone Medical Center** (Kellogg) - ✅ No cert (correct)

#### ⚠️ NEEDS UPDATES:
7. **St. Joseph Regional Medical Center** (Lewiston)
   - Current: PSC, hasELVO = FALSE
   - **Required: PSC, hasELVO = TRUE** (thrombectomy capable)
   - **ACTION: Add EVT capability**

8. **Steele Memorial Medical Center** (Salmon)
   - Current: ASR (Level III)
   - **Required: REMOVE** (not in your provided list)
   - **ACTION: Remove ASR certification**

#### ❓ DISCREPANCIES - HOSPITALS IN YOUR LIST BUT NOT IN OUR DATABASE:
- **Bonner General Hospital** (Sandpoint, ID) - Should be Level III/ASR
- **Gritman Medical Center** (Moscow, ID) - No cert
- **Syringa General Hospital** (Grangeville, ID) - No cert

#### ❓ IN OUR DATABASE BUT NOT IN YOUR LIST:
- **CASCADE MEDICAL CENTER** (Cascade, ID) - Currently no cert
- **ST LUKE'S MCCALL** (McCall, ID) - Currently no cert
- **NORTHWEST SPECIALTY HOSPITAL** (Post Falls, ID) - Currently no cert
  - *Could this be "Post Falls ER & Hospital"?*

---

### ALASKA HOSPITALS - ANALYSIS

#### ✅ ALL CORRECT (All already have NO certification):
1. **Bartlett Regional Hospital** (Juneau) - ✅ None
2. **PeaceHealth Ketchikan Medical Center** (Ketchikan) - ✅ None
3. **Petersburg Medical Center** (Petersburg) - ✅ None
4. **SEARHC Wrangell Medical Center** (Wrangell) - ✅ None
5. **Southeast Alaska Regional Health Consortium** (Sitka/Mt. Edgecumbe) - ✅ None

**Note:** Your list mentions "Mt. Edgecumbe Hospital/SEARHC" - we have "Southeast Alaska Regional Health Consortium" which is the same facility.

---

## PROPOSED CORRECTIONS

### Changes to Make:

#### IDAHO (2 corrections):

1. **Kootenai Health** (Coeur d'Alene):
   ```
   Current: strokeCertificationType = "PSC", certifyingBody = "Idaho DOH"
   Update to: Add certificationDetails = "Idaho TSE Level II Stroke Center - DNV Accredited"
   ```

2. **St. Joseph Regional Medical Center** (Lewiston):
   ```
   Current: hasELVO = false
   Update to: hasELVO = true
   Add certificationDetails: "Idaho TSE Level II Stroke Center - Thrombectomy capable with interventional neuroradiology"
   ```

3. **Steele Memorial Medical Center** (Salmon):
   ```
   Current: strokeCertificationType = "ASR", certifyingBody = "Idaho DOH"
   Update to: strokeCertificationType = null, certifyingBody = null
   Reason: Not in your verified list of Idaho TSE designated facilities
   ```

#### ALASKA (0 corrections):
- All Alaska hospitals already correctly show NO certification ✅

---

## QUESTIONS FOR USER:

1. **Missing Hospitals:** Should I add these 3 hospitals to the database?
   - Bonner General Hospital (Sandpoint, ID)
   - Gritman Medical Center (Moscow, ID)
   - Syringa General Hospital (Grangeville, ID)

2. **Extra Hospitals:** What should I do with these hospitals in our database?
   - CASCADE MEDICAL CENTER (Cascade, ID)
   - ST LUKE'S MCCALL (McCall, ID)
   - STEELE MEMORIAL MEDICAL CENTER (Salmon, ID)

3. **Name Clarification:** Is "NORTHWEST SPECIALTY HOSPITAL" in Post Falls the same as "Post Falls ER & Hospital" in your list?

---

## SUMMARY OF CHANGES IF APPROVED:

- **Idaho corrections:** 2-3 hospitals updated
- **Alaska corrections:** 0 (all already correct)
- **Total stroke certified:** 31 → 30 (if we remove Steele Memorial's ASR)
- **EVT-capable:** 9 → 10 (adding St. Joseph Regional)

