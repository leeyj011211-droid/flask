// =========================
// 지도 및 전역 상태
// =========================
console.log("main.js 로딩됨");

let map;
let polyline;
let markers = [];
let lastRests = [];

const filters = {
  onlyBestFood: false,
  hasEV: false,
  hasGas: false,
};

// 페이지 로드 시 초기화
window.onload = function () {
  const mapContainer = document.getElementById("map");
  const mapOption = {
    center: new kakao.maps.LatLng(37.5665, 126.9780),
    level: 8,
  };
  map = new kakao.maps.Map(mapContainer, mapOption);

  addInputListeners();
  wireFilterButtons();
};

// =========================
// 1. 길찾기 요청 (HTML 버튼에서 호출)
// =========================
function requestRoute() {
  const start = document.getElementById("start").value.trim();
  const end = document.getElementById("end").value.trim();

  if (!start || !end) {
    alert("출발지/도착지를 입력하세요.");
    return;
  }

  console.log("경로 요청 시작:", start, "->", end);

  fetch("/route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start, end }),
  })
    .then(res => res.json())
    .then(data => {
      if (data.error) throw new Error(data.error);
      
      // 검색 성공 시 결과 영역 표시 (새 레이아웃 대응)
      const resultsArea = document.getElementById("results-area");
      if (resultsArea) {
        resultsArea.classList.remove("hidden");
        resultsArea.style.display = "block";
      }

      drawRoute(data);
      
      // 지도가 숨겨져 있다가 나타나면 크기를 재조정해야 함
      setTimeout(() => {
        map.relayout();
      }, 100);
    })
    .catch(err => {
      console.error(err);
      alert("오류: " + err.message);
    });
}

// =========================
// 2. 경로 및 휴게소 그리기
// =========================
function drawRoute(data) {
  if (!data.route || data.route.length === 0) return;

  const path = data.route.map(p => new kakao.maps.LatLng(p[1], p[0]));

  if (polyline) polyline.setMap(null);

  polyline = new kakao.maps.Polyline({
    path,
    strokeWeight: 5,
    strokeColor: "#2563eb", // 세련된 블루로 변경
    strokeOpacity: 0.8,
  });
  polyline.setMap(map);

  // 지도 범위 조정
  const bounds = new kakao.maps.LatLngBounds();
  path.forEach(p => bounds.extend(p));
  map.setBounds(bounds);

  // 휴게소 데이터 저장 및 렌더링
  lastRests = data.rests || [];
  drawRestAreas(lastRests);

  // 메타 정보 업데이트
  updateRouteMeta(path);
}

function updateRouteMeta(path) {
  const totalMeters = calculateTotalDistance(path);
  const metaBox = document.getElementById("route-meta");
  const distEl = document.getElementById("meta-distance");
  const timeEl = document.getElementById("meta-time");

  if (metaBox) {
    metaBox.classList.remove("hidden");
    distEl.textContent = `${(totalMeters / 1000).toFixed(1)} km`;
    timeEl.textContent = estimateTime(totalMeters);
  }
}

// =========================
// 3. 휴게소 리스트 & 마커 렌더링
// =========================
function drawRestAreas(rests) {
  const list = document.getElementById("rest-list");
  if (!list) return;
  list.innerHTML = "";

  markers.forEach(m => m.setMap(null));
  markers = [];

  const path = polyline.getPath();
  const travelDirection = getTravelDirection(path);
  const startPoint = path[0];

  let filtered = rests.filter(r => {
    if (!isRestAreaNearRoute(r.lat, r.lng, path)) return false;
    if (r.direction === "상행" && travelDirection === "하행") return false;
    if (r.direction === "하행" && travelDirection === "상행") return false;
    
    // 필터 조건 적용
    if (filters.hasEV && !r.has_ev) return false;
    if (filters.hasGas && !r.has_gas) return false;
    if (filters.onlyBestFood && parseFloat(r.rating || 0) < 4.0) return false;

    return true;
  });

  // 거리순 정렬
  filtered.sort((a, b) => {
    const da = getDistance(startPoint.getLat(), startPoint.getLng(), a.lat, a.lng);
    const db = getDistance(startPoint.getLat(), startPoint.getLng(), b.lat, b.lng);
    return da - db;
  });

  filtered.forEach(r => {
    const loc = new kakao.maps.LatLng(r.lat, r.lng);
    const marker = new kakao.maps.Marker({ position: loc, map: map });
    markers.push(marker);

    kakao.maps.event.addListener(marker, 'click', () => openRestModal(r));

    const card = document.createElement("div");
    card.className = "rest-card";
    card.innerHTML = `
      <span class="badge">${r.route_no} (${r.direction})</span>
      <div class="rest-name">${r.name}</div>
      <div class="rest-sub">${r.food || "대표 메뉴 정보 없음"}</div>
      <div class="best">
        <div>
          <span class="tag">BEST</span>
          <span style="font-weight:800">${r.food || "-"}</span>
        </div>
        <div style="color:#2563eb; font-weight:900">→</div>
      </div>
    `;
    card.onclick = () => {
        map.panTo(loc);
        openRestModal(r);
    };
    list.appendChild(card);
  });
}

