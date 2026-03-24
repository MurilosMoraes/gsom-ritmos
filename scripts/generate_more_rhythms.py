#!/usr/bin/env python3
"""Batch 2: mais ritmos para chegar perto de 200."""
import json, os, sys

# Import the helpers from the main script
sys.path.insert(0, os.path.dirname(__file__))
from generate_rhythms import (
    make_rhythm, make_variation, make_fill_descending, make_fill_snare_roll, make_fill_toms,
    hh8, hh16, ride8,
    CH_BUMBO, CH_CAIXA, CH_TOM1, CH_TOM2, CH_HH_CLOSED, CH_HH_OPEN, CH_PRATO, CH_SURDO,
    G, S, N, A, F, AUDIO_FILES_8CH
)

ALL_RHYTHMS = []

# ─── POP/ROCK extras ─────────────────────────────────────────────────

ALL_RHYTHMS.append(("Pop Ballad", 75, 4, "Pop/Rock", lambda: make_rhythm(
    "Pop Ballad", 75, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(8,N)], CH_CAIXA:[(4,N),(12,N)], CH_HH_CLOSED:hh8(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(6,G),(8,N)], CH_CAIXA:[(4,N),(12,N)], CH_HH_CLOSED:hh8(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(8,N)], CH_CAIXA:[(4,N),(12,N)], CH_PRATO:ride8(vol=S)})],
    category="Pop/Rock")))

ALL_RHYTHMS.append(("Pop Dance", 128, 4, "Pop/Rock", lambda: make_rhythm(
    "Pop Dance", 128, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,F),(4,F),(8,F),(12,F)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh16(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,F),(4,F),(8,F),(12,F)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh8(vol=N), CH_HH_OPEN:[(2,S),(10,S)]}),
     make_variation(16, {CH_BUMBO:[(0,F),(4,F),(8,F),(12,F)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh16(vol=N)})],
    category="Pop/Rock")))

ALL_RHYTHMS.append(("Rock Ballad", 68, 4, "Pop/Rock", lambda: make_rhythm(
    "Rock Ballad", 68, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(8,N)], CH_CAIXA:[(4,N),(12,N)], CH_HH_CLOSED:hh8(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(6,G),(8,N),(14,G)], CH_CAIXA:[(4,N),(12,N)], CH_HH_CLOSED:hh8(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(8,N)], CH_CAIXA:[(4,N),(12,N)], CH_PRATO:ride8(vol=S)})],
    category="Pop/Rock")))

ALL_RHYTHMS.append(("Alternative Rock", 125, 4, "Pop/Rock", lambda: make_rhythm(
    "Alternative Rock", 125, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(6,N),(8,A)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh8()}),
     make_variation(16, {CH_BUMBO:[(0,A),(6,N),(8,A),(14,G)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh8()}),
     make_variation(16, {CH_BUMBO:[(0,A),(6,N),(8,A)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh8(), CH_HH_OPEN:[(14,N)]})],
    category="Pop/Rock")))

ALL_RHYTHMS.append(("Garage Rock", 145, 4, "Pop/Rock", lambda: make_rhythm(
    "Garage Rock", 145, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,F),(4,N),(8,F),(12,N)], CH_CAIXA:[(4,F),(12,F)], CH_HH_CLOSED:hh8(vol=A)}),
     make_variation(16, {CH_BUMBO:[(0,F),(8,F),(10,A)], CH_CAIXA:[(4,F),(12,F)], CH_HH_CLOSED:hh8(vol=A)}),
     make_variation(16, {CH_BUMBO:[(0,F),(4,N),(8,F)], CH_CAIXA:[(4,F),(12,F)], CH_PRATO:ride8(vol=A)})],
    category="Pop/Rock")))

ALL_RHYTHMS.append(("Post Punk", 135, 4, "Pop/Rock", lambda: make_rhythm(
    "Post Punk", 135, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(4,N),(8,A),(12,N)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh16(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(8,A)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh16(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(4,N),(8,A),(12,N)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh8(), CH_HH_OPEN:[(2,S),(10,S)]})],
    category="Pop/Rock")))

ALL_RHYTHMS.append(("Rockabilly", 175, 4, "Pop/Rock", lambda: make_rhythm(
    "Rockabilly", 175, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(8,A)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:[(0,A),(2,G),(4,A),(6,G),(8,A),(10,G),(12,A),(14,G)]}),
     make_variation(16, {CH_BUMBO:[(0,A),(4,N),(8,A),(12,N)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:[(0,A),(2,G),(4,A),(6,G),(8,A),(10,G),(12,A),(14,G)]}),
     make_variation(16, {CH_BUMBO:[(0,A),(8,A)], CH_CAIXA:[(4,A),(12,A)], CH_PRATO:[(0,A),(2,S),(4,A),(6,S),(8,A),(10,S),(12,A),(14,S)]})],
    category="Pop/Rock")))

ALL_RHYTHMS.append(("Stadium Rock", 138, 4, "Pop/Rock", lambda: make_rhythm(
    "Stadium Rock", 138, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,F),(8,F)], CH_CAIXA:[(4,F),(12,F)], CH_PRATO:[(0,A),(4,A),(8,A),(12,A)]}),
     make_variation(16, {CH_BUMBO:[(0,F),(6,A),(8,F)], CH_CAIXA:[(4,F),(12,F)], CH_PRATO:[(0,A),(4,A),(8,A),(12,A)]}),
     make_variation(16, {CH_BUMBO:[(0,F),(8,F),(10,A)], CH_CAIXA:[(4,F),(12,F)], CH_PRATO:ride8(vol=A)})],
    category="Pop/Rock")))

