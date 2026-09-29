# REFERENCE.md - Porsche 911 GT3 RS (992.1, 2022-2025) - text-only reference for procedural modellers

Prepared from Porsche press kits / technical-data sheet, Porsche newsroom pages, Wikipedia, spec databases and
enthusiast/tech press (source list in section 7). No image was downloaded or used. Where a number is not published
it is either derived (arithmetic from published numbers) or estimated from knowledge of the car's proportions and is
tagged as such. **Read the confidence tags before trusting a number.**

Confidence tags used everywhere:
- **[V]** verified - Porsche official document and/or two or more independent sources agree.
- **[S]** single secondary source (press/forum/database), plausible but not cross-checked.
- **[D]** derived - arithmetic from [V] numbers (formula given or obvious).
- **[E]** estimate - modeller-grade estimate from proportions/knowledge of the car; expect +/-0.02..0.05 m unless stated.
- **[U]** uncertain / recalled shape detail that no text source confirms; use as a starting point and eyeball-check.

Project coordinates (from ARCHITECTURE.md / spec.js): metres, origin on ground at mid-wheelbase on the centre-line,
+X forward (nose), +Y up, +Z = car's RIGHT side, LHD (driver at -Z). Car is symmetric, so numbers below are given
for +Z and mirror to -Z. "z" values are half-widths unless stated.

Scope note: this is the **992.1** GT3 RS (launched Aug 2022). A 992.2 facelift GT3 RS (new rear bumper with 4 diffuser
fins and outlets beside the tailpipes, revised hood vents, small canards, reshaped centre grille, possibly 3-element
wing) was only spy-photographed as of Sept 2026 - do **not** copy those features (see section 4).

---------------------------------------------------------------------------------------------------------------

## 0. IMPORTANT CORRECTIONS TO `js/car/spec.js` (found while cross-checking; spec.js is not mine to edit)

| spec.js value | Problem | Verified value |
|---|---|---|
| wheel.front.rimWidth 0.241 (9.5J) / rear 0.318 (12.5J) | those are GT3 (non-RS) widths | RS: **10J = 0.254 m front, 13J = 0.330 m rear** [V Porsche tech data] |
| track front 1.590 / rear 1.550 | GT3-ish / wrong | RS: **1.630 front, 1.582 rear** [V Porsche tech data] |
| roofMaxY 1.312 | 1.322 is the *wing top*, not the roof | roof peak ~**1.28** [E, ~1.275-1.285], wing top **1.322** [V height figure = highest point] |
| splitterY 0.070 | splitter lip sits higher at design ride height | lip underside ~**0.09-0.10** at standard ride height [S 97 mm; E]; ground clearance ~0.100 [S] |
| Python Green '#4d6f38' (dark olive) | real Python Green is a bright, saturated, slightly yellow green | see section 5 |
| Arctic Grey metallic 0.2 | Arctic Grey is a *solid* (non-metallic) colour [S rennbow] | metallic 0 |
| fuelFlap {x1.62,y0.82} | no external fuel flap is documented on the RS; filler is under the front lid as on all 911s (radiator now fills the "frunk") | model no visible flap [U] |
| hoodMidY 0.86 @ x=1.35 | a bit high | lid centre ~0.80-0.82 at x=1.35 [E]; the fender crests are ~0.86-0.88 |

Wing anchors in spec.js (strutZ 0.58, baseX -1.98, spanHalf 0.93, mainChordMid [-2.16,1.30]) are broadly consistent with my
estimates (section 1.6) - only the endplate outer-face z (I suggest 0.90) is slightly wide.

---------------------------------------------------------------------------------------------------------------

## 1. VERIFIED DIMENSIONS

### 1.1 Overall (Porsche technical data sheet MY P 08/2022, EU model) [V]

| Item | Value | Notes |
|---|---|---|
| Length | **4,572 mm** | to bumper/diffuser; wing does not extend it |
| Width (excl. mirrors) | **1,900 mm** | "Turbo-wide" body (GT3 base is 1,852) [V Porsche; fmbwheels, autodata agree] |
| Width incl. mirrors | **2,027 mm** | => mirror outer edge at z = +/-1.0135 |
| Height | **1,322 mm** | highest point = rear-wing top (wing sits ~2 in above the roof) [V + S TheDrive "almost 2 inches"]; GT3 base = 1,279 mm |
| Wheelbase | **2,457 mm** | same as GT3 |
| Track front / rear | **1,630 / 1,582 mm** | 29 mm wider than GT3 (1,601 / 1,553) [V Porsche press kit "29 mm wider"] |
| Front / rear overhang | ~**1.00 / 1.115 m** | sum = 4.572-2.457 = 2.115 exact [D]; split is [E] (spec.js uses 1.027 / 1.088, also fine within +/-0.03) |
| Ground clearance | ~**100 mm** | [S autodata, ultimatespecs]; front lip underside reported ~97 mm [S]; front axle lift +30 to +46 mm (US kit "1.18 in", GT3 kit "46 mm at lip", Porsche INT page "40 mm") [V range] |
| Unladen weight (DIN) | **1,450 kg** | 3,268 lb US "lightest"; EU-with-driver ~1,525 kg; Weissach ~ -15 kg (33 lb); GT3 = 1,435 kg PDK |
| Max permissible weight | 1,795 kg | |
| Fuel tank | 64 l (90 l optional) | |
| Drag / area | Cd **0.39** (low-downforce default), A **2.21 m2**, CdA 0.862 m2 | |
| Downforce | **409 kg (901 lb) @ 200 km/h (124 mph); 860 kg (1,896 lb) @ 285 km/h (177 mph)** | 2x 991.2 GT3 RS, 3x 992 GT3 |
| Aero balance | ~30 % front / 70 % rear [S Excellence, TopGear] | |
| Turning circle | 10.5 m | steering wheel dia. 360 mm |
| Top speed / 0-100 | 296 km/h / 3.2 s | 4.0 NA flat-six 386 kW (525 PS), 9,000 rpm |
| Body construction | CFRP: doors, front fenders, roof, front lid, rear deck lid, wing, spoiler, seats; aluminium/steel rest | doors are the first CFRP doors on a road 911 [V] |

Derived in project frame [D]: front axle x = +1.2285, rear axle x = -1.2285; nose (splitter tip) x = +2.255, tail x = -2.317
(matches spec.js). Half-width of body max = 0.950; mirror outer edge z = 1.0135.

### 1.2 Wheels, tyres [V unless noted]

