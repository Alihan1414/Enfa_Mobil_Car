// YurtAraç Institutional Management System - Core Logic
// Integrated with Firebase Realtime Database (TopClean DB)

// ---------- FIREBASE CONFIGURATION ----------
const firebaseConfig = {
    apiKey: "AIzaSyCO88ONQpL3vFRMSY-jyhRImbsNC1ngcmQ",
    authDomain: "topclean-ce4e6.firebaseapp.com",
    databaseURL: "https://topclean-ce4e6-default-rtdb.firebaseio.com",
    projectId: "topclean-ce4e6",
    storageBucket: "topclean-ce4e6.firebaseastorage.app",
    messagingSenderId: "413118182506",
    appId: "1:413118182506:web:4e1897da948b8348030613"
};

let db = null;
try {
    if (typeof firebase !== 'undefined') {
        firebase.initializeApp(firebaseConfig);
        db = firebase.database();
        console.log("Firebase connected successfully.");
    }
} catch (e) {
    console.error("Firebase Initialization Error:", e);
}

// ---------- APP STATE ----------
let state = {
    kurum: null,      // Current Institution Code
    user: null,       // Current User Object
    role: null,       // 'admin' or 'personnel'
    vehicles: [],     // List of vehicles for this institution
    activeRequest: null, // Current pending or approved request
    activeTrip: null, // If the current user has an active trip
    camera: {
        stream: null,
        steps: ['Ön Sol', 'Ön Sağ', 'Arka Sol', 'Arka Sağ'],
        currentStep: 0,
        photos: [],
        type: 'start' // 'start' or 'end'
    }
};

// ---------- UI HELPERS ----------
function showGate(id) {
    document.querySelectorAll('.gate-view').forEach(g => g.classList.remove('active'));
    document.getElementById(`gate-${id}`).classList.add('active');
}

function showPanel(id) {
    const panels = document.getElementById('panel-container');
    panels.classList.remove('hidden');
    document.querySelectorAll('.role-panel').forEach(p => p.classList.add('hidden'));
    document.getElementById(`panel-${id}`).classList.remove('hidden');
}

// ---------- BOOTSTRAP ----------
window.addEventListener('load', () => {
    // Splash screen removal
    setTimeout(() => {
        document.getElementById('splash-screen').style.opacity = '0';
        setTimeout(() => {
            document.getElementById('splash-screen').style.display = 'none';
            document.getElementById('app').classList.remove('hidden');
            checkStoredSession();
        }, 600);
    }, 2000);

    initEventListeners();
    lucide.createIcons();
});

function checkStoredSession() {
    const saved = localStorage.getItem('yurtarac_session');
    if (saved) {
        const session = JSON.parse(saved);
        state.kurum = session.kurum;
        state.user = session.user;
        state.role = session.role;
        startInstitutionalSession();
    } else {
        showGate('institution');
    }
}

// ---------- EVENT LISTENERS ----------
function initEventListeners() {
    // 1. Institution Entry
    document.getElementById('btn-enter-institution').addEventListener('click', handleInstitutionEntry);

    // 2. Login Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const role = btn.getAttribute('data-role');
            document.querySelectorAll('.login-form-container').forEach(f => f.classList.remove('active'));
            document.getElementById(`login-${role}`).classList.add('active');
        });
    });

    // 3. Login Actions
    document.getElementById('btn-login-admin').addEventListener('click', handleAdminLogin);
    document.getElementById('btn-login-personnel').addEventListener('click', handlePersonnelLogin);

    // 4. Back button
    document.getElementById('btn-back-to-institution').addEventListener('click', () => {
        state.kurum = null;
        showGate('institution');
    });

    // 5. Logout
    document.querySelectorAll('.logout-btn').forEach(btn => {
        btn.addEventListener('click', handleLogout);
    });

    // 6. Camera Actions
    document.getElementById('btn-capture').addEventListener('click', capturePhoto);
    document.getElementById('btn-cancel-camera').addEventListener('click', stopCamera);
}

