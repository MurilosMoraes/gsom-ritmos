#!/usr/bin/env python3
"""
GERADOR PROFISSIONAL DE RITMOS — GDrums
12 canais, ghost notes, dinâmica real, viradas únicas por gênero.

Channels (12):
  0  = bumbo.wav          (kick)
  1  = caixa.wav          (snare)
  2  = tom_1.wav          (high tom)
  3  = tom_2.wav          (mid tom)
  4  = chimbal_fechado.wav (hi-hat closed)
  5  = chimbal_aberto.wav  (hi-hat open)
  6  = prato.mp3          (crash)
  7  = surdo.wav          (floor tom / surdo)
  8  = aro.wav            (rim / cross-stick)
  9  = china.wav          (china cymbal)
  10 = ride.wav           (ride cymbal)
  11 = rototom.wav        (rototom)
"""
import json, os

# ─── Channel IDs ──────────────────────────────────────────────────────
BUMBO = 0;  CAIXA = 1;  TOM1 = 2;  TOM2 = 3
HHC = 4;    HHO = 5;    CRASH = 6;  SURDO = 7
ARO = 8;    CHINA = 9;  RIDE = 10;  ROTO = 11

# ─── Volumes ──────────────────────────────────────────────────────────
PP = 0.2    # pianissimo (ghost note sutil)
P  = 0.35   # piano (ghost note)
MP = 0.5    # mezzo-piano
MF = 0.65   # mezzo-forte
F  = 0.8    # forte
FF = 0.95   # fortissimo
FFF= 1.0    # max

AUDIO_FILES_12CH = [
    {"fileName":"bumbo.wav",          "audioData":"", "midiPath":"/midi/bumbo.wav"},
    {"fileName":"caixa.wav",          "audioData":"", "midiPath":"/midi/caixa.wav"},
    {"fileName":"tom_1.wav",          "audioData":"", "midiPath":"/midi/tom_1.wav"},
    {"fileName":"tom_2.wav",          "audioData":"", "midiPath":"/midi/tom_2.wav"},
    {"fileName":"chimbal_fechado.wav","audioData":"", "midiPath":"/midi/chimbal_fechado.wav"},
    {"fileName":"chimbal_aberto.wav", "audioData":"", "midiPath":"/midi/chimbal_aberto.wav"},
    {"fileName":"prato.mp3",         "audioData":"", "midiPath":"/midi/prato.mp3"},
    {"fileName":"surdo.wav",         "audioData":"", "midiPath":"/midi/surdo.wav"},
    {"fileName":"aro.wav",           "audioData":"", "midiPath":"/midi/aro.wav"},
    {"fileName":"china.wav",         "audioData":"", "midiPath":"/midi/china.wav"},
    {"fileName":"ride.wav",          "audioData":"", "midiPath":"/midi/ride.wav"},
    {"fileName":"rototom.wav",       "audioData":"", "midiPath":"/midi/rototom.wav"},
]

def var(steps, hits, speed=1):
    """Cria uma variação. hits = {channel: [(step, vol), ...]}"""
    pat = [[False]*steps for _ in range(12)]
    vol = [[0.0]*steps for _ in range(12)]
    for ch, data in hits.items():
        for s, v in data:
            if 0 <= s < steps:
                pat[ch][s] = True
                vol[ch][s] = round(v, 2)
    return {"pattern":pat, "volumes":vol, "audioFiles":[dict(a) for a in AUDIO_FILES_12CH], "steps":steps, "speed":speed}

def rhythm(name, tempo, bpb, cat, main_steps, fill_steps, end_steps, intro_steps, mains, fills, end, intro):
    return {
        "version":"1.5", "tempo":tempo, "beatsPerBar":bpb, "category":cat,
        "patternSteps":{"main":main_steps,"fill":fill_steps,"end":end_steps,"intro":intro_steps},
        "variations":{"main":mains, "fill":fills, "end":[end], "intro":[intro]},
        "fillStartSound":{"fileName":"prato.mp3","midiPath":"/midi/prato.mp3"},
        "fillReturnSound":{"fileName":"prato.mp3","midiPath":"/midi/prato.mp3"},
        "timestamp":"2026-03-24T12:00:00.000Z"
    }

# ─── Helpers de padrão ────────────────────────────────────────────────
def hh8(v=MF, acc=F):
    """Hi-hat 8ths com acentuação no downbeat"""
    return [(i, acc if i%4==0 else v) for i in range(0,16,2)]

def hh16(v=P, acc=MP, beat=MF):
    """Hi-hat 16ths com dinâmica: downbeat forte, upbeat ghost"""
    return [(i, beat if i%4==0 else (acc if i%2==0 else v)) for i in range(16)]

def ride8(v=MF, bell=F):
    """Ride 8ths com bell no downbeat"""
    return [(i, bell if i%4==0 else v) for i in range(0,16,2)]

def ride_jazz(v=MF, skip=P):
    """Ride jazz: spang-a-lang (1, skip, 3, skip...)"""
    return [(0,F),(2,skip),(4,v),(6,skip),(8,F),(10,skip),(12,v),(14,skip)]

