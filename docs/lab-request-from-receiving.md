# Lab samples from receiving: who does what

When something on QA's lab-test list arrives, ReadyDoc tells QA. QA starts the lab request with one tap.

## Warehouse

1. File the receiving line as usual.
2. **Always fill in the vendor lot.** The lab request uses it.
3. If ReadyDoc shows **LAB** on the line, set the sample aside, label it with the vendor lot, and tell QA where it is.

That is all. You do not fill in the lab request.

## QA

1. You get a ReadyBot message: "Lab sample due". It names the item, lot, PO and the tests.
2. Tap **Start the lab request** in the message.
   (Or open the receiving line in Receiving and tap **Start lab request**.)
3. The form is already filled in: item, description, lot, expiry, received date, vendor and tests. Check it.
4. Add the **lab** and, when it goes out, the **date sent**. Tap **Save**.
5. If the form says "Fill in: vendor lot", get the lot from the receiving line or the bag, then save.

Each receiving line gets one lab request. If one already exists, the button opens it instead.

## Late results

- If a sample is past its due date, it shows at the top of **COA → Lab Requests**, and QA gets one message each
  weekday morning.
- The due date is the date sent plus the lab's turnaround days. **Fill in the date sent and turnaround days**, or
  the sample cannot be checked for lateness.
- When results come in, enter them. The sample drops off the list.
