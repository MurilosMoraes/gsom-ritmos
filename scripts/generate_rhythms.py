#!/usr/bin/env python3
"""
Gerador de ritmos para GDrums.
Cria JSONs no formato do sequenciador usando os MIDIs existentes.
Channels: 0=bumbo, 1=caixa, 2=tom1, 3=tom2, 4=chimbal_fechado, 5=chimbal_aberto, 6=prato, 7=surdo
Volumes: 0.0 a 1.0 (ghost=0.3, normal=0.6, accent=0.85, forte=1.0)
"""
import json, os, sys

# ─── Channel mapping ──────────────────────────────────────────────────
CH_BUMBO = 0
CH_CAIXA = 1
CH_TOM1 = 2
CH_TOM2 = 3
CH_HH_CLOSED = 4
CH_HH_OPEN = 5
CH_PRATO = 6
CH_SURDO = 7

# Volumes
G = 0.3   # ghost
S = 0.5   # soft
N = 0.65  # normal
A = 0.8   # accent
F = 1.0   # forte

AUDIO_FILES_8CH = [
    {"fileName": "bumbo.wav", "audioData": "", "midiPath": "/midi/bumbo.wav"},
    {"fileName": "caixa.wav", "audioData": "", "midiPath": "/midi/caixa.wav"},
    {"fileName": "tom_1.wav", "audioData": "", "midiPath": "/midi/tom_1.wav"},
    {"fileName": "tom_2.wav", "audioData": "", "midiPath": "/midi/tom_2.wav"},
    {"fileName": "chimbal_fechado.wav", "audioData": "", "midiPath": "/midi/chimbal_fechado.wav"},
    {"fileName": "chimbal_aberto.wav", "audioData": "", "midiPath": "/midi/chimbal_aberto.wav"},
    {"fileName": "prato.mp3", "audioData": "", "midiPath": "/midi/prato.mp3"},
    {"fileName": "surdo.wav", "audioData": "", "midiPath": "/midi/surdo.wav"},
]

def make_pattern(steps, channels_data):
    """channels_data: dict of {channel_idx: [(step, volume), ...]}"""
    pattern = [[False]*steps for _ in range(8)]
    volumes = [[0.0]*steps for _ in range(8)]
    for ch, hits in channels_data.items():
        for step, vol in hits:
            if step < steps:
                pattern[ch][step] = True
                volumes[ch][step] = vol
    return pattern, volumes

def make_variation(steps, channels_data, speed=1):
    pattern, volumes = make_pattern(steps, channels_data)
    return {
        "pattern": pattern,
        "volumes": volumes,
        "audioFiles": [dict(af) for af in AUDIO_FILES_8CH],
        "steps": steps,
        "speed": speed
    }

def make_fill_descending(steps=16):
    """Fill clássico: bumbo + caixa + toms descendente"""
    hits = {
        CH_BUMBO: [(0, A), (4, A), (8, A), (12, F)],
        CH_CAIXA: [(2, N), (6, N), (10, A), (14, F)],
        CH_TOM1: [(0, A), (1, N), (2, S), (3, G)],
        CH_TOM2: [(4, A), (5, N), (6, S), (7, G)],
        CH_SURDO: [(8, A), (9, N), (10, S), (11, G)],
        CH_PRATO: [(15, F)],
    }
    return make_variation(steps, hits)

def make_fill_snare_roll(steps=16):
    """Fill: rulo de caixa crescendo"""
    hits = {
        CH_CAIXA: [(i, G + (A-G) * i/15) for i in range(16)],
        CH_BUMBO: [(0, A), (12, F)],
        CH_PRATO: [(15, F)],
    }
    return make_variation(steps, hits)

def make_fill_toms(steps=8):
    """Fill curto: toms"""
    hits = {
        CH_TOM1: [(0, A), (1, N)],
        CH_TOM2: [(2, A), (3, N)],
        CH_SURDO: [(4, A), (5, N), (6, A)],
        CH_PRATO: [(7, F)],
        CH_BUMBO: [(0, A), (7, F)],
    }
    return make_variation(steps, hits)

def make_fill_half_time(steps=8):
    """Fill meio tempo com prato"""
    hits = {
        CH_BUMBO: [(0, F), (4, F)],
        CH_CAIXA: [(2, A), (6, A)],
        CH_TOM1: [(1, N)],
        CH_TOM2: [(3, N), (5, N)],
        CH_SURDO: [(7, A)],
        CH_PRATO: [(7, F)],
    }
    return make_variation(steps, hits)

def make_ending(steps=16):
    """Ending padrão: desacelera + crash"""
    hits = {
        CH_BUMBO: [(0, F), (4, A), (8, A), (12, F), (15, F)],
        CH_CAIXA: [(2, N), (6, N), (10, A), (13, A), (14, F)],
        CH_TOM1: [(1, N), (3, G)],
        CH_TOM2: [(5, N), (7, G)],
        CH_SURDO: [(8, A), (9, N), (10, N), (11, N)],
        CH_PRATO: [(0, A), (15, F)],
    }
    return make_variation(steps, hits)

def make_intro_count(steps=8, beats=4):
    """Intro: contagem com chimbal"""
    hits = {CH_HH_CLOSED: []}
    step_per_beat = steps // beats
    for i in range(beats):
        s = i * step_per_beat
        hits[CH_HH_CLOSED].append((s, A if i == 0 else N))
    return make_variation(steps, hits)

def make_rhythm(name, tempo, beats_per_bar, main_steps, fill_steps, end_steps, intro_steps,
                main_vars, fill_vars=None, end_var=None, intro_var=None, category=""):
    if fill_vars is None:
        fill_vars = [make_fill_descending(fill_steps), make_fill_snare_roll(fill_steps), make_fill_toms(min(fill_steps, 8))]
    if end_var is None:
        end_var = make_ending(end_steps)
    if intro_var is None:
        intro_var = make_intro_count(intro_steps, beats_per_bar)

    return {
        "version": "1.5",
        "tempo": tempo,
        "beatsPerBar": beats_per_bar,
        "category": category,
        "patternSteps": {
            "main": main_steps,
            "fill": fill_steps,
            "end": end_steps,
            "intro": intro_steps
        },
        "variations": {
            "main": main_vars,
            "fill": fill_vars if len(fill_vars) == 3 else (fill_vars + [fill_vars[-1]])[:3],
            "end": [end_var],
            "intro": [intro_var]
        },
        "fillStartSound": {"fileName": "prato.mp3", "midiPath": "/midi/prato.mp3"},
        "fillReturnSound": {"fileName": "prato.mp3", "midiPath": "/midi/prato.mp3"},
        "timestamp": "2026-03-24T00:00:00.000Z"
    }

# Helper: 8th note hi-hat (every 2 steps in 16-step grid)
def hh8(steps=16, vol=N):
    return [(i, vol if i % 4 == 0 else S) for i in range(0, steps, 2)]

# Helper: 16th note hi-hat
def hh16(steps=16, vol=N):
    return [(i, vol if i % 4 == 0 else (S if i % 2 == 0 else G)) for i in range(steps)]

# Helper: ride 8ths
def ride8(steps=16, vol=N):
    return [(i, vol if i % 4 == 0 else S) for i in range(0, steps, 2)]

