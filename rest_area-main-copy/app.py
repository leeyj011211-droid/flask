import os
import sqlite3
import requests
import re
from flask import Flask, render_template, request, jsonify
import json
import google.generativeai as genai 
app = Flask(__name__)
app.config["JSON_AS_ASCII"] = False

import requests
api_key = "AIzaSyDrteqoKbwc-ImJxoWKYiTkFO-IWqezj58"
check_url = f"https://generativelanguage.googleapis.com/v1/models?key={api_key}"
try:
    models_data = requests.get(check_url).json()
    print("--- [사용 가능한 모델 목록] ---")
    for m in models_data.get('models', []):
        print(m['name']) # 여기에 출력되는 이름을 그대로 url에 써야 합니다.
    print("----------------------------")
except:
    print("모델 목록을 불러오지 못했습니다.")

# test word # wwww
class UTF8JSONEncoder(json.JSONEncoder):
    def ensure_ascii(self):
        return False
    
# =========================
# 카카오 REST API 키 (환경변수 추천)
# =========================
REST_API_KEY = os.getenv("KAKAO_REST_API_KEY", "d0a9f936e8aedab41f9a85db96767447")
# REST_API_KEY = "d0a9f936e8aedab41f9a85db96767447"

# =========================
# 주소/장소 → 좌표 변환 (x=lng, y=lat)
# =========================
def geocode(query: str):
    headers = {"Authorization": f"KakaoAK {REST_API_KEY}"}

    # 1) 주소 검색
    url_addr = "https://dapi.kakao.com/v2/local/search/address.json"
    r = requests.get(url_addr, headers=headers, params={"query": query}, timeout=10)
    data = r.json()
    if data.get("documents"):
        doc = data["documents"][0]
        return float(doc["x"]), float(doc["y"])  # (lng, lat)

    # 2) 키워드(장소) 검색
    url_kw = "https://dapi.kakao.com/v2/local/search/keyword.json"
    r = requests.get(url_kw, headers=headers, params={"query": query}, timeout=10)
    data = r.json()
    if data.get("documents"):
        doc = data["documents"][0]
        return float(doc["x"]), float(doc["y"])

    raise ValueError(f"주소/장소 검색 실패: {query}")

# =========================
# 카카오 모빌리티 길찾기 (vertexes 파싱)
# =========================
def get_route(origin, dest):
    # origin/dest: (lng, lat)
    url = "https://apis-navi.kakaomobility.com/v1/directions"
    headers = {"Authorization": f"KakaoAK {REST_API_KEY}"}
    params = {
        "origin": f"{origin[0]},{origin[1]}",
        "destination": f"{dest[0]},{dest[1]}",
        "priority": "RECOMMEND",
    }

    res = requests.get(url, headers=headers, params=params, timeout=15).json()

    # 방어 코드
    routes = res.get("routes", [])
    if not routes:
        raise ValueError("길찾기 결과가 없습니다.")
    sections = routes[0].get("sections", [])
    if not sections:
        raise ValueError("길찾기 sections가 없습니다.")

    roads = sections[0].get("roads", [])
    coords = []

    for road in roads:
        v = road.get("vertexes", [])
        for i in range(0, len(v), 2):
            coords.append((v[i], v[i + 1]))  # (lng, lat)

    return coords

# =========================
# DB에서 전체 휴게소 로드
# =========================
def load_rest_areas():
    conn = sqlite3.connect("rest_areas.db")
    cur = conn.cursor()
    
    # 1. 일단 확실히 존재하는 컬럼만 조회합니다.
    cur.execute("""
        SELECT id, name, route_no, direction, latitude, longitude, signature_food
        FROM rest_areas
    """)
    rows = cur.fetchall()
    conn.close()

    rests = []
    for row in rows:
        rests.append({
            "id": row[0],
            "name": row[1],
            "route_no": row[2],
            "direction": row[3],
            "lat": row[4],
            "lng": row[5],
            "food": row[6] or "",
            # 2. DB에 없는 컬럼은 일단 False로 고정하여 에러를 방지합니다.
            "has_gas": False,
            "has_ev": False,
            "has_pharmacy": False,
            "has_baby": False
        })
    return rests

# =========================
# 페이지
# =========================
@app.route("/")
def index():
    return render_template("index.html")

# =========================
# 경로 요청 (프론트 → POST /route)
# =========================
@app.route("/route", methods=["POST"])
def route():
    data = request.get_json(force=True)
    start = data.get("start", "")
    end = data.get("end", "")

    try:
        start_xy = geocode(start)
        end_xy = geocode(end)
        route_points = get_route(start_xy, end_xy)
        rests = load_rest_areas()
        return jsonify({
            "route": route_points,
            "rests": rests
        })
    except Exception as e:
        # 🔥 한글 에러 메시지도 안전
        return jsonify({"error": str(e)}), 500
    

    
# Gemini API 설정
#genai.configure(api_key="AIzaSyDDrwLZEZ2DhwKLtbkPp_C8sFjZjYIMIY8", transport='rest')

#model = genai.GenerativeModel('gemini-pro')

# =========================
# Gemini를 통한 휴게소 상세 정보 생성
# =========================
import re  # 정규표현식을 위해 상단에 추가

@app.route("/get_info", methods=["POST"])
def get_rest_area_info():
    try:
        data = request.get_json()
        rest_name = data.get("name")
        
        # 아까 성공했던 목록에 있던 모델입니다.
        api_key = "AIzaSyDDrwLZEZ2DhwKLtbkPp_C8sFjZjYIMIY8" 
        
        # 1. 주소를 v1beta로 바꿉니다 (2.0 모델은 베타 주소에서 더 잘 작동할 때가 많습니다)
        # 2. 모델명은 목록에 있었던 gemini-2.5-flash-lite는 구라침
        # flash는 하루에 5번밖에 못함
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key={api_key}"        
        payload = {
            "contents": [{"parts": [{"text": f"{rest_name} 해당 휴게소를 찾아서 실제로 판매중인 대표 메뉴 2개를 알려줘. 간단한 설명과 메뉴만 출력해. "}]}]
        }
        
        res = requests.post(url, json=payload, timeout=10)
        res_data = res.json()
        
        if "candidates" in res_data:
            info_text = res_data['candidates'][0]['content']['parts'][0]['text']
            return jsonify({"info": info_text})
        else:
            # 에러가 나면 어떤 에러인지 정확히 보여줍니다.
            return jsonify({"error": res_data.get('error', {}).get('message', '알 수 없는 오류')}), 500

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    
    
    
if __name__ == "__main__":
    # 외부 접속 필요하면 host="0.0.0.0"
    app.run(debug=True)    