# ═══════════════════════════════════════════════════════════════════════
#  RITMOS
# ═══════════════════════════════════════════════════════════════════════
ALL = []

# ──────────────────────────────────────────────────────────────────────
#  POP / ROCK
# ──────────────────────────────────────────────────────────────────────

ALL.append(("Pop Basic", rhythm("Pop Basic", 110, 4, "Pop/Rock", 16,16,16,8,
  [
    # Var1: básico com ride, ghost notes na caixa
    var(16, {BUMBO:[(0,F),(8,F),(10,MP)], CAIXA:[(4,F),(12,F)], HHC:hh8(),
             ARO:[(3,PP),(7,PP),(11,PP),(15,PP)], RIDE:[(0,P),(4,P),(8,P),(12,P)]}),
    # Var2: 16ths no chimbal, bumbo mais ativo
    var(16, {BUMBO:[(0,F),(6,MP),(8,F),(10,MP),(14,P)], CAIXA:[(4,F),(12,F),(15,PP)],
             HHC:hh16(), RIDE:[(0,P),(8,P)]}),
    # Var3: ride principal, china nos acentos
    var(16, {BUMBO:[(0,F),(3,P),(8,F),(10,MP)], CAIXA:[(4,F),(12,F)],
             RIDE:ride8(), HHC:[(4,MP),(12,MP)], CHINA:[(0,MP)]}),
  ],
  # Fills
  [
    # Fill 1: tom cascade com rototom
    var(16, {BUMBO:[(0,F),(8,F),(14,FF)], TOM1:[(0,F),(1,MF),(2,MP)], TOM2:[(3,F),(4,MF),(5,MP)],
             SURDO:[(6,F),(7,MF)], ROTO:[(8,MF),(9,MP),(10,P)], CAIXA:[(11,MF),(12,F),(13,FF)],
             CRASH:[(15,FFF)]}),
    # Fill 2: caixa crescendo + china
    var(16, {CAIXA:[(i, PP + (FF-PP)*i/15) for i in range(16)], BUMBO:[(0,F),(4,F),(8,F),(12,FF)],
             CHINA:[(15,FFF)]}),
    # Fill 3: rototom rolls
    var(8, {ROTO:[(0,F),(1,MF),(2,MP)], TOM1:[(3,F),(4,MF)], TOM2:[(5,F)],
            SURDO:[(6,FF)], CRASH:[(7,FFF)], BUMBO:[(0,F),(7,FF)]}),
  ],
  # End
  var(16, {BUMBO:[(0,FF),(4,F),(8,F),(12,FF),(15,FFF)], CAIXA:[(2,MF),(6,MF),(10,F),(13,F),(14,FF)],
           TOM1:[(1,MF)], TOM2:[(5,MF)], SURDO:[(8,F),(9,MF),(10,MF)], ROTO:[(11,MP)],
           CRASH:[(0,F),(15,FFF)], CHINA:[(8,MF)]}),
  # Intro
  var(8, {HHC:[(0,FF),(2,MF),(4,MF),(6,MF)], ARO:[(0,MP),(2,P),(4,P),(6,P)]})
)))

ALL.append(("Rock Straight", rhythm("Rock Straight", 130, 4, "Pop/Rock", 16,16,16,8,
  [
    var(16, {BUMBO:[(0,FF),(8,FF)], CAIXA:[(4,FF),(12,FF)], HHC:hh8(MF,FF),
             ARO:[(2,PP),(6,PP),(10,PP),(14,PP)]}),
    var(16, {BUMBO:[(0,FF),(6,MF),(8,FF)], CAIXA:[(4,FF),(12,FF)], HHC:hh8(MF,FF),
             RIDE:[(0,P),(8,P)]}),
    var(16, {BUMBO:[(0,FF),(8,FF),(10,F)], CAIXA:[(4,FF),(12,FF)], RIDE:ride8(F,FF),
             HHC:[(4,MF),(12,MF)], CHINA:[(0,MF)]}),
  ],
  [var(16, {BUMBO:[(0,FF),(8,FF),(14,FFF)], TOM1:[(0,FF),(1,F)], TOM2:[(2,FF),(3,F)],
            SURDO:[(4,FF),(5,F),(6,MF),(7,MP)], CAIXA:[(8,F),(9,F),(10,FF),(11,FF),(12,FFF),(13,FFF)],
            CRASH:[(15,FFF)]}),
   var(16, {CAIXA:[(i, P+(FF-P)*i/15) for i in range(12)]+[(12,FF),(13,FF),(14,FFF),(15,FFF)],
            BUMBO:[(0,FF),(4,FF),(8,FF),(12,FFF)], CRASH:[(15,FFF)]}),
   var(8, {TOM1:[(0,FF)], TOM2:[(1,FF),(2,F)], SURDO:[(3,FF),(4,F)], CAIXA:[(5,FF),(6,FFF)],
           CRASH:[(7,FFF)], BUMBO:[(0,FF),(7,FFF)]})],
  var(16, {BUMBO:[(0,FFF),(4,FF),(8,FF),(12,FFF),(15,FFF)], CAIXA:[(2,F),(6,F),(10,FF),(13,FF),(14,FFF)],
           TOM1:[(1,F)], TOM2:[(3,F),(5,F)], SURDO:[(7,FF),(8,FF),(9,F)],
           CRASH:[(0,FF),(15,FFF)], CHINA:[(12,FF)]}),
  var(8, {HHC:[(0,FF),(2,F),(4,F),(6,F)], CAIXA:[(4,MP)]})
)))

