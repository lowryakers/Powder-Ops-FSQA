-- EXTRACTED VERBATIM from server/db.js so the import check runs against the
-- real DDL rather than a copy that can drift from it.
CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      -- Never cleared, same rule as products.legacy_sku: the tracker says "Mill
      -- Haven", the audit report says "Mill Haven Foods", the archive folder
      -- says "Exberry-GNT". A name that changes must still resolve.
      legacy_names TEXT NOT NULL DEFAULT '[]',
      vendor_type TEXT,              -- ingredient | packaging | equipment | service | laboratory
      actively_using INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'unqualified'
        CHECK (status IN ('unqualified','approved','conditionally_approved','not_approved','disqualified')),
      status_reason TEXT,
      status_set_by TEXT,
      status_set_at TEXT,
      website TEXT,
      address TEXT,
      notes TEXT,
      source TEXT,                   -- import | in_app
      external_id TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers(actively_using, status);

    -- 179 addresses live in 67 cells of the tracker, up to eight in one. Split
    -- into rows and marked with NO role: only 4 of the 179 are recognisably
    -- quality or regulatory, so inferring a role would be a guess on a
    -- compliance contact. The quality contact is learned from whoever sends
    -- FORM 404-1 marking the address they used.
    CREATE TABLE IF NOT EXISTS supplier_contacts (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      name TEXT,
      email TEXT,
      phone TEXT,
      role TEXT,                     -- quality | orders | sales | admin | NULL until someone says
      is_primary INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );
    CREATE INDEX IF NOT EXISTS idx_supplier_contacts ON supplier_contacts(supplier_id);

    -- The join the COA module has never had. coa_specifications is keyed on
    -- item_number with NO supplier link, and coa_requests records a laboratory
    -- but never a vendor — so ReadyDoc cannot today answer "which supplier's
    -- material failed this test", which is the question SOP 404 § V.E vendor
    -- monitoring is built on.
    CREATE TABLE IF NOT EXISTS supplier_materials (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      item_number TEXT,
      item_description TEXT NOT NULL,
      -- The distributor is not the maker. Confirmed by a person, never parsed
      -- out of a filename: attaching a BRC certificate to the wrong
      -- manufacturer is a qualification record that is quietly false.
      manufacturer_name TEXT,
      raw_material_questionnaire_at TEXT,
      risk_notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );
    CREATE INDEX IF NOT EXISTS idx_supplier_materials ON supplier_materials(supplier_id, is_active);
    CREATE INDEX IF NOT EXISTS idx_supplier_materials_item ON supplier_materials(item_number);

    CREATE TABLE IF NOT EXISTS supplier_qualifications (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      period_label TEXT,             -- '2025', '2026' — the folder name, kept as written; NULL = undated
      period_start TEXT,
      period_end TEXT,
      disposition TEXT
        CHECK (disposition IS NULL OR disposition IN ('approved','conditionally_approved','not_approved')),
      disposition_notes TEXT,        -- required for conditional and not-approved: the SOP names deficiencies
      risk_criteria TEXT NOT NULL DEFAULT '{}',   -- the SOP's SEVEN, transcribed
      questionnaire_requested_at TEXT,
      questionnaire_received_at TEXT,
      raw_material_questionnaire_at TEXT,
      audit_performed_at TEXT,
      next_review_due TEXT,
      decided_by TEXT,
      decided_at TEXT,
      signature_image TEXT,
      source TEXT,                   -- import | in_app | paper
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );
    CREATE INDEX IF NOT EXISTS idx_supplier_quals ON supplier_qualifications(supplier_id, period_label);
    CREATE INDEX IF NOT EXISTS idx_supplier_quals_due ON supplier_qualifications(next_review_due);

    CREATE TABLE IF NOT EXISTS supplier_files (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      qualification_id TEXT,
      material_id TEXT,
      kind TEXT NOT NULL,            -- see supplier-archive.js: questionnaire, certificate, sds, …
      period_label TEXT,
      lot_number TEXT,               -- a vendor CoA resolves from the receiving record without being copied there
      -- Read from the document, never invented. A certificate whose name states
      -- no date gets none: a lapsed certificate reading as current is worse
      -- than one with no date at all.
      expires_on TEXT,
      filename TEXT NOT NULL,
      storage_key TEXT,
      content_type TEXT,
      size INTEGER,
      extracted_text TEXT,           -- searched, never shipped to the client
      text_status TEXT,
      source_path TEXT,              -- the path inside the archive, verbatim. Provenance.
      uploaded_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );
    CREATE INDEX IF NOT EXISTS idx_supplier_files ON supplier_files(supplier_id, kind);
    CREATE INDEX IF NOT EXISTS idx_supplier_files_expiry ON supplier_files(expires_on);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_files_path ON supplier_files(supplier_id, source_path);
