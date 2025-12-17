/********************************************
 * 지도 초기화
 ********************************************/
let map;
let polyline;
let markers = [];

window.onload = function () {
    map = new kakao.maps.Map(document.getElementById("map"), {
        center: new kakao.maps.LatLng(37.5665, 126.9780),
        level: 8
    });

    addInputListeners();
};


/********************************************
 * 입력창 자동완성 기능
 ********************************************/
function addInputListeners() {
    document.getElementById("start").addEventListener("input", () => autoComplete("start"));
    document.getElementById("end").addEventListener("input", () => autoComplete("end"));
}

function autoComplete(type) {
    const keyword = document.getElementById(type).value;
    const box = document.getElementById("autocomplete");

    if (!keyword) {
        box.style.display = "none";
        return;
    }

    const ps = new kakao.maps.services.Places();
    ps.keywordSearch(keyword, (data, status) => {
        if (status !== kakao.maps.services.Status.OK) return;

        box.innerHTML = "";
        box.style.display = "block";

        data.forEach(place => {
            const item = document.createElement("div");
            item.className = "autocomplete-item";
            item.innerHTML = `
                <b>${place.place_name}</b><br>
                <small>${place.road_address_name || place.address_name}</small>
            `;

            item.onclick = () => {
                document.getElementById(type).value =
                    place.road_address_name || place.address_name;

                box.style.display = "none";

                let loc = new kakao.maps.LatLng(place.y, place.x);
                map.setCenter(loc);

                let marker = new kakao.maps.Marker({ position: loc });
                marker.setMap(map);
                markers.push(marker);
            };

            box.appendChild(item);
        });
    });
}

function clearInputs() {
    document.getElementById("start").value = "";
    document.getElementById("end").value = "";
}


/********************************************
 * Flask 서버에 경로 요청
 ********************************************/
function requestRoute() {
    let start = document.getElementById("start").value;
    let end = document.getElementById("end").value;

    fetch("/route", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ start, end })
    })
        .then(res => res.json())
        .then(drawRoute);
}


/********************************************
 * 경로 표시
 ********************************************/
function drawRoute(data) {
    const path = data.route.map(p => new kakao.maps.LatLng(p[1], p[0]));

    if (polyline) polyline.setMap(null);

    polyline = new kakao.maps.Polyline({
        path: path,
        strokeWeight: 5,
        strokeColor: "#ff0000",
        strokeOpacity: 0.8
    });
    polyline.setMap(map);

    drawRestAreas(data.rests);
}


/********************************************
 * 거리 계산 함수 (Haversine)
 ********************************************/
function getDistance(lat1, lng1, lat2, lng2) {
    function toRad(v) { return v * Math.PI / 180; }

    const R = 6371000; // m
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) ** 2;

    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}


/********************************************
 * 휴게소가 경로 근처(1km)인지 판단
 ********************************************/
function isRestAreaNearRoute(restLat, restLng, routePoints, thresholdMeters = 1000) {
    for (let i = 0; i < routePoints.length - 1; i++) {
        const p1 = routePoints[i];
        const p2 = routePoints[i + 1];

        const d1 = getDistance(restLat, restLng, p1.getLat(), p1.getLng());
        const d2 = getDistance(restLat, restLng, p2.getLat(), p2.getLng());

        const minDist = Math.min(d1, d2);

        if (minDist <= thresholdMeters) return true;
    }
    return false;
}


/********************************************
 * 휴게소 표시 (경로 주변 + 순서 정렬 + 중복 제거)
 ********************************************/
function drawRestAreas(rests) {
    const list = document.getElementById("rest-list");
    list.innerHTML = "";

    markers.forEach(m => m.setMap(null));
    markers = [];

    const path = polyline.getPath();
    const startPoint = path[0];

    let nearRests = [];

    // 1) 경로 근처만 필터
    rests.forEach(r => {
        if (isRestAreaNearRoute(r.lat, r.lng, path)) {
            nearRests.push(r);
        }
    });

    // 2) 중복 제거
    const unique = [];
    const seen = new Set();

    nearRests.forEach(r => {
        const key = `${r.name}_${r.lat}_${r.lng}`;
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(r);
        }
    });

    // 3) 출발 기준 근접 순서대로 정렬
    unique.sort((a, b) => {
        const da = getDistance(startPoint.getLat(), startPoint.getLng(), a.lat, a.lng);
        const db = getDistance(startPoint.getLat(), startPoint.getLng(), b.lat, b.lng);
        return da - db;
    });

    console.log("최종 표시 휴게소 수 =", unique.length);

    // 4) 리스트 + 마커 표시
    unique.forEach(r => {
        let div = document.createElement("div");
        div.innerHTML = `
            <b>${r.name}</b><br>
            ${r.food}<br><br>
        `;
        list.appendChild(div);

        let marker = new kakao.maps.Marker({
            position: new kakao.maps.LatLng(r.lat, r.lng),
        });

        marker.setMap(map);
        markers.push(marker);
    });
}