ALL.append(("Hard Rock", rhythm("Hard Rock", 140, 4, "Pop/Rock", 16,16,16,8,
  [
    var(16, {BUMBO:[(0,FFF),(2,F),(8,FFF),(10,F)], CAIXA:[(4,FFF),(12,FFF)],
             HHC:hh8(F,FF), CHINA:[(0,MP)]}),
    var(16, {BUMBO:[(0,FFF),(2,F),(6,MF),(8,FFF),(10,F),(14,MF)], CAIXA:[(4,FFF),(12,FFF)],
             HHC:hh8(F,FF), RIDE:[(0,P),(8,P)]}),
    var(16, {BUMBO:[(0,FFF),(2,F),(8,FFF),(10,F)], CAIXA:[(4,FFF),(12,FFF)],
             CRASH:[(0,FF),(4,F),(8,FF),(12,F)], RIDE:ride8(MF,F)}),
  ],
  [var(16, {BUMBO:[(0,FFF),(4,FFF),(8,FFF),(12,FFF),(15,FFF)],
            TOM1:[(0,FF),(1,F)], TOM2:[(2,FF),(3,F)], SURDO:[(4,FF),(5,FF),(6,F),(7,MF)],
            CAIXA:[(8,FF),(9,FF),(10,FFF),(11,FFF),(12,FFF),(13,FFF),(14,FFF)], CHINA:[(15,FFF)]}),
   var(8, {BUMBO:[(0,FFF),(4,FFF),(7,FFF)], TOM1:[(0,FF),(1,F)], TOM2:[(2,FF),(3,F)],
           SURDO:[(4,FF),(5,F)], CAIXA:[(6,FFF)], CRASH:[(7,FFF)]}),
   var(16, {CAIXA:[(i,MF+(FFF-MF)*i/15) for i in range(16)], BUMBO:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],
            CHINA:[(15,FFF)]})],
  var(16, {BUMBO:[(0,FFF),(2,FF),(4,FFF),(8,FFF),(10,FF),(12,FFF),(15,FFF)],
           CAIXA:[(1,F),(3,F),(5,FF),(6,FF),(7,FFF)], TOM1:[(8,FF)], TOM2:[(9,FF)],
           SURDO:[(10,FF),(11,FF)], ROTO:[(12,F),(13,F)], CRASH:[(0,FF),(15,FFF)], CHINA:[(7,FFF)]}),
  var(8, {HHC:[(0,FFF),(2,FF),(4,FF),(6,FF)], BUMBO:[(0,MF)]})
)))

ALL.append(("Funk", rhythm("Funk", 108, 4, "Funk/Soul/R&B", 16,16,16,8,
  [
    # Funky Drummer inspired — ghost notes essenciais
    var(16, {BUMBO:[(0,FF),(2,MF),(6,MF),(10,MF),(12,F)],
             CAIXA:[(4,FF),(12,F)], ARO:[(7,P),(9,P),(11,P),(15,P)],
             HHC:[(0,MF),(1,P),(2,MF),(3,P),(4,MF),(5,P),(6,MF),(8,MF),(9,P),(10,MF),(11,P),(12,MF),(14,MF),(15,P)],
             HHO:[(7,MP),(13,MP)], RIDE:[(0,PP),(8,PP)]}),
    # Var2: mais sujo, mais ghost
    var(16, {BUMBO:[(0,FF),(2,MF),(6,F),(10,MF)],
             CAIXA:[(4,FF),(7,PP),(9,PP),(11,PP),(12,F),(15,PP)],
             HHC:hh16(PP,P,MF), HHO:[(7,MP)],
             ARO:[(3,PP),(13,PP)], ROTO:[(14,PP)]}),
    # Var3: ride groove
    var(16, {BUMBO:[(0,FF),(3,MF),(6,MF),(10,MF),(12,F)],
             CAIXA:[(4,FF),(12,FF)], ARO:[(7,P),(15,P)],
             RIDE:ride8(MF,F), HHC:[(4,MP),(12,MP)], CHINA:[(0,P)]}),
  ],
  [var(16, {BUMBO:[(0,FF),(4,FF),(8,FF),(14,FFF)],
            CAIXA:[(1,P),(2,MF),(3,MP),(5,P),(6,MF),(7,MP)],
            TOM1:[(8,FF),(9,F)], TOM2:[(10,FF),(11,F)], SURDO:[(12,FF),(13,F)],
            CRASH:[(15,FFF)], ROTO:[(0,MF)]}),
   var(16, {CAIXA:[(0,P),(1,MP),(2,MF),(3,F),(4,FF),(5,P),(6,MP),(7,MF),(8,F),(9,FF),(10,MF),(11,F),(12,FF),(13,FF),(14,FFF),(15,FFF)],
            BUMBO:[(0,FF),(4,FF),(8,FF),(12,FFF)], CHINA:[(15,FFF)]}),
   var(8, {TOM1:[(0,FF)], ROTO:[(1,F),(2,MF)], TOM2:[(3,FF)], SURDO:[(4,FF),(5,F)],
           CAIXA:[(6,FFF)], CRASH:[(7,FFF)], BUMBO:[(0,F),(7,FFF)]})],
  var(16, {BUMBO:[(0,FFF),(2,F),(4,FF),(6,F),(8,FF),(12,FFF),(15,FFF)],
           CAIXA:[(1,MF),(3,MF),(5,F),(7,FF)], TOM1:[(8,FF)], TOM2:[(9,FF),(10,F)],
           SURDO:[(11,FF)], ROTO:[(12,F),(13,MF)], CRASH:[(0,F),(15,FFF)]}),
  var(8, {HHC:[(0,FF),(2,MF),(4,MF),(6,MF)], ARO:[(1,PP),(3,PP),(5,PP),(7,PP)]})
)))

