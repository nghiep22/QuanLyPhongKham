"""API chỉ tải model đã lưu và phục vụ truy vấn."""
import json as dulieuchuoi
import time as dongho
import joblib as luumohinh
from fastapi import FastAPI as ungdungapi, Request as yeucauapi
from fastapi.middleware.cors import CORSMiddleware as chophepnguon
from fastapi.responses import JSONResponse as phanhoi

from duongdan import tepmohinh, tepketqua
from timkiem import botimkiem


def taoungdung(mohinh: dict | None = None) -> ungdungapi:
    ungdung = ungdungapi(title="Tim kiem bai viet TF-IDF", version="1.0.0")
    ungdung.add_middleware(chophepnguon,
        allow_origins=["http://localhost:5175", "http://127.0.0.1:5175"],
        allow_methods=["GET"], allow_headers=["*"],
    )
    if mohinh is None and tepmohinh.exists():
        try:
            mohinh = luumohinh.load(tepmohinh)
        except Exception:
            mohinh = None
    timkiem = botimkiem(mohinh) if mohinh is not None else None

    def baoloi(maloi: str, thongbao: str, trangthai: int, chitiet: dict | None = None):
        loi = {"code": maloi, "message": thongbao}
        if chitiet is not None:
            loi["details"] = chitiet
        return phanhoi(status_code=trangthai, content={"error": loi})

    @ungdung.get("/api/health")
    def suckhoe():
        return phanhoi(status_code=200 if timkiem else 503,
                       content={"status": "ready" if timkiem else "model_missing"})

    @ungdung.get("/api/meta")
    def thongtin():
        if timkiem is None:
            return baoloi("MODEL_MISSING", "Chạy python chaylenh.py toanbo trước.", 503)
        dulieu = timkiem.mohinh
        return {"data": {
            "categories": dulieu["chude"], "documents": len(dulieu["baiviet"]),
            "vocabularySize": len(dulieu["duongong"].named_steps["vectorhoatu"].vocabulary_),
            "config": dulieu["cauhinh"], "createdAtUtc": dulieu["thoigiantao"],
            "scope": "Historical English 20 Newsgroups posts; lexical similarity only, not medical advice.",
        }}

    @ungdung.get("/api/search")
    def tim(yeucau: yeucauapi):
        if timkiem is None:
            return baoloi("MODEL_MISSING", "Chạy python chaylenh.py toanbo trước.", 503)
        truyvan = yeucau.query_params.get("q", "").strip()
        soluongchu = yeucau.query_params.get("k", "10")
        chude = yeucau.query_params.get("category")
        if (len(truyvan) < 2 or len(truyvan) > 200
                or len(soluongchu) > 2 or not soluongchu.isascii()
                or not soluongchu.isdecimal() or not 1 <= int(soluongchu) <= 50):
            return baoloi("INVALID_QUERY", "q phải dài 2–200 ký tự; k phải là số nguyên 1–50.", 400,
                          {"q": "2–200 ký tự", "k": "1–50"})
        if chude and chude not in timkiem.mohinh["chude"]:
            return baoloi("INVALID_CATEGORY", "Chủ đề không tồn tại.", 400)
        batdau = dongho.perf_counter()
        ketqua = timkiem.tim(truyvan, int(soluongchu), chude)
        return {"data": ketqua, "meta": {
            "query": truyvan, "k": int(soluongchu), "category": chude,
            "count": len(ketqua), "responseMs": round((dongho.perf_counter() - batdau) * 1000, 2),
            "warning": "No indexed vocabulary matched the query." if not ketqua else None,
        }}

    @ungdung.get("/api/evaluation")
    def danhgia():
        if not tepketqua.exists():
            return baoloi("EVALUATION_MISSING", "Chạy python chaylenh.py danhgia trước.", 503)
        return {"data": dulieuchuoi.loads(tepketqua.read_text(encoding="utf-8"))}

    @ungdung.exception_handler(404)
    def khongtimthay(yeucau: yeucauapi, loi: Exception):
        return baoloi("NOT_FOUND", "Endpoint không tồn tại.", 404)

    return ungdung


ungdung = taoungdung()