ALL_RHYTHMS.append(("Southern Rock", 115, 4, "Pop/Rock", lambda: make_rhythm(
    "Southern Rock", 115, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(4,N),(8,A),(10,N)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:[(0,A),(2,G),(4,A),(6,G),(8,A),(10,G),(12,A),(14,G)]}),
     make_variation(16, {CH_BUMBO:[(0,A),(4,N),(8,A)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:[(0,A),(2,G),(4,A),(6,G),(8,A),(10,G),(12,A),(14,G)]}),
     make_variation(16, {CH_BUMBO:[(0,A),(4,N),(8,A),(10,N)], CH_CAIXA:[(4,A),(12,A)], CH_PRATO:ride8(vol=N)})],
    category="Pop/Rock")))

ALL_RHYTHMS.append(("Prog Rock", 110, 4, "Pop/Rock", lambda: make_rhythm(
    "Prog Rock", 110, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(3,N),(6,N),(8,A),(11,N)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh8()}),
     make_variation(16, {CH_BUMBO:[(0,A),(3,N),(8,A),(11,N),(14,N)], CH_CAIXA:[(4,A),(12,A)], CH_PRATO:ride8()}),
     make_variation(16, {CH_BUMBO:[(0,A),(6,N),(8,A)], CH_CAIXA:[(4,A),(10,N),(12,A)], CH_HH_CLOSED:hh16(vol=S)})],
    category="Pop/Rock")))

ALL_RHYTHMS.append(("New Wave", 130, 4, "Pop/Rock", lambda: make_rhythm(
    "New Wave", 130, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(4,A),(8,A),(12,A)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh8(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(4,A),(8,A),(12,A)], CH_CAIXA:[(4,A),(12,A)], CH_TOM1:[(2,G),(10,G)], CH_HH_CLOSED:hh8(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(4,A),(8,A),(12,A)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh16(vol=G)})],
    category="Pop/Rock")))

ALL_RHYTHMS.append(("Britpop", 122, 4, "Pop/Rock", lambda: make_rhythm(
    "Britpop", 122, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(8,A),(10,N)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh8()}),
     make_variation(16, {CH_BUMBO:[(0,A),(6,G),(8,A),(10,N)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh8()}),
     make_variation(16, {CH_BUMBO:[(0,A),(8,A),(10,N)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh8(), CH_HH_OPEN:[(14,S)]})],
    category="Pop/Rock")))

# ─── FUNK/SOUL extras ─────────────────────────────────────────────────

ALL_RHYTHMS.append(("Funk Groove", 100, 4, "Funk/Soul/R&B", lambda: make_rhythm(
    "Funk Groove", 100, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(6,N),(10,A)], CH_CAIXA:[(4,F),(12,F)], CH_HH_CLOSED:hh16(vol=S), CH_HH_OPEN:[(7,S)]}),
     make_variation(16, {CH_BUMBO:[(0,A),(3,G),(6,N),(10,A)], CH_CAIXA:[(4,F),(8,G),(12,F),(15,G)], CH_HH_CLOSED:hh16(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(6,N),(10,A),(14,G)], CH_CAIXA:[(4,F),(12,F)], CH_HH_CLOSED:hh16(vol=S)})],
    category="Funk/Soul/R&B")))

ALL_RHYTHMS.append(("Funk Rock", 115, 4, "Funk/Soul/R&B", lambda: make_rhythm(
    "Funk Rock", 115, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,F),(2,N),(6,N),(8,F),(10,N)], CH_CAIXA:[(4,F),(12,F)], CH_HH_CLOSED:hh8(vol=A)}),
     make_variation(16, {CH_BUMBO:[(0,F),(2,N),(8,F),(10,N),(14,N)], CH_CAIXA:[(4,F),(12,F)], CH_HH_CLOSED:hh8(vol=A)}),
     make_variation(16, {CH_BUMBO:[(0,F),(2,N),(6,N),(8,F),(10,N)], CH_CAIXA:[(4,F),(12,F)], CH_PRATO:ride8(vol=A)})],
    category="Funk/Soul/R&B")))

ALL_RHYTHMS.append(("Slow Jam", 72, 4, "Funk/Soul/R&B", lambda: make_rhythm(
    "Slow Jam", 72, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(6,S),(8,N)], CH_CAIXA:[(4,N),(12,N)], CH_HH_CLOSED:hh16(vol=G)}),
     make_variation(16, {CH_BUMBO:[(0,A),(6,S)], CH_CAIXA:[(4,N),(12,N),(14,G)], CH_HH_CLOSED:hh16(vol=G)}),
     make_variation(16, {CH_BUMBO:[(0,A),(6,S),(8,N)], CH_CAIXA:[(4,N),(12,N)], CH_PRATO:ride8(vol=G)})],
    category="Funk/Soul/R&B")))

ALL_RHYTHMS.append(("Gospel Funk", 105, 4, "Gospel", lambda: make_rhythm(
    "Gospel Funk", 105, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(6,N),(10,N)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh16(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(6,N),(10,N)], CH_CAIXA:[(4,A),(7,G),(12,A),(15,G)], CH_HH_CLOSED:hh16(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(6,N),(10,N),(14,G)], CH_CAIXA:[(4,A),(12,A)], CH_PRATO:ride8(vol=N)})],
    category="Gospel")))

# ─── ELETRÔNICO extras ────────────────────────────────────────────────

ALL_RHYTHMS.append(("Deep House", 122, 4, "Eletrônico", lambda: make_rhythm(
    "Deep House", 122, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,F),(4,F),(8,F),(12,F)], CH_CAIXA:[(4,N),(12,N)], CH_HH_CLOSED:hh8(vol=S), CH_HH_OPEN:[(2,G),(6,G),(10,G),(14,G)]}),
     make_variation(16, {CH_BUMBO:[(0,F),(4,F),(8,F),(12,F)], CH_CAIXA:[(4,N),(12,N)], CH_HH_CLOSED:hh16(vol=G)}),
     make_variation(16, {CH_BUMBO:[(0,F),(4,F),(8,F),(12,F)], CH_CAIXA:[(4,N),(12,N)], CH_PRATO:ride8(vol=G)})],
    category="Eletrônico")))