ALL.append(("Reggae", rhythm("Reggae", 78, 4, "Reggae/Ska", 16,16,16,8,
  [
    # One Drop clássico — bumbo+caixa no 3, chimbal offbeat
    var(16, {BUMBO:[(8,FF)], ARO:[(8,F)],
             HHC:[(2,MF),(6,MF),(10,MF),(14,MF)], HHO:[(6,MP)],
             RIDE:[(0,P),(4,P),(8,P),(12,P)], ROTO:[(14,PP)]}),
    var(16, {BUMBO:[(8,FF)], ARO:[(8,F)],
             HHC:[(2,MF),(6,MF),(10,MF),(14,MF)],
             CRASH:[(0,MP)], RIDE:[(0,P),(8,P)], CHINA:[(8,PP)]}),
    var(16, {BUMBO:[(8,FF),(14,P)], ARO:[(8,F)],
             HHC:[(2,MF),(6,MF),(10,MF)], HHO:[(14,MF)],
             RIDE:[(0,P),(4,P),(8,P),(12,P)], SURDO:[(0,PP)]}),
  ],
  [var(16, {BUMBO:[(0,F),(8,FF),(14,FFF)], ARO:[(2,MF),(4,MF),(6,F)],
            TOM1:[(8,F)], TOM2:[(10,F)], SURDO:[(12,FF)],
            ROTO:[(9,MF),(11,MF)], CRASH:[(15,FFF)]}),
   var(8, {SURDO:[(0,FF),(1,F)], TOM2:[(2,FF)], TOM1:[(3,FF),(4,F)],
           ARO:[(5,F),(6,FF)], CRASH:[(7,FFF)], BUMBO:[(0,F),(7,FF)]}),
   var(16, {CAIXA:[(i,P+(F-P)*i/15) for i in range(12)]+[(12,F),(13,FF),(14,FFF)],
            BUMBO:[(0,F),(8,FF)], CRASH:[(15,FFF)]})],
  var(16, {BUMBO:[(0,FF),(8,FF),(14,FFF),(15,FFF)], ARO:[(2,F),(4,F),(6,FF)],
           TOM2:[(8,F),(9,MF)], SURDO:[(10,FF),(11,F),(12,FF)],
           CRASH:[(0,MF),(15,FFF)], CHINA:[(12,FF)]}),
  var(8, {HHC:[(0,FF),(2,MF),(4,MF),(6,MF)], RIDE:[(0,P)]})
)))

ALL.append(("Samba", rhythm("Samba", 100, 4, "Brasileiro", 16,16,16,8,
  [
    # Samba autêntico: bumbo sincopado, caixa ghost+accent, chimbal 16ths
    var(16, {BUMBO:[(0,FF),(15,F)],
             CAIXA:[(0,MF),(3,PP),(4,MF),(6,PP),(8,MF),(11,PP),(12,MF),(15,PP)],
             HHC:hh16(PP,P,MF), ARO:[(2,P),(6,P),(10,P),(14,P)],
             SURDO:[(0,MP),(8,MP)], RIDE:[(0,PP),(4,PP),(8,PP),(12,PP)]}),
    var(16, {BUMBO:[(0,FF),(7,P),(15,F)],
             CAIXA:[(0,MF),(3,PP),(4,MF),(6,PP),(8,MF),(11,PP),(12,MF)],
             HHC:hh16(PP,P,MF), HHO:[(15,MF)],
             SURDO:[(0,MP),(8,MP)], ROTO:[(14,PP)]}),
    var(16, {BUMBO:[(0,FF),(3,P),(15,F)],
             ARO:[(0,MF),(3,PP),(4,MF),(6,PP),(8,MF),(11,PP),(12,MF),(15,PP)],
             HHC:hh16(PP,P,MF), RIDE:[(0,P),(4,P),(8,P),(12,P)],
             SURDO:[(0,MF),(8,MF)]}),
  ],
  [var(16, {BUMBO:[(0,FF),(4,F),(8,FF),(14,FFF)],
            TOM1:[(0,F),(1,MF)], ROTO:[(2,F),(3,MF)], TOM2:[(4,FF),(5,F)],
            SURDO:[(6,FF),(7,F),(8,FF)], CAIXA:[(9,MF),(10,F),(11,FF),(12,FFF),(13,FFF)],
            CRASH:[(15,FFF)], CHINA:[(14,FF)]}),
   var(8, {TOM1:[(0,FF)], ROTO:[(1,F)], TOM2:[(2,FF)], SURDO:[(3,FF),(4,F)],
           CAIXA:[(5,FF),(6,FFF)], CRASH:[(7,FFF)], BUMBO:[(0,F),(7,FFF)]}),
   var(16, {CAIXA:[(i,PP+(FFF-PP)*i/15) for i in range(16)],
            BUMBO:[(0,FF),(8,FF)], SURDO:[(4,MF),(12,F)], CRASH:[(15,FFF)]})],
  var(16, {BUMBO:[(0,FFF),(3,F),(8,FF),(12,FFF),(15,FFF)],
           CAIXA:[(1,MF),(2,MF),(4,FF),(5,F),(6,MF)],
           TOM1:[(7,FF)], TOM2:[(8,FF),(9,F)], SURDO:[(10,FF),(11,F),(12,FF)],
           ROTO:[(13,MF),(14,MF)], CRASH:[(0,MF),(15,FFF)]}),
  var(8, {HHC:[(0,FF),(1,P),(2,MF),(3,P),(4,MF),(5,P),(6,MF),(7,P)],
          SURDO:[(0,MP),(4,MP)]})
)))