// ---------- LOGIC: INSTITUTION ----------
async function handleInstitutionEntry() {
    const code = document.getElementById('institution-code').value.trim().toUpperCase();
    if (!code) return Swal.fire('Hata', 'Lütfen bir kurum kodu girin.', 'error');

    state.kurum = code;
    document.getElementById('display-institution-name').textContent = code;

    // Check Firebase for Institution
    const snapshot = await db.ref(`institutions/${code}/config`).once('value');
    const config = snapshot.val();

    if (!config) {
        // First user is Admin
        document.getElementById('admin-note').textContent = "Bu kurum henüz kayıtlı değil. Gireceğiniz şifre 'İdareci' şifresi olarak belirlenecektir.";
        document.getElementById('admin-note').classList.add('warning-text');
    } else {
        document.getElementById('admin-note').textContent = "Lütfen idareci şifresini girin.";
        document.getElementById('admin-note').classList.remove('warning-text');
        // Load Personnel list for the select
        loadPersonnelList(config.personnel);
    }

    showGate('login');
}

function loadPersonnelList(personnelObj) {
    const select = document.getElementById('personnel-select');
    select.innerHTML = '<option value="">Lütfen İsminizi Seçin</option>';
    if (personnelObj) {
        Object.values(personnelObj).forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            select.appendChild(opt);
        });
    }
}

// ---------- LOGIC: AUTH ----------
async function handleAdminLogin() {
    const pass = document.getElementById('admin-password').value.trim();
    if (!pass) return Swal.fire('Hata', 'Lütfen şifre girin.', 'error');

    const code = state.kurum;
    const ref = db.ref(`institutions/${code}/config`);
    const snapshot = await ref.once('value');
    const config = snapshot.val();

    if (!config) {
        // Register new institution
        await ref.set({
            adminPass: pass,
            created: new Date().toISOString(),
            vehicles: {},
            personnel: {}
        });
        state.user = { name: "Admin", id: "admin" };
    } else {
        if (config.adminPass !== pass) return Swal.fire('Hata', 'Şifre Yanlış!', 'error');
        state.user = { name: "Admin", id: "admin" };
    }

    state.role = 'admin';
    startInstitutionalSession();
}

async function handlePersonnelLogin() {
    const id = document.getElementById('personnel-select').value;
    const pin = document.getElementById('personnel-pin').value;
    if (!id || !pin) return Swal.fire('Hata', 'Lütfen isminizi seçin ve PIN girin.', 'error');

    const snap = await db.ref(`institutions/${state.kurum}/config/personnel/${id}`).once('value');
    const pData = snap.val();

    if (!pData || pData.pin !== pin) return Swal.fire('Hata', 'PIN kodu hatalı!', 'error');

    state.user = pData;
    state.role = 'personnel';
    startInstitutionalSession();
}

function startInstitutionalSession() {
    // Hide Gates
    document.querySelectorAll('.gate-view').forEach(g => g.classList.remove('active'));
    
    // Save to LocalStorage
    localStorage.setItem('yurtarac_session', JSON.stringify({
        kurum: state.kurum,
        user: state.user,
        role: state.role
    }));

    if (state.role === 'admin') {
        showPanel('admin');
        initAdminDashboard();
    } else {
        showPanel('personnel');
        initPersonnelDashboard();
        listenToRequestStatus();
    }
}

function listenToRequestStatus() {
    // Listen for current user's last request
    db.ref(`institutions/${state.kurum}/requests`).orderByChild('userId').equalTo(state.user.id).on('value', snap => {
        const reqs = snap.val();
        if (!reqs) return updatePersonnelActionBtn('none');
        
        // Get the latest one
        const sorted = Object.keys(reqs).map(id => ({id, ...reqs[id]})).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
        const last = sorted[0];
        
        if (last.status === 'pending') {
            updatePersonnelActionBtn('pending');
        } else if (last.status === 'approved') {
            state.activeRequest = last;
            updatePersonnelActionBtn('start');
        } else if (last.status === 'active') {
            state.activeTrip = last;
            updatePersonnelActionBtn('finish');
        } else {
            updatePersonnelActionBtn('none');
        }
    });
}

