# Record schema
Required identity: `asset_tag` or `serial_number`.

Fields: asset_tag, equipment_type, manufacturer, model, serial_number, unit_tag, site, building, floor, location_code, location_name, location_notes, install_status, audit_outcome, evidence_source, electrical_panel, electrical_circuit, disconnect_receptacle, power_source, refrigeration_type, refrigeration_system, refrigeration_circuit, utility_verification_status, notes.

Allowed outcomes: EXISTING_RECORD_VERIFIED, TAGGED_NOT_IN_NUVOLO, REPLACEMENT_FOUND, NEW_UNCATALOGED_ASSET, REVIEW_REQUIRED.

Empty asset tags are allowed only for NEW_UNCATALOGED_ASSET and REVIEW_REQUIRED. Use NEEDS_VERIFICATION instead of guessing expected-but-unproven values.