ALL.append(("Bossa Nova", rhythm("Bossa Nova", 130, 4, "Brasileiro", 16,16,16,8,
  [
    # Padrão João Gilberto: bumbo ostinato, cross-stick clave 3-2
    var(16, {BUMBO:[(0,F),(4,MF),(5,MF),(9,MF)],
             ARO:[(0,MF),(3,P),(6,P),(10,MF),(12,P)],
             HHC:hh8(P,MP), RIDE:[(0,PP),(4,PP),(8,PP),(12,PP)],
             SURDO:[(0,PP)]}),
    var(16, {BUMBO:[(0,F),(4,MF),(5,MF),(9,MF)],
             ARO:[(0,MF),(3,P),(6,P),(10,MF),(12,P)],
             RIDE:ride8(MP,MF), HHC:[(4,P),(12,P)]}),
    var(16, {BUMBO:[(0,F),(5,MF),(9,MF),(13,P)],
             ARO:[(0,MF),(3,P),(6,P),(10,MF),(12,P)],
             HHC:hh8(P,MP), ROTO:[(14,PP)], RIDE:[(0,PP),(8,PP)]}),
  ],
  [var(16, {BUMBO:[(0,F),(8,F),(14,FF)], ARO:[(2,MF),(4,MF),(6,F)],
            TOM2:[(8,F),(9,MF)], SURDO:[(10,FF),(11,F)],
            ROTO:[(12,MF),(13,MF)], CRASH:[(15,FF)]}),
   var(8, {TOM1:[(0,MF)], TOM2:[(1,MF),(2,MP)], SURDO:[(3,F),(4,MF)],
           ARO:[(5,MF),(6,F)], CRASH:[(7,FF)], BUMBO:[(0,MF),(7,F)]}),
   var(16, {ARO:[(i,P+(F-P)*i/15) for i in range(0,16,2)],
            BUMBO:[(0,F),(8,MF)], CRASH:[(15,FF)]})],
  var(16, {BUMBO:[(0,FF),(4,MF),(8,F),(12,FF),(15,FF)],
           ARO:[(1,MF),(3,MF),(5,F),(6,MF)], TOM2:[(7,F),(8,MF)],
           SURDO:[(9,F),(10,MF),(11,MF)], ROTO:[(12,MF),(13,MF)],
           CRASH:[(0,MP),(15,FF)]}),
  var(8, {HHC:[(0,MF),(2,MP),(4,MP),(6,MP)], ARO:[(0,P),(4,P)], RIDE:[(0,PP)]})
)))

ALL.append(("Jazz Swing", rhythm("Jazz Swing", 140, 4, "Jazz", 16,16,16,8,
  [
    # Spang-a-lang no ride, chimbal foot 2&4, bumbo feathered
    var(16, {BUMBO:[(0,PP),(4,PP),(8,PP),(12,PP)],
             RIDE:ride_jazz(MF,P), HHC:[(4,MF),(12,MF)],
             CAIXA:[(6,PP),(14,PP)]}),
    var(16, {BUMBO:[(0,PP),(4,PP),(8,PP),(10,PP),(12,PP)],
             RIDE:ride_jazz(MF,P), HHC:[(4,MF),(12,MF)],
             ARO:[(6,PP)], ROTO:[(14,PP)]}),
    var(16, {BUMBO:[(0,PP),(8,PP)], CAIXA:[(6,PP),(14,PP)],
             RIDE:ride_jazz(F,MP), HHC:[(4,F),(12,F)],
             SURDO:[(10,PP)]}),
  ],
  [var(16, {BUMBO:[(0,MF),(8,MF),(14,F)],
            RIDE:[(0,MF),(2,P),(4,MF),(6,P)],
            CAIXA:[(8,MF),(9,MP),(10,F),(11,F),(12,FF),(13,FF)],
            SURDO:[(14,FF)], CRASH:[(15,FF)]}),
   var(8, {TOM1:[(0,F),(1,MF)], TOM2:[(2,F),(3,MF)], SURDO:[(4,F),(5,F)],
           CAIXA:[(6,FF)], CRASH:[(7,FF)], BUMBO:[(0,MF),(7,F)]}),
   var(16, {CAIXA:[(i,PP+(F-PP)*i/15) for i in range(16)],
            BUMBO:[(0,MF),(4,MF),(8,F),(12,FF)], RIDE:[(0,MF),(4,MF),(8,MF),(12,MF)],
            CRASH:[(15,FF)]})],
  var(16, {BUMBO:[(0,MF),(4,MF),(8,MF),(12,F),(15,FF)],
           RIDE:ride_jazz(), CAIXA:[(8,MF),(10,F),(12,FF)],
           TOM2:[(13,MF)], SURDO:[(14,FF)], CRASH:[(0,MP),(15,FF)]}),
  var(8, {RIDE:[(0,MF),(2,P),(4,MF),(6,P)], HHC:[(2,MP),(6,MP)], BUMBO:[(0,PP)]})
)))