# ═══════════════════════════════════════════════════════════════════════
# RHYTHM DEFINITIONS
# ═══════════════════════════════════════════════════════════════════════

ALL_RHYTHMS = []

# ─── POP / ROCK ───────────────────────────────────────────────────────

# Pop Basic
ALL_RHYTHMS.append(("Pop Basic", 110, 4, "Pop/Rock", lambda: make_rhythm(
    "Pop Basic", 110, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, A), (10, N)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh8(),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, S), (8, A), (10, N)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh16(),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (3, G), (8, A), (10, N), (14, G)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: [(i, N) for i in range(0, 16, 2)],
            CH_HH_OPEN: [(15, S)],
        }),
    ],
    category="Pop/Rock"
)))

# Pop Shuffle
ALL_RHYTHMS.append(("Pop Shuffle", 108, 4, "Pop/Rock", lambda: make_rhythm(
    "Pop Shuffle", 108, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, A)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: [(0, A), (2, G), (4, A), (6, G), (8, A), (10, G), (12, A), (14, G)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, S), (8, A)],
            CH_CAIXA: [(4, A), (12, A), (14, G)],
            CH_HH_CLOSED: [(0, A), (2, G), (4, A), (6, G), (8, A), (10, G), (12, A), (14, G)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, A), (10, N)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: [(0, N), (2, G), (4, N), (6, G), (8, N), (10, G), (12, N), (14, G)],
            CH_HH_OPEN: [(6, S)],
        }),
    ],
    category="Pop/Rock"
)))

# Rock Straight
ALL_RHYTHMS.append(("Rock Straight", 130, 4, "Pop/Rock", lambda: make_rhythm(
    "Rock Straight", 130, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, F), (8, F)],
            CH_CAIXA: [(4, F), (12, F)],
            CH_HH_CLOSED: hh8(vol=A),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, F), (6, N), (8, F)],
            CH_CAIXA: [(4, F), (12, F)],
            CH_HH_CLOSED: hh8(vol=A),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, F), (8, F), (10, A)],
            CH_CAIXA: [(4, F), (12, F)],
            CH_HH_CLOSED: hh8(vol=A),
            CH_HH_OPEN: [(14, N)],
        }),
    ],
    category="Pop/Rock"
)))

# Hard Rock
ALL_RHYTHMS.append(("Hard Rock", 140, 4, "Pop/Rock", lambda: make_rhythm(
    "Hard Rock", 140, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, F), (2, A), (8, F), (10, A)],
            CH_CAIXA: [(4, F), (12, F)],
            CH_HH_CLOSED: hh8(vol=A),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, F), (2, A), (6, N), (8, F), (10, A), (14, N)],
            CH_CAIXA: [(4, F), (12, F)],
            CH_HH_CLOSED: hh8(vol=A),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, F), (2, A), (8, F), (10, A)],
            CH_CAIXA: [(4, F), (12, F)],
            CH_PRATO: [(0, A), (4, A), (8, A), (12, A)],
        }),
    ],
    category="Pop/Rock"
)))

# Punk Rock
ALL_RHYTHMS.append(("Punk Rock", 180, 4, "Pop/Rock", lambda: make_rhythm(
    "Punk Rock", 180, 4, 16, 8, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, F), (4, F), (8, F), (12, F)],
            CH_CAIXA: [(2, A), (6, A), (10, A), (14, A)],
            CH_HH_CLOSED: hh8(vol=A),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, F), (4, F), (8, F), (12, F)],
            CH_CAIXA: [(2, A), (6, A), (10, A), (14, A)],
            CH_PRATO: [(0, A), (2, A), (4, A), (6, A), (8, A), (10, A), (12, A), (14, A)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, F), (2, N), (4, F), (6, N), (8, F), (10, N), (12, F), (14, N)],
            CH_CAIXA: [(4, F), (12, F)],
            CH_HH_CLOSED: hh16(vol=A),
        }),
    ],
    category="Pop/Rock"
)))

# Grunge
ALL_RHYTHMS.append(("Grunge", 118, 4, "Pop/Rock", lambda: make_rhythm(
    "Grunge", 118, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, F), (8, F)],
            CH_CAIXA: [(4, F), (12, F)],
            CH_HH_CLOSED: hh8(),
            CH_HH_OPEN: [(14, N)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, F), (6, S), (8, F)],
            CH_CAIXA: [(4, F), (12, F)],
            CH_HH_CLOSED: hh8(),
            CH_HH_OPEN: [(14, N)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, F), (8, F), (10, N)],
            CH_CAIXA: [(4, F), (12, F), (14, G)],
            CH_HH_CLOSED: hh8(),
            CH_HH_OPEN: [(6, S), (14, N)],
        }),
    ],
    category="Pop/Rock"
)))

# Metal
ALL_RHYTHMS.append(("Metal", 160, 4, "Pop/Rock", lambda: make_rhythm(
    "Metal", 160, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(i, A) for i in range(0, 16, 2)],
            CH_CAIXA: [(4, F), (12, F)],
            CH_HH_CLOSED: hh16(vol=A),
        }),
        make_variation(16, {
            CH_BUMBO: [(i, A) for i in range(16)],
            CH_CAIXA: [(4, F), (12, F)],
            CH_PRATO: [(0, A), (4, A), (8, A), (12, A)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, F), (1, A), (4, F), (5, A), (8, F), (9, A), (12, F), (13, A)],
            CH_CAIXA: [(2, A), (6, A), (10, A), (14, A)],
            CH_HH_CLOSED: hh8(vol=F),
        }),
    ],
    category="Pop/Rock"
)))

# Power Ballad
ALL_RHYTHMS.append(("Power Ballad", 72, 4, "Pop/Rock", lambda: make_rhythm(
    "Power Ballad", 72, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, N)],
            CH_CAIXA: [(8, A)],
            CH_HH_CLOSED: hh8(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, G), (8, N)],
            CH_CAIXA: [(8, A)],
            CH_HH_CLOSED: hh8(vol=S),
            CH_HH_OPEN: [(14, G)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, N)],
            CH_CAIXA: [(8, A)],
            CH_PRATO: [(0, N), (4, N), (8, N), (12, N)],
        }),
    ],
    category="Pop/Rock"
)))

# Surf Rock
ALL_RHYTHMS.append(("Surf Rock", 160, 4, "Pop/Rock", lambda: make_rhythm(
    "Surf Rock", 160, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (4, A), (8, A), (12, A)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_PRATO: ride8(vol=A),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (4, A), (8, A), (12, A)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_TOM2: [(i, N) for i in range(16)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (4, A), (8, A), (12, A)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_PRATO: ride8(vol=A),
            CH_TOM2: [(2, G), (6, G), (10, G), (14, G)],
        }),
    ],
    category="Pop/Rock"
)))

# Indie Rock
ALL_RHYTHMS.append(("Indie Rock", 120, 4, "Pop/Rock", lambda: make_rhythm(
    "Indie Rock", 120, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, A)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh8(),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (10, N)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh8(),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, G), (8, A)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh8(),
            CH_HH_OPEN: [(14, S)],
        }),
    ],
    category="Pop/Rock"
)))