ALL_RHYTHMS.append(("Future Bass", 150, 4, "Eletrônico", lambda: make_rhythm(
    "Future Bass", 150, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,F),(3,A),(8,F)], CH_CAIXA:[(4,F),(12,F)], CH_HH_CLOSED:hh16(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,F),(3,A),(8,F),(11,N)], CH_CAIXA:[(4,F),(12,F)], CH_HH_CLOSED:hh16(vol=S), CH_HH_OPEN:[(7,S),(15,S)]}),
     make_variation(16, {CH_BUMBO:[(0,F),(3,A),(8,F)], CH_CAIXA:[(4,F),(12,F)], CH_HH_CLOSED:[(i,N) for i in range(16)]})],
    category="Eletrônico")))

ALL_RHYTHMS.append(("Dubstep", 140, 4, "Eletrônico", lambda: make_rhythm(
    "Dubstep", 140, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,F),(10,F)], CH_CAIXA:[(8,F)], CH_HH_CLOSED:hh8(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,F),(3,A),(10,F)], CH_CAIXA:[(8,F)], CH_HH_CLOSED:hh16(vol=G)}),
     make_variation(16, {CH_BUMBO:[(0,F),(10,F),(14,A)], CH_CAIXA:[(8,F)], CH_HH_CLOSED:hh8(vol=S), CH_HH_OPEN:[(6,S),(14,S)]})],
    category="Eletrônico")))

ALL_RHYTHMS.append(("Synthwave", 118, 4, "Eletrônico", lambda: make_rhythm(
    "Synthwave", 118, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(4,A),(8,A),(12,A)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh8(vol=N)}),
     make_variation(16, {CH_BUMBO:[(0,A),(4,A),(8,A),(12,A)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh16(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(4,A),(8,A),(12,A)], CH_CAIXA:[(4,A),(12,A)], CH_TOM1:[(2,G),(10,G)], CH_HH_CLOSED:hh8(vol=N)})],
    category="Eletrônico")))

ALL_RHYTHMS.append(("Ambient", 90, 4, "Eletrônico", lambda: make_rhythm(
    "Ambient", 90, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,S)], CH_CAIXA:[(8,G)], CH_PRATO:[(0,G),(4,G),(8,G),(12,G)]}),
     make_variation(16, {CH_BUMBO:[(0,S),(12,G)], CH_PRATO:[(0,G),(8,G)]}),
     make_variation(16, {CH_BUMBO:[(0,S)], CH_CAIXA:[(8,G)], CH_HH_CLOSED:[(0,G),(4,G),(8,G),(12,G)]})],
    category="Eletrônico")))

ALL_RHYTHMS.append(("Trance", 140, 4, "Eletrônico", lambda: make_rhythm(
    "Trance", 140, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,F),(4,F),(8,F),(12,F)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:[(2,N),(6,N),(10,N),(14,N)]}),
     make_variation(16, {CH_BUMBO:[(0,F),(4,F),(8,F),(12,F)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh8(vol=N)}),
     make_variation(16, {CH_BUMBO:[(0,F),(4,F),(8,F),(12,F)], CH_CAIXA:[(4,A),(12,A)], CH_PRATO:[(2,S),(6,S),(10,S),(14,S)]})],
    category="Eletrônico")))

ALL_RHYTHMS.append(("Breakbeat", 135, 4, "Eletrônico", lambda: make_rhythm(
    "Breakbeat", 135, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,F),(2,N),(8,F),(10,N)], CH_CAIXA:[(4,F),(12,F)], CH_HH_CLOSED:hh8(vol=N)}),
     make_variation(16, {CH_BUMBO:[(0,F),(2,N),(6,N),(8,F)], CH_CAIXA:[(4,F),(12,F),(14,N)], CH_HH_CLOSED:hh8(vol=N)}),
     make_variation(16, {CH_BUMBO:[(0,F),(2,N),(8,F),(10,N)], CH_CAIXA:[(4,F),(7,G),(12,F),(15,G)], CH_HH_CLOSED:hh16(vol=S)})],
    category="Eletrônico")))

ALL_RHYTHMS.append(("UK Garage", 132, 4, "Eletrônico", lambda: make_rhythm(
    "UK Garage", 132, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(6,N),(10,N)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh16(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(6,N),(10,N),(14,G)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh16(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(6,N),(10,N)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh16(vol=S), CH_HH_OPEN:[(7,S),(15,S)]})],
    category="Eletrônico")))

# ─── BRASILEIRO extras ───────────────────────────────────────────────

ALL_RHYTHMS.append(("Sertanejo Universitário", 150, 4, "Brasileiro", lambda: make_rhythm(
    "Sertanejo Universitário", 150, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(4,N),(8,A),(12,N)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh16(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(4,N),(8,A),(12,N)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh8(vol=N), CH_HH_OPEN:[(14,S)]}),
     make_variation(16, {CH_BUMBO:[(0,A),(4,N),(8,A),(12,N)], CH_CAIXA:[(4,A),(12,A),(14,G)], CH_HH_CLOSED:hh16(vol=S)})],
    category="Brasileiro")))

ALL_RHYTHMS.append(("MPB", 95, 4, "Brasileiro", lambda: make_rhythm(
    "MPB", 95, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(6,N),(8,N)], CH_CAIXA:[(4,N),(12,N)], CH_HH_CLOSED:hh8(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(6,N)], CH_CAIXA:[(4,N),(12,N),(14,G)], CH_HH_CLOSED:hh8(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(6,N),(8,N)], CH_CAIXA:[(4,N),(12,N)], CH_PRATO:ride8(vol=S)})],
    category="Brasileiro")))

ALL_RHYTHMS.append(("Samba Reggae", 100, 4, "Brasileiro", lambda: make_rhythm(
    "Samba Reggae", 100, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(6,N),(8,A),(14,N)], CH_CAIXA:[(2,N),(4,A),(10,N),(12,A)], CH_HH_CLOSED:hh8(vol=N)}),
     make_variation(16, {CH_BUMBO:[(0,A),(6,N),(8,A),(14,N)], CH_CAIXA:[(2,N),(4,A),(10,N),(12,A)], CH_SURDO:[(0,A),(8,A)], CH_HH_CLOSED:hh8(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(6,N),(8,A),(14,N)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh16(vol=S)})],
    category="Brasileiro")))