| | Front | Rear |
|---|---|---|
| Wheel | forged, centre-lock, **10J x 20, ET45** | forged, centre-lock, **13J x 21, ET31** |
| Rim width | 0.254 m | 0.330 m |
| Rim diameter (bead seat) | 0.508 m | 0.5334 m |
| Centre bore / fixing | 71.6 mm, single centre-lock nut, 600 Nm [S fmbwheels] | same |
| Tyre | **275/35 ZR20 102Y XL** Michelin Pilot Sport Cup 2 R (Porsche-approved "N" mark) | **335/30 ZR21 109Y XL** Michelin Pilot Sport Cup 2 R |
| Sidewall height (nominal) | 96.3 mm | 100.5 mm |
| Overall diameter | 701 mm (27.6 in) [S Michelin/tiresize] => r = 0.350 [D nominal 700.5] | Michelin lists 28.5 in = 724 mm (r = 0.362); nominal formula gives 734 mm (r = 0.367). Use **r ~ 0.362-0.367** |
| Section width | 277 mm (10.9 in) | 320 mm (12.6 in), tread 312 mm (12.3 in) |
| Wheel centre (project) | (+1.2285, 0.350, +/-0.815) | (-1.2285, ~0.364, +/-0.791) |
| Tyre outer bulge z | 0.815+0.1385 = **0.954** (less ~0.012 for static camber) | 0.791+0.160 = **0.951** |
| Hub mounting face z (ET) | 0.815+0.045 = **0.860** | 0.791+0.031 = **0.822** |
| Rim outer lip z | 0.815+0.127 = 0.942 | 0.791+0.165 = 0.956 |
| Spoke-face concavity (lip minus hub face) | ~0.082 m (spokes recessed) | ~0.134 m (deeper dish) [D] |

Cross-check: tyre bulges (0.95) are essentially flush with the body half-width (0.95) => **wheels/tyres sit almost flush with the
fender edges front and rear** (RS trademark; front fenders only ~5-15 mm outboard of the tyre).
Wheel options (Porsche kit + fmbwheels): standard forged aluminium; "lightweight" forged aluminium (~1.3 kg/set lighter);
Weissach forged **magnesium** (~8 kg/set, "more than 20 % lighter"), same sizes, "special spoke openings".
Finishes: Satin Black (painted rim edge Shark Blue / Guards Red offered on GT3, similar on RS), Satin Neodyme (gold-bronze), Satin Platinum / Dark Silver,
Indigo Blue, Pyro Red (Weissach mag, anodised colours), Brilliant Silver [S]. Design: **10 spokes** (10-spoke star, single wide
tapered spokes with pocketed/hollowed faces, not Y-spokes and not twin-spokes) [S eBay OEM listing, press "special spoke openings"; shape detail U].
Centre-lock nut: black, with silver **"RS"** logo (Porsche Design watch rotor is modelled on it) [S press kit].
Tyre sidewalls: MICHELIN + "PILOT SPORT CUP 2 R" in raised/white lettering, size text, Porsche "N" star-mark; ~5.5/32 in tread depth, semi-slick pattern
(4 circumferential grooves but shallow, closely-spaced) [U for pattern].

### 1.3 Brakes [V Porsche]
- Front: aluminium **monobloc 6-piston** fixed calipers (piston dia. 32 mm, GT3 = 30), iron composite dimpled/vented disc **408 x 36 mm** with aluminium hat.
- Rear: **4-piston** monobloc, disc **380 x 30 mm**.
- **PCCB (option): 410 mm front / 390 mm rear**, calipers **yellow**; standard iron brakes have **red** calipers [S apexwheels/fmbwheels].
  Black/other caliper colours via Exclusive Manufaktur. Calipers carry Porsche script (white/black) [E].
- Estimated caliper footprint [E]: front ~0.27 m circumferential x ~0.08 m radial (spans ~85-90 deg of disc), sits on the rearward (trailing)
  side of the front disc; rear ~0.20 m x 0.07 m. Disc friction ring ~0.13 -> 0.204 m radius front, ~0.12 -> 0.190 m rear; cross-drilled/dimpled look.
- Front brake air: four side intakes in the front end feed only the front brakes; rear brakes cooled by two underbody intakes [V press kit].

### 1.4 Chassis/stance facts useful for modelling
- PASM sport suspension lowered 20 mm vs Carrera; rear-axle steering; **front axle lift** (optional, standard on many cars) raises nose ~30-46 mm below ~30 km/h.
- Front wishbones have **teardrop (aero) cross-section** links (visible behind the spokes) - about +40 kg downforce at top speed [V].
- Double-wishbone front axle (first in a road 911), multi-link rear.
- Steering wheel diameter 360 mm; camber is adjustable, static camber ~ -1 to -3 deg front [E].

### 1.5 Roof, hood, glass
- Roof peak ~**1.28 m** [E; GT3 = 1.279, RS tyres ~7 mm larger radius, roof is CFRP]; Porsche's 1.322 m is the wing.
- Hood (front lid) height: leading edge ~**0.60**, over front axle ~**0.82**, at the cowl/wiper base ~**0.965** [E]; fender crests ~0.86-0.88 [E].
- Windscreen rake: base (x~+0.72, y~0.965) to header (x~+0.02, y~1.27) => ~**24 deg above horizontal** (about 66 deg from vertical), slant length ~0.76 m [E].
- Windscreen laminated with acoustic film; all other glass "lightweight" (thin) glass; rear window glass, not polycarbonate [V press].
- Door: CFRP, frameless glass; door length ~1.0-1.05 m (front edge x~+0.55 to rear edge x~-0.45), door skin bottom y~0.24, belt/top edge y~0.98-0.99;
  side-glass height belt-to-roof-edge ~0.27-0.29 m; glass top edge length ~0.55-0.60 m, belt-line length ~0.90 m [E].
  A small fixed triangular window sits ahead of the door glass at the mirror base (trim carbon on Weissach) [V press: "front window triangle trim"].
  Rear quarter glass: fixed, low and long, tapering rearwards along the roofline, ~0.5-0.55 m long x ~0.20 m tall at its front [E].
- Door has a **"deep-draw inset"** (bevelled scallop) in its forward edge that cuts into the front fender, boosting wheel-arch ventilation [S Jalopnik/PCA].

