# For Document Control: the temperature and humidity limits (D-201)

**What changed in ReadyDoc.** The daily Temp & Humidity check now uses two limits, and both are
under document control in the app:

- Humidity must be **below 40%**.
- Temperature must be **below 78°F**.

If anyone changes either number in the code, the app keeps using the approved one until Document
Control approves the change. It works the same way as the scale tolerances and the ATP limit.

**What a record says now.** Each daily check names its reading, the limit and the form. For example:
"Humidity 41% OUT OF RANGE (limit below 40%, FORM 110-03 V2)." A reading at or above the limit
files the record as a fail. The task still completes, because the work was done. Adam still gets a
message at 39% humidity, one point early, as before.

**Questions for Document Control**

1. **Which document states 40% and 78°F?** The app names FORM 110-03 V2 (Temperature and
   Humidity Control) because that is the form the check is recorded on. If an SOP owns the numbers,
   tell us its number and revision, and the app will name it instead.
2. **Is "below" right?** The app treats exactly 40% as out of range, because the procedure says
   "below 40%". Before this change, the phone screen showed exactly 40% as a pass. If the plant
   means "40% or less", the document should say so, and the app will follow it.
3. **The form number.** Some screens still call this check Form 110-04. The register says
   110-03. This is already on the form-numbering list (`dcr-form-numbering.md`).

Nothing here changes a filed record. Checks filed before this change keep the wording they were
filed with.