ALL_RHYTHMS.append(("Côco", 120, 4, "Brasileiro", lambda: make_rhythm(
    "Côco", 120, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(4,N),(8,A),(12,N)], CH_CAIXA:[(2,N),(6,N),(10,N),(14,N)], CH_HH_CLOSED:hh16(vol=G)}),
     make_variation(16, {CH_BUMBO:[(0,A),(4,N),(8,A),(12,N)], CH_CAIXA:[(2,N),(6,N),(10,N),(14,N)], CH_SURDO:[(0,S),(8,S)], CH_HH_CLOSED:hh8(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(4,N),(8,A),(12,N)], CH_CAIXA:[(2,A),(6,N),(10,A),(14,N)], CH_HH_CLOSED:hh16(vol=G)})],
    category="Brasileiro")))

ALL_RHYTHMS.append(("Lambada", 140, 4, "Brasileiro", lambda: make_rhythm(
    "Lambada", 140, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(6,N),(8,A)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh8(vol=N)}),
     make_variation(16, {CH_BUMBO:[(0,A),(6,N),(8,A)], CH_CAIXA:[(4,A),(12,A)], CH_TOM1:[(12,N)], CH_HH_CLOSED:hh8(vol=N)}),
     make_variation(16, {CH_BUMBO:[(0,A),(6,N),(8,A),(14,G)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh16(vol=S)})],
    category="Brasileiro")))

ALL_RHYTHMS.append(("Ciranda", 100, 4, "Brasileiro", lambda: make_rhythm(
    "Ciranda", 100, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(8,A)], CH_CAIXA:[(4,N),(12,N)], CH_HH_CLOSED:hh8(vol=S), CH_SURDO:[(0,N),(4,G),(8,N),(12,G)]}),
     make_variation(16, {CH_BUMBO:[(0,A),(8,A)], CH_CAIXA:[(4,N),(12,N)], CH_HH_CLOSED:hh16(vol=G), CH_SURDO:[(0,N),(8,N)]}),
     make_variation(16, {CH_BUMBO:[(0,A),(8,A)], CH_CAIXA:[(4,N),(12,N)], CH_PRATO:ride8(vol=S)})],
    category="Brasileiro")))

ALL_RHYTHMS.append(("Maxixe", 110, 4, "Brasileiro", lambda: make_rhythm(
    "Maxixe", 110, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(3,N),(8,A),(11,N)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh16(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(3,N),(8,A),(11,N)], CH_CAIXA:[(4,A),(6,G),(12,A),(14,G)], CH_HH_CLOSED:hh16(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(3,N),(8,A),(11,N)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh8(vol=N)})],
    category="Brasileiro")))

ALL_RHYTHMS.append(("Carimbó", 120, 4, "Brasileiro", lambda: make_rhythm(
    "Carimbó", 120, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(4,N),(8,A),(12,N)], CH_CAIXA:[(2,N),(6,N),(10,N),(14,N)], CH_SURDO:[(0,A),(8,A)], CH_HH_CLOSED:hh8(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(4,N),(8,A),(12,N)], CH_CAIXA:[(2,N),(6,N),(10,N),(14,N)], CH_HH_CLOSED:hh16(vol=G)}),
     make_variation(16, {CH_BUMBO:[(0,A),(4,N),(8,A),(12,N)], CH_CAIXA:[(2,A),(6,N),(10,A),(14,N)], CH_SURDO:[(0,A),(8,A)], CH_HH_CLOSED:hh8(vol=S)})],
    category="Brasileiro")))

# ─── LATINO extras ───────────────────────────────────────────────────

ALL_RHYTHMS.append(("Son Cubano", 130, 4, "Latino", lambda: make_rhythm(
    "Son Cubano", 130, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(3,N),(7,N),(11,N),(15,N)], CH_CAIXA:[(0,N),(3,G),(6,G),(10,N),(12,G)], CH_HH_CLOSED:[(0,A),(4,A),(8,A),(12,A)]}),
     make_variation(16, {CH_BUMBO:[(3,N),(7,N),(11,N),(15,N)], CH_CAIXA:[(0,N),(6,G),(10,N)], CH_PRATO:ride8(vol=S)}),
     make_variation(16, {CH_BUMBO:[(3,N),(7,N),(11,N),(15,N)], CH_CAIXA:[(0,N),(10,N)], CH_HH_CLOSED:hh8(vol=N)})],
    category="Latino")))

ALL_RHYTHMS.append(("Mambo", 180, 4, "Latino", lambda: make_rhythm(
    "Mambo", 180, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(3,N),(7,N),(11,N),(15,N)], CH_CAIXA:[(0,N),(4,N),(8,N),(12,N)], CH_HH_CLOSED:[(0,A),(4,A),(8,A),(12,A)]}),
     make_variation(16, {CH_BUMBO:[(3,N),(7,N),(11,N),(15,N)], CH_CAIXA:[(4,N),(12,N)], CH_PRATO:ride8(vol=N)}),
     make_variation(16, {CH_BUMBO:[(3,N),(7,N),(11,N),(15,N)], CH_CAIXA:[(0,N),(4,N),(8,N),(12,N)], CH_HH_CLOSED:hh8(vol=N)})],
    category="Latino")))

ALL_RHYTHMS.append(("Rumba", 100, 4, "Latino", lambda: make_rhythm(
    "Rumba", 100, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(8,N)], CH_CAIXA:[(0,N),(3,G),(6,G),(10,N),(12,G)], CH_HH_CLOSED:hh8(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(8,N)], CH_CAIXA:[(0,N),(3,G),(6,G),(10,N)], CH_SURDO:[(4,S),(12,S)], CH_HH_CLOSED:hh8(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(8,N)], CH_CAIXA:[(0,N),(3,G),(6,G),(10,N),(12,G)], CH_PRATO:ride8(vol=S)})],
    category="Latino")))