### 1.6 Rear wing (best estimates; Porsche publishes no wing dimensions) 
Official facts [V]: swan-neck-supported, fixed main wing + upper hydraulically adjustable element; top/bottom surface area **40 % larger than 991.2 GT3 RS**;
upper edge higher than the roof; CFRP; adjustment range **34 deg** (infinitely variable, ~0.35 s); default = flat (DRS/low-downforce, Cd 0.39);
high-downforce = steep; airbrake = steepest (front flaps and rear flap both to max). Auto-DRS above 100 km/h (62 mph) with throttle > 95 %.
Estimated geometry in project frame [E]:
| Item | Estimate |
|---|---|
| Blade span (main plane between endplates) | ~1.75-1.80 m |
| Endplates: outer face z | **+/-0.90** (spec.js 0.93 also acceptable), thickness ~0.012-0.015 |
| Endplate size | ~0.50-0.55 m long (fore-aft), ~0.34 m tall at rear, ~0.20-0.25 m tall at front; roughly trapezoidal / shark-fin, top edge rising rearward, rounded corners; carbon (Weissach) or black with accent-coloured "RS"/Weissach lettering [U] |
| Total chord (main + flap incl. overlap) | ~0.40-0.45 m: main ~0.27-0.30, upper flap ~0.18-0.22 |
| Wing top (flap up, default flat) | y = **1.322** (official height) |
| Flap trailing edge at max angle | + ~0.08-0.12 m above default (0.20 m flap x sin 34 deg = 0.11) => ~1.40-1.44 [E] |
| Leading edge / trailing edge x | LE ~ -1.90..-1.95; TE ~ -2.28..-2.32 (about level with the tail) |
| Height of main-plane underside above rear deck | ~0.20 m |
| Swan-neck uprights | two, at z = **+/-0.55** (0.50-0.60), thick streamlined (elliptical section ~0.05 x 0.03 m) blades that rise from the deck at x ~ -1.95 (feet y ~1.02), sweep rearwards/up and **attach from above to the top surface of the fixed main element**, leaving the underside clean [V "swan-neck ... suspended from above"]; carbon on Weissach cars (aluminium on GT3) |
| Wing lettering | "PORSCHE" script on the wing/spoiler in an accent colour; "Weissach RS" side lettering on endplates when Weissach + accent decals [S] |

Under the wing the engine lid ends in an **upswept duck-tail spoiler** (CFRP, body-colour or black) [V "rear spoiler ... CFRP"; S CarThrottle "additional ducktail spoiler for good measure"].

---------------------------------------------------------------------------------------------------------------

## 2. ZONE-BY-ZONE VISUAL FEATURE CHECKLIST

Legend: [V] official text; [S] secondary text; [E] estimate; [U] recalled shape not text-confirmed.

### 2.1 FRONT
1. **Central radiator concept, no frunk** [V]: single large radiator, canted forward **43 deg** [S Excellence], fills the former luggage compartment. Air enters the front-bumper openings,
   exits through the lid. Consequence: the lid is a heavily-vented CFRP panel.
2. **Front lid (CFRP)** [V]: "large openings and air deflectors (nostrils) on the hood, directing air left and right"; outlets are **L-shaped / boomerang** ("angled radiator outlet boomerangs" [S Excellence]; "L-shaped hood openings" [S PCA]).
   Modelling guide [E/U]: two outlets, one per side of the centre-line, centred ~z = +/-0.20..0.26, spanning x ~ +1.45..+1.90, each roughly 0.40-0.45 m long x 0.14-0.18 m wide with a
   raised black deflector fin ("boomerang") along the outer/rear edge that throws air sideways; black vertical/angled louvre slats inside. The land between them (~0.20-0.30 m wide) carries a small Porsche crest at the leading edge.
   Lid width between fender crest lines ~1.10 m at the nose widening to ~1.30 m at the cowl. Shut lines (panel gaps 3-4 mm) follow the fender crests.
3. **Fender crests vs hood** [E]: 911 layout - the two fender crests stand ~0.03-0.05 m proud of the lid centre; crest line runs from the top of each headlamp (y ~0.78) rearward and up to ~0.87 by x ~ +1.3, continuing to the A-pillar base (~0.95).
   The lid centre is visibly lower and flatter than the crests.
4. **Front bumper** [V/S]: broad central lower grille/opening feeding the radiator; two outer side intakes per side feeding brakes (four brake-cooling intakes total); black **front splitter** "that divides the air above and below the car" (a full-width black splitter blade/lip, ~1.75-1.80 m wide with side blades at the ends, lip protruding ~0.05-0.08 m past the bumper face) [E for sizes].
   **Side blades** (vertical black fins) at the outer corners "direct the air outwards" [V].
5. **Active front aero flaps** [V]: in the outer corners ahead of each front wheel - a two-part flap: a **main flap angled toward the underbody** (rotates >80 deg in 0.3 s, electric motors) and a **smaller upper flap at the end of the brake air duct**. Visually: a black wing-blade element (~0.30-0.35 m wide x 0.10 m deep) tucked in the lower outer bumper opening [E for sizes]. On Weissach cars the front airblades can be exposed carbon [S].
6. **Headlights** [V/S]: LED (PDLS+ matrix), "LED headlights in black" i.e. black inner bezel; round-ish pod ~0.19-0.20 m dia. centred x ~ +1.92..+1.95, y ~ 0.72-0.74, z ~ +/-0.62..0.63 [E; spec.js has same]; **4-point daytime running light** (four discrete LED dots per lamp) [V for 992 headlamp family; the RS has the same]. Sport Design orange accent rings only on Sonderwunsch cars.
7. **Indicators** [V]: "aerodynamically optimized side indicators attached to the side blades" - i.e. slim amber indicator/marker elements integrated with the blades behind the front wheels and on the bumper side blades, not in the headlamp.
8. **Front fender louvres** [V]: "Front wheel arch ventilation via louvered openings in the front wings (fenders)". [E/U] a rectangular louvred panel, ~0.30 m long x 0.09 m wide, 5-6 slats, on the upper rear quadrant of each front fender,
   about x +0.85..+1.15, top surface near the crest (y ~0.82-0.86, z ~0.86-0.92). Louvres are black on painted/carbon fenders (aftermarket versions are carbon).
9. **Inlets behind the front wheels** "in the style of the 1998 911 GT1" [V]: openings at the rear edge of the front wheel arch / front of the door that relieve arch pressure, with **vertical vanes/side blades** aft of the wheel ("vertical vanes aft of the front wheels ensure laminar flow along the lower door") [S]. The door's scalloped forward edge meets this zone.
10. **Front lift** - no visible feature except a lower splitter lip clearance; **tow-hook cap**: a small square push-out cap in the lower front bumper (off-centre) [S/U]. **Fuel filler**: under the front lid (no external flap) [U].
11. Front wing/fender panels are CFRP; front axle track +29 mm over GT3 so the fender arch flares are wider/more muscular than a Carrera; arch opening radius ~0.395 m [E].

### 2.2 SIDE
1. **Roof**: CFRP (body-colour on the standard car; **exposed carbon-weave** with Weissach), smooth, gently crowned ~0.02 m; no roof-scoop recess; **two black roof fins** (strakes) near the rear edge of the roof above the rear window, one per side, each ~0.20-0.30 m long x ~0.03-0.04 m tall, thin (~4 mm) plates angled outward ~10-20 deg
   to push hot radiator air sideways [V function; S location "rear end of the roof" / "centrally on rear deck"; sizes E/U]. Suggest x ~ -0.55..-0.85, z ~ +/-0.20..0.35.
2. **Door**: CFRP, frameless glass, shallow character line; lower door bevelled; flush-ish **partially recessed door handles** (GT3 family item; RS believed same) [V for GT3 press, U for RS]; door handle anchor per spec.js (-0.20, 0.93, +/-0.925) is reasonable.
   Interior release = fabric pull loop.
