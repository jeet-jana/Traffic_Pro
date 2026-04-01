// City-Scale Smart Traffic Simulation

document.addEventListener('DOMContentLoaded', () => {
    // ---- 1. SETUP MAP ----
    const map = L.map('operator-map', {
        zoomControl: false,
        dragging: true,
        scrollWheelZoom: true
    }).setView([41.882, -87.635], 14);

    // Switch to highly-detailed terrain and street map (dark theme) to look significantly more realistic
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);

    // ---- 2. GRID DEFINITIONS ----
    const GRID_SIZE = 3;
    const D_LAT = 0.010;
    const D_LNG = 0.012;
    const B_LAT = 41.892; // Row 0 (Top)
    const B_LNG = -87.647; // Col 0 (Left)

    const redLightIcon = L.divIcon({ className: 'signal-marker red', iconSize:[10,10], iconAnchor:[5,5] });
    const greenLightIcon = L.divIcon({ className: 'signal-marker green', iconSize:[10,10], iconAnchor:[5,5] });

    let nodes = [];
    let nodesDict = {};
    for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
            let lat = B_LAT - (r * D_LAT);
            let lng = B_LNG + (c * D_LNG);
            let id = `${r}_${c}`;
            let node = {
                id: id, r: r, c: c, lat: lat, lng: lng,
                state: 'NS_GREEN', // default
                cars_ns: 0, cars_ew: 0,
                override: null // 'ns' or 'ew' if emergency vehicle is near
            };
            
            // Render the 4 traffic lights visually on the map layer
            node.signals = {
                n: L.marker([lat + 0.0008, lng], {icon: greenLightIcon}).addTo(map),
                s: L.marker([lat - 0.0008, lng], {icon: greenLightIcon}).addTo(map),
                e: L.marker([lat, lng + 0.0010], {icon: redLightIcon}).addTo(map),
                w: L.marker([lat, lng - 0.0010], {icon: redLightIcon}).addTo(map)
            };

            nodes.push(node);
            nodesDict[id] = node;
            
            // Draw intersection box
            L.rectangle([[lat+0.0005, lng-0.0005], [lat-0.0005, lng+0.0005]], {color:'#475569', weight:1, fillOpacity:0.3}).addTo(map);
        }
    }

    let lanes = [];
    // Vertical Lanes
    for (let c = 0; c < GRID_SIZE; c++) {
        let lng = B_LNG + (c * D_LNG);
        // Southbound
        lanes.push({ id: `v_${c}_sb`, type: 'ns', axis: 'lat', dir: -1, fixedIdx: 1, fixedCoord: lng - 0.0001, start: B_LAT + D_LAT, end: B_LAT - (2*D_LAT) - D_LAT });
        // Northbound
        lanes.push({ id: `v_${c}_nb`, type: 'ns', axis: 'lat', dir: 1, fixedIdx: 1, fixedCoord: lng + 0.0001, start: B_LAT - (2*D_LAT) - D_LAT, end: B_LAT + D_LAT });
    }
    // Horizontal Lanes
    for (let r = 0; r < GRID_SIZE; r++) {
        let lat = B_LAT - (r * D_LAT);
        // Eastbound
        lanes.push({ id: `h_${r}_eb`, type: 'ew', axis: 'lng', dir: 1, fixedIdx: 0, fixedCoord: lat - 0.0001, start: B_LNG - D_LNG, end: B_LNG + (2*D_LNG) + D_LNG });
        // Westbound
        lanes.push({ id: `h_${r}_wb`, type: 'ew', axis: 'lng', dir: -1, fixedIdx: 0, fixedCoord: lat + 0.0001, start: B_LNG + (2*D_LNG) + D_LNG, end: B_LNG - D_LNG });
    }

    // Draw Roads Base (Thin glowing grid over the realistic map)
    for (let c = 0; c < GRID_SIZE; c++) {
        let lng = B_LNG + (c * D_LNG);
        L.polyline([[B_LAT + D_LAT, lng], [B_LAT - (2*D_LAT) - D_LAT, lng]], {color: '#3b82f6', weight: 4, opacity: 0.15}).addTo(map);
    }
    for (let r = 0; r < GRID_SIZE; r++) {
        let lat = B_LAT - (r * D_LAT);
        L.polyline([[lat, B_LNG - D_LNG], [lat, B_LNG + (2*D_LNG) + D_LNG]], {color: '#3b82f6', weight: 4, opacity: 0.15}).addTo(map);
    }

    // ---- 3. POIs (HOSPITALS, FIRE STATIONS) ----
    const hospitalIcon = L.divIcon({ html: '<div style="font-size:20px; background:white; padding:4px; border-radius:50%; box-shadow:0 0 10px #fff">🏥</div>', className:'', iconSize:[28,28], iconAnchor:[14,14]});
    const fireIcon = L.divIcon({ html: '<div style="font-size:20px; background:white; padding:4px; border-radius:50%; box-shadow:0 0 10px #fff">🚒</div>', className:'', iconSize:[28,28], iconAnchor:[14,14]});
    const houseIcon = L.divIcon({ html: '<div style="font-size:20px; background:#fef08a; padding:6px; border-radius:50%; border:2px solid #ca8a04; box-shadow:0 0 15px #facc15; text-align:center; height:36px; width:36px; box-sizing:border-box; line-height:20px;">🏠</div>', className:'', iconSize:[36,36], iconAnchor:[18,18]});

    let hospitalNode = nodesDict['0_0']; // Top Left
    let fireNode = nodesDict['2_2']; // Bottom Right
    
    L.marker([hospitalNode.lat + 0.001, hospitalNode.lng - 0.001], {icon: hospitalIcon}).addTo(map);
    L.marker([fireNode.lat - 0.001, fireNode.lng + 0.001], {icon: fireIcon}).addTo(map);

    // ---- 4. VEHICLE SIMULATION ENGINE ----
    let activeCars = [];
    let emergencyUnits = [];
    let statCars = 0; let statAmb = 0; let statFire = 0; let statEmergencies = 0;

    const carIcon = L.divIcon({ className: 'car-marker', iconSize: [6,6], iconAnchor: [3,3] });
    const ambIcon = L.divIcon({ html:'<div style="background:#3b82f6; width:36px; height:36px; border-radius:50%; border:3px solid white; box-shadow:0 0 20px #3b82f6; display:flex; justify-content:center; align-items:center; font-size:20px; box-sizing:border-box;">🚑</div>', className:'', iconSize:[36,36], iconAnchor:[18,18]});
    const ftIcon = L.divIcon({ html:'<div style="background:#ef4444; width:36px; height:36px; border-radius:6px; border:3px solid white; box-shadow:0 0 20px #ef4444; display:flex; justify-content:center; align-items:center; font-size:20px; box-sizing:border-box;">🚒</div>', className:'', iconSize:[36,36], iconAnchor:[18,18]});

    // Spawn regular traffic continuously
    setInterval(() => {
        if(statCars > 80) return; // Cap regular cars
        const lane = lanes[Math.floor(Math.random() * lanes.length)];
        let pos = [0,0];
        pos[lane.fixedIdx] = lane.fixedCoord;
        pos[lane.axis === 'lat' ? 0 : 1] = lane.start;

        let car = {
            lane: lane, pos: pos, speed: 0.00005 + (Math.random()*0.00002), // Slowed down regular car speed
            marker: L.marker(pos, {icon: carIcon}).addTo(map)
        };
        activeCars.push(car);
        statCars++;
    }, 600);

    // Spawn Emergency Vehicles periodically
    const spawnEmergency = () => {
        let isMedical = Math.random() > 0.5;
        let startNode = isMedical ? hospitalNode : fireNode;
        // Pick random target node
        let r_target = Math.floor(Math.random() * GRID_SIZE);
        let c_target = Math.floor(Math.random() * GRID_SIZE);
        let targetNode = nodesDict[`${r_target}_${c_target}`];
        if (targetNode === startNode) return; // Bad roll

        // Generate Path (Manhattan routing along grid)
        let pathLanes = [];
        let currR = startNode.r; let currC = startNode.c;
        
        // Go Vertically first
        if (currR !== r_target) {
            let dir = (r_target > currR) ? 1 : -1; // 1 = Southbound, -1 = Northbound
            let laneId = (dir === 1) ? `v_${currC}_sb` : `v_${currC}_nb`;
            pathLanes.push(lanes.find(l => l.id === laneId));
            currR = r_target;
        }
        // Go Horizontally second
        if (currC !== c_target) {
            let dir = (c_target > currC) ? 1 : -1; // 1 = Eastbound, -1 = Westbound
            let laneId = (dir === 1) ? `h_${currR}_eb` : `h_${currR}_wb`;
            pathLanes.push(lanes.find(l => l.id === laneId));
        }

        let firstLane = pathLanes[0];
        let pos = [0,0];
        pos[firstLane.fixedIdx] = firstLane.fixedCoord;
        pos[firstLane.axis === 'lat' ? 0 : 1] = (firstLane.dir === 1) ? startNode.lat : startNode.lat; 
        
        // Minor logic fix: to start AT the node, not edge of map.
        pos[0] = startNode.lat; pos[1] = startNode.lng;

        let houseLat = targetNode.lat + (Math.random() > 0.5 ? 0.0025 : -0.0025);
        let houseLng = targetNode.lng + (Math.random() > 0.5 ? 0.0025 : -0.0025);
        let houseMarker = L.marker([houseLat, houseLng], {icon: houseIcon}).addTo(map);

        let unit = {
            type: isMedical ? 'amb' : 'fire',
            path: pathLanes, pathIdx: 0,
            pos: pos, speed: 0.00015, // Much faster relative to regular cars, but slowed down
            marker: L.marker(pos, {icon: isMedical ? ambIcon : ftIcon}).addTo(map),
            targetR: r_target, targetC: c_target, house: houseMarker
        };

        emergencyUnits.push(unit);
        if(isMedical) statAmb++; else statFire++;
        statEmergencies++;

        // Add to alert log
        const alertHtml = `
            <div class="alert-item critical slide-down">
                <div class="alert-icon"><ion-icon name="${isMedical ? 'medical' : 'flame'}"></ion-icon></div>
                <div class="alert-content">
                    <h4>${isMedical?'Ambulance':'Fire Engine'} Dispatched</h4>
                    <p>En route to incident at Sector ${targetNode.id}. Emergency Overrides active.</p>
                </div>
            </div>`;
        document.getElementById('alerts-container').insertAdjacentHTML('afterbegin', alertHtml);
    };

    setInterval(spawnEmergency, 12000);
    setTimeout(spawnEmergency, 2000); // 1st one quick

    // ---- 5. MAIN LOGIC LOOP (60fps) ----
    setInterval(() => {
        // 5a. Reset Nodes counts
        nodes.forEach(n => { n.cars_ns = 0; n.cars_ew = 0; n.override = null; });

        // 5b. Emergency Vehicles Override Check & Movement
        let overrideIsHappeningGlobally = false;
        emergencyUnits.forEach(u => {
            overrideIsHappeningGlobally = true;
            let currentLane = u.path[u.pathIdx];
            let axisIdx = currentLane.axis === 'lat' ? 0 : 1;
            
            // Look ahead for nodes to throw override
            nodes.forEach(n => {
                let dist = Math.abs(u.pos[axisIdx] - (axisIdx===0 ? n.lat : n.lng));
                let sameAxis = (currentLane.axis === 'lat') ? (Math.abs(u.pos[1] - n.lng) < 0.001) : (Math.abs(u.pos[0] - n.lat) < 0.001);
                
                if (sameAxis && dist < 0.004) {
                    n.override = currentLane.type; // Force this intersection to NS or EW based on ambulance path
                }
            });

            // Move unit
            u.pos[axisIdx] += u.speed * currentLane.dir;
            
            // Ensure visual alignment with lane
            u.pos[currentLane.fixedIdx] = currentLane.fixedCoord;
            u.marker.setLatLng(u.pos);

            // Check if reached end of current lane segment (turning)
            let n_axisCoord = (currentLane.axis === 'lat') ? nodesDict[`${u.targetR}_${u.targetC}`].lat : nodesDict[`${u.targetR}_${u.targetC}`].lng;
            let distToTurn = (n_axisCoord - u.pos[axisIdx]) * currentLane.dir;

            if (distToTurn < 0.0005) {
                // Reached intersection or destination
                if (u.pathIdx < u.path.length - 1) {
                    u.pathIdx++; // Turn onto next lane
                } else {
                    // Reached destination house
                    u.finished = true;
                }
            }
        });

        // Cleanup finished emergencies
        emergencyUnits = emergencyUnits.filter(u => {
            if(u.finished) {
                map.removeLayer(u.marker);
                map.removeLayer(u.house);
                if(u.type==='amb') statAmb--; else statFire--;
                statEmergencies--;
                return false;
            }
            return true;
        });

        // 5c. Smart Traffic Lights Logic - Density counting
        activeCars.forEach(car => {
            let axisIdx = car.lane.axis === 'lat' ? 0 : 1;
            let curr = car.pos[axisIdx];
            
            // Find approaching node
            nodes.forEach(n => {
                let n_coord = axisIdx===0 ? n.lat : n.lng;
                let sameAxis = (car.lane.axis === 'lat') ? (Math.abs(car.pos[1] - n.lng) < 0.001) : (Math.abs(car.pos[0] - n.lat) < 0.001);
                let distToNode = (n_coord - curr) * car.lane.dir;

                if (sameAxis && distToNode > 0 && distToNode < 0.002) {
                    if (car.lane.type === 'ns') n.cars_ns++;
                    if (car.lane.type === 'ew') n.cars_ew++;
                    
                    // Note: if node signal is RED for this car, car should STOP.
                    let lightState = n.state; // e.g., 'NS_GREEN'
                    if (n.override) {
                        lightState = (n.override === 'ns') ? 'NS_GREEN' : 'EW_GREEN';
                    }

                    if ((car.lane.type === 'ns' && lightState !== 'NS_GREEN') || 
                        (car.lane.type === 'ew' && lightState !== 'EW_GREEN')) {
                        
                        // It's RED for this car. Stop if near stop line.
                        if (distToNode < 0.0005) {
                            car.stopped = true;
                        } else {
                            car.stopped = false;
                        }
                    } else {
                        car.stopped = false;
                    }
                }
            });
        });

        // Update lights based on counts + overrides
        nodes.forEach(n => {
            let newState = n.state;
            
            if (n.override) {
                // Emergency vehicle forcing
                newState = (n.override === 'ns') ? 'NS_GREEN' : 'EW_GREEN';
            } else {
                // Smart density
                if (n.cars_ns > n.cars_ew + 2) newState = 'NS_GREEN';
                else if (n.cars_ew > n.cars_ns + 2) newState = 'EW_GREEN';
            }

            // Optimize DOM: Only update icons physically if the state flipped
            if(n.state !== newState || n.forceUpdate) {
                n.state = newState;
                n.forceUpdate = false;
                
                if(n.state === 'NS_GREEN') {
                    n.signals.n.setIcon(greenLightIcon);
                    n.signals.s.setIcon(greenLightIcon);
                    n.signals.e.setIcon(redLightIcon);
                    n.signals.w.setIcon(redLightIcon);
                } else {
                    n.signals.n.setIcon(redLightIcon);
                    n.signals.s.setIcon(redLightIcon);
                    n.signals.e.setIcon(greenLightIcon);
                    n.signals.w.setIcon(greenLightIcon);
                }
            }
        });

        // 5d. Move Normal Cars
        let toRemove = [];
        activeCars.forEach((car, idx) => {
            let axisIdx = car.lane.axis === 'lat' ? 0 : 1;
            
            // Collision with car ahead
            let collision = activeCars.find(other => 
                other !== car && other.lane.id === car.lane.id &&
                ((other.pos[axisIdx] - car.pos[axisIdx]) * car.lane.dir > 0) &&
                ((other.pos[axisIdx] - car.pos[axisIdx]) * car.lane.dir < 0.0006)
            );

            if (!car.stopped && !collision) {
                car.pos[axisIdx] += car.speed * car.lane.dir;
                car.marker.setLatLng(car.pos);
            }

            // Despawn
            let distToEnd = (car.lane.end - car.pos[axisIdx]) * car.lane.dir;
            if (distToEnd < 0) {
                map.removeLayer(car.marker);
                toRemove.push(idx);
                statCars--;
            }
        });
        
        toRemove.reverse().forEach(idx => activeCars.splice(idx, 1));

        // 5e. Update UI
        document.getElementById('count-cars').innerText = statCars;
        document.getElementById('count-amb').innerText = statAmb;
        document.getElementById('count-fire').innerText = statFire;
        document.getElementById('count-emergencies').innerText = statEmergencies;
        
        document.getElementById('override-toggle').checked = overrideIsHappeningGlobally;
        if(overrideIsHappeningGlobally) {
            document.querySelector('.dashboard').style.boxShadow = 'inset 0 0 40px rgba(59, 130, 246, 0.3)';
        } else {
            document.querySelector('.dashboard').style.boxShadow = 'none';
        }

    }, 50);

    // Initial manual logs
    console.log("City simulation started.");

    // ---- 6. TRANSIT AI ASSISTANT LOGIC ----
    const aiToggle = document.getElementById('ai-toggle');
    const aiPanel = document.getElementById('ai-panel');
    const aiClose = document.getElementById('ai-close');
    const aiSend = document.getElementById('ai-send');
    const aiText = document.getElementById('ai-text');
    const aiMessages = document.getElementById('ai-messages');

    aiToggle.addEventListener('click', () => aiPanel.classList.add('active'));
    aiClose.addEventListener('click', () => aiPanel.classList.remove('active'));

    const addMessage = (text, sender) => {
        const msg = document.createElement('div');
        msg.className = `msg ${sender}`;
        msg.innerHTML = `<div class="msg-content">${text}</div>`;
        aiMessages.appendChild(msg);
        aiMessages.scrollTop = aiMessages.scrollHeight;
    };

    const processAiResponse = (query) => {
        const q = query.toLowerCase();
        let response = "I'm analyzing the traffic grid. Can you be more specific? You can ask about 'small roads', 'congestion', or 'override'.";

        if (q.includes("small road") || q.includes("small") || q.includes("alternate")) {
            response = "Routing Analysis Complete: I have identified several minor arterial side-streets running parallel to the congested routes. If you divert traffic to these small roads, overall grid congestion will drop by approximately 18%.";
            
            // Highlight a small road visually
            let lat = B_LAT - D_LAT; // row 1
            L.polyline([[lat + 0.003, B_LNG - D_LNG], [lat + 0.003, B_LNG + D_LNG]], {color: '#a855f7', weight: 3, dashArray:'5, 5'}).addTo(map)
                .bindPopup("Suggested Minor Arterial").openPopup();

        } else if (q.includes("congestion") || q.includes("traffic")) {
            response = "Current congestion is focused on the central nodes. The Smart Traffic Lights are currently favoring North/South flow to alleviate built-up queues.";
        } else if (q.includes("override") || q.includes("emergency") || q.includes("ambulance") || q.includes("fire")) {
            response = "Emergency system is active. High-priority units (Ambulances and Fire Engines) will automatically override traffic lights upon bounding box approach.";
        }

        // Simulate typing delay
        const typingMsg = document.createElement('div');
        typingMsg.className = 'msg bot typing';
        typingMsg.innerHTML = `<div class="msg-content"><div class="typing-dots"><span></span><span></span><span></span></div></div>`;
        aiMessages.appendChild(typingMsg);
        aiMessages.scrollTop = aiMessages.scrollHeight;

        setTimeout(() => {
            typingMsg.remove();
            addMessage(response, 'bot');
        }, 1200 + Math.random() * 800);
    };

    const handleSend = () => {
        const text = aiText.value.trim();
        if(!text) return;
        addMessage(text, 'user');
        aiText.value = '';
        processAiResponse(text);
    };

    aiSend.addEventListener('click', handleSend);
    aiText.addEventListener('keypress', (e) => {
        if(e.key === 'Enter') handleSend();
    });

});
