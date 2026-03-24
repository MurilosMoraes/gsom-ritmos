#!/usr/bin/env python3
"""
GERADOR PROFISSIONAL COMPLETO — GDrums
Todos os 131 ritmos gerados em 12 canais, qualidade profissional.
NÃO TOCA nos 9 originais gaúchos feitos à mão.

12 Channels:
  0=bumbo 1=caixa 2=tom1 3=tom2 4=hhc 5=hho 6=crash 7=surdo
  8=aro 9=china 10=ride 11=rototom

Regras de produção:
- Rototom: só em gêneros latinos, brasileiros, jazz, funk — NUNCA em rock/metal/punk
- China: só em acentos fortes — fills e endings
- Aro (cross-stick): ghost notes sutis, bossa nova, jazz, baladas, reggae
- Ride: jazz, bossa, soul, variações mais maduras
- Ghost notes: essenciais para funk, soul, samba, jazz
- Dinâmica: PP(0.2) P(0.35) MP(0.5) MF(0.65) F(0.8) FF(0.95) FFF(1.0)
"""
import json, os

# ─── Constants ────────────────────────────────────────────────────────
BU=0; CX=1; T1=2; T2=3; HC=4; HO=5; CR=6; SU=7; AR=8; CH=9; RI=10; RO=11
PP=0.2; P=0.35; MP=0.5; MF=0.65; F=0.8; FF=0.95; FFF=1.0

AF12 = [
    {"fileName":"bumbo.wav","audioData":"","midiPath":"/midi/bumbo.wav"},
    {"fileName":"caixa.wav","audioData":"","midiPath":"/midi/caixa.wav"},
    {"fileName":"tom_1.wav","audioData":"","midiPath":"/midi/tom_1.wav"},
    {"fileName":"tom_2.wav","audioData":"","midiPath":"/midi/tom_2.wav"},
    {"fileName":"chimbal_fechado.wav","audioData":"","midiPath":"/midi/chimbal_fechado.wav"},
    {"fileName":"chimbal_aberto.wav","audioData":"","midiPath":"/midi/chimbal_aberto.wav"},
    {"fileName":"prato.mp3","audioData":"","midiPath":"/midi/prato.mp3"},
    {"fileName":"surdo.wav","audioData":"","midiPath":"/midi/surdo.wav"},
    {"fileName":"aro.wav","audioData":"","midiPath":"/midi/aro.wav"},
    {"fileName":"china.wav","audioData":"","midiPath":"/midi/china.wav"},
    {"fileName":"ride.wav","audioData":"","midiPath":"/midi/ride.wav"},
    {"fileName":"rototom.wav","audioData":"","midiPath":"/midi/rototom.wav"},
]

ORIGINALS = {'Banda (bailão).json','Bugio.json','Chamamé.json','Guarânia.json',
             'Katchaka.json','Milonga.json','Valsa.json','Vaneira.json','Xote.json'}

def V(steps, h, spd=1):
    """Variation builder"""
    pa=[[False]*steps for _ in range(12)]
    vo=[[0.0]*steps for _ in range(12)]
    for c,d in h.items():
        for s,v in d:
            if 0<=s<steps: pa[c][s]=True; vo[c][s]=round(v,2)
    return {"pattern":pa,"volumes":vo,"audioFiles":[dict(a) for a in AF12],"steps":steps,"speed":spd}

def R(name,tempo,bpb,cat,ms,fs,es,ist,mains,fills,end,intro):
    return (name, {"version":"1.5","tempo":tempo,"beatsPerBar":bpb,"category":cat,
        "patternSteps":{"main":ms,"fill":fs,"end":es,"intro":ist},
        "variations":{"main":mains,"fill":fills,"end":[end],"intro":[intro]},
        "fillStartSound":{"fileName":"prato.mp3","midiPath":"/midi/prato.mp3"},
        "fillReturnSound":{"fileName":"prato.mp3","midiPath":"/midi/prato.mp3"},
        "timestamp":"2026-03-24T12:00:00.000Z"})

# ─── Pattern helpers ──────────────────────────────────────────────────
def h8(v=MF,a=F): return [(i,a if i%4==0 else v) for i in range(0,16,2)]
def h16(v=P,m=MP,a=MF): return [(i,a if i%4==0 else(m if i%2==0 else v)) for i in range(16)]
def r8(v=MF,b=F): return [(i,b if i%4==0 else v) for i in range(0,16,2)]
def rj(v=MF,s=P): return [(0,F),(2,s),(4,v),(6,s),(8,F),(10,s),(12,v),(14,s)]

# ─── Fill templates ───────────────────────────────────────────────────
def fill_rock16():
    return V(16,{BU:[(0,FF),(8,FF),(14,FFF)],T1:[(0,FF),(1,F)],T2:[(2,FF),(3,F)],
        SU:[(4,FF),(5,FF),(6,F),(7,MF)],CX:[(8,F),(9,F),(10,FF),(11,FF),(12,FFF),(13,FFF)],CR:[(15,FFF)]})
def fill_rock8():
    return V(8,{BU:[(0,FF),(7,FFF)],T1:[(0,FF)],T2:[(1,FF),(2,F)],SU:[(3,FF),(4,F)],
        CX:[(5,FF),(6,FFF)],CR:[(7,FFF)]})
def fill_roll16():
    return V(16,{CX:[(i,PP+(FFF-PP)*i/15) for i in range(16)],BU:[(0,FF),(4,FF),(8,FF),(12,FFF)],CR:[(15,FFF)]})
def fill_latin16():
    return V(16,{BU:[(0,FF),(4,FF),(8,FF),(14,FFF)],T1:[(0,F),(1,MF)],RO:[(2,F),(3,MF)],T2:[(4,FF),(5,F)],
        SU:[(6,FF),(7,F),(8,FF)],CX:[(9,F),(10,FF),(11,FF),(12,FFF),(13,FFF)],CR:[(15,FFF)],CH:[(14,FF)]})
def fill_latin8():
    return V(8,{BU:[(0,F),(7,FFF)],T1:[(0,FF)],RO:[(1,F)],T2:[(2,FF)],SU:[(3,FF),(4,F)],
        CX:[(5,FF),(6,FFF)],CR:[(7,FFF)]})
def fill_jazz16():
    return V(16,{BU:[(0,MF),(8,MF),(14,F)],RI:[(0,MF),(2,P),(4,MF),(6,P)],
        CX:[(8,MF),(9,MP),(10,F),(11,F),(12,FF),(13,FF)],SU:[(14,FF)],CR:[(15,FF)]})
def fill_gospel16():
    return V(16,{BU:[(0,FF),(4,FF),(8,FF),(14,FFF)],T1:[(0,F),(1,MF)],RO:[(2,F),(3,MF)],T2:[(4,FF),(5,F)],
        SU:[(6,FF),(7,F),(8,FF)],CX:[(9,F),(10,FF),(11,FF),(12,FFF),(13,FFF)],CR:[(15,FFF)],CH:[(14,FF)]})
def fill_electro16():
    return V(16,{CX:[(i,P+(FF-P)*i/15) for i in range(16)],HO:[(15,FF)],BU:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],CR:[(15,FFF)]})

# End templates
def end_rock():
    return V(16,{BU:[(0,FFF),(4,FF),(8,FF),(12,FFF),(15,FFF)],CX:[(2,F),(6,F),(10,FF),(13,FF),(14,FFF)],
        T1:[(1,F)],T2:[(3,F),(5,F)],SU:[(7,FF),(8,FF),(9,F)],CR:[(0,F),(15,FFF)],CH:[(12,FF)]})
def end_latin():
    return V(16,{BU:[(0,FFF),(3,F),(8,FF),(12,FFF),(15,FFF)],CX:[(1,MF),(4,FF),(5,F),(6,MF)],
        T1:[(7,FF)],T2:[(8,FF),(9,F)],SU:[(10,FF),(11,F),(12,FF)],RO:[(13,MF),(14,MF)],CR:[(0,MF),(15,FFF)]})
def end_jazz():
    return V(16,{BU:[(0,MF),(4,MF),(8,MF),(12,F),(15,FF)],RI:rj(),CX:[(8,MF),(10,F),(12,FF)],
        T2:[(13,MF)],SU:[(14,FF)],CR:[(0,MP),(15,FF)]})
def end_gospel():
    return V(16,{BU:[(0,FFF),(4,FF),(8,FF),(12,FFF),(15,FFF)],CX:[(2,F),(6,F),(10,FF),(13,FF),(14,FFF)],
        T1:[(1,F)],T2:[(3,F),(5,F)],SU:[(7,FF),(8,FF),(9,F)],RO:[(11,MF)],CR:[(0,F),(15,FFF)],CH:[(12,FF)]})

# Intro templates
def intro4(): return V(8,{HC:[(0,FF),(2,MF),(4,MF),(6,MF)],AR:[(0,MP),(2,P),(4,P),(6,P)]})
def intro6(): return V(12,{HC:[(0,FF),(4,MF),(8,MF)],RI:[(0,PP)],AR:[(2,PP),(6,PP),(10,PP)]})
def intro_jazz(): return V(8,{RI:[(0,MF),(2,P),(4,MF),(6,P)],HC:[(2,MP),(6,MP)],BU:[(0,PP)]})

# ═══════════════════════════════════════════════════════════════════════
ALL = []

# ────────────────────────── POP/ROCK ──────────────────────────────────

ALL.append(R("Pop Basic",110,4,"Pop/Rock",16,16,16,8,
  [V(16,{BU:[(0,F),(8,F),(10,MP)],CX:[(4,F),(12,F)],HC:h8(),AR:[(3,PP),(7,PP),(11,PP),(15,PP)],RI:[(0,P),(4,P),(8,P),(12,P)]}),
   V(16,{BU:[(0,F),(6,MP),(8,F),(10,MP),(14,P)],CX:[(4,F),(12,F),(15,PP)],HC:h16(),RI:[(0,P),(8,P)]}),
   V(16,{BU:[(0,F),(3,P),(8,F),(10,MP)],CX:[(4,F),(12,F)],RI:r8(),HC:[(4,MP),(12,MP)],CH:[(0,MP)]})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Pop Shuffle",108,4,"Pop/Rock",16,16,16,8,
  [V(16,{BU:[(0,F),(8,F)],CX:[(4,F),(12,F)],HC:[(0,F),(2,P),(4,F),(6,P),(8,F),(10,P),(12,F),(14,P)],AR:[(6,PP),(14,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(6,MP),(8,F)],CX:[(4,F),(12,F),(14,PP)],HC:[(0,F),(2,P),(4,F),(6,P),(8,F),(10,P),(12,F),(14,P)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(8,F),(10,MF)],CX:[(4,F),(12,F)],HC:[(0,MF),(2,P),(4,MF),(6,P),(8,MF),(10,P),(12,MF),(14,P)],HO:[(6,MP)],RI:[(0,PP),(8,PP)]})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Rock Straight",130,4,"Pop/Rock",16,16,16,8,
  [V(16,{BU:[(0,FF),(8,FF)],CX:[(4,FF),(12,FF)],HC:h8(MF,FF),AR:[(2,PP),(6,PP),(10,PP),(14,PP)]}),
   V(16,{BU:[(0,FF),(6,MF),(8,FF)],CX:[(4,FF),(12,FF)],HC:h8(MF,FF),RI:[(0,P),(8,P)]}),
   V(16,{BU:[(0,FF),(8,FF),(10,F)],CX:[(4,FF),(12,FF)],RI:r8(F,FF),HC:[(4,MF),(12,MF)],CH:[(0,MF)]})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Hard Rock",140,4,"Pop/Rock",16,16,16,8,
  [V(16,{BU:[(0,FFF),(2,F),(8,FFF),(10,F)],CX:[(4,FFF),(12,FFF)],HC:h8(F,FF),CH:[(0,MP)]}),
   V(16,{BU:[(0,FFF),(2,F),(6,MF),(8,FFF),(10,F),(14,MF)],CX:[(4,FFF),(12,FFF)],HC:h8(F,FF),RI:[(0,P),(8,P)]}),
   V(16,{BU:[(0,FFF),(2,F),(8,FFF),(10,F)],CX:[(4,FFF),(12,FFF)],CR:[(0,FF),(4,F),(8,FF),(12,F)],RI:r8(MF,F)})],
  [V(16,{BU:[(0,FFF),(4,FFF),(8,FFF),(12,FFF),(15,FFF)],T1:[(0,FF),(1,F)],T2:[(2,FF),(3,F)],
     SU:[(4,FF),(5,FF),(6,F),(7,MF)],CX:[(8,FF),(9,FF),(10,FFF),(11,FFF),(12,FFF),(13,FFF),(14,FFF)],CH:[(15,FFF)]}),
   V(8,{BU:[(0,FFF),(4,FFF),(7,FFF)],T1:[(0,FF),(1,F)],T2:[(2,FF),(3,F)],SU:[(4,FF),(5,F)],CX:[(6,FFF)],CR:[(7,FFF)]}),
   V(16,{CX:[(i,MF+(FFF-MF)*i/15) for i in range(16)],BU:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],CH:[(15,FFF)]})],
  V(16,{BU:[(0,FFF),(2,FF),(4,FFF),(8,FFF),(10,FF),(12,FFF),(15,FFF)],CX:[(1,F),(3,F),(5,FF),(6,FF),(7,FFF)],
     T1:[(8,FF)],T2:[(9,FF)],SU:[(10,FF),(11,FF)],CR:[(0,FF),(15,FFF)],CH:[(7,FFF)]}),
  intro4()))

ALL.append(R("Punk Rock",180,4,"Pop/Rock",16,8,16,8,
  [V(16,{BU:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],CX:[(2,FF),(6,FF),(10,FF),(14,FF)],HC:h8(F,FF)}),
   V(16,{BU:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],CX:[(2,FF),(6,FF),(10,FF),(14,FF)],CR:[(0,FF),(4,FF),(8,FF),(12,FF)]}),
   V(16,{BU:[(0,FFF),(2,F),(4,FFF),(6,F),(8,FFF),(10,F),(12,FFF),(14,F)],CX:[(4,FFF),(12,FFF)],HC:h16(MF,F,FF)})],
  [V(16,{CX:[(i,MF+(FFF-MF)*i/15) for i in range(16)],BU:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],CR:[(15,FFF)]}),
   V(8,{BU:[(0,FFF),(4,FFF),(7,FFF)],T1:[(0,FF)],T2:[(2,FF)],SU:[(4,FF)],CX:[(5,FF),(6,FFF)],CR:[(7,FFF)]}),
   fill_rock16()],
  end_rock(),intro4()))