ALL.append(("Gospel Groove", rhythm("Gospel Groove", 100, 4, "Gospel", 16,16,16,8,
  [
    var(16, {BUMBO:[(0,FF),(6,MF),(8,FF),(10,MF)],
             CAIXA:[(4,FF),(12,FF)], ARO:[(3,PP),(7,PP),(11,PP),(15,PP)],
             HHC:hh16(PP,P,MF), RIDE:[(0,P),(4,P),(8,P),(12,P)],
             SURDO:[(0,PP)]}),
    var(16, {BUMBO:[(0,FF),(6,MF),(8,FF),(10,MF)],
             CAIXA:[(4,FF),(7,PP),(12,FF),(14,PP)], ARO:[(3,PP),(11,PP)],
             HHC:hh16(PP,P,MF), HHO:[(14,MP)]}),
    var(16, {BUMBO:[(0,FF),(6,MF),(8,FF),(10,MF)],
             CAIXA:[(4,FF),(12,FF)], RIDE:ride8(MF,F),
             HHC:[(4,MP),(12,MP)], CHINA:[(0,P)], ARO:[(7,PP),(15,PP)]}),
  ],
  [var(16, {BUMBO:[(0,FF),(4,FF),(8,FF),(14,FFF)],
            TOM1:[(0,F),(1,MF)], ROTO:[(2,F),(3,MF)], TOM2:[(4,FF),(5,F)],
            SURDO:[(6,FF),(7,F),(8,FF)], CAIXA:[(9,F),(10,FF),(11,FF),(12,FFF),(13,FFF)],
            CRASH:[(15,FFF)], CHINA:[(14,FF)]}),
   var(16, {CAIXA:[(i,PP+(FFF-PP)*i/15) for i in range(16)],
            BUMBO:[(0,FF),(4,FF),(8,FF),(12,FFF)], CHINA:[(15,FFF)]}),
   var(8, {TOM1:[(0,FF)], ROTO:[(1,F)], TOM2:[(2,FF)], SURDO:[(3,FF),(4,F)],
           CAIXA:[(5,FF),(6,FFF)], CRASH:[(7,FFF)], BUMBO:[(0,FF),(7,FFF)]})],
  var(16, {BUMBO:[(0,FFF),(4,FF),(8,FF),(12,FFF),(15,FFF)],
           CAIXA:[(2,F),(6,F),(10,FF),(13,FF),(14,FFF)],
           TOM1:[(1,F)], TOM2:[(3,F),(5,F)], SURDO:[(7,FF),(8,FF),(9,F)],
           ROTO:[(11,MF)], CRASH:[(0,F),(15,FFF)], CHINA:[(12,FF)]}),
  var(8, {HHC:[(0,FF),(2,MF),(4,MF),(6,MF)], ARO:[(0,P),(4,P)], RIDE:[(0,PP)]})
)))