function updatePersonnelActionBtn(mode) {
    const btn = document.getElementById('btn-action-main');
    const pill = document.getElementById('request-status-pill');
    const txt = document.getElementById('status-text');
    
    btn.onclick = null;
    
    if (mode === 'none') {
        pill.classList.add('hidden');
        btn.innerHTML = '<i data-lucide="car"></i> Araç Talep Et';
        btn.onclick = () => { state.cameraType = 'request'; startRequestFlow(); };
        btn.className = 'main-action-btn';
    } else if (mode === 'pending') {
        pill.classList.remove('hidden');
        pill.style.color = 'var(--warning)';
        txt.textContent = 'ONAY BEKLİYOR';
        btn.innerHTML = '<i data-lucide="clock"></i> İşlem Bekleniyor';
        btn.onclick = () => Swal.fire('Bilgi', 'Talebiniz henüz onaylanmadı.', 'info');
        btn.className = 'main-action-btn disabled';
    } else if (mode === 'start') {
        pill.classList.remove('hidden');
        pill.style.color = 'var(--primary)';
        txt.textContent = 'TALEP ONAYLANDI';
        btn.innerHTML = '<i data-lucide="play"></i> SÜRÜŞÜ BAŞLAT';
        btn.onclick = startTripFlow;
        btn.className = 'main-action-btn success-pulse';
    } else if (mode === 'finish') {
        pill.classList.remove('hidden');
        pill.style.color = 'var(--primary)';
        txt.textContent = 'SÜRÜŞ DEVAM EDİYOR';
        btn.innerHTML = '<i data-lucide="square"></i> SÜRÜŞÜ BİTİR';
        btn.onclick = finishTripFlow;
        btn.className = 'main-action-btn danger-pulse';
    }
    lucide.createIcons();
}

function handleLogout() {
    localStorage.removeItem('yurtarac_session');
    location.reload();
}

// ---------- LOGIC: ADMIN PANEL ----------
function initAdminDashboard() {
    document.getElementById('admin-inst-display').textContent = state.kurum;
    loadAdminStats();
    loadAdminView('approvals');
    
    // Listen for menu clicks
    document.querySelectorAll('.menu-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.menu-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            loadAdminView(btn.getAttribute('data-aview'));
        });
    });

    // Live Approval Listener
    db.ref(`institutions/${state.kurum}/requests`).on('value', snap => {
        const reqs = snap.val();
        let pending = 0;
        if (reqs) {
            pending = Object.values(reqs).filter(r => r.status === 'pending').length;
        }
        const badge = document.getElementById('approval-count');
        if (pending > 0) {
            badge.textContent = pending;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
        document.getElementById('stat-pending-reqs').textContent = pending;
        
        // If current aview is approvals, refresh
        if (document.querySelector('.menu-btn[data-aview="approvals"]').classList.contains('active')) {
            renderApprovals(reqs);
        }
    });
}

function loadAdminStats() {
    // Basic counters
    db.ref(`institutions/${state.kurum}/trips`).on('value', snap => {
        const trips = snap.val();
        let activeCount = 0;
        if (trips) {
            activeCount = Object.values(trips).filter(t => t.active === true).length;
        }
        document.getElementById('stat-active-trips').textContent = activeCount;
    });
}

function loadAdminView(view) {
    const container = document.getElementById('admin-content');
    container.innerHTML = `<div class="p-4 text-center">Yükleniyor...</div>`;

    if (view === 'approvals') {
        db.ref(`institutions/${state.kurum}/requests`).once('value', snap => {
            renderApprovals(snap.val());
        });
    } else if (view === 'vehicles') {
        renderVehicleManager();
    } else if (view === 'personnel') {
        renderPersonnelManager();
    } else if (view === 'reports') {
        renderReports();
    }
}