ALL_RHYTHMS.append(("Cumbia Colombiana", 95, 4, "Latino", lambda: make_rhythm(
    "Cumbia Colombiana", 95, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(2,N),(4,N),(6,N),(8,A),(10,N),(12,N),(14,N)], CH_CAIXA:[(4,N),(12,N)], CH_HH_CLOSED:hh16(vol=G)}),
     make_variation(16, {CH_BUMBO:[(0,A),(2,N),(4,N),(6,N),(8,A),(10,N),(12,N),(14,N)], CH_CAIXA:[(4,N),(12,N)], CH_SURDO:[(0,S),(8,S)], CH_HH_CLOSED:hh8(vol=S)}),
     make_variation(16, {CH_BUMBO:hh8(vol=N), CH_CAIXA:[(4,N),(12,N)], CH_HH_CLOSED:hh16(vol=G)})],
    category="Latino")))

ALL_RHYTHMS.append(("Plena", 120, 4, "Latino", lambda: make_rhythm(
    "Plena", 120, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(4,N),(8,A),(12,N)], CH_CAIXA:[(2,N),(6,N),(10,N),(14,N)], CH_HH_CLOSED:hh8(vol=N)}),
     make_variation(16, {CH_BUMBO:[(0,A),(4,N),(8,A),(12,N)], CH_CAIXA:[(2,N),(6,N),(10,N),(14,N)], CH_HH_CLOSED:hh16(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(4,N),(8,A),(12,N)], CH_CAIXA:[(2,A),(6,N),(10,A),(14,N)], CH_HH_CLOSED:hh8(vol=N)})],
    category="Latino")))

ALL_RHYTHMS.append(("Bomba", 115, 4, "Latino", lambda: make_rhythm(
    "Bomba", 115, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(3,N),(8,A),(11,N)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh8(vol=N)}),
     make_variation(16, {CH_BUMBO:[(0,A),(3,N),(8,A),(11,N)], CH_CAIXA:[(4,A),(6,G),(12,A),(14,G)], CH_HH_CLOSED:hh8(vol=N)}),
     make_variation(16, {CH_BUMBO:[(0,A),(3,N),(8,A),(11,N)], CH_CAIXA:[(4,A),(12,A)], CH_SURDO:[(0,S),(8,S)], CH_HH_CLOSED:hh8(vol=N)})],
    category="Latino")))

# ─── GOSPEL extras ───────────────────────────────────────────────────

ALL_RHYTHMS.append(("Gospel Balada", 65, 4, "Gospel", lambda: make_rhythm(
    "Gospel Balada", 65, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(8,N)], CH_CAIXA:[(4,S),(12,S)], CH_HH_CLOSED:hh8(vol=G)}),
     make_variation(16, {CH_BUMBO:[(0,A),(6,G),(8,N)], CH_CAIXA:[(4,S),(12,S)], CH_PRATO:ride8(vol=G)}),
     make_variation(16, {CH_BUMBO:[(0,A),(8,N)], CH_CAIXA:[(4,S),(12,S)], CH_HH_CLOSED:hh8(vol=G), CH_HH_OPEN:[(14,G)]})],
    category="Gospel")))

ALL_RHYTHMS.append(("Gospel Fast", 145, 4, "Gospel", lambda: make_rhythm(
    "Gospel Fast", 145, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,F),(8,F),(10,A)], CH_CAIXA:[(4,F),(12,F)], CH_HH_CLOSED:hh16(vol=N)}),
     make_variation(16, {CH_BUMBO:[(0,F),(6,N),(8,F),(10,A)], CH_CAIXA:[(4,F),(12,F)], CH_HH_CLOSED:hh16(vol=N)}),
     make_variation(16, {CH_BUMBO:[(0,F),(8,F),(10,A)], CH_CAIXA:[(4,F),(12,F)], CH_PRATO:ride8(vol=A)})],
    category="Gospel")))

ALL_RHYTHMS.append(("Gospel Reggae", 80, 4, "Gospel", lambda: make_rhythm(
    "Gospel Reggae", 80, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(8,A)], CH_CAIXA:[(8,A)], CH_HH_CLOSED:[(2,N),(6,N),(10,N),(14,N)]}),
     make_variation(16, {CH_BUMBO:[(0,N),(8,A)], CH_CAIXA:[(8,A)], CH_HH_CLOSED:[(2,N),(6,N),(10,N),(14,N)]}),
     make_variation(16, {CH_BUMBO:[(8,A)], CH_CAIXA:[(8,A)], CH_HH_CLOSED:[(2,N),(6,N),(10,N),(14,N)], CH_PRATO:[(0,S)]})],
    category="Gospel")))

ALL_RHYTHMS.append(("Louvor Congregacional", 85, 4, "Gospel", lambda: make_rhythm(
    "Louvor Congregacional", 85, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(8,N)], CH_CAIXA:[(4,N),(12,N)], CH_HH_CLOSED:hh8(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(6,G),(8,N)], CH_CAIXA:[(4,N),(12,N)], CH_HH_CLOSED:hh8(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(8,N)], CH_CAIXA:[(4,N),(12,N)], CH_PRATO:ride8(vol=S)})],
    category="Gospel")))

ALL_RHYTHMS.append(("Gospel Country", 120, 4, "Gospel", lambda: make_rhythm(
    "Gospel Country", 120, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(8,A)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh8(vol=N)}),
     make_variation(16, {CH_BUMBO:[(0,A),(4,N),(8,A),(12,N)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh8(vol=N)}),
     make_variation(16, {CH_BUMBO:[(0,A),(8,A)], CH_CAIXA:[(4,A),(12,A)], CH_PRATO:ride8(vol=N)})],
    category="Gospel")))