ALL.append(("Worship 6-8", rhythm("Worship 6-8", 70, 6, "Gospel", 24,12,12,12,
  [
    var(24, {BUMBO:[(0,FF),(12,MF)],
             CAIXA:[(8,MF),(20,MF)], ARO:[(4,PP),(16,PP)],
             HHC:[(i, MF if i%4==0 else (MP if i%2==0 else PP)) for i in range(24)],
             RIDE:[(0,P),(8,P),(16,P)], SURDO:[(0,PP)]}),
    var(24, {BUMBO:[(0,FF),(10,P),(12,MF)],
             CAIXA:[(8,MF),(20,MF)], ARO:[(4,PP),(16,PP)],
             HHC:[(i, MF if i%4==0 else MP) for i in range(0,24,2)],
             HHO:[(22,MP)], RIDE:[(0,PP),(12,PP)]}),
    var(24, {BUMBO:[(0,FF),(12,MF)],
             CAIXA:[(8,MF),(20,MF)],
             RIDE:[(i, MF if i%8==0 else MP) for i in range(0,24,4)],
             HHC:[(4,MP),(12,MP),(20,MP)], CHINA:[(0,PP)]}),
  ],
  [var(12, {BUMBO:[(0,FF),(6,FF),(11,FFF)], TOM1:[(0,F),(1,MF)], TOM2:[(2,F),(3,MF)],
            SURDO:[(4,FF),(5,F)], ROTO:[(6,F),(7,MF)], CAIXA:[(8,FF),(9,FF),(10,FFF)],
            CRASH:[(11,FFF)]}),
   var(12, {CAIXA:[(i,P+(FF-P)*i/11) for i in range(12)], BUMBO:[(0,FF),(6,FF)], CRASH:[(11,FFF)]}),
   var(12, {TOM1:[(0,FF)], ROTO:[(1,F)], TOM2:[(2,FF),(3,F)], SURDO:[(4,FF),(5,FF)],
            BUMBO:[(6,FF)], CAIXA:[(7,FF),(8,FFF)], CRASH:[(11,FFF)]})],
  var(12, {BUMBO:[(0,FFF),(4,FF),(8,FFF),(11,FFF)], CAIXA:[(2,F),(6,FF),(9,FF),(10,FFF)],
           TOM1:[(1,F)], TOM2:[(3,F)], SURDO:[(5,FF),(7,FF)],
           CRASH:[(0,MF),(11,FFF)]}),
  var(12, {HHC:[(0,FF),(4,MF),(8,MF)], RIDE:[(0,PP)], ARO:[(2,PP),(6,PP),(10,PP)]})
)))

ALL.append(("Hip Hop", rhythm("Hip Hop", 90, 4, "Eletrônico", 16,16,16,8,
  [
    # Boom bap: bumbo pesado, caixa seca, chimbal 8ths com swing
    var(16, {BUMBO:[(0,FFF),(8,FFF),(10,F),(14,MF)],
             CAIXA:[(4,FF),(12,FF)], HHC:hh8(MP,MF),
             ARO:[(3,PP),(7,PP),(11,PP)], SURDO:[(0,PP)]}),
    var(16, {BUMBO:[(0,FFF),(8,FFF),(10,F)],
             CAIXA:[(4,FF),(12,FF)], HHC:hh16(PP,P,MF),
             HHO:[(14,MP)], ARO:[(7,PP)]}),
    var(16, {BUMBO:[(0,FFF),(3,P),(8,FFF),(10,F),(14,MF)],
             CAIXA:[(4,FF),(12,FF)], HHC:hh8(MP,MF),
             RIDE:[(0,PP),(8,PP)], ROTO:[(6,PP)]}),
  ],
  [var(16, {BUMBO:[(0,FFF),(4,FFF),(8,FFF),(14,FFF)],
            CAIXA:[(2,MF),(6,MF),(10,F),(12,FF),(13,FFF)],
            TOM2:[(8,F),(9,F)], SURDO:[(10,FF),(11,F)],
            ROTO:[(0,MF),(1,MF)], CRASH:[(15,FFF)]}),
   var(8, {ROTO:[(0,FF),(1,F)], TOM1:[(2,FF)], TOM2:[(3,FF)], SURDO:[(4,FF),(5,FF)],
           CAIXA:[(6,FFF)], CRASH:[(7,FFF)], BUMBO:[(0,FF),(7,FFF)]}),
   var(16, {CAIXA:[(i,P+(FFF-P)*i/15) for i in range(16)],
            BUMBO:[(0,FFF),(8,FFF)], CHINA:[(15,FFF)]})],
  var(16, {BUMBO:[(0,FFF),(4,FF),(8,FFF),(12,FFF),(15,FFF)],
           CAIXA:[(2,F),(6,F),(10,FF),(13,FF),(14,FFF)],
           TOM2:[(7,F),(8,MF)], SURDO:[(9,FF),(10,F),(11,F)],
           CRASH:[(0,MF),(15,FFF)]}),
  var(8, {HHC:[(0,FF),(2,MF),(4,MF),(6,MF)], BUMBO:[(0,MF)]})
)))

