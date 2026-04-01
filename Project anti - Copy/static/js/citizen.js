// ─────────────────────────────────────────────────────────────
// Citizen App — Living City  (fully fixed edition)
// Fixes: reliable div car markers, smooth stop/go, rerouting,
//        dismiss button, no disappearing cars
// ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

    // ── CITY GRID CONSTANTS (must match buildCity values) ─────
    const LAT0 = 41.896, LNG0 = -87.658, DLAT = 0.004, DLNG = 0.005;
    const ROWS = 7, COLS = 7;
    const COL_LABELS = ['A','B','C','D','E','F','G'];

    // ── ROUTE PICKER STATE ────────────────────────────────────
    let pickerStartId = null, pickerEndId = null;
    let citPickerMode = 'start';

    const citPickerEl   = document.getElementById('cit-picker');
    const citNodeGrid   = document.getElementById('cit-node-grid');
    const citStartChip  = document.getElementById('cit-chip-start');
    const citEndChip    = document.getElementById('cit-chip-end');
    const citStartVal   = document.getElementById('cit-start-val');
    const citEndVal     = document.getElementById('cit-end-val');
    const citGoBtn      = document.getElementById('cit-go-btn');
    const citDispatch   = document.getElementById('cit-dispatch');
    const citModeS      = document.getElementById('cit-mode-s');
    const citModeE      = document.getElementById('cit-mode-e');
    const citPhint      = document.getElementById('cit-phint');
    const citPTitle     = document.getElementById('cit-picker-title');
    const citPClose     = document.getElementById('cit-pclose');

    // selectNode: called when user taps a grid button in the picker
    function selectNode(id, lbl) {
        citNodeGrid.querySelectorAll('.cit-nd-btn').forEach(b => {
            if (citPickerMode === 'start') b.classList.remove('csel-s');
            else                           b.classList.remove('csel-e');
        });
        citNodeGrid.querySelector(`[data-node-id="${id}"]`)?.classList.add(
            citPickerMode === 'start' ? 'csel-s' : 'csel-e'
        );
        if (citPickerMode === 'start') {
            pickerStartId = id;
            citStartVal.textContent = lbl;
            // Clear "tap to set" hint
            const sh = citStartChip.querySelector('.cn-hint');
            if (sh) sh.textContent = '';
            setCitMode('end');
        } else {
            pickerEndId = id;
            citEndVal.textContent = lbl;
            const eh = citEndChip.querySelector('.cn-hint');
            if (eh) eh.textContent = '';
        }
        const ready = pickerStartId && pickerEndId && pickerStartId !== pickerEndId;
        citDispatch.disabled = !ready;
        citGoBtn.disabled    = !ready;
    }

    // Build 7×7 grid buttons (A1..G7)
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const id  = `${r}_${c}`;
            const lbl = `${COL_LABELS[c]}${r + 1}`;
            const btn = document.createElement('button');
            btn.className      = 'cit-nd-btn';
            btn.dataset.nodeId = id;
            btn.dataset.label  = lbl;
            btn.textContent    = lbl;
            btn.addEventListener('click', () => selectNode(id, lbl));
            citNodeGrid.appendChild(btn);
        }
    }

    function setCitMode(mode) {
        citPickerMode = mode;
        citModeS.classList.toggle('cs', mode === 'start');
        citModeS.classList.remove('ce');
        citModeE.classList.toggle('ce', mode === 'end');
        citModeE.classList.remove('cs');
        citPhint.innerHTML = mode === 'start'
            ? 'Tap a node to set as <b>Start</b>'
            : 'Tap a node to set as <b>Destination</b>';
        citPTitle.textContent = mode === 'start' ? 'Set Start Node' : 'Set Destination Node';
    }

    function openCitPicker(mode) {
        setCitMode(mode);
        citPickerEl.classList.add('active');
        if (simIv) { clearInterval(simIv); simIv = null; }
    }
    function closeCitPicker() { citPickerEl.classList.remove('active'); }

    citStartChip.addEventListener('click', () => openCitPicker('start'));
    citEndChip.addEventListener('click',   () => openCitPicker('end'));
    citModeS.addEventListener('click',     () => setCitMode('start'));
    citModeE.addEventListener('click',     () => setCitMode('end'));
    citPClose.addEventListener('click',    closeCitPicker);
    citPickerEl.addEventListener('click', e => { if (e.target === citPickerEl) closeCitPicker(); });

    function doNavDispatch() {
        closeCitPicker();
        // runSim will pick up pickerStartId / pickerEndId
        runSim();
    }
    citDispatch.addEventListener('click', doNavDispatch);
    citGoBtn.addEventListener('click',    doNavDispatch);

    // Helper: node id → LatLng on the city grid
    function nodeToLatLng(id) {
        const [r, c] = id.split('_').map(Number);
        return L.latLng(LAT0 - r * DLAT, LNG0 + c * DLNG);
    }

    // ── MAP ──────────────────────────────────────────────────
    const map = L.map('citizen-map', {
        zoomControl: true,          // show zoom controls
        dragging: true,             // user can pan freely
        scrollWheelZoom: true,      // mouse wheel zoom
        touchZoom: true             // pinch zoom on mobile
    }).setView([41.880, -87.636], 15);

    let cameraFollow = true;  // always tracking by default
    let dragCooldown = null;
    map.on('dragstart', () => {
        cameraFollow = false;
        if (dragCooldown) clearTimeout(dragCooldown);
        followBtn.innerHTML = '🔓 Free';
        followBtn.style.color = '#94a3b8';
        followBtn.style.borderColor = 'rgba(255,255,255,0.1)';
    });
    // Re-enable tracking 1 second after user stops dragging
    map.on('dragend', () => {
        if (dragCooldown) clearTimeout(dragCooldown);
        dragCooldown = setTimeout(() => {
            cameraFollow = true;
            followBtn.innerHTML = '📍 Follow';
            followBtn.style.color = '#60a5fa';
            followBtn.style.borderColor = 'rgba(59,130,246,0.4)';
        }, 1000);
    });

    // Small "Follow Car" toggle button overlaid on the map
    const followBtn = document.createElement('button');
    followBtn.id = 'follow-toggle';
    followBtn.title = 'Toggle camera follow';
    followBtn.innerHTML = '📍 Follow';
    Object.assign(followBtn.style, {
        position:'absolute', bottom:'180px', right:'14px', zIndex:'2000',
        background:'rgba(15,23,42,0.9)', color:'#60a5fa', border:'1px solid rgba(59,130,246,0.4)',
        borderRadius:'10px', padding:'6px 12px', fontSize:'12px', fontWeight:'700',
        cursor:'pointer', backdropFilter:'blur(10px)', boxShadow:'0 2px 12px rgba(0,0,0,0.5)'
    });
    followBtn.addEventListener('click', () => {
        cameraFollow = !cameraFollow;
        followBtn.style.color  = cameraFollow ? '#60a5fa' : '#94a3b8';
        followBtn.style.borderColor = cameraFollow ? 'rgba(59,130,246,0.4)' : 'rgba(255,255,255,0.1)';
        followBtn.innerHTML = cameraFollow ? '📍 Follow' : '🔓 Free';
    });
    document.querySelector('.citizen-app').appendChild(followBtn);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png', {
        maxZoom: 20, attribution: ''
    }).addTo(map);

    // ── DOM ──────────────────────────────────────────────────
    const destEl      = document.getElementById('route-dest');
    const streetEl    = document.getElementById('route-street');
    const speedEl     = document.getElementById('cit-speed');
    const etaEl       = document.getElementById('cit-eta');
    const distEl      = document.getElementById('cit-dist');
    const yieldCard   = document.getElementById('yield-card');
    const bottomBar   = document.getElementById('bottom-stats');
    const safeToast   = document.getElementById('safe-toast');
    const rerouteToast= document.getElementById('reroute-toast');
    const rerouteMsg  = document.getElementById('reroute-msg');
    const dismissBtn  = document.getElementById('dismiss-btn');
    const evDistEl    = document.getElementById('ev-distance');
    const evDirEl     = document.getElementById('ev-direction');

    // ── DISMISS BUTTON ───────────────────────────────────────
    // Single click dismisses; hold (500ms) also dismisses
    let dismissHold = null;
    dismissBtn.addEventListener('click', () => {
        yieldCard.classList.remove('active');
        bottomBar.classList.remove('hidden');
    });
    dismissBtn.addEventListener('pointerdown', () => {
        dismissHold = setTimeout(() => {
            yieldCard.classList.remove('active');
            bottomBar.classList.remove('hidden');
        }, 500);
    });
    dismissBtn.addEventListener('pointerup',   () => clearTimeout(dismissHold));
    dismissBtn.addEventListener('pointerleave',() => clearTimeout(dismissHold));

    // ── MAP LAYERS ───────────────────────────────────────────
    let mapLayers = [];
    const drop = () => {
        mapLayers.forEach(l => { if (l && l.remove) l.remove(); else if (l) map.removeLayer(l); });
        mapLayers = [];
    };

    // ── CAR ICON BUILDER (pure CSS div — works everywhere) ──
    // The div rectangle faces RIGHT (East = 0°). Rotation applied via CSS.
    function carDiv(bg, glow, size = 28) {
        return `
        <div style="
            width:${size}px; height:${Math.round(size*0.52)}px;
            background:${bg};
            border-radius:${Math.round(size*0.18)}px;
            border:2px solid rgba(255,255,255,0.6);
            box-shadow:0 0 ${size*0.5}px ${glow}, inset 0 1px 2px rgba(255,255,255,0.3);
            position:relative;
        ">
            <!-- headlights -->
            <div style="position:absolute;right:1px;top:2px;width:5px;height:4px;background:#fef08a;border-radius:2px;opacity:0.95;"></div>
            <div style="position:absolute;right:1px;bottom:2px;width:5px;height:4px;background:#fef08a;border-radius:2px;opacity:0.95;"></div>
            <!-- tail lights -->
            <div style="position:absolute;left:1px;top:2px;width:4px;height:3px;background:#ef4444;border-radius:1px;opacity:0.85;"></div>
            <div style="position:absolute;left:1px;bottom:2px;width:4px;height:3px;background:#ef4444;border-radius:1px;opacity:0.85;"></div>
        </div>`;
    }

    function ambulanceDiv(size = 34) {
        return `
        <div style="
            width:${size}px; height:${Math.round(size*0.55)}px;
            background:#dc2626;
            border-radius:${Math.round(size*0.15)}px;
            border:2px solid rgba(255,255,255,0.7);
            box-shadow:0 0 ${size*0.7}px rgba(239,68,68,0.8), inset 0 1px 2px rgba(255,255,255,0.3);
            position:relative;
        ">
            <!-- white cross -->
            <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:${Math.round(size*0.35)}px;height:4px;background:white;border-radius:2px;"></div>
            <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:4px;height:${Math.round(size*0.35)}px;background:white;border-radius:2px;"></div>
            <!-- headlights -->
            <div style="position:absolute;right:1px;top:3px;width:6px;height:4px;background:#fef9c3;border-radius:2px;opacity:0.95;box-shadow:0 0 6px #fef9c3;"></div>
            <div style="position:absolute;right:1px;bottom:3px;width:6px;height:4px;background:#fef9c3;border-radius:2px;opacity:0.95;box-shadow:0 0 6px #fef9c3;"></div>
            <!-- siren -->
            <div style="position:absolute;left:45%;top:-5px;transform:translateX(-50%);width:8px;height:5px;background:#60a5fa;border-radius:2px;box-shadow:0 0 8px #60a5fa;"></div>
        </div>`;
    }

    // Wraps the inner HTML in a rotated container
    function rotatedIcon(innerHtml, deg, size, anchor) {
        const w = size[0], h = size[1];
        const html = `<div style="transform:rotate(${deg}deg);transform-origin:${w/2}px ${h/2}px;width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center;">${innerHtml}</div>`;
        return L.divIcon({ html, className:'', iconSize: size, iconAnchor: anchor });
    }

    // ── MATH ─────────────────────────────────────────────────
    // Returns degrees: 0° = East, 90° = South
    function bearing(a, b) {
        const dx = b.lng - a.lng;
        const dy = a.lat - b.lat;   // screen Y inverted
        return Math.atan2(dy, dx) * 180 / Math.PI;
    }

    function compass(from, to) {
        const dLat = to.lat - from.lat, dLng = to.lng - from.lng;
        return Math.abs(dLng) > Math.abs(dLat)
            ? (dLng > 0 ? 'East' : 'West')
            : (dLat > 0 ? 'North' : 'South');
    }

    // Linear interpolation along a polyline → array of LatLng
    function lerpPath(coords, steps) {
        const pts = [];
        for (let i = 0; i < coords.length - 1; i++) {
            const a = coords[i], b = coords[i + 1];
            for (let s = 0; s <= steps; s++) {
                const t = s / steps;
                pts.push(L.latLng(a.lat + (b.lat - a.lat)*t, a.lng + (b.lng - a.lng)*t));
            }
        }
        return pts;
    }

    // ── CITY GRID (2-lane roads with dividers) ────────────────
    // Grid constants declared at top of file (shared with picker)
    // LANE = how far each car sits from center line on its right-hand side
    const LANE = 0.00028;  // ~25m offset — one lane width

    function buildCity() {
        // Each road: just asphalt base + yellow center divider (fewer polylines = faster)
        for (let r = 0; r < ROWS; r++) {
            const lat = LAT0 - r * DLAT;
            mapLayers.push(L.polyline([[lat, LNG0],[lat, LNG0+COLS*DLNG]], {color:'#18202e', weight:28, opacity:1}).addTo(map));
            mapLayers.push(L.polyline([[lat, LNG0],[lat, LNG0+COLS*DLNG]], {color:'#ca8a04', weight:1.5, opacity:0.65}).addTo(map));
        }
        for (let c = 0; c < COLS; c++) {
            const lng = LNG0 + c * DLNG;
            mapLayers.push(L.polyline([[LAT0, lng],[LAT0-ROWS*DLAT, lng]], {color:'#18202e', weight:28, opacity:1}).addTo(map));
            mapLayers.push(L.polyline([[LAT0, lng],[LAT0-ROWS*DLAT, lng]], {color:'#ca8a04', weight:1.5, opacity:0.65}).addTo(map));
        }
        // Traffic lights — simple dot only
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const lat = LAT0 - r * DLAT, lng = LNG0 + c * DLNG;
                const red = (r + c) % 2 === 0;
                const tlHtml = `<div style="width:9px;height:9px;border-radius:50%;background:${red?'#ef4444':'#22c55e'};box-shadow:0 0 6px ${red?'#ef4444':'#22c55e'};"></div>`;
                const tl = L.marker([lat, lng], { icon: L.divIcon({ html: tlHtml, className:'', iconSize:[9,9], iconAnchor:[4,4] }) }).addTo(map);
                mapLayers.push(tl);
                const iv = setInterval(() => {
                    const cur = tl.getElement()?.querySelector('div');
                    if (!cur) return;
                    const isRed = cur.style.background.includes('68,68');
                    const nc = isRed ? '#22c55e' : '#ef4444';
                    cur.style.background = nc; cur.style.boxShadow = `0 0 6px ${nc}`;
                }, 9000 + Math.random() * 5000);
                mapLayers.push({ remove: () => clearInterval(iv) });
            }
        }
    }

    // ── AMBIENT NPC CARS ─────────────────────────────────────
    const NPC_PALETTE = ['#8b5cf6','#f59e0b','#10b981','#ec4899','#6366f1','#0ea5e9'];

    function spawnAmbient() {
        // 8 NPC cars in correct right-hand lanes
        const routes = [
            [[LAT0-DLAT*1-LANE, LNG0+DLNG*0.3],            [LAT0-DLAT*1-LANE, LNG0+COLS*DLNG-DLNG*0.3]],
            [[LAT0-DLAT*3+LANE, LNG0+COLS*DLNG-DLNG*0.3],  [LAT0-DLAT*3+LANE, LNG0+DLNG*0.3]],
            [[LAT0-DLAT*5-LANE, LNG0+DLNG*0.3],            [LAT0-DLAT*5-LANE, LNG0+COLS*DLNG-DLNG*0.3]],
            [[LAT0-DLAT*2+LANE, LNG0+COLS*DLNG-DLNG*0.3],  [LAT0-DLAT*2+LANE, LNG0+DLNG*0.3]],
            [[LAT0-DLAT*6+LANE, LNG0+COLS*DLNG-DLNG*0.3],  [LAT0-DLAT*6+LANE, LNG0+DLNG*0.3]],
            [[LAT0-DLAT*0.3,            LNG0+DLNG*1+LANE],  [LAT0-ROWS*DLAT+DLAT*0.3, LNG0+DLNG*1+LANE]],
            [[LAT0-DLAT*0.3,            LNG0+DLNG*4+LANE],  [LAT0-ROWS*DLAT+DLAT*0.3, LNG0+DLNG*4+LANE]],
            [[LAT0-ROWS*DLAT+DLAT*0.3,  LNG0+DLNG*2-LANE],  [LAT0-DLAT*0.3, LNG0+DLNG*2-LANE]],
            [[LAT0-ROWS*DLAT+DLAT*0.3,  LNG0+DLNG*5-LANE],  [LAT0-DLAT*0.3, LNG0+DLNG*5-LANE]],
        ];
        routes.forEach((raw, idx) => {
            const color = NPC_PALETTE[idx % NPC_PALETTE.length];
            const pts   = lerpPath(raw.map(p => L.latLng(p[0], p[1])), 200);
            const IS    = [24, 13];
            let step    = Math.floor(Math.random() * pts.length);
            let curDeg  = 0;
            const m = L.marker(pts[step], {
                icon: rotatedIcon(carDiv(color, color+'88', 22), curDeg, IS, [IS[0]/2, IS[1]/2])
            }).addTo(map);
            mapLayers.push(m);
            const iv = setInterval(() => {
                step = (step + 5) % pts.length;
                const cur = pts[step];
                const nxt = pts[(step + 10) % pts.length];
                const deg = -bearing(cur, nxt);
                if (Math.abs(deg - curDeg) > 4) {
                    curDeg = deg;
                    m.setIcon(rotatedIcon(carDiv(color, color+'88', 22), deg, IS, [IS[0]/2,IS[1]/2]));
                }
                m.setLatLng(cur);
            }, 120);
            mapLayers.push({ remove: () => clearInterval(iv) });
        });
    }

    // ── MAIN SIMULATION ──────────────────────────────────────
    let simIv = null;

    const runSim = () => {
        if (simIv) { clearInterval(simIv); simIv = null; }
        drop();

        yieldCard.classList.remove('active');
        bottomBar.classList.remove('hidden');
        safeToast.classList.remove('active');
        rerouteToast.classList.remove('active');

        buildCity();
        spawnAmbient();

        // ── Route geometry ──────────────────────────────────
        const intLat = LAT0 - DLAT * 3;
        const intLng = LNG0 + DLNG * 3;

        // Citizen path: use picker nodes if set, else default route
        let cWP;
        if (pickerStartId && pickerEndId && pickerStartId !== pickerEndId) {
            const sLL = nodeToLatLng(pickerStartId);
            const eLL = nodeToLatLng(pickerEndId);
            
            const isEast = (eLL.lng >= sLL.lng);
            const isSouth = (eLL.lat <= sLL.lat);
            
            const hOffset = isEast ? -LANE : LANE;
            const vOffset = isSouth ? -LANE : LANE;
            
            cWP = [
                L.latLng(sLL.lat + hOffset, sLL.lng),
                L.latLng(sLL.lat + hOffset, eLL.lng + vOffset),
                L.latLng(eLL.lat, eLL.lng + vOffset)
            ];
            document.getElementById('route-dest').textContent   = '-> ' + citEndVal.textContent;
            document.getElementById('route-street').textContent = 'From ' + citStartVal.textContent;
        } else {
            cWP = [
                L.latLng(intLat - LANE, LNG0 + DLNG * 0.4),
                L.latLng(intLat - LANE, intLng - LANE),
                L.latLng(intLat - DLAT * 2.8, intLng - LANE)
            ];
        }
        const citizenPath = lerpPath(cWP, 500);

        // Alternate detour for ambulance: respects lane offsets
        const altWP = [
            L.latLng(intLat + LANE,        intLng - DLNG - LANE),    // West on North median
            L.latLng(intLat - DLAT - LANE, intLng - DLNG - LANE),    // South on West median
            L.latLng(intLat - DLAT - LANE, intLng - LANE),           // East on South median
            L.latLng(intLat - DLAT * 2.8,  intLng - LANE)            // Continue South
        ];

        // Emergency vehicle: going NORTH — right-hand lane = west side (lng - LANE)
        const eWP = [
            L.latLng(intLat - DLAT * 3.8, intLng - LANE),
            L.latLng(intLat + DLAT * 1.5,  intLng - LANE)
        ];
        const emergPath = lerpPath(eWP, 900);

        // ── Draw citizen route (blue) ──
        const cLine = L.polyline(cWP, { color:'#1d4ed8', weight:28, opacity:0.5 }).addTo(map);
        const cLineTop = L.polyline(cWP, { color:'#3b82f6', weight:5, opacity:0.85 }).addTo(map);
        mapLayers.push(cLine, cLineTop);

        let altLine = null, altLineTop = null;

        // Emergency preemption path (hidden initially)
        let eLine     = L.polyline(eWP, { color:'#22c55e', weight:6, dashArray:'12,10', opacity:0 }).addTo(map);
        let eLineGlow = L.polyline(eWP, { color:'#22c55e', weight:18, opacity:0 }).addTo(map);
        mapLayers.push(eLine, eLineGlow);

        // Destination dot
        const destDot = `<div style="background:#ef4444;width:14px;height:14px;border-radius:50%;border:3px solid white;box-shadow:0 0 12px #ef4444;"></div>`;
        mapLayers.push(L.marker(cWP[cWP.length-1], { icon: L.divIcon({ html:destDot, className:'', iconSize:[14,14], iconAnchor:[7,7] }) }).addTo(map));

        // ── Vehicle markers ──────────────────────────────────
        const CIT_SIZE  = [28, 16];
        const AMB_SIZE  = [34, 20];
        let cDeg = 0, eDeg = 0;

        const citM = L.marker(citizenPath[0], {
            icon: rotatedIcon(carDiv('#38bdf8','#38bdf888'), 0, CIT_SIZE, [CIT_SIZE[0]/2, CIT_SIZE[1]/2])
        }).addTo(map);
        mapLayers.push(citM);

        const emM = L.marker(emergPath[0], {
            icon:    rotatedIcon(ambulanceDiv(), 0, AMB_SIZE, [AMB_SIZE[0]/2, AMB_SIZE[1]/2]),
            opacity: 0
        }).addTo(map);
        mapLayers.push(emM);

        // ── Icon update helpers ──────────────────────────────
        function setCitIcon(from, to) {
            const d = -bearing(from, to);
            if (Math.abs(d - cDeg) > 2.5) {
                cDeg = d;
                citM.setIcon(rotatedIcon(carDiv('#38bdf8','#38bdf888'), d, CIT_SIZE, [CIT_SIZE[0]/2,CIT_SIZE[1]/2]));
            }
        }
        function setEmIcon(from, to) {
            const d = -bearing(from, to);
            if (Math.abs(d - eDeg) > 2.5) {
                eDeg = d;
                emM.setIcon(rotatedIcon(ambulanceDiv(), d, AMB_SIZE, [AMB_SIZE[0]/2,AMB_SIZE[1]/2]));
            }
        }

        // ── State ────────────────────────────────────────────
        // ═══════════════════════════════════════════
        //   TRAFFIC & ACCIDENT ON THE CITIZEN'S OWN ROAD
        // ═══════════════════════════════════════════

        // Place the blockage at ~38% along the citizen's path
        const blockRatio      = 0.38;
        const blockageStep    = Math.floor(citizenPath.length * blockRatio);
        const blockagePos     = citizenPath[blockageStep];
        
        // Voice Helper
        const speak = (text) => {
            if ('speechSynthesis' in window) {
                window.speechSynthesis.cancel();
                const utter = new SpeechSynthesisUtterance(text);
                utter.rate = 1.0;
                window.speechSynthesis.speak(utter);
            }
        };

        const detectStep = Math.floor(citizenPath.length * 0.10); // AI detects at 10% to give time to blink & route

        // Blocked NPC cars — stationary on the route
        const BCIS = [22, 12];
        const bc1  = L.marker(blockagePos, {
            icon: rotatedIcon(carDiv('#6b7280','#6b728066',20), 0, BCIS, [11,6])
        }).addTo(map);
        const bc2  = L.marker(L.latLng(blockagePos.lat, blockagePos.lng + 0.0005), {
            icon: rotatedIcon(carDiv('#9ca3af','#9ca3af66',20), 0, BCIS, [11,6])
        }).addTo(map);
        const bc3  = L.marker(L.latLng(blockagePos.lat, blockagePos.lng - 0.0004), {
            icon: rotatedIcon(carDiv('#78716c','#78716c66',20), 0, BCIS, [11,6])
        }).addTo(map);
        mapLayers.push(bc1, bc2, bc3);

        // Crash marker right on the route
        let crashM = null;
        const crashHtml = `<div style="font-size:26px;filter:drop-shadow(0 0 10px #ef4444);transform:translate(-50%,-50%);">&#128165;</div>`;
        setTimeout(() => {
            crashM = L.marker(blockagePos, {
                icon: L.divIcon({ html: crashHtml, className:'', iconSize:[26,26], iconAnchor:[13,13] })
            }).addTo(map);
            mapLayers.push(crashM);
            rerouteMsg.textContent = '🚧 Accident & traffic jam on your route!';
            rerouteToast.classList.add('active');
            speak('Accident and traffic jam on your route');
            setTimeout(() => rerouteToast.classList.remove('active'), 5000);
        }, 800);

        // ── Compute AI bypass detour around the blockage ──
        // Dynamically compute detour based on exact vector to strictly follow LANE laws
        const turnStep = Math.floor(citizenPath.length * 0.18);
        const turnPt   = citizenPath[turnStep];  // where we branch off
        const curDestPt = cWP[cWP.length - 1];

        const dx = blockagePos.lng - turnPt.lng;
        const dy = blockagePos.lat - turnPt.lat;
        const isEastWest = Math.abs(dx) > Math.abs(dy);

        let trafficDetourWP = [];
        const eDist = Math.abs(isEastWest ? dx : dy) + (isEastWest ? DLNG*1.2 : DLAT*1.2); 

        if (isEastWest) {
            const movingEast = dx > 0;
            // movingEast ? detour South : detour North
            const pLat = turnPt.lat + (movingEast ? -DLAT : DLAT);
            // Southbound lane = lng - LANE. Northbound lane = lng + LANE.
            const pLng = turnPt.lng + (movingEast ? -LANE : LANE); 

            trafficDetourWP = [
                turnPt,
                L.latLng(pLat, pLng),
                L.latLng(pLat, turnPt.lng + (movingEast ? eDist : -eDist)),
                L.latLng(turnPt.lat, turnPt.lng + (movingEast ? eDist : -eDist)),
                curDestPt
            ];
        } else {
            const movingNorth = dy > 0;
            // movingNorth ? detour East : detour West
            const pLng = turnPt.lng + (movingNorth ? DLNG : -DLNG);
            // Eastbound lane = lat - LANE. Westbound lane = lat + LANE.
            const pLat = turnPt.lat + (movingNorth ? -LANE : LANE);

            trafficDetourWP = [
                turnPt,
                L.latLng(pLat, pLng),
                L.latLng(turnPt.lat + (movingNorth ? eDist : -eDist), pLng),
                L.latLng(turnPt.lat + (movingNorth ? eDist : -eDist), turnPt.lng),
                curDestPt
            ];
        }
        const trafficDetourPath = lerpPath(trafficDetourWP, 500);

        // Visualise the detour (hidden until AI triggers)
        let tLine    = L.polyline(trafficDetourWP, { color:'#f59e0b', weight:22, opacity:0 }).addTo(map);
        let tLineTop = L.polyline(trafficDetourWP, { color:'#fbbf24', weight:4, opacity:0, dashArray:'10,6' }).addTo(map);
        mapLayers.push(tLine, tLineTop);

        let trafficRerouted = false;  // true once AI chooses the bypass

        destEl.innerText   = 'Heading to South District';
        streetEl.innerText = 'On W Madison St';

        let cStep = 0, eStep = 0, cSpeed = 0;
        let emergActive = false, yielding = false, cleared = false;
        let rerouted    = false;   // emergency vehicle reroute
        let activePath  = citizenPath;
        let yieldDismissed = false;
        let cardShowing    = false;

        // ✕ button: user explicitly dismisses — only then does the car resume
        const handleDismiss = () => {
            yieldDismissed = true;
            cardShowing    = false;
            yieldCard.classList.remove('active');
            bottomBar.classList.remove('hidden');
            streetEl.innerText = cleared ? 'Road cleared — resuming route' : 'On route';
            speak('Resuming route.');
            delete safeToast.dataset.shown;
        };
        dismissBtn.onclick = handleDismiss;

        // Find the step in citizenPath closest to intersection
        let intStep = 0;
        let minD = Infinity;
        for (let i = 0; i < citizenPath.length; i++) {
            const d = citizenPath[i].distanceTo(L.latLng(intLat, intLng));
            if (d < minD) { minD = d; intStep = i; }
        }

        let targetPan = activePath[0];


        // ── Tick ─────────────────────────────────────────────
        simIv = setInterval(() => {

            // ── AI TRAFFIC DETECTION: switch to bypass when approaching blockage ──
            if (!trafficRerouted && !rerouted && cStep >= detectStep) {
                trafficRerouted = true;
                // Brief slowdown + AI decision toast
                rerouteMsg.textContent = '🧠 AI: Traffic jam ahead — computing bypass route…';
                rerouteToast.classList.add('active');
                speak('AI detects traffic jam ahead. Computing bypass route.');
                setTimeout(() => rerouteToast.classList.remove('active'), 5500);
                // Reveal detour visually
                tLine.setStyle({ opacity: 0.45 });
                tLineTop.setStyle({ opacity: 0.95 });
                // Show second toast confirming decision
                setTimeout(() => {
                    rerouteMsg.textContent = '✅ Alternate route secured — bypassing incident';
                    rerouteToast.classList.add('active');
                    speak('Alternate route secured. Detouring via parallel road.');
                    setTimeout(() => rerouteToast.classList.remove('active'), 4000);
                    streetEl.innerText = 'Detouring via parallel road';
                    // Splice active path to stay perfectly on lanes
                    const remainingBeforeTurn = citizenPath.slice(cStep, turnStep);
                    activePath = remainingBeforeTurn.concat(trafficDetourPath);
                    cStep = 0;
                }, 2000);
            }

            // EMERGENCY VEHICLE
            if (!emergActive && cStep > intStep - 100 && !cleared) {
                emergActive = true;
                eLine.setStyle({ opacity: 0.8 });
                eLineGlow.setStyle({ opacity: 0.25 });
                emM.setOpacity(1);
            }

            if (emergActive && !cleared) {
                eStep += 14;
                const eIdx = Math.min(eStep, emergPath.length - 1);
                const ePos = emergPath[eIdx];
                const eNxt = emergPath[Math.min(eIdx + 10, emergPath.length - 1)];
                emM.setLatLng(ePos);
                setEmIcon(ePos, eNxt);

                const dToInt = ePos.distanceTo(L.latLng(intLat, intLng));
                if (dToInt < 280 && eStep < emergPath.length * 0.5) yielding = true;

                if (eStep >= emergPath.length) {
                    // Ambulance has fully driven off map — now we clean up
                    cleared = true;
                    yielding = false;
                    eLine.setStyle({ opacity: 0 }); eLineGlow.setStyle({ opacity: 0 });
                    map.removeLayer(emM); // remove only after full path complete
                    if (crashM) { map.removeLayer(crashM); crashM = null; }
                    // Show safe toast only after user dismisses yield card
                    if (yieldDismissed) {
                        safeToast.classList.add('active');
                        setTimeout(() => safeToast.classList.remove('active'), 4000);
                    }
                }
            }

            // CITIZEN VEHICLE
            if (cStep >= activePath.length) {
                clearInterval(simIv); simIv = null;
                destEl.innerText   = 'Arrived at Destination';
                streetEl.innerText = 'Navigation complete';
                speedEl.innerText  = '0'; etaEl.innerText = '0'; distEl.innerText = '0.0';
                setTimeout(runSim, 4000);
                return;
            }

            const cPos = activePath[cStep];

            // ── Decide whether car should be stopped ──────────
            // Car is stopped whenever yield card is visible AND user hasn't dismissed it
            const shouldStop = (yielding || (cleared && cardShowing)) && !yieldDismissed;

            if (yielding && !cardShowing && !yieldDismissed) {
                // First time the emergency triggers — show the card
                cardShowing = true;
                yieldCard.classList.add('active');
                bottomBar.classList.add('hidden');
                streetEl.innerText = 'STOP — Yielding to emergency vehicle';
                if ('vibrate' in navigator) navigator.vibrate([400,150,400,150,400]);
                speak('Emergency vehicle approaching. Please stop and give way.');

                // ── REROUTE: compute alternate detour once car slows down ──
                if (!rerouted) {
                    rerouted = true;
                    const curPos = activePath[cStep];
                    const newAltWP = [curPos, ...altWP];
                    const newAltPath = lerpPath(newAltWP, 600);
                    activePath = newAltPath;
                    cStep = 0;

                    if (altLine)    { map.removeLayer(altLine);    altLine    = null; }
                    if (altLineTop) { map.removeLayer(altLineTop); altLineTop = null; }
                    altLine    = L.polyline(newAltWP, { color:'#f59e0b', weight:20, opacity:0.4 }).addTo(map);
                    altLineTop = L.polyline(newAltWP, { color:'#facc15', weight:5,  opacity:0.9, dashArray:'10,6' }).addTo(map);
                    mapLayers.push(altLine, altLineTop);

                    rerouteMsg.textContent = '🔀 Safe detour calculated — press ✕ to resume';
                    rerouteToast.classList.add('active');
                    speak('Safe detour calculated. Press the X button to resume.');
                    setTimeout(() => rerouteToast.classList.remove('active'), 6000);
                }
            }

            // Live telemetry while card is visible
            if (cardShowing && !yieldDismissed && eStep < emergPath.length) {
                const evPos = emergPath[Math.min(eStep, emergPath.length - 1)];
                evDistEl.innerText = `${Math.round(cPos.distanceTo(evPos))} m`;
                evDirEl.innerText  = compass(cPos, evPos);
            }

            // After EV clears AND user dismisses — show safe toast
            if (cleared && yieldDismissed && !cardShowing) {
                // one-time safe signal
                if (!safeToast.classList.contains('active') && !safeToast.dataset.shown) {
                    safeToast.dataset.shown = '1';
                    safeToast.classList.add('active');
                    setTimeout(() => safeToast.classList.remove('active'), 4000);
                }
            }

            // Speed control — realistic city driving
            if (shouldStop) {
                cSpeed = Math.max(0, cSpeed - 4.0); // smooth brake
            } else {
                // Cruise at 35 mph, slow to 10 near destination
                const tgt = cStep > activePath.length - 35 ? 10 : 35 + Math.random() * 5;
                cSpeed += (tgt - cSpeed) * 0.06;
            }

            // MOVE CITIZEN CAR — realistic city pace
            if (cSpeed > 0.5) {
                const inc = Math.max(1, Math.round(cSpeed / 12));
                cStep = Math.min(cStep + inc, activePath.length - 1);
            }

            const cCur = activePath[Math.min(cStep, activePath.length - 1)];
            const cNxt = activePath[Math.min(cStep + 10, activePath.length - 1)];
            citM.setLatLng(cCur);         // always update — car never vanishes
            setCitIcon(cCur, cNxt);

            // Camera — tight tracking, snaps to car position on the lane
            if (cameraFollow) {
                targetPan = L.latLng(
                    targetPan.lat + (cCur.lat - targetPan.lat) * 0.12,
                    targetPan.lng + (cCur.lng - targetPan.lng) * 0.12
                );
                map.panTo(targetPan, { animate: false });
            }

            // HUD — real distance and ETA
            // Each path step ≈ DLAT degrees lat ÷ steps = tiny fraction; 1 deg lat ≈ 111km
            const stepsLeft = activePath.length - cStep;
            const metersLeft = stepsLeft * (DLAT * 111000 / 200); // approx meters per step
            const miLeft = metersLeft * 0.000621371;
            const speedMph = Math.max(1, cSpeed);
            const etaMins = (miLeft / speedMph) * 60;
            speedEl.innerText = Math.max(0, Math.round(cSpeed));
            distEl.innerText  = miLeft.toFixed(1);
            etaEl.innerText   = Math.max(1, Math.ceil(etaMins));

        }, 80);
    };

    // ── IDLE STATE: draw city and wait for user to pick a route ──
    buildCity();
    spawnAmbient();
    destEl.innerText   = 'Set your destination';
    streetEl.innerText = 'Tap Start & Destination below to begin';
});