ALL_RHYTHMS.append(("Hillsong Style", 130, 4, "Gospel", lambda: make_rhythm(
    "Hillsong Style", 130, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(8,A),(10,N)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh8(vol=N)}),
     make_variation(16, {CH_BUMBO:[(0,A),(6,S),(8,A),(10,N)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh16(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(8,A),(10,N)], CH_CAIXA:[(4,A),(12,A)], CH_PRATO:ride8(vol=A)})],
    category="Gospel")))

ALL_RHYTHMS.append(("Bethel Style", 72, 4, "Gospel", lambda: make_rhythm(
    "Bethel Style", 72, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,N),(8,G)], CH_CAIXA:[(8,N)], CH_HH_CLOSED:hh8(vol=G)}),
     make_variation(16, {CH_BUMBO:[(0,N),(6,G),(8,G)], CH_CAIXA:[(8,N)], CH_HH_CLOSED:hh8(vol=G)}),
     make_variation(16, {CH_BUMBO:[(0,N),(8,G)], CH_CAIXA:[(8,N)], CH_PRATO:[(0,G),(4,G),(8,G),(12,G)]})],
    category="Gospel")))

# ─── WORLD extras ────────────────────────────────────────────────────

ALL_RHYTHMS.append(("Highlife", 120, 4, "World", lambda: make_rhythm(
    "Highlife", 120, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(8,A)], CH_CAIXA:[(4,N),(12,N)], CH_HH_CLOSED:hh8(vol=N), CH_SURDO:[(0,S),(3,G),(8,S),(11,G)]}),
     make_variation(16, {CH_BUMBO:[(0,A),(8,A)], CH_CAIXA:[(4,N),(12,N)], CH_HH_CLOSED:hh16(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(6,N),(8,A)], CH_CAIXA:[(4,N),(12,N)], CH_PRATO:ride8(vol=S)})],
    category="World")))

ALL_RHYTHMS.append(("Soukous", 140, 4, "World", lambda: make_rhythm(
    "Soukous", 140, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(4,N),(8,A),(12,N)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh16(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(4,N),(8,A),(12,N)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh8(vol=N), CH_HH_OPEN:[(14,S)]}),
     make_variation(16, {CH_BUMBO:[(0,A),(4,N),(8,A),(12,N)], CH_CAIXA:[(4,A),(12,A)], CH_PRATO:ride8(vol=N)})],
    category="World")))

ALL_RHYTHMS.append(("Zouk", 120, 4, "World", lambda: make_rhythm(
    "Zouk", 120, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(6,N),(8,A)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh16(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(6,N),(8,A),(14,G)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh16(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(6,N),(8,A)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh8(vol=N)})],
    category="World")))

ALL_RHYTHMS.append(("Kizomba", 95, 4, "World", lambda: make_rhythm(
    "Kizomba", 95, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(3,N),(8,A),(11,N)], CH_CAIXA:[(4,N),(12,N)], CH_HH_CLOSED:hh8(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(3,N),(8,A),(11,N)], CH_CAIXA:[(4,N),(12,N),(14,G)], CH_HH_CLOSED:hh16(vol=G)}),
     make_variation(16, {CH_BUMBO:[(0,A),(3,N),(8,A),(11,N)], CH_CAIXA:[(4,N),(12,N)], CH_PRATO:ride8(vol=G)})],
    category="World")))

ALL_RHYTHMS.append(("Afro Cuban", 110, 4, "World", lambda: make_rhythm(
    "Afro Cuban", 110, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(1,N),(8,A),(9,N)], CH_CAIXA:[(4,N),(12,N)], CH_HH_CLOSED:[(0,A),(4,A),(8,A),(12,A)], CH_SURDO:[(0,N),(3,G),(6,G),(8,N),(11,G),(14,G)]}),
     make_variation(16, {CH_BUMBO:[(0,A),(1,N),(8,A),(9,N)], CH_CAIXA:[(4,N),(12,N)], CH_PRATO:ride8(vol=N)}),
     make_variation(16, {CH_BUMBO:[(0,A),(1,N),(8,A),(9,N)], CH_CAIXA:[(4,N),(11,G),(12,N)], CH_HH_CLOSED:hh8(vol=N)})],
    category="World")))

ALL_RHYTHMS.append(("Second Line", 110, 4, "World", lambda: make_rhythm(
    "Second Line", 110, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(8,A)], CH_CAIXA:[(0,N),(2,G),(4,A),(6,G),(8,N),(10,G),(12,A),(14,G)], CH_HH_CLOSED:hh8(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(6,N),(8,A)], CH_CAIXA:[(0,N),(2,G),(4,A),(10,G),(12,A),(14,G)], CH_HH_CLOSED:hh8(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(8,A)], CH_CAIXA:[(0,N),(4,A),(8,N),(12,A)], CH_HH_CLOSED:hh16(vol=G)})],
    category="World")))

# ─── GAÚCHO extras ───────────────────────────────────────────────────

ALL_RHYTHMS.append(("Rancheira", 170, 6, "Gaúcho", lambda: make_rhythm(
    "Rancheira", 170, 6, 24, 12, 12, 12,
    [make_variation(24, {CH_BUMBO:[(0,A),(8,N),(16,N)], CH_CAIXA:[(4,N),(12,N),(20,N)], CH_HH_CLOSED:[(i,N if i%4==0 else S) for i in range(0,24,2)]}),
     make_variation(24, {CH_BUMBO:[(0,A),(8,N),(16,N)], CH_CAIXA:[(4,N),(12,N),(20,N)], CH_HH_CLOSED:[(i,S) for i in range(0,24,2)], CH_HH_OPEN:[(22,S)]}),
     make_variation(24, {CH_BUMBO:[(0,A),(8,N),(16,N)], CH_CAIXA:[(4,N),(12,N),(20,N)], CH_PRATO:[(0,N),(8,N),(16,N)]})],
    category="Gaúcho")))