ALL.append(("Disco", rhythm("Disco", 120, 4, "Pop/Rock", 16,16,16,8,
  [
    # Four on the floor, chimbal 16ths com open offbeat (classic disco)
    var(16, {BUMBO:[(0,FF),(4,FF),(8,FF),(12,FF)],
             CAIXA:[(4,F),(12,F)],
             HHC:hh16(P,MP,MF), HHO:[(2,MP),(6,MP),(10,MP),(14,MP)],
             ARO:[(3,PP),(7,PP),(11,PP),(15,PP)], RIDE:[(0,PP),(8,PP)]}),
    var(16, {BUMBO:[(0,FF),(4,FF),(8,FF),(12,FF)],
             CAIXA:[(4,F),(12,F)], HHC:hh8(MF,F),
             HHO:[(2,MP),(6,MP),(10,MP),(14,MP)], SURDO:[(0,PP)]}),
    var(16, {BUMBO:[(0,FF),(4,FF),(8,FF),(12,FF)],
             CAIXA:[(4,F),(12,F)], HHC:hh16(PP,P,MF),
             CHINA:[(0,P)], RIDE:[(0,P),(4,P),(8,P),(12,P)]}),
  ],
  [var(16, {BUMBO:[(0,FF),(4,FF),(8,FF),(12,FF),(15,FFF)],
            TOM1:[(0,F),(1,MF)], TOM2:[(2,F),(3,MF)], SURDO:[(4,FF),(5,F),(6,MF)],
            ROTO:[(7,F),(8,MF)], CAIXA:[(9,F),(10,FF),(11,FF),(12,FFF),(13,FFF)],
            CRASH:[(15,FFF)]}),
   var(8, {TOM1:[(0,FF)], ROTO:[(1,F)], TOM2:[(2,FF)], SURDO:[(3,FF),(4,FF)],
           CAIXA:[(5,FF),(6,FFF)], CRASH:[(7,FFF)], BUMBO:[(0,FF),(4,FF),(7,FFF)]}),
   var(16, {CAIXA:[(i,P+(FF-P)*i/15) for i in range(16)], BUMBO:[(0,FF),(4,FF),(8,FF),(12,FF)],
            CRASH:[(15,FFF)]})],
  var(16, {BUMBO:[(0,FFF),(4,FF),(8,FF),(12,FFF),(15,FFF)],
           CAIXA:[(2,F),(6,F),(10,FF),(13,FF),(14,FFF)],
           TOM1:[(1,F)], TOM2:[(3,F)], SURDO:[(5,FF),(7,FF)],
           CRASH:[(0,F),(15,FFF)], CHINA:[(8,F)]}),
  var(8, {HHC:[(0,FF),(1,P),(2,MF),(3,P),(4,MF),(5,P),(6,MF),(7,P)],
          BUMBO:[(0,F),(2,F),(4,F),(6,F)]})
)))

ALL.append(("House", rhythm("House", 125, 4, "Eletrônico", 16,16,16,8,
  [
    var(16, {BUMBO:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],
             CAIXA:[(4,F),(12,F)], HHC:hh8(MF,F),
             HHO:[(2,MP),(6,MP),(10,MP),(14,MP)],
             RIDE:[(0,PP),(8,PP)], ARO:[(3,PP),(11,PP)]}),
    var(16, {BUMBO:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],
             CAIXA:[(4,F),(12,F)], HHC:hh16(P,MP,MF),
             ROTO:[(2,PP),(10,PP)]}),
    var(16, {BUMBO:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)],
             CAIXA:[(4,F),(12,F)], HHC:hh8(MF,F),
             HHO:[(6,MF),(14,MF)], CHINA:[(0,PP)]}),
  ],
  [var(16, {BUMBO:[(0,FFF),(4,FFF),(8,FFF),(12,FFF),(15,FFF)],
            TOM1:[(0,F),(1,MF)], TOM2:[(2,FF),(3,F)], SURDO:[(4,FF),(5,FF),(6,F)],
            ROTO:[(7,F),(8,MF)], CAIXA:[(9,F),(10,FF),(11,FF),(12,FFF),(13,FFF)],
            CRASH:[(15,FFF)]}),
   var(8, {CAIXA:[(0,MF),(1,F),(2,FF),(3,FF),(4,FFF),(5,FFF),(6,FFF)],
           CRASH:[(7,FFF)], BUMBO:[(0,FFF),(4,FFF),(7,FFF)]}),
   var(16, {HHC:[(i,P+(FF-P)*i/15) for i in range(16)], HHO:[(15,FF)],
            BUMBO:[(0,FFF),(4,FFF),(8,FFF),(12,FFF)], CRASH:[(15,FFF)]})],
  var(16, {BUMBO:[(0,FFF),(4,FFF),(8,FFF),(12,FFF),(15,FFF)],
           CAIXA:[(2,F),(6,F),(10,FF),(13,FF),(14,FFF)],
           TOM2:[(7,F)], SURDO:[(8,FF),(9,F)], ROTO:[(11,MF)],
           CRASH:[(0,F),(15,FFF)]}),
  var(8, {HHC:[(0,FF),(2,MF),(4,MF),(6,MF)], BUMBO:[(0,FFF),(2,FFF),(4,FFF),(6,FFF)]})
)))

# ═════════════════════════════════════════════════════════════════════
# GENERATE
# ═════════════════════════════════════════════════════════════════════
def main():
    out_dir = os.path.join(os.path.dirname(__file__), '..', 'public', 'rhythm')
    replaced = []

    for name, data in ALL:
        filename = f"{name}.json"
        filepath = os.path.join(out_dir, filename)
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        replaced.append(filename)
        print(f"  ✓ {filename} ({data['tempo']} BPM, {data['beatsPerBar']}/x, {data['category']})")

    # Rebuild manifest
    all_files = sorted([f for f in os.listdir(out_dir) if f.endswith('.json') and f != 'manifest.json'])
    categories = {}
    for f in all_files:
        with open(os.path.join(out_dir, f), 'r') as fh:
            d = json.load(fh)
            cat = d.get('category', 'Outros')
            categories.setdefault(cat, []).append(f)

    manifest = {"version": 8, "rhythms": all_files, "categories": categories}
    with open(os.path.join(out_dir, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(f"\nAtualizados: {len(replaced)} ritmos (12ch, pro quality)")
    print(f"Total no manifest: {len(all_files)}")

if __name__ == '__main__':
    main()
