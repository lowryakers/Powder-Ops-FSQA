#!/usr/bin/env python3
"""Convert the old Lab Testing Log CSV to JSON for import."""
import sys, json, csv

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/csv-to-json.py <csv-file>", file=sys.stderr)
        sys.exit(1)

    with open(sys.argv[1], 'r', encoding='utf-8-sig') as f:
        reader = csv.reader(f)
        headers = next(reader)
        rows = list(reader)

    # Headers (may have embedded newlines from the export):
    # 0: Item #, 1: STATUS, 2: Item Description, 3: Lot # / Link to Results
    # 4: Tests Performed, 5: Date Sent to Lab, 6: TAT Request
    # 7: Date of Results, 8: COA link for Customer, 9: Date Sent to Customer
    # 10: Lab Used, 11: Invoiced Amount, 12: Notes

    records = []
    for row in rows:
        if len(row) < 3:
            continue
        item_number = row[0].strip()
        if not item_number:
            continue

        status = row[1].strip() if len(row) > 1 else ''
        desc = row[2].strip() if len(row) > 2 else ''
        lot = row[3].strip() if len(row) > 3 else ''
        tests = row[4].strip() if len(row) > 4 else ''
        date_sent = row[5].strip() if len(row) > 5 else ''
        tat = row[6].strip() if len(row) > 6 else ''
        date_results = row[7].strip() if len(row) > 7 else ''
        date_to_customer = row[9].strip() if len(row) > 9 else ''
        lab = row[10].strip() if len(row) > 10 else 'CTLA'
        invoice = row[11].strip() if len(row) > 11 else ''
        notes = row[12].strip() if len(row) > 12 else ''

        records.append({
            'item_number': item_number,
            'item_description': desc,
            'lot_number': lot,
            'tests_requested': tests or 'Unknown',
            'status': status,
            'lab_name': lab or 'CTLA',
            'date_sent': date_sent or None,
            'tat_days': int(tat) if tat.isdigit() else None,
            'date_of_results': date_results or None,
            'date_sent_to_customer': date_to_customer or None,
            'invoice_amount': invoice or None,
            'notes': notes or None,
        })

    json.dump(records, sys.stdout, indent=2, default=str)
    print(f"\nExtracted {len(records)} records", file=sys.stderr)

if __name__ == '__main__':
    main()