# Classic Rock
ALL_RHYTHMS.append(("Classic Rock", 100, 4, "Pop/Rock", lambda: make_rhythm(
    "Classic Rock", 100, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, F), (1, G), (8, F)],
            CH_CAIXA: [(4, F), (5, G), (12, F), (13, G)],
            CH_HH_CLOSED: hh8(vol=A),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, F), (1, G), (8, F), (10, N)],
            CH_CAIXA: [(4, F), (5, G), (12, F), (13, G)],
            CH_HH_CLOSED: hh8(vol=A),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, F), (8, F)],
            CH_CAIXA: [(4, F), (12, F)],
            CH_PRATO: ride8(vol=A),
        }),
    ],
    category="Pop/Rock"
)))

# Blues Shuffle
ALL_RHYTHMS.append(("Blues Shuffle", 90, 4, "Pop/Rock", lambda: make_rhythm(
    "Blues Shuffle", 90, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, A)],
            CH_CAIXA: [(4, N), (12, N)],
            CH_HH_CLOSED: [(0, A), (2, G), (4, A), (6, G), (8, A), (10, G), (12, A), (14, G)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, G), (8, A)],
            CH_CAIXA: [(4, N), (12, N)],
            CH_HH_CLOSED: [(0, A), (2, G), (4, A), (6, G), (8, A), (10, G), (12, A), (14, G)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, A)],
            CH_CAIXA: [(4, N), (12, N)],
            CH_PRATO: [(0, A), (2, S), (4, A), (6, S), (8, A), (10, S), (12, A), (14, S)],
        }),
    ],
    category="Pop/Rock"
)))

# Country
ALL_RHYTHMS.append(("Country", 120, 4, "Pop/Rock", lambda: make_rhythm(
    "Country", 120, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, A)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh8(),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (4, N), (8, A), (12, N)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh8(),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, A)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_PRATO: ride8(),
        }),
    ],
    category="Pop/Rock"
)))

# Country Train Beat
ALL_RHYTHMS.append(("Country Train Beat", 150, 4, "Pop/Rock", lambda: make_rhythm(
    "Country Train Beat", 150, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, A)],
            CH_CAIXA: [(i, A if i in [2,6,10,14] else G) for i in range(16) if i not in [0,8]],
            CH_HH_CLOSED: [(2, N), (6, N), (10, N), (14, N)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, A)],
            CH_CAIXA: [(i, A if i in [2,6,10,14] else S) for i in range(16) if i not in [0,8]],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (4, N), (8, A), (12, N)],
            CH_CAIXA: [(i, A if i in [2,6,10,14] else G) for i in range(16) if i not in [0,4,8,12]],
            CH_HH_CLOSED: [(2, N), (6, N), (10, N), (14, N)],
        }),
    ],
    category="Pop/Rock"
)))

# Disco
ALL_RHYTHMS.append(("Disco", 120, 4, "Pop/Rock", lambda: make_rhythm(
    "Disco", 120, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (4, A), (8, A), (12, A)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh16(),
            CH_HH_OPEN: [(2, S), (6, S), (10, S), (14, S)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (4, A), (8, A), (12, A)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh8(),
            CH_HH_OPEN: [(2, S), (6, S), (10, S), (14, S)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (4, A), (8, A), (12, A)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh16(vol=A),
        }),
    ],
    category="Pop/Rock"
)))

# Motown
ALL_RHYTHMS.append(("Motown", 115, 4, "Pop/Rock", lambda: make_rhythm(
    "Motown", 115, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (4, A), (8, A), (12, A)],
            CH_CAIXA: [(0, N), (4, N), (8, N), (12, N)],
            CH_HH_CLOSED: hh8(),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (4, A), (8, A), (12, A)],
            CH_CAIXA: [(0, N), (4, N), (8, N), (12, N)],
            CH_HH_CLOSED: hh16(),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (4, A), (8, A), (12, A)],
            CH_CAIXA: [(0, N), (4, N), (8, N), (12, N)],
            CH_PRATO: ride8(),
        }),
    ],
    category="Pop/Rock"
)))

# ─── FUNK / SOUL / R&B ───────────────────────────────────────────────

# Funk
ALL_RHYTHMS.append(("Funk", 110, 4, "Funk/Soul/R&B", lambda: make_rhythm(
    "Funk", 110, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (2, N), (6, N), (10, N), (12, A)],
            CH_CAIXA: [(4, F), (12, A)],
            CH_HH_CLOSED: [(0, N), (1, G), (2, N), (3, G), (4, N), (5, G), (6, N), (8, N), (9, G), (10, N), (11, G), (12, N), (14, N), (15, G)],
            CH_HH_OPEN: [(7, S), (13, S)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (2, N), (6, N), (10, N)],
            CH_CAIXA: [(4, F), (7, G), (9, G), (11, G), (12, A), (15, G)],
            CH_HH_CLOSED: hh16(),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (3, N), (6, N), (10, N), (12, A)],
            CH_CAIXA: [(4, F), (12, F)],
            CH_HH_CLOSED: hh16(vol=N),
            CH_HH_OPEN: [(7, S)],
        }),
    ],
    category="Funk/Soul/R&B"
)))

# Soul
ALL_RHYTHMS.append(("Soul", 95, 4, "Funk/Soul/R&B", lambda: make_rhythm(
    "Soul", 95, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, N), (8, A)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh16(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, N), (8, A)],
            CH_CAIXA: [(4, A), (7, G), (10, G), (12, A), (14, G)],
            CH_HH_CLOSED: hh16(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, S), (8, A), (14, G)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh16(vol=S),
            CH_HH_OPEN: [(14, S)],
        }),
    ],
    category="Funk/Soul/R&B"
)))

# R&B
ALL_RHYTHMS.append(("R&B", 90, 4, "Funk/Soul/R&B", lambda: make_rhythm(
    "R&B", 90, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, N), (10, N)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh16(vol=S),
            CH_HH_OPEN: [(15, S)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, N), (10, N)],
            CH_CAIXA: [(4, A), (12, A), (14, G)],
            CH_HH_CLOSED: hh16(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (3, G), (6, N), (10, N)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh16(vol=N),
        }),
    ],
    category="Funk/Soul/R&B"
)))

# Neo Soul
ALL_RHYTHMS.append(("Neo Soul", 85, 4, "Funk/Soul/R&B", lambda: make_rhythm(
    "Neo Soul", 85, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, S), (8, N)],
            CH_CAIXA: [(4, N), (10, G), (12, N)],
            CH_HH_CLOSED: hh16(vol=G),
            CH_HH_OPEN: [(6, G), (14, G)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, S)],
            CH_CAIXA: [(4, N), (12, N)],
            CH_HH_CLOSED: hh8(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, S), (10, G)],
            CH_CAIXA: [(4, N), (12, N), (14, G)],
            CH_PRATO: ride8(vol=S),
        }),
    ],
    category="Funk/Soul/R&B"
)))

# ─── REGGAE / SKA ─────────────────────────────────────────────────────

