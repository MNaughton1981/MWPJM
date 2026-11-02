#!/usr/bin/env python3
import argparse,json
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from PIL import Image

def main():
 p=argparse.ArgumentParser();p.add_argument('record_json');p.add_argument('photo');p.add_argument('output');a=p.parse_args();r=json.load(open(a.record_json));r=r[0] if isinstance(r,list) else r;c=canvas.Canvas(a.output,pagesize=letter);W,H=letter;c.setFillColorRGB(.09,.29,.45);c.rect(0,H-78,W,78,fill=1,stroke=0);c.setFillColorRGB(1,1,1);c.setFont('Helvetica-Bold',18);c.drawString(36,H-47,'ASSET ARTICLE PACKAGE - REVIEW DRAFT');c.setFillColorRGB(0,0,0)
 y=H-110
 for k in ['equipment_type','manufacturer','model','serial_number','unit_tag','location_name','audit_outcome','electrical_panel','electrical_circuit','refrigeration_type','refrigeration_system']:
  c.setFont('Helvetica-Bold',9);c.drawString(36,y,k.replace('_',' ').title()+':');c.setFont('Helvetica',9);c.drawString(155,y,str(r.get(k,''))[:70]);y-=17
 im=Image.open(a.photo);scale=min(520/im.width,300/im.height);c.drawImage(ImageReader(im),36,55,width=im.width*scale,height=im.height*scale,preserveAspectRatio=True);c.save()
if __name__=='__main__': main()