ALL_RHYTHMS.append(("Polca", 120, 4, "Gaúcho", lambda: make_rhythm(
    "Polca", 120, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(8,A)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh8(vol=N)}),
     make_variation(16, {CH_BUMBO:[(0,A),(4,N),(8,A),(12,N)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh8(vol=N)}),
     make_variation(16, {CH_BUMBO:[(0,A),(8,A)], CH_CAIXA:[(4,A),(12,A)], CH_PRATO:ride8(vol=N)})],
    category="Gaúcho")))

ALL_RHYTHMS.append(("Vanerão", 165, 4, "Gaúcho", lambda: make_rhythm(
    "Vanerão", 165, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(2,N),(4,A),(6,N),(8,A),(10,N),(12,A),(14,N)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh8(vol=A)}),
     make_variation(16, {CH_BUMBO:[(0,A),(2,N),(8,A),(10,N)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh8(vol=A)}),
     make_variation(16, {CH_BUMBO:[(0,A),(2,N),(4,A),(6,N),(8,A),(10,N),(12,A),(14,N)], CH_CAIXA:[(4,A),(12,A)], CH_PRATO:ride8(vol=A)})],
    category="Gaúcho")))

ALL_RHYTHMS.append(("Schottisch", 110, 4, "Gaúcho", lambda: make_rhythm(
    "Schottisch", 110, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(8,A)], CH_CAIXA:[(4,N),(12,N)], CH_HH_CLOSED:hh8(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(4,N),(8,A),(12,N)], CH_CAIXA:[(4,N),(12,N)], CH_HH_CLOSED:hh8(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(8,A)], CH_CAIXA:[(4,N),(12,N)], CH_PRATO:ride8(vol=S)})],
    category="Gaúcho")))

ALL_RHYTHMS.append(("Mazurca", 140, 6, "Gaúcho", lambda: make_rhythm(
    "Mazurca", 140, 6, 24, 12, 12, 12,
    [make_variation(24, {CH_BUMBO:[(0,A),(8,N)], CH_CAIXA:[(4,N),(16,A)], CH_HH_CLOSED:[(i,N if i%4==0 else S) for i in range(0,24,2)]}),
     make_variation(24, {CH_BUMBO:[(0,A),(8,N),(16,N)], CH_CAIXA:[(4,N),(16,A)], CH_HH_CLOSED:[(i,S) for i in range(0,24,2)]}),
     make_variation(24, {CH_BUMBO:[(0,A),(8,N)], CH_CAIXA:[(4,N),(16,A)], CH_PRATO:[(0,N),(8,N),(16,N)]})],
    category="Gaúcho")))

ALL_RHYTHMS.append(("Chimarrita", 120, 6, "Gaúcho", lambda: make_rhythm(
    "Chimarrita", 120, 6, 24, 12, 12, 12,
    [make_variation(24, {CH_BUMBO:[(0,A),(12,N)], CH_CAIXA:[(8,N),(20,N)], CH_HH_CLOSED:[(i,N if i%4==0 else S) for i in range(0,24,2)]}),
     make_variation(24, {CH_BUMBO:[(0,A),(6,G),(12,N)], CH_CAIXA:[(8,N),(20,N)], CH_HH_CLOSED:[(i,S) for i in range(0,24,2)]}),
     make_variation(24, {CH_BUMBO:[(0,A),(12,N)], CH_CAIXA:[(8,N),(20,N)], CH_PRATO:[(0,S),(8,S),(16,S)]})],
    category="Gaúcho")))

ALL_RHYTHMS.append(("Chacarera", 120, 6, "Gaúcho", lambda: make_rhythm(
    "Chacarera", 120, 6, 24, 12, 12, 12,
    [make_variation(24, {CH_BUMBO:[(0,A),(12,N),(16,N)], CH_CAIXA:[(6,N),(18,N)], CH_HH_CLOSED:[(i,N if i%4==0 else S) for i in range(0,24,2)]}),
     make_variation(24, {CH_BUMBO:[(0,A),(12,N),(16,N)], CH_CAIXA:[(6,N),(18,N),(22,G)], CH_HH_CLOSED:[(i,S) for i in range(0,24,2)]}),
     make_variation(24, {CH_BUMBO:[(0,A),(12,N),(16,N)], CH_CAIXA:[(6,N),(18,N)], CH_PRATO:[(0,S),(8,S),(16,S)]})],
    category="Gaúcho")))

ALL_RHYTHMS.append(("Rasguido Doble", 90, 4, "Gaúcho", lambda: make_rhythm(
    "Rasguido Doble", 90, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(3,N),(6,N),(8,A),(11,N),(14,N)], CH_CAIXA:[(4,N),(12,N)], CH_HH_CLOSED:hh8(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,A),(3,N),(6,N),(8,A),(11,N),(14,N)], CH_CAIXA:[(4,N),(12,N)], CH_HH_CLOSED:hh16(vol=G)}),
     make_variation(16, {CH_BUMBO:[(0,A),(3,N),(6,N),(8,A),(11,N),(14,N)], CH_CAIXA:[(4,N),(8,G),(12,N)], CH_HH_CLOSED:hh8(vol=S)})],
    category="Gaúcho")))

ALL_RHYTHMS.append(("Vaneira Missioneira", 140, 4, "Gaúcho", lambda: make_rhythm(
    "Vaneira Missioneira", 140, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(2,N),(4,A),(6,N),(8,A),(10,N),(12,A),(14,N)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh8(vol=N)}),
     make_variation(16, {CH_BUMBO:[(0,A),(2,N),(8,A),(10,N)], CH_CAIXA:[(4,A),(12,A)], CH_HH_CLOSED:hh8(vol=N)}),
     make_variation(16, {CH_BUMBO:[(0,A),(2,N),(4,A),(6,N),(8,A),(10,N),(12,A),(14,N)], CH_CAIXA:[(4,A),(12,A)], CH_PRATO:ride8(vol=N)})],
    category="Gaúcho")))

# ─── JAZZ extras ─────────────────────────────────────────────────────

