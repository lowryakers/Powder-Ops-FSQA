# DCR draft — a controlled form for the outbound (shipping) truck inspection

**For Document Control (Daniela). Drafted 3 September 2026. Nothing here is decided by the app.**

The warehouse now works a Shipping Truck Inspection in ReadyDoc when a shipment leaves — the outbound
twin of FORM 204-01 — with photographs of the load attached before the doors close. **There is no
controlled form for it**: the Forms Master Index has none, SOP 205 (Shipping) issues none, and the paper
one was never worked. So the app files every inspection stamped **DRAFT-1** with **no form number**, and
says so on the record. This request asks Document Control to issue the form.

## What is asked

1. **Issue a form number** in the 200 series beside FORM 204-01 (the receiving inspection) — 205-01 would
   sit under SOP 205 Shipping, which is the procedure it belongs to. Document Control's call.
2. **Review the draft questions** below. They were drafted from SOP 205, the pre-load half of FORM 204-01
   turned around, and what an SQF outbound transport check asks. Corrections go to
   `server/shipping-checklist.js` before issue; after issue, any change is its own DCR.
3. On issue, the code takes the number and revision (V1), `controlled.js` parks the change, and it takes
   effect when approved in Controlled Changes. Records filed under DRAFT-1 keep saying DRAFT-1.

## The draft, as the app asks it

**Header:** Order / Pick List #, BOL #, Customer, Carrier, Truck/Trailer #, Driver Name, Seal #, Number of
Pallets. Number issued by the app: `S-100-####`.

**PRE-Load Inspection (empty trailer)**
- Trailer exterior intact (no holes, damage or leaks)
- Trailer interior clean, dry and odor-free
- Evidence of pests (droppings, insects, nesting) — *If YES, do not load — notify QA*
- Residue or spillage from a previous load (chemicals, allergens, other product) — *If YES, do not load — notify QA*
- Floor and walls sound (no exposed nails, splinters or sharp edges)
- Refrigeration running and at temperature — *applicable only if the shipment requires temperature control*

**LOAD Inspection**
- Correct product loaded (matches order / pick list)
- Correct quantity (case and pallet count match the BOL)
- Case and pallet labels readable and match the order
- Lot numbers recorded on the BOL / packing list
- Pallets wrapped, stable and braced for transit
- Allergen-containing product segregated from non-allergen product — *applicable if the load mixes both*
- Visible damage to product (crushed, torn or leaking cases) — *If YES, hold the affected product — notify QA*
- Photos of the loaded product taken before the doors closed — *attach them to this inspection*

**RELEASE - Paperwork and seal**
- BOL complete and signed by the driver
- Seal applied and seal number recorded on the BOL — *applicable if the shipment is sealed*
- Doors closed and secured
- Shipment entered in the system

**Sign-off:** "Truck inspected — release shipment", refused while any question is blank, while a required
QA escalation has not been sent, or while the photo question says Yes with no photograph attached.

## Questions for Document Control
- Is the QA escalation routing right (the same people as FORM 204-01)?
- Should a temperature reading be recorded when refrigeration applies, rather than a yes/no?
- Does SOP 205 need a line referencing the new form, as SOP 204 references 204-01?