// =========================
// 4. 공통 유틸리티 함수 (중복 제거됨)
// =========================
function getDistance(lat1, lng1, lat2, lng2) {
  const toRad = v => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculateTotalDistance(path) {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    total += getDistance(path[i].getLat(), path[i].getLng(), path[i+1].getLat(), path[i+1].getLng());
  }
  return total;
}

function estimateTime(totalMeters) {
  const totalMinutes = Math.round((totalMeters / 1000) / 80 * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h === 0 ? `${m}분` : `${h}시간 ${m}분`;
}

function isRestAreaNearRoute(restLat, restLng, routePoints) {
  for (let i = 0; i < routePoints.length - 1; i++) {
    const d = getDistance(restLat, restLng, routePoints[i].getLat(), routePoints[i].getLng());
    if (d <= 1500) return true; // 범위를 1.5km로 약간 확장
  }
  return false;
}

function getTravelDirection(path) {
  return path[path.length - 1].getLat() < path[0].getLat() ? "하행" : "상행";
}

// =========================
// 5. 기타 UI 로직 (모달, 필터, 자동완성)
// =========================
function openRestModal(rest) {
  document.getElementById("modal-highway").textContent = rest.route_no;
  document.getElementById("modal-name").textContent = rest.name;
  document.getElementById("modal-rating").textContent = rest.rating || "4.2";
  document.getElementById("modal-menu-name").textContent = rest.food || "정보 없음";
  
  const descEl = document.getElementById("modal-menu-desc");
  descEl.innerHTML = `<div class="loading-ai">🤖 Gemini 분석 중...</div>`;

  fetch('/get_info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: rest.name })
  })
    .then(res => res.json())
    .then(data => {
      descEl.innerHTML = data.info ? data.info.replace(/\n/g, '<br>') : "정보 없음";
    })
    .catch(() => { descEl.textContent = "오류 발생"; });

  setFacility("fac-gas", rest.has_gas);
  setFacility("fac-ev", rest.has_ev);
  
  document.getElementById("modal-naver").onclick = () => {
    window.open(`https://map.naver.com/p/search/${encodeURIComponent(rest.name)}`, "_blank");
  };
  document.getElementById("rest-modal").classList.remove("hidden");
}

function closeRestModal() {
  document.getElementById("rest-modal").classList.add("hidden");
}

function setFacility(id, has) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle("disabled", !has);
}

function wireFilterButtons() {
  const btns = {
    "filter-best": "onlyBestFood",
    "filter-ev": "hasEV",
    "filter-gas": "hasGas"
  };
  Object.keys(btns).forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.onclick = () => {
        filters[btns[id]] = !filters[btns[id]];
        el.classList.toggle("active-" + id.split('-')[1]);
        if (lastRests.length > 0) drawRestAreas(lastRests);
      };
    }
  });
}

function addInputListeners() {
  ['start', 'end'].forEach(id => {
    document.getElementById(id).addEventListener("input", () => autoComplete(id));
  });
}

function autoComplete(type) {
  const keyword = document.getElementById(type).value;
  const box = document.getElementById("autocomplete");
  if (!keyword) { box.style.display = "none"; return; }

  const ps = new kakao.maps.services.Places();
  ps.keywordSearch(keyword, (data, status) => {
    if (status !== kakao.maps.services.Status.OK) return;
    box.innerHTML = "";
    box.style.display = "block";
    data.forEach(place => {
      const item = document.createElement("div");
      item.className = "autocomplete-item";
      item.innerHTML = `<b>${place.place_name}</b><br><small>${place.address_name}</small>`;
      item.onclick = () => {
        document.getElementById(type).value = place.place_name;
        box.style.display = "none";
        map.setCenter(new kakao.maps.LatLng(place.y, place.x));
      };
      box.appendChild(item);
    });
  });
}

function clearInputs() {
  document.getElementById("start").value = "";
  document.getElementById("end").value = "";
}