ALL_RHYTHMS.append(("Bebop", 200, 4, "Jazz", lambda: make_rhythm(
    "Bebop", 200, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,G),(6,G),(10,G)], CH_PRATO:[(0,A),(2,S),(4,A),(6,S),(8,A),(10,S),(12,A),(14,S)], CH_HH_CLOSED:[(4,N),(12,N)]}),
     make_variation(16, {CH_BUMBO:[(0,G),(10,G),(14,G)], CH_CAIXA:[(6,G),(14,G)], CH_PRATO:[(0,A),(2,S),(4,A),(6,S),(8,A),(10,S),(12,A),(14,S)], CH_HH_CLOSED:[(4,N),(12,N)]}),
     make_variation(16, {CH_BUMBO:[(0,G),(8,G)], CH_PRATO:[(0,A),(2,S),(4,A),(6,S),(8,A),(10,S),(12,A),(14,S)], CH_HH_CLOSED:[(4,N),(12,N)]})],
    category="Jazz")))

ALL_RHYTHMS.append(("Cool Jazz", 100, 4, "Jazz", lambda: make_rhythm(
    "Cool Jazz", 100, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,G),(8,G)], CH_PRATO:[(0,N),(2,G),(4,N),(6,G),(8,N),(10,G),(12,N),(14,G)], CH_HH_CLOSED:[(4,S),(12,S)]}),
     make_variation(16, {CH_BUMBO:[(0,G)], CH_CAIXA:[(10,G)], CH_PRATO:[(0,N),(2,G),(4,N),(6,G),(8,N),(10,G),(12,N),(14,G)], CH_HH_CLOSED:[(4,S),(12,S)]}),
     make_variation(16, {CH_BUMBO:[(0,G),(8,G)], CH_PRATO:[(0,N),(4,N),(8,N),(12,N)], CH_HH_CLOSED:[(4,S),(12,S)]})],
    category="Jazz")))

ALL_RHYTHMS.append(("Latin Jazz", 180, 4, "Jazz", lambda: make_rhythm(
    "Latin Jazz", 180, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,A),(1,N),(8,A),(9,N)], CH_CAIXA:[(4,N),(12,N)], CH_PRATO:[(0,A),(2,S),(4,A),(6,S),(8,A),(10,S),(12,A),(14,S)], CH_HH_CLOSED:[(4,N),(12,N)]}),
     make_variation(16, {CH_BUMBO:[(0,A),(1,N),(8,A),(9,N)], CH_CAIXA:[(4,N),(11,G),(12,N)], CH_PRATO:[(0,A),(2,S),(4,A),(6,S),(8,A),(10,S),(12,A),(14,S)], CH_HH_CLOSED:[(4,N),(12,N)]}),
     make_variation(16, {CH_BUMBO:[(0,A),(1,N),(8,A),(9,N)], CH_CAIXA:[(4,N),(12,N)], CH_PRATO:ride8(vol=A)})],
    category="Jazz")))

ALL_RHYTHMS.append(("Smooth Jazz", 90, 4, "Jazz", lambda: make_rhythm(
    "Smooth Jazz", 90, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,N),(6,G),(8,N)], CH_CAIXA:[(4,S),(12,S)], CH_HH_CLOSED:hh8(vol=G)}),
     make_variation(16, {CH_BUMBO:[(0,N),(6,G)], CH_CAIXA:[(4,S),(12,S),(14,G)], CH_HH_CLOSED:hh8(vol=G)}),
     make_variation(16, {CH_BUMBO:[(0,N),(6,G),(8,N)], CH_CAIXA:[(4,S),(12,S)], CH_PRATO:ride8(vol=G)})],
    category="Jazz")))

ALL_RHYTHMS.append(("Bossa Jazz", 130, 4, "Jazz", lambda: make_rhythm(
    "Bossa Jazz", 130, 4, 16, 16, 16, 8,
    [make_variation(16, {CH_BUMBO:[(0,N),(4,S),(5,S),(9,S)], CH_CAIXA:[(0,S),(3,G),(6,G),(10,S),(12,G)], CH_PRATO:ride8(vol=S)}),
     make_variation(16, {CH_BUMBO:[(0,N),(5,S),(9,S)], CH_CAIXA:[(0,S),(3,G),(6,G),(10,S)], CH_PRATO:ride8(vol=S), CH_HH_CLOSED:[(4,G),(12,G)]}),
     make_variation(16, {CH_BUMBO:[(0,N),(4,S),(5,S),(9,S),(13,G)], CH_CAIXA:[(0,S),(3,G),(6,G),(10,S),(12,G)], CH_PRATO:ride8(vol=S)})],
    category="Jazz")))

# ═════════════════════════════════════════════════════════════════════
# GENERATE
# ═════════════════════════════════════════════════════════════════════

def main():
    out_dir = os.path.join(os.path.dirname(__file__), '..', 'public', 'rhythm')
    existing = set(os.listdir(out_dir))
    generated = []

    for name, tempo, beats, category, builder in ALL_RHYTHMS:
        filename = f"{name}.json"
        filepath = os.path.join(out_dir, filename)
        if filename in existing:
            continue
        rhythm = builder()
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(rhythm, f, ensure_ascii=False, indent=2)
        generated.append(filename)
        print(f"  ✓ {filename} ({tempo} BPM, {beats}/x, {category})")

    # Update manifest
    all_files = sorted([f for f in os.listdir(out_dir) if f.endswith('.json') and f != 'manifest.json'])
    categories = {}
    for f in all_files:
        with open(os.path.join(out_dir, f), 'r') as fh:
            data = json.load(fh)
            cat = data.get('category', 'Outros')
            categories.setdefault(cat, []).append(f)

    manifest = {"version": 6, "rhythms": all_files, "categories": categories}
    with open(os.path.join(out_dir, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(f"\nGerados: {len(generated)} novos")
    print(f"Total: {len(all_files)} ritmos")
    print(f"Categorias: {', '.join(f'{k} ({len(v)})' for k,v in sorted(categories.items()))}")

if __name__ == '__main__':
    main()
