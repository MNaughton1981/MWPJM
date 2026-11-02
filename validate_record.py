#!/usr/bin/env python3
import json, sys
OUTCOMES={"EXISTING_RECORD_VERIFIED","TAGGED_NOT_IN_NUVOLO","REPLACEMENT_FOUND","NEW_UNCATALOGED_ASSET","REVIEW_REQUIRED"}
def clean(v): return " ".join(str(v or "").strip().split())
def validate(r):
 r={k:clean(v) for k,v in r.items()}; errors=[]
 if r.get('audit_outcome') not in OUTCOMES: errors.append('invalid audit_outcome')
 if not r.get('asset_tag') and not r.get('serial_number'): errors.append('asset_tag or serial_number is required')
 if r.get('audit_outcome') not in {'NEW_UNCATALOGED_ASSET','REVIEW_REQUIRED'} and not r.get('asset_tag'): errors.append('asset_tag is required for this outcome')
 r['validation_status']='PASS' if not errors else 'REVIEW_REQUIRED'; r['validation_errors']=errors; return r
if __name__=='__main__':
 data=json.load(sys.stdin); data=data if isinstance(data,list) else [data]; json.dump([validate(x) for x in data],sys.stdout,indent=2)