# Reggae (One Drop)
ALL_RHYTHMS.append(("Reggae", 78, 4, "Reggae/Ska", lambda: make_rhythm(
    "Reggae", 78, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(8, A)],
            CH_CAIXA: [(8, A)],
            CH_HH_CLOSED: [(2, N), (6, N), (10, N), (14, N)],
        }),
        make_variation(16, {
            CH_BUMBO: [(8, A)],
            CH_CAIXA: [(8, A)],
            CH_HH_CLOSED: [(2, N), (6, N), (10, N), (14, N)],
            CH_PRATO: [(0, S)],
        }),
        make_variation(16, {
            CH_BUMBO: [(8, A), (14, G)],
            CH_CAIXA: [(8, A)],
            CH_HH_CLOSED: [(2, N), (6, N), (10, N), (14, N)],
            CH_HH_OPEN: [(6, S)],
        }),
    ],
    category="Reggae/Ska"
)))

# Reggae Roots
ALL_RHYTHMS.append(("Reggae Roots", 72, 4, "Reggae/Ska", lambda: make_rhythm(
    "Reggae Roots", 72, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, A)],
            CH_CAIXA: [(4, N), (12, N)],
            CH_HH_CLOSED: [(2, N), (6, N), (10, N), (14, N)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, A)],
            CH_CAIXA: [(4, N), (12, N)],
            CH_HH_CLOSED: [(2, N), (6, N), (10, N), (14, N)],
            CH_PRATO: [(0, S)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, A)],
            CH_CAIXA: [(4, N), (12, N), (14, G)],
            CH_HH_CLOSED: [(2, N), (6, N), (10, N)],
            CH_HH_OPEN: [(14, N)],
        }),
    ],
    category="Reggae/Ska"
)))

# Reggaeton (Dembow)
ALL_RHYTHMS.append(("Reggaeton", 95, 4, "Reggae/Ska", lambda: make_rhythm(
    "Reggaeton", 95, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (4, A), (8, A), (12, A)],
            CH_CAIXA: [(3, A), (6, A), (11, A), (14, A)],
            CH_HH_CLOSED: [(0, N), (4, N), (8, N), (12, N)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (4, A), (8, A), (12, A)],
            CH_CAIXA: [(3, A), (6, A), (11, A), (14, A)],
            CH_HH_CLOSED: hh8(),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (4, A), (8, A), (12, A)],
            CH_CAIXA: [(3, A), (6, A), (11, A), (14, A)],
            CH_HH_CLOSED: hh16(vol=S),
        }),
    ],
    category="Reggae/Ska"
)))

# Ska
ALL_RHYTHMS.append(("Ska", 160, 4, "Reggae/Ska", lambda: make_rhythm(
    "Ska", 160, 4, 16, 8, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, A)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: [(2, A), (6, A), (10, A), (14, A)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, A), (10, N)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: [(2, A), (6, A), (10, A), (14, A)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (4, A), (8, A), (12, A)],
            CH_CAIXA: [(2, A), (6, A), (10, A), (14, A)],
            CH_HH_CLOSED: hh8(vol=A),
        }),
    ],
    category="Reggae/Ska"
)))

# ─── JAZZ ─────────────────────────────────────────────────────────────

# Jazz Swing
ALL_RHYTHMS.append(("Jazz Swing", 140, 4, "Jazz", lambda: make_rhythm(
    "Jazz Swing", 140, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, G), (4, G), (8, G), (12, G)],
            CH_PRATO: [(0, A), (2, S), (4, A), (6, S), (8, A), (10, S), (12, A), (14, S)],
            CH_HH_CLOSED: [(4, N), (12, N)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, G), (4, G), (8, G), (10, G), (12, G)],
            CH_PRATO: [(0, A), (2, S), (4, A), (6, S), (8, A), (10, S), (12, A), (14, S)],
            CH_HH_CLOSED: [(4, N), (12, N)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, G), (8, G)],
            CH_CAIXA: [(6, G), (14, G)],
            CH_PRATO: [(0, A), (2, S), (4, A), (6, S), (8, A), (10, S), (12, A), (14, S)],
            CH_HH_CLOSED: [(4, N), (12, N)],
        }),
    ],
    category="Jazz"
)))

# Jazz Waltz
ALL_RHYTHMS.append(("Jazz Waltz", 150, 6, "Jazz", lambda: make_rhythm(
    "Jazz Waltz", 150, 6, 24, 12, 12, 12,
    [
        make_variation(24, {
            CH_BUMBO: [(0, S), (8, G), (16, G)],
            CH_PRATO: [(0, A), (4, S), (8, A), (12, S), (16, A), (20, S)],
            CH_HH_CLOSED: [(8, N), (16, N)],
        }),
        make_variation(24, {
            CH_BUMBO: [(0, S), (16, G)],
            CH_CAIXA: [(12, G)],
            CH_PRATO: [(0, A), (4, S), (8, A), (12, S), (16, A), (20, S)],
            CH_HH_CLOSED: [(8, N), (16, N)],
        }),
        make_variation(24, {
            CH_BUMBO: [(0, S), (8, G)],
            CH_PRATO: [(0, A), (4, S), (8, A), (12, S), (16, A), (20, S)],
            CH_HH_CLOSED: [(8, N), (16, N)],
            CH_CAIXA: [(20, G)],
        }),
    ],
    category="Jazz"
)))

# Jazz Ballad
ALL_RHYTHMS.append(("Jazz Ballad", 60, 4, "Jazz", lambda: make_rhythm(
    "Jazz Ballad", 60, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, G)],
            CH_PRATO: [(0, S), (4, S), (8, S), (12, S)],
            CH_HH_CLOSED: [(4, S), (12, S)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, G), (8, G)],
            CH_CAIXA: [(10, G)],
            CH_PRATO: [(0, S), (4, S), (8, S), (12, S)],
            CH_HH_CLOSED: [(4, S), (12, S)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, G)],
            CH_PRATO: [(0, S), (2, G), (4, S), (6, G), (8, S), (10, G), (12, S), (14, G)],
            CH_HH_CLOSED: [(4, S), (12, S)],
        }),
    ],
    category="Jazz"
)))

# Jazz Fusion
ALL_RHYTHMS.append(("Jazz Fusion", 110, 4, "Jazz", lambda: make_rhythm(
    "Jazz Fusion", 110, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, N), (10, N)],
            CH_CAIXA: [(4, N), (12, N), (14, G)],
            CH_HH_CLOSED: hh16(vol=S),
            CH_HH_OPEN: [(6, S)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (3, G), (6, N), (10, N)],
            CH_CAIXA: [(4, N), (8, G), (12, N)],
            CH_PRATO: ride8(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, N), (10, N), (14, G)],
            CH_CAIXA: [(4, N), (12, N)],
            CH_HH_CLOSED: hh16(vol=S),
        }),
    ],
    category="Jazz"
)))

# ─── ELETRÔNICO ───────────────────────────────────────────────────────

# House
ALL_RHYTHMS.append(("House", 125, 4, "Eletrônico", lambda: make_rhythm(
    "House", 125, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, F), (4, F), (8, F), (12, F)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh8(),
            CH_HH_OPEN: [(2, S), (6, S), (10, S), (14, S)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, F), (4, F), (8, F), (12, F)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh16(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, F), (4, F), (8, F), (12, F)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh8(vol=A),
            CH_HH_OPEN: [(6, N), (14, N)],
        }),
    ],
    category="Eletrônico"
)))