ALL.append(R("Grunge",118,4,"Pop/Rock",16,16,16,8,
  [V(16,{BU:[(0,FF),(8,FF)],CX:[(4,FF),(12,FF)],HC:h8(),HO:[(14,MF)],AR:[(2,PP),(10,PP)]}),
   V(16,{BU:[(0,FF),(6,MP),(8,FF)],CX:[(4,FF),(12,FF)],HC:h8(),HO:[(14,MF)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,FF),(8,FF),(10,MF)],CX:[(4,FF),(12,FF),(14,PP)],HC:h8(),HO:[(6,MP),(14,MF)]})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Metal",160,4,"Pop/Rock",16,16,16,8,
  [V(16,{BU:[(i,FF) for i in range(0,16,2)],CX:[(4,FFF),(12,FFF)],HC:h16(MF,F,FF)}),
   V(16,{BU:[(i,FF) for i in range(16)],CX:[(4,FFF),(12,FFF)],CR:[(0,FF),(4,F),(8,FF),(12,F)]}),
   V(16,{BU:[(0,FFF),(1,FF),(4,FFF),(5,FF),(8,FFF),(9,FF),(12,FFF),(13,FF)],CX:[(2,FF),(6,FF),(10,FF),(14,FF)],HC:h8(FF,FFF)})],
  [V(16,{BU:[(i,FF) for i in range(0,16,2)]+[(15,FFF)],CX:[(1,FF),(3,FF),(5,FF),(7,FF),(9,FFF),(11,FFF),(13,FFF)],
     T1:[(8,FF)],T2:[(10,FF)],SU:[(12,FFF)],CH:[(15,FFF)]}),
   V(8,{BU:[(0,FFF),(2,FFF),(4,FFF),(7,FFF)],T1:[(0,FF)],T2:[(2,FF)],SU:[(4,FFF)],CX:[(5,FFF),(6,FFF)],CR:[(7,FFF)]}),
   fill_roll16()],
  V(16,{BU:[(i,FFF) for i in range(0,16,2)]+[(15,FFF)],CX:[(1,FF),(3,FF),(5,FFF),(7,FFF)],
     T1:[(8,FF)],T2:[(9,FF),(10,FF)],SU:[(11,FFF),(12,FFF)],CR:[(0,FF),(15,FFF)],CH:[(13,FFF)]}),
  intro4()))

