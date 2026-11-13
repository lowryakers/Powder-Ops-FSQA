# Test record: ReadyDoc refuses supplier approval without a third-party GMP certificate

Finding: DS 2.3–2.3.4.6 (supplier audits). Rule: SOP 404, as revised 10/28/26.
Purpose: to show the auditor that ReadyDoc stops a raw-material or packaging supplier being approved
until a current third-party GMP certificate is on file.

Do this once in the live app and save a screenshot at each step. The date and time are on the screen
and in the record's history.

| Step | Do this | You should see | Screenshot | Pass? |
|---|---|---|---|---|
| 1 | Suppliers page, top right. Set **GMP certificate on approval** to **On — refuse approval**. (Admin only.) | The switch reads "On". | 1 | |
| 2 | Open a raw-material supplier that has no GMP certificate yet (for example Shandong Sanyuan Biotech). | The GMP certificate section says "No third-party GMP certificate on file". | 2 | |
| 3 | Press **Record a disposition**, choose **Approved**, fill in the rest, save. | ReadyDoc refuses: "Not approved: No third-party GMP certificate on file." The supplier is not approved. | 3 | |
| 4 | Press **Attach GMP certificate**. Attach the certificate and enter its expiry date. | The section now says "Current" with the expiry date. | 4 | |
| 5 | Press **Record a disposition** again, choose **Approved**, save. | The supplier is now approved. | 5 | |
| 6 | Repeat steps 4–5 for Darigold (non-fat dry milk). | Certificate "Current", supplier approved. | 6 | |

Performed by: ______________________  Date: __________

Reviewed by (Quality): ______________  Date: __________

Notes:
- Only a current certificate counts. An expired one, or one with no expiry date, is treated as missing.
- The check applies when a supplier is approved for the first time and at the yearly re-approval.