# Hip Hop (Boom Bap)
ALL_RHYTHMS.append(("Hip Hop", 90, 4, "Eletrônico", lambda: make_rhythm(
    "Hip Hop", 90, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, A), (10, N), (14, N)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh8(),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, A), (10, N)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh16(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (3, G), (8, A), (10, N), (14, N)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh8(),
            CH_HH_OPEN: [(14, S)],
        }),
    ],
    category="Eletrônico"
)))

# Trap
ALL_RHYTHMS.append(("Trap", 140, 4, "Eletrônico", lambda: make_rhythm(
    "Trap", 140, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, F), (3, A), (8, F)],
            CH_CAIXA: [(4, F), (12, F)],
            CH_HH_CLOSED: hh16(vol=N),
            CH_HH_OPEN: [(7, S), (15, S)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, F), (3, A), (8, F), (11, N)],
            CH_CAIXA: [(4, F), (12, F)],
            CH_HH_CLOSED: [(i, N if i%2==0 else G) for i in range(16)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, F), (3, A), (8, F)],
            CH_CAIXA: [(4, F), (12, F)],
            CH_HH_CLOSED: [(i, S) for i in range(16)],
            CH_HH_OPEN: [(3, S), (7, S), (11, S), (15, S)],
        }),
    ],
    category="Eletrônico"
)))

# Lo-Fi
ALL_RHYTHMS.append(("Lo-Fi", 80, 4, "Eletrônico", lambda: make_rhythm(
    "Lo-Fi", 80, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, N), (8, A)],
            CH_CAIXA: [(4, N), (12, N)],
            CH_HH_CLOSED: hh8(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, N)],
            CH_CAIXA: [(4, N), (12, N)],
            CH_HH_CLOSED: hh8(vol=S),
            CH_HH_OPEN: [(14, G)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, N), (8, A)],
            CH_CAIXA: [(4, N), (12, N), (14, G)],
            CH_PRATO: ride8(vol=G),
        }),
    ],
    category="Eletrônico"
)))

# Drum & Bass
ALL_RHYTHMS.append(("Drum and Bass", 174, 4, "Eletrônico", lambda: make_rhythm(
    "Drum and Bass", 174, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, F), (2, A), (10, A), (11, N)],
            CH_CAIXA: [(4, F), (7, N), (9, N), (12, F), (15, N)],
            CH_HH_CLOSED: hh8(vol=N),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, F), (2, A), (10, A)],
            CH_CAIXA: [(4, F), (7, N), (12, F)],
            CH_HH_CLOSED: hh8(vol=N),
            CH_HH_OPEN: [(14, N)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, F), (2, A), (6, N), (10, A), (11, N)],
            CH_CAIXA: [(4, F), (9, N), (12, F), (15, N)],
            CH_HH_CLOSED: hh16(vol=S),
        }),
    ],
    category="Eletrônico"
)))

# EDM
ALL_RHYTHMS.append(("EDM", 128, 4, "Eletrônico", lambda: make_rhythm(
    "EDM", 128, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, F), (4, F), (8, F), (12, F)],
            CH_CAIXA: [(4, F), (12, F)],
            CH_HH_CLOSED: hh16(vol=N),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, F), (4, F), (8, F), (12, F)],
            CH_CAIXA: [(4, F), (12, F)],
            CH_HH_CLOSED: hh8(vol=A),
            CH_HH_OPEN: [(2, N), (6, N), (10, N), (14, N)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, F), (4, F), (8, F), (12, F)],
            CH_CAIXA: [(8, F)],
            CH_HH_CLOSED: hh16(vol=N),
        }),
    ],
    category="Eletrônico"
)))

# Techno
ALL_RHYTHMS.append(("Techno", 135, 4, "Eletrônico", lambda: make_rhythm(
    "Techno", 135, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, F), (4, F), (8, F), (12, F)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: [(2, N), (6, N), (10, N), (14, N)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, F), (4, F), (8, F), (12, F)],
            CH_HH_CLOSED: hh16(vol=S),
            CH_HH_OPEN: [(4, N), (12, N)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, F), (4, F), (8, F), (12, F)],
            CH_CAIXA: [(4, N), (12, N)],
            CH_PRATO: [(2, S), (6, S), (10, S), (14, S)],
        }),
    ],
    category="Eletrônico"
)))

# ─── BRASILEIRO ───────────────────────────────────────────────────────

# Samba
ALL_RHYTHMS.append(("Samba", 100, 4, "Brasileiro", lambda: make_rhythm(
    "Samba", 100, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (15, N)],
            CH_CAIXA: [(0, N), (3, G), (4, N), (6, G), (8, N), (11, G), (12, N), (15, G)],
            CH_HH_CLOSED: hh16(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (7, G), (15, N)],
            CH_CAIXA: [(0, N), (3, G), (4, N), (6, G), (8, N), (11, G), (12, N), (15, G)],
            CH_HH_CLOSED: hh16(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (15, N)],
            CH_CAIXA: [(0, N), (3, G), (4, N), (6, G), (8, N), (11, G), (12, N)],
            CH_HH_CLOSED: hh16(vol=S),
            CH_HH_OPEN: [(15, N)],
        }),
    ],
    category="Brasileiro"
)))

# Bossa Nova
ALL_RHYTHMS.append(("Bossa Nova", 130, 4, "Brasileiro", lambda: make_rhythm(
    "Bossa Nova", 130, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (4, N), (5, N), (9, N)],
            CH_CAIXA: [(0, N), (3, G), (6, G), (10, N), (12, G)],
            CH_HH_CLOSED: hh8(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (4, N), (5, N), (9, N)],
            CH_CAIXA: [(0, N), (3, G), (6, G), (10, N), (12, G)],
            CH_PRATO: ride8(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (5, N), (9, N), (13, G)],
            CH_CAIXA: [(0, N), (3, G), (6, G), (10, N), (12, G)],
            CH_HH_CLOSED: hh8(vol=S),
        }),
    ],
    category="Brasileiro"
)))

# Samba Rock
ALL_RHYTHMS.append(("Samba Rock", 110, 4, "Brasileiro", lambda: make_rhythm(
    "Samba Rock", 110, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, N), (8, A), (14, N)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh16(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, N), (8, A), (14, N)],
            CH_CAIXA: [(4, A), (12, A), (15, G)],
            CH_HH_CLOSED: hh16(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, N), (8, A)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh8(vol=N),
            CH_HH_OPEN: [(14, S)],
        }),
    ],
    category="Brasileiro"
)))

# Pagode
ALL_RHYTHMS.append(("Pagode", 90, 4, "Brasileiro", lambda: make_rhythm(
    "Pagode", 90, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (3, G), (8, A), (14, N)],
            CH_CAIXA: [(4, N), (6, G), (10, G), (12, N)],
            CH_HH_CLOSED: hh16(vol=G),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (3, G), (8, A), (14, N)],
            CH_CAIXA: [(4, N), (10, G), (12, N), (15, G)],
            CH_HH_CLOSED: hh16(vol=G),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, A), (14, N)],
            CH_CAIXA: [(4, N), (6, G), (12, N)],
            CH_HH_CLOSED: hh16(vol=G),
            CH_HH_OPEN: [(6, G)],
        }),
    ],
    category="Brasileiro"
)))