3. **Mirrors**: separate motorsport-style housings with a **body-coloured top shell (carbon on Weissach)**, a separate lower cover in body colour or black, and a **satin-gloss black base/stalk** standing on the door top near the A-pillar
   [V GT3 press kit: "top and bottom covers in exterior colour, mirror base in satin-gloss black"]. Position ~ x +0.55..+0.65, base y ~0.99, z ~0.90-0.93; housing ~0.20 x 0.11 m, outer edge at z = 1.0135.
4. **Windows**: main frameless glass with black/gloss frame trim (silver anodised on Touring only); fixed front triangle at the mirror base; fixed rear quarter glass; all tinted; no B-pillar.
5. **Side sills**: black lower "side skirt" blade along the sill ("Side skirts prevent air escaping under the car") [S]; sill bottom y ~0.12-0.15; door-sill lettering decal "GT3 RS" (see section 5).
6. **Rear fender intakes** [V]: like the Turbo, large intake openings on the front edge of the rear fenders behind the door (x ~ -0.50..-0.90, y ~ 0.50-0.80) - but on the RS they are **aero/brake-cooling/pressure-relief only, not engine intakes** ("openings in the rear side panel are used exclusively to improve aerodynamics and cooling during braking"). Slanted, black-lined, with a vertical/diagonal blade inside [U]. There is also **an intake and a side blade at the rear wheel arch** [V].
   The engine breathes through grilles on the deck lid under the wing (see 2.3).
7. **Shoulder line / haunch**: strong flared rear fender ("Turbo body", 48 mm wider than GT3 at the rear); haunch widest at ~wheel-centre height (z ~ 0.95, y ~0.60-0.70), crest at y ~1.02-1.05, z ~ 0.84.
8. **Wheel arches**: front arch opening r ~0.395 (tyre gap ~35-45 mm), rear r ~0.41; body-colour arches with black inner liners.
9. Side graphics: see section 5 (accent stripes / "GT3 RS" script, sill lettering).

