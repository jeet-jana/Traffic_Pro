// Autonomous Responder AI Grid Simulation with Dijkstra Pathfinding

document.addEventListener('DOMContentLoaded', () => {

    const map = L.map('responder-map', {
        zoomControl: true,
        dragging: true,
        scrollWheelZoom: true,
        touchZoom: true
    }).setView([41.882, -87.635], 16); // Set a bit wider for manual viewing

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png', {
        maxZoom: 20
    }).addTo(map);

    const hudTitle = document.getElementById('hud-title');
    const hudDesc = document.getElementById('hud-desc');
    const hudIcon = document.getElementById('hud-icon');
    const signalStatus = document.querySelector('.signal-status');
    const liveEta = document.getElementById('live-eta');
    const liveDist = document.getElementById('live-dist');
    const liveSpeed = document.getElementById('live-speed');
    const liveDest = document.getElementById('live-dest');

    let currentDriveInterval = null;
    let nextRunTimer = null;
    let manualStartNodeId = null;
    let manualEndNodeId   = null;

    // ── DOM refs for new Route Status Bar ──────────────────────
    const chipStartEl      = document.getElementById('chip-start');
    const chipEndEl        = document.getElementById('chip-end');
    const chipStartVal     = document.getElementById('chip-start-val');
    const chipEndVal       = document.getElementById('chip-end-val');
    const dispatchInline   = document.getElementById('dispatch-inline');
    const pickerOverlay    = document.getElementById('picker-overlay');
    const pickerClose      = document.getElementById('picker-close');
    const nodeGridEl       = document.getElementById('node-grid');
    const modeStartBtn     = document.getElementById('mode-start');
    const modeEndBtn       = document.getElementById('mode-end');
    const pickerHint       = document.getElementById('picker-hint');
    const pickerDispatch   = document.getElementById('picker-dispatch');
    const pickerTitle      = document.getElementById('picker-title');

    let pickerMode = 'start'; // 'start' | 'end'
    const COL_LABELS = ['A','B','C','D','E'];

    // Build 5×5 node buttons
    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
            const id  = `${r}_${c}`;
            const lbl = `${COL_LABELS[c]}${r + 1}`;
            const btn = document.createElement('button');
            btn.className      = 'nd-btn';
            btn.dataset.nodeId = id;
            btn.dataset.label  = lbl;
            btn.textContent    = lbl;
            btn.addEventListener('click', () => selectNode(id, lbl));
            nodeGridEl.appendChild(btn);
        }
    }

    function refreshNodeBtnStyles() {
        nodeGridEl.querySelectorAll('.nd-btn').forEach(b => {
            const id = b.dataset.nodeId;
            b.classList.remove('sel-start','sel-end','sel-both');
            const isStart = id === manualStartNodeId;
            const isEnd   = id === manualEndNodeId;
            if (isStart && isEnd) b.classList.add('sel-both');
            else if (isStart)     b.classList.add('sel-start');
            else if (isEnd)       b.classList.add('sel-end');
        });
    }

    function selectNode(id, lbl) {
        if (pickerMode === 'start') {
            manualStartNodeId = id;
            chipStartVal.textContent = lbl;
            // Auto-switch to end mode
            setPickerMode('end');
        } else {
            manualEndNodeId = id;
            chipEndVal.textContent = lbl;
        }
        refreshNodeBtnStyles();
        // Enable dispatch buttons when both set and different
        const ready = manualStartNodeId && manualEndNodeId && manualStartNodeId !== manualEndNodeId;
        pickerDispatch.disabled  = !ready;
        dispatchInline.disabled  = !ready;
    }

    function setPickerMode(mode) {
        pickerMode = mode;
        modeStartBtn.classList.toggle('sel-start', mode === 'start');
        modeStartBtn.classList.remove('sel-end');
        modeEndBtn.classList.toggle('sel-end',   mode === 'end');
        modeEndBtn.classList.remove('sel-start');
        pickerHint.innerHTML = mode === 'start'
            ? 'Tap a node to set as <b>Start</b>'
            : 'Tap a node to set as <b>Destination</b>';
        pickerTitle.textContent = mode === 'start' ? 'Set Start Node' : 'Set Destination Node';
    }

    function openPicker(mode) {
        setPickerMode(mode);
        refreshNodeBtnStyles();
        pickerDispatch.disabled = !(manualStartNodeId && manualEndNodeId && manualStartNodeId !== manualEndNodeId);
        pickerOverlay.classList.add('active');
        if (nextRunTimer) { clearTimeout(nextRunTimer); nextRunTimer = null; }
    }

    function closePicker() { pickerOverlay.classList.remove('active'); }

    // Chip taps open modal in correct mode
    chipStartEl.addEventListener('click', () => openPicker('start'));
    chipEndEl.addEventListener('click',   () => openPicker('end'));
    modeStartBtn.addEventListener('click', () => setPickerMode('start'));
    modeEndBtn.addEventListener('click',   () => setPickerMode('end'));
    pickerClose.addEventListener('click',  closePicker);
    pickerOverlay.addEventListener('click', e => { if (e.target === pickerOverlay) closePicker(); });

    function doDispatch() {
        closePicker();
        if (currentDriveInterval) clearInterval(currentDriveInterval);
        if (nextRunTimer)         clearTimeout(nextRunTimer);
        hudTitle.innerText = '🚑 Manual Dispatch';
        hudDesc.innerText  = `${chipStartVal.textContent} → ${chipEndVal.textContent} · Dijkstra routing…`;
        runAutonomousSimulation();
    }

    pickerDispatch.addEventListener('click', doDispatch);
    dispatchInline.addEventListener('click', doDispatch);

    // map click disabled (use status bar instead)
    map.on('click', () => {});

    let mapLayers = [];
    const clearLayers = () => {
        clearNPC();
        mapLayers.forEach(layer => map.removeLayer(layer));
        mapLayers = [];
    };

    // --- City Grid Graph Generation ---
    const GRID_SIZE = 5;
    const LAT_START = 41.889;
    const LNG_START = -87.645;
    const D_LAT = 0.0035; // Spacing
    const D_LNG = 0.0045; // Spacing
    const LANE  = 0.00025; // ~22m lane offset from center line

    // Bearing in degrees: 0=East, 90=South (for CSS rotate)
    function getBearing(a, b) {
        const dx = b.lng - a.lng;
        const dy = a.lat - b.lat; // screen Y inverted
        return Math.atan2(dy, dx) * 180 / Math.PI;
    }

    // NPC ambient car tracker
    let npcIntervals = [];
    const clearNPC = () => { npcIntervals.forEach(clearInterval); npcIntervals = []; };

    function buildCityGrid() {
        let nodes = [];
        let edges = [];

        // Create Nodes
        for(let r=0; r<GRID_SIZE; r++) {
            nodes[r] = [];
            for(let c=0; c<GRID_SIZE; c++) {
                nodes[r][c] = {
                    id: `${r}_${c}`,
                    r: r, c: c,
                    latlng: L.latLng(LAT_START - (r*D_LAT), LNG_START + (c*D_LNG)),
                    isSignal: Math.random() < 0.2 // 20% chance of an intersection having a dominant Red Signal
                };
            }
        }

        // Create Edges (Roads Connecting Nodes)
        for(let r=0; r<GRID_SIZE; r++) {
            for(let c=0; c<GRID_SIZE; c++) {
                // Connect Right
                if (c < GRID_SIZE - 1) {
                    let weight = 1;
                    let hasTraffic = Math.random() < 0.15; // 15% chance of severe traffic jam
                    if(hasTraffic) weight = 90; // Massively heavily traffic!
                    edges.push({ n1: nodes[r][c], n2: nodes[r][c+1], weight: weight, hasTraffic: hasTraffic });
                }
                // Connect Down
                if (r < GRID_SIZE - 1) {
                    let weight = 1;
                    let hasTraffic = Math.random() < 0.15; 
                    if(hasTraffic) weight = 90; 
                    edges.push({ n1: nodes[r][c], n2: nodes[r+1][c], weight: weight, hasTraffic: hasTraffic });
                }
            }
        }
        
        return { nodes, edges };
    }

    // Dijkstra's Algorithm - The Core Navigator
    function findShortestPath(grid, startNode, endNode) {
        let distances = {};
        let previous = {};
        let unvisited = new Set();
        let allNodesList = [];

        for(let r=0; r<GRID_SIZE; r++) {
            for(let c=0; c<GRID_SIZE; c++) {
                let n = grid.nodes[r][c];
                distances[n.id] = Infinity;
                previous[n.id] = null;
                unvisited.add(n.id);
                allNodesList.push(n);
            }
        }

        distances[startNode] = 0;

        while(unvisited.size > 0) {
            // Get node with smallest distance
            let currId = null;
            let minD = Infinity;
            unvisited.forEach(id => {
                if(distances[id] < minD) { minD = distances[id]; currId = id; }
            });

            if(currId === null || currId === endNode) break; // Finished or trap

            unvisited.delete(currId);
            let currNode = allNodesList.find(n => n.id === currId);

            // Find neighbors connected by valid edges
            let neighbors = grid.edges.filter(e => e.n1.id === currId || e.n2.id === currId);
            neighbors.forEach(edge => {
                let neighborId = (edge.n1.id === currId) ? edge.n2.id : edge.n1.id;
                
                if(unvisited.has(neighborId)) {
                    // Cost = Edge weight (Traffic makes this Huge) + Node penalties (Red signals add small delay)
                    let neighborNode = allNodesList.find(n => n.id === neighborId);
                    let penalty = 0;
                    if(neighborNode.isSignal) penalty = 5; 

                    let newDist = distances[currId] + edge.weight + penalty;
                    if(newDist < distances[neighborId]) {
                        distances[neighborId] = newDist; // Found a better, safer path!
                        previous[neighborId] = currId;
                    }
                }
            });
        }

        let path = [];
        let curr = endNode;
        while(curr) {
            path.unshift(curr);
            curr = previous[curr];
        }
        return path; // Array of optimally sequenced node IDs
    }

    const runAutonomousSimulation = () => {
        clearLayers();

        let grid = buildCityGrid();

        // ── Use manually chosen nodes if set, else random ──
        let startNodeId, endNodeId;

        if (manualStartNodeId && manualEndNodeId && manualStartNodeId !== manualEndNodeId) {
            // User picked both via the picker panel
            startNodeId = manualStartNodeId;
            endNodeId   = manualEndNodeId;
        } else {
            // Auto-random (default autonomous patrol)
            let startR = Math.floor(Math.random() * GRID_SIZE);
            let startC = Math.floor(Math.random() * (GRID_SIZE / 2));
            let endR   = Math.floor(Math.random() * GRID_SIZE);
            let endC   = Math.floor(GRID_SIZE / 2 + Math.random() * (GRID_SIZE / 2));
            startNodeId = `${startR}_${startC}`;
            endNodeId   = `${endR}_${endC}`;
        }

        let startNodeObj = grid.nodes.flat().find(n => n.id === startNodeId);
        let endNodeObj   = grid.nodes.flat().find(n => n.id === endNodeId);

        // ── Draw City Roads (beautiful 2-lane with dividers) ──
        // First pass: asphalt bases
        grid.edges.forEach(e => {
            const pts = [e.n1.latlng, e.n2.latlng];
            mapLayers.push(L.polyline(pts, { color: '#18202e', weight: 26, opacity: 1, lineJoin:'round' }).addTo(map));
        });
        // Second pass: yellow center dividers + lane markers + traffic overlays
        grid.edges.forEach(e => {
            const pts = [e.n1.latlng, e.n2.latlng];
            const isHoriz = Math.abs(e.n1.latlng.lat - e.n2.latlng.lat) < 0.0005;

            // Yellow solid center divider
            mapLayers.push(L.polyline(pts, { color: '#ca8a04', weight: 2, opacity: 0.75, lineJoin:'round' }).addTo(map));

            // Dashed white lane markers (one on each side)
            if (isHoriz) {
                const offN = pts.map(p => L.latLng(p.lat + LANE * 1.6, p.lng));
                const offS = pts.map(p => L.latLng(p.lat - LANE * 1.6, p.lng));
                mapLayers.push(L.polyline(offN, { color: '#f8fafc', weight: 1, opacity: 0.18, dashArray: '12,20' }).addTo(map));
                mapLayers.push(L.polyline(offS, { color: '#f8fafc', weight: 1, opacity: 0.18, dashArray: '12,20' }).addTo(map));
            } else {
                const offE = pts.map(p => L.latLng(p.lat, p.lng + LANE * 1.6));
                const offW = pts.map(p => L.latLng(p.lat, p.lng - LANE * 1.6));
                mapLayers.push(L.polyline(offE, { color: '#f8fafc', weight: 1, opacity: 0.18, dashArray: '12,20' }).addTo(map));
                mapLayers.push(L.polyline(offW, { color: '#f8fafc', weight: 1, opacity: 0.18, dashArray: '12,20' }).addTo(map));
            }

            if (e.hasTraffic) {
                // Red traffic jam overlay
                mapLayers.push(L.polyline(pts, { color: '#ef4444', weight: 10, opacity: 0.45, lineJoin:'round' }).addTo(map));
                // Styled traffic cars (replace emoji with glowing divs)
                const midLat = (e.n1.latlng.lat + e.n2.latlng.lat) / 2;
                const midLng = (e.n1.latlng.lng + e.n2.latlng.lng) / 2;
                const tHtml = `
                  <div style="display:flex;gap:3px;">
                    <div style="width:18px;height:10px;background:#ef4444;border-radius:3px;border:1.5px solid rgba(255,255,255,0.5);box-shadow:0 0 6px #ef4444;"></div>
                    <div style="width:18px;height:10px;background:#f97316;border-radius:3px;border:1.5px solid rgba(255,255,255,0.5);box-shadow:0 0 6px #f97316;"></div>
                  </div>`;
                mapLayers.push(L.marker([midLat, midLng], {
                    icon: L.divIcon({ html: tHtml, className:'', iconSize:[42,14], iconAnchor:[21,7] })
                }).addTo(map));
            }
        });

        // ── Realistic 3-light stacked traffic signals ──
        grid.nodes.flat().forEach(n => {
            // Each signal starts in a random phase: 0=red, 1=yellow, 2=green
            let phase = n.isSignal ? 0 : 2; // signal nodes start red, others start green
            const phases = [
                { bg: '#ef4444', label: 'R' },  // 0 = Red
                { bg: '#facc15', label: 'Y' },  // 1 = Yellow
                { bg: '#22c55e', label: 'G' },  // 2 = Green
            ];
            const durations = [7000, 1800, 6000]; // red, yellow, green ms

            function buildSignalHtml(ph) {
                return `
                <div style="
                    background:#111827; border-radius:4px; padding:3px 3px; width:14px;
                    display:flex; flex-direction:column; gap:2px;
                    border:1px solid rgba(255,255,255,0.15);
                    box-shadow:0 2px 8px rgba(0,0,0,0.6);
                ">
                  <div style="width:8px;height:8px;border-radius:50%;background:${ ph===0 ? '#ef4444' : 'rgba(239,68,68,0.15)' };box-shadow:${ ph===0 ? '0 0 8px #ef4444' : 'none' };transition:all 0.3s;"></div>
                  <div style="width:8px;height:8px;border-radius:50%;background:${ ph===1 ? '#facc15' : 'rgba(250,204,21,0.15)' };box-shadow:${ ph===1 ? '0 0 8px #facc15' : 'none' };transition:all 0.3s;"></div>
                  <div style="width:8px;height:8px;border-radius:50%;background:${ ph===2 ? '#22c55e' : 'rgba(34,197,94,0.15)' };box-shadow:${ ph===2 ? '0 0 8px #22c55e' : 'none' };transition:all 0.3s;"></div>
                </div>`;
            }

            const tl = L.marker(n.latlng, {
                icon: L.divIcon({ html: buildSignalHtml(phase), className:'', iconSize:[14,34], iconAnchor:[7,17] })
            }).addTo(map);
            mapLayers.push(tl);

            // Phase cycling function
            function cycleSignal() {
                phase = (phase + 1) % 3;
                tl.setIcon(L.divIcon({ html: buildSignalHtml(phase), className:'', iconSize:[14,34], iconAnchor:[7,17] }));
                npcIntervals.push(setTimeout(cycleSignal, durations[phase]));
            }
            npcIntervals.push(setTimeout(cycleSignal, durations[phase] + Math.random() * 2000));
        });

        // ── Ambient NPC cars on grid streets ──
        const NPC_COLORS = ['#8b5cf6','#f59e0b','#10b981','#ec4899','#0ea5e9'];
        const npcRoutes = [
            // EW - eastbound (south lane)
            [[LAT_START - D_LAT*0 - LANE, LNG_START - D_LNG*0.3], [LAT_START - D_LAT*0 - LANE, LNG_START + GRID_SIZE*D_LNG]],
            [[LAT_START - D_LAT*2 - LANE, LNG_START - D_LNG*0.3], [LAT_START - D_LAT*2 - LANE, LNG_START + GRID_SIZE*D_LNG]],
            // EW - westbound (north lane)
            [[LAT_START - D_LAT*1 + LANE, LNG_START + GRID_SIZE*D_LNG], [LAT_START - D_LAT*1 + LANE, LNG_START - D_LNG*0.3]],
            [[LAT_START - D_LAT*3 + LANE, LNG_START + GRID_SIZE*D_LNG], [LAT_START - D_LAT*3 + LANE, LNG_START - D_LNG*0.3]],
            // NS - southbound (east lane)
            [[LAT_START + D_LAT*0.3, LNG_START + D_LNG*1 + LANE], [LAT_START - GRID_SIZE*D_LAT, LNG_START + D_LNG*1 + LANE]],
            [[LAT_START + D_LAT*0.3, LNG_START + D_LNG*3 + LANE], [LAT_START - GRID_SIZE*D_LAT, LNG_START + D_LNG*3 + LANE]],
            // NS - northbound (west lane)
            [[LAT_START - GRID_SIZE*D_LAT, LNG_START + D_LNG*2 - LANE], [LAT_START + D_LAT*0.3, LNG_START + D_LNG*2 - LANE]],
        ];

        function makeLerpPath(a, b, steps) {
            const pts = [];
            for (let s = 0; s <= steps; s++) {
                const t = s / steps;
                pts.push(L.latLng(a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t));
            }
            return pts;
        }

        npcRoutes.forEach((raw, idx) => {
            const color = NPC_COLORS[idx % NPC_COLORS.length];
            const pts = makeLerpPath(raw[0], raw[1], 300);
            let step = Math.floor(Math.random() * pts.length);

            // Pre-compute the direction of this route (it's a straight line, so constant bearing)
            const routeA = L.latLng(raw[0][0], raw[0][1]);
            const routeB = L.latLng(raw[1][0], raw[1][1]);
            const routeDeg = -getBearing(routeA, routeB); // negate: screen Y is inverted vs lat

            function buildNPCIcon(deg) {
                return L.divIcon({
                    html: `<div style="
                        transform: rotate(${deg}deg);
                        transform-origin: center;
                        width:22px; height:11px;
                        background:${color};
                        border-radius:4px;
                        border:1.5px solid rgba(255,255,255,0.55);
                        box-shadow:0 0 7px ${color};
                        position:relative;
                    ">
                        <!-- headlight tip -->
                        <div style="position:absolute;right:1px;top:2px;width:4px;height:3px;background:#fef9c3;border-radius:1px;opacity:0.9;"></div>
                        <div style="position:absolute;right:1px;bottom:2px;width:4px;height:3px;background:#fef9c3;border-radius:1px;opacity:0.9;"></div>
                    </div>`,
                    className: '', iconSize: [22, 11], iconAnchor: [11, 5]
                });
            }

            const m = L.marker(pts[step], { icon: buildNPCIcon(routeDeg) }).addTo(map);
            mapLayers.push(m);

            const iv = setInterval(() => {
                step = (step + 4) % pts.length;
                m.setLatLng(pts[step]);
            }, 130);
            npcIntervals.push(iv);
        });


        // Execute Shortest Path Generation Logic!
        let shortestPathIds = findShortestPath(grid, startNodeId, endNodeId);
        
        // Convert IDs back to actual map geographic coordinates
        let safePathCoords = shortestPathIds.map(id => grid.nodes.flat().find(n => n.id === id).latlng);

        // Render the Active Zig-Zag Safe Route
        let clearPathLine = L.polyline(safePathCoords, { color: '#22c55e', weight: 6, opacity: 0.9, dashArray: '15, 15', lineJoin:'round' }).addTo(map);
        let clearPathGlow = L.polyline(safePathCoords, { color: '#22c55e', weight: 16, opacity: 0.3, lineJoin:'round' }).addTo(map);
        mapLayers.push(clearPathLine, clearPathGlow);

        const isAmbulance = Math.random() > 0.5;
        const vColor = isAmbulance ? '#3b82f6' : '#ef4444';
        const vIconStr = isAmbulance ? '🚑' : '🚒';
        const vehicleType = isAmbulance ? 'Ambulance' : 'Fire Engine';
        
        const respIcon = L.divIcon({ 
            html:`<div style="background:${vColor}; width:40px; height:40px; border-radius:${isAmbulance?'50%':'8px'}; border:3px solid white; box-shadow:0 0 25px ${vColor}; display:flex; justify-content:center; align-items:center; font-size:24px; box-sizing:border-box;">${vIconStr}</div>`, 
            className:'', iconSize:[40,40], iconAnchor:[20,20]
        });

        const destIcon = L.divIcon({ html: '<ion-icon name="warning" style="color:var(--accent-red); font-size:40px; filter:drop-shadow(0 0 15px red);"></ion-icon>', className:'', iconSize:[40,40], iconAnchor:[20,40] });
        mapLayers.push(L.marker(endNodeObj.latlng, {icon: destIcon}).addTo(map));

        let vehicleMarker = L.marker(startNodeObj.latlng, {icon: respIcon}).addTo(map);
        mapLayers.push(vehicleMarker);

        hudTitle.innerText = "A* Algorithm Active";
        hudTitle.style.color = "var(--accent-green)";
        hudDesc.innerText = `Intelligently routed around slow traffic zones. Dispatching ${vehicleType}...`;
        signalStatus.style.borderColor = "var(--accent-green)";
        hudIcon.name = "git-network-outline";
        hudIcon.style.color = "var(--accent-green)";
        liveDest.innerText = `Incident Node ${endNodeId}`;

        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        
        // Provide Smooth Interpolation points along each mathematical line segment
        function makeDetailedSteps(coords, pointsPerSegment = 50) {
            let pts = [];
            for(let i=0; i<coords.length-1; i++){
                let p1 = coords[i]; let p2 = coords[i+1];
                for(let s=0; s<=pointsPerSegment; s++) {
                    pts.push(L.latLng( p1.lat + (p2.lat - p1.lat)*(s/pointsPerSegment), p1.lng + (p2.lng - p1.lng)*(s/pointsPerSegment) ));
                }
            }
            return pts;
        }

        let detailedPath = makeDetailedSteps(safePathCoords, 75);

        let step = 0;
        let totalDistMi = (detailedPath.length * 0.003); // Approximated simulation distance based on turns

        // Accident Setup
        let willCrash = true; // 100% chance to constantly trigger collisions for testing
        let hasCrashed = false;
        let crashStep = Math.floor(detailedPath.length * (0.2 + Math.random()*0.4)); // Happens early-mid trip

        currentDriveInterval = setInterval(function driveTick() {
            if(step >= detailedPath.length) {
                clearInterval(currentDriveInterval);
                finishRun(vehicleType);
                return;
            }

            let pos = detailedPath[step];
            vehicleMarker.setLatLng(pos);

            let speedMph = 55 + Math.random()*10;
            speedMph = step < 10 ? step * 6 : speedMph; 
            speedMph = step > detailedPath.length - 20 ? (detailedPath.length - step) * 3 : speedMph; 
            speedMph = Math.max(5, speedMph);
            
            let progress = step / detailedPath.length;
            let currentDistMi = totalDistMi * (1 - progress);
            let etaMins = (currentDistMi / speedMph) * 60;
            
            liveSpeed.innerText = Math.round(speedMph);
            liveDist.innerText = currentDistMi.toFixed(1);
            liveEta.innerText = Math.max(1, Math.ceil(etaMins));

            // ACCIDENT EVENT LOGIC
            if (willCrash && !hasCrashed && step === crashStep) {
                hasCrashed = true;
                clearInterval(currentDriveInterval);
                
                let crashPos = detailedPath[Math.min(step + 25, detailedPath.length - 1)];
                const accidentIcon = L.divIcon({ html: '<span style="font-size:50px; text-shadow:0 0 20px red; display:block; transform:translateY(-10px);">💥</span>', className:'', iconSize:[50,50], iconAnchor:[25,25] });
                mapLayers.push(L.marker(crashPos, {icon: accidentIcon}).addTo(map));

                // Warning UI
                hudTitle.innerText = "OBSTACLE DETECTED";
                hudTitle.style.color = "var(--accent-red)";
                hudDesc.innerText = "Severe collision blocking path. Recalculating Dijkstra nodes...";
                signalStatus.style.borderColor = "var(--accent-red)";
                hudIcon.name = "warning";
                hudIcon.style.color = "var(--accent-red)";

                if ('speechSynthesis' in window) {
                    window.speechSynthesis.speak(new SpeechSynthesisUtterance("Accident ahead. Mathematical rerouting initiated based on available safe nodes."));
                }

                // Erase old highlights
                map.removeLayer(clearPathLine);
                map.removeLayer(clearPathGlow);

                // Draw dead end path
                mapLayers.push(L.polyline([pos, crashPos], { color: '#ef4444', weight: 6, dashArray: '10, 10' }).addTo(map));

                setTimeout(() => {
                    // 1. Identify which grid edge the crash is actually on
                    let closestEdge = null;
                    let minDist = Infinity;
                    grid.edges.forEach(e => {
                        let d1 = e.n1.latlng.distanceTo(crashPos);
                        let d2 = e.n2.latlng.distanceTo(crashPos);
                        let edgeLength = e.n1.latlng.distanceTo(e.n2.latlng);
                        let diff = Math.abs((d1 + d2) - edgeLength);
                        if(diff < minDist) { minDist = diff; closestEdge = e; }
                    });
                    
                    // 2. Mathematically BLOCK that specific edge 
                    if(closestEdge) closestEdge.weight = Infinity; 

                    // 3. Find the nearest node to the car right now to act as the new Starting Point
                    let closestNodeId = null;
                    let minNodeDist = Infinity;
                    grid.nodes.flat().forEach(n => {
                        let d = n.latlng.distanceTo(pos);
                        if(d < minNodeDist) { minNodeDist = d; closestNodeId = n.id; }
                    });

                    // 4. THE AI DECIDES ITS OWN SAFE PATH based on the newly blocked edge
                    let newShortestIds = findShortestPath(grid, closestNodeId, endNodeId);
                    
                    let newSafePathCoords = newShortestIds.map(id => grid.nodes.flat().find(n => n.id === id).latlng);
                    newSafePathCoords.unshift(pos); // Connect current car pos seamlessly
                    
                    clearPathLine = L.polyline(newSafePathCoords, { color: '#facc15', weight: 6, opacity: 0.9, dashArray: '15, 15', lineJoin:'round' }).addTo(map);
                    clearPathGlow = L.polyline(newSafePathCoords, { color: '#facc15', weight: 16, opacity: 0.4, lineJoin:'round' }).addTo(map);
                    mapLayers.push(clearPathLine, clearPathGlow);

                    detailedPath = makeDetailedSteps(newSafePathCoords, 75);
                    step = 0;
                    totalDistMi = (detailedPath.length * 0.003);

                    hudTitle.innerText = "Dijkstra Reroute Confirmed";
                    hudTitle.style.color = "#facc15";
                    hudDesc.innerText = "AI successfully secured nearest new route.";
                    signalStatus.style.borderColor = "#facc15";
                    hudIcon.name = "git-network-outline";
                    hudIcon.style.color = "#facc15";

                    currentDriveInterval = setInterval(driveTick, 30);
                }, 2500);
            } else {
                step++;
            }
        }, 55); // Smooth but not too fast
    };

    const finishRun = (vType) => {
        hudTitle.innerText = "Target Reached";
        hudTitle.style.color = "var(--text-primary)";
        hudDesc.innerText = `${vType} successfully navigated complex grid safely. Retasking...`;
        signalStatus.style.borderColor = "var(--panel-border)";
        hudIcon.name = "checkmark-circle";
        hudIcon.style.color = "var(--text-primary)";

        liveSpeed.innerText = "0";
        liveEta.innerText = "0";
        liveDist.innerText = "0.0";

        nextRunTimer = setTimeout(() => {
            // Do NOT auto-restart — wait for user to dispatch again
            hudTitle.innerText = 'Ready for next dispatch';
            hudDesc.innerText  = 'Set a new start & destination above';
        }, 1500);
    };

    // ── IDLE: Draw city grid, then wait for user to choose route ──
    const idleGrid = buildCityGrid();
    // Draw roads in idle state
    idleGrid.edges.forEach(e => {
        const pts = [e.n1.latlng, e.n2.latlng];
        mapLayers.push(L.polyline(pts, { color: '#18202e', weight: 22, opacity: 1, lineJoin:'round' }).addTo(map));
        mapLayers.push(L.polyline(pts, { color: '#ca8a04', weight: 1.5, opacity: 0.65, lineJoin:'round' }).addTo(map));
    });
    idleGrid.nodes.flat().forEach(n => {
        const tlHtml = `<div style="width:9px;height:9px;border-radius:50%;background:#22c55e;box-shadow:0 0 6px #22c55e;"></div>`;
        mapLayers.push(L.marker(n.latlng, { icon: L.divIcon({ html: tlHtml, className:'', iconSize:[9,9], iconAnchor:[4,4] }) }).addTo(map));
    });
    hudTitle.innerText = 'Set Start & Destination';
    hudDesc.innerText  = 'Use the route bar below to dispatch';
});