# Forró / Baião
ALL_RHYTHMS.append(("Baião", 110, 4, "Brasileiro", lambda: make_rhythm(
    "Baião", 110, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (3, N), (8, A), (11, N)],
            CH_CAIXA: [(2, N), (6, N), (10, N), (14, N)],
            CH_HH_CLOSED: hh8(vol=N),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (3, N), (8, A), (11, N)],
            CH_CAIXA: [(2, N), (6, N), (10, N), (14, N)],
            CH_HH_CLOSED: hh16(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (3, N), (8, A), (11, N)],
            CH_CAIXA: [(2, A), (6, N), (10, A), (14, N)],
            CH_SURDO: [(0, S), (8, S)],
            CH_HH_CLOSED: hh8(vol=N),
        }),
    ],
    category="Brasileiro"
)))

# Forró
ALL_RHYTHMS.append(("Forró", 120, 4, "Brasileiro", lambda: make_rhythm(
    "Forró", 120, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (3, N), (8, A), (11, N)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh16(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (3, N), (8, A), (11, N)],
            CH_CAIXA: [(4, A), (6, G), (12, A), (14, G)],
            CH_HH_CLOSED: hh16(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (3, N), (6, G), (8, A), (11, N)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh8(vol=N),
        }),
    ],
    category="Brasileiro"
)))

# Maracatu
ALL_RHYTHMS.append(("Maracatu", 100, 4, "Brasileiro", lambda: make_rhythm(
    "Maracatu", 100, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, F), (4, F), (8, F), (12, F)],
            CH_CAIXA: [(2, N), (6, N), (10, N), (14, N)],
            CH_SURDO: [(0, A), (3, G), (6, G), (8, A), (11, G), (14, G)],
            CH_HH_CLOSED: hh16(vol=G),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, F), (4, F), (8, F), (12, F)],
            CH_CAIXA: [(2, A), (6, N), (10, A), (14, N)],
            CH_SURDO: [(0, A), (8, A)],
            CH_HH_CLOSED: hh16(vol=G),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, F), (4, F), (8, F), (12, F)],
            CH_CAIXA: hh16(vol=G),
            CH_SURDO: [(0, A), (3, G), (6, G), (8, A), (11, G), (14, G)],
        }),
    ],
    category="Brasileiro"
)))

# Frevo
ALL_RHYTHMS.append(("Frevo", 160, 4, "Brasileiro", lambda: make_rhythm(
    "Frevo", 160, 4, 16, 8, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(4, A), (12, A)],
            CH_CAIXA: [(0, A), (1, N), (2, A), (4, N), (5, A), (6, N), (8, A), (9, N), (10, A), (12, N), (13, A), (14, N)],
            CH_HH_CLOSED: hh8(vol=N),
        }),
        make_variation(16, {
            CH_BUMBO: [(4, A), (12, A)],
            CH_CAIXA: [(i, A if i%4==0 else N) for i in range(16)],
        }),
        make_variation(16, {
            CH_BUMBO: [(4, A), (8, N), (12, A)],
            CH_CAIXA: [(0, A), (1, N), (2, A), (4, N), (5, A), (6, N), (8, A), (9, N), (10, A), (12, N), (13, A), (14, N)],
            CH_HH_CLOSED: hh8(vol=S),
        }),
    ],
    category="Brasileiro"
)))

# Axé
ALL_RHYTHMS.append(("Axé", 130, 4, "Brasileiro", lambda: make_rhythm(
    "Axé", 130, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, N), (8, A), (14, N)],
            CH_CAIXA: [(2, N), (4, A), (10, N), (12, A)],
            CH_HH_CLOSED: hh8(vol=N),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, N), (8, A), (14, N)],
            CH_CAIXA: [(2, N), (4, A), (10, N), (12, A)],
            CH_HH_CLOSED: hh16(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, N), (8, A), (14, N)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_SURDO: [(0, A), (8, A)],
            CH_HH_CLOSED: hh8(vol=N),
        }),
    ],
    category="Brasileiro"
)))

# Sertanejo
ALL_RHYTHMS.append(("Sertanejo", 130, 4, "Brasileiro", lambda: make_rhythm(
    "Sertanejo", 130, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (4, N), (8, A), (12, N)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh8(),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (4, N), (8, A), (12, N)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh16(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (4, N), (8, A), (12, N)],
            CH_CAIXA: [(4, A), (12, A), (14, G)],
            CH_HH_CLOSED: hh8(),
            CH_HH_OPEN: [(14, S)],
        }),
    ],
    category="Brasileiro"
)))

# Funk Carioca
ALL_RHYTHMS.append(("Funk Carioca", 130, 4, "Brasileiro", lambda: make_rhythm(
    "Funk Carioca", 130, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, F), (3, A), (6, A), (8, F), (10, A), (12, A)],
            CH_CAIXA: [(4, A), (9, N), (14, A)],
            CH_HH_CLOSED: [],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, F), (3, A), (6, A), (8, F), (10, A), (12, A)],
            CH_CAIXA: [(4, A), (14, A)],
            CH_HH_CLOSED: hh8(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, F), (3, A), (6, A), (8, F), (10, A)],
            CH_CAIXA: [(4, A), (9, N), (12, A), (14, A)],
            CH_HH_CLOSED: hh16(vol=G),
        }),
    ],
    category="Brasileiro"
)))

# Piseiro
ALL_RHYTHMS.append(("Piseiro", 140, 4, "Brasileiro", lambda: make_rhythm(
    "Piseiro", 140, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (3, N), (8, A), (11, N)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh16(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (4, A), (8, A), (12, A)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh16(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (3, N), (8, A), (11, N)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh8(vol=N),
            CH_HH_OPEN: [(14, S)],
        }),
    ],
    category="Brasileiro"
)))

# Arrocha
ALL_RHYTHMS.append(("Arrocha", 90, 4, "Brasileiro", lambda: make_rhythm(
    "Arrocha", 90, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, N), (8, A)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh8(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, N), (8, A), (14, G)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh16(vol=G),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, N), (8, A)],
            CH_CAIXA: [(4, A), (12, A), (14, G)],
            CH_HH_CLOSED: hh8(vol=S),
        }),
    ],
    category="Brasileiro"
)))

# Ijexá
ALL_RHYTHMS.append(("Ijexá", 90, 4, "Brasileiro", lambda: make_rhythm(
    "Ijexá", 90, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, A)],
            CH_CAIXA: [(4, N), (12, N)],
            CH_SURDO: [(0, N), (1, G), (4, G), (5, G), (7, G), (8, N), (9, G), (12, G), (13, G), (15, G)],
            CH_HH_CLOSED: hh8(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, A)],
            CH_CAIXA: [(4, N), (12, N)],
            CH_SURDO: [(0, N), (1, G), (4, G), (5, G), (7, G), (8, N), (9, G), (12, G), (13, G), (15, G)],
            CH_HH_CLOSED: hh16(vol=G),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, A)],
            CH_CAIXA: [(4, N), (12, N)],
            CH_SURDO: [(0, N), (1, G), (5, G), (7, G), (8, N), (9, G), (13, G), (15, G)],
            CH_PRATO: [(0, S), (8, S)],
        }),
    ],
    category="Brasileiro"
)))