async function renderReports() {
    const container = document.getElementById('admin-content');
    const snap = await db.ref(`institutions/${state.kurum}/trips`).once('value');
    const trips = snap.val();
    
    if (!trips) {
        container.innerHTML = `<div class="empty-state">Henüz tamamlanan sürüş yok.</div>`;
        return;
    }

    const html = Object.values(trips).reverse().map(t => `
        <div class="report-card stagger-item">
            <div class="report-header">
                <strong>${t.userName}</strong>
                <span class="badge-km">${t.finishKm - t.startKm} KM</span>
            </div>
            <div class="report-details">
                <p>🚗 ${t.vehiclePlate} | 🗓️ ${new Date(t.timestamp).toLocaleDateString('tr-TR')}</p>
                <div class="km-stats">
                    <div><span>Baş:</span> ${t.startKm}</div>
                    <div><span>Bit:</span> ${t.finishKm}</div>
                </div>
            </div>
            <div class="report-photos">
                ${t.photosEnd.map(p => `<img src="${p}" onclick="zoomImage('${p}')">`).join('')}
            </div>
        </div>
    `).join('');
    
    container.innerHTML = html;
}

function renderApprovals(reqsObj) {
    const container = document.getElementById('admin-content');
    if (!reqsObj) {
        container.innerHTML = `<div class="empty-state">Henüz talep bulunmuyor.</div>`;
        return;
    }

    const html = Object.keys(reqsObj).map(id => {
        const r = reqsObj[id];
        if (r.status !== 'pending') return '';
        return `
            <div class="approval-card stagger-item">
                <div class="req-header">
                    <strong>${r.userName}</strong>
                    <span>${r.vehicleModel} (${r.vehiclePlate})</span>
                </div>
                <div class="req-body">
                    <p><strong>Amaç:</strong> ${r.purpose}</p>
                    <div class="req-photos">
                        ${r.photos.map(p => `<img src="${p}" onclick="zoomImage('${p}')">`).join('')}
                    </div>
                </div>
                <div class="req-footer">
                    <button class="approve-btn" onclick="processRequest('${id}', 'approved')">ONAYLA</button>
                    <button class="reject-btn" onclick="processRequest('${id}', 'rejected')">REDDET</button>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = html || `<div class="empty-state">Bekleyen onay bulunmuyor.</div>`;
}

// ---------- LOGIC: PERSONNEL PANEL ----------
function initPersonnelDashboard() {
    document.getElementById('user-display-name').textContent = state.user.name;
    initMap();
    updateProfileUI();
    loadPersonnelHistory();
    
    document.getElementById('btn-action-main').addEventListener('click', handleMainAction);
    
    // Bottom Nav
    document.querySelectorAll('.nav-item').forEach(nav => {
        nav.addEventListener('click', () => {
            const view = nav.getAttribute('data-pview');
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            nav.classList.add('active');
            document.querySelectorAll('.p-view').forEach(v => v.classList.remove('active'));
            document.getElementById(`personnel-${view}`).classList.add('active');
            
            if (view === 'requests') loadPersonnelHistory();
        });
    });
}

function updateProfileUI() {
    document.getElementById('profile-name').textContent = state.user.name;
    document.getElementById('profile-kurum').textContent = state.kurum;
    document.getElementById('profile-kurum-full').textContent = state.kurum + " Kurumsal Araç Filosu";
}

async function loadPersonnelHistory() {
    const list = document.getElementById('personnel-history-list');
    if (!list) return;
    
    const snap = await db.ref(`institutions/${state.kurum}/trips`).orderByChild('userId').equalTo(state.user.id).once('value');
    const trips = snap.val();
    
    if (!trips) {
        list.innerHTML = '<div class="empty-state">Henüz bir sürüş kaydı yok.</div>';
        return;
    }
    
    list.innerHTML = Object.values(trips).reverse().map(t => `
        <div class="report-card glass-card mb-3 stagger-item">
            <div class="d-flex justify-content-between align-items-center mb-2">
                <span class="fw-bold text-emerald">${t.vehiclePlate}</span>
                <span class="x-small text-muted">${new Date(t.timestamp).toLocaleDateString('tr-TR')}</span>
            </div>
            <p class="x-small text-white opacity-75 mb-2">📍 ${t.purpose}</p>
            <div class="km-stats">
                <div><span>KM:</span> ${t.startKm} - ${t.finishKm}</div>
                <div class="badge-km ms-auto">${t.finishKm - t.startKm} KM</div>
            </div>
        </div>
    `).join('');
}

function initMap() {
    const mapDiv = document.getElementById('map');
    if (!mapDiv) return;
    const lmap = L.map('map', { zoomControl: false, attributionControl: false }).setView([41.0082, 28.9784], 14);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png').addTo(lmap);
    
    // Fetch and render institution vehicles
    db.ref(`institutions/${state.kurum}/config/vehicles`).on('value', snap => {
        const vehs = snap.val();
        if (vehs) {
            Object.values(vehs).forEach(v => {
                const icon = L.divIcon({
                    className: 'veh-marker',
                    html: `<div class="pin"><i data-lucide="car"></i></div>`,
                    iconSize: [40, 40]
                });
                L.marker([v.lat || 41.0082, v.lng || 28.9784], { icon }).addTo(lmap).on('click', () => {
                    Swal.fire({
                        title: v.model,
                        text: `${v.plate} - ${v.year}`,
                        confirmButtonText: 'Seç'
                    });
                });
            });
            lucide.createIcons();
        }
    });
}

function handleMainAction() {
    // Start the Request Flow
    startRequestFlow();
}

async function startRequestFlow() {
    const { value: formValues } = await Swal.fire({
        title: 'Araç Talebi',
        html:
            '<label class="x-small text-muted">Araç Seçimi</label>' +
            '<input id="swal-plate" class="swal2-input" placeholder="Araç Plakası">' +
            '<label class="x-small text-muted">Gidiş Amacı</label>' +
            '<input id="swal-purpose" class="swal2-input" placeholder="Hedef / Sebep">',
        focusConfirm: false,
        preConfirm: () => {
            const p = document.getElementById('swal-plate').value.trim().toUpperCase();
            const pur = document.getElementById('swal-purpose').value.trim();
            if(!p || !pur) return Swal.showValidationMessage('Lütfen tüm alanları doldurun.');
            return { plate: p, purpose: pur }
        }
    });

    if (formValues) {
        state.activeRequest = { ...formValues, photos: [] };
        state.camera.type = 'start';
        startCameraSequence();
    }
}

async function startTripFlow() {
    const { value: km } = await Swal.fire({
        title: 'Sürüşü Başlat',
        text: 'Lütfen aracın mevcut kilometresini girin.',
        input: 'number',
        inputPlaceholder: 'Örn: 125400',
        showCancelButton: true,
        confirmButtonText: 'Başlat'
    });

    if (km) {
        await db.ref(`institutions/${state.kurum}/requests/${state.activeRequest.id}`).update({
            status: 'active',
            startKm: km,
            startTime: new Date().toISOString()
        });
        Swal.fire('Sürüş Başladı', 'İyi yolculuklar!', 'success');
    }
}

async function finishTripFlow() {
    const { value: km } = await Swal.fire({
        title: 'Sürüşü Bitir',
        text: 'Varış kilometresini girin.',
        input: 'number',
        inputPlaceholder: 'Örn: 125450',
        showCancelButton: true,
        confirmButtonText: 'Fotoğraflara Geç'
    });

    if (km) {
        state.finishKm = km;
        state.camera.type = 'end';
        startCameraSequence();
    }
}

// ---------- CAMERA SYSTEM ----------
function startCameraSequence() {
    state.camera.currentStep = 0;
    state.camera.photos = [];
    document.getElementById('camera-overlay').classList.remove('hidden');
    updateCameraUI();
    startCamera();
}

async function startCamera() {
    try {
        state.camera.stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'environment' } 
        });
        document.getElementById('camera-video').srcObject = state.camera.stream;
    } catch (e) {
        Swal.fire('Kamera Hatası', 'Kamera erişimi sağlanamadı.', 'error');
        stopCamera();
    }
}

function stopCamera() {
    if (state.camera.stream) {
        state.camera.stream.getTracks().forEach(t => t.stop());
    }
    document.getElementById('camera-overlay').classList.add('hidden');
}

function updateCameraUI() {
    document.getElementById('camera-step-title').textContent = state.camera.steps[state.camera.currentStep];
}

function capturePhoto() {
    const video = document.getElementById('camera-video');
    const canvas = document.getElementById('camera-canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    
    const data = canvas.toDataURL('image/jpeg', 0.7);
    state.camera.photos.push(data);
    
    state.camera.currentStep++;
    if (state.camera.currentStep < state.camera.steps.length) {
        updateCameraUI();
    } else {
        finishCamera();
    }
}

function finishCamera() {
    stopCamera();
    if (state.camera.type === 'start') {
        submitRequest();
    } else {
        submitTripFinish();
    }
}

async function submitRequest() {
    const newReqRef = db.ref(`institutions/${state.kurum}/requests`).push();
    await newReqRef.set({
        id: newReqRef.key,
        userId: state.user.id,
        userName: state.user.name,
        vehiclePlate: state.activeRequest.plate,
        vehicleModel: "Araç", 
        purpose: state.activeRequest.purpose,
        photos: state.camera.photos,
        status: 'pending',
        timestamp: new Date().toISOString()
    });
    
    Swal.fire('Gönderildi', 'Talebiniz idareci onayına sunuldu.', 'success');
}

async function submitTripFinish() {
    const tripId = state.activeTrip.id;
    const tripData = {
        ...state.activeTrip,
        finishKm: state.finishKm,
        finishTime: new Date().toISOString(),
        photosEnd: state.camera.photos,
        status: 'completed'
    };
    
    // Archive to trips and remove from requests
    await db.ref(`institutions/${state.kurum}/trips/${tripId}`).set(tripData);
    await db.ref(`institutions/${state.kurum}/requests/${tripId}`).remove();
    
    state.activeTrip = null;
    Swal.fire('Tamamlandı', 'Sürüş kaydı başarıyla arşivlendi.', 'success');
}

// --- ADMIN API ---
window.processRequest = async (id, status) => {
    await db.ref(`institutions/${state.kurum}/requests/${id}`).update({ status });
}

window.zoomImage = (src) => {
    Swal.fire({ imageUrl: src, imageWidth: '100%', showConfirmButton: false });
}

// --- ADMIN PANEL RENDERING ---
function renderVehicleManager() {
    const container = document.getElementById('admin-content');
    container.innerHTML = `
        <div class="manager-card glass-card stagger-item">
            <h4 class="text-emerald"><i data-lucide="plus-circle"></i> Yeni Araç Ekle</h4>
            <div class="input-group">
                <input type="text" id="new-v-model" placeholder="Model (Örn: Citroen Berlingo)">
                <input type="text" id="new-v-plate" placeholder="Plaka (34 YA 1234)">
                <button class="primary-btn shadow-neon" onclick="addVehicle()">KAYDET</button>
            </div>
        </div>
        <div id="vehicle-list" class="mt-4"></div>
    `;
    loadVehicleList();
    lucide.createIcons();
}

window.addVehicle = async () => {
    const model = document.getElementById('new-v-model').value.trim();
    const plate = document.getElementById('new-v-plate').value.trim().toUpperCase();
    if (!model || !plate) return Swal.fire('Uyarı', 'Lütfen tüm alanları doldurun.', 'warning');
    
    const vRef = db.ref(`institutions/${state.kurum}/config/vehicles`).push();
    await vRef.set({
        id: vRef.key,
        model, plate, year: 2024, created: new Date().toISOString()
    });
    loadVehicleList();
    Swal.fire('Başarılı', 'Araç filoya eklendi.', 'success');
}

window.deleteVehicle = async (id) => {
    const res = await Swal.fire({
        title: 'Emin misiniz?',
        text: "Bu araç kalıcı olarak silinecek.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Evet, Sil',
        cancelButtonText: 'Vazgeç'
    });

    if (res.isConfirmed) {
        await db.ref(`institutions/${state.kurum}/config/vehicles/${id}`).remove();
        loadVehicleList();
    }
}

async function loadVehicleList() {
    const snap = await db.ref(`institutions/${state.kurum}/config/vehicles`).once('value');
    const vehs = snap.val();
    const listEl = document.getElementById('vehicle-list');
    if (!vehs) {
        listEl.innerHTML = '<p class="text-center">Henüz araç eklenmemiş.</p>';
        return;
    }
    listEl.innerHTML = Object.values(vehs).map(v => `
        <div class="list-item glass-card mb-2 stagger-item">
            <div class="d-flex align-items-center gap-3">
                <div class="badge-km"><i data-lucide="car"></i></div>
                <div>
                    <div class="fw-bold">${v.model}</div>
                    <div class="x-small text-muted">${v.plate}</div>
                </div>
            </div>
            <button class="btn-icon text-danger" onclick="deleteVehicle('${v.id}')"><i data-lucide="trash-2"></i></button>
        </div>
    `).join('');
    lucide.createIcons();
}

function renderPersonnelManager() {
    const container = document.getElementById('admin-content');
    container.innerHTML = `
        <div class="manager-card glass-card stagger-item">
            <h4 class="text-emerald"><i data-lucide="user-plus"></i> Personel Tanımla</h4>
            <div class="input-group">
                <input type="text" id="new-p-name" placeholder="Ad Soyad">
                <input type="text" id="new-p-pin" placeholder="Giriş PIN (4 Hane)" maxlength="4">
                <button class="primary-btn shadow-neon" onclick="addPersonnel()">EKLE</button>
            </div>
        </div>
        <div id="personnel-list" class="mt-4"></div>
    `;
    loadPersonnelListAdmin();
    lucide.createIcons();
}

window.addPersonnel = async () => {
    const name = document.getElementById('new-p-name').value.trim();
    const pin = document.getElementById('new-p-pin').value.trim();
    if (!name || pin.length !== 4) return Swal.fire('Uyarı', 'İsim ve 4 haneli PIN zorunludur.', 'warning');
    
    const ref = db.ref(`institutions/${state.kurum}/config/personnel`).push();
    await ref.set({ id: ref.key, name, pin, created: new Date().toISOString() });
    loadPersonnelListAdmin();
    Swal.fire('Başarılı', 'Personel tanımlandı.', 'success');
}

window.deletePersonnel = async (id) => {
    const res = await Swal.fire({
        title: 'Emin misiniz?',
        text: "Personel erişimi iptal edilecek.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Evet, Sil',
        cancelButtonText: 'Vazgeç'
    });

    if (res.isConfirmed) {
        await db.ref(`institutions/${state.kurum}/config/personnel/${id}`).remove();
        loadPersonnelListAdmin();
    }
}

async function loadPersonnelListAdmin() {
    const snap = await db.ref(`institutions/${state.kurum}/config/personnel`).once('value');
    const pers = snap.val();
    const listEl = document.getElementById('personnel-list');
    if (!pers) {
        listEl.innerHTML = '<p class="text-center">Henüz personel eklenmemiş.</p>';
        return;
    }
    listEl.innerHTML = Object.values(pers).map(p => `
        <div class="list-item glass-card mb-2 stagger-item">
            <div class="d-flex align-items-center gap-3">
                <div class="badge-km bg-warning text-white"><i data-lucide="user"></i></div>
                <div>
                    <div class="fw-bold">${p.name}</div>
                    <div class="x-small text-muted">PIN: ${p.pin}</div>
                </div>
            </div>
            <button class="btn-icon text-danger" onclick="deletePersonnel('${p.id}')"><i data-lucide="trash-2"></i></button>
        </div>
    `).join('');
    lucide.createIcons();
}

function toggleTheme() {
    const body = document.body;
    body.classList.toggle('light-mode');
    const isLight = body.classList.contains('light-mode');
    localStorage.setItem('yurtarac_theme', isLight ? 'light' : 'dark');
}
