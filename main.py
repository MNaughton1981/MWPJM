from fastapi import FastAPI,File,Form,UploadFile,Request
from fastapi.responses import HTMLResponse,FileResponse,RedirectResponse
from fastapi.templating import Jinja2Templates
from pathlib import Path
import json,subprocess,uuid,shutil
ROOT=Path(__file__).parent.parent; DATA=ROOT/'data'; DATA.mkdir(exist_ok=True); templates=Jinja2Templates(directory=str(ROOT/'app/templates')); app=FastAPI(title='Asset Registry Assistant')
@app.get('/',response_class=HTMLResponse)
def home(request:Request): return templates.TemplateResponse('index.html',{'request':request})
@app.post('/capture')
async def capture(photo:UploadFile=File(...), equipment_type:str=Form(''), manufacturer:str=Form(''), model:str=Form(''), serial_number:str=Form(''), unit_tag:str=Form(''), location_name:str=Form(''), notes:str=Form('')):
 case=uuid.uuid4().hex[:10]; ext=Path(photo.filename or 'photo.jpg').suffix or '.jpg'; image=DATA/f'{case}{ext}'; image.write_bytes(await photo.read())
 rec={'asset_tag':'','equipment_type':equipment_type,'manufacturer':manufacturer,'model':model,'serial_number':serial_number,'unit_tag':unit_tag,'location_name':location_name,'audit_outcome':'NEW_UNCATALOGED_ASSET','evidence_source':image.name,'electrical_panel':'NEEDS_VERIFICATION','electrical_circuit':'NEEDS_VERIFICATION','refrigeration_type':'NEEDS_VERIFICATION','notes':notes}
 raw=DATA/f'{case}.input.json';raw.write_text(json.dumps(rec));valid=DATA/f'{case}.json'
 with raw.open('rb') as i,valid.open('wb') as o: subprocess.run(['python',str(ROOT/'scripts/validate_record.py')],stdin=i,stdout=o,check=True)
 pdf=DATA/f'{case}.pdf';subprocess.run(['python',str(ROOT/'scripts/generate_article.py'),str(valid),str(image),str(pdf)],check=True)
 return RedirectResponse(f'/case/{case}',303)
@app.get('/case/{case}',response_class=HTMLResponse)
def review(case:str,request:Request):
 r=json.load(open(DATA/f'{case}.json'))[0];return templates.TemplateResponse('review.html',{'request':request,'case':case,'record':r})
@app.get('/download/{case}.pdf')
def download(case:str): return FileResponse(DATA/f'{case}.pdf',filename=f'{case}-asset-article.pdf')