# ─── LATINO ──────────────────────────────────────────────────────────

# Salsa
ALL_RHYTHMS.append(("Salsa", 180, 4, "Latino", lambda: make_rhythm(
    "Salsa", 180, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(3, N), (7, N), (11, N), (15, N)],
            CH_CAIXA: [(0, N), (1, G), (3, G), (4, N), (6, G), (7, G), (9, G), (10, N), (12, G), (14, N)],
            CH_HH_CLOSED: [(0, A), (4, A), (8, A), (12, A)],
        }),
        make_variation(16, {
            CH_BUMBO: [(3, N), (7, N), (11, N), (15, N)],
            CH_CAIXA: [(0, N), (3, G), (4, N), (7, G), (10, N), (14, N)],
            CH_PRATO: [(0, N), (2, S), (4, N), (6, S), (8, N), (10, S), (12, N), (14, S)],
        }),
        make_variation(16, {
            CH_BUMBO: [(3, N), (7, N), (11, N), (15, N)],
            CH_CAIXA: [(4, N), (10, N)],
            CH_HH_CLOSED: hh8(vol=N),
        }),
    ],
    category="Latino"
)))

# Cumbia
ALL_RHYTHMS.append(("Cumbia", 100, 4, "Latino", lambda: make_rhythm(
    "Cumbia", 100, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: hh8(vol=N),
            CH_CAIXA: [(4, N), (12, N)],
            CH_HH_CLOSED: hh16(vol=G),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (2, N), (4, N), (6, N), (8, A), (10, N), (12, N), (14, N)],
            CH_CAIXA: [(4, N), (12, N)],
            CH_HH_CLOSED: hh8(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: hh8(vol=N),
            CH_CAIXA: [(4, N), (12, N)],
            CH_SURDO: [(0, S), (8, S)],
            CH_HH_CLOSED: hh16(vol=G),
        }),
    ],
    category="Latino"
)))

# Merengue
ALL_RHYTHMS.append(("Merengue", 160, 4, "Latino", lambda: make_rhythm(
    "Merengue", 160, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (4, A), (8, A), (12, A)],
            CH_CAIXA: [(2, N), (4, N), (6, N), (10, N), (12, N), (14, N)],
            CH_HH_CLOSED: hh8(vol=N),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (5, N), (8, A), (12, A)],
            CH_CAIXA: [(2, N), (4, N), (6, N), (10, N), (12, N), (14, N)],
            CH_HH_CLOSED: hh8(vol=N),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (4, A), (8, A), (12, A)],
            CH_CAIXA: [(2, N), (6, N), (10, N), (14, N)],
            CH_TOM2: [(4, N), (12, N)],
            CH_HH_CLOSED: hh8(vol=N),
        }),
    ],
    category="Latino"
)))

# Bachata
ALL_RHYTHMS.append(("Bachata", 130, 4, "Latino", lambda: make_rhythm(
    "Bachata", 130, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (12, N)],
            CH_CAIXA: [(0, N), (2, S), (4, N), (6, S), (8, N), (10, S)],
            CH_HH_CLOSED: hh8(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (12, N)],
            CH_CAIXA: [(0, N), (2, S), (4, N), (6, S), (8, N), (10, S)],
            CH_HH_CLOSED: hh16(vol=G),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, N), (12, N)],
            CH_CAIXA: [(0, N), (2, S), (4, N), (6, S), (10, S)],
            CH_HH_CLOSED: hh8(vol=S),
        }),
    ],
    category="Latino"
)))

# Cha Cha Cha
ALL_RHYTHMS.append(("Cha Cha Cha", 120, 4, "Latino", lambda: make_rhythm(
    "Cha Cha Cha", 120, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, A)],
            CH_CAIXA: [(4, N), (8, N), (10, N), (12, N)],
            CH_HH_CLOSED: [(0, A), (4, A), (8, A), (12, A)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, A)],
            CH_CAIXA: [(4, N), (8, N), (10, N), (12, N)],
            CH_HH_CLOSED: hh8(vol=N),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, A)],
            CH_CAIXA: [(4, N), (10, N), (12, N)],
            CH_TOM1: [(8, N)],
            CH_HH_CLOSED: [(0, A), (4, A), (8, A), (12, A)],
        }),
    ],
    category="Latino"
)))

# Bolero
ALL_RHYTHMS.append(("Bolero", 85, 4, "Latino", lambda: make_rhythm(
    "Bolero", 85, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, N)],
            CH_CAIXA: [(4, N), (5, G), (6, G), (12, N)],
            CH_HH_CLOSED: hh8(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, N)],
            CH_CAIXA: [(4, N), (5, G), (6, G), (12, N)],
            CH_PRATO: ride8(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, N), (14, G)],
            CH_CAIXA: [(4, N), (5, G), (6, G), (12, N)],
            CH_HH_CLOSED: hh8(vol=S),
        }),
    ],
    category="Latino"
)))

# Tango
ALL_RHYTHMS.append(("Tango", 130, 4, "Latino", lambda: make_rhythm(
    "Tango", 130, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (3, N), (6, N), (8, A), (11, N), (14, N)],
            CH_CAIXA: [(4, N), (12, N)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (3, N), (6, N), (8, A), (11, N), (14, N)],
            CH_CAIXA: [(4, N), (12, N)],
            CH_HH_CLOSED: [(0, S), (4, S), (8, S), (12, S)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (3, N), (6, N), (8, A), (11, N), (14, N)],
            CH_CAIXA: [(4, N), (8, G), (12, N)],
            CH_HH_CLOSED: [(0, S), (4, S), (8, S), (12, S)],
        }),
    ],
    category="Latino"
)))

# ─── AFRICANO / WORLD ────────────────────────────────────────────────

# Afrobeat
ALL_RHYTHMS.append(("Afrobeat", 110, 4, "World", lambda: make_rhythm(
    "Afrobeat", 110, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (1, N), (8, A), (9, N)],
            CH_CAIXA: [(4, N), (11, N)],
            CH_HH_CLOSED: hh8(vol=N),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (1, N), (8, A), (9, N)],
            CH_CAIXA: [(4, N), (11, N)],
            CH_HH_CLOSED: hh16(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (1, N), (8, A), (9, N)],
            CH_CAIXA: [(4, N), (11, N), (14, G)],
            CH_PRATO: ride8(vol=S),
        }),
    ],
    category="World"
)))

# Soca
ALL_RHYTHMS.append(("Soca", 150, 4, "World", lambda: make_rhythm(
    "Soca", 150, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (4, A), (8, A), (12, A)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh16(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (4, A), (8, A), (12, A)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh8(vol=N),
            CH_HH_OPEN: [(2, S), (10, S)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (4, A), (8, A), (12, A)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_PRATO: ride8(vol=N),
        }),
    ],
    category="World"
)))

