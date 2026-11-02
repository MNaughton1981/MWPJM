#!/usr/bin/env python3
import argparse,json,shutil
from pathlib import Path
from openpyxl import load_workbook
HEADERS=['Asset Barcode','Name','Manufacturer','Model Name','Serial Number','Unit Tag','Site','Building','Floor','Location Code','Location Name','Location Notes','Install Status','Audit Outcome','Evidence Source','Electrical Panel','Electrical Circuit','Disconnect / Receptacle','Power Source','Refrigeration Type','Refrigeration System / Rack','Refrigeration Circuit','Utility Verification Status','Auditor Notes']
KEYS=['asset_tag','equipment_type','manufacturer','model','serial_number','unit_tag','site','building','floor','location_code','location_name','location_notes','install_status','audit_outcome','evidence_source','electrical_panel','electrical_circuit','disconnect_receptacle','power_source','refrigeration_type','refrigeration_system','refrigeration_circuit','utility_verification_status','notes']
def main():
 p=argparse.ArgumentParser();p.add_argument('workbook');p.add_argument('record_json');p.add_argument('output');a=p.parse_args();shutil.copy2(a.workbook,a.output);wb=load_workbook(a.output);ws=wb['Proposed Updates'] if 'Proposed Updates' in wb.sheetnames else wb.create_sheet('Proposed Updates',0)
 if ws.max_row==1 and ws['A1'].value is None: ws.append(HEADERS)
 record=json.load(open(a.record_json)); record=record[0] if isinstance(record,list) else record; ws.append([record.get(k,'') for k in KEYS]);wb.save(a.output)
if __name__=='__main__': main()