ALL.append(R("Power Ballad",72,4,"Pop/Rock",16,16,16,8,
  [V(16,{BU:[(0,F),(8,MF)],CX:[(8,F)],HC:h8(MP,MF),AR:[(4,P),(12,P)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(6,P),(8,MF)],CX:[(8,F)],HC:h8(MP,MF),AR:[(4,P),(12,P)],HO:[(14,P)]}),
   V(16,{BU:[(0,F),(8,MF)],CX:[(8,F)],RI:r8(MP,MF),HC:[(4,MP),(12,MP)]})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Surf Rock",160,4,"Pop/Rock",16,16,16,8,
  [V(16,{BU:[(0,FF),(4,FF),(8,FF),(12,FF)],CX:[(4,FF),(12,FF)],RI:r8(F,FF),SU:[(2,PP),(10,PP)]}),
   V(16,{BU:[(0,FF),(4,FF),(8,FF),(12,FF)],CX:[(4,FF),(12,FF)],T2:[(i,MF) for i in range(16)]}),
   V(16,{BU:[(0,FF),(4,FF),(8,FF),(12,FF)],CX:[(4,FF),(12,FF)],RI:r8(F,FF),T2:[(2,P),(6,P),(10,P),(14,P)]})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Indie Rock",120,4,"Pop/Rock",16,16,16,8,
  [V(16,{BU:[(0,F),(8,F)],CX:[(4,F),(12,F)],HC:h8(MF,F),AR:[(6,PP),(14,PP)]}),
   V(16,{BU:[(0,F),(10,MF)],CX:[(4,F),(12,F)],HC:h8(MF,F),RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(6,P),(8,F)],CX:[(4,F),(12,F)],HC:h8(),HO:[(14,MP)]})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Classic Rock",100,4,"Pop/Rock",16,16,16,8,
  [V(16,{BU:[(0,FF),(1,PP),(8,FF)],CX:[(4,FF),(5,PP),(12,FF),(13,PP)],HC:h8(F,FF),AR:[(3,PP),(11,PP)]}),
   V(16,{BU:[(0,FF),(1,PP),(8,FF),(10,MF)],CX:[(4,FF),(5,PP),(12,FF),(13,PP)],HC:h8(F,FF)}),
   V(16,{BU:[(0,FF),(8,FF)],CX:[(4,FF),(12,FF)],RI:r8(F,FF),HC:[(4,MF),(12,MF)]})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Blues Shuffle",90,4,"Pop/Rock",16,16,16,8,
  [V(16,{BU:[(0,F),(8,F)],CX:[(4,MF),(12,MF)],HC:[(0,F),(2,P),(4,F),(6,P),(8,F),(10,P),(12,F),(14,P)],AR:[(6,PP),(14,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(6,P),(8,F)],CX:[(4,MF),(12,MF)],HC:[(0,F),(2,P),(4,F),(6,P),(8,F),(10,P),(12,F),(14,P)],AR:[(3,PP),(11,PP)]}),
   V(16,{BU:[(0,F),(8,F)],CX:[(4,MF),(12,MF)],RI:[(0,F),(2,MP),(4,F),(6,MP),(8,F),(10,MP),(12,F),(14,MP)],HC:[(4,MP),(12,MP)]})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Country",120,4,"Pop/Rock",16,16,16,8,
  [V(16,{BU:[(0,F),(8,F)],CX:[(4,F),(12,F)],HC:h8(MF,F),AR:[(2,PP),(10,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(4,MF),(8,F),(12,MF)],CX:[(4,F),(12,F)],HC:h8(MF,F),AR:[(6,PP),(14,PP)]}),
   V(16,{BU:[(0,F),(8,F)],CX:[(4,F),(12,F)],RI:r8(MF,F),HC:[(4,MP),(12,MP)]})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Country Train Beat",150,4,"Pop/Rock",16,16,16,8,
  [V(16,{BU:[(0,F),(8,F)],CX:[(i,FF if i in[2,6,10,14] else P) for i in range(16) if i not in[0,8]],HC:[(2,MF),(6,MF),(10,MF),(14,MF)],AR:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(8,F)],CX:[(i,FF if i in[2,6,10,14] else MP) for i in range(16) if i not in[0,8]],RI:[(0,PP),(4,PP),(8,PP),(12,PP)]}),
   V(16,{BU:[(0,F),(4,MF),(8,F),(12,MF)],CX:[(i,FF if i in[2,6,10,14] else P) for i in range(16) if i not in[0,4,8,12]],HC:[(2,MF),(6,MF),(10,MF),(14,MF)]})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Disco",120,4,"Pop/Rock",16,16,16,8,
  [V(16,{BU:[(0,FF),(4,FF),(8,FF),(12,FF)],CX:[(4,F),(12,F)],HC:h16(P,MP,MF),HO:[(2,MP),(6,MP),(10,MP),(14,MP)],AR:[(3,PP),(11,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,FF),(4,FF),(8,FF),(12,FF)],CX:[(4,F),(12,F)],HC:h8(MF,F),HO:[(2,MP),(6,MP),(10,MP),(14,MP)]}),
   V(16,{BU:[(0,FF),(4,FF),(8,FF),(12,FF)],CX:[(4,F),(12,F)],HC:h16(PP,P,MF),RI:[(0,P),(4,P),(8,P),(12,P)]})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Motown",115,4,"Pop/Rock",16,16,16,8,
  [V(16,{BU:[(0,F),(4,F),(8,F),(12,F)],CX:[(0,MF),(4,MF),(8,MF),(12,MF)],HC:h8(MF,F),AR:[(2,PP),(6,PP),(10,PP),(14,PP)]}),
   V(16,{BU:[(0,F),(4,F),(8,F),(12,F)],CX:[(0,MF),(4,MF),(8,MF),(12,MF)],HC:h16(P,MP,MF)}),
   V(16,{BU:[(0,F),(4,F),(8,F),(12,F)],CX:[(0,MF),(4,MF),(8,MF),(12,MF)],RI:r8(),HC:[(4,MP),(12,MP)]})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Pop Ballad",75,4,"Pop/Rock",16,16,16,8,
  [V(16,{BU:[(0,F),(8,MF)],CX:[(4,MF),(12,MF)],HC:h8(MP,MF),AR:[(6,PP),(14,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(6,P),(8,MF)],CX:[(4,MF),(12,MF)],HC:h8(MP,MF),HO:[(14,P)]}),
   V(16,{BU:[(0,F),(8,MF)],CX:[(4,MF),(12,MF)],RI:r8(MP,MF),HC:[(4,MP),(12,MP)]})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Pop Dance",128,4,"Pop/Rock",16,16,16,8,
  [V(16,{BU:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],CX:[(4,F),(12,F)],HC:h16(P,MP,MF),HO:[(2,MP),(10,MP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],CX:[(4,F),(12,F)],HC:h8(MF,F),HO:[(2,MP),(10,MP)]}),
   V(16,{BU:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],CX:[(4,F),(12,F)],HC:h16(PP,P,MF)})],
  [fill_rock16(),fill_electro16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Rock Ballad",68,4,"Pop/Rock",16,16,16,8,
  [V(16,{BU:[(0,F),(8,MF)],CX:[(4,MF),(12,MF)],HC:h8(MP,MF),AR:[(2,PP),(10,PP)]}),
   V(16,{BU:[(0,F),(6,P),(8,MF),(14,P)],CX:[(4,MF),(12,MF)],HC:h8(MP,MF),RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(8,MF)],CX:[(4,MF),(12,MF)],RI:r8(MP,MF)})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Alternative Rock",125,4,"Pop/Rock",16,16,16,8,
  [V(16,{BU:[(0,F),(6,MF),(8,F)],CX:[(4,F),(12,F)],HC:h8(MF,F),AR:[(2,PP),(10,PP)]}),
   V(16,{BU:[(0,F),(6,MF),(8,F),(14,P)],CX:[(4,F),(12,F)],HC:h8(MF,F),RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(6,MF),(8,F)],CX:[(4,F),(12,F)],HC:h8(),HO:[(14,MF)]})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Garage Rock",145,4,"Pop/Rock",16,16,16,8,
  [V(16,{BU:[(0,FF),(4,MF),(8,FF),(12,MF)],CX:[(4,FF),(12,FF)],HC:h8(F,FF),AR:[(2,PP),(10,PP)]}),
   V(16,{BU:[(0,FF),(8,FF),(10,F)],CX:[(4,FF),(12,FF)],HC:h8(F,FF)}),
   V(16,{BU:[(0,FF),(4,MF),(8,FF)],CX:[(4,FF),(12,FF)],RI:r8(F,FF)})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Post Punk",135,4,"Pop/Rock",16,16,16,8,
  [V(16,{BU:[(0,F),(4,MF),(8,F),(12,MF)],CX:[(4,F),(12,F)],HC:h16(P,MP,MF),AR:[(6,PP),(14,PP)]}),
   V(16,{BU:[(0,F),(8,F)],CX:[(4,F),(12,F)],HC:h16(P,MP,MF),RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(4,MF),(8,F),(12,MF)],CX:[(4,F),(12,F)],HC:h8(),HO:[(2,MP),(10,MP)]})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Rockabilly",175,4,"Pop/Rock",16,16,16,8,
  [V(16,{BU:[(0,FF),(8,FF)],CX:[(4,FF),(12,FF)],HC:[(0,F),(2,P),(4,F),(6,P),(8,F),(10,P),(12,F),(14,P)],AR:[(6,PP),(14,PP)]}),
   V(16,{BU:[(0,FF),(4,MF),(8,FF),(12,MF)],CX:[(4,FF),(12,FF)],HC:[(0,F),(2,P),(4,F),(6,P),(8,F),(10,P),(12,F),(14,P)]}),
   V(16,{BU:[(0,FF),(8,FF)],CX:[(4,FF),(12,FF)],RI:[(0,F),(2,MP),(4,F),(6,MP),(8,F),(10,MP),(12,F),(14,MP)]})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Stadium Rock",138,4,"Pop/Rock",16,16,16,8,
  [V(16,{BU:[(0,FFF),(8,FFF)],CX:[(4,FFF),(12,FFF)],CR:[(0,FF),(4,F),(8,FF),(12,F)],RI:[(2,MP),(6,MP),(10,MP),(14,MP)]}),
   V(16,{BU:[(0,FFF),(6,F),(8,FFF)],CX:[(4,FFF),(12,FFF)],CR:[(0,FF),(4,F),(8,FF),(12,F)]}),
   V(16,{BU:[(0,FFF),(8,FFF),(10,F)],CX:[(4,FFF),(12,FFF)],RI:r8(F,FF),CH:[(0,MF)]})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Southern Rock",115,4,"Pop/Rock",16,16,16,8,
  [V(16,{BU:[(0,F),(4,MF),(8,F),(10,MF)],CX:[(4,F),(12,F)],HC:[(0,F),(2,P),(4,F),(6,P),(8,F),(10,P),(12,F),(14,P)],AR:[(6,PP),(14,PP)]}),
   V(16,{BU:[(0,F),(4,MF),(8,F)],CX:[(4,F),(12,F)],HC:[(0,F),(2,P),(4,F),(6,P),(8,F),(10,P),(12,F),(14,P)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(4,MF),(8,F),(10,MF)],CX:[(4,F),(12,F)],RI:r8(MF,F)})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Prog Rock",110,4,"Pop/Rock",16,16,16,8,
  [V(16,{BU:[(0,F),(3,MF),(6,MF),(8,F),(11,MF)],CX:[(4,F),(12,F)],HC:h8(),AR:[(7,PP),(15,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(3,MF),(8,F),(11,MF),(14,MF)],CX:[(4,F),(12,F)],RI:r8(),HC:[(4,MP),(12,MP)]}),
   V(16,{BU:[(0,F),(6,MF),(8,F)],CX:[(4,F),(10,MF),(12,F)],HC:h16(P,MP,MF)})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("New Wave",130,4,"Pop/Rock",16,16,16,8,
  [V(16,{BU:[(0,F),(4,F),(8,F),(12,F)],CX:[(4,F),(12,F)],HC:h8(MF,F),T1:[(2,PP),(10,PP)],AR:[(6,PP),(14,PP)]}),
   V(16,{BU:[(0,F),(4,F),(8,F),(12,F)],CX:[(4,F),(12,F)],HC:h16(P,MP,MF)}),
   V(16,{BU:[(0,F),(4,F),(8,F),(12,F)],CX:[(4,F),(12,F)],RI:r8(MF,F)})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Britpop",122,4,"Pop/Rock",16,16,16,8,
  [V(16,{BU:[(0,F),(8,F),(10,MF)],CX:[(4,F),(12,F)],HC:h8(MF,F),AR:[(2,PP),(6,PP),(10,PP),(14,PP)]}),
   V(16,{BU:[(0,F),(6,P),(8,F),(10,MF)],CX:[(4,F),(12,F)],HC:h8(MF,F),RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(8,F),(10,MF)],CX:[(4,F),(12,F)],HC:h8(),HO:[(14,MP)]})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

# ────────────────────────── FUNK/SOUL/R&B ─────────────────────────────

ALL.append(R("Funk",108,4,"Funk/Soul/R&B",16,16,16,8,
  [V(16,{BU:[(0,FF),(2,MF),(6,MF),(10,MF),(12,F)],CX:[(4,FF),(12,F)],AR:[(7,P),(9,P),(11,P),(15,P)],
     HC:[(0,MF),(1,P),(2,MF),(3,P),(4,MF),(5,P),(6,MF),(8,MF),(9,P),(10,MF),(11,P),(12,MF),(14,MF),(15,P)],HO:[(7,MP),(13,MP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,FF),(2,MF),(6,F),(10,MF)],CX:[(4,FF),(7,PP),(9,PP),(11,PP),(12,F),(15,PP)],HC:h16(PP,P,MF),HO:[(7,MP)],AR:[(3,PP),(13,PP)],RO:[(14,PP)]}),
   V(16,{BU:[(0,FF),(3,MF),(6,MF),(10,MF),(12,F)],CX:[(4,FF),(12,FF)],AR:[(7,P),(15,P)],RI:r8(MF,F),HC:[(4,MP),(12,MP)]})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Soul",95,4,"Funk/Soul/R&B",16,16,16,8,
  [V(16,{BU:[(0,F),(6,MF),(8,F)],CX:[(4,F),(12,F)],AR:[(3,PP),(7,PP),(11,PP),(15,PP)],HC:h16(PP,P,MF),RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(6,MF),(8,F)],CX:[(4,F),(7,PP),(10,PP),(12,F),(14,PP)],HC:h16(PP,P,MF),HO:[(14,MP)]}),
   V(16,{BU:[(0,F),(6,MP),(8,F),(14,P)],CX:[(4,F),(12,F)],RI:r8(MP,MF),HC:[(4,MP),(12,MP)]})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("R&B",90,4,"Funk/Soul/R&B",16,16,16,8,
  [V(16,{BU:[(0,F),(6,MF),(10,MF)],CX:[(4,F),(12,F)],HC:h16(PP,P,MF),HO:[(15,MP)],AR:[(3,PP),(11,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(6,MF),(10,MF)],CX:[(4,F),(12,F),(14,PP)],HC:h16(PP,P,MF)}),
   V(16,{BU:[(0,F),(3,P),(6,MF),(10,MF)],CX:[(4,F),(12,F)],HC:h16(PP,P,MF),RI:[(0,PP),(8,PP)]})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Neo Soul",85,4,"Funk/Soul/R&B",16,16,16,8,
  [V(16,{BU:[(0,F),(6,MP),(8,MF)],CX:[(4,MF),(10,PP),(12,MF)],HC:h16(PP,P,MP),HO:[(6,P),(14,P)],AR:[(3,PP),(11,PP)]}),
   V(16,{BU:[(0,F),(6,MP)],CX:[(4,MF),(12,MF)],HC:h8(MP,MF),RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(6,MP),(10,P)],CX:[(4,MF),(12,MF),(14,PP)],RI:r8(MP,MF),HC:[(4,P),(12,P)]})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Funk Groove",100,4,"Funk/Soul/R&B",16,16,16,8,
  [V(16,{BU:[(0,F),(6,MF),(10,F)],CX:[(4,FF),(12,FF)],HC:h16(PP,P,MF),HO:[(7,MP)],AR:[(3,PP),(11,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(3,P),(6,MF),(10,F)],CX:[(4,FF),(8,PP),(12,FF),(15,PP)],HC:h16(PP,P,MF)}),
   V(16,{BU:[(0,F),(6,MF),(10,F),(14,P)],CX:[(4,FF),(12,FF)],RI:r8(MF,F),HC:[(4,MP),(12,MP)]})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Funk Rock",115,4,"Funk/Soul/R&B",16,16,16,8,
  [V(16,{BU:[(0,FF),(2,MF),(6,MF),(8,FF),(10,MF)],CX:[(4,FF),(12,FF)],HC:h8(F,FF),AR:[(3,PP),(11,PP)]}),
   V(16,{BU:[(0,FF),(2,MF),(8,FF),(10,MF),(14,MF)],CX:[(4,FF),(12,FF)],HC:h8(F,FF)}),
   V(16,{BU:[(0,FF),(2,MF),(6,MF),(8,FF),(10,MF)],CX:[(4,FF),(12,FF)],RI:r8(F,FF)})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Slow Jam",72,4,"Funk/Soul/R&B",16,16,16,8,
  [V(16,{BU:[(0,F),(6,MP),(8,MF)],CX:[(4,MF),(12,MF)],HC:h16(PP,P,MP),AR:[(3,PP),(11,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(6,MP)],CX:[(4,MF),(12,MF),(14,PP)],HC:h16(PP,P,MP),HO:[(14,P)]}),
   V(16,{BU:[(0,F),(6,MP),(8,MF)],CX:[(4,MF),(12,MF)],RI:r8(MP,MF)})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

# ────────────────────────── REGGAE/SKA ────────────────────────────────

ALL.append(R("Reggae",78,4,"Reggae/Ska",16,16,16,8,
  [V(16,{BU:[(8,FF)],AR:[(8,F)],HC:[(2,MF),(6,MF),(10,MF),(14,MF)],HO:[(6,MP)],RI:[(0,P),(4,P),(8,P),(12,P)]}),
   V(16,{BU:[(8,FF)],AR:[(8,F)],HC:[(2,MF),(6,MF),(10,MF),(14,MF)],CR:[(0,MP)],RI:[(0,P),(8,P)]}),
   V(16,{BU:[(8,FF),(14,P)],AR:[(8,F)],HC:[(2,MF),(6,MF),(10,MF)],HO:[(14,MF)],RI:[(0,P),(4,P),(8,P),(12,P)]})],
  [V(16,{BU:[(0,F),(8,FF),(14,FFF)],AR:[(2,MF),(4,MF),(6,F)],T1:[(8,F)],T2:[(10,F)],SU:[(12,FF)],RO:[(9,MF),(11,MF)],CR:[(15,FFF)]}),
   V(8,{SU:[(0,FF),(1,F)],T2:[(2,FF)],T1:[(3,FF),(4,F)],AR:[(5,F),(6,FF)],CR:[(7,FFF)],BU:[(0,F),(7,FF)]}),
   fill_roll16()],
  V(16,{BU:[(0,FF),(8,FF),(14,FFF),(15,FFF)],AR:[(2,F),(4,F),(6,FF)],T2:[(8,F),(9,MF)],SU:[(10,FF),(11,F),(12,FF)],CR:[(0,MF),(15,FFF)],CH:[(12,FF)]}),
  intro4()))

ALL.append(R("Reggae Roots",72,4,"Reggae/Ska",16,16,16,8,
  [V(16,{BU:[(0,F),(8,F)],CX:[(4,MF),(12,MF)],HC:[(2,MF),(6,MF),(10,MF),(14,MF)],AR:[(0,PP),(8,PP)],RI:[(0,PP),(4,PP),(8,PP),(12,PP)]}),
   V(16,{BU:[(0,F),(8,F)],CX:[(4,MF),(12,MF)],HC:[(2,MF),(6,MF),(10,MF),(14,MF)],CR:[(0,MP)]}),
   V(16,{BU:[(0,F),(8,F)],CX:[(4,MF),(12,MF),(14,PP)],HC:[(2,MF),(6,MF),(10,MF)],HO:[(14,MF)]})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Reggaeton",95,4,"Reggae/Ska",16,16,16,8,
  [V(16,{BU:[(0,FF),(4,FF),(8,FF),(12,FF)],CX:[(3,F),(6,F),(11,F),(14,F)],HC:[(0,MF),(4,MF),(8,MF),(12,MF)],AR:[(1,PP),(9,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,FF),(4,FF),(8,FF),(12,FF)],CX:[(3,F),(6,F),(11,F),(14,F)],HC:h8(MF,F)}),
   V(16,{BU:[(0,FF),(4,FF),(8,FF),(12,FF)],CX:[(3,F),(6,F),(11,F),(14,F)],HC:h16(P,MP,MF)})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Ska",160,4,"Reggae/Ska",16,8,16,8,
  [V(16,{BU:[(0,F),(8,F)],CX:[(4,F),(12,F)],HC:[(2,FF),(6,FF),(10,FF),(14,FF)],AR:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(8,F),(10,MF)],CX:[(4,F),(12,F)],HC:[(2,FF),(6,FF),(10,FF),(14,FF)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(4,F),(8,F),(12,F)],CX:[(2,F),(6,F),(10,F),(14,F)],HC:h8(F,FF)})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

# ────────────────────────── JAZZ ──────────────────────────────────────

ALL.append(R("Jazz Swing",140,4,"Jazz",16,16,16,8,
  [V(16,{BU:[(0,PP),(4,PP),(8,PP),(12,PP)],RI:rj(MF,P),HC:[(4,MF),(12,MF)],CX:[(6,PP),(14,PP)]}),
   V(16,{BU:[(0,PP),(4,PP),(8,PP),(10,PP),(12,PP)],RI:rj(MF,P),HC:[(4,MF),(12,MF)],AR:[(6,PP)],RO:[(14,PP)]}),
   V(16,{BU:[(0,PP),(8,PP)],CX:[(6,PP),(14,PP)],RI:rj(F,MP),HC:[(4,F),(12,F)],SU:[(10,PP)]})],
  [fill_jazz16(),V(8,{T1:[(0,F),(1,MF)],T2:[(2,F),(3,MF)],SU:[(4,F),(5,F)],CX:[(6,FF)],CR:[(7,FF)],BU:[(0,MF),(7,F)]}),
   V(16,{CX:[(i,PP+(F-PP)*i/15) for i in range(16)],BU:[(0,MF),(4,MF),(8,F),(12,FF)],RI:[(0,MF),(4,MF),(8,MF),(12,MF)],CR:[(15,FF)]})],
  end_jazz(),intro_jazz()))

ALL.append(R("Jazz Waltz",150,6,"Jazz",24,12,12,12,
  [V(24,{BU:[(0,MP),(8,PP),(16,PP)],RI:[(0,F),(4,MP),(8,MF),(12,MP),(16,MF),(20,MP)],HC:[(8,MF),(16,MF)]}),
   V(24,{BU:[(0,MP),(16,PP)],CX:[(12,PP)],RI:[(0,F),(4,MP),(8,MF),(12,MP),(16,MF),(20,MP)],HC:[(8,MF),(16,MF)]}),
   V(24,{BU:[(0,MP),(8,PP)],RI:[(0,F),(4,MP),(8,MF),(12,MP),(16,MF),(20,MP)],HC:[(8,MF),(16,MF)],CX:[(20,PP)]})],
  [V(12,{BU:[(0,MF),(6,MF),(11,F)],T1:[(0,F),(1,MF)],T2:[(2,F),(3,MF)],SU:[(4,F),(5,F)],CX:[(6,MF),(7,MF),(8,F),(9,FF),(10,FF)],CR:[(11,FF)]}),
   V(12,{CX:[(i,P+(FF-P)*i/11) for i in range(12)],BU:[(0,MF),(6,MF)],CR:[(11,FF)]}),
   V(12,{T1:[(0,F)],RO:[(1,MF)],T2:[(2,F),(3,MF)],SU:[(4,F),(5,F)],BU:[(6,F)],CX:[(7,F),(8,FF)],CR:[(11,FF)]})],
  V(12,{BU:[(0,F),(4,MF),(8,F),(11,FF)],RI:rj()[:6],CX:[(4,MF),(8,F),(10,FF)],SU:[(11,FF)],CR:[(0,MP),(11,FF)]}),
  intro6()))

ALL.append(R("Jazz Ballad",60,4,"Jazz",16,16,16,8,
  [V(16,{BU:[(0,PP)],RI:[(0,MP),(4,MP),(8,MP),(12,MP)],HC:[(4,MP),(12,MP)],AR:[(6,PP),(14,PP)]}),
   V(16,{BU:[(0,PP),(8,PP)],CX:[(10,PP)],RI:[(0,MP),(4,MP),(8,MP),(12,MP)],HC:[(4,MP),(12,MP)]}),
   V(16,{BU:[(0,PP)],RI:[(0,MP),(2,PP),(4,MP),(6,PP),(8,MP),(10,PP),(12,MP),(14,PP)],HC:[(4,MP),(12,MP)]})],
  [fill_jazz16(),V(8,{T1:[(0,MF),(1,MP)],T2:[(2,MF),(3,MP)],SU:[(4,MF),(5,MF)],CX:[(6,F)],CR:[(7,F)],BU:[(0,MP),(7,MF)]}),
   V(16,{CX:[(i,PP+(MF-PP)*i/15) for i in range(16)],BU:[(0,MP),(8,MF)],CR:[(15,F)]})],
  end_jazz(),intro_jazz()))

ALL.append(R("Jazz Fusion",110,4,"Jazz",16,16,16,8,
  [V(16,{BU:[(0,F),(6,MF),(10,MF)],CX:[(4,MF),(12,MF),(14,PP)],HC:h16(PP,P,MP),HO:[(6,MP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(3,P),(6,MF),(10,MF)],CX:[(4,MF),(8,PP),(12,MF)],RI:r8(MP,MF),HC:[(4,P),(12,P)]}),
   V(16,{BU:[(0,F),(6,MF),(10,MF),(14,P)],CX:[(4,MF),(12,MF)],HC:h16(PP,P,MP),AR:[(3,PP),(11,PP)]})],
  [fill_jazz16(),fill_latin16(),fill_latin8()],end_jazz(),intro_jazz()))

ALL.append(R("Bebop",200,4,"Jazz",16,16,16,8,
  [V(16,{BU:[(0,PP),(6,PP),(10,PP)],RI:rj(F,MP),HC:[(4,MF),(12,MF)]}),
   V(16,{BU:[(0,PP),(10,PP),(14,PP)],CX:[(6,PP),(14,PP)],RI:rj(F,MP),HC:[(4,MF),(12,MF)]}),
   V(16,{BU:[(0,PP),(8,PP)],RI:rj(F,MP),HC:[(4,MF),(12,MF)],AR:[(6,PP),(14,PP)]})],
  [fill_jazz16(),V(8,{T1:[(0,F),(1,MF)],T2:[(2,F),(3,MF)],SU:[(4,F),(5,F)],CX:[(6,FF)],CR:[(7,FF)],BU:[(0,MF),(7,F)]}),
   fill_roll16()],
  end_jazz(),intro_jazz()))

ALL.append(R("Cool Jazz",100,4,"Jazz",16,16,16,8,
  [V(16,{BU:[(0,PP),(8,PP)],RI:[(0,MF),(2,PP),(4,MF),(6,PP),(8,MF),(10,PP),(12,MF),(14,PP)],HC:[(4,MP),(12,MP)],AR:[(6,PP),(14,PP)]}),
   V(16,{BU:[(0,PP)],CX:[(10,PP)],RI:[(0,MF),(2,PP),(4,MF),(6,PP),(8,MF),(10,PP),(12,MF),(14,PP)],HC:[(4,MP),(12,MP)]}),
   V(16,{BU:[(0,PP),(8,PP)],RI:[(0,MF),(4,MF),(8,MF),(12,MF)],HC:[(4,MP),(12,MP)]})],
  [fill_jazz16(),fill_latin16(),fill_latin8()],end_jazz(),intro_jazz()))

ALL.append(R("Latin Jazz",180,4,"Jazz",16,16,16,8,
  [V(16,{BU:[(0,F),(1,MF),(8,F),(9,MF)],CX:[(4,MF),(12,MF)],RI:rj(F,MP),HC:[(4,MF),(12,MF)],RO:[(2,PP),(10,PP)]}),
   V(16,{BU:[(0,F),(1,MF),(8,F),(9,MF)],CX:[(4,MF),(11,PP),(12,MF)],RI:rj(F,MP),HC:[(4,MF),(12,MF)]}),
   V(16,{BU:[(0,F),(1,MF),(8,F),(9,MF)],CX:[(4,MF),(12,MF)],RI:r8(F,FF),AR:[(3,PP),(11,PP)]})],
  [fill_latin16(),fill_jazz16(),fill_latin8()],end_jazz(),intro_jazz()))

ALL.append(R("Smooth Jazz",90,4,"Jazz",16,16,16,8,
  [V(16,{BU:[(0,MF),(6,P),(8,MF)],CX:[(4,MP),(12,MP)],HC:h8(P,MP),AR:[(3,PP),(11,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,MF),(6,P)],CX:[(4,MP),(12,MP),(14,PP)],HC:h8(P,MP),HO:[(14,PP)]}),
   V(16,{BU:[(0,MF),(6,P),(8,MF)],CX:[(4,MP),(12,MP)],RI:r8(MP,MF)})],
  [fill_jazz16(),fill_latin16(),fill_latin8()],end_jazz(),intro_jazz()))

ALL.append(R("Bossa Jazz",130,4,"Jazz",16,16,16,8,
  [V(16,{BU:[(0,MF),(4,MP),(5,MP),(9,MP)],AR:[(0,MP),(3,PP),(6,PP),(10,MP),(12,PP)],RI:r8(MP,MF),HC:[(4,P),(12,P)]}),
   V(16,{BU:[(0,MF),(5,MP),(9,MP)],AR:[(0,MP),(3,PP),(6,PP),(10,MP)],RI:r8(MP,MF),HC:[(4,P),(12,P)]}),
   V(16,{BU:[(0,MF),(4,MP),(5,MP),(9,MP),(13,PP)],AR:[(0,MP),(3,PP),(6,PP),(10,MP),(12,PP)],RI:r8(MP,MF)})],
  [fill_latin16(),fill_jazz16(),fill_latin8()],end_jazz(),intro_jazz()))

# ────────────────────────── ELETRÔNICO ────────────────────────────────

ALL.append(R("House",125,4,"Eletrônico",16,16,16,8,
  [V(16,{BU:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],CX:[(4,F),(12,F)],HC:h8(MF,F),HO:[(2,MP),(6,MP),(10,MP),(14,MP)],RI:[(0,PP),(8,PP)],AR:[(3,PP),(11,PP)]}),
   V(16,{BU:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],CX:[(4,F),(12,F)],HC:h16(P,MP,MF)}),
   V(16,{BU:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],CX:[(4,F),(12,F)],HC:h8(MF,F),HO:[(6,MF),(14,MF)]})],
  [fill_electro16(),fill_roll16(),V(8,{CX:[(0,MF),(1,F),(2,FF),(3,FF),(4,FFF),(5,FFF),(6,FFF)],CR:[(7,FFF)],BU:[(0,FFF),(4,FFF),(7,FFF)]})],
  end_rock(),intro4()))

ALL.append(R("Hip Hop",90,4,"Eletrônico",16,16,16,8,
  [V(16,{BU:[(0,FFF),(8,FFF),(10,F),(14,MF)],CX:[(4,FF),(12,FF)],HC:h8(MP,MF),AR:[(3,PP),(7,PP),(11,PP)],SU:[(0,PP)]}),
   V(16,{BU:[(0,FFF),(8,FFF),(10,F)],CX:[(4,FF),(12,FF)],HC:h16(PP,P,MF),HO:[(14,MP)],AR:[(7,PP)]}),
   V(16,{BU:[(0,FFF),(3,P),(8,FFF),(10,F),(14,MF)],CX:[(4,FF),(12,FF)],HC:h8(MP,MF),RI:[(0,PP),(8,PP)]})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Trap",140,4,"Eletrônico",16,16,16,8,
  [V(16,{BU:[(0,FFF),(3,F),(8,FFF)],CX:[(4,FFF),(12,FFF)],HC:h16(P,MP,MF),HO:[(7,MP),(15,MP)],AR:[(1,PP),(9,PP)]}),
   V(16,{BU:[(0,FFF),(3,F),(8,FFF),(11,MF)],CX:[(4,FFF),(12,FFF)],HC:[(i,MF if i%2==0 else P) for i in range(16)]}),
   V(16,{BU:[(0,FFF),(3,F),(8,FFF)],CX:[(4,FFF),(12,FFF)],HC:[(i,MP) for i in range(16)],HO:[(3,MP),(7,MP),(11,MP),(15,MP)]})],
  [fill_electro16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Lo-Fi",80,4,"Eletrônico",16,16,16,8,
  [V(16,{BU:[(0,F),(6,MF),(8,F)],CX:[(4,MF),(12,MF)],HC:h8(MP,MF),AR:[(3,PP),(11,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(6,MF)],CX:[(4,MF),(12,MF)],HC:h8(MP,MF),HO:[(14,P)]}),
   V(16,{BU:[(0,F),(6,MF),(8,F)],CX:[(4,MF),(12,MF),(14,PP)],RI:r8(MP,MF)})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Drum and Bass",174,4,"Eletrônico",16,16,16,8,
  [V(16,{BU:[(0,FFF),(2,F),(10,F),(11,MF)],CX:[(4,FFF),(7,MF),(9,MF),(12,FFF),(15,MF)],HC:h8(MF,F),AR:[(1,PP)]}),
   V(16,{BU:[(0,FFF),(2,F),(10,F)],CX:[(4,FFF),(7,MF),(12,FFF)],HC:h8(MF,F),HO:[(14,MF)]}),
   V(16,{BU:[(0,FFF),(2,F),(6,MF),(10,F),(11,MF)],CX:[(4,FFF),(9,MF),(12,FFF),(15,MF)],HC:h16(P,MP,MF)})],
  [fill_electro16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("EDM",128,4,"Eletrônico",16,16,16,8,
  [V(16,{BU:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],CX:[(4,FFF),(12,FFF)],HC:h16(P,MP,MF),RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],CX:[(4,FFF),(12,FFF)],HC:h8(F,FF),HO:[(2,MF),(6,MF),(10,MF),(14,MF)]}),
   V(16,{BU:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],CX:[(8,FFF)],HC:h16(P,MP,MF)})],
  [fill_electro16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Techno",135,4,"Eletrônico",16,16,16,8,
  [V(16,{BU:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],CX:[(4,F),(12,F)],HC:[(2,MF),(6,MF),(10,MF),(14,MF)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],HC:h16(P,MP,MF),HO:[(4,MF),(12,MF)]}),
   V(16,{BU:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],CX:[(4,MF),(12,MF)],CR:[(2,MP),(6,MP),(10,MP),(14,MP)]})],
  [fill_electro16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Deep House",122,4,"Eletrônico",16,16,16,8,
  [V(16,{BU:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],CX:[(4,MF),(12,MF)],HC:h8(MP,MF),HO:[(2,P),(6,P),(10,P),(14,P)],AR:[(3,PP),(11,PP)]}),
   V(16,{BU:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],CX:[(4,MF),(12,MF)],HC:h16(PP,P,MP)}),
   V(16,{BU:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],CX:[(4,MF),(12,MF)],RI:r8(MP,MF)})],
  [fill_electro16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Future Bass",150,4,"Eletrônico",16,16,16,8,
  [V(16,{BU:[(0,FFF),(3,F),(8,FFF)],CX:[(4,FFF),(12,FFF)],HC:h16(P,MP,MF),HO:[(7,MP),(15,MP)]}),
   V(16,{BU:[(0,FFF),(3,F),(8,FFF),(11,MF)],CX:[(4,FFF),(12,FFF)],HC:h16(P,MP,MF)}),
   V(16,{BU:[(0,FFF),(3,F),(8,FFF)],CX:[(4,FFF),(12,FFF)],HC:[(i,MF) for i in range(16)],HO:[(7,MP),(15,MP)]})],
  [fill_electro16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Dubstep",140,4,"Eletrônico",16,16,16,8,
  [V(16,{BU:[(0,FFF),(10,FFF)],CX:[(8,FFF)],HC:h8(MP,MF),AR:[(2,PP),(14,PP)]}),
   V(16,{BU:[(0,FFF),(3,F),(10,FFF)],CX:[(8,FFF)],HC:h16(PP,P,MF)}),
   V(16,{BU:[(0,FFF),(10,FFF),(14,F)],CX:[(8,FFF)],HC:h8(MP,MF),HO:[(6,MP),(14,MP)]})],
  [fill_electro16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Synthwave",118,4,"Eletrônico",16,16,16,8,
  [V(16,{BU:[(0,F),(4,F),(8,F),(12,F)],CX:[(4,F),(12,F)],HC:h8(MF,F),T1:[(2,PP),(10,PP)],AR:[(6,PP),(14,PP)]}),
   V(16,{BU:[(0,F),(4,F),(8,F),(12,F)],CX:[(4,F),(12,F)],HC:h16(P,MP,MF)}),
   V(16,{BU:[(0,F),(4,F),(8,F),(12,F)],CX:[(4,F),(12,F)],RI:r8(MF,F)})],
  [fill_electro16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Ambient",90,4,"Eletrônico",16,16,16,8,
  [V(16,{BU:[(0,MP)],CX:[(8,PP)],RI:[(0,PP),(4,PP),(8,PP),(12,PP)],CR:[(0,P)]}),
   V(16,{BU:[(0,MP),(12,PP)],RI:[(0,PP),(8,PP)],HC:[(4,PP),(12,PP)]}),
   V(16,{BU:[(0,MP)],CX:[(8,PP)],HC:[(0,PP),(4,PP),(8,PP),(12,PP)],RI:[(0,PP)]})],
  [fill_roll16(),fill_latin16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Trance",140,4,"Eletrônico",16,16,16,8,
  [V(16,{BU:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],CX:[(4,F),(12,F)],HC:[(2,MF),(6,MF),(10,MF),(14,MF)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],CX:[(4,F),(12,F)],HC:h8(MF,F)}),
   V(16,{BU:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],CX:[(4,F),(12,F)],CR:[(2,MP),(6,MP),(10,MP),(14,MP)]})],
  [fill_electro16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Breakbeat",135,4,"Eletrônico",16,16,16,8,
  [V(16,{BU:[(0,FFF),(2,F),(8,FFF),(10,F)],CX:[(4,FFF),(12,FFF)],HC:h8(MF,F),AR:[(6,PP),(14,PP)]}),
   V(16,{BU:[(0,FFF),(2,F),(6,MF),(8,FFF)],CX:[(4,FFF),(12,FFF),(14,MF)],HC:h8(MF,F)}),
   V(16,{BU:[(0,FFF),(2,F),(8,FFF),(10,F)],CX:[(4,FFF),(7,PP),(12,FFF),(15,PP)],HC:h16(P,MP,MF)})],
  [fill_electro16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("UK Garage",132,4,"Eletrônico",16,16,16,8,
  [V(16,{BU:[(0,F),(6,MF),(10,MF)],CX:[(4,F),(12,F)],HC:h16(PP,P,MF),HO:[(7,MP),(15,MP)],AR:[(3,PP),(11,PP)]}),
   V(16,{BU:[(0,F),(6,MF),(10,MF),(14,P)],CX:[(4,F),(12,F)],HC:h16(PP,P,MF)}),
   V(16,{BU:[(0,F),(6,MF),(10,MF)],CX:[(4,F),(12,F)],HC:h16(PP,P,MF),RI:[(0,PP),(8,PP)]})],
  [fill_electro16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

# ────────────────────────── BRASILEIRO ────────────────────────────────

ALL.append(R("Samba",100,4,"Brasileiro",16,16,16,8,
  [V(16,{BU:[(0,FF),(15,F)],CX:[(0,MF),(3,PP),(4,MF),(6,PP),(8,MF),(11,PP),(12,MF),(15,PP)],HC:h16(PP,P,MF),AR:[(2,P),(6,P),(10,P),(14,P)],SU:[(0,MP),(8,MP)],RI:[(0,PP),(4,PP),(8,PP),(12,PP)]}),
   V(16,{BU:[(0,FF),(7,P),(15,F)],CX:[(0,MF),(3,PP),(4,MF),(6,PP),(8,MF),(11,PP),(12,MF)],HC:h16(PP,P,MF),HO:[(15,MF)],SU:[(0,MP),(8,MP)],RO:[(14,PP)]}),
   V(16,{BU:[(0,FF),(3,P),(15,F)],AR:[(0,MF),(3,PP),(4,MF),(6,PP),(8,MF),(11,PP),(12,MF),(15,PP)],HC:h16(PP,P,MF),RI:[(0,P),(4,P),(8,P),(12,P)],SU:[(0,MF),(8,MF)]})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Bossa Nova",130,4,"Brasileiro",16,16,16,8,
  [V(16,{BU:[(0,F),(4,MF),(5,MF),(9,MF)],AR:[(0,MF),(3,P),(6,P),(10,MF),(12,P)],HC:h8(P,MP),RI:[(0,PP),(4,PP),(8,PP),(12,PP)],SU:[(0,PP)]}),
   V(16,{BU:[(0,F),(4,MF),(5,MF),(9,MF)],AR:[(0,MF),(3,P),(6,P),(10,MF),(12,P)],RI:r8(MP,MF),HC:[(4,P),(12,P)]}),
   V(16,{BU:[(0,F),(5,MF),(9,MF),(13,P)],AR:[(0,MF),(3,P),(6,P),(10,MF),(12,P)],HC:h8(P,MP),RO:[(14,PP)],RI:[(0,PP),(8,PP)]})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Samba Rock",110,4,"Brasileiro",16,16,16,8,
  [V(16,{BU:[(0,F),(6,MF),(8,F),(14,MF)],CX:[(4,F),(12,F)],HC:h16(PP,P,MF),AR:[(3,PP),(11,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(6,MF),(8,F),(14,MF)],CX:[(4,F),(12,F),(15,PP)],HC:h16(PP,P,MF)}),
   V(16,{BU:[(0,F),(6,MF),(8,F)],CX:[(4,F),(12,F)],HC:h8(MF,F),HO:[(14,MP)]})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Pagode",90,4,"Brasileiro",16,16,16,8,
  [V(16,{BU:[(0,F),(3,PP),(8,F),(14,MF)],CX:[(4,MF),(6,PP),(10,PP),(12,MF)],HC:h16(PP,P,MP),AR:[(2,PP),(10,PP)],RO:[(14,PP)]}),
   V(16,{BU:[(0,F),(3,PP),(8,F),(14,MF)],CX:[(4,MF),(10,PP),(12,MF),(15,PP)],HC:h16(PP,P,MP),RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(8,F),(14,MF)],CX:[(4,MF),(6,PP),(12,MF)],HC:h16(PP,P,MP),HO:[(6,P)]})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Baião",110,4,"Brasileiro",16,16,16,8,
  [V(16,{BU:[(0,F),(3,MF),(8,F),(11,MF)],AR:[(2,MF),(6,MF),(10,MF),(14,MF)],HC:h8(MF,F),SU:[(0,MP),(8,MP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(3,MF),(8,F),(11,MF)],AR:[(2,MF),(6,MF),(10,MF),(14,MF)],HC:h16(PP,P,MF),SU:[(0,MP),(8,MP)]}),
   V(16,{BU:[(0,F),(3,MF),(8,F),(11,MF)],CX:[(2,F),(6,MF),(10,F),(14,MF)],SU:[(0,MP),(8,MP)],HC:h8(MF,F)})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Forró",120,4,"Brasileiro",16,16,16,8,
  [V(16,{BU:[(0,F),(3,MF),(8,F),(11,MF)],CX:[(4,F),(12,F)],HC:h16(PP,P,MF),AR:[(2,PP),(10,PP)],SU:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(3,MF),(8,F),(11,MF)],CX:[(4,F),(6,PP),(12,F),(14,PP)],HC:h16(PP,P,MF)}),
   V(16,{BU:[(0,F),(3,MF),(6,P),(8,F),(11,MF)],CX:[(4,F),(12,F)],HC:h8(MF,F),RI:[(0,PP),(8,PP)]})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Maracatu",100,4,"Brasileiro",16,16,16,8,
  [V(16,{BU:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],CX:[(2,MF),(6,MF),(10,MF),(14,MF)],SU:[(0,F),(3,PP),(6,PP),(8,F),(11,PP),(14,PP)],HC:h16(PP,P,MP),RO:[(1,PP),(9,PP)]}),
   V(16,{BU:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],CX:[(2,F),(6,MF),(10,F),(14,MF)],SU:[(0,F),(8,F)],HC:h16(PP,P,MP)}),
   V(16,{BU:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],CX:h16(PP,P,MP),SU:[(0,F),(3,PP),(6,PP),(8,F),(11,PP),(14,PP)]})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Frevo",160,4,"Brasileiro",16,8,16,8,
  [V(16,{BU:[(4,F),(12,F)],CX:[(0,F),(1,MF),(2,F),(4,MF),(5,F),(6,MF),(8,F),(9,MF),(10,F),(12,MF),(13,F),(14,MF)],HC:h8(MF,F),AR:[(3,PP),(7,PP),(11,PP),(15,PP)]}),
   V(16,{BU:[(4,F),(12,F)],CX:[(i,F if i%4==0 else MF) for i in range(16)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(4,F),(8,MF),(12,F)],CX:[(0,F),(1,MF),(2,F),(4,MF),(5,F),(6,MF),(8,F),(9,MF),(10,F),(12,MF),(13,F),(14,MF)],HC:h8(MP,MF)})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Axé",130,4,"Brasileiro",16,16,16,8,
  [V(16,{BU:[(0,F),(6,MF),(8,F),(14,MF)],CX:[(2,MF),(4,F),(10,MF),(12,F)],HC:h8(MF,F),SU:[(0,MP),(8,MP)],AR:[(3,PP),(11,PP)]}),
   V(16,{BU:[(0,F),(6,MF),(8,F),(14,MF)],CX:[(2,MF),(4,F),(10,MF),(12,F)],HC:h16(PP,P,MF)}),
   V(16,{BU:[(0,F),(6,MF),(8,F),(14,MF)],CX:[(4,F),(12,F)],SU:[(0,F),(8,F)],HC:h8(MF,F),RI:[(0,PP),(8,PP)]})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Sertanejo",130,4,"Brasileiro",16,16,16,8,
  [V(16,{BU:[(0,F),(4,MF),(8,F),(12,MF)],CX:[(4,F),(12,F)],HC:h8(MF,F),AR:[(2,PP),(10,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(4,MF),(8,F),(12,MF)],CX:[(4,F),(12,F)],HC:h16(PP,P,MF)}),
   V(16,{BU:[(0,F),(4,MF),(8,F),(12,MF)],CX:[(4,F),(12,F),(14,PP)],HC:h8(),HO:[(14,MP)]})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Sertanejo Universitário",150,4,"Brasileiro",16,16,16,8,
  [V(16,{BU:[(0,F),(4,MF),(8,F),(12,MF)],CX:[(4,F),(12,F)],HC:h16(PP,P,MF),AR:[(2,PP),(10,PP)]}),
   V(16,{BU:[(0,F),(4,MF),(8,F),(12,MF)],CX:[(4,F),(12,F)],HC:h8(MF,F),HO:[(14,MP)]}),
   V(16,{BU:[(0,F),(4,MF),(8,F),(12,MF)],CX:[(4,F),(12,F),(14,PP)],HC:h16(PP,P,MF),RI:[(0,PP),(8,PP)]})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Funk Carioca",130,4,"Brasileiro",16,16,16,8,
  [V(16,{BU:[(0,FFF),(3,F),(6,F),(8,FFF),(10,F),(12,F)],CX:[(4,F),(9,MF),(14,F)],AR:[(1,PP),(7,PP)],HC:h8(MP,MF)}),
   V(16,{BU:[(0,FFF),(3,F),(6,F),(8,FFF),(10,F),(12,F)],CX:[(4,F),(14,F)],HC:h8(MP,MF),RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,FFF),(3,F),(6,F),(8,FFF),(10,F)],CX:[(4,F),(9,MF),(12,F),(14,F)],HC:h16(PP,P,MP)})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Piseiro",140,4,"Brasileiro",16,16,16,8,
  [V(16,{BU:[(0,F),(3,MF),(8,F),(11,MF)],CX:[(4,F),(12,F)],HC:h16(PP,P,MF),AR:[(2,PP),(10,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(4,F),(8,F),(12,F)],CX:[(4,F),(12,F)],HC:h16(PP,P,MF)}),
   V(16,{BU:[(0,F),(3,MF),(8,F),(11,MF)],CX:[(4,F),(12,F)],HC:h8(MF,F),HO:[(14,MP)]})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Arrocha",90,4,"Brasileiro",16,16,16,8,
  [V(16,{BU:[(0,F),(6,MF),(8,F)],CX:[(4,F),(12,F)],HC:h8(MP,MF),AR:[(3,PP),(11,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(6,MF),(8,F),(14,P)],CX:[(4,F),(12,F)],HC:h16(PP,P,MP)}),
   V(16,{BU:[(0,F),(6,MF),(8,F)],CX:[(4,F),(12,F),(14,PP)],HC:h8(MP,MF),HO:[(14,P)]})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Ijexá",90,4,"Brasileiro",16,16,16,8,
  [V(16,{BU:[(0,F),(8,F)],CX:[(4,MF),(12,MF)],SU:[(0,MF),(1,PP),(4,PP),(5,PP),(7,PP),(8,MF),(9,PP),(12,PP),(13,PP),(15,PP)],HC:h8(MP,MF),RO:[(2,PP),(10,PP)]}),
   V(16,{BU:[(0,F),(8,F)],CX:[(4,MF),(12,MF)],SU:[(0,MF),(1,PP),(4,PP),(5,PP),(7,PP),(8,MF),(9,PP),(12,PP),(13,PP),(15,PP)],HC:h16(PP,P,MP)}),
   V(16,{BU:[(0,F),(8,F)],CX:[(4,MF),(12,MF)],SU:[(0,MF),(1,PP),(5,PP),(7,PP),(8,MF),(9,PP),(13,PP),(15,PP)],RI:[(0,MP),(8,MP)]})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("MPB",95,4,"Brasileiro",16,16,16,8,
  [V(16,{BU:[(0,F),(6,MF),(8,MF)],CX:[(4,MF),(12,MF)],HC:h8(MP,MF),AR:[(3,PP),(11,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(6,MF)],CX:[(4,MF),(12,MF),(14,PP)],HC:h8(MP,MF),HO:[(14,P)]}),
   V(16,{BU:[(0,F),(6,MF),(8,MF)],CX:[(4,MF),(12,MF)],RI:r8(MP,MF)})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Samba Reggae",100,4,"Brasileiro",16,16,16,8,
  [V(16,{BU:[(0,F),(6,MF),(8,F),(14,MF)],CX:[(2,MF),(4,F),(10,MF),(12,F)],HC:h8(MF,F),SU:[(0,MP),(8,MP)],AR:[(3,PP),(11,PP)]}),
   V(16,{BU:[(0,F),(6,MF),(8,F),(14,MF)],CX:[(2,MF),(4,F),(10,MF),(12,F)],SU:[(0,F),(8,F)],HC:h8(MP,MF)}),
   V(16,{BU:[(0,F),(6,MF),(8,F),(14,MF)],CX:[(4,F),(12,F)],HC:h16(PP,P,MF),RI:[(0,PP),(8,PP)]})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Côco",120,4,"Brasileiro",16,16,16,8,
  [V(16,{BU:[(0,F),(4,MF),(8,F),(12,MF)],CX:[(2,MF),(6,MF),(10,MF),(14,MF)],HC:h16(PP,P,MP),SU:[(0,MP),(8,MP)],AR:[(3,PP),(11,PP)]}),
   V(16,{BU:[(0,F),(4,MF),(8,F),(12,MF)],CX:[(2,MF),(6,MF),(10,MF),(14,MF)],SU:[(0,MP),(8,MP)],HC:h8(MP,MF)}),
   V(16,{BU:[(0,F),(4,MF),(8,F),(12,MF)],CX:[(2,F),(6,MF),(10,F),(14,MF)],HC:h16(PP,P,MP)})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Lambada",140,4,"Brasileiro",16,16,16,8,
  [V(16,{BU:[(0,F),(6,MF),(8,F)],CX:[(4,F),(12,F)],HC:h8(MF,F),AR:[(3,PP),(11,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(6,MF),(8,F)],CX:[(4,F),(12,F)],T1:[(12,MF)],HC:h8(MF,F)}),
   V(16,{BU:[(0,F),(6,MF),(8,F),(14,P)],CX:[(4,F),(12,F)],HC:h16(PP,P,MF)})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Ciranda",100,4,"Brasileiro",16,16,16,8,
  [V(16,{BU:[(0,F),(8,F)],CX:[(4,MF),(12,MF)],HC:h8(MP,MF),SU:[(0,MF),(4,PP),(8,MF),(12,PP)],AR:[(2,PP),(10,PP)]}),
   V(16,{BU:[(0,F),(8,F)],CX:[(4,MF),(12,MF)],HC:h16(PP,P,MP),SU:[(0,MF),(8,MF)]}),
   V(16,{BU:[(0,F),(8,F)],CX:[(4,MF),(12,MF)],RI:r8(MP,MF),SU:[(0,MP),(8,MP)]})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Maxixe",110,4,"Brasileiro",16,16,16,8,
  [V(16,{BU:[(0,F),(3,MF),(8,F),(11,MF)],CX:[(4,F),(12,F)],HC:h16(PP,P,MF),AR:[(2,PP),(10,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(3,MF),(8,F),(11,MF)],CX:[(4,F),(6,PP),(12,F),(14,PP)],HC:h16(PP,P,MF)}),
   V(16,{BU:[(0,F),(3,MF),(8,F),(11,MF)],CX:[(4,F),(12,F)],HC:h8(MF,F)})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Carimbó",120,4,"Brasileiro",16,16,16,8,
  [V(16,{BU:[(0,F),(4,MF),(8,F),(12,MF)],CX:[(2,MF),(6,MF),(10,MF),(14,MF)],SU:[(0,F),(8,F)],HC:h8(MP,MF),AR:[(3,PP),(11,PP)]}),
   V(16,{BU:[(0,F),(4,MF),(8,F),(12,MF)],CX:[(2,MF),(6,MF),(10,MF),(14,MF)],HC:h16(PP,P,MP)}),
   V(16,{BU:[(0,F),(4,MF),(8,F),(12,MF)],CX:[(2,F),(6,MF),(10,F),(14,MF)],SU:[(0,F),(8,F)],HC:h8(MP,MF)})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

# ────────────────────────── LATINO ────────────────────────────────────

ALL.append(R("Salsa",180,4,"Latino",16,16,16,8,
  [V(16,{BU:[(3,MF),(7,MF),(11,MF),(15,MF)],AR:[(0,MF),(1,PP),(3,PP),(4,MF),(6,PP),(7,PP),(9,PP),(10,MF),(12,PP),(14,MF)],HC:[(0,F),(4,F),(8,F),(12,F)],RO:[(2,PP),(10,PP)]}),
   V(16,{BU:[(3,MF),(7,MF),(11,MF),(15,MF)],AR:[(0,MF),(3,PP),(4,MF),(7,PP),(10,MF),(14,MF)],RI:r8(MP,MF)}),
   V(16,{BU:[(3,MF),(7,MF),(11,MF),(15,MF)],CX:[(4,MF),(10,MF)],HC:h8(MF,F),AR:[(0,PP),(8,PP)]})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Cumbia",100,4,"Latino",16,16,16,8,
  [V(16,{BU:h8(MF,F),CX:[(4,MF),(12,MF)],HC:h16(PP,P,MP),SU:[(0,MP),(8,MP)],AR:[(3,PP),(11,PP)]}),
   V(16,{BU:[(0,F),(2,MF),(4,MF),(6,MF),(8,F),(10,MF),(12,MF),(14,MF)],CX:[(4,MF),(12,MF)],HC:h8(MP,MF)}),
   V(16,{BU:h8(MF,F),CX:[(4,MF),(12,MF)],SU:[(0,MP),(8,MP)],HC:h16(PP,P,MP),RI:[(0,PP),(8,PP)]})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Merengue",160,4,"Latino",16,16,16,8,
  [V(16,{BU:[(0,F),(4,F),(8,F),(12,F)],CX:[(2,MF),(4,MF),(6,MF),(10,MF),(12,MF),(14,MF)],HC:h8(MF,F),AR:[(3,PP),(11,PP)]}),
   V(16,{BU:[(0,F),(5,MF),(8,F),(12,F)],CX:[(2,MF),(4,MF),(6,MF),(10,MF),(12,MF),(14,MF)],HC:h8(MF,F)}),
   V(16,{BU:[(0,F),(4,F),(8,F),(12,F)],CX:[(2,MF),(6,MF),(10,MF),(14,MF)],T2:[(4,MF),(12,MF)],HC:h8(MF,F)})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Bachata",130,4,"Latino",16,16,16,8,
  [V(16,{BU:[(0,F),(12,MF)],AR:[(0,MF),(2,MP),(4,MF),(6,MP),(8,MF),(10,MP)],HC:h8(MP,MF),RO:[(14,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(12,MF)],AR:[(0,MF),(2,MP),(4,MF),(6,MP),(8,MF),(10,MP)],HC:h16(PP,P,MP)}),
   V(16,{BU:[(0,F),(8,MF),(12,MF)],AR:[(0,MF),(2,MP),(4,MF),(6,MP),(10,MP)],HC:h8(MP,MF)})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Cha Cha Cha",120,4,"Latino",16,16,16,8,
  [V(16,{BU:[(0,F),(8,F)],AR:[(4,MF),(8,MF),(10,MF),(12,MF)],HC:[(0,F),(4,F),(8,F),(12,F)],RO:[(2,PP),(10,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(8,F)],AR:[(4,MF),(8,MF),(10,MF),(12,MF)],HC:h8(MF,F)}),
   V(16,{BU:[(0,F),(8,F)],AR:[(4,MF),(10,MF),(12,MF)],T1:[(8,MF)],HC:[(0,F),(4,F),(8,F),(12,F)]})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Bolero",85,4,"Latino",16,16,16,8,
  [V(16,{BU:[(0,F),(8,MF)],AR:[(4,MF),(5,PP),(6,PP),(12,MF)],HC:h8(MP,MF),RI:[(0,PP),(8,PP)],RO:[(14,PP)]}),
   V(16,{BU:[(0,F),(8,MF)],AR:[(4,MF),(5,PP),(6,PP),(12,MF)],RI:r8(MP,MF)}),
   V(16,{BU:[(0,F),(8,MF),(14,P)],AR:[(4,MF),(5,PP),(6,PP),(12,MF)],HC:h8(MP,MF)})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Tango",130,4,"Latino",16,16,16,8,
  [V(16,{BU:[(0,F),(3,MF),(6,MF),(8,F),(11,MF),(14,MF)],AR:[(4,MF),(12,MF)],HC:[(0,MP),(4,MP),(8,MP),(12,MP)]}),
   V(16,{BU:[(0,F),(3,MF),(6,MF),(8,F),(11,MF),(14,MF)],AR:[(4,MF),(12,MF)],HC:[(0,MP),(4,MP),(8,MP),(12,MP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(3,MF),(6,MF),(8,F),(11,MF),(14,MF)],AR:[(4,MF),(8,PP),(12,MF)]})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Son Cubano",130,4,"Latino",16,16,16,8,
  [V(16,{BU:[(3,MF),(7,MF),(11,MF),(15,MF)],AR:[(0,MF),(3,PP),(6,PP),(10,MF),(12,PP)],HC:[(0,F),(4,F),(8,F),(12,F)],RO:[(2,PP),(10,PP)]}),
   V(16,{BU:[(3,MF),(7,MF),(11,MF),(15,MF)],AR:[(0,MF),(6,PP),(10,MF)],RI:r8(MP,MF)}),
   V(16,{BU:[(3,MF),(7,MF),(11,MF),(15,MF)],AR:[(0,MF),(10,MF)],HC:h8(MF,F)})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Mambo",180,4,"Latino",16,16,16,8,
  [V(16,{BU:[(3,MF),(7,MF),(11,MF),(15,MF)],CX:[(0,MF),(4,MF),(8,MF),(12,MF)],HC:[(0,F),(4,F),(8,F),(12,F)],RO:[(2,PP),(10,PP)]}),
   V(16,{BU:[(3,MF),(7,MF),(11,MF),(15,MF)],CX:[(4,MF),(12,MF)],RI:r8(MF,F)}),
   V(16,{BU:[(3,MF),(7,MF),(11,MF),(15,MF)],CX:[(0,MF),(4,MF),(8,MF),(12,MF)],HC:h8(MF,F)})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Rumba",100,4,"Latino",16,16,16,8,
  [V(16,{BU:[(0,F),(8,MF)],AR:[(0,MF),(3,PP),(6,PP),(10,MF),(12,PP)],HC:h8(MP,MF),SU:[(4,MP),(12,MP)],RO:[(2,PP),(10,PP)]}),
   V(16,{BU:[(0,F),(8,MF)],AR:[(0,MF),(3,PP),(6,PP),(10,MF)],SU:[(4,MP),(12,MP)],HC:h8(MP,MF)}),
   V(16,{BU:[(0,F),(8,MF)],AR:[(0,MF),(3,PP),(6,PP),(10,MF),(12,PP)],RI:r8(MP,MF)})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Cumbia Colombiana",95,4,"Latino",16,16,16,8,
  [V(16,{BU:[(0,F),(2,MF),(4,MF),(6,MF),(8,F),(10,MF),(12,MF),(14,MF)],CX:[(4,MF),(12,MF)],HC:h16(PP,P,MP),SU:[(0,MP),(8,MP)],AR:[(3,PP),(11,PP)]}),
   V(16,{BU:[(0,F),(2,MF),(4,MF),(6,MF),(8,F),(10,MF),(12,MF),(14,MF)],CX:[(4,MF),(12,MF)],SU:[(0,MP),(8,MP)],HC:h8(MP,MF)}),
   V(16,{BU:h8(MF,F),CX:[(4,MF),(12,MF)],HC:h16(PP,P,MP),RI:[(0,PP),(8,PP)]})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Plena",120,4,"Latino",16,16,16,8,
  [V(16,{BU:[(0,F),(4,MF),(8,F),(12,MF)],CX:[(2,MF),(6,MF),(10,MF),(14,MF)],HC:h8(MF,F),AR:[(3,PP),(11,PP)],RO:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(4,MF),(8,F),(12,MF)],CX:[(2,MF),(6,MF),(10,MF),(14,MF)],HC:h16(PP,P,MF)}),
   V(16,{BU:[(0,F),(4,MF),(8,F),(12,MF)],CX:[(2,F),(6,MF),(10,F),(14,MF)],HC:h8(MF,F)})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Bomba",115,4,"Latino",16,16,16,8,
  [V(16,{BU:[(0,F),(3,MF),(8,F),(11,MF)],CX:[(4,F),(12,F)],HC:h8(MF,F),SU:[(0,MP),(8,MP)],AR:[(2,PP),(10,PP)]}),
   V(16,{BU:[(0,F),(3,MF),(8,F),(11,MF)],CX:[(4,F),(6,PP),(12,F),(14,PP)],HC:h8(MF,F)}),
   V(16,{BU:[(0,F),(3,MF),(8,F),(11,MF)],CX:[(4,F),(12,F)],SU:[(0,MP),(8,MP)],HC:h8(MF,F),RI:[(0,PP),(8,PP)]})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

# ────────────────────────── GOSPEL ────────────────────────────────────

ALL.append(R("Gospel Groove",100,4,"Gospel",16,16,16,8,
  [V(16,{BU:[(0,FF),(6,MF),(8,FF),(10,MF)],CX:[(4,FF),(12,FF)],AR:[(3,PP),(7,PP),(11,PP),(15,PP)],HC:h16(PP,P,MF),RI:[(0,P),(4,P),(8,P),(12,P)],SU:[(0,PP)]}),
   V(16,{BU:[(0,FF),(6,MF),(8,FF),(10,MF)],CX:[(4,FF),(7,PP),(12,FF),(14,PP)],AR:[(3,PP),(11,PP)],HC:h16(PP,P,MF),HO:[(14,MP)]}),
   V(16,{BU:[(0,FF),(6,MF),(8,FF),(10,MF)],CX:[(4,FF),(12,FF)],RI:r8(MF,F),HC:[(4,MP),(12,MP)],AR:[(7,PP),(15,PP)]})],
  [fill_gospel16(),fill_roll16(),fill_latin8()],end_gospel(),intro4()))

ALL.append(R("Worship Básico",72,4,"Gospel",16,16,16,8,
  [V(16,{BU:[(0,F),(8,MF)],CX:[(4,MF),(12,MF)],HC:h8(MP,MF),AR:[(2,PP),(10,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(6,P),(8,MF)],CX:[(4,MF),(12,MF)],HC:h8(MP,MF),HO:[(14,P)]}),
   V(16,{BU:[(0,F),(8,MF)],CX:[(4,MF),(12,MF)],RI:r8(MP,MF),HC:[(4,MP),(12,MP)]})],
  [fill_gospel16(),fill_roll16(),fill_latin8()],end_gospel(),intro4()))

ALL.append(R("Worship Upbeat",120,4,"Gospel",16,16,16,8,
  [V(16,{BU:[(0,F),(8,F),(10,MF)],CX:[(4,F),(12,F)],HC:h8(MF,F),AR:[(2,PP),(10,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(6,MP),(8,F),(10,MF)],CX:[(4,F),(12,F)],HC:h16(PP,P,MF)}),
   V(16,{BU:[(0,F),(8,F),(10,MF)],CX:[(4,F),(12,F)],RI:r8(MF,F),HC:[(4,MP),(12,MP)]})],
  [fill_gospel16(),fill_roll16(),fill_latin8()],end_gospel(),intro4()))

ALL.append(R("Worship 6-8",70,6,"Gospel",24,12,12,12,
  [V(24,{BU:[(0,FF),(12,MF)],CX:[(8,MF),(20,MF)],AR:[(4,PP),(16,PP)],HC:[(i,MF if i%4==0 else(MP if i%2==0 else PP)) for i in range(24)],RI:[(0,P),(8,P),(16,P)],SU:[(0,PP)]}),
   V(24,{BU:[(0,FF),(10,P),(12,MF)],CX:[(8,MF),(20,MF)],AR:[(4,PP),(16,PP)],HC:[(i,MF if i%4==0 else MP) for i in range(0,24,2)],HO:[(22,MP)],RI:[(0,PP),(12,PP)]}),
   V(24,{BU:[(0,FF),(12,MF)],CX:[(8,MF),(20,MF)],RI:[(i,MF if i%8==0 else MP) for i in range(0,24,4)],HC:[(4,MP),(12,MP),(20,MP)]})],
  [V(12,{BU:[(0,FF),(6,FF),(11,FFF)],T1:[(0,F),(1,MF)],T2:[(2,F),(3,MF)],SU:[(4,FF),(5,F)],RO:[(6,F),(7,MF)],CX:[(8,FF),(9,FF),(10,FFF)],CR:[(11,FFF)]}),
   V(12,{CX:[(i,P+(FF-P)*i/11) for i in range(12)],BU:[(0,FF),(6,FF)],CR:[(11,FFF)]}),
   V(12,{T1:[(0,FF)],RO:[(1,F)],T2:[(2,FF),(3,F)],SU:[(4,FF),(5,FF)],BU:[(6,FF)],CX:[(7,FF),(8,FFF)],CR:[(11,FFF)]})],
  V(12,{BU:[(0,FFF),(4,FF),(8,FFF),(11,FFF)],CX:[(2,F),(6,FF),(9,FF),(10,FFF)],T1:[(1,F)],T2:[(3,F)],SU:[(5,FF),(7,FF)],CR:[(0,MF),(11,FFF)]}),
  intro6()))

ALL.append(R("Gospel Shuffle",95,4,"Gospel",16,16,16,8,
  [V(16,{BU:[(0,F),(4,MF),(8,F),(12,MF)],CX:[(4,F),(12,F)],HC:[(0,F),(2,P),(4,F),(6,P),(8,F),(10,P),(12,F),(14,P)],AR:[(6,PP),(14,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(4,MF),(8,F),(12,MF)],CX:[(4,F),(6,PP),(12,F),(14,PP)],HC:[(0,F),(2,P),(4,F),(6,P),(8,F),(10,P),(12,F),(14,P)]}),
   V(16,{BU:[(0,F),(4,MF),(8,F),(12,MF)],CX:[(4,F),(12,F)],RI:[(0,MF),(2,P),(4,MF),(6,P),(8,MF),(10,P),(12,MF),(14,P)],HC:[(4,MP),(12,MP)]})],
  [fill_gospel16(),fill_roll16(),fill_latin8()],end_gospel(),intro4()))

ALL.append(R("Gospel Funk",105,4,"Gospel",16,16,16,8,
  [V(16,{BU:[(0,F),(6,MF),(10,MF)],CX:[(4,F),(12,F)],HC:h16(PP,P,MF),AR:[(3,PP),(11,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(6,MF),(10,MF)],CX:[(4,F),(7,PP),(12,F),(15,PP)],HC:h16(PP,P,MF)}),
   V(16,{BU:[(0,F),(6,MF),(10,MF),(14,P)],CX:[(4,F),(12,F)],RI:r8(MF,F),HC:[(4,MP),(12,MP)]})],
  [fill_gospel16(),fill_roll16(),fill_latin8()],end_gospel(),intro4()))

ALL.append(R("Gospel Balada",65,4,"Gospel",16,16,16,8,
  [V(16,{BU:[(0,F),(8,MF)],CX:[(4,MP),(12,MP)],HC:h8(P,MP),AR:[(2,PP),(10,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(6,P),(8,MF)],CX:[(4,MP),(12,MP)],RI:r8(P,MP),HC:[(4,P),(12,P)]}),
   V(16,{BU:[(0,F),(8,MF)],CX:[(4,MP),(12,MP)],HC:h8(P,MP),HO:[(14,PP)]})],
  [fill_gospel16(),fill_roll16(),fill_latin8()],end_gospel(),intro4()))

ALL.append(R("Gospel Fast",145,4,"Gospel",16,16,16,8,
  [V(16,{BU:[(0,FF),(8,FF),(10,F)],CX:[(4,FF),(12,FF)],HC:h16(P,MP,MF),AR:[(3,PP),(11,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,FF),(6,MF),(8,FF),(10,F)],CX:[(4,FF),(12,FF)],HC:h16(P,MP,MF)}),
   V(16,{BU:[(0,FF),(8,FF),(10,F)],CX:[(4,FF),(12,FF)],RI:r8(F,FF),HC:[(4,MP),(12,MP)]})],
  [fill_gospel16(),fill_roll16(),fill_latin8()],end_gospel(),intro4()))

ALL.append(R("Gospel Reggae",80,4,"Gospel",16,16,16,8,
  [V(16,{BU:[(8,FF)],AR:[(8,F)],HC:[(2,MF),(6,MF),(10,MF),(14,MF)],RI:[(0,P),(4,P),(8,P),(12,P)]}),
   V(16,{BU:[(0,MF),(8,FF)],AR:[(8,F)],HC:[(2,MF),(6,MF),(10,MF),(14,MF)]}),
   V(16,{BU:[(8,FF)],AR:[(8,F)],HC:[(2,MF),(6,MF),(10,MF),(14,MF)],CR:[(0,MP)]})],
  [fill_gospel16(),fill_roll16(),fill_latin8()],end_gospel(),intro4()))

ALL.append(R("Louvor Congregacional",85,4,"Gospel",16,16,16,8,
  [V(16,{BU:[(0,F),(8,MF)],CX:[(4,MF),(12,MF)],HC:h8(MP,MF),AR:[(2,PP),(10,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(6,P),(8,MF)],CX:[(4,MF),(12,MF)],HC:h8(MP,MF),HO:[(14,PP)]}),
   V(16,{BU:[(0,F),(8,MF)],CX:[(4,MF),(12,MF)],RI:r8(MP,MF)})],
  [fill_gospel16(),fill_roll16(),fill_latin8()],end_gospel(),intro4()))

ALL.append(R("Gospel Country",120,4,"Gospel",16,16,16,8,
  [V(16,{BU:[(0,F),(8,F)],CX:[(4,F),(12,F)],HC:h8(MF,F),AR:[(2,PP),(10,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(4,MF),(8,F),(12,MF)],CX:[(4,F),(12,F)],HC:h8(MF,F)}),
   V(16,{BU:[(0,F),(8,F)],CX:[(4,F),(12,F)],RI:r8(MF,F),HC:[(4,MP),(12,MP)]})],
  [fill_gospel16(),fill_roll16(),fill_latin8()],end_gospel(),intro4()))

ALL.append(R("Hillsong Style",130,4,"Gospel",16,16,16,8,
  [V(16,{BU:[(0,F),(8,F),(10,MF)],CX:[(4,F),(12,F)],HC:h8(MF,F),AR:[(2,PP),(6,PP),(10,PP),(14,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(6,MP),(8,F),(10,MF)],CX:[(4,F),(12,F)],HC:h16(PP,P,MF)}),
   V(16,{BU:[(0,F),(8,F),(10,MF)],CX:[(4,F),(12,F)],RI:r8(F,FF),HC:[(4,MP),(12,MP)]})],
  [fill_gospel16(),fill_roll16(),fill_latin8()],end_gospel(),intro4()))

ALL.append(R("Bethel Style",72,4,"Gospel",16,16,16,8,
  [V(16,{BU:[(0,MF),(8,P)],CX:[(8,MF)],HC:h8(P,MP),AR:[(4,PP),(12,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,MF),(6,PP),(8,P)],CX:[(8,MF)],HC:h8(P,MP),HO:[(14,PP)]}),
   V(16,{BU:[(0,MF),(8,P)],CX:[(8,MF)],RI:[(0,P),(4,P),(8,P),(12,P)],HC:[(4,PP),(12,PP)]})],
  [fill_gospel16(),fill_roll16(),fill_latin8()],end_gospel(),intro4()))

ALL.append(R("Adoração Lenta",60,6,"Gospel",24,12,12,12,
  [V(24,{BU:[(0,MF),(12,P)],CX:[(8,MP)],HC:[(i,MP if i%4==0 else P) for i in range(0,24,4)],RI:[(0,PP),(8,PP),(16,PP)],AR:[(4,PP),(20,PP)]}),
   V(24,{BU:[(0,MF)],CX:[(8,MP),(20,PP)],RI:[(0,P),(8,P),(16,P)],HC:[(4,PP),(12,PP),(20,PP)]}),
   V(24,{BU:[(0,MF),(12,P)],CX:[(8,MP)],RI:[(i,P) for i in range(0,24,4)],HC:[(8,PP),(20,PP)]})],
  [V(12,{BU:[(0,MF),(6,MF),(11,F)],T1:[(0,MF),(1,MP)],T2:[(2,MF),(3,MP)],SU:[(4,MF),(5,MF)],CX:[(6,MF),(7,MF),(8,F),(9,F),(10,F)],CR:[(11,F)]}),
   V(12,{CX:[(i,PP+(MF-PP)*i/11) for i in range(12)],BU:[(0,MF),(6,MF)],CR:[(11,F)]}),
   V(12,{T1:[(0,MF)],T2:[(2,MF),(3,MP)],SU:[(4,MF),(5,MF)],BU:[(6,MF)],CX:[(7,MF),(8,F)],CR:[(11,F)]})],
  V(12,{BU:[(0,F),(4,MF),(8,F),(11,F)],CX:[(2,MF),(6,MF),(9,MF),(10,F)],T2:[(3,MF)],SU:[(5,MF),(7,MF)],CR:[(0,MP),(11,F)]}),
  intro6()))

# ────────────────────────── WORLD ─────────────────────────────────────

ALL.append(R("Afrobeat",110,4,"World",16,16,16,8,
  [V(16,{BU:[(0,F),(1,MF),(8,F),(9,MF)],CX:[(4,MF),(11,MF)],HC:h8(MF,F),AR:[(3,PP),(7,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(1,MF),(8,F),(9,MF)],CX:[(4,MF),(11,MF)],HC:h16(PP,P,MF)}),
   V(16,{BU:[(0,F),(1,MF),(8,F),(9,MF)],CX:[(4,MF),(11,MF),(14,PP)],RI:r8(MP,MF)})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Soca",150,4,"World",16,16,16,8,
  [V(16,{BU:[(0,F),(4,F),(8,F),(12,F)],CX:[(4,F),(12,F)],HC:h16(PP,P,MF),AR:[(2,PP),(10,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(4,F),(8,F),(12,F)],CX:[(4,F),(12,F)],HC:h8(MF,F),HO:[(2,MP),(10,MP)]}),
   V(16,{BU:[(0,F),(4,F),(8,F),(12,F)],CX:[(4,F),(12,F)],RI:r8(MF,F)})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Calypso",120,4,"World",16,16,16,8,
  [V(16,{BU:[(0,F),(8,F)],CX:[(4,F),(12,F)],HC:h8(MF,F),T2:[(2,MP),(6,MP),(10,MP),(14,MP)],AR:[(3,PP),(11,PP)]}),
   V(16,{BU:[(0,F),(8,F),(14,MF)],CX:[(4,F),(12,F)],HC:h8(MF,F),RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(8,F)],CX:[(4,F),(12,F)],HC:h16(PP,P,MF)})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Highlife",120,4,"World",16,16,16,8,
  [V(16,{BU:[(0,F),(8,F)],CX:[(4,MF),(12,MF)],HC:h8(MF,F),SU:[(0,MP),(3,PP),(8,MP),(11,PP)],AR:[(2,PP),(10,PP)]}),
   V(16,{BU:[(0,F),(8,F)],CX:[(4,MF),(12,MF)],HC:h16(PP,P,MF),RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(6,MF),(8,F)],CX:[(4,MF),(12,MF)],RI:r8(MP,MF)})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Soukous",140,4,"World",16,16,16,8,
  [V(16,{BU:[(0,F),(4,MF),(8,F),(12,MF)],CX:[(4,F),(12,F)],HC:h16(PP,P,MF),AR:[(2,PP),(10,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(4,MF),(8,F),(12,MF)],CX:[(4,F),(12,F)],HC:h8(MF,F),HO:[(14,MP)]}),
   V(16,{BU:[(0,F),(4,MF),(8,F),(12,MF)],CX:[(4,F),(12,F)],RI:r8(MF,F)})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Zouk",120,4,"World",16,16,16,8,
  [V(16,{BU:[(0,F),(6,MF),(8,F)],CX:[(4,F),(12,F)],HC:h16(PP,P,MF),AR:[(3,PP),(11,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(6,MF),(8,F),(14,P)],CX:[(4,F),(12,F)],HC:h16(PP,P,MF)}),
   V(16,{BU:[(0,F),(6,MF),(8,F)],CX:[(4,F),(12,F)],HC:h8(MF,F),RI:[(0,PP),(8,PP)]})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Kizomba",95,4,"World",16,16,16,8,
  [V(16,{BU:[(0,F),(3,MF),(8,F),(11,MF)],CX:[(4,MF),(12,MF)],HC:h8(MP,MF),AR:[(2,PP),(10,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(3,MF),(8,F),(11,MF)],CX:[(4,MF),(12,MF),(14,PP)],HC:h16(PP,P,MP)}),
   V(16,{BU:[(0,F),(3,MF),(8,F),(11,MF)],CX:[(4,MF),(12,MF)],RI:r8(MP,MF)})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Afro Cuban",110,4,"World",16,16,16,8,
  [V(16,{BU:[(0,F),(1,MF),(8,F),(9,MF)],CX:[(4,MF),(12,MF)],HC:[(0,F),(4,F),(8,F),(12,F)],SU:[(0,MF),(3,PP),(6,PP),(8,MF),(11,PP),(14,PP)],RO:[(2,PP),(10,PP)]}),
   V(16,{BU:[(0,F),(1,MF),(8,F),(9,MF)],CX:[(4,MF),(12,MF)],RI:r8(MF,F),AR:[(3,PP),(11,PP)]}),
   V(16,{BU:[(0,F),(1,MF),(8,F),(9,MF)],CX:[(4,MF),(11,PP),(12,MF)],HC:h8(MF,F)})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

ALL.append(R("Second Line",110,4,"World",16,16,16,8,
  [V(16,{BU:[(0,F),(8,F)],CX:[(0,MF),(2,PP),(4,F),(6,PP),(8,MF),(10,PP),(12,F),(14,PP)],HC:h8(MP,MF),AR:[(3,PP),(11,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(6,MF),(8,F)],CX:[(0,MF),(2,PP),(4,F),(10,PP),(12,F),(14,PP)],HC:h8(MP,MF)}),
   V(16,{BU:[(0,F),(8,F)],CX:[(0,MF),(4,F),(8,MF),(12,F)],HC:h16(PP,P,MP)})],
  [fill_latin16(),fill_roll16(),fill_latin8()],end_latin(),intro4()))

# ────────────────────────── GAÚCHO (gerados, não originais) ───────────

ALL.append(R("Rancheira",170,6,"Gaúcho",24,12,12,12,
  [V(24,{BU:[(0,F),(8,MF),(16,MF)],CX:[(4,MF),(12,MF),(20,MF)],HC:[(i,MF if i%4==0 else MP) for i in range(0,24,2)],AR:[(2,PP),(10,PP),(18,PP)],RI:[(0,PP),(8,PP),(16,PP)]}),
   V(24,{BU:[(0,F),(8,MF),(16,MF)],CX:[(4,MF),(12,MF),(20,MF)],HC:[(i,MP) for i in range(0,24,2)],HO:[(22,MP)]}),
   V(24,{BU:[(0,F),(8,MF),(16,MF)],CX:[(4,MF),(12,MF),(20,MF)],RI:[(0,MF),(8,MF),(16,MF)],HC:[(4,MP),(12,MP),(20,MP)]})],
  [V(12,{BU:[(0,FF),(6,FF),(11,FFF)],T1:[(0,F),(1,MF)],T2:[(2,F),(3,MF)],SU:[(4,FF),(5,F)],CX:[(6,F),(7,F),(8,FF),(9,FF),(10,FFF)],CR:[(11,FFF)]}),
   V(12,{CX:[(i,P+(FF-P)*i/11) for i in range(12)],BU:[(0,FF),(6,FF)],CR:[(11,FFF)]}),
   V(12,{T1:[(0,FF)],T2:[(2,FF),(3,F)],SU:[(4,FF),(5,FF)],BU:[(6,FF)],CX:[(7,FF),(8,FFF)],CR:[(11,FFF)]})],
  V(12,{BU:[(0,FFF),(4,FF),(8,FFF),(11,FFF)],CX:[(2,F),(6,FF),(9,FF),(10,FFF)],T1:[(1,F)],T2:[(3,F)],SU:[(5,FF),(7,FF)],CR:[(0,MF),(11,FFF)]}),
  intro6()))

ALL.append(R("Polca",120,4,"Gaúcho",16,16,16,8,
  [V(16,{BU:[(0,F),(8,F)],CX:[(4,F),(12,F)],HC:h8(MF,F),AR:[(2,PP),(10,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(4,MF),(8,F),(12,MF)],CX:[(4,F),(12,F)],HC:h8(MF,F)}),
   V(16,{BU:[(0,F),(8,F)],CX:[(4,F),(12,F)],RI:r8(MF,F),HC:[(4,MP),(12,MP)]})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Vanerão",165,4,"Gaúcho",16,16,16,8,
  [V(16,{BU:[(0,F),(2,MF),(4,F),(6,MF),(8,F),(10,MF),(12,F),(14,MF)],CX:[(4,F),(12,F)],HC:h8(F,FF),AR:[(3,PP),(11,PP)]}),
   V(16,{BU:[(0,F),(2,MF),(8,F),(10,MF)],CX:[(4,F),(12,F)],HC:h8(F,FF),RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(2,MF),(4,F),(6,MF),(8,F),(10,MF),(12,F),(14,MF)],CX:[(4,F),(12,F)],RI:r8(F,FF)})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Schottisch",110,4,"Gaúcho",16,16,16,8,
  [V(16,{BU:[(0,F),(8,F)],CX:[(4,MF),(12,MF)],HC:h8(MP,MF),AR:[(2,PP),(10,PP)],RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(4,MF),(8,F),(12,MF)],CX:[(4,MF),(12,MF)],HC:h8(MP,MF)}),
   V(16,{BU:[(0,F),(8,F)],CX:[(4,MF),(12,MF)],RI:r8(MP,MF)})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Mazurca",140,6,"Gaúcho",24,12,12,12,
  [V(24,{BU:[(0,F),(8,MF)],CX:[(4,MF),(16,F)],HC:[(i,MF if i%4==0 else MP) for i in range(0,24,2)],AR:[(2,PP),(10,PP),(18,PP)]}),
   V(24,{BU:[(0,F),(8,MF),(16,MF)],CX:[(4,MF),(16,F)],HC:[(i,MP) for i in range(0,24,2)],RI:[(0,PP),(8,PP),(16,PP)]}),
   V(24,{BU:[(0,F),(8,MF)],CX:[(4,MF),(16,F)],RI:[(0,MF),(8,MF),(16,MF)]})],
  [V(12,{BU:[(0,FF),(6,FF),(11,FFF)],T1:[(0,F),(1,MF)],T2:[(2,F),(3,MF)],SU:[(4,FF),(5,F)],CX:[(6,F),(7,F),(8,FF),(9,FF),(10,FFF)],CR:[(11,FFF)]}),
   V(12,{CX:[(i,P+(FF-P)*i/11) for i in range(12)],BU:[(0,FF),(6,FF)],CR:[(11,FFF)]}),
   V(12,{T1:[(0,FF)],T2:[(2,FF)],SU:[(4,FF),(5,FF)],BU:[(6,FF)],CX:[(8,FFF)],CR:[(11,FFF)]})],
  V(12,{BU:[(0,FFF),(4,FF),(8,FFF),(11,FFF)],CX:[(2,F),(6,FF),(9,FF),(10,FFF)],T1:[(1,F)],SU:[(5,FF),(7,FF)],CR:[(0,MF),(11,FFF)]}),
  intro6()))

ALL.append(R("Chimarrita",120,6,"Gaúcho",24,12,12,12,
  [V(24,{BU:[(0,F),(12,MF)],CX:[(8,MF),(20,MF)],HC:[(i,MF if i%4==0 else MP) for i in range(0,24,2)],AR:[(4,PP),(16,PP)],RI:[(0,PP),(8,PP),(16,PP)]}),
   V(24,{BU:[(0,F),(6,P),(12,MF)],CX:[(8,MF),(20,MF)],HC:[(i,MP) for i in range(0,24,2)],HO:[(22,MP)]}),
   V(24,{BU:[(0,F),(12,MF)],CX:[(8,MF),(20,MF)],RI:[(0,MP),(8,MP),(16,MP)],HC:[(4,PP),(12,PP),(20,PP)]})],
  [V(12,{BU:[(0,FF),(6,FF),(11,FFF)],T1:[(0,F),(1,MF)],T2:[(2,F),(3,MF)],SU:[(4,FF),(5,F)],CX:[(6,F),(7,F),(8,FF),(9,FF),(10,FFF)],CR:[(11,FFF)]}),
   V(12,{CX:[(i,P+(FF-P)*i/11) for i in range(12)],BU:[(0,FF),(6,FF)],CR:[(11,FFF)]}),
   V(12,{T1:[(0,FF)],T2:[(2,FF),(3,F)],SU:[(4,FF),(5,FF)],CX:[(8,FFF)],CR:[(11,FFF)],BU:[(6,FF)]})],
  V(12,{BU:[(0,FFF),(4,FF),(8,FFF),(11,FFF)],CX:[(2,F),(6,FF),(9,FF),(10,FFF)],T1:[(1,F)],T2:[(3,F)],SU:[(5,FF),(7,FF)],CR:[(0,MF),(11,FFF)]}),
  intro6()))

ALL.append(R("Chacarera",120,6,"Gaúcho",24,12,12,12,
  [V(24,{BU:[(0,F),(12,MF),(16,MF)],CX:[(6,MF),(18,MF)],HC:[(i,MF if i%4==0 else MP) for i in range(0,24,2)],AR:[(4,PP),(10,PP),(22,PP)],RI:[(0,PP),(8,PP),(16,PP)]}),
   V(24,{BU:[(0,F),(12,MF),(16,MF)],CX:[(6,MF),(18,MF),(22,PP)],HC:[(i,MP) for i in range(0,24,2)]}),
   V(24,{BU:[(0,F),(12,MF),(16,MF)],CX:[(6,MF),(18,MF)],RI:[(0,MP),(8,MP),(16,MP)],HC:[(4,PP),(12,PP),(20,PP)]})],
  [V(12,{BU:[(0,FF),(6,FF),(11,FFF)],T1:[(0,F),(1,MF)],T2:[(2,F),(3,MF)],SU:[(4,FF),(5,F)],CX:[(6,F),(7,F),(8,FF),(9,FF),(10,FFF)],CR:[(11,FFF)]}),
   V(12,{CX:[(i,P+(FF-P)*i/11) for i in range(12)],BU:[(0,FF),(6,FF)],CR:[(11,FFF)]}),
   V(12,{T1:[(0,FF)],T2:[(2,FF),(3,F)],SU:[(4,FF),(5,FF)],CX:[(8,FFF)],CR:[(11,FFF)],BU:[(6,FF)]})],
  V(12,{BU:[(0,FFF),(4,FF),(8,FFF),(11,FFF)],CX:[(2,F),(6,FF),(9,FF),(10,FFF)],T1:[(1,F)],T2:[(3,F)],SU:[(5,FF),(7,FF)],CR:[(0,MF),(11,FFF)]}),
  intro6()))

ALL.append(R("Rasguido Doble",90,4,"Gaúcho",16,16,16,8,
  [V(16,{BU:[(0,F),(3,MF),(6,MF),(8,F),(11,MF),(14,MF)],AR:[(4,MF),(12,MF)],HC:h8(MP,MF),RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(3,MF),(6,MF),(8,F),(11,MF),(14,MF)],AR:[(4,MF),(12,MF)],HC:h16(PP,P,MP)}),
   V(16,{BU:[(0,F),(3,MF),(6,MF),(8,F),(11,MF),(14,MF)],AR:[(4,MF),(8,PP),(12,MF)],HC:h8(MP,MF)})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))

ALL.append(R("Vaneira Missioneira",140,4,"Gaúcho",16,16,16,8,
  [V(16,{BU:[(0,F),(2,MF),(4,F),(6,MF),(8,F),(10,MF),(12,F),(14,MF)],CX:[(4,F),(12,F)],HC:h8(MF,F),AR:[(3,PP),(11,PP)]}),
   V(16,{BU:[(0,F),(2,MF),(8,F),(10,MF)],CX:[(4,F),(12,F)],HC:h8(MF,F),RI:[(0,PP),(8,PP)]}),
   V(16,{BU:[(0,F),(2,MF),(4,F),(6,MF),(8,F),(10,MF),(12,F),(14,MF)],CX:[(4,F),(12,F)],RI:r8(MF,F)})],
  [fill_rock16(),fill_roll16(),fill_rock8()],end_rock(),intro4()))


# ═════════════════════════════════════════════════════════════════════
def main():
    out_dir = os.path.join(os.path.dirname(__file__), '..', 'public', 'rhythm')
    replaced = 0
    for name, data in ALL:
        fn = f"{name}.json"
        fp = os.path.join(out_dir, fn)
        if fn in ORIGINALS:
            print(f"  ⊘ SKIP (original): {fn}")
            continue
        with open(fp, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        replaced += 1
        print(f"  ✓ {fn} ({data['tempo']} BPM, {data['beatsPerBar']}/x, {data['category']})")

    # Rebuild manifest
    all_files = sorted([f for f in os.listdir(out_dir) if f.endswith('.json') and f != 'manifest.json'])
    categories = {}
    for f in all_files:
        with open(os.path.join(out_dir, f), 'r') as fh:
            d = json.load(fh)
            categories.setdefault(d.get('category','Outros'), []).append(f)

    manifest = {"version": 9, "rhythms": all_files, "categories": categories}
    with open(os.path.join(out_dir, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(f"\n{'='*50}")
    print(f"Atualizados: {replaced} ritmos (12ch PRO)")
    print(f"Total: {len(all_files)} ritmos")
    for k,v in sorted(categories.items()):
        print(f"  {k}: {len(v)}")

if __name__ == '__main__':
    main()