# Calypso
ALL_RHYTHMS.append(("Calypso", 120, 4, "World", lambda: make_rhythm(
    "Calypso", 120, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, A)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh8(vol=N),
            CH_TOM2: [(2, S), (6, S), (10, S), (14, S)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, A), (14, N)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh8(vol=N),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, A)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh16(vol=S),
        }),
    ],
    category="World"
)))

# ─── GOSPEL / WORSHIP ────────────────────────────────────────────────

# Worship Básico
ALL_RHYTHMS.append(("Worship Básico", 72, 4, "Gospel", lambda: make_rhythm(
    "Worship Básico", 72, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, N)],
            CH_CAIXA: [(4, N), (12, N)],
            CH_HH_CLOSED: hh8(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, G), (8, N)],
            CH_CAIXA: [(4, N), (12, N)],
            CH_HH_CLOSED: hh8(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, N)],
            CH_CAIXA: [(4, N), (12, N)],
            CH_PRATO: ride8(vol=S),
        }),
    ],
    category="Gospel"
)))

# Worship Upbeat
ALL_RHYTHMS.append(("Worship Upbeat", 120, 4, "Gospel", lambda: make_rhythm(
    "Worship Upbeat", 120, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, A), (10, N)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh8(vol=N),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, S), (8, A), (10, N)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh16(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (8, A), (10, N)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_PRATO: ride8(vol=N),
        }),
    ],
    category="Gospel"
)))

# Worship 6/8
ALL_RHYTHMS.append(("Worship 6-8", 70, 6, "Gospel", lambda: make_rhythm(
    "Worship 6-8", 70, 6, 24, 12, 12, 12,
    [
        make_variation(24, {
            CH_BUMBO: [(0, A), (12, N)],
            CH_CAIXA: [(8, N), (20, N)],
            CH_HH_CLOSED: [(i, N if i%4==0 else S) for i in range(0, 24, 2)],
        }),
        make_variation(24, {
            CH_BUMBO: [(0, A), (10, G), (12, N)],
            CH_CAIXA: [(8, N), (20, N)],
            CH_HH_CLOSED: [(i, N if i%4==0 else S) for i in range(0, 24, 2)],
        }),
        make_variation(24, {
            CH_BUMBO: [(0, A), (12, N)],
            CH_CAIXA: [(8, N), (20, N)],
            CH_PRATO: [(i, S) for i in range(0, 24, 4)],
        }),
    ],
    category="Gospel"
)))

# Gospel Shuffle
ALL_RHYTHMS.append(("Gospel Shuffle", 95, 4, "Gospel", lambda: make_rhythm(
    "Gospel Shuffle", 95, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (4, N), (8, A), (12, N)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: [(0, A), (2, G), (4, A), (6, G), (8, A), (10, G), (12, A), (14, G)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (4, N), (8, A), (12, N)],
            CH_CAIXA: [(4, A), (6, G), (12, A), (14, G)],
            CH_HH_CLOSED: [(0, A), (2, G), (4, A), (6, G), (8, A), (10, G), (12, A), (14, G)],
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (4, N), (8, A), (12, N)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_PRATO: [(0, N), (2, G), (4, N), (6, G), (8, N), (10, G), (12, N), (14, G)],
        }),
    ],
    category="Gospel"
)))

# Gospel Groove
ALL_RHYTHMS.append(("Gospel Groove", 100, 4, "Gospel", lambda: make_rhythm(
    "Gospel Groove", 100, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, N), (8, A), (10, N)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_HH_CLOSED: hh16(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, N), (8, A), (10, N)],
            CH_CAIXA: [(4, A), (7, G), (12, A), (14, G)],
            CH_HH_CLOSED: hh16(vol=S),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, A), (6, N), (8, A), (10, N)],
            CH_CAIXA: [(4, A), (12, A)],
            CH_PRATO: ride8(vol=N),
        }),
    ],
    category="Gospel"
)))

# Gospel Rock
ALL_RHYTHMS.append(("Gospel Rock", 130, 4, "Gospel", lambda: make_rhythm(
    "Gospel Rock", 130, 4, 16, 16, 16, 8,
    [
        make_variation(16, {
            CH_BUMBO: [(0, F), (8, F), (10, A)],
            CH_CAIXA: [(4, F), (12, F)],
            CH_HH_CLOSED: hh8(vol=A),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, F), (6, N), (8, F), (10, A)],
            CH_CAIXA: [(4, F), (12, F)],
            CH_HH_CLOSED: hh8(vol=A),
        }),
        make_variation(16, {
            CH_BUMBO: [(0, F), (8, F), (10, A)],
            CH_CAIXA: [(4, F), (12, F)],
            CH_PRATO: [(0, A), (4, A), (8, A), (12, A)],
        }),
    ],
    category="Gospel"
)))

# Adoração Lenta
ALL_RHYTHMS.append(("Adoração Lenta", 60, 6, "Gospel", lambda: make_rhythm(
    "Adoração Lenta", 60, 6, 24, 12, 12, 12,
    [
        make_variation(24, {
            CH_BUMBO: [(0, N), (12, G)],
            CH_CAIXA: [(8, S)],
            CH_HH_CLOSED: [(i, S if i%4==0 else G) for i in range(0, 24, 4)],
        }),
        make_variation(24, {
            CH_BUMBO: [(0, N)],
            CH_CAIXA: [(8, S), (20, G)],
            CH_PRATO: [(0, G), (8, G), (16, G)],
        }),
        make_variation(24, {
            CH_BUMBO: [(0, N), (12, G)],
            CH_CAIXA: [(8, S)],
            CH_PRATO: [(i, G) for i in range(0, 24, 4)],
        }),
    ],
    category="Gospel"
)))

# ═════════════════════════════════════════════════════════════════════
# GENERATE ALL FILES
# ═════════════════════════════════════════════════════════════════════

def main():
    out_dir = os.path.join(os.path.dirname(__file__), '..', 'public', 'rhythm')
    os.makedirs(out_dir, exist_ok=True)

    # Load existing files to not overwrite
    existing = set(os.listdir(out_dir))

    generated = []
    skipped = []

    for name, tempo, beats, category, builder in ALL_RHYTHMS:
        filename = f"{name}.json"
        filepath = os.path.join(out_dir, filename)

        if filename in existing:
            skipped.append(filename)
            continue

        rhythm = builder()
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(rhythm, f, ensure_ascii=False, indent=2)
        generated.append(filename)
        print(f"  ✓ {filename} ({tempo} BPM, {beats}/x, {category})")

    # Update manifest
    all_files = sorted([f for f in os.listdir(out_dir) if f.endswith('.json') and f != 'manifest.json'])

    # Build categories
    categories = {}
    for f in all_files:
        with open(os.path.join(out_dir, f), 'r') as fh:
            data = json.load(fh)
            cat = data.get('category', 'Outros')
            categories.setdefault(cat, []).append(f)

    manifest = {
        "version": 5,
        "rhythms": all_files,
        "categories": categories
    }

    with open(os.path.join(out_dir, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(f"\n{'='*50}")
    print(f"Gerados: {len(generated)} ritmos novos")
    print(f"Mantidos: {len(skipped)} ritmos existentes")
    print(f"Total no manifest: {len(all_files)} ritmos")
    print(f"Categorias: {list(categories.keys())}")

if __name__ == '__main__':
    main()