### 2.3 REAR
1. **Engine lid (CFRP)**: rounded 911 decklid, crown y ~1.05-1.06 at x ~ -1.7, falls to ~1.02 at the trailing edge; engine intake grilles are **under the double wing** ("draws process air exclusively via intakes under the double rear wing, located very far back") [V]: black slotted grille/louvre field across the rear part of the lid between/behind the swan-neck feet [U shape], with the upswept duck-tail spoiler lip as the rear edge.
   Lid is CFRP but painted body colour (Porsche's Weissach list names hood, roof, mirror shells and wing parts as visible carbon - not the rear deck lid) [V list, U conclusion].
2. **Light bar**: continuous full-width LED strip (992 signature), width ~1.60-1.70 m, ~30-40 mm tall in the middle thickening at the ends, at y ~0.93-0.96 (spec.js 0.955); dark-tinted lens with an integrated **PORSCHE** script (satin-gloss black) in the centre [V for GT3 press: "continuous tail-light strip with integrated PORSCHE lettering in satin-gloss black"]. The lights lit red when on; end clusters have 4-point brake/light "boomerang" signature [E].
3. **Lettering**: small "GT3 RS" badge low on the right side of the bumper/lid [U]; "PORSCHE" script on the wing/spoiler; GT3 RS sticker graphic on the rear bumper with the accent-decal set [S].
4. **Rear bumper / diffuser**: GT3 diffuser "slightly adapted" [V]; fully enclosed, deep, with **vertical fins (3 per side on 992.1)** [S] and ~14 directional vanes/strakes across the panelled underbody [S Excellence, uncertain]; black textured lower valance; large **pressure-relief vents at the fender/bumper corners** (rear-wheel-housing vents) [S]; licence-plate recess in the upper-centre bumper (EU 520x110) [U].
5. **Exhaust**: stainless GT3-derived system, **two central tailpipes in black** (round/slightly oval, ~0.09-0.11 m dia., centres z ~ +/-0.12..0.14, y ~0.34-0.38, x ~ -2.28) [V GT3 press "two central tailpipes in black"; sizes E]; sits between the diffuser fins.
6. **Rear wing** - see section 1.6: swan-neck, two-element, DRS, above roofline; **DRS behaviour**: flap normally flat (lowest position), lifts up to 34 deg for cornering and airbrake; in "DRS" the flap goes flat within its range; front flaps synchronise; hydraulic actuation, ~0.35 s [V].
7. Rear track 1.582; rear tyres 335/30 ZR21 nearly flush with the fender edge.

### 2.4 UNDERBODY [V unless noted]
- **Fully panelled flat floor** ("first fully panelled underbody on a road Porsche"), number/arrangement of fins/strakes modified vs GT3; front diffuser strakes behind the splitter; rear **enclosed diffuser** >60 kg downforce; ground clearance ~0.10 m; floor kicks up ~10-12 deg from x ~ -1.4 to the tail edge at y ~0.28-0.30 [E].
- Underbody **gearbox-cooling intakes** and **rear-brake intakes** (two) in the floor; teardrop front wishbones; hot air from the front radiator exits above, not underneath.
- Colour: matte black composite panels (rear diffuser matte black, some silver-ish underbody lining) [E].

### 2.5 WHEELS - see 1.2 (10-spoke centre-lock, black nut with silver RS; satin finishes; Michelin PS Cup 2 R). Rear wheel (13J) noticeably wider and deeper-dished than front (10J).

### 2.6 INTERIOR [V from press kit unless noted]
- **Full bucket seats, CFRP shell** as standard (Adaptive Sports Seats Plus 18-way optional at no cost): black leather bolsters with silver stitching, **Race-Tex centre panel with gradient perforation** (hole size fades), "GT3 RS" embroidered on the integrated headrest in a contrast colour (Weissach: "Weissach" embroidery); fixed high backrest with belt slots for **6-point harness** (driver's 6-pt optional/Clubsport; belt colours black / Racing Yellow / Guards Red / GT Silver).
- **Rear area**: no rear seats; CFRP/lightweight rear-compartment cover behind the seats; **Clubsport package**: steel **rollover bar** (Black or Guards Red) mounted behind the seats + hand-held fire extinguisher + 6-pt harness + battery cut-off; **Weissach**: bolted rollover bar in **CFRP carbon-weave finish** (~6 kg lighter) [V]. It is a rollover bar / partial cage (one main hoop + rear stays), not a full cage.
- **Steering wheel**: 360 mm, black **Race-Tex** rim with **yellow top-centre marker**, GT3 RS logo; **four rotary dials** (PASM damper, PTV+ diff, drive mode Normal/Sport/Track, ESC/TC) and a **DRS button**; arranged as small knurled round dials at the spoke roots [U layout: two stacked on each side; DRS button on a lower spoke]. Dark-silver PDK paddles (magnesium with magnet haptics and yellow up/down icons on Weissach). Weissach: carbon-weave (satin) steering-wheel trim.
- **Instrument cluster**: central **analogue tachometer** (~10,000 rpm scale, redline 9,000) flanked by **two 7-inch digital screens** (left/right), all under one curved hood/binnacle; **track screen** mode reduces the displays; shift-assist **yellow bars** either side of the tacho that flash blue at the shift point [V]. Sport Chrono stopwatch on dash top [V "Chrono package included"].
- **Centre**: 10.9-inch PCM screen; low centre console with the **GT-specific PDK selector** (small lever with manual gate, Race-Tex grip/gaiter), minimal switches, cup-holder bezel (Weissach logo). Race-Tex on dash top (Weissach), reduced carpeting.
- **Doors**: carbon-weave inlays, **fabric loop door pulls** (Weissach: matte carbon interior handle), storage **net** in door panels, carbon door-sill guards with **"GT3 RS" script** (illuminated on some), lightweight CFRP doors.
- Carbon-weave/carbon inlay usage: seats, door inserts, trim strips, sill guards; Race-Tex (Alcantara-like microfibre) on rim, seat centres, dash top, gear-lever grip, headliner (black).

---------------------------------------------------------------------------------------------------------------

## 3. SILHOUETTE DATA (project frame; x forward, y up, z right)

MEASURED (official): length 4.572, width 1.900 (2.027 with mirrors), height 1.322 (= wing top), wheelbase 2.457, tracks 1.630/1.582,
wheel/tyre sizes, brakes. Everything else in this section is **[E]** unless stated (no text source publishes the 992 GT3 RS profile). Treat as +/-0.03 m
(nose lid heights +/-0.04) and always eyeball against a real photo silhouette if possible.

### 3.1 Centre-line side profile (upper surface), x -> y
| x (m) | y (m) | feature |
|---|---|---|
| +2.255 | 0.10-0.115 | splitter tip (underside 0.09-0.10) |
| +2.20 | 0.12 -> 0.58 | nose face: near-vertical curved bumper surface with intake openings (lower grille y 0.20-0.42) |
| +2.12 | 0.60 | front lid leading edge / lid-bumper shut line |
| +1.95 | 0.65 | ahead of the outlets |
| +1.75 | 0.70 | |
| +1.55 | 0.755 | (outlets span roughly x +1.45..+1.90) |
| +1.35 | 0.805 | |
| +1.2285 | 0.83 | over front axle (fender crest at z ~0.80 is ~0.865) |
| +1.10 | 0.865 | |
| +0.90 | 0.92 | |
| +0.72 | 0.965 | cowl / wiper base (lid rear edge) |
| +0.72 -> +0.02 | 0.965 -> 1.27 | windscreen, ~24 deg rake, ~0.76 m slant |
| +0.02 | 1.270 | roof leading edge (header) |
| -0.15 | 1.279 | |
| -0.30 | **1.280** | roof peak (front-seat backrests) |
| -0.60 | 1.268 | |
| -0.85 | 1.240 | rear roof edge / top of rear glass |
| -0.85 -> -1.50 | 1.240 -> 1.050 | rear glass, ~16 deg fastback (long, shallow) |
| -1.50 | 1.045 | glass / engine-lid junction (spec.js deckStartX -1.55, deckY 1.04) |
| -1.70 | 1.055 | lid crown |
| -1.95 | 1.045 | swan-neck feet region (y ~1.02-1.04) |
| -2.10 | 1.030 | intake grille field under the wing |
| -2.25 | 1.010-1.02 | duck-tail spoiler crest |
| -2.30 | 1.00 -> 0.965 | tail edge above the light bar |
| -2.317 | 0.965 -> 0.90 | light bar (centre y ~0.955) |
| -2.317 -> -2.25 | 0.90 -> 0.42 | rear bumper face (bulges out then tucks in) with plate recess, exhaust y 0.34-0.38 |
| -2.24 | 0.28-0.30 | diffuser trailing edge (floor kick-up from x ~ -1.4) |
Other heights: belt line (door top / glass sill) **0.98-0.99**; sill bottom ~0.12-0.15; underbody 0.10; front fender crest max ~**0.87** at x ~ +1.3;
rear haunch crest ~**1.02-1.05** at x ~ -1.2; rear arch opening top ~0.775; front arch opening top ~0.745; **wing top 1.322** (x ~ -2.15), wing flap TE up to ~1.40-1.44 when steepest; roof-fin tops ~1.30.

### 3.2 Plan-view half-widths |z| (widest point of the body at that x)
| x | |z| | notes |
|---|---|---|
| +2.255 | ~0.55-0.70 | splitter front edge (splitter full width ~1.75-1.80 incl. blades -> |z| ~0.88-0.90 at its outer ends further back) |
| +2.10 | 0.80 | bumper corners |
| +1.95 | 0.86 | headlamp outer edge |
| +1.55 | 0.925 | front arch leading edge |
| +1.2285 | **0.945** | front axle; tyre bulge 0.94-0.954 |
| +0.80 | 0.94 | arch rear edge / fender inlets |
| +0.55 | 0.92 | front of door |
| -0.20 | 0.90 | mid door (door skin bulge ~0.905 at y~0.55; belt half-width ~0.86) |
| -0.60 | 0.925 | rear fender starts to swell (rear intake) |
| -1.2285 | **0.950** | rear haunch max (= 1.900 / 2); tyre bulge 0.951 |
| -1.70 | 0.92 | |
| -2.10 | 0.87 | tail corners |
| -2.30 | 0.80 | tail (light bar half-length ~0.80-0.85) |
Mirrors: z 0.90-0.93 (base) to 1.0135 (outer edge). Greenhouse: roof panel half-width ~0.53-0.55 (crown ~0.02); side glass tumblehome ~30-35 deg from vertical.

### 3.3 Cross-section characteristics [E]
- **Front axle (x = +1.23)**: fender outer at |z| 0.945 (y ~0.55), crests at |z| ~0.80, y ~0.87; lid centre y ~0.83 (0.03-0.05 below crests), lid width between crests ~1.30; headlamps sit outboard of the lid at the nose.
- **Mid door (x = -0.20)**: sill bottom y ~0.14 at |z| 0.86; door bulge |z| ~0.905 at y ~0.5; belt y 0.985 at |z| ~0.86; glass leans in to roof edge |z| ~0.55 at y ~1.255; roof crown ~0.02.
- **Rear axle (x = -1.23)**: haunch max |z| 0.95 at y ~0.65 (widest at roughly wheel-centre height), shoulder crest y ~1.03 at |z| ~0.84, lid between crests |z| ~0.55 at y ~1.05.
- **Tail (x = -2.2)**: tail width ~1.70-1.75 at the light bar, tapering below into the diffuser (|z| ~0.65 at y 0.3).
- Overall: low, wide, flat-topped nose with raised crests; bulging rear haunches ("Turbo body") 0.95 vs 0.90 at the doors; long fastback roof; the engine lid crown (~1.05) is only ~0.06 m above the belt line (0.985) and ~0.23 m below the roof peak (1.28).

---------------------------------------------------------------------------------------------------------------

## 4. DIFFERENCES vs Carrera, GT3, GT3 Touring (do not copy the wrong features)

### vs 992 GT3 (non-RS, also GT3 Touring for shared body) [V unless noted]
| Feature | GT3 RS | GT3 |
|---|---|---|
| Body width | **1,900 mm**, Turbo-wide (front and rear fenders wider) | 1,852 mm (Carrera body) |
| Track F/R | 1,630 / 1,582 | 1,601 / 1,553 |
| Wheels | 10J x 20 ET45, 13J x 21 ET31 (275/35, 335/30) | 9.5J x 20 ET46, 12J x 21 ET45 (255/35, 315/30) |
| Height | 1,322 (wing top; wing above roof) | 1,279 (wing below/around roof, roof is highest) |
| Weight | 1,450 kg | 1,435 kg (PDK) / 1,418 (manual) |
| Radiator | one large central canted radiator, no frunk | three radiators (2 side + 1 central), small frunk |
| Front lid | large L-shaped hood outlets ("nostrils") with deflectors, CFRP | two-part air vent, CFRP |
| Front end | active front flaps + wider central grille + splitter with blades | manually adjustable front diffuser "air curtains", lower black spoiler lip |
| Fender louvres | yes (front fenders) | no |
| Door | CFRP with scalloped forward edge | aluminium |
| Roof | CFRP + two roof fins | aluminium (CFRP optional) - no fins |
| Rear side intakes | aero-only, fender-front intakes + blade | Carrera-style |
| Wing | much larger, two-element, hydraulic DRS, above roofline, 40 % larger than 991.2 RS | fixed single blade on swan neck, 4-stage manual AoA, lower |
| Rear lid | CFRP with intakes under wing | aluminium |
| Downforce | 409 kg @200, 860 kg @285 | ~1/3 of RS |
| Brakes | 408x36 six-piston (32 mm) | 408x34 six-piston (30 mm) |
| Interior | CFRP full-bucket seats std, RS logos, four rotary dials + DRS button on wheel, carbon door pulls/net, GT3 RS sill lettering | Sports Seats Plus, black interior |
| Transmission | 7-speed PDK only (shorter gearing) | PDK or 6-speed manual |

### vs GT3 Touring (992) [V Porsche newsroom]
Touring **omits the fixed rear wing** (uses the Carrera-style automatically extending spoiler), front end fully painted, silver anodised window trim; otherwise GT3 mechanics. RS has none of these: big wing, black splitter, black window frames.

### vs base 992 Carrera / Carrera S [V/E]
- Carrera has a retractable spoiler, flush pop-out door handles, frunk lid with a simple crease, side radiators + luggage, 5-stud wheels (no centre-lock), 1,852 mm width, no wing, no fins, no louvres, standard-height roof (1.30 m), aluminium body, cast wheels 20/21 in staggered but with narrower tyres (245/35, 305/30 for S).
- Carrera light bar identical concept (full-width) but without the large diffuser fins/exhaust central tips; Carrera has twin oval tips at the outer edges of the bumper, GT3/RS have twin **central** tips.
- Carrera wheel arch gap larger (higher ride height).

### vs 992.2 GT3 RS facelift (rumoured/spy only) [S]
New rear bumper with 4 diffuser fins and outlets beside tailpipes, larger tailpipes, new tail lights (992.2 design), reprofiled hood vents, small front canards, altered central grille and new intakes beside it, possibly 3-element wing. **Not** part of this model.

### vs 991.2 GT3 RS (predecessor) [V]
991 GT3 RS had three radiators, a magnesium (991.1) / optional CFRP (991.2 Weissach) roof with an 11.8 in wide recess, a bottom-mounted-upright single wing lower than the roof, no DRS/active aero, 20/21 wheels 9.5J/12.5J;
the 992 RS has twice the downforce, a roof with fins instead of the recess, and a wider front track (+29 mm over GT3).

---------------------------------------------------------------------------------------------------------------

## 5. COLOURS, FINISHES, MATERIALS

### 5.1 Paint (992.1 GT3 RS)
Standard range at launch (4 no-cost + special colours; later trimmed) [S carpaints.co, stuttcars]: Black, Pure White, Guards Red, Arctic Grey, later GT Silver Metallic and Ice Grey Metallic;
launch "special" colours Racing Yellow, Shark Blue, Python Green (all discontinued ~1 year in); Paint-to-Sample (65-114 colours, e.g. Gulf Orange, Signal Green, Ruby Star, Riviera Blue, British Racing Green, Viola).
Render-oriented sRGB hex approximations (**estimates**; web swatches are exaggerated - choose physically plausible values; metallic 0 = solid/gloss):
| Colour | hex (approx.) | type | note |
|---|---|---|---|
| Guards Red | #C9151E (range #C8102E-#D3121B) | solid | web swatch #FA2223 is too bright |
| Racing Yellow | #F5C400 (swatch #F8CD02) | solid | |
| Shark Blue | #1F6FC4 (spec.js #1d63b0 ok) | solid/flip, vivid | "luminous" blue; deeper in shade [S rennbow] |
| Python Green | ~#55B02C (bright grass/lime green; NOT olive) | solid | RAL 6038-like; swatch #1FF497 is too cyan |
| Arctic Grey | #9EA2A5 | **solid** | codes M7K/U0 |
| Ice Grey Metallic | #BDC0C3 | metallic 0.6 | |
| GT Silver Metallic | #A4A8AC | metallic 0.75 | |
| Pure White | #F1F2F0 | solid | |
| Black | #0B0B0C | solid (Jet Black metallic #0D0D10, metallic 0.45) | |
| Paint-to-Sample examples: Ruby Star / Gulf Orange / Riviera Blue | #8A1538 / #E86A10 / #3EB0D0 | PTS | |

### 5.2 Typical press-car / showroom spec (Weissach)
- Weissach package (~+15 kg savings): **exposed carbon-weave** [V press] on the **front lid, roof, upper mirror shells**, front window triangle trim, front airblades and rear-wing parts (endplates/upper element) [S]; forged **magnesium centre-lock wheels** (Satin Neodyme / Satin Black / painted colours) [V]; CFRP anti-roll bars, coupling rods, rear shear panel (invisible); CFRP bolted rollover bar (option); magnesium PDK paddles; "Weissach" logo on headrests, cup-holder bezel, dash passenger side; carbon interior door handles; Race-Tex dash top; reduced carpet. Weissach carbon is a clear-coated twill weave, fairly glossy on the exterior; interior "carbon-weave finish" is satin [U].
- **Side/accent decals** ("Accent package"/Tribute-to-Carrera-RS style) [S]: a two-tone stripe running the length of both sides low on the body (front fender -> door -> rear fender, above the sills) with "GT3 RS" script; a "GT3 RS" decal on the rear bumper; **PORSCHE lettering** on the wing/spoiler; "Weissach RS" lettering on the endplates. Accent colours: silver, Guards Red, Racing Yellow, Python Green, Indigo Blue, Neodyme, etc. Example: white car + Python Green stripes + green mirror caps + green mag wheels + black calipers (Tribute to Carrera RS Package) [V newsroom]. Exact stripe path/width is [U].
- Door-sill guards: carbon (CFRP) with "GT3 RS" script, some illuminated.
- Typical press cars: Weissach in Arctic Grey/Ice Grey/White with Satin Neodyme or black mag wheels, **yellow PCCB calipers**, black wing/splitter/roof fins; or Guards Red with red or white stripes.

### 5.3 Material/finish map
| Area | Finish |
|---|---|
| Body panels | gloss clear-coated paint (flake for metallics); CFRP panels painted to match |
| Roof | body-colour gloss (standard) / exposed glossy carbon (Weissach) |
| Front lid | body-colour (standard) / exposed carbon with painted side edges (Weissach) [U] |
| Splitter, side blades, front flap elements, roof fins, side skirt blades, diffuser | **matte/satin black** plastic or carbon (some visible weave) |
| Rear wing (main, flap, swan-neck struts) | satin/gloss black CFRP (Weissach: carbon-weave on endplates / upper parts); PORSCHE + RS lettering in accent |
| Endplates | black; carbon on Weissach |
| Mirror bases/stalks | satin-gloss black; top shells body colour / carbon; lower covers body colour or black |
| Window frames, headlamp bezels, fender louvres, lid vent slats, rear grille | black (gloss/satin) |
| Exhaust tips | black (satin/black-chrome) stainless |
| Wheels | satin/matte forged metal (Neodyme = bronze-gold, Black, Platinum); centre nut black with silver "RS"; tyres matte black rubber with raised lettering |
| Brake discs | dark grey cast iron with dimples (PCCB: black ceramic with cross-drilled look); calipers gloss red (std) or yellow (PCCB), black optional |
| Interior | Race-Tex (matte black micro-fibre), leather bolsters (black, silver stitch), satin carbon-weave inlays, brushed dark-silver switches, anodised dark-silver paddles, red/yellow/silver belts and tach dial accent |

---------------------------------------------------------------------------------------------------------------

## 6. THE 25 MOST RECOGNISABLE VISUAL CUES OF A 992 GT3 RS (priority order)

1. **Giant swan-neck, two-element rear wing whose top edge stands above the roofline** (roof ~1.28, wing top 1.322), spanning nearly the whole tail.
2. Wing hangs from **two thick carbon swan-neck uprights** (attached from above), with big multi-part **endplates**; visible upper **DRS flap** with hydraulic gap.
3. **Two large L-shaped/boomerang louvred outlets ("nostrils") in the CFRP front lid**, with deflector fins throwing air sideways; no frunk.
4. **Very wide, flat, low stance** - 1.90 m Turbo-width body, tyres nearly flush with the fender edges, rear haunches bulging.
5. **Black front splitter** with side blades and **active flap elements in the outer bumper corners**; wide central lower grille.
6. **Louvred vents on the top of each front fender** behind the wheel arch (crests higher than the centre of the lid).
7. **Centre-lock forged 10-spoke wheels**: 20 in front (10J) vs **21 in rear (13J)**, black nut with silver RS; satin finishes (often Neodyme/Black).
8. **Huge staggered tyres** 275/35-20 and 335/30-21 (Michelin Pilot Sport Cup 2 R), rear visibly fatter.
9. **Big 6-piston monobloc calipers - red (standard) or yellow (PCCB)** through the spokes.
10. **Scalloped door front (deep-draw inset) + vertical blades/inlets behind the front wheels**, side indicators on the blades.
11. **Two black roof fins** at the rear of the roof; roof carbon (Weissach) or body colour.
12. **Exposed carbon lid and roof, carbon mirror shells (Weissach)**, satin/gloss twill weave against painted body.
13. **Full-width LED tail-light bar** with PORSCHE lettering; dark red lens.
14. **Two central black exhaust tips** inside a deep, finned, enclosed diffuser under a black bumper insert.
15. **Rear fender-front intakes (Turbo-style) behind the doors** with a blade - aero only; plus a side blade at the rear arch.
16. **LED headlights with black bezels and 4-point DRL**; round lamps sitting on the fender crests.
17. **Duck-tail lip at the rear of the engine lid** with engine-air grilles under the wing.
18. **Side stripes + "GT3 RS" script and Weissach RS lettering** in accent colour (RS 2.7 homage).
19. **Motorsport-style mirrors** on satin-black stalks with carbon/body-colour top shell.
20. **Frameless, tinted lightweight glass with black trim; small triangular window at mirror base; long low rear quarter glass; long fastback roof.**
21. **Black lower side-skirt blade and flat, fully panelled underbody**; very low lip (~0.10 m).
22. **CFRP full bucket seats** with Race-Tex centres, "GT3 RS" headrest embroidery, harness slots.
23. **Steering wheel with four small rotary dials and a DRS button**, yellow top marker; analogue tach flanked by two 7-inch screens with yellow shift bars.
24. **No rear seats; rollover bar (Clubsport: steel; Weissach: carbon-weave) behind the seats**; door pull loops and net pockets.
25. **Small race-car details**: teardrop (aero) front wishbones visible behind the spokes, black window frames and fender-lip trim, yellow/red harness and dial accents, Porsche crest small on the lid nose.

---------------------------------------------------------------------------------------------------------------

## 7. SOURCES

Official Porsche (highest weight)
- Technical data GT3 RS, MY P 08/2022 (PDF): https://newsroom.porsche.com/dam/jcr:1d390f77-93c3-49c0-89c7-634f5f02b26a/S22_3515_en.pdf
- The new Porsche 911 GT3 RS (992) Press Kit: https://newsroom.porsche.com/dam/jcr:46a23375-e7ee-4507-a577-d9761b784d33/992%20911%20GT3%20RS%20Press%20Kit%201.pdf
- The new 911 GT3 (992) Press Kit (for GT3 baseline): https://newsroom.porsche.com/dam/jcr:fe2fb6d3-d0e3-44d8-8f2d-d82a66674718/PAG-911-GT3-RS-EN.pdf
- Porsche Newsroom, "Purpose-built for performance: the new Porsche 911 GT3 RS" (EN / USA / AUS): https://newsroom.porsche.com/en/2022/products/porsche-911-gt3-rs-world-premiere-29177.html , https://newsroom.porsche.com/en_US/2022/products/porsche-911-gt3-rs-world-premiere-29439.html
- Porsche, 911 GT3 RS model page: https://www.porsche.com/international/models/911/911-gt3-rs/911-gt3-rs/
- Porsche Newsroom, 911 GT3 with Touring package: https://newsroom.porsche.com/en/2021/products/porsche-911-gt3-touring-package-premiere-24794.html
- Porsche Newsroom, Tribute to Carrera RS Package: https://newsroom.porsche.com/en_US/2022/products/celebration-of-an-icon-911-gt3-rs-tribute-to-carrera-rs-package-announced-30130.html
- Porsche Newsroom, 911 GT3 RS Sonderwunsch (Macadamia): https://newsroom.porsche.com/en/2026/products/porsche-gt3-rs-sonderwunsch-macadamia-metallic-42032.html
- Porsche stories, "The Porsche 911 GT3 RS: your questions answered": https://www.porsche.com/stories/innovation/eight-things-you-need-to-know-about-the-911-gt3/

Press / technical journalism
- Excellence magazine #299, "992 GT3 & GT3 RS Aero Tech": https://www.excellence-mag.com/issues/299/articles/992-gt3-gt3-rs-aero-tech
- PCA, "How the most aerodynamically aggressive Porsche in history earned its wing": https://www.pca.org/news/how-the-most-aerodynamically-aggressive-porsche-in-history-earned-its-wing
- PCA, "Porsche's new 911 GT3 RS is all about aero and hyper-adjustability": https://www.pca.org/news/porsches-new-911-gt3-rs-is-all-about-aero-hyper-adjustability
- The Drive, "2023 Porsche 911 GT3 RS adds a wild DRS-style rear wing": https://www.thedrive.com/news/2023-porsche-911-gt3rs-specs-debut-reveal-price
- The Drive first drive: https://www.thedrive.com/new-cars/2023-porsche-911-gt3-rs-first-drive-review-price-info-specs-pics
- Jalopnik feature summary: https://www.jalopnik.com/2023-porsche-911-gt3-rs-performance-features-explained-1849612711/
- GTSpirit, "Official: 2023 992 Porsche GT3 RS": https://gtspirit.com/2022/08/17/official-2023-992-porsche-gt3-rs/
- Motorheads, "In-depth look at the advanced aerodynamics...": https://www.motorheads.com/features/an-in-depth-look-at-the-advanced-aerodynamics-of-the-porsche-911-gt3-rs-ar6641/
- TorqueNews, aero summary: https://www.torquenews.com/15975/new-porsche-911-gt3-rs-comes-every-aero-trick-book
- duPont Registry, 992 GT3 RS review: https://news.dupontregistry.com/blogs/porsche-news/992-porsche-911-gt3-rs-price-specs-photos-review
- Supercars.net GT3 guide: https://www.supercars.net/blog/2022-porsche-911-gt3-ultimate-guide/
- CarThrottle prototype wing: https://www.carthrottle.com/post/look-at-the-enormous-wing-on-this-992-porsche-911-gt3-rs-prototype/
- JCR Developments 992 GT3 RS project (roof strakes, dive planes, aero parts): https://jcr-developments.com/blogs/news/992-gt3-rs-project-instalment-03-aerodynamics
- Carscoops / autoevolution / SEMA (992.2 facelift spy info): https://www.carscoops.com/2026/06/porsche-911-gt3-rs-facelift/

Spec databases / reference
- Wikipedia: https://en.wikipedia.org/wiki/Porsche_911_(992) , https://en.wikipedia.org/wiki/Porsche_911_GT3
- auto-data (GT3 RS): https://www.auto-data.net/en/porsche-911-992-gt3-rs-4.0-525hp-pdk-46354 ; (GT3): https://www.auto-data.net/en/porsche-911-992-gt3-4.0-510hp-42481
- ultimatespecs (GT3 RS): https://www.ultimatespecs.com/car-specs/Porsche/133740/Porsche-911-Coupe-(9921-Series)-GT3-RS.html ; (GT3): https://www.ultimatespecs.com/car-specs/Porsche/125711/Porsche-911-Coupe-(9921-Series)-GT3.html
- FMB Wheels GT3 RS 992.1 fitment guide (wheel/tyre/brake data): https://fmbwheels.com/porsche-911-gt3-rs-992-1-2023-2025-wheel-fitment-guide/
- Apex Wheels 992.1 GT3RS guide: https://apexwheels.com/fitment-guides/porsche/911/porsche-911-9921-gt3rs-wheel-and-tire-fitment-guide
- Tiresize.com Michelin PS Cup 2 R 275/35R20: https://tiresize.com/tires/Michelin/Pilot-Sport-Cup-2-R-275-35R20.htm
- carpaints.co GT3 RS 992.1 colours: https://www.carpaints.co/cars/model/porsche-911-gt3-rs-992-1
- Rennbow Porsche colour wiki (Shark Blue / Arctic Grey): https://www.rennbow.org/porsche-colors/SharkBlue , https://www.rennbow.org/porsche-colors/Arctic%20Grey
- Exotic Car Colors (Python Green swatch): https://exoticcarcolors.com/car-color/python-green
- PCARMARKET 2024 GT3 RS Weissach listing (equipment detail): https://www.pcarmarket.com/auction/2024-porsche-911-gt3-rs-4/
- Stuttcars GT3 RS 992 buyer's guide: https://www.stuttcars.com/porsche-911-gt3-rs-992-ultimate-buyers-guide/

Sources that could not be read (blocked/paywalled): Rennlist threads ("Height of GT3RS vs GT3", "Dimension 992 GT3 RS wing") returned 403 - facts quoted from search snippets only
([S] and flagged); carfolio, autoevolution spec page, topgear.com, caranddriver.com, Motor Trend, Car Magazine were unreachable, so overhang split, exact wing size, roof height,
side-profile heights and all fine geometry of the lid vents, fender louvres, roof fins, endplates, steering-wheel layout and stripe path remain estimates/recollection.

---------------------------------------------------------------------------------------------------------------

## 8. OPEN UNCERTAINTIES (highest value to verify with a real photo silhouette/turntable if one ever becomes available)
1. Exact roof peak (1.275-1.285?) and whether Porsche's 1.322 m is measured with the flap flat (assumed) or raised.
2. Wing chord/span/endplate outline and the exact swan-neck attachment (top surface of main element, assumed).
3. Precise shape and position of hood outlets (L/boomerang), fender louvre panel, roof fins, rear fender intakes.
4. Front/rear overhang split (1.00/1.115 assumed; spec.js 1.027/1.088 is within tolerance).
5. Standard side-stripe/decal path; whether RS tow-hook cap and fuel-flap are visible.
6. Caliper placement (leading vs trailing) on each axle.
