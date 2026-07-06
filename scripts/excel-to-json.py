#!/usr/bin/env python3
"""Convert the Monday.com COA Tracker Excel export to JSON for import."""
import sys, json, openpyxl

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/excel-to-json.py <xlsx-file>", file=sys.stderr)
        sys.exit(1)

    wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
    ws = wb.active

    # Find the header row (row 5 in the Monday export)
    header_row = None
    for row_idx in range(1, min(20, ws.max_row + 1)):
        val = ws.cell(row=row_idx, column=1).value
        if val == 'Name':
            header_row = row_idx
            break

    if header_row is None:
        print("Could not find header row (looking for 'Name' in column A)", file=sys.stderr)
        sys.exit(1)

    # Column mapping (A=1 based)
    # A: Name (item #), B: Status, C: Item Description, D: Lot #,
    # E: Product Expiration Date, F: Tests Performed, G: Lab Results (link),
    # H: Date Sent To Lab, I: TAT Request, J: Expected Results,
    # K: Date of Results, L: COA FOR CUSTOMERS (link), M: Lab Used,
    # N: QA who requested, O: Last updated, P: Re-Test Required

    records = []
    for row_idx in range(header_row + 1, ws.max_row + 1):
        item_number = ws.cell(row=row_idx, column=1).value
        if not item_number:
            continue
        item_number = str(item_number).strip()

        # Skip header-like rows
        if item_number in ('Name', 'Status', 'Item Description'):
            continue

        status = ws.cell(row=row_idx, column=2).value or ''
        if str(status).strip() == 'Status':
            continue

        desc = ws.cell(row=row_idx, column=3).value or ''
        lot = ws.cell(row=row_idx, column=4).value or ''
        exp = ws.cell(row=row_idx, column=5).value
        tests = ws.cell(row=row_idx, column=6).value or ''
        date_sent = ws.cell(row=row_idx, column=8).value
        tat = ws.cell(row=row_idx, column=9).value
        expected = ws.cell(row=row_idx, column=10).value
        date_results = ws.cell(row=row_idx, column=11).value
        lab = ws.cell(row=row_idx, column=13).value or 'CTLA'
        requester = ws.cell(row=row_idx, column=14).value
        retest = ws.cell(row=row_idx, column=16).value

        def fmt_date(v):
            if v is None:
                return None
            if hasattr(v, 'strftime'):
                return v.strftime('%Y-%m-%d')
            return str(v).split(' ')[0] if str(v).strip() else None

        records.append({
            'item_number': item_number,
            'item_description': str(desc).strip(),
            'lot_number': str(lot).strip(),
            'product_expiration': fmt_date(exp),
            'tests_requested': str(tests).strip() or 'Unknown',
            'status': str(status).strip(),
            'lab_name': str(lab).strip() if lab else 'CTLA',
            'date_sent': fmt_date(date_sent),
            'tat_days': int(tat) if tat and str(tat).strip().isdigit() else None,
            'expected_results_date': fmt_date(expected),
            'date_of_results': fmt_date(date_results),
            'requested_by': str(requester).strip() if requester else None,
            'retest_required': bool(retest),
        })

    json.dump(records, sys.stdout, indent=2, default=str)
    print(f"\nExtracted {len(records)} records", file=sys.stderr)

if __name__ == '__main__':
    main